/**
 * Auth pengurus/admin — PRD §5.2, §5.6 (task B2 sebagian, prasyarat F-3).
 *
 *   POST /auth/pengurus/login   { email, password }  → cookie `sid` + `csrf_token`
 *   POST /auth/pengurus/logout                       → cabut sesi + buang cookie
 *   GET  /auth/pengurus/sesi                         → profil ringkas + sisa waktu
 *
 * Sandi di-hash argon2id (`pengguna_pengurus.password_hash`, seed B17).
 * Rate limit khusus auth 10 req/menit/IP (§14.1). Verifikasi dijalankan meski
 * email tidak dikenal (hash pembungkus) agar waktu respons tidak membedakan
 * "akun tidak ada" vs "sandi salah" (anti-enumerasi §14.1).
 */
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { catatAudit, type PortalAudit } from "../plugins/audit.js";
import { NAMA_COOKIE_CSRF, NAMA_COOKIE_SESI, buatTokenAcak, opsiCookieSesi } from "../plugins/auth.js";
import { tanamCookieCsrf, verifikasiCsrf } from "../plugins/csrf.js";
import { batasAuth } from "../plugins/ratelimit.js";
import { db, denganScope, type DbTransaksi } from "../services/db.js";
import { hashKataSandi, verifikasiKataSandi } from "../services/kredensial.js";
import { buatSesi, cabutSesi, sisaWaktuSesi } from "../services/sesi.js";
import type { LevelScope } from "../services/scopeCheck.js";
import type { PeranSesi } from "../types.js";

const skemaLogin = z.object({
  email: z.string().trim().min(3).max(160),
  password: z.string().min(8).max(200),
});

/** Hash pembungkus untuk menyetarakan waktu respons saat email tak dikenal. */
let hashPembungkus: string | null = null;
async function ambilHashPembungkus(): Promise<string> {
  hashPembungkus ??= await hashKataSandi(buatTokenAcak(16));
  return hashPembungkus;
}

function perangkat(req: FastifyRequest): string | null {
  const ua = req.headers["user-agent"];
  return (Array.isArray(ua) ? ua[0] : ua) ?? null;
}

/**
 * Profil tampilan pengurus — `pengguna_pengurus` TIDAK punya kolom nama, jadi
 * dicocokkan lewat email pada `pengurus_rt`/`pengurus_rw` milik scope yang sama
 * (pola sama `pengurusAktif`, tetapi TANPA fallback ke ketua: nama orang lain
 * tidak boleh dipakai atas akun yang tidak cocok). Tak ketemu → `nama` kosong
 * dan FE jatuh ke surel — identitas tampil jujur, bukan nama karangan.
 */
async function cariProfilPengurus(
  tx: DbTransaksi,
  level: "rt" | "rw",
  scopeId: string,
  email: string,
): Promise<{ nama: string; jabatan: string }> {
  const baris =
    level === "rt"
      ? await tx.pengurusRt.findFirst({
          where: { rtId: scopeId, email },
          select: { nama: true, jabatan: true },
        })
      : await tx.pengurusRw.findFirst({
          where: { rwId: scopeId, email },
          select: { nama: true, jabatan: true },
        });
  return { nama: baris?.nama ?? "", jabatan: baris?.jabatan ?? "" };
}

export const ruteAuthPengurus: FastifyPluginAsync = async (app) => {
  app.post("/auth/pengurus/login", { config: batasAuth }, async (req, reply) => {
    const hasil = skemaLogin.safeParse(req.body);
    if (!hasil.success) {
      return reply.gagal("VALIDATION", "Email dan kata sandi wajib diisi (kata sandi min. 8 karakter).");
    }
    const email = hasil.data.email.toLowerCase();
    const pengguna = await db().penggunaPengurus.findUnique({ where: { email } });
    const sandiCocok = await verifikasiKataSandi(
      pengguna?.passwordHash ?? (await ambilHashPembungkus()),
      hasil.data.password,
    );
    if (!pengguna || pengguna.status !== "active" || !sandiCocok) {
      return reply.gagal("UNAUTHORIZED", "Email atau kata sandi salah.");
    }

    const level: LevelScope =
      pengguna.peran === "super_admin" ? "platform" : pengguna.peran === "rw_admin" ? "rw" : "rt";
    const scopeId = level === "platform" ? null : level === "rw" ? pengguna.rwId : pengguna.rtId;
    if (level !== "platform" && !scopeId) {
      return reply.gagal("UNAUTHORIZED", "Akun belum terikat wilayah kerja.");
    }

    const sesi = await buatSesi({
      subjekId: pengguna.id,
      peran: pengguna.peran as PeranSesi,
      ip: req.ipAsli,
      infoPerangkat: perangkat(req),
    });
    await db().penggunaPengurus.update({
      where: { id: pengguna.id },
      data: { lastLoginAt: new Date() },
    });

    reply.setCookie(NAMA_COOKIE_SESI, sesi.sid, opsiCookieSesi(sesi.maxAgeDetik));
    tanamCookieCsrf(reply, sesi.sid, sesi.maxAgeDetik);

    const portal: PortalAudit = level === "platform" ? "admin" : level === "rw" ? "rw" : "rt";
    // Satu panggilan scope: profil tampilan (nama/jabatan) + audit login.
    const profil = await denganScope(level, scopeId, async (tx) => {
      const p =
        level === "platform" || !scopeId
          ? { nama: "", jabatan: "" }
          : await cariProfilPengurus(tx, level, scopeId, pengguna.email);
      await catatAudit(
        {
          scopeLevel: level,
          scopeId,
          actorId: pengguna.id,
          actorRole: pengguna.peran,
          portal,
          modul: "auth",
          aksi: "login_pengurus",
          aksiBadge: "Berhasil",
          ringkasan: `Login pengurus ${email}`,
          ip: req.ipAsli,
          userAgent: perangkat(req),
        },
        tx,
      );
      return p;
    });

    // `nama` = "Profile login harus sesuai data login" (Okt 2026): header portal
    // kini menampilkan identitas akun ini, bukan nama hardcoded di FE.
    return reply.ok({ peran: pengguna.peran, email: pengguna.email, ...profil });
  });

  // §5.6 — mutasi pengurus wajib cookie `csrf_token` + header `x-csrf-token`
  app.post("/auth/pengurus/logout", { preHandler: verifikasiCsrf }, async (req, reply) => {
    if (req.sesi) {
      await cabutSesi(req.sesi.sid);
      const scopeId = req.pemohon?.id ?? null;
      const level = req.pemohon?.level ?? null;
      if (level && level !== "platform" && scopeId) {
        await denganScope(level, scopeId, (tx) =>
          catatAudit(
            {
              scopeLevel: level,
              scopeId,
              actorId: req.sesi!.subjekId,
              actorRole: req.sesi!.peran,
              portal: level === "rw" ? "rw" : "rt",
              modul: "auth",
              aksi: "logout_pengurus",
              ringkasan: "Sesi ditutup",
              ip: req.ipAsli,
            },
            tx,
          ),
        ).catch(() => undefined);
      }
    }
    reply.clearCookie(NAMA_COOKIE_SESI, { path: "/" });
    reply.clearCookie(NAMA_COOKIE_CSRF, { path: "/" });
    return reply.ok({ keluar: true });
  });

  app.get("/auth/pengurus/sesi", async (req, reply: FastifyReply) => {
    if (!req.sesi || req.sesi.peran === "warga") {
      return reply.gagal("UNAUTHORIZED", "Sesi tidak valid.");
    }
    // Profil tampilan konsisten dengan login (nama dari `pengurus_rt/rw`);
    // `pengguna_pengurus` tanpa RLS aman dibaca tanpa scope, pencarian nama
    // tetap dibatasi scope pemohon (§4.6).
    const level = req.pemohon?.level ?? null;
    const scopeId = req.pemohon?.id ?? null;
    let profil = { nama: "", jabatan: "" };
    if (level && level !== "platform" && scopeId) {
      const akun = await db().penggunaPengurus.findUnique({
        where: { id: req.sesi.subjekId },
        select: { email: true },
      });
      if (akun) {
        profil = await denganScope(level, scopeId, (tx) =>
          cariProfilPengurus(tx, level, scopeId, akun.email),
        );
      }
    }
    return reply.ok({
      peran: req.sesi.peran,
      ...profil,
      sisaDetik: sisaWaktuSesi(req.sesi),
      kedaluwarsaPada: req.sesi.kedaluwarsaPada.toISOString(),
    });
  });
};
