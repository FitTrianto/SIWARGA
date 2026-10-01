/**
 * Sesi HTTP — PRD §5.6, §18.5 (task B3, bagian F-2).
 *
 * Token sesi disimpan TER-HASH (SHA-256) di `sesi_login.token_hash`; token asli
 * hanya hidup di cookie `sid` httpOnly sehingga kebocoran database tidak
 * menghasilkan sesi siap pakai (setara pola hash kata sandi/NIK di B17).
 *
 * Dua batas kedaluwarsa (§5.6):
 *   • absolut — `SESI_ABSOLUT_DETIK` sejak pembuatan;
 *   • idle    — `SESSION_IDLE_DETIK` (default 1800 s) sejak sentuhan terakhir,
 *               divalidasi oleh `sesiKedaluwarsa()` di plugins/auth.ts.
 *
 * Tabel `sesi_login` sengaja TIDAK di-RLS (migrasi 0002): baris dibaca oleh
 * kode route tanpa scope, dan nilainya tidak bocor ke klien (hanya hash).
 */
import { buatTokenAcak, hashToken, sesiKedaluwarsa } from "../plugins/auth.js";
import { db } from "./db.js";
import type { PeranSesi, SesiAktif } from "../types.js";

/** Masa berlaku absolut sesi (durasi idle → `SESSION_IDLE_DETIK`). */
export const SESI_ABSOLUT_DETIK = 12 * 60 * 60;

/** Jeda minimum pembaruan `terakhir_aktif` supaya tidak menulis tiap request. */
const JEDA_SENTUH_DETIK = 60;

export interface SesiBaru {
  sid: string;
  /** Refresh token (§5.0) — disimpan ter-hash, dipakai rute refresh berikutnya. */
  refresh: string;
  kedaluwarsaPada: Date;
  /** `maxAge` cookie `sid` & `csrf_token`. */
  maxAgeDetik: number;
}

export interface BuatSesiInput {
  subjekId: string;
  peran: PeranSesi;
  ip?: string | null;
  infoPerangkat?: string | null;
}

/** Buat sesi baru — token acak 256-bit, hanya hash-nya yang masuk database. */
export async function buatSesi(input: BuatSesiInput): Promise<SesiBaru> {
  const sid = buatTokenAcak();
  const refresh = buatTokenAcak();
  const kedaluwarsaPada = new Date(Date.now() + SESI_ABSOLUT_DETIK * 1000);
  await db().sesiLogin.create({
    data: {
      subjekId: input.subjekId,
      peran: input.peran,
      tokenHash: hashToken(sid),
      refreshHash: hashToken(refresh),
      kedaluwarsaPada,
      infoPerangkat: input.infoPerangkat?.slice(0, 255) ?? null,
      ip: input.ip ?? null,
    },
  });
  return { sid, refresh, kedaluwarsaPada, maxAgeDetik: SESI_ABSOLUT_DETIK };
}

/**
 * Muat sesi dari token cookie `sid`. Mengembalikan null bila token tidak dikenal,
 * sudah dicabut, kedaluwarsa absolut, atau idle melebihi batas.
 * Sentuhan `terakhir_aktif` ditulis paling cepat tiap 60 detik.
 */
export async function muatSesi(sid: string): Promise<SesiAktif | null> {
  if (!sid) return null;
  const tokenHash = hashToken(sid);
  const baris = await db().sesiLogin.findUnique({ where: { tokenHash } });
  if (!baris || baris.dicabutPada) return null;

  const sesi: SesiAktif = {
    sid,
    subjekId: baris.subjekId,
    peran: baris.peran,
    kedaluwarsaPada: baris.kedaluwarsaPada,
    terakhirAktif: baris.terakhirAktif,
  };
  if (sesiKedaluwarsa(sesi)) return null;

  const kini = new Date();
  if (kini.getTime() - baris.terakhirAktif.getTime() > JEDA_SENTUH_DETIK * 1000) {
    // Best effort: sesi tetap sah walau pembaruan ini gagal.
    await db().sesiLogin
      .update({ where: { tokenHash }, data: { terakhirAktif: kini } })
      .catch(() => undefined);
  }
  return sesi;
}

/** Cabut satu sesi (logout). Idempoten — token tak dikenal tetap dianggap keluar. */
export async function cabutSesi(sid: string): Promise<void> {
  if (!sid) return;
  await db().sesiLogin
    .updateMany({
      where: { tokenHash: hashToken(sid), dicabutPada: null },
      data: { dicabutPada: new Date() },
    })
    .catch(() => undefined);
}

/** Cabut SELURUH sesi milik satu subjek (penonaktifan akses, task B5). */
export async function cabutSesiSubjek(subjekId: string, peran: PeranSesi): Promise<number> {
  const hasil = await db().sesiLogin
    .updateMany({ where: { subjekId, peran, dicabutPada: null }, data: { dicabutPada: new Date() } })
    .catch(() => ({ count: 0 }));
  return hasil.count;
}

/** Sisa waktu sesi dalam detik (untuk `GET /auth/.../sesi`, §5.1/§5.2). */
export function sisaWaktuSesi(sesi: Pick<SesiAktif, "kedaluwarsaPada">): number {
  return Math.max(0, Math.round((sesi.kedaluwarsaPada.getTime() - Date.now()) / 1000));
}
