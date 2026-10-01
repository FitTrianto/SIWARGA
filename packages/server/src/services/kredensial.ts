/**
 * Kata sandi & kredensial (pengurus + warga) — PRD §5.6, §14, §18.5 (B17, B3).
 *
 * • Kata sandi di-HASH dengan argon2id (OWASP: m=19456 KiB, t=2, p=1) — TIDAK
 *   pernah disimpan plaintext maupun dienkripsi, sehingga tidak bisa "dilihat
 *   kembali" bahkan oleh SUPER_ADMIN.
 * • Logika penguncian (3x salah → kunci 15 menit) ditulis sebagai fungsi murni
 *   sehingga dapat diuji tanpa database (task B18).
 *
 * PERUBAHAN KEBIJAKAN (keputusan pemilik produk, Fase 3):
 *   Login Portal Warga memakai KATA SANDI (min 8 karakter), bukan PIN 6-digit —
 *   6 digit ≈ 20 bit entropi terlalu lemah untuk autentikasi harian. Kebijakan
 *   panjang mengikuti NIST SP 800-63B: panjang minimal 8 + penolakan kata sandi
 *   paling umum, TANPA aturan komposisi paksa (huruf besar/angka/simbol) yang
 *   justru menurunkan kekuatan kata sandi buatan pengguna.
 *   Migrasi kolom `kredensial_warga.pin_hash` → `password_hash` menyertainya.
 */
import { hash, verify } from "@node-rs/argon2";
import { config } from "../config.js";

/** Parameter argon2id — sengaja mengikuti rekomendasi OWASP. */
export const OPSI_ARGON2 = {
  memoryCost: 19_456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} as const;

export const PANJANG_KATA_SANDI_MIN = 8;
export const PANJANG_KATA_SANDI_MAX = 200;

/**
 * Kata sandi paling umum (NIST SP 800-63B §5.1.1.2 — tolak yang mudah ditebak).
 * Dibandingkan case-insensitive setelah trim.
 */
const SANGAT_UMUM = new Set([
  "12345678",
  "123456789",
  "1234567890",
  "password",
  "password1",
  "qwerty123",
  "admin123",
  "iloveyou",
  "letmein",
]);

export class KredensialError extends Error {
  override readonly name = "KredensialError";
  constructor(
    message: string,
    readonly kode: "FORMAT_SALAH" | "TIDAK_COKOK",
  ) {
    super(message);
  }
}

/**
 * Validasi format kata sandi: panjang wajib 8–200 dan bukan kata sandi umum.
 * Dipakai bersama oleh validasi rute (zod `.refine`) dan `hashKataSandi`.
 */
export function formatKataSandiValid(kataSandi: string): boolean {
  const nilai = kataSandi.trim();
  if (nilai.length < PANJANG_KATA_SANDI_MIN || nilai.length > PANJANG_KATA_SANDI_MAX) return false;
  return !SANGAT_UMUM.has(nilai.toLowerCase());
}

export async function hashKataSandi(kataSandi: string): Promise<string> {
  if (!formatKataSandiValid(kataSandi)) {
    throw new KredensialError(
      `Kata sandi minimal ${PANJANG_KATA_SANDI_MIN} karakter dan tidak boleh termasuk kata sandi yang sangat umum.`,
      "FORMAT_SALAH",
    );
  }
  return hash(kataSandi, { ...OPSI_ARGON2 });
}

/**
 * Verifikasi kata sandi terhadap hash tersimpan.
 * Selalu menghitung penuh (tanpa return cepat) agar waktu respons tidak
 * membocorkan "cocok/tidak" sebelum hash diverifikasi.
 */
export async function verifikasiKataSandi(kunciHash: string, kataSandi: string): Promise<boolean> {
  if (kataSandi.length < PANJANG_KATA_SANDI_MIN) return false;
  try {
    return await verify(kunciHash, kataSandi, { ...OPSI_ARGON2 });
  } catch {
    // Hash korup/format tak dikenal → anggap gagal, jangan leak detail.
    return false;
  }
}

/** Potongan status kredensial yang relevan dengan penguncian (§4.3). */
export interface StatusKunci {
  gagalBerturut: number;
  dikunciSampai: Date | null;
}

export function terkunci(status: StatusKunci, now: Date): boolean {
  return status.dikunciSampai !== null && status.dikunciSampai.getTime() > now.getTime();
}

/**
 * Terapkan hasil verifikasi pada status kredensial (murni, tanpa I/O).
 *
 * Aturan §4.3:
 *   • salah     → gagal_berturut + 1
 *   • gagal ≥ 3 → dikunci_sampai = now + 15 menit
 *   • benar     → semua penghitung direset
 *   • saat masih terkunci → status tidak berubah sama sekali (dicegah di pemanggil)
 */
export function terapkanHasilPercobaan(
  status: StatusKunci,
  hasil: "benar" | "salah",
  now: Date,
  opsi: { maksGagal: number; lockoutMenit: number } = {
    maksGagal: config.loginMaksGagal,
    lockoutMenit: config.loginLockoutMenit,
  },
): StatusKunci {
  if (hasil === "benar") {
    return { gagalBerturut: 0, dikunciSampai: null };
  }
  const gagal = status.gagalBerturut + 1;
  if (gagal >= opsi.maksGagal) {
    const sampai = new Date(now.getTime() + opsi.lockoutMenit * 60_000);
    return { gagalBerturut: gagal, dikunciSampai: sampai };
  }
  return { gagalBerturut: gagal, dikunciSampai: status.dikunciSampai };
}

/** Reset penuh status kuncian — dipakai ketika akun dibuka kembali oleh RT. */
export function bukaKunci(): StatusKunci {
  return { gagalBerturut: 0, dikunciSampai: null };
}
