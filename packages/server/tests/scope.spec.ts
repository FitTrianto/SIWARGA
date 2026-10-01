/**
 * B18 — Cek scope lapisan aplikasi (PRD §4.1, §7.2, §12.2 · aturan §4.6).
 *
 * defense-in-depth: RLS membatasi baris terbaca, fungsi ini MENOLAK sebelum
 * query dieksekusi. Aturan paling penting: Portal RW hanya menerima AGREGAT —
 * baris per-warga/per-RT selalu ditolak meski kolom `rt_id`-nya miliknya sendiri.
 */
import { describe, expect, it } from "vitest";
import {
  cekScope,
  wajibFilterRw,
  type Pemohon,
  type TargetBaris,
} from "../src/services/scopeCheck.js";

const RT_A = "rt-0000-aaaa";
const RT_B = "rt-0000-bbbb";
const RW_1 = "rw-0011-cccc";

const platform: Pemohon = { level: "platform", id: null };
const rtA: Pemohon = { level: "rt", id: RT_A };
const rw1: Pemohon = { level: "rw", id: RW_1 };

function harapDitolak(hasil: ReturnType<typeof cekScope>, pola: RegExp): void {
  expect(hasil.ok).toBe(false);
  if (!hasil.ok) {
    expect(hasil.kode).toBe("FORBIDDEN_SCOPE");
    expect(hasil.alasan).toMatch(pola);
  }
}

describe("cekScope — platform", () => {
  it("platform boleh mengakses apa pun", () => {
    const sasaran: TargetBaris[] = [
      { rtId: RT_A },
      { rtId: RT_B },
      { rwId: RW_1 },
      { scopeLevel: "rt", scopeId: RT_A },
      { scopeLevel: "rw", scopeId: RW_1 },
      {},
    ];
    for (const s of sasaran) expect(cekScope(platform, s)).toEqual({ ok: true });
  });
});

describe("cekScope — Portal RT", () => {
  it("RT menerima baris miliknya sendiri", () => {
    expect(cekScope(rtA, { rtId: RT_A })).toEqual({ ok: true });
    expect(cekScope(rtA, { scopeLevel: "rt", scopeId: RT_A })).toEqual({ ok: true });
  });

  it("RT DITOLAK atas baris RT lain", () => {
    harapDitolak(cekScope(rtA, { rtId: RT_B }), /RT lain/);
    harapDitolak(cekScope(rtA, { scopeLevel: "rt", scopeId: RT_B }), /tidak cocok/);
  });

  it("RT ditolak atas baris yang bukan scope level RT", () => {
    harapDitolak(cekScope(rtA, { scopeLevel: "rw", scopeId: RW_1 }), /bukan level RT/);
    harapDitolak(cekScope(rtA, { scopeLevel: "platform", scopeId: "x" }), /bukan level RT/);
  });

  it("RT ditolak atas baris bertenant RW yang tidak menunjuk rt_id-nya", () => {
    harapDitolak(cekScope(rtA, { rwId: RW_1 }), /cekIndukRw/);
    // rt_id milik RT lain menang lebih dulu — bukan induk RW yang menolong
    harapDitolak(cekScope(rtA, { rtId: RT_B, rwId: RW_1 }), /RT lain/);
  });

  it("RT menerima baris miliknya yang turut menunjuk induk RW (kop surat)", () => {
    expect(cekScope(rtA, { rtId: RT_A, rwId: RW_1 })).toEqual({ ok: true });
  });

  it("pemohon RT tanpa identitas scope ditolak", () => {
    harapDitolak(cekScope({ level: "rt", id: null }, { rtId: RT_A }), /identitas/i);
  });
});

describe("cekScope — Portal RW (agregat saja, §7.2)", () => {
  it("RW DITOLAK atas baris per-warga/per-RT — termasuk RT miliknya sendiri", () => {
    harapDitolak(cekScope(rw1, { rtId: RT_A }), /agregat per RT/);
    harapDitolak(cekScope(rw1, { rtId: RT_B }), /agregat per RT/);
  });

  it("RW DITOLAK atas baris dengan scope level RT", () => {
    harapDitolak(cekScope(rw1, { scopeLevel: "rt", scopeId: RT_A }), /akses baca ke scope RT/);
    // scopeId cocok pun tidak menolong — levelnya yang salah
    harapDitolak(cekScope(rw1, { scopeLevel: "rt", scopeId: RW_1 }), /akses baca ke scope RT/);
  });

  it("RW diterima pada scope polimorfik miliknya (kas/audit RW)", () => {
    expect(cekScope(rw1, { scopeLevel: "rw", scopeId: RW_1 })).toEqual({ ok: true });
    harapDitolak(cekScope(rw1, { scopeLevel: "rw", scopeId: "rw-lain" }), /tidak cocok/);
  });

  it("RW diterima pada baris bertenant RW miliknya", () => {
    expect(cekScope(rw1, { rwId: RW_1 })).toEqual({ ok: true });
    harapDitolak(cekScope(rw1, { rwId: "rw-lain" }), /dimiliki RW lain/);
  });

  it("pemohon RW tanpa identitas scope ditolak", () => {
    harapDitolak(cekScope({ level: "rw", id: null }, {}), /identitas/i);
  });

  it("target tanpa keterangan sama sekali (query agregat) diterima RW", () => {
    expect(cekScope(rw1, {})).toEqual({ ok: true });
  });
});

describe("wajibFilterRw", () => {
  it("hanya Portal RW / platform yang boleh memanggil agregat RW", () => {
    expect(wajibFilterRw(platform)).toEqual({ ok: true });
    expect(wajibFilterRw(rw1)).toEqual({ ok: true });
    harapDitolak(wajibFilterRw(rtA), /Portal RW/);
    harapDitolak(wajibFilterRw({ level: "rw", id: null }), /Portal RW/);
  });
});
