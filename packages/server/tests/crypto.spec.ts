/**
 * B17/B18 — Kripto data sensitif (PRD §14).
 *
 * Dua aturan mutlak:
 *   1. NIK TIDAK PERNAH tersimpan plaintext.
 *   2. Masking idempoten-salah: nilai yang sudah ter-masking tidak boleh
 *      diproses ulang (mask dua kali = data rusak yang lolos validasi).
 */
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  KriptoError,
  dekripsiNik,
  enkripsiNik,
  formatNikValid,
  maskNik,
  maskNoDokumen,
  nikSama,
  sembunyikanNik,
  sudahTerMask,
} from "../src/services/crypto.js";

const KUNCI = randomBytes(32);
const NIK = "3171051405720001";

describe("format NIK", () => {
  it("hanya menerima tepat 16 digit", () => {
    expect(formatNikValid(NIK)).toBe(true);
    expect(formatNikValid("317105140572000")).toBe(false); // 15 digit
    expect(formatNikValid(`${NIK}1`)).toBe(false); // 17 digit
    expect(formatNikValid("3171-0514-0572-0001")).toBe(false); // ada strip
    expect(formatNikValid("317105140572000a")).toBe(false); // huruf
    expect(formatNikValid("")).toBe(false);
  });

  it("mendeteksi nilai yang sudah ter-masking", () => {
    expect(sudahTerMask("3171-xxxx-xxxx-0001")).toBe(true);
    expect(sudahTerMask(NIK)).toBe(false);
    expect(formatNikValid("3171-xxxx-xxxx-0001")).toBe(false); // tidak lolos format
  });
});

describe("maskNik", () => {
  it("menyamarkan tengah dan menyisakan 4 digit pertama/terakhir", () => {
    expect(maskNik(NIK)).toBe("3171-xxxx-xxxx-0001");
    expect(maskNik("3171050101050988")).toBe("3171-xxxx-xxxx-0988");
  });

  it("menolak mem-mask nilai yang sudah ter-masking", () => {
    try {
      maskNik("3171-xxxx-xxxx-0001");
      throw new Error("seharusnya melempar");
    } catch (err) {
      expect(err).toBeInstanceOf(KriptoError);
      expect((err as KriptoError).message).toMatch(/dua kali/);
    }
    expect(() => maskNik("3171xxxx0001")).toThrow(KriptoError);
  });

  it("menolak nilai terlalu pendek", () => {
    expect(() => maskNik("1234")).toThrow(KriptoError);
  });

  it("maskNoDokumen memakai pola yang sama (No. KK)", () => {
    expect(maskNoDokumen("3171050101050988")).toBe("3171-xxxx-xxxx-0988");
  });
});

describe("enkripsi/dekripsi NIK", () => {
  it("round-trip mengembalikan NIK asli", () => {
    const cipher = enkripsiNik(NIK, KUNCI);
    expect(dekripsiNik(cipher, KUNCI)).toBe(NIK);
  });

  it("tidak pernah menyimpan plaintext di ciphertext", () => {
    const cipher = enkripsiNik(NIK, KUNCI);
    expect(cipher.includes(Buffer.from(NIK, "utf8"))).toBe(false);
    expect(cipher.includes(Buffer.from(NIK, "ascii"))).toBe(false);
  });

  it("prefix acak + IV membuat ciphertext NIK sama berbeda tiap kali", () => {
    const a = enkripsiNik(NIK, KUNCI);
    const b = enkripsiNik(NIK, KUNCI);
    expect(a.equals(b)).toBe(false);
    // [versi:1][iv:12][tag:16][acak:8][nik:16]
    expect(a.length).toBe(1 + 12 + 16 + 8 + 16);
    expect(a[0]).toBe(1); // versi
  });

  it("menolak kunci yang bukan 32 byte", () => {
    expect(() => enkripsiNik(NIK, randomBytes(16))).toThrow(/32 byte/);
    expect(() => dekripsiNik(enkripsiNik(NIK, KUNCI), randomBytes(33))).toThrow(/32 byte/);
  });

  it("menolak NIK yang tidak 16 digit", () => {
    expect(() => enkripsiNik("bukan-nik", KUNCI)).toThrow(KriptoError);
  });

  it("kunci salah → gagal (GCM auth tag)", () => {
    const cipher = enkripsiNik(NIK, KUNCI);
    expect(() => dekripsiNik(cipher, randomBytes(32))).toThrow(KriptoError);
  });

  it("data dimanipulasi → gagal, tidak pernah mengembalikan NIK rusak", () => {
    const cipher = Buffer.from(enkripsiNik(NIK, KUNCI));
    cipher[cipher.length - 1] ^= 0xff; // ubah satu byte payload
    expect(() => dekripsiNik(cipher, KUNCI)).toThrow(KriptoError);

    const ivUsang = Buffer.from(enkripsiNik(NIK, KUNCI));
    ivUsang[1] ^= 0xff; // ubah satu byte IV
    expect(() => dekripsiNik(ivUsang, KUNCI)).toThrow(KriptoError);
  });

  it("ciphertext terlalu pendek ditolak sebelum diproses", () => {
    expect(() => dekripsiNik(Buffer.alloc(4), KUNCI)).toThrow(/terlalu pendek/);
  });
});

describe("sembunyikanNik — satu pintu penyimpanan", () => {
  it("menghasilkan pasangan ter-encrypt + ter-mask yang konsisten", () => {
    const { nikEncrypted, nikMasked } = sembunyikanNik(NIK, KUNCI);

    expect(nikEncrypted).toBeInstanceOf(Uint8Array);
    expect(nikMasked).toBe("3171-xxxx-xxxx-0001");
    expect(formatNikValid(nikMasked)).toBe(false);
    // dapat dibaca kembali dengan kunci yang sama
    expect(dekripsiNik(nikEncrypted, KUNCI)).toBe(NIK);
    // tidak ada satu pun plaintext di hasilnya
    expect(Buffer.from(nikEncrypted).includes(Buffer.from(NIK))).toBe(false);
  });

  it("menolak NIK yang sudah ter-masking (anti double-mask)", () => {
    expect(() => sembunyikanNik("3171-xxxx-xxxx-0001", KUNCI)).toThrow(KriptoError);
  });
});

describe("nikSama — perbandingan timing-safe", () => {
  it("NIK sama walau ciphertext-nya berbeda → benar", () => {
    const a = sembunyikanNik(NIK, KUNCI);
    const b = sembunyikanNik(NIK, KUNCI);
    // `nikEncrypted` berupa Uint8Array (tipe Bytes Prisma) — bukan Buffer
    expect(Buffer.from(a.nikEncrypted).equals(Buffer.from(b.nikEncrypted))).toBe(false); // acak
    expect(nikSama(a.nikEncrypted, b.nikEncrypted, KUNCI)).toBe(true);
  });

  it("NIK berbeda → salah", () => {
    const a = sembunyikanNik(NIK, KUNCI);
    const b = sembunyikanNik("3171050101050988", KUNCI);
    expect(nikSama(a.nikEncrypted, b.nikEncrypted, KUNCI)).toBe(false);
  });

  it("kunci salah → menolak, bukan diam-diam bilang sama", () => {
    const a = sembunyikanNik(NIK, KUNCI);
    const b = sembunyikanNik(NIK, KUNCI);
    expect(() => nikSama(a.nikEncrypted, b.nikEncrypted, randomBytes(32))).toThrow(KriptoError);
  });
});
