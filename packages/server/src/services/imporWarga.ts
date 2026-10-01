/**
 * Migrasi Data (A10 · PRD §9.1(6) · spesifikasi §5.4) — lapisan baca & validasi
 * berkas impor warga. Murni fungsi: tidak menyentuh DB (dedup + transaksi ada di
 * `routes/rtImporWarga.ts`).
 *
 * Format yang didukung (keputusan 1 Okt 2026, laporan Migrasi Data §2):
 *   • `.csv`  — parser RFC4180 ringkas buatan sendiri (kutip, koma di dalam
 *               kutip, CRLF, BOM UTF-8) tanpa dependensi eksternal;
 *   • `.xlsx` — sheet pertama via `exceljs` (server-side; bundle FE tak membengkak).
 *
 * Jujur tentang data kotor (keputusan #5): baris rusak TIDAK membatalkan baris
 * lain — dikumpulkan sebagai `BarisSalah` untuk laporan `impor_data.laporan`.
 * NIK tidak pernah dipertahankan dalam bentuk apa pun selain untuk enkripsi di
 * pemanggil (§14/B17); `BarisSalah` hanya memuat nomor baris + nama.
 */
import ExcelJS from "exceljs";
import { z } from "zod";
import { GalatTolak } from "../plugins/guard.js";
import { normalisasiNoHp } from "./identitasWarga.js";

/** Batas baris data per file (keputusan #4) — lebih dari ini → 400. */
export const CAP_BARIS = 1000;

export type HubunganImpor = "kepala" | "istri" | "anak" | "lainnya";
export type KunciKolom = "nama" | "nik" | "noKk" | "alamat" | "noWa" | "email" | "hubungan";

export interface BarisValid {
  /** Nomor baris pada file asli (baris judul = 1). */
  nomor: number;
  nama: string;
  nik: string;
  noKk: string;
  alamat: string;
  noHp: string | null;
  email: string | null;
  /** `null` → diinferensi oleh rute (keputusan #7). */
  hubungan: HubunganImpor | null;
}

export type BarisSalah = {
  nomor: number;
  nama: string;
  pesan: string;
};

const NIK16 = /^\d{16}$/;
const HP = /^\d{10,13}$/;
const SUREL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const HUBUNGAN: readonly HubunganImpor[] = ["kepala", "istri", "anak", "lainnya"];

/** Kolom yang tanpa salah satunya file ditolak utuh (400, tanpa jejak DB). */
const WAJIB: readonly KunciKolom[] = ["nama", "nik", "noKk", "alamat"];

/** Alias header → kunci internal, dinormalisasi case-insensitif tanpa spasi/titik. */
const ALIAS: Record<string, KunciKolom> = {
  nama: "nama",
  namalengkap: "nama",
  nik: "nik",
  nokk: "noKk",
  nomorkk: "noKk",
  kk: "noKk",
  alamat: "alamat",
  nowa: "noWa",
  nohp: "noWa",
  nomorhp: "noWa",
  nomorwa: "noWa",
  wa: "noWa",
  hp: "noWa",
  email: "email",
  surel: "email",
  hubungan: "hubungan",
  statushubungan: "hubungan",
};

const LABEL_KOLOM: Record<KunciKolom, string> = {
  nama: "Nama",
  nik: "NIK",
  noKk: "No. KK",
  alamat: "Alamat",
  noWa: "No. WA",
  email: "Email",
  hubungan: "Hubungan",
};

/**
 * Parser CSV ringkas (subset RFC4180): field berhimpit dalam tanda kutip,
 * kutip ganda `""` = kutip literal, baris CRLF/LF, BOM dipangkas di depan.
 */
export function parseCsv(teks: string): string[][] {
  const s = teks.replace(/^\uFEFF/, "");
  const hasil: string[][] = [];
  let baris: string[] = [];
  let sel = "";
  let kutip = false;
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (kutip) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          sel += '"';
          i += 2;
          continue;
        }
        kutip = false;
        i += 1;
        continue;
      }
      sel += c;
      i += 1;
      continue;
    }
    if (c === '"' && sel === "") {
      kutip = true;
      i += 1;
      continue;
    }
    if (c === ",") {
      baris.push(sel);
      sel = "";
      i += 1;
      continue;
    }
    if (c === "\r") {
      i += 1;
      continue;
    }
    if (c === "\n") {
      baris.push(sel);
      hasil.push(baris);
      baris = [];
      sel = "";
      i += 1;
      continue;
    }
    sel += c;
    i += 1;
  }
  if (sel !== "" || baris.length > 0) {
    baris.push(sel);
    hasil.push(baris);
  }
  return hasil;
}

/** Sel XLSX → string polos (rich text, hyperlink, formula, tanggal, angka). */
function selXlsx(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.richText)) {
      return (o.richText as Array<{ text?: string }>).map((t) => t.text ?? "").join("");
    }
    if ("text" in o) return o.text === null || o.text === undefined ? "" : String(o.text);
    if ("result" in o) return o.result === null || o.result === undefined ? "" : String(o.result);
    if ("hyperlink" in o) return String(o.hyperlink ?? "");
    if ("error" in o) return "";
  }
  return typeof v === "string" ? v : "";
}

async function barisXlsx(buf: Buffer): Promise<string[][]> {
  const buku = new ExcelJS.Workbook();
  try {
    // Catatan tipe: `index.d.ts` exceljs mendeklarasikan `Buffer` sendiri
    // (`interface Buffer extends ArrayBuffer` di dalam modulnya) sehingga
    // Buffer Node tak pernah cocok secara tipikal — runtime-nya tetap benar
    // (Node Buffer = Uint8Array yang dibaca exceljs). Cast eksplisit + sadar.
    await buku.xlsx.load(buf as unknown as ArrayBuffer);
  } catch {
    throw new GalatTolak("VALIDATION", "File XLSX tidak dapat dibaca — pastikan file tidak rusak.");
  }
  const lembar = buku.worksheets[0];
  if (!lembar) throw new GalatTolak("VALIDATION", "File XLSX tidak memiliki lembar data.");
  const hasil: string[][] = [];
  lembar.eachRow({ includeEmpty: false }, (row) => {
    const nilai = row.values as unknown[];
    const sel: string[] = [];
    // `row.values` 1-based (index 0 kosong); sel bolong → "".
    for (let i = 1; i < nilai.length; i++) sel.push(selXlsx(nilai[i]));
    hasil.push(sel);
  });
  return hasil;
}

/** Baca berkas sesuai ekstensi. Ekstensi lain → 400 (keputusan #1). */
export async function bacaBerkasImpor(namaFile: string, buf: Buffer): Promise<string[][]> {
  if (/\.csv$/i.test(namaFile)) return parseCsv(buf.toString("utf8"));
  if (/\.xlsx$/i.test(namaFile)) return await barisXlsx(buf);
  throw new GalatTolak("VALIDATION", 'Format file harus ".csv" atau ".xlsx" — ubah format lalu coba lagi.');
}

/**
 * Petakan baris judul → indeks kolom (alias case-insensitif; kolom pertama menang
 * bila dua alias berbeda menunjuk kunci sama). Kolom wajib hilang → 400 dengan
 * daftarnya; baris data kosong total ikut dibuang.
 */
export function petakanHeader(rows: string[][]): { data: string[][]; kolom: Record<KunciKolom, number> } {
  const kepala = rows[0];
  if (!kepala || kepala.every((c) => !c.trim())) {
    throw new GalatTolak("VALIDATION", "File tidak memiliki baris judul kolom — gunakan template resmi.");
  }
  const kolom = {} as Partial<Record<KunciKolom, number>>;
  kepala.forEach((h, i) => {
    const k = ALIAS[h.toLowerCase().replace(/[\s._\-()]/g, "")];
    if (k && kolom[k] === undefined) kolom[k] = i;
  });
  const hilang = WAJIB.filter((k) => kolom[k] === undefined).map((k) => LABEL_KOLOM[k]);
  if (hilang.length > 0) {
    throw new GalatTolak(
      "VALIDATION",
      `Kolom wajib tidak ditemukan: ${hilang.join(", ")}. Gunakan template resmi (unduh dari halaman Data Warga).`,
    );
  }
  const data = rows.slice(1).filter((r) => r.some((c) => c.trim() !== ""));
  return { data, kolom: kolom as Record<KunciKolom, number> };
}

/**
 * Validasi per baris (keputusan #5): gagal → dicatat, bukan membatalkan file.
 * NIK kembar DALAM file ikut ditolak (aturan yang sama dengan form tambah),
 * agar impor ulang file identik tidak pernah menggandakan orang.
 */
export function validasiBaris(
  data: string[][],
  kolom: Record<KunciKolom, number>,
): { valid: BarisValid[]; salah: BarisSalah[] } {
  const valid: BarisValid[] = [];
  const salah: BarisSalah[] = [];
  const nikDipakai = new Map<string, number>();

  data.forEach((r, i) => {
    const nomor = i + 2; // +1 baris judul, +1 numerik manusia (baris 1 = judul)
    const amb = (k: KunciKolom) => (r[kolom[k]] ?? "").trim();
    const nama = amb("nama");
    const tampil = nama || `baris ${nomor}`;
    const tolak = (pesan: string) => {
      salah.push({ nomor, nama: tampil, pesan });
    };

    if (nama.length < 2 || nama.length > 120) return tolak("Nama wajib 2–120 karakter.");
    const nik = amb("nik").replace(/\s+/g, "");
    if (!NIK16.test(nik)) return tolak("NIK harus tepat 16 digit angka.");
    const noKk = amb("noKk").replace(/\s+/g, "");
    if (!NIK16.test(noKk)) return tolak("No. KK harus tepat 16 digit angka.");
    const alamat = amb("alamat");
    if (alamat.length < 1 || alamat.length > 200) return tolak("Alamat wajib diisi (maks 200 karakter).");

    let noHp: string | null = null;
    const hpMentah = amb("noWa");
    if (hpMentah) {
      const hp = normalisasiNoHp(hpMentah);
      if (!HP.test(hp)) return tolak("No. WA/HP tidak valid (10–13 digit).");
      noHp = hp;
    }

    let email: string | null = null;
    const surel = amb("email");
    if (surel) {
      if (surel.length > 160 || !SUREL.test(surel)) return tolak("Email tidak valid.");
      email = surel;
    }

    let hubungan: HubunganImpor | null = null;
    if (kolom.hubungan !== undefined) {
      const h = amb("hubungan").toLowerCase();
      if (h) {
        if (!(HUBUNGAN as readonly string[]).includes(h)) {
          return tolak("Hubungan harus salah satu dari: kepala, istri, anak, lainnya.");
        }
        hubungan = h as HubunganImpor;
      }
    }

    const pemakai = nikDipakai.get(nik);
    if (pemakai !== undefined) {
      return tolak(`NIK sama dengan baris ${pemakai} — satu NIK hanya boleh sekali dalam satu file.`);
    }
    nikDipakai.set(nik, nomor);

    valid.push({ nomor, nama, nik, noKk, alamat, noHp, email, hubungan });
  });

  return { valid, salah };
}

/**
 * Inferensi `hubungan` bila file tanpa kolom Hubungan (keputusan #7):
 * baris pertama menjadi `kepala` hanya bila kelompoknya belum punya kepala —
 * sisa baris `lainnya`. Deterministik & dapat diprediksi pengurus.
 */
export function hitungHubungan(
  anggota: readonly { hubungan: HubunganImpor | null }[],
  punyaKepala: boolean,
): HubunganImpor[] {
  return anggota.map((a, i) => a.hubungan ?? (punyaKepala || i > 0 ? "lainnya" : "kepala"));
}

/** Validasi skema opsional dipakai FE/tes; rute memakai `validasiBaris`. */
export const skemaBarisCsv = z.object({
  nama: z.string().trim().min(2).max(120),
  nik: z.string().regex(NIK16, "NIK harus 16 digit angka."),
  noKk: z.string().regex(NIK16, "No. KK harus 16 digit angka."),
  alamat: z.string().trim().min(1).max(200),
  noWa: z.string().optional(),
  email: z.string().optional(),
  hubungan: z.enum(["kepala", "istri", "anak", "lainnya"]).optional(),
});
