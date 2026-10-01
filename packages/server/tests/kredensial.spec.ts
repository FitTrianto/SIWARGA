/**
 * B17/B18 — Kata sandi & kredensial (PRD §5.6, §14 · aturan §4.3).
 *
 * Dua aturan mutlak:
 *   • Kata sandi di-HASH argon2id — TIDAK PERNAH dienkripsi/disimpan kembali.
 *   • 3 kali salah → kunci 15 menit; kata sandi benar → penghitung direset.
 *
 * Kebijakan Fase 3: Portal Warga memakai KATA SANDI (min 8 karakter), bukan
 * PIN 6-digit — kebijakan panjang mengikuti NIST SP 800-63B (panjang minimal +
 * tolak kata sandi umum, tanpa aturan komposisi paksa).
 */
import { describe, expect, it } from "vitest";
import { config } from "../src/config.js";
import {
  PANJANG_KATA_SANDI_MAX,
  PANJANG_KATA_SANDI_MIN,
  KredensialError,
  bukaKunci,
  formatKataSandiValid,
  hashKataSandi,
  terkunci,
  terapkanHasilPercobaan,
  verifikasiKataSandi,
} from "../src/services/kredensial.js";

describe("format kata sandi", () => {
  it("menerima kata sandi 8–200 karakter (setelah trim)", () => {
    expect(PANJANG_KATA_SANDI_MIN).toBe(8);
    expect(PANJANG_KATA_SANDI_MAX).toBe(200);

    expect(formatKataSandiValid("WargaDev2026")).toBe(true);
    expect(formatKataSandiValid("rahasia123")).toBe(true);
    expect(formatKataSandiValid("rahasia123  ")).toBe(true); // trim dulu
    expect(formatKataSandiValid("bukan-pin")).toBe(true);
    expect(formatKataSandiValid("12345678".repeat(25))).toBe(true); // 200 tepat
  });

  it("menolak terlalu pendek, terlalu panjang, dan kata sandi sangat umum", () => {
    expect(formatKataSandiValid("123456")).toBe(false); // bekas panjang PIN — kini tidak cukup
    expect(formatKataSandiValid("abc1234")).toBe(false); // 7 karakter
    expect(formatKataSandiValid("")).toBe(false);
    expect(formatKataSandiValid("12345678")).toBe(false); // sangat umum
    expect(formatKataSandiValid("PASSWORD")).toBe(false); // case-insensitive
    expect(formatKataSandiValid("letmein")).toBe(false);
    expect(formatKataSandiValid("x".repeat(201))).toBe(false);
  });
});

describe("hash kata sandi (argon2id)", () => {
  it("menghasilkan hash argon2id — bukan kata sandi itu sendiri", async () => {
    const hash = await hashKataSandi("rahasia123");
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(hash).not.toContain("rahasia123");
    expect(hash.length).toBeGreaterThan(50);
  });

  it("hash yang sama berbeda setiap kali (salt acak)", async () => {
    const a = await hashKataSandi("rahasia123");
    const b = await hashKataSandi("rahasia123");
    expect(a).not.toBe(b);
    expect(await verifikasiKataSandi(a, "rahasia123")).toBe(true);
    expect(await verifikasiKataSandi(b, "rahasia123")).toBe(true);
  });

  it("menolak format salah sebelum di-hash (galat KredensialError)", async () => {
    await expect(hashKataSandi("7char")).rejects.toBeInstanceOf(KredensialError);
    await expect(hashKataSandi("")).rejects.toBeInstanceOf(KredensialError);
    await expect(hashKataSandi("12345678")).rejects.toBeInstanceOf(KredensialError);
  });

  it("verifikasi mengembalikan true hanya untuk kata sandi yang benar", async () => {
    const hash = await hashKataSandi("BukanRahasia9");
    expect(await verifikasiKataSandi(hash, "BukanRahasia9")).toBe(true);
    expect(await verifikasiKataSandi(hash, "BukanRahasia8")).toBe(false);
    expect(await verifikasiKataSandi(hash, "WargaDev2026")).toBe(false);
  });

  it("kata sandi terlalu pendek saat verifikasi → false (tanpa galat)", async () => {
    const hash = await hashKataSandi("rahasia123");
    expect(await verifikasiKataSandi(hash, "123")).toBe(false);
    expect(await verifikasiKataSandi(hash, "abc")).toBe(false);
    expect(await verifikasiKataSandi(hash, "")).toBe(false);
  });

  it("hash korup → false, tanpa membocorkan detail", async () => {
    expect(await verifikasiKataSandi("bukan-hash", "rahasia123")).toBe(false);
    expect(await verifikasiKataSandi("$argon2id$corrupt", "rahasia123")).toBe(false);
  });
});

describe("penguncian akun (§4.3: 3x salah → 15 menit)", () => {
  const opsi = { maksGagal: 3, lockoutMenit: 15 };
  const t0 = new Date("2026-10-05T08:00:00.000Z");

  it("konfigurasi sistem memakai ambang 3 kali / 15 menit", () => {
    expect(config.loginMaksGagal).toBe(3);
    expect(config.loginLockoutMenit).toBe(15);
  });

  it("gagal 1–2 kali belum mengunci", () => {
    const s1 = terapkanHasilPercobaan({ gagalBerturut: 0, dikunciSampai: null }, "salah", t0, opsi);
    expect(s1).toEqual({ gagalBerturut: 1, dikunciSampai: null });
    expect(terkunci(s1, t0)).toBe(false);

    const s2 = terapkanHasilPercobaan(s1, "salah", t0, opsi);
    expect(s2.gagalBerturut).toBe(2);
    expect(terkunci(s2, t0)).toBe(false);
  });

  it("gagal ke-3 → dikunci 15 menit", () => {
    const s2 = terapkanHasilPercobaan({ gagalBerturut: 2, dikunciSampai: null }, "salah", t0, opsi);
    expect(s2.gagalBerturut).toBe(3);
    expect(s2.dikunciSampai?.getTime()).toBe(t0.getTime() + 15 * 60_000);
    expect(terkunci(s2, t0)).toBe(true);
    expect(terkunci(s2, new Date(t0.getTime() + 14 * 60_000))).toBe(true);
    expect(terkunci(s2, new Date(t0.getTime() + 15 * 60_000 + 1))).toBe(false); // sudah lewat
  });

  it("kata sandi benar mereset penghitung & kunci", () => {
    const terkunciSaat = { gagalBerturut: 5, dikunciSampai: new Date(t0.getTime() + 60_000) };
    const reset = terapkanHasilPercobaan(terkunciSaat, "benar", t0, opsi);
    expect(reset).toEqual({ gagalBerturut: 0, dikunciSampai: null });
    expect(terkunci(reset, t0)).toBe(false);
    expect(terkunci(bukaKunci(), t0)).toBe(false);
  });

  it("terkunci() menghormati waktu (null / lewat → tidak terkunci)", () => {
    expect(terkunci({ gagalBerturut: 3, dikunciSampai: null }, t0)).toBe(false);
    expect(terkunci({ gagalBerturut: 3, dikunciSampai: t0 }, t0)).toBe(false); // sama persis → sudah lewat
    expect(terkunci({ gagalBerturut: 3, dikunciSampai: new Date(t0.getTime() + 1) }, t0)).toBe(true);
  });
});
