/**
 * B18 — Alokasi pembayaran FIFO (PRD §6.4.5, aturan §4.1).
 *
 * Yang dijaga di sini:
 *   1. FIFO ke tagihan TERLAMA (periode → tenggat → id), bukan urutan masuk.
 *   2. Mode "terpisah" tidak pernah menyentuh kategori lain.
 *   3. Idempoten — hash alokasi selalu sama untuk (pembayaran, tagihan, periode).
 *   4. Perhitungan dalam integer sen: tidak ada galat pembulatan float rupiah.
 *   5. Sisa dana tidak pernah dibuang — dilaporkan sebagai kelebihan bayar.
 */
import { describe, expect, it } from "vitest";
import {
  AlokasiError,
  alokasikan,
  hashIdempotensi,
  terapkanAlokasi,
  urutkanTagihan,
  type TagihanAlokasi,
} from "../src/services/alokasiFIFO.js";

function tagihan(id: string, sisa: number, opsional: Partial<TagihanAlokasi> = {}): TagihanAlokasi {
  return {
    id,
    kategoriId: "kat-keamanan",
    periode: "2026-10",
    tenggat: null,
    sisa,
    nominalAwal: sisa,
    ...opsional,
  };
}

describe("urutkanTagihan — urutan FIFO", () => {
  it("mengurutkan periode menaik tanpa memutasi array masukan", () => {
    const masukan = [
      tagihan("t-des", 1000, { periode: "2026-12" }),
      tagihan("t-aug", 1000, { periode: "2026-08" }),
      tagihan("t-oct", 1000, { periode: "2026-10" }),
    ];
    const salinan = [...masukan];

    const hasil = urutkanTagihan(masukan);

    expect(hasil.map((t) => t.id)).toEqual(["t-aug", "t-oct", "t-des"]);
    expect(masukan).toEqual(salinan); // tidak dimutasi
    expect(urutkanTagihan(masukan)).not.toBe(hasil); // selalu salinan baru
  });

  it("periode sama → tenggat menaik, tenggat kosong diurutkan terakhir", () => {
    const hasil = urutkanTagihan([
      tagihan("tanpa-tenggat", 100),
      tagihan("tenggat-5", 100, { tenggat: "2026-10-05" }),
      tagihan("tenggat-1", 100, { tenggat: "2026-10-01" }),
    ]);
    expect(hasil.map((t) => t.id)).toEqual(["tenggat-1", "tenggat-5", "tanpa-tenggat"]);
  });

  it("periode & tenggat sama → id menentukan urutan (deterministik)", () => {
    const hasil = urutkanTagihan([
      tagihan("b", 100, { tenggat: "2026-10-01" }),
      tagihan("a", 100, { tenggat: "2026-10-01" }),
    ]);
    expect(hasil.map((t) => t.id)).toEqual(["a", "b"]);
  });
});

describe("alokasikan — mode gabungan", () => {
  it("menutup tagihan dari yang tertua lebih dulu", () => {
    const hasil = alokasikan(
      { id: "bayar-1", nominal: 30_000 },
      [
        tagihan("t-okt", 10_000, { periode: "2026-10" }),
        tagihan("t-aug", 10_000, { periode: "2026-08" }),
        tagihan("t-sep", 10_000, { periode: "2026-09" }),
      ],
    );

    expect(hasil.alokasi.map((a) => a.tagihanId)).toEqual(["t-aug", "t-sep", "t-okt"]);
    expect(hasil.alokasi.map((a) => a.urutan)).toEqual([1, 2, 3]);
    expect(hasil.totalDialokasikan).toBe(30_000);
    expect(hasil.sisaDana).toBe(0);
    expect(hasil.kelebihanBayar).toBe(0);
  });

  it("melewati tagihan yang sudah lunas", () => {
    const hasil = alokasikan({ id: "b", nominal: 5_000 }, [
      tagihan("lunas", 0, { periode: "2026-08" }),
      tagihan("hutang", 5_000, { periode: "2026-09" }),
    ]);
    expect(hasil.alokasi.map((a) => a.tagihanId)).toEqual(["hutang"]);
  });

  it("pembayaran sebagian → alokasi parsial pada tagihan berikutnya", () => {
    const hasil = alokasikan({ id: "b", nominal: 7_000 }, [
      tagihan("t1", 10_000, { periode: "2026-08" }),
      tagihan("t2", 10_000, { periode: "2026-09" }),
    ]);
    expect(hasil.alokasi).toHaveLength(1);
    expect(hasil.alokasi[0]).toMatchObject({ tagihanId: "t1", nominal: 7_000, urutan: 1 });
    expect(hasil.sisaDana).toBe(0);
  });

  it("kelebihan bayar dilaporkan, tidak hilang", () => {
    const hasil = alokasikan({ id: "b", nominal: 75_000 }, [
      tagihan("t1", 20_000, { periode: "2026-08" }),
      tagihan("t2", 30_000, { periode: "2026-09" }),
    ]);
    expect(hasil.totalDialokasikan).toBe(50_000);
    expect(hasil.sisaDana).toBe(25_000);
    expect(hasil.kelebihanBayar).toBe(25_000);
    expect(hasil.tagihanDilewati).toEqual([]);
  });
});

describe("alokasikan — mode terpisah", () => {
  it("hanya menyentuh kategori tujuan dan mencatat yang dilewati", () => {
    const hasil = alokasikan(
      { id: "b", nominal: 20_000, kategoriTujuan: "kat-keamanan" },
      [
        tagihan("keamanan", 10_000, { kategoriId: "kat-keamanan", periode: "2026-08" }),
        tagihan("kebersihan", 5_000, { kategoriId: "kat-kebersihan", periode: "2026-09" }),
      ],
      "terpisah",
    );

    expect(hasil.alokasi.map((a) => a.tagihanId)).toEqual(["keamanan"]);
    expect(hasil.tagihanDilewati).toEqual(["kebersihan"]);
    expect(hasil.totalDialokasikan).toBe(10_000);
    expect(hasil.kelebihanBayar).toBe(10_000);
  });

  it("menolak mode terpisah tanpa kategori tujuan", () => {
    expect(() =>
      alokasikan({ id: "b", nominal: 1000, kategoriTujuan: null }, [tagihan("t", 1000)], "terpisah"),
    ).toThrow(AlokasiError);

    try {
      alokasikan({ id: "b", nominal: 1000 }, [tagihan("t", 1000)], "terpisah");
      throw new Error("seharusnya melempar");
    } catch (err) {
      expect(err).toBeInstanceOf(AlokasiError);
      expect((err as AlokasiError).kode).toBe("KATEGORI_TUJUAN_WAJIB");
    }
  });
});

describe("alokasikan — validasi input", () => {
  const kasus: Array<[string, number]> = [
    ["nol", 0],
    ["negatif", -1_000],
    ["NaN", Number.NaN],
    ["tak hingga", Number.POSITIVE_INFINITY],
  ];

  it.each(kasus)("menolak nominal %s", (_label, nominal) => {
    try {
      alokasikan({ id: "b", nominal }, [tagihan("t", 1000)]);
      throw new Error("seharusnya melempar");
    } catch (err) {
      expect(err).toBeInstanceOf(AlokasiError);
      expect((err as AlokasiError).kode).toBe("NOMINAL_TIDAK_VALID");
    }
  });
});

describe("idempotensi", () => {
  it("hash selalu sama untuk kombinasi yang sama dan beda untuk kombinasi lain", () => {
    const a = hashIdempotensi("bayar-1", "tagihan-1", "2026-08");
    expect(hashIdempotensi("bayar-1", "tagihan-1", "2026-08")).toBe(a);
    expect(a).toMatch(/^[0-9a-f]{64}$/); // sha256 hex
    expect(hashIdempotensi("bayar-1", "tagihan-2", "2026-08")).not.toBe(a);
    expect(hashIdempotensi("bayar-2", "tagihan-1", "2026-08")).not.toBe(a);
    expect(hashIdempotensi("bayar-1", "tagihan-1", "2026-09")).not.toBe(a);
  });

  it("proses ulang pembayaran yang sama menghasilkan hash alokasi identik", () => {
    const daftar = [
      tagihan("t1", 10_000, { periode: "2026-08" }),
      tagihan("t2", 10_000, { periode: "2026-09" }),
    ];
    const sekali = alokasikan({ id: "bayar-x", nominal: 15_000 }, daftar);
    const duaKali = alokasikan({ id: "bayar-x", nominal: 15_000 }, daftar);

    expect(duaKali.alokasi.map((a) => a.hashIdempotensi)).toEqual(
      sekali.alokasi.map((a) => a.hashIdempotensi),
    );
    // ...dan tetap beda antar tagihan (unik per baris alokasi)
    const unik = new Set(sekali.alokasi.map((a) => a.hashIdempotensi));
    expect(unik.size).toBe(sekali.alokasi.length);
  });
});

describe("ketelitian uang — integer sen", () => {
  it("0.1 + 0.2 tidak pernah menjadi 0.30000000000000004", () => {
    const hasil = alokasikan({ id: "b", nominal: 0.3 }, [
      tagihan("t1", 0.1, { periode: "2026-08" }),
      tagihan("t2", 0.2, { periode: "2026-09" }),
    ]);
    expect(hasil.totalDialokasikan).toBe(0.3);
    expect(hasil.sisaDana).toBe(0);
    expect(hasil.alokasi.map((a) => a.nominal)).toEqual([0.1, 0.2]);
  });

  it("pembulatan terpecah — sisa koma tetap akurat hingga sen", () => {
    const hasil = alokasikan(
      { id: "b", nominal: 1_000 },
      [
        tagihan("t1", 333.333, { periode: "2026-08" }),
        tagihan("t2", 333.333, { periode: "2026-09" }),
        tagihan("t3", 333.333, { periode: "2026-10" }),
      ],
    );

    // 333.333 → 33333 sen per tagihan (dibulatkan naik oleh Math.round)
    expect(hasil.alokasi.map((a) => a.nominal)).toEqual([333.33, 333.33, 333.33]);
    expect(hasil.totalDialokasikan).toBe(999.99);
    expect(hasil.kelebihanBayar).toBe(0.01);
    // Invarian: alokasi + sisa = pembayaran, tanpa selisih pembulatan
    expect(hasil.totalDialokasikan + hasil.sisaDana).toBeCloseTo(1_000, 10);
  });
});

describe("terapkanAlokasi", () => {
  it("mengurangi sisa tagihan dan mem-bounce di nol", () => {
    const daftar = [
      tagihan("t1", 10_000, { periode: "2026-08" }),
      tagihan("t2", 5_000, { periode: "2026-09" }),
    ];
    const hasil = alokasikan({ id: "b", nominal: 12_000 }, daftar);
    const sesudah = terapkanAlokasi(daftar, [hasil]);

    expect(sesudah.find((t) => t.id === "t1")?.sisa).toBe(0);
    expect(sesudah.find((t) => t.id === "t2")?.sisa).toBe(3_000);
    // tagihan yang tidak tersentuh tidak berubah
    expect(daftar.find((t) => t.id === "t2")?.sisa).toBe(5_000);
  });

  it("mengabaikan alokasi ke tagihan yang tidak ada di daftar", () => {
    const daftar = [tagihan("t1", 10_000)];
    const hantu = alokasikan({ id: "b", nominal: 1_000 }, [tagihan("t-hantu", 1_000)]);
    expect(() => terapkanAlokasi(daftar, [hantu])).not.toThrow();
    expect(daftar[0]!.sisa).toBe(10_000);
  });
});
