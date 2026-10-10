/**
 * Auth warga — PRD §5.1, §5.5, §5.6 (task B1–B3, prasyarat F-3).
 *
 *   POST /auth/warga/login   { noHp, password } → cookie `sid` (+ `csrf_token`)
 *   POST /auth/warga/logout                     → cabut sesi + buang cookie
 *   GET  /auth/warga/sesi                       → profil ringkas + sisa waktu
 *   GET  /auth/warga/riwayat-login              → 20 sesi terbaru (task B3)
 *
 * KEBIJAKAN (keputusan pemilik produk, Fase 3): login Portal Warga memakai
 * KATA SANDI (min 8 karakter), BUKAN PIN 6-digit seperti di PRD v2.4 §5.5 —
 * PIN dinilai terlalu lemah untuk autentikasi harian. Aturan §4.3/§14.1 tetap:
 *
 * Aturan §4.3/§14.1 yang ditegakkan di sini:
 *   • kata sandi di-hash argon2id (`kredensial_warga.password_hash`), tidak pernah plaintext;
 *   • 3x salah → kunci 15 menit → respons `ACCOUNT_LOCKED` (423);
 *   • pesan gagal SELALU sama untuk "no. HP tidak dikenal" dan "kata sandi salah"
 *     (anti-enumerasi), dan verifikasi hash tetap dijalankan untuk keduanya;
 *   • `status_akses != aktif` → `TOKEN_INVALID` (§5.1) — akun belum aktif/dicabut;
 *   • saat `status_akses` berubah di tengah sesi, hook sesi membuang cookie (B5).
 */
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";
import { catatAudit } from "../plugins/audit.js";
import { NAMA_COOKIE_CSRF, NAMA_COOKIE_SESI, buatTokenAcak, hashToken, opsiCookieSesi } from "../plugins/auth.js";
import { tanamCookieCsrf } from "../plugins/csrf.js";
import { wajibWarga } from "../plugins/guard.js";
import { batasAuth } from "../plugins/ratelimit.js";
import { db, denganScope } from "../services/db.js";
import { cariScopeWarga, cariWargaUntukLogin, normalisasiNoHp } from "../services/identitasWarga.js";
import {
  PANJANG_KATA_SANDI_MAX,
  PANJANG_KATA_SANDI_MIN,
  formatKataSandiValid,
  hashKataSandi,
  terapkanHasilPercobaan,
  terkunci,
  verifikasiKataSandi,
} from "../services/kredensial.js";
import { buatSesi, cabutSesi, sisaWaktuSesi } from "../services/sesi.js";

const skemaLogin = z.object({
  noHp: z.string().trim().min(8).max(20),
  // Kebijakan Fase 3: kata sandi, bukan PIN 6-digit (NIST SP 800-63B: panjang
  // minimal + tolak kata sandi umum; tanpa aturan komposisi paksa).
  password: z
    .string()
    .max(PANJANG_KATA_SANDI_MAX, `Kata sandi maksimal ${PANJANG_KATA_SANDI_MAX} karakter.`)
    .refine(formatKataSandiValid, {
      message: `Kata sandi minimal ${PANJANG_KATA_SANDI_MIN} karakter dan bukan kata sandi yang sangat umum.`,
    }),
});

/** Pesan kegagalan tunggal — tidak membedakan "tak ada akun" vs "kata sandi salah". */
const PESAN_GAGAL = "No. HP atau kata sandi salah.";

let hashPembungkus: string | null = null;
async function ambilHashPembungkus(): Promise<string> {
  hashPembungkus ??= await hashKataSandi(buatTokenAcak(16));
  return hashPembungkus;
}

function perangkat(req: FastifyRequest): string | null {
  const ua = req.headers["user-agent"];
  return (Array.isArray(ua) ? ua[0] : ua) ?? null;
}

export const ruteAuthWarga: FastifyPluginAsync = async (app) => {
  app.post("/auth/warga/login", { config: batasAuth }, async (req, reply) => {
    const hasil = skemaLogin.safeParse(req.body);
    if (!hasil.success) {
      return reply.gagal(
        "VALIDATION",
        `No. HP dan kata sandi wajib diisi (kata sandi min. ${PANJANG_KATA_SANDI_MIN} karakter).`,
      );
    }
    const { password } = hasil.data;
    if (!formatKataSandiValid(password)) {
      return reply.gagal("VALIDATION", `Kata sandi minimal ${PANJANG_KATA_SANDI_MIN} karakter.`);
    }

    const warga = await cariWargaUntukLogin(normalisasiNoHp(hasil.data.noHp));
    if (!warga) {
      // Jalankan verifikasi tetap agar waktu respons sama dengan kata sandi salah.
      await verifikasiKataSandi(await ambilHashPembungkus(), password);
      return reply.gagal("UNAUTHORIZED", PESAN_GAGAL);
    }
    if (warga.statusAkses !== "aktif") {
      return reply.gagal("TOKEN_INVALID", "Akses portal belum aktif — hubungi Pengurus RT.");
    }
    if (!warga.isActive) return reply.gagal("UNAUTHORIZED", PESAN_GAGAL);

    const kredensial = await db().kredensialWarga.findUnique({ where: { wargaId: warga.id } });
    if (!kredensial) {
      await verifikasiKataSandi(await ambilHashPembungkus(), password);
      return reply.gagal("UNAUTHORIZED", PESAN_GAGAL);
    }

    const kini = new Date();
    if (terkunci(kredensial, kini)) {
      const sisaMenit = Math.max(1, Math.ceil((kredensial.dikunciSampai!.getTime() - kini.getTime()) / 60_000));
      return reply.gagal(
        "ACCOUNT_LOCKED",
        `Terlalu banyak percobaan gagal — coba lagi dalam ${sisaMenit} menit.`,
      );
    }

    const cocok = await verifikasiKataSandi(kredensial.passwordHash, password);
    if (!cocok) {
      const status = terapkanHasilPercobaan(
        { gagalBerturut: kredensial.gagalBerturut, dikunciSampai: kredensial.dikunciSampai },
        "salah",
        kini,
      );
      await db().kredensialWarga.update({
        where: { wargaId: warga.id },
        data: { gagalBerturut: status.gagalBerturut, dikunciSampai: status.dikunciSampai },
      });
      return reply.gagal("UNAUTHORIZED", PESAN_GAGAL);
    }

    if (kredensial.gagalBerturut !== 0 || kredensial.dikunciSampai) {
      await db().kredensialWarga.update({
        where: { wargaId: warga.id },
        data: { gagalBerturut: 0, dikunciSampai: null },
      });
    }

    const sesi = await buatSesi({
      subjekId: warga.id,
      peran: "warga",
      ip: req.ipAsli,
      infoPerangkat: perangkat(req),
    });
    reply.setCookie(NAMA_COOKIE_SESI, sesi.sid, opsiCookieSesi(sesi.maxAgeDetik));
    tanamCookieCsrf(reply, sesi.sid, sesi.maxAgeDetik);

    await denganScope("rt", warga.rtId, (tx) =>
      catatAudit(
        {
          scopeLevel: "rt",
          scopeId: warga.rtId,
          actorId: warga.id,
          actorRole: "warga",
          portal: "warga",
          modul: "auth",
          aksi: "login_warga",
          aksiBadge: "Berhasil",
          ringkasan: `Login warga ${warga.nama}`,
          ip: req.ipAsli,
          userAgent: perangkat(req),
        },
        tx,
      ),
    );

    return reply.ok({ peran: "warga" as const, nama: warga.nama });
  });

  app.post("/auth/warga/logout", async (req, reply) => {
    if (req.sesi) {
      await cabutSesi(req.sesi.sid);
      const scopeId = req.pemohon?.id ?? null;
      if (req.sesi.peran === "warga" && scopeId) {
        await denganScope("rt", scopeId, (tx) =>
          catatAudit(
            {
              scopeLevel: "rt",
              scopeId,
              actorId: req.sesi!.subjekId,
              actorRole: "warga",
              portal: "warga",
              modul: "auth",
              aksi: "logout_warga",
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

  app.get("/auth/warga/sesi", async (req, reply) => {
    if (!req.sesi || req.sesi.peran !== "warga") {
      return reply.gagal("UNAUTHORIZED", "Sesi tidak valid.");
    }
    const warga = await cariScopeWarga(req.sesi.subjekId);
    if (!warga) return reply.gagal("UNAUTHORIZED", "Sesi tidak valid.");
    // Batch 18 · multi-tenant tampilan — identitas RT pemilik data warga
    // (bukan konstanta FE hardcode). `kota` hanya tercatat pada pendaftaran
    // mandiri (deviasi desain DB) → null untuk RT seed (FE menampilkan "—").
    const rt = await denganScope("rt", warga.rtId, (tx) =>
      tx.rt.findUnique({
        where: { id: warga.rtId },
        select: {
          kodeRt: true,
          // Nama ketua — penandatangan blok TTD surat di Portal Warga.
          ketuaRt: { select: { nama: true } },
          // Batch 19 · bendahara tercatat — tampilan nama asli di halaman
          // iuran warga (tanpa baris → FE memakai label umum, bukan nama contoh).
          pengurusList: {
            where: { jabatan: "bendahara" },
            select: { nama: true },
            orderBy: { createdAt: "asc" },
            take: 1,
          },
          rw: { select: { kodeRw: true } },
          kelurahan: {
            select: { nama: true, kecamatan: { select: { nama: true } } },
          },
          pendaftaran: { select: { kota: true } },
        },
      }),
    );
    return reply.ok({
      peran: "warga" as const,
      nama: warga.nama,
      sisaDetik: sisaWaktuSesi(req.sesi),
      kedaluwarsaPada: req.sesi.kedaluwarsaPada.toISOString(),
      rt: rt
        ? {
            kodeRt: rt.kodeRt,
            kodeRw: rt.rw.kodeRw,
            kelurahan: rt.kelurahan.nama,
            kecamatan: rt.kelurahan.kecamatan.nama,
            kota: rt.pendaftaran?.kota ?? null,
            namaKetuaRt: rt.ketuaRt?.nama ?? null,
            namaBendaharaRt: rt.pengurusList[0]?.nama ?? null,
          }
        : null,
    });
  });

  /**
   * Riwayat login (task B3, §5.6) — 20 sesi TERBARU milik warga peminta,
   * terbaru dulu, sesi yang dipakai request ini ditandai `sesiIni: true`.
   *
   * Sumber kebenaran = tabel `sesi_login` (tanpa RLS; kolom token hanya
   * berupa SHA-256 sehingga tak ada token siap pakai yang ikut terbaca).
   * Baris dicari lewat `subjekId + peran` HASIL SESI — bukan input klien —
   * sehingga riwayat warga lain tidak mungkin ikut terbawa; `UNAUTHORIZED`
   * (tanpa sesi / bukan warga) ditolak guard `wajibWarga`.
   *
   * Kebijakan batas waktu: FE memakai idle 30 menit — sama dengan default
   * `SESSION_IDLE_DETIK` (1800 s) server; server tetap sumber kebenaran
   * (respons `sisaDetik`/`kedaluwarsaPada` dari `GET /auth/warga/sesi`).
   */
  app.get("/auth/warga/riwayat-login", async (req, reply) => {
    const { sesi, wargaId } = wajibWarga(req);
    const hashSesiIni = hashToken(sesi.sid);

    const baris = await db().sesiLogin.findMany({
      where: { subjekId: wargaId, peran: "warga" },
      orderBy: [{ terakhirAktif: "desc" }],
      take: 20,
      select: {
        tokenHash: true,
        dibuatPada: true,
        terakhirAktif: true,
        kedaluwarsaPada: true,
        infoPerangkat: true,
        ip: true,
        kota: true,
        dicabutPada: true,
      },
    });

    return reply.ok({
      daftar: baris.map((b) => ({
        // kapan sesi TERAKHIR dipakai — dipakai FE sebagai "waktu login".
        waktu: b.terakhirAktif.toISOString(),
        masukPada: b.dibuatPada.toISOString(),
        berlakuSampai: b.kedaluwarsaPada.toISOString(),
        perangkat: b.infoPerangkat,
        ip: b.ip,
        kota: b.kota,
        sesiIni: b.tokenHash === hashSesiIni,
        dicabut: b.dicabutPada !== null,
      })),
    });
  });
};
