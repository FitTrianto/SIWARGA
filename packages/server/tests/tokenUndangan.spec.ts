/**
 * B4/B6/B18 — Lifecycle token undangan (PRD §5.5, §6.3, §14.1 · aturan §4.2).
 *
 *   menunggu ──aktivasi sukses──▶ aktif_dipakai  (irreversible)
 *      │  └──lewat 24 jam──────▶ kedaluwarsa     (boleh token baru)
 *      └──cabut RT────────────▶ dicabut          (boleh token baru)
 *
 * Kode asli TIDAK PERNAH disimpan (hanya hash argon2id); percobaan dari
 * perangkat berbeda dicatat (B6).
 */
import { describe, expect, it } from "vitest";
import { config } from "../src/config.js";
import {
  PANJANG_KODE,
  aktivasiBerhasil,
  buatKodeUndangan,
  cabutToken,
  catatPercobaan,
  cocokkanKodeUndangan,
  hashKodeUndangan,
  hashPerangkat,
  kedaluwarsaDari,
  kodeApiToken,
  perangkatBaruTerdeteksi,
  tandaiKedaluwarsa,
  tokenBaru,
  verifikasiToken,
} from "../src/services/tokenUndangan.js";

const T0 = new Date("2026-10-05T08:00:00.000Z");
const T1 = new Date("2026-10-06T08:00:00.000Z"); // +24 jam

describe("pembuatan token & kode", () => {
  it("token baru berstatus menunggu dengan masa berlaku 24 jam", () => {
    const token = tokenBaru(T0);
    expect(token.status).toBe("menunggu");
    expect(token.kedaluwarsaPada.getTime()).toBe(T0.getTime() + 24 * 3_600_000);
    expect(token.kedaluwarsaPada).toEqual(kedaluwarsaDari(T0));
    expect(token.dipakaiPada).toBeNull();
    expect(token.dicabutPada).toBeNull();
    expect(token.percobaanAktivasi).toEqual([]);
    expect(config.undanganJam).toBe(24);
  });

  it("kode undangan panjang 10 dan tanpa karakter mudah tertukar (0/O/1/I)", () => {
    const kode = buatKodeUndangan();
    expect(kode).toHaveLength(PANJANG_KODE);
    expect(kode).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{10}$/);
    expect(kode).not.toMatch(/[01OI]/);
  });

  it("dua kode dibuat tidak akan sama", () => {
    const kumpulan = new Set(Array.from({ length: 20 }, () => buatKodeUndangan()));
    expect(kumpulan.size).toBe(20);
  });
});

describe("kode undangan hanya disimpan sebagai hash", () => {
  it("hash tidak memuat kode asli dan cocok pada verifikasi", async () => {
    const kode = buatKodeUndangan();
    const hash = await hashKodeUndangan(kode);

    expect(hash).toMatch(/^\$argon2id\$/);
    expect(hash).not.toContain(kode);
    expect(await cocokkanKodeUndangan(hash, kode)).toBe(true);
  });

  it("huruf kecil/spasi di sekitar kode tetap diterima, kode lain ditolak", async () => {
    const kode = buatKodeUndangan();
    const hash = await hashKodeUndangan(kode);
    expect(await cocokkanKodeUndangan(hash, `  ${kode.toLowerCase()} `)).toBe(true);
    expect(await cocokkanKodeUndangan(hash, buatKodeUndangan())).toBe(false);
  });

  it("hash rusak → false tanpa galat", async () => {
    expect(await cocokkanKodeUndangan("bukan-hash", "ABCDEFGHJK")).toBe(false);
  });
});

describe("verifikasi status token", () => {
  it("token null → tidak_ditemukan", () => {
    expect(verifikasiToken(null, T0)).toEqual({ hasil: "tidak_ditemukan" });
  });

  it("menunggu & belum lewat → sah", () => {
    expect(verifikasiToken(tokenBaru(T0), new Date(T0.getTime() + 3_600_000))).toEqual({ hasil: "sah" });
  });

  it("menunggu tapi sudah lewat 24 jam → kedaluwarsa (TOKEN_EXPIRED)", () => {
    const token = tokenBaru(T0);
    expect(verifikasiToken(token, T1)).toEqual({ hasil: "kedaluwarsa" });
    expect(verifikasiToken(token, new Date(T1.getTime() + 1))).toEqual({ hasil: "kedaluwarsa" });
    expect(kodeApiToken({ hasil: "kedaluwarsa" })).toBe("TOKEN_EXPIRED");
  });

  it("status final diprioritaskan di atas waktu", () => {
    expect(verifikasiToken({ ...tokenBaru(T0), status: "aktif_dipakai" }, T0)).toEqual({ hasil: "sudah_dipakai" });
    expect(verifikasiToken({ ...tokenBaru(T0), status: "dicabut" }, T0)).toEqual({ hasil: "dicabut" });
    expect(verifikasiToken({ ...tokenBaru(T0), status: "kedaluwarsa" }, T0)).toEqual({ hasil: "kedaluwarsa" });
  });
});

describe("transisi status", () => {
  it("aktivasi sukses → aktif_dipakai + waktu pakai", () => {
    const hasil = aktivasiBerhasil(tokenBaru(T0), T0);
    expect(hasil.status).toBe("aktif_dipakai");
    expect(hasil.dipakaiPada).toEqual(T0);
    expect(verifikasiToken(hasil, T0)).toEqual({ hasil: "sudah_dipakai" });
  });

  it("aktivasi IRREVERSIBLE — token terpakai tak bisa diaktifkan ulang", () => {
    const terpakai = aktivasiBerhasil(tokenBaru(T0), T0);
    expect(() => aktIf(terpakai)).toThrow(/menunggu/);
    expect(() => cabutToken(terpakai, T0)).toThrow(/tidak dapat dicabut/);
  });

  it("token kedaluwarsa tidak bisa diaktifkan", () => {
    expect(() => aktIf(tokenBaru(T0), T1)).toThrow();
  });

  it("pencabutan → dicabut; token tercabut tidak bisa dipakai", () => {
    const dicabut = cabutToken(tokenBaru(T0), T0);
    expect(dicabut.status).toBe("dicabut");
    expect(dicabut.dicabutPada).toEqual(T0);
    expect(verifikasiToken(dicabut, T0)).toEqual({ hasil: "dicabut" });
    expect(() => aktIf(dicabut)).toThrow();
  });

  it("penandaan kedaluwarsa hanya berlaku pada token menunggu yang lewat waktu", () => {
    const lewat = tandaiKedaluwarsa(tokenBaru(T0), T1);
    expect(lewat.status).toBe("kedaluwarsa");

    const dipakai = aktivasiBerhasil(tokenBaru(T0), T0);
    expect(tandaiKedaluwarsa(dipakai, T1)).toBe(dipakai); // status final tak disentuh
    const belumLewat = tokenBaru(T0);
    expect(tandaiKedaluwarsa(belumLewat, T0)).toBe(belumLewat); // masih dalam 24 jam
  });
});

function aktIf(token: ReturnType<typeof tokenBaru>, now = T0) {
  return aktivasiBerhasil(token, now);
}

describe("deteksi multi-perangkat (B6)", () => {
  const devA = hashPerangkat("Mozilla/5.0 (iPhone)", "10.0.0.1");
  const devB = hashPerangkat("Mozilla/5.0 (Android)", "10.0.0.2");

  it("tanpa riwayat → belum ada yang bisa dibandingkan", () => {
    expect(perangkatBaruTerdeteksi(tokenBaru(T0), devA)).toBe(false);
  });

  it("perangkat yang sama berulang bukan temuan baru", () => {
    const token = catatPercobaan(tokenBaru(T0), { deviceHash: devA, ip: "10.0.0.1", now: T0 });
    expect(perangkatBaruTerdeteksi(token, devA)).toBe(false);
  });

  it("perangkat berbeda pada token sama terdeteksi", () => {
    let token = catatPercobaan(tokenBaru(T0), { deviceHash: devA, now: T0 });
    token = catatPercobaan(token, { deviceHash: devB, now: T0 });

    expect(token.percobaanAktivasi).toHaveLength(2);
    expect(perangkatBaruTerdeteksi(token, devB)).toBe(false); // terakhir = devB
    expect(perangkatBaruTerdeteksi(token, devA)).toBe(true); // berbeda dari percobaan terakhir
  });

  it("riwayat dibatasi (default 20 entri terakhir)", () => {
    let token = tokenBaru(T0);
    for (let i = 0; i < 30; i += 1) {
      token = catatPercobaan(token, { deviceHash: `dev-${i}`, now: T0 });
    }
    expect(token.percobaanAktivasi).toHaveLength(20);
    expect(token.percobaanAktivasi.at(-1)?.deviceHash).toBe("dev-29");
    expect(token.percobaanAktivasi[0]?.deviceHash).toBe("dev-10");
  });

  it("hash perangkat stabil untuk UA+IP sama dan beda bila salah satu berubah", () => {
    expect(hashPerangkat("UA", "1.1.1.1")).toBe(hashPerangkat("UA", "1.1.1.1"));
    expect(hashPerangkat("UA", "1.1.1.1")).not.toBe(hashPerangkat("UA", "1.1.1.2"));
    expect(hashPerangkat("UA", null)).not.toBe(hashPerangkat("UA", "1.1.1.1"));
    expect(hashPerangkat("UA", null)).toBe(hashPerangkat("UA", "")); // IP kosong direduksi sama
  });
});

describe("pemetaan ke kode API (§5.0)", () => {
  it("hasil sah tidak menghasilkan error", () => {
    expect(kodeApiToken({ hasil: "sah" })).toBeNull();
  });
  it("kedaluwarsa → TOKEN_EXPIRED (410)", () => {
    expect(kodeApiToken({ hasil: "kedaluwarsa" })).toBe("TOKEN_EXPIRED");
  });
  it("sudah dipakai / dicabut / tidak ada → TOKEN_INVALID (400)", () => {
    expect(kodeApiToken({ hasil: "sudah_dipakai" })).toBe("TOKEN_INVALID");
    expect(kodeApiToken({ hasil: "dicabut" })).toBe("TOKEN_INVALID");
    expect(kodeApiToken({ hasil: "tidak_ditemukan" })).toBe("TOKEN_INVALID");
  });
});
