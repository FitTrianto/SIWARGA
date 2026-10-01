/**
 * B18 — Buku kas append-only (PRD §6.5, aturan §4.5).
 *
 * Aturan yang dijamaah:
 *   • INSERT boleh; UPDATE/DELETE SELALU ditolak (replika trigger
 *     `fn_tolak_perubahan` di migration 0002).
 *   • Koreksi = entri `pembalik` dengan arah berlawanan — baris asal tak
 *     pernah disentuh.
 *   • Rantai `saldoSesudah` harus tertutup per entri (rekonsiliasi).
 *   • Nominal selalu positif; arah ditentukan kolom `arah`, bukan tanda angka.
 */
import { describe, expect, it } from "vitest";
import {
  BukuKas,
  KasError,
  type EntriKas,
  type InputEntriKas,
} from "../src/services/kasLedger.js";

const TGL = "2026-10-01";

function entri(nominal: number, opsional: Partial<InputEntriKas> = {}): InputEntriKas {
  return {
    tanggal: TGL,
    kategori: "iuran",
    keterangan: "Iuran warga",
    nominal,
    ...opsional,
  };
}

describe("rantai saldo", () => {
  it("saldo awal dipakai ketika buku masih kosong", () => {
    expect(new BukuKas(15_000_000).saldo()).toBe(15_000_000);
    expect(new BukuKas().saldo()).toBe(0);
    expect(new BukuKas(1000).daftar()).toHaveLength(0);
  });

  it("pemasukan menambah dan pengeluaran mengurangi saldo berurutan", () => {
    const buku = new BukuKas(15_000_000);
    const e1 = buku.tambah(entri(1_750_000, { keterangan: "Iuran Blok A" }));
    const e2 = buku.tambah(entri(2_000_000, { tipe: "keluar", kategori: "operasional", keterangan: "Honor satpam" }));
    const e3 = buku.tambah(entri(450_000, { tipe: "keluar", kategori: "operasional", keterangan: "Listrik ronda" }));

    expect(e1.saldoSesudah).toBe(16_750_000);
    expect(e2.saldoSesudah).toBe(14_750_000);
    expect(e3.saldoSesudah).toBe(14_300_000);
    expect(buku.saldo()).toBe(14_300_000);
    expect(buku.saldo()).toBe(e3.saldoSesudah);
    expect(buku.validasiRantai()).toEqual([]);
  });

  it("arah diturunkan dari tipe bila tidak dinyatakan eksplisit", () => {
    const buku = new BukuKas(0);
    expect(buku.tambah(entri(100)).arah).toBe("positif");
    expect(buku.tambah(entri(100, { tipe: "keluar" })).arah).toBe("negatif");
    expect(buku.tambah(entri(100, { tipe: "masuk" })).arah).toBe("positif");
    expect(buku.saldo()).toBe(100);
  });

  it("saldo selalu mengikuti entri terakhir", () => {
    const buku = new BukuKas(1000);
    buku.tambah(entri(500));
    buku.tambah(entri(250, { tipe: "keluar" }));
    const daftar = buku.daftar();
    expect(buku.saldo()).toBe(daftar[daftar.length - 1]!.saldoSesudah);
    expect(daftar.map((e) => e.saldoSesudah)).toEqual([1500, 1250]);
  });
});

describe("append-only — replika trigger fn_tolak_perubahan", () => {
  it("ubah() selalu melempar KasError APPEND_ONLY", () => {
    const buku = new BukuKas();
    try {
      buku.ubah();
      throw new Error("seharusnya melempar");
    } catch (err) {
      expect(err).toBeInstanceOf(KasError);
      expect((err as KasError).kode).toBe("APPEND_ONLY");
      expect((err as KasError).message).toMatch(/UPDATE ditolak/i);
    }
  });

  it("hapus() selalu melempar KasError APPEND_ONLY", () => {
    const buku = new BukuKas();
    try {
      buku.hapus();
      throw new Error("seharusnya melempar");
    } catch (err) {
      expect(err).toBeInstanceOf(KasError);
      expect((err as KasError).kode).toBe("APPEND_ONLY");
      expect((err as KasError).message).toMatch(/DELETE ditolak/i);
    }
  });

  it("baris entri dibekukan — upaya memodifikasi nilai langsung gagal", () => {
    const buku = new BukuKas();
    const e = buku.tambah(entri(1000));
    expect(() => {
      (e as EntriKas).nominal = 999_999;
    }).toThrow(TypeError);
    expect(e.nominal).toBe(1000);
    expect(Object.isFrozen(e)).toBe(true);
    expect(Object.isFrozen(buku.daftar())).toBe(true);
  });

  it("daftar() adalah salinan — mengubahnya tidak mempengaruhi buku", () => {
    const buku = new BukuKas();
    buku.tambah(entri(1000));
    expect(() => buku.daftar().slice()).not.toThrow();
    expect(buku.daftar()).toHaveLength(1);
  });
});

describe("koreksi lewat entri pembalik", () => {
  it("membalik arah tanpa menyentuh entri asal", () => {
    const buku = new BukuKas(0);
    const asal = buku.tambah(entri(2_000_000, { tipe: "keluar", kategori: "operasional", keterangan: "Honor" }));
    const asalSebelum = { ...asal };
    const saldoSebelum = buku.saldo();

    const pembalik = buku.koreksi(asal.id, "Koreksi salah catat", "2026-10-05");

    // entri asal tidak berubah sama sekali
    expect(buku.cari(asal.id)).toEqual(asalSebelum);
    expect(pembalik.reversalOfId).toBe(asal.id);
    expect(pembalik.tipe).toBe("pembalik");
    expect(pembalik.sumber).toBe("pembalik");
    expect(pembalik.arah).toBe("positif"); // berlawanan dengan asal (negatif)
    expect(pembalik.nominal).toBe(asal.nominal);
    expect(pembalik.refId).toBe(asal.id);
    // pengeluaran 2.000.000 dibalik → saldo kembali
    expect(buku.saldo()).toBe(saldoSebelum + asal.nominal);
    expect(buku.validasiRantai()).toEqual([]);
  });

  it("pembalik dari pemasukan menjadi negatif", () => {
    const buku = new BukuKas(0);
    const asal = buku.tambah(entri(500_000));
    const pembalik = buku.koreksi(asal.id, "Salah catat", "2026-10-06");
    expect(pembalik.arah).toBe("negatif");
    expect(buku.saldo()).toBe(0);
  });

  it("menolak membalik entri pembalik (koreksi ganda)", () => {
    const buku = new BukuKas(0);
    const asal = buku.tambah(entri(1000));
    const pembalik = buku.koreksi(asal.id, "koreksi", TGL);
    try {
      buku.koreksi(pembalik.id, "koreksi atas koreksi", TGL);
      throw new Error("seharusnya melempar");
    } catch (err) {
      expect(err).toBeInstanceOf(KasError);
      expect((err as KasError).kode).toBe("KOREKSI_TIDAK_SAH");
    }
  });

  it("menolak koreksi atas entri yang tidak ada", () => {
    const buku = new BukuKas();
    try {
      buku.koreksi("tidak-ada", "alasan", TGL);
      throw new Error("seharusnya melempar");
    } catch (err) {
      expect(err).toBeInstanceOf(KasError);
      expect((err as KasError).kode).toBe("ENTRI_TIDAK_DITEMUKAN");
    }
  });
});

describe("validasi input", () => {
  const kasus: Array<[string, number]> = [["nol", 0], ["negatif", -50], ["NaN", Number.NaN], ["tak hingga", Infinity]];

  it.each(kasus)("menolak nominal %s", (_label, nominal) => {
    const buku = new BukuKas();
    try {
      buku.tambah(entri(nominal));
      throw new Error("seharusnya melempar");
    } catch (err) {
      expect(err).toBeInstanceOf(KasError);
      expect((err as KasError).kode).toBe("NOMINAL_TIDAK_VALID");
    }
  });

  it("menolak keterangan lebih dari 200 karakter", () => {
    const buku = new BukuKas();
    expect(() => buku.tambah(entri(1000, { keterangan: "x".repeat(201) }))).toThrow(KasError);
    expect(() => buku.tambah(entri(1000, { keterangan: "x".repeat(200) }))).not.toThrow();
  });

  it("menolak saldo awal negatif/tidak valid", () => {
    expect(() => new BukuKas(-1)).toThrow(KasError);
    expect(() => new BukuKas(Number.NaN)).toThrow(KasError);
  });
});

describe("pencatatan alokasi iuran", () => {
  it("menghasilkan baris masuk bersumber iuran_alokasi dengan rujukan pembayaran", () => {
    const buku = new BukuKas(14_000_000);
    const e = buku.catatAlokasiIuran("bayar-uuid", 50_000, "2026-10-05");

    expect(e).toMatchObject({
      tipe: "masuk",
      arah: "positif",
      kategori: "iuran",
      sumber: "iuran_alokasi",
      refType: "pembayaran",
      refId: "bayar-uuid",
    });
    expect(buku.saldo()).toBe(14_050_000);
    expect(buku.validasiRantai()).toEqual([]);
  });
});
