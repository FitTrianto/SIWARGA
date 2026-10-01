/**
 * Autentikasi — PRD §5.5, §5.6, §14.1 (task B1–B3).
 *
 * F-1 menyiapkan primitif yang dipakai route auth (F-2):
 *   • token acak + SHA-256 untuk disimpan di `sesi_login.token_hash`
 *   • verifikasi kedaluwarsa & idle timeout sesi (§5.6)
 *   • plugin yang mendekorasi `request.sesi` (null sampai F-2 memasangnya)
 *
 * Cookie sesi memakai skema `sid` httpOnly + `Secure` di production (§5.6).
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { db } from "../services/db.js";
import { cariScopeWarga } from "../services/identitasWarga.js";
import { cabutSesi, muatSesi } from "../services/sesi.js";
import type { SesiAktif } from "../types.js";

export const NAMA_COOKIE_SESI = "sid";
export const NAMA_COOKIE_CSRF = "csrf_token";

/** Token acak 32 byte (256 bit) dalam base64url. */
export function buatTokenAcak(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Nilai yang disimpan ke DB — token asli TIDAK PERNAH ditulis ke `sesi_login`. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Perbandingan timing-safe dua string hex/base64. */
export function tokenSama(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * Sesi kedaluwarsa bila: (1) lewat `kedaluwarsa_pada`, ATAU (2) idle lebih lama
 * dari `SESSION_IDLE_DETIK` (§5.6 — auto-logout, task B3).
 */
export function sesiKedaluwarsa(
  sesi: Pick<SesiAktif, "kedaluwarsaPada"> & { terakhirAktif?: Date },
  now: Date = new Date(),
  idleDetik: number = config.sessionIdleDetik,
): boolean {
  if (sesi.kedaluwarsaPada.getTime() <= now.getTime()) return true;
  if (sesi.terakhirAktif) {
    const idleMs = now.getTime() - sesi.terakhirAktif.getTime();
    if (idleMs > idleDetik * 1000) return true;
  }
  return false;
}

/** Opsi cookie standar untuk sesi & CSRF (§5.6). */
export function opsiCookieSesi(maxAgeDetik: number) {
  return {
    httpOnly: true,
    secure: config.isProduksi,
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeDetik,
  };
}

/**
 * Pasang sesi ke instance — DIPANGGIL LANGSUNG dari `buatAplikasi()`.
 *
 * Sengaja bukan `app.register()`: tanpa `fastify-plugin`, register membuat
 * konteks terenkapsulasi sehingga hook & dekorator ini tidak akan pernah
 * dilihat route yang didaftarkan di instance induk (silencously gagal — sesi
 * selalu null). Pemanggilan langsung menempelkan `request.sesi` /
 * `request.pemohon` ke seluruh route.
 */
export async function pasangAuth(app: FastifyInstance): Promise<void> {
  // `request.pemohon` didekorasi oleh `pasangScope()` — jangan diduplikasi
  // (Fastify menolak dekorator ganda pada instance yang sama).
  app.decorateRequest("sesi", null);
  app.decorateRequest("ipAsli", "");
  /**
   * Verifikasi cookie `sid` → `request.sesi` → `request.pemohon` (§5.6).
   *
   * Berjalan di `onRequest` (paling awal) sehingga seluruh route & hook
   * sesudahnya — termasuk guard CSRF — sudah melihat sesi yang benar. Tanpa
   * cookie tidak ada query sama sekali; bila database tak tersedia, sesi
   * dianggap tidak ada (gagal-aman) TANPA membuang cookie, karena itu bisa
   * jadi gangguan sementara.
   *
   * Urutan hook penting: `@fastify/cookie` harus sudah memasang parser cookie
   * lebih dahulu (didaftarkan & di-await sebelum fungsi ini dipanggil).
   */
  app.addHook("onRequest", async (req, reply) => {
    req.ipAsli = req.ip;
    const sid = req.cookies?.[NAMA_COOKIE_SESI];
    if (!sid) return;
    try {
      const sesi = await muatSesi(sid);
      if (!sesi) {
        buangCookieSesi(reply);
        return;
      }
      const pemohon = await resolusiPemohon(sesi);
      if (!pemohon) {
        // Akses dicabut / akun dinonaktifkan → sesi langsung hangus (B5).
        await cabutSesi(sid);
        buangCookieSesi(reply);
        return;
      }
      req.sesi = sesi;
      req.pemohon = pemohon;
    } catch {
      req.sesi = null;
      req.pemohon = null;
    }
  });
}

/** Buang cookie sesi + CSRF (dipanggil saat sesi tidak lagi sah). */
function buangCookieSesi(reply: { clearCookie: (name: string, opts: object) => unknown }): void {
  reply.clearCookie(NAMA_COOKIE_SESI, { path: "/" });
  reply.clearCookie(NAMA_COOKIE_CSRF, { path: "/" });
}

/**
 * Terjemahkan sesi → scope pemohon (§4.6) dengan verifikasi status akun:
 *   • warga        → `warga.rt_id` lewat jalur `auth` + syarat `status_akses = aktif`;
 *   • rt/rw/admin  → `pengguna_pengurus` (tabel tanpa RLS) + syarat `status = active`.
 * Null = akun tidak sah → sesi dibuang oleh hook di atas.
 */
async function resolusiPemohon(sesi: SesiAktif): Promise<{ level: "rt" | "rw" | "platform"; id: string | null } | null> {
  if (sesi.peran === "warga") {
    const warga = await cariScopeWarga(sesi.subjekId);
    if (!warga || !warga.isActive || warga.statusAkses !== "aktif") return null;
    return { level: "rt", id: warga.rtId };
  }
  const pengguna = await db().penggunaPengurus.findUnique({ where: { id: sesi.subjekId } });
  if (!pengguna || pengguna.status !== "active") return null;
  if (pengguna.peran === "super_admin") return { level: "platform", id: null };
  if (pengguna.peran === "rw_admin") return pengguna.rwId ? { level: "rw", id: pengguna.rwId } : null;
  return pengguna.rtId ? { level: "rt", id: pengguna.rtId } : null;
}

/**
 * Bangun objek pemohon dari sesi (dipakai F-2 setelah login berhasil).
 * `scopeId` = rt_id / rw_id yang harus diambil dari profil pengguna.
 */
export function pemohonDariSesi(sesi: SesiAktif, scopeId: string | null): {
  level: "rt" | "rw" | "platform";
  id: string | null;
} {
  if (sesi.peran === "super_admin") return { level: "platform", id: null };
  if (sesi.peran === "rw_admin") return { level: "rw", id: scopeId };
  return { level: "rt", id: scopeId };
}
