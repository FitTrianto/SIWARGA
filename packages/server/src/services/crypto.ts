/**
 * Kripto data sensitif — PRD §14 / task B17.
 *
 * Dua aturan yang tidak boleh dilanggar:
 *   1. NIK TIDAK PERNAH disimpan plaintext. Kolom DB hanya menerima
 *      `nik_encrypted` (AES-256-GCM) + `nik_masked` (untuk tampilan).
 *   2. PIN/kata sandi di-HASH (argon2id), bukan dienkripsi — lihat kredensial.ts.
 *
 * Format penyimpanan `nik_encrypted` (bytea):
 *   [versi:1][iv:12][authTag:16][cipher:...]
 * Prefiks acak 8 byte disertakan di plaintext agar dua NIK sama tidak pernah
 * menghasilkan ciphertext identik (mencegah pengenalan pola lewat perbandingan).
 */
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";

const VERSI_NIK = 1;
const PANJANG_IV = 12;
const PANJANG_TAG = 16;
const PANJANG_NIK = 16;

export class KriptoError extends Error {
  override readonly name = "KriptoError";
}

/** NIK = tepat 16 digit angka. */
export function formatNikValid(nik: string): boolean {
  return new RegExp(`^\\d{${PANJANG_NIK}}$`).test(nik);
}

/**
 * Deteksi apakah sebuah nilai sudah ter-masking (tidak lagi memuat 16 digit penuh).
 * Dipakai sebagai pengaman ganda: nilai yang sudah pernah di-mask tidak boleh
 * diproses ulang seolah-olah itu NIK asli.
 */
export function sudahTerMask(s: string): boolean {
  return /x/i.test(s) || (s.replace(/\D/g, "").length < PANJANG_NIK);
}

/**
 * Masking tampilan `3171-xxxx-xxxx-0002` — 4 digit pertama & terakhir terlihat.
 * Nilai yang sudah mengandung karakter `x` akan ditolak agar tidak pernah
 * "mask dua kali" menjadi data rusak.
 */
export function maskNik(nik: string): string {
  if (/x/i.test(nik)) {
    // Pengaman: nilai yang sudah pernah di-mask tidak boleh diproses ulang
    // (mask dua kali akan menghasilkan data rusak yang lolos validasi).
    throw new KriptoError("Nilai sudah ter-masking — memanggil maskNik dua kali.");
  }
  const digit = nik.replace(/\D/g, "");
  if (digit.length < 8) {
    throw new KriptoError(`NIK terlalu pendek untuk di-mask: ${nik}`);
  }
  return `${digit.slice(0, 4)}-xxxx-xxxx-${digit.slice(-4)}`;
}

/**
 * Masking generik untuk No. KK / nomor dokumen lain dengan pola sama.
 * No. KK BOLEH sama antar-warga (keputusan desain) — yang dijaga unik adalah NIK.
 */
export function maskNoDokumen(nilai: string): string {
  return maskNik(nilai);
}

/** Enkripsi NIK dengan AES-256-GCM. `key` harus 32 byte. */
export function enkripsiNik(nik: string, key: Buffer): Buffer {
  if (key.length !== 32) throw new KriptoError("Kunci AES-256 harus 32 byte.");
  if (!formatNikValid(nik)) {
    throw new KriptoError(`NIK tidak valid (harus 16 digit): ${nik}`);
  }
  const iv = randomBytes(PANJANG_IV);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const acak = randomBytes(8);
  const plaintext = Buffer.concat([acak, Buffer.from(nik, "utf8")]);
  const cipherText = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([VERSI_NIK]), iv, tag, cipherText]);
}

/** Dekripsi NIK; melempar `KriptoError` bila kunci salah atau data dimanipulasi. */
export function dekripsiNik(data: Uint8Array, key: Buffer): string {
  if (key.length !== 32) throw new KriptoError("Kunci AES-256 harus 32 byte.");
  if (data.length < 1 + PANJANG_IV + PANJANG_TAG + 1) {
    throw new KriptoError("Ciphertext NIK terlalu pendek / rusak.");
  }
  const versi = data[0];
  if (versi !== VERSI_NIK) {
    throw new KriptoError(`Versi ciphertext tidak didukung: ${versi}`);
  }
  const iv = data.subarray(1, 1 + PANJANG_IV);
  const tag = data.subarray(1 + PANJANG_IV, 1 + PANJANG_IV + PANJANG_TAG);
  const cipherText = data.subarray(1 + PANJANG_IV + PANJANG_TAG);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  try {
    const plaintext = Buffer.concat([decipher.update(cipherText), decipher.final()]);
    const nik = plaintext.subarray(8).toString("utf8");
    if (!formatNikValid(nik)) throw new KriptoError("Hasil dekripsi bukan 16 digit.");
    return nik;
  } catch (err) {
    if (err instanceof KriptoError) throw err;
    throw new KriptoError("Dekripsi gagal — kunci salah atau data dimanipulasi (GCM auth tag).");
  }
}

/**
 * Satu pintu: NIK plaintext → pasangan kolom yang aman disimpan.
 *
 * `nikEncrypted` harus `Uint8Array<ArrayBuffer>` (bukan `Buffer`, dan bukan
 * `Uint8Array` yang menyimpulkan `ArrayBufferLike`) agar cocok dengan tipe
 * input kolom `Bytes` Prisma 7. Anotasi tipe sengaja ditiadakan agar TypeScript
 * menurunkannya dari `new Uint8Array(...)`, yang menghasilkan `ArrayBuffer`.
 */
export function sembunyikanNik(nik: string, key: Buffer) {
  return {
    nikEncrypted: new Uint8Array(enkripsiNik(nik, key)),
    nikMasked: maskNik(nik),
  };
}

/**
 * Perbandingan rahasia (timing-safe) dua `nik_encrypted`.
 *
 * Keduanya didekripsi dulu dengan `key` lalu dibandingkan tanpa membocorkan
 * isi lewat waktu. PENTING: byte mentah tidak pernah bisa dipakai di sini —
 * setiap enkripsi memakai IV acak, sehingga dua ciphertext NIK yang sama
 * selalu berbeda byte-nya (lihat catatan format penyimpanan di atas).
 *
 * Pemakaian: mencocokkan NIK pengajuan surat terhadap NIK tersimpan.
 */
export function nikSama(a: Uint8Array, b: Uint8Array, key: Buffer): boolean {
  const n1 = dekripsiNik(a, key);
  const n2 = dekripsiNik(b, key);
  // keduanya sudah divalidasi 16 digit oleh dekripsiNik → panjang sama
  return timingSafeEqual(Buffer.from(n1, "utf8"), Buffer.from(n2, "utf8"));
}
