/**
 * B18 — Status turunan tagihan (PRD §6.4.7, aturan §4.4).
 *
 * Aturan yang dijaga:
 *   • status DITURUNKAN dari `sisa`, bukan dari pembayaran terakhir;
 *   • keringanan ditandai TERPISAH — tidak pernah menggantikan status;
 *   • tunggak = selisih bulan kalender periode tagihan vs periode aktif.
 */
import { describe, expect, it } from "vitest";
import {
  selisihBulan,
  statusTurunan,
  statusUntukDb,
  type InputStatus,
} from "../src/services/statusTagihan.js";

const AKTIF = "2026-10"; // PERIODE_AKTIF sistem

function hitung(opsional: Partial<InputStatus> = {}) {
  return statusTurunan({
    sisa: 50_000,
    nominalAwal: 50_000,
    periode: AKTIF,
    periodeAktif: AKTIF,
    ...opsional,
  });
}

describe("statusTurunan", () => {
  it("sisa = 0 → lunas, tanpa tunggak", () => {
    const h = hitung({ sisa: 0 });
    expect(h.status).toBe("lunas");
    expect(h.label).toBe("Lunas");
    expect(h.menunggak).toBe(false);
    expect(h.bulanTunggak).toBe(0);
  });

  it("0 < sisa < nominal_awal → sebagian (dicicil), tidak dianggap menunggak", () => {
    const h = hitung({ sisa: 20_000, nominalAwal: 50_000 });
    expect(h.status).toBe("sebagian");
    expect(h.label).toContain("Dicicil");
    expect(h.label).toContain("20.000"); // format rupiah id-ID
    expect(h.menunggak).toBe(false);
    expect(h.bulanTunggak).toBe(0);
  });

  it("sisa = nominal_awal pada periode berjalan → belum_bayar, belum menunggak", () => {
    const h = hitung({ sisa: 50_000, nominalAwal: 50_000 });
    expect(h.status).toBe("belum_bayar");
    expect(h.label).toBe("Belum Bayar");
    expect(h.menunggak).toBe(false);
  });

  it("sisa = nominal_awal, periode lampau → menunggak dengan jumlah bulan", () => {
    const h = hitung({ sisa: 50_000, nominalAwal: 50_000, periode: "2026-08" });
    expect(h.status).toBe("belum_bayar");
    expect(h.menunggak).toBe(true);
    expect(h.bulanTunggak).toBe(2);
    expect(h.label).toBe("Menunggak (2 bulan)");
  });

  it("menunggak hanya untuk tagihan yang belum dibayar penuh — cicilan tidak", () => {
    // Cicilan: sisa < nominal_awal → sebagian, tidak pernah menunggak walau periode lama
    const cicil = hitung({ sisa: 1, nominalAwal: 50_000, periode: "2025-11" });
    expect(cicil.status).toBe("sebagian");
    expect(cicil.menunggak).toBe(false);
    expect(cicil.bulanTunggak).toBe(0);

    // Belum dibayar sama sekali → dihitung dari periode tagihan
    const utuh = hitung({ sisa: 50_000, nominalAwal: 50_000, periode: "2025-11" });
    expect(utuh.status).toBe("belum_bayar");
    expect(utuh.menunggak).toBe(true);
    expect(utuh.bulanTunggak).toBe(11); // Nov 2025 → Okt 2026
  });

  it("keringanan ditandai TERPISAH, tidak mengubah status lunas/sebagian/belum_bayar", () => {
    expect(hitung({ sisa: 0, keringananAktif: true })).toMatchObject({
      status: "lunas",
      keringananAktif: true,
    });
    expect(hitung({ sisa: 10_000, nominalAwal: 50_000, keringananAktif: true })).toMatchObject({
      status: "sebagian",
      keringananAktif: true,
    });
    expect(hitung({ keringananAktif: false }).keringananAktif).toBe(false);
  });

  it("galat bila sisa/nominal_awal negatif", () => {
    expect(() => hitung({ sisa: -1 })).toThrow(/negatif/);
    expect(() => hitung({ nominalAwal: -1 })).toThrow(/negatif/);
  });

  it("pembulatan float kecil tidak membatalkan status", () => {
    // hampir nol → dibulatkan jadi lunas
    expect(hitung({ sisa: 0.000_000_1, nominalAwal: 50_000 }).status).toBe("lunas");
    // hampir nominal_awal → dibulatkan jadi belum_bayar (bukan sebagian)
    expect(hitung({ sisa: 49_999.999_999_9, nominalAwal: 50_000 }).status).toBe("belum_bayar");
    // benar-benar kurang sepeser pun → tetap sebagian
    expect(hitung({ sisa: 49_999.994, nominalAwal: 50_000 }).status).toBe("sebagian");
  });

  it("statusUntukDb mengembalikan persis nilai kolom tagihan.status", () => {
    expect(statusUntukDb(hitung({ sisa: 0 }))).toBe("lunas");
    expect(statusUntukDb(hitung({ sisa: 10_000, nominalAwal: 50_000 }))).toBe("sebagian");
    expect(statusUntukDb(hitung())).toBe("belum_bayar");
  });
});

describe("selisihBulan", () => {
  it("menghitung selisih kalender lintas tahun", () => {
    expect(selisihBulan("2026-10", "2026-10")).toBe(0);
    expect(selisihBulan("2026-08", "2026-10")).toBe(2);
    expect(selisihBulan("2025-12", "2026-01")).toBe(1);
    expect(selisihBulan("2026-10", "2026-08")).toBe(-2); // periode setelah → negatif
  });

  it("menolak format periode yang rusak", () => {
    expect(() => selisihBulan("2026-13", "2026-10")).toThrow(/tidak valid/);
    expect(() => selisihBulan("Oktober 2026", "2026-10")).toThrow(/tidak valid/);
    expect(() => selisihBulan("2026-00", "2026-10")).toThrow(/tidak valid/);
  });
});
