/**
 * B15/B18 — Penulis audit_log & masking diff (PRD §14, §6.8).
 *
 * Prinsip masking: kunci rahasia (NIK, No. KK, PIN, kata sandi, token)
 * TIDAK PERNAH ikut tersimpan di kolom `sebelum`/`sesudah` — cukup ditandai
 * bahwa nilainya berubah.
 */
import { describe, expect, it } from "vitest";
import { diffAudit, teksRingkasan, type SelisihField } from "../src/plugins/audit.js";

describe("diffAudit", () => {
  it("hanya melaporkan kunci yang benar-benar berubah", () => {
    const hasil = diffAudit(
      { nama: "Bambang", pekerjaan: "Pegawai Swasta", agama: "Islam" },
      { nama: "Bambang Supriyanto", pekerjaan: "Pegawai Swasta", agama: "Islam" },
    );
    expect(hasil).toEqual([
      { field: "nama", lama: "Bambang", baru: "Bambang Supriyanto" },
    ]);
  });

  it("kunci rahasia disembunyikan, bukan nilainya", () => {
    const hasil = diffAudit(
      {
        nik: "3171051405720001",
        noKk: "3171050101050001",
        no_kk: "3171050101050001",
        pin: "123456",
        password: "rahasia123",
        kataSandi: "rahasia123",
        token: "ABCDEFGHJK",
        kodeUndangan: "ABCDEFGHJK",
        nama: "Siti",
      },
      {
        nik: "3171051405720999",
        noKk: "3171050101050999",
        no_kk: "3171050101050999",
        pin: "654321",
        password: "barulagi",
        kataSandi: "barulagi",
        token: "ZYXWVUTSRQ",
        kodeUndangan: "ZYXWVUTSRQ",
        nama: "Siti Rahmawati",
      },
    );

    const kunciRahasia = hasil.filter((h) => h.field !== "nama");
    expect(kunciRahasia).toHaveLength(8);
    for (const h of kunciRahasia) {
      expect(h.lama).toBe("(disembunyikan)");
      expect(h.baru).toBe("(diubah)");
      // pastikan nilai asli tidak bocor ke diff
      expect(JSON.stringify(h)).not.toContain("3171051405720001");
      expect(JSON.stringify(h)).not.toContain("123456");
    }
    expect(hasil.find((h) => h.field === "nama")).toEqual({
      field: "nama",
      lama: "Siti",
      baru: "Siti Rahmawati",
    });
  });

  it("kunci rahasia yang TIDAK berubah tidak ikut tercatat", () => {
    const hasil = diffAudit({ nik: "3171051405720001", nama: "A" }, { nik: "3171051405720001", nama: "A" });
    expect(hasil).toEqual([]);
  });

  it("dapat dibatasi pada daftar kunci tertentu", () => {
    const hasil = diffAudit(
      { nama: "A", alamat: "Lama" },
      { nama: "B", alamat: "Baru" },
      ["nama"],
    );
    expect(hasil.map((h) => h.field)).toEqual(["nama"]);
  });

  it("perubahan nilai ter-encrypt terdeteksi tanpa membocorkan isinya", () => {
    const hasil = diffAudit(
      { data: Buffer.from("rahasia-lama") },
      { data: Buffer.from("rahasia-baru") },
    );
    expect(hasil).toEqual([{ field: "data", lama: "(ter-encrypt)", baru: "(ter-encrypt)" }]);
    expect(JSON.stringify(hasil)).not.toContain("rahasia");
  });

  it("nilai ter-encrypt yang identik tidak dianggap berubah", () => {
    expect(diffAudit({ data: Buffer.from("sama") }, { data: Buffer.from("sama") })).toEqual([]);
  });

  it("kolom ter-encrypt ber-kunci rahasia tetap memakai label disembunyikan", () => {
    const hasil = diffAudit({ nikEncrypted: Buffer.from("a") }, { nikEncrypted: Buffer.from("b") });
    expect(hasil).toEqual([
      { field: "nikEncrypted", lama: "(disembunyikan)", baru: "(diubah)" },
    ]);
  });

  it("normalisasi tipe nilai: Date → ISO, objek → JSON, undefined/null → null", () => {
    const hasil = diffAudit(
      { tanggal: new Date("2026-10-01T00:00:00.000Z"), detail: { a: 1 }, kosong: null, hilang: undefined },
      { tanggal: new Date("2026-11-01T00:00:00.000Z"), detail: { a: 2 }, kosong: null, hilang: undefined },
    );
    expect(hasil).toEqual([
      { field: "tanggal", lama: "2026-10-01T00:00:00.000Z", baru: "2026-11-01T00:00:00.000Z" },
      { field: "detail", lama: '{"a":1}', baru: '{"a":2}' },
    ]);
    expect(hasil.find((h) => h.field === "hilang")).toBeUndefined();
    expect(hasil.find((h) => h.field === "kosong")).toBeUndefined();
  });

  it("null dianggap perubahan bila sebelumnya terisi", () => {
    const hasil = diffAudit({ alamat: "Lama" }, { alamat: null });
    expect(hasil).toEqual([{ field: "alamat", lama: "Lama", baru: null }]);
  });
});

describe("teksRingkasan", () => {
  const diff: SelisihField[] = [
    { field: "nama", lama: "Bambang", baru: "Bambang Supriyanto" },
    { field: "alamat", lama: null, baru: "Blok B4 No. 12" },
  ];

  it("merangkum sebagai 'kunci: lama → baru'", () => {
    expect(teksRingkasan(diff)).toBe(
      "nama: Bambang → Bambang Supriyanto; alamat: - → Blok B4 No. 12",
    );
  });

  it("null ditampilkan sebagai tanda hubung", () => {
    expect(teksRingkasan([{ field: "x", lama: null, baru: null }])).toBe("x: - → -");
  });

  it("dipotong pada batas maksimal dengan elipsis", () => {
    const panjang: SelisihField[] = [{ field: "keterangan", lama: "a".repeat(400), baru: "b".repeat(400) }];
    const teks = teksRingkasan(panjang, 300);
    expect(teks.length).toBe(300);
    expect(teks.endsWith("…")).toBe(true);
  });

  it("daftar kosong menghasilkan teks kosong", () => {
    expect(teksRingkasan([])).toBe("");
  });
});
