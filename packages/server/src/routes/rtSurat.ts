/**
 * Persuratan resmi & verifikasi publik — PRD §6.6 (task B12 · P0).
 *
 *   GET    /rt/pengaturan                    → kop surat + profil visual + profil RT (B12)
 *   PATCH  /rt/pengaturan                    → simpan kop/profil RT (whitelist, wajib CSRF)
 *   GET    /rt/surat?status=                 → antrian & arsip persuratan RT
 *   GET    /rt/surat/:id/lampiran/:idx        → unduh lampiran pengajuan (RT)
 *   POST   /rt/surat                         → buat baris surat (lihat deviasi)
 *   POST   /rt/surat/:id/terbitkan           → alur RW otomatis bila `perlu_rw`
 *   POST   /rt/surat/:id/setujui             → persetujuan RT (alias terbitkan)
 *   POST   /rt/surat/:id/tolak               → `ditolak` + alasan wajib
 *   POST   /rt/surat/:id/minta-perbaikan     → `perlu_perbaikan` + catatan
 *   GET    /warga/surat?status=              → daftar surat milik sesi + kop
 *   POST   /warga/surat                      → ajukan surat (JSON ATAU multipart
 *                                              dengan ≤3 lampiran, lihat Batch 9)
 *   GET    /warga/surat/:id/lampiran/:idx     → unduh lampiran milik sesi warga
 *   GET    /publik/verifikasi-surat/:qrToken → cek keaslian via QR (PUBLIK)
 *
 * Keputusan desain (dicatat di laporan tugas):
 *   • **Kop disimpan di kolom `pengaturan_rt.template_surat` (JSON)** pada kunci
 *     `{ kop: { baris1, baris2, baris3 } }` — kolom `kop_surat_url` tetap untuk
 *     gambar kop (URL ≤512). PATCH SELALU merge: nilai objek lama dipertahankan,
 *     isian array lama (definisi field seed) disimpan kembali sebagai
 *     `daftarTemplate` supaya tidak ada data yang hilang. Kolom ini belum pernah
 *     dibaca modul lain (hanya diisi seed), jadi penambahan kunci aman dan tidak
 *     memerlukan migrasi skema.
 *   • **`GET/PATCH /rt/pengaturan` memakai whitelist** kop, `bannerUrl`,
 *     `stempelUrl`, `kopSuratUrl`, `notifikasiWaEnabled`, `modePemeliharaan`,
 *     **`profil { namaRt, alamat }`** (sesuai ringkasan kontrak §5.4 "Profil,
 *     banner, stempel, notifikasi, mode pemeliharaan"). Field profil MENULIS
 *     baris `rt` (`perumahan`, `alamat`) — RLS `p_rt_registry` mengizinkan RT
 *     scope menulis barisnya sendiri — sehingga form "Profil RT" di Portal RT
 *     benar-benar persist (sebelumnya FE melaporkan sukses tanpa endpoint).
 *     Field iuran (`modeAlokasi`, `tenggatHari`, `dendaAktif`, `ambangApprovalKas`)
 *     TIDAK diterima di sini karena sudah dimiliki `GET/PATCH /rt/iuran/pengaturan`
 *     (B7) — dua tulis ke baris yang sama dari dua endpoint berbeda akan saling
 *     menimpa.
 *   • **`POST /rt/surat` di luar tabel §5.4** (deviasi terdokumentasi): tabel
 *     kontrak hanya memuat `POST /warga/surat` sebagai pembuat baris, tetapi
 *     Portal RT perlu menerbitkan surat atas permintaan warga yang datang
 *     langsung (tanpa akun Portal Warga). Tanpa baris server, surat tidak bisa
 *     menerima `qr_token` sehingga QR-nya tidak pernah bisa diverifikasi —
 *     endpoint ini yang menjamin "terbit = tercatat".
 *   • **PDF tidak dirender server.** `GET /rt/surat/:id/pdf` & `GET /warga/surat/:id/pdf`
 *     sengaja tidak dibuat: seluruh PDF aplikasi (B24 laporan, B12 surat)
 *     dirender di klien dengan jsPDF + kop + QR dari data yang sama, konsisten
 *     dengan `lib/pdfLaporan.ts`. Deviasi ini dicatat pada laporan.
 *   • **Lampiran pengajuan (Batch 9).** Metadata disimpan pada kolom JSON
 *     `surat.data_pengajuan` pada kunci `lampiran: [{ nama, berkas, tipe,
 *     ukuran }]` — pola sama dengan `template_surat` (tanpa migrasi skema).
 *     Berkas fisik ditulis ke `.data-lampiran/` (gitignore) SEBELUM transaksi
 *     (pola impor A10): gagal menulis → 500 tanpa baris surat; transaksi gagal
 *     → berkas dihapus kembali (tidak ada file yatim). `POST /warga/surat`
 *     menerima dua bentuk: JSON polos (jalur lama) ATAU `multipart/form-data`
 *     (fields + ≤3 berkas, ekstensi whitelist, 5 MB/berkas) — limit multipart
 *     yang melempar 413 di-catch di handler dan dipetakan ke VALIDATION 400
 *     sesuai kontrak §5.0. Unduhan berbasis INDEKS array metadata (`:idx`),
 *     bukan path dari klien — nama berkas selalu hasil tulisan server (UUID)
 *     sehingga path traversal tidak mungkin terjadi; konten-tipe disusun dari
 *     ekstensi (klaim `mimetype` klien tidak pernah dipercaya).
 *
 * Guard §5.0: rute `/rt/**` memakai `wajibRt`, rute `/warga/**` memakai
 * `wajibWarga` tanpa `verifikasiCsrf` (§5.6). Jangkauan data dijaga RLS
 * `p_scope_rt` lewat `denganScopeRequest`; rute PUBLIK memakai
 * `denganScope("platform", …)` karena tidak ada sesi (lihat catatan di bawah).
 * Setiap mutasi mencatat `audit_log` (append-only) dengan diff sebelum/sesudah.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import multipart from "@fastify/multipart";
import { z } from "zod";
import { Prisma } from "../generated/prisma/client.js";
import { catatAudit } from "../plugins/audit.js";
import { verifikasiCsrf } from "../plugins/csrf.js";
import { GalatTolak, wajibRt, wajibWarga } from "../plugins/guard.js";
import { denganScopeRequest } from "../plugins/scope.js";
import { denganScope, type DbTransaksi } from "../services/db.js";
import { pengurusAktif, skemaId } from "./iuranUmum.js";

// ---------------------------------------------------------------------------
// Bentuk data & utilitas bersama
// ---------------------------------------------------------------------------

/** Enam status enum `StatusSurat` — dipakai untuk filter `?status=` & pesan. */
const STATUS_QUERY = [
  "draft",
  "menunggu_rt",
  "menunggu_rw",
  "disetujui",
  "ditolak",
  "perlu_perbaikan",
] as const;

/** Label Indonesia untuk pesan galat (tampilan FE disusun FE). */
const LABEL_STATUS: Record<string, string> = {
  draft: "Draft",
  menunggu_rt: "Menunggu RT",
  menunggu_rw: "Menunggu RW",
  disetujui: "Disetujui",
  ditolak: "Ditolak",
  perlu_perbaikan: "Perlu Perbaikan",
};

/** Tiga baris kop surat resmi (§6.6) — disimpan pada `template_surat.kop`. */
interface KopSurat {
  baris1: string;
  baris2: string;
  baris3: string;
}

// ---------------------------------------------------------------------------
// Lampiran pengajuan surat (Batch 9 — deviasi terdokumentasi §5.3)
// ---------------------------------------------------------------------------

/** Batas ukuran per berkas & jumlah berkas per pengajuan (sama dengan pesan FE). */
const MAKS_LAMPIRAN_BERKAS = 5 * 1024 * 1024;
const MAKS_JUMLAH_LAMPIRAN = 3;

/** Ekstensi whitelist — divalidasi dari NAMA berkas; MIME klaim klien tidak dipercaya. */
const EKSTENSI_LAMPIRAN = new Set([
  ".pdf",
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
]);

/** Folder lampiran — pola sama `.data-impor` (naik 2 tingkat dari `src/` maupun `dist/`). */
const DIR_LAMPIRAN = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  ".data-lampiran",
);

/** Konten-tipe disusun SENDIRI dari ekstensi berkas tersimpan (bukan MIME klien). */
const TIPE_LAMPIRAN: Record<string, string> = {
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

/** Format nama berkas tersimpan — UUID + ekstensi, hasil tulisan server. */
const NAMA_BERKAS_LAMPIRAN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,8}$/i;

/** Metadata satu lampiran — disimpan pada `surat.data_pengajuan.lampiran` (JSON). */
interface LampiranSurat {
  /** Nama asli berkas dari klien (tampilan & Content-Disposition). */
  nama: string;
  /** Nama berkas tersimpan (UUID + ekstensi) di `.data-lampiran/`. */
  berkas: string;
  /** Konten-tipe hasil hitungan ekstensi server. */
  tipe: string;
  /** Ukuran berkas dalam byte. */
  ukuran: number;
}

/** Kolom yang dipilih untuk SELURUH daftar surat (tampilan antrian & arsip). */
const PilihSurat = {
  id: true,
  noSurat: true,
  keperluan: true,
  status: true,
  perluRw: true,
  catatanVerifikasi: true,
  qrToken: true,
  noKk: true,
  diajukanPada: true,
  terbitPada: true,
  createdAt: true,
  dataPengajuan: true,
  jenisSurat: { select: { nama: true, kode: true } },
  warga: { select: { nama: true, kk: { select: { noKk: true } } } },
} as const;

/** Bentuk baris hasil `findMany` dengan `PilihSurat`. */
interface SuratMentah {
  id: string;
  noSurat: string;
  keperluan: string;
  status: string;
  perluRw: boolean;
  catatanVerifikasi: string | null;
  qrToken: string;
  noKk: string;
  diajukanPada: Date | null;
  terbitPada: Date | null;
  createdAt: Date;
  dataPengajuan: unknown;
  jenisSurat: { nama: string; kode: string };
  warga: { nama: string; kk: { noKk: string } };
}

/**
 * Baca daftar lampiran dari `surat.data_pengajuan` — struktur bukan objek /
 * entitas tak sesuai format → dilewati (baris lama tanpa lampiran → `[]`).
 */
function bacaLampiran(dataPengajuan: unknown): LampiranSurat[] {
  if (!dataPengajuan || typeof dataPengajuan !== "object" || Array.isArray(dataPengajuan)) return [];
  const v = (dataPengajuan as Record<string, unknown>).lampiran;
  if (!Array.isArray(v)) return [];
  const hasil: LampiranSurat[] = [];
  for (const x of v) {
    if (!x || typeof x !== "object" || Array.isArray(x)) continue;
    const l = x as Record<string, unknown>;
    if (typeof l.nama !== "string" || typeof l.berkas !== "string") continue;
    // Nama berkas SELALU dibuat server (UUID + ekstensi) — entitas lain
    // ditolak sehingga `path.join(DIR_LAMPIRAN, …)` tak pernah bisa keluar folder.
    if (!NAMA_BERKAS_LAMPIRAN.test(l.berkas)) continue;
    hasil.push({
      nama: l.nama.slice(0, 200),
      berkas: l.berkas,
      tipe: typeof l.tipe === "string" ? l.tipe : "application/octet-stream",
      ukuran: typeof l.ukuran === "number" && Number.isFinite(l.ukuran) ? l.ukuran : 0,
    });
  }
  return hasil;
}

/** Simpan daftar lampiran ke `data_pengajuan` LAMA — kunci lain tetap utuh. */
function gabungLampiran(dataPengajuan: unknown, lampiran: LampiranSurat[]): Prisma.InputJsonValue {
  const dasar: Record<string, unknown> =
    dataPengajuan && typeof dataPengajuan === "object" && !Array.isArray(dataPengajuan)
      ? { ...(dataPengajuan as Record<string, unknown>) }
      : {};
  dasar.lampiran = lampiran;
  return dasar as unknown as Prisma.InputJsonValue;
}

/**
 * `data_pengajuan` baris BARU — kunci `lampiran` hanya ditulis bila ada isinya
 * supaya bentuk baris tanpa lampiran tidak berubah dari Batch 9 sebelumnya.
 */
function dataPengajuanBaru(keperluan: string, lampiran: LampiranSurat[]): Prisma.InputJsonValue {
  const dasar: Record<string, unknown> = { keperluan, sumber: "portal" };
  if (lampiran.length) dasar.lampiran = lampiran;
  return dasar as unknown as Prisma.InputJsonValue;
}

/** Berkas mentah hasil parse multipart (belum tertulis ke disk). */
interface BerkasMentah {
  nama: string;
  isi: Buffer;
}

/**
 * Tulis seluruh berkas ke `.data-lampiran/` (nama = UUID + ekstensi hasil
 * hitungan server). Melempar `GalatTolak INTERNAL` bila salah satu gagal —
 * berkas yang sempat tertulis ikut dibuang (tidak ada file setengah jadi).
 */
async function tulisLampiran(daftar: BerkasMentah[]): Promise<LampiranSurat[]> {
  const hasil: LampiranSurat[] = [];
  try {
    if (daftar.length) await mkdir(DIR_LAMPIRAN, { recursive: true });
    for (const b of daftar) {
      const ekstensi = path.extname(b.nama).toLowerCase();
      const berkas = `${randomUUID()}${ekstensi}`;
      await writeFile(path.join(DIR_LAMPIRAN, berkas), b.isi);
      hasil.push({
        nama: b.nama.slice(0, 200),
        berkas,
        tipe: TIPE_LAMPIRAN[ekstensi] ?? "application/octet-stream",
        ukuran: b.isi.length,
      });
    }
    return hasil;
  } catch {
    await hapusLampiran(hasil);
    throw new GalatTolak(
      "INTERNAL",
      "Berkas lampiran gagal disimpan di server — pengajuan dibatalkan tanpa perubahan data.",
    );
  }
}

/** Hapus berkas lampiran yang sudah tertulis (best-effort, selalu menyelesaikan). */
async function hapusLampiran(daftar: LampiranSurat[]): Promise<void> {
  await Promise.all(
    daftar.map((l) => unlink(path.join(DIR_LAMPIRAN, l.berkas)).catch(() => undefined)),
  );
}

/**
 * Baca `POST /warga/surat` bentuk multipart: field teks + ≤3 berkas lampiran.
 *
 * Limit `@fastify/multipart` melempar error `FST_*` ber-status 413 — errorHandler
 * akan mempertahankan status itu (kontrak §5.0 hanya memakai 400 untuk galat
 * input), jadi SELURUH error ditangkap di sini dan dipetakan ke
 * `GalatTolak VALIDATION` (400) dengan pesan Indonesia per kasus.
 */
async function bacaAjukanMultipart(
  req: FastifyRequest,
): Promise<{ input: z.infer<typeof skemaBuatSuratWarga>; berkas: BerkasMentah[] }> {
  // Pesan per kode limit busboy — dipilih di sini supaya klien dapat pesan
  // yang benar-benar menjelaskan batas yang dilanggar.
  const PESAN_FST: Record<string, string> = {
    FST_REQ_FILE_TOO_LARGE: "Ukuran satu berkas lampiran melebihi 5 MB.",
    FST_FILES_LIMIT: `Lampiran maksimal ${MAKS_JUMLAH_LAMPIRAN} berkas.`,
    FST_FIELDS_LIMIT: "Terlalu banyak field pada pengajuan surat.",
    FST_PARTS_LIMIT: "Terlalu banyak bagian pada permintaan pengajuan surat.",
  };

  const kolom: Record<string, string> = {};
  const berkas: BerkasMentah[] = [];
  try {
    for await (const part of req.parts()) {
      if (part.type === "file") {
        // Pertahanan kedua — busboy (`files: 3`) sudah menolak berkas ke-4.
        if (berkas.length >= MAKS_JUMLAH_LAMPIRAN) {
          throw new GalatTolak("VALIDATION", `Lampiran maksimal ${MAKS_JUMLAH_LAMPIRAN} berkas.`);
        }
        // Stream SELALU dibaca dulu (dibatasi 5 MB oleh busboy) SEBELUM
        // validasi apa pun — membuang part di tengah jalan membuat busboy
        // menahan parser pada stream yang tak pernah dibaca (backpressure) dan
        // permintaan bisa menggantung. Pola A10: baca dulu, baru validasi.
        const isi = await part.toBuffer();
        const nama = (part.filename ?? "").trim().slice(0, 200);
        if (!nama) throw new GalatTolak("VALIDATION", "Nama berkas lampiran tidak ditemukan.");
        // Ekstensi divalidasi dari NAMA berkas; MIME yang diklaim klien tidak
        // dipercaya. `throwFileSizeLimit` default true → berkas >5 MB melempar
        // FST_REQ_FILE_TOO_LARGE (terpetakan ke VALIDATION 400 di catch bawah).
        const ekstensi = path.extname(nama).toLowerCase();
        if (!EKSTENSI_LAMPIRAN.has(ekstensi)) {
          throw new GalatTolak(
            "VALIDATION",
            `Format berkas "${ekstensi || "(tanpa ekstensi)"}" tidak didukung — gunakan PDF, gambar, atau dokumen (.pdf/.jpg/.jpeg/.png/.webp/.doc/.docx/.xls/.xlsx).`,
          );
        }
        berkas.push({ nama, isi });
      } else {
        kolom[part.fieldname] = String(part.value ?? "");
      }
    }
  } catch (e) {
    if (e instanceof GalatTolak) throw e;
    const kode = (e as { code?: string }).code;
    if (typeof kode === "string" && kode.startsWith("FST_")) {
      throw new GalatTolak("VALIDATION", PESAN_FST[kode] ?? "Berkas lampiran tidak valid.");
    }
    throw e;
  }

  // Field opsional kosong → hilangkan supaya lolos `.min(1)` sebagai `undefined`.
  if (!kolom.noSurat) delete kolom.noSurat;
  return { input: skemaBuatSuratWarga.parse(kolom), berkas };
}

/**
 * Baca metadata lampiran pada indeks `:idx` + isi berkasnya dari disk.
 * `meta.berkas` sudah lolos regex UUID di `bacaLampiran` — path tak pernah
 * berasal dari klien sehingga path traversal tidak mungkin terjadi.
 */
async function ambilLampiran(
  dataPengajuan: unknown,
  idx: number,
): Promise<{ meta: LampiranSurat; isi: Buffer }> {
  const meta = bacaLampiran(dataPengajuan)[idx];
  if (!meta) throw new GalatTolak("NOT_FOUND", "Lampiran tidak ditemukan pada surat ini.");
  let isi: Buffer;
  try {
    isi = await readFile(path.join(DIR_LAMPIRAN, meta.berkas));
  } catch {
    throw new GalatTolak("NOT_FOUND", "Berkas lampiran sudah tidak tersedia di server.");
  }
  return { meta, isi };
}

/**
 * Header unduh lampiran: konten-tipe disusun dari EKSTENSI tersimpan (bukan
 * MIME klaim klien), PDF/gambar `inline` (bisa dipratinjau), sisanya `attachment`;
 * nama asli memakai `filename*` RFC 5987 + fallback ASCII.
 */
function setHeaderLampiran(reply: FastifyReply, meta: LampiranSurat): FastifyReply {
  const ekstensi = path.extname(meta.berkas).toLowerCase();
  const pratinjau = [".pdf", ".jpg", ".jpeg", ".png", ".webp"].includes(ekstensi);
  const ascii = meta.nama.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  return reply
    .header("content-type", TIPE_LAMPIRAN[ekstensi] ?? "application/octet-stream")
    .header("x-content-type-options", "nosniff")
    .header(
      "content-disposition",
      `${pratinjau ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(meta.nama)}`,
    );
}

/** Enum mentah dipertahankan; `tanggal`/`terbitPada` disajikan sebagai ISO. */
function jsonSurat(b: SuratMentah) {
  return {
    id: b.id,
    noSurat: b.noSurat,
    jenis: b.jenisSurat.nama,
    kodeJenis: b.jenisSurat.kode,
    pemohon: b.warga.nama,
    keperluan: b.keperluan,
    status: b.status,
    perluRw: b.perluRw,
    catatan: b.catatanVerifikasi,
    qrToken: b.qrToken,
    noKk: b.noKk || b.warga.kk.noKk,
    diajukanPada: (b.diajukanPada ?? b.createdAt).toISOString(),
    terbitPada: b.terbitPada ? b.terbitPada.toISOString() : null,
    // Batch 9 — hanya `nama`/`tipe`/`ukuran` yang keluar ke klien. Nama berkas
    // tersimpan (UUID di `.data-lampiran/`) adalah detail internal: unduhan
    // murni lewat indeks `:idx`, jadi klien tak pernah membutuhkannya.
    lampiran: bacaLampiran(b.dataPengajuan).map((l) => ({ nama: l.nama, tipe: l.tipe, ukuran: l.ukuran })),
  };
}

/** Ambil `kop` dari isi `template_surat` (null bila belum pernah diisi). */
function bacaKop(templateSurat: unknown): KopSurat | null {
  if (!templateSurat || typeof templateSurat !== "object" || Array.isArray(templateSurat)) return null;
  const isi = (templateSurat as Record<string, unknown>).kop;
  if (!isi || typeof isi !== "object" || Array.isArray(isi)) return null;
  const k = isi as Record<string, unknown>;
  const teks = (kunci: string): string => (typeof k[kunci] === "string" ? (k[kunci] as string) : "");
  const kop = { baris1: teks("baris1"), baris2: teks("baris2"), baris3: teks("baris3") };
  if (!kop.baris1 && !kop.baris2 && !kop.baris3) return null;
  return kop;
}

/**
 * Merge `kop` ke isi `template_surat` LAMA tanpa membuang apapun:
 * objek lama → kunci lain tetap; array lama → dipindahkan ke `daftarTemplate`
 * (seed menulis array definisi field di kolom ini).
 */
function gabungKop(templateSurat: unknown, kop: KopSurat): Prisma.InputJsonValue {
  const dasar: Record<string, unknown> =
    templateSurat && typeof templateSurat === "object" && !Array.isArray(templateSurat)
      ? { ...(templateSurat as Record<string, unknown>) }
      : Array.isArray(templateSurat)
        ? { daftarTemplate: templateSurat }
        : {};
  dasar.kop = { baris1: kop.baris1, baris2: kop.baris2, baris3: kop.baris3 };
  return dasar as unknown as Prisma.InputJsonValue;
}

/** Jenis surat yang butuh persetujuan RW — aturan sama dengan FE `suratPerluRw`. */
function butuhRw(nama: string): boolean {
  return /SKCK|Pindah|Nikah/i.test(nama);
}

/** Kode singkat jenis surat (≤8 karakter) untuk jenis yang dibuat on-demand. */
function kodeDariNama(nama: string): string {
  const kata = nama
    .replace(/[^A-Za-z ]/g, " ")
    .split(/\s+/)
    .filter((k) => k && !/^surat$/i.test(k));
  const kode = kata.map((k) => k[0]).join("").toUpperCase().slice(0, 8);
  return kode || "SL";
}

/** Cari atau buat `jenis_surat` milik RT (nama unik per RT). */
async function jenisSuratUntuk(
  tx: DbTransaksi,
  rtId: string,
  nama: string,
): Promise<{ id: string; nama: string; kode: string; perluRw: boolean }> {
  const ada = await tx.jenisSurat.findUnique({
    where: { rtId_nama: { rtId, nama } },
    select: { id: true, nama: true, kode: true, perluRw: true },
  });
  if (ada) return ada;
  return tx.jenisSurat.create({
    data: { rtId, nama, kode: kodeDariNama(nama), perluRw: butuhRw(nama) },
    select: { id: true, nama: true, kode: true, perluRw: true },
  });
}

/** Token QR unik (48 hex ≤ varchar(64)) — menjadi tautan `/q/:token`. */
function tokenQrBaru(): string {
  return randomBytes(24).toString("hex");
}

/** Input pembuatan baris surat (dipakai rute RT & warga). */
interface BaruSurat {
  jenis: string;
  keperluan: string;
  noSurat: string;
  /** Pemilik surat; rute warga memakai sesi, rute RT mencocokkan nama. */
  warga: { id: string; nama: string; noKk: string };
  /** Metadata lampiran (Batch 9) — sudah tertulis ke `.data-lampiran/` sebelum transaksi. */
  lampiran?: LampiranSurat[];
}

async function buatBarisSurat(
  tx: DbTransaksi,
  rtId: string,
  input: BaruSurat,
): Promise<SuratMentah> {
  const jenis = await jenisSuratUntuk(tx, rtId, input.jenis);
  // Idempoten: nomor unik per RT — permintaan ulang (retry jaringan) mengembalikan
  // baris yang sama, bukan CONFLICT palsu.
  const ada = await tx.surat.findUnique({
    where: { rtId_noSurat: { rtId, noSurat: input.noSurat } },
    select: PilihSurat,
  });
  if (ada) {
    // Retry dengan lampiran: entri (nama + ukuran) yang sudah tercatat tidak
    // diduplikasi; lampiran BARU (baris lama dibuat tanpa lampiran) disematkan.
    const lama = bacaLampiran(ada.dataPengajuan);
    const baru = (input.lampiran ?? []).filter(
      (l) => !lama.some((m) => m.nama === l.nama && m.ukuran === l.ukuran),
    );
    if (!baru.length) return ada;
    return tx.surat.update({
      where: { id: ada.id },
      data: { dataPengajuan: gabungLampiran(ada.dataPengajuan, [...lama, ...baru]) },
      select: PilihSurat,
    });
  }

  return tx.surat.create({
    data: {
      rtId,
      jenisSuratId: jenis.id,
      wargaId: input.warga.id,
      noKk: input.warga.noKk,
      noSurat: input.noSurat,
      keperluan: input.keperluan,
      dataPengajuan: dataPengajuanBaru(input.keperluan, input.lampiran ?? []),
      status: "menunggu_rt",
      perluRw: jenis.perluRw,
      qrToken: tokenQrBaru(),
      diajukanPada: new Date(),
    },
    select: PilihSurat,
  });
}

/** Kolom audit untuk seluruh aksi persuratan (satu tempat, konsisten). */
function inputAudit(
  rtId: string,
  aksi: string,
  badge: string,
  entitasId: string,
  ringkasan: string,
  sebelum: unknown,
  sesudah: unknown,
  /** Entitas baris yang berubah — default `surat` (baris persuratan). */
  entitas: string = "surat",
) {
  return {
    scopeLevel: "rt" as const,
    scopeId: rtId,
    // `actorId` diisi pemanggil (`pengurusAktif`) sebelum `catatAudit`
    actorId: "",
    actorRole: "rt_admin" as const,
    portal: "rt" as const,
    modul: "surat",
    aksi,
    aksiBadge: badge,
    entitas,
    entitasId,
    ringkasan,
    sebelum: sebelum as Prisma.InputJsonValue | null,
    sesudah: sesudah as Prisma.InputJsonValue | null,
  };
}

const skemaQuerySurat = z.object({ status: z.enum(STATUS_QUERY).optional() });
const skemaIdParam = z.object({ id: skemaId });
/** Param unduh lampiran — `idx` indeks array metadata (bukan path, anti traversal). */
const skemaLampiranParam = z.object({
  id: skemaId,
  idx: z.coerce.number().int().min(0).max(MAKS_JUMLAH_LAMPIRAN - 1),
});
const skemaTokenQr = z.object({
  qrToken: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, "Token tidak valid."),
});

const skemaKop = z
  .object({
    baris1: z.string().trim().max(120).optional(),
    baris2: z.string().trim().max(120).optional(),
    baris3: z.string().trim().max(120).optional(),
  })
  .refine(
    (k) => [k.baris1, k.baris2, k.baris3].some((v) => v !== undefined),
    { message: "Tidak ada baris kop yang dikirim." },
  );

/**
 * Profil RT (kontrak §5.4 "Profil" pada `/rt/pengaturan`) — keduanya wajib
 * lengkap bila dikirim: form profil adalah satu unit (nama + alamat).
 */
const skemaProfilRt = z.object({
  namaRt: z
    .string()
    .trim()
    .min(1, "Nama RT wajib diisi.")
    .max(120, "Nama RT maksimal 120 karakter."),
  alamat: z
    .string()
    .trim()
    .min(1, "Alamat lengkap wajib diisi.")
    .max(200, "Alamat lengkap maksimal 200 karakter."),
});

/** Whitelist PATCH /rt/pengaturan — lihat catatan desain di kepala berkas. */
const skemaPatchPengaturan = z
  .object({
    kop: skemaKop.optional(),
    bannerUrl: z.string().trim().max(512).nullable().optional(),
    stempelUrl: z.string().trim().max(512).nullable().optional(),
    kopSuratUrl: z.string().trim().max(512).nullable().optional(),
    notifikasiWaEnabled: z.boolean().optional(),
    modePemeliharaan: z.boolean().optional(),
    profil: skemaProfilRt.optional(),
  })
  .refine(
    (v) =>
      v.kop !== undefined ||
      v.bannerUrl !== undefined ||
      v.stempelUrl !== undefined ||
      v.kopSuratUrl !== undefined ||
      v.notifikasiWaEnabled !== undefined ||
      v.modePemeliharaan !== undefined ||
      v.profil !== undefined,
    { message: "Minimal satu field harus dikirim." },
  );

const skemaBuatSuratRt = z
  .object({
    jenis: z.string().trim().min(3, "Jenis surat wajib diisi.").max(80),
    keperluan: z.string().trim().min(3, "Keperluan wajib diisi.").max(200),
    noSurat: z.string().trim().min(1, "Nomor surat wajib diisi.").max(40),
    pemohon: z.string().trim().min(3).max(120).optional(),
    wargaId: skemaId.optional(),
  })
  .refine((v) => Boolean(v.wargaId || v.pemohon), {
    message: "Wajib mengirim `wargaId` atau `pemohon` (nama warga).",
  });

const skemaBuatSuratWarga = z.object({
  jenis: z.string().trim().min(3, "Jenis surat wajib diisi.").max(80),
  keperluan: z.string().trim().min(3, "Keperluan wajib diisi.").max(200),
  noSurat: z.string().trim().min(1).max(40).optional(),
});

const skemaCatatan = z.object({
  catatan: z.string().trim().max(200).optional(),
});
const skemaAlasanTolak = z.object({
  catatan: z.string().trim().min(3, "Alasan penolakan wajib diisi (min. 3 karakter).").max(200),
});

/** Kolom baris `pengaturan_rt` yang ikut dalam `GET/PATCH /rt/pengaturan`. */
const PilihPengaturanRt = {
  bannerUrl: true,
  stempelUrl: true,
  kopSuratUrl: true,
  notifikasiWaEnabled: true,
  modePemeliharaan: true,
  templateSurat: true,
} as const;

/** Konfigurasi surat untuk `GET/PATCH /rt/pengaturan`. */
function jsonPengaturanSurat(row: {
  bannerUrl: string | null;
  stempelUrl: string | null;
  kopSuratUrl: string | null;
  notifikasiWaEnabled: boolean;
  modePemeliharaan: boolean;
  templateSurat: unknown;
} | null) {
  return {
    kop: row ? bacaKop(row.templateSurat) : null,
    bannerUrl: row?.bannerUrl ?? null,
    stempelUrl: row?.stempelUrl ?? null,
    kopSuratUrl: row?.kopSuratUrl ?? null,
    notifikasiWaEnabled: row?.notifikasiWaEnabled ?? true,
    modePemeliharaan: row?.modePemeliharaan ?? false,
  };
}

/**
 * Profil RT dari baris `rt` (kontrak §5.4). `perumahan` = nama komplek yang
 * dipakai FE sebagai "Nama RT"; `alamat` = alamat lengkap. Kolom induk
 * (`kode_rt`, `kelurahan_id`) TIDAK diekspos di endpoint ini — identifier
 * wilayah bukan bagian form profil.
 */
function jsonProfilRt(row: { perumahan: string | null; alamat: string | null } | null) {
  return { namaRt: row?.perumahan ?? "", alamat: row?.alamat ?? "" };
}

type JsonPengaturanSurat = ReturnType<typeof jsonPengaturanSurat> & {
  profil: ReturnType<typeof jsonProfilRt>;
};

export const ruteRtSurat: FastifyPluginAsync = async (app) => {
  // Multipart TERBATAS untuk scope plugin ini (pola A10): `fileSize` 5 MB,
  // maksimal 3 berkas, 6 field — hanya dipakai `POST /warga/surat` berlampiran;
  // rute lain di scope ini tetap memakai JSON (parser tetap terdaftar, tapi
  // `isMultipart()` yang memilih jalur).
  await app.register(multipart, {
    limits: { fileSize: MAKS_LAMPIRAN_BERKAS, files: MAKS_JUMLAH_LAMPIRAN, fields: 6 },
  });

  // =========================================================================
  // B12 · pengaturan kop & profil visual surat
  // =========================================================================

  /** B12 — baca kop surat + profil visual + profil RT; GET tidak pernah menulis. */
  app.get("/rt/pengaturan", async (req, reply) => {
    const { rtId } = wajibRt(req);
    const hasil = await denganScopeRequest(req, async (tx) => {
      const [pengaturan, barisRt] = await Promise.all([
        tx.pengaturanRt.findUnique({ where: { rtId }, select: PilihPengaturanRt }),
        tx.rt.findUnique({ where: { id: rtId }, select: { perumahan: true, alamat: true } }),
      ]);
      return { pengaturan, barisRt };
    });
    return reply.ok({
      ...jsonPengaturanSurat(hasil.pengaturan),
      profil: jsonProfilRt(hasil.barisRt),
    });
  });

  /**
   * B12 — simpan kop surat / profil RT (parsial, wajib CSRF) + audit ber-diff.
   * Baris `pengaturan_rt` dibuat bila belum ada (upsert seperti B7); `profil`
   * menulis baris `rt` (nama komplek + alamat) pada transaksi yang sama.
   */
  app.patch("/rt/pengaturan", { preHandler: verifikasiCsrf }, async (req, reply) => {
    const { rtId, sesi } = wajibRt(req);
    const input = skemaPatchPengaturan.parse(req.body ?? {});

    const hasil: JsonPengaturanSurat = await denganScopeRequest(req, async (tx) => {
      const oleh = await pengurusAktif(tx, rtId, sesi.subjekId);
      const [lama, rtLama] = await Promise.all([
        tx.pengaturanRt.findUnique({ where: { rtId } }),
        tx.rt.findUnique({ where: { id: rtId }, select: { perumahan: true, alamat: true } }),
      ]);
      const sebelum: JsonPengaturanSurat = {
        ...jsonPengaturanSurat(lama),
        profil: jsonProfilRt(rtLama),
      };

      const data: {
        bannerUrl?: string | null;
        stempelUrl?: string | null;
        kopSuratUrl?: string | null;
        notifikasiWaEnabled?: boolean;
        modePemeliharaan?: boolean;
        templateSurat?: Prisma.InputJsonValue;
      } = {};
      if (input.bannerUrl !== undefined) data.bannerUrl = input.bannerUrl;
      if (input.stempelUrl !== undefined) data.stempelUrl = input.stempelUrl;
      if (input.kopSuratUrl !== undefined) data.kopSuratUrl = input.kopSuratUrl;
      if (input.notifikasiWaEnabled !== undefined) data.notifikasiWaEnabled = input.notifikasiWaEnabled;
      if (input.modePemeliharaan !== undefined) data.modePemeliharaan = input.modePemeliharaan;

      if (input.kop) {
        const kopLama = bacaKop(lama?.templateSurat ?? null) ?? { baris1: "", baris2: "", baris3: "" };
        const kop: KopSurat = {
          baris1: input.kop.baris1 ?? kopLama.baris1,
          baris2: input.kop.baris2 ?? kopLama.baris2,
          baris3: input.kop.baris3 ?? kopLama.baris3,
        };
        if (!kop.baris1 && !kop.baris2 && !kop.baris3) {
          throw new GalatTolak("VALIDATION", "Kop surat minimal punya satu baris yang tidak kosong.");
        }
        data.templateSurat = gabungKop(lama?.templateSurat ?? null, kop);
      }

      // Profil RT → baris `rt`. RLS `p_rt_registry` mengizinkan scope `rt`
      // menulis barisnya sendiri (`id = app.scope_id`), jadi tanpa perlu
      // jalur khusus; tetap dalam transaksi yang sama dengan audit.
      if (input.profil) {
        await tx.rt.update({
          where: { id: rtId },
          data: { perumahan: input.profil.namaRt, alamat: input.profil.alamat },
        });
      }

      // PATCH khusus profil tidak menyentuh `pengaturan_rt` → upsert dilewati
      // (Prisma menolak `update` tanpa field).
      if (Object.keys(data).length > 0) {
        await tx.pengaturanRt.upsert({
          where: { rtId },
          create: { rtId, ...data },
          update: data,
        });
      }

      // Baca ulang: `sesudah` harus mencerminkan baris tersimpan apa adanya
      // (merge kop bisa menyisakan kunci lama seperti `daftarTemplate`).
      const [kini, rtKini] = await Promise.all([
        tx.pengaturanRt.findUnique({ where: { rtId }, select: PilihPengaturanRt }),
        tx.rt.findUnique({ where: { id: rtId }, select: { perumahan: true, alamat: true } }),
      ]);
      const sesudah: JsonPengaturanSurat = {
        ...jsonPengaturanSurat(kini),
        profil: jsonProfilRt(rtKini),
      };
      await catatAudit(
        {
          ...inputAudit(
            rtId,
            "ubah_pengaturan_surat",
            "Pengaturan",
            rtId,
            [
              input.kop ? `kop surat ${sesudah.kop ? "diperbarui" : "dikosongkan"}` : null,
              input.profil ? `profil RT "${input.profil.namaRt}"` : null,
              input.notifikasiWaEnabled !== undefined
                ? `notifikasi WA ${input.notifikasiWaEnabled ? "aktif" : "nonaktif"}`
                : null,
              input.modePemeliharaan !== undefined
                ? `mode pemeliharaan ${input.modePemeliharaan ? "aktif" : "nonaktif"}`
                : null,
              input.bannerUrl !== undefined ||
              input.stempelUrl !== undefined ||
              input.kopSuratUrl !== undefined
                ? "profil visual"
                : null,
            ]
              .filter((x): x is string => x !== null)
              .join(", ") || "tanpa perubahan",
            sebelum,
            sesudah,
            // PATCH khusus profil tak menyentuh `pengaturan_rt` → entitas `rt`.
            input.profil && Object.keys(data).length === 0 ? "rt" : "pengaturan_rt",
          ),
          actorId: oleh,
          ip: req.ipAsli,
        },
        tx,
      );

      return sesudah;
    });

    return reply.ok(hasil);
  });

  // =========================================================================
  // Antrian & penerbitan surat (Portal RT)
  // =========================================================================

  /** B12 — antrian/arsip persuratan RT; `?status=` kosong = seluruh status. */
  app.get("/rt/surat", async (req, reply) => {
    const { rtId } = wajibRt(req);
    const q = skemaQuerySurat.parse(req.query ?? {});

    const daftar = await denganScopeRequest(req, (tx) =>
      tx.surat.findMany({
        where: { rtId, ...(q.status ? { status: q.status } : {}) },
        orderBy: [{ diajukanPada: "desc" }, { createdAt: "desc" }],
        take: 200,
        select: PilihSurat,
      }),
    );

    return reply.ok({ surat: daftar.map(jsonSurat) });
  });

  /**
   * Batch 9 — unduh lampiran pengajuan dari sisi Portal RT (wajib `wajibRt`).
   * Jangkauan baris dijaga RLS `p_scope_rt` lewat `denganScopeRequest`;
   * indeks `:idx` menunjuk metadata lampiran di `data_pengajuan`.
   */
  app.get("/rt/surat/:id/lampiran/:idx", async (req, reply) => {
    const { rtId } = wajibRt(req);
    const p = skemaLampiranParam.parse(req.params);

    const baris = await denganScopeRequest(req, (tx) =>
      tx.surat.findUnique({
        where: { id: p.id },
        select: { rtId: true, dataPengajuan: true },
      }),
    );
    if (!baris || baris.rtId !== rtId) {
      throw new GalatTolak("NOT_FOUND", "Surat tidak ditemukan.");
    }

    const { meta, isi } = await ambilLampiran(baris.dataPengajuan, p.idx);
    setHeaderLampiran(reply, meta);
    return reply.send(isi);
  });

  /**
   * B12 — buat baris surat (deviasi §5.4, lihat kepala berkas).
   * `warga` dicocokkan dengan `wargaId` ATAU nama persis di RT yang sama;
   * tidak ada → VALIDATION (bukan membuat warga baru secara diam-diam).
   * Nomor surat unik per RT → permintaan ulang mengembalikan baris lama.
   */
  app.post("/rt/surat", { preHandler: verifikasiCsrf }, async (req, reply) => {
    const { rtId, sesi } = wajibRt(req);
    const input = skemaBuatSuratRt.parse(req.body ?? {});

    const hasil = await denganScopeRequest(req, async (tx) => {
      const oleh = await pengurusAktif(tx, rtId, sesi.subjekId);

      let warga: { id: string; nama: string; kk: { noKk: string } } | null = null;
      if (input.wargaId) {
        warga = await tx.warga.findUnique({
          where: { id: input.wargaId },
          select: { id: true, nama: true, kk: { select: { noKk: true } } },
        });
      } else if (input.pemohon) {
        // Nama dicocokkan persis (tanpa memedulikan huruf besar/kecil) di RT yang
        // sama — kalau ambigu, warga pertama (terlama) dipakai.
        warga = await tx.warga.findFirst({
          where: { rtId, nama: { equals: input.pemohon, mode: "insensitive" } },
          orderBy: { createdAt: "asc" },
          select: { id: true, nama: true, kk: { select: { noKk: true } } },
        });
      }
      if (!warga) {
        throw new GalatTolak(
          "VALIDATION",
          `Warga "${input.pemohon ?? input.wargaId}" tidak terdaftar di RT ini — tambahkan lewat menu Data Warga.`,
        );
      }

      const baris = await buatBarisSurat(tx, rtId, {
        jenis: input.jenis,
        keperluan: input.keperluan,
        noSurat: input.noSurat,
        warga: { id: warga.id, nama: warga.nama, noKk: warga.kk.noKk },
      });

      await catatAudit(
        {
          ...inputAudit(
            rtId,
            "buat_surat",
            "Surat",
            baris.id,
            `Buat surat ${baris.noSurat} (${baris.jenisSurat.nama}) atas nama ${warga.nama}`,
            null,
            { noSurat: baris.noSurat, status: baris.status },
          ),
          actorId: oleh,
          ip: req.ipAsli,
        },
        tx,
      );

      return baris;
    });

    return reply.ok({ surat: jsonSurat(hasil) });
  });

  /**
   * Penerbitan bersama `terbitkan` & `setujui`: `perlu_rw` → `menunggu_rw`,
   * selain itu `disetujui` + `terbit_pada`. Idempoten (sudah terbit → `ulang`).
   */
  async function terbitkan(
    tx: DbTransaksi,
    req: FastifyRequest,
    rtId: string,
    oleh: string,
    id: string,
    aksi: "terbitkan_surat" | "setujui_surat",
    badge: "Terbit" | "Disetujui",
  ): Promise<{ ulang: boolean; surat: SuratMentah }> {
    const surat = await tx.surat.findFirst({ where: { id }, select: PilihSurat });
    if (!surat) throw new GalatTolak("NOT_FOUND", "Surat tidak ditemukan.");
    if (surat.status === "disetujui" || surat.status === "menunggu_rw") {
      return { ulang: true, surat };
    }
    if (surat.status === "ditolak") {
      throw new GalatTolak("CONFLICT", "Surat sudah ditolak — ajukan ulang lewat Portal Warga.");
    }

    const kini = new Date();
    const target = surat.perluRw ? "menunggu_rw" : "disetujui";
    const diperbarui = await tx.surat.update({
      where: { id: surat.id },
      data: {
        status: target,
        verifikasiRtPada: kini,
        ...(target === "disetujui" ? { terbitPada: kini } : {}),
        disetujuiOleh: oleh,
      },
      select: PilihSurat,
    });

    await catatAudit(
      {
        ...inputAudit(
          rtId,
          aksi,
          badge,
          diperbarui.id,
          `Terbitkan ${diperbarui.noSurat} (${diperbarui.jenisSurat.nama}) — status ${LABEL_STATUS[target]}` +
            (target === "menunggu_rw" ? " (menunggu persetujuan RW)" : ""),
          { status: surat.status },
          { status: target, terbitPada: target === "disetujui" ? kini.toISOString() : null },
        ),
        actorId: oleh,
        ip: req.ipAsli,
      },
      tx,
    );

    return { ulang: false, surat: diperbarui };
  }

  app.post("/rt/surat/:id/terbitkan", { preHandler: verifikasiCsrf }, async (req, reply) => {
    const { rtId, sesi } = wajibRt(req);
    const { id } = skemaIdParam.parse(req.params);
    const hasil = await denganScopeRequest(req, async (tx) => {
      const oleh = await pengurusAktif(tx, rtId, sesi.subjekId);
      return terbitkan(tx, req, rtId, oleh, id, "terbitkan_surat", "Terbit");
    });
    return reply.ok({ ulang: hasil.ulang, surat: jsonSurat(hasil.surat) });
  });

  /** Persetujuan RT — alur & aturan identik dengan `terbitkan` (kontrak §5.4). */
  app.post("/rt/surat/:id/setujui", { preHandler: verifikasiCsrf }, async (req, reply) => {
    const { rtId, sesi } = wajibRt(req);
    const { id } = skemaIdParam.parse(req.params);
    const hasil = await denganScopeRequest(req, async (tx) => {
      const oleh = await pengurusAktif(tx, rtId, sesi.subjekId);
      return terbitkan(tx, req, rtId, oleh, id, "setujui_surat", "Disetujui");
    });
    return reply.ok({ ulang: hasil.ulang, surat: jsonSurat(hasil.surat) });
  });

  /** Tolak surat — alasan wajib; surat sudah terbit tidak bisa ditolak. */
  app.post("/rt/surat/:id/tolak", { preHandler: verifikasiCsrf }, async (req, reply) => {
    const { rtId, sesi } = wajibRt(req);
    const { id } = skemaIdParam.parse(req.params);
    const { catatan } = skemaAlasanTolak.parse(req.body ?? {});

    const hasil = await denganScopeRequest(req, async (tx) => {
      const oleh = await pengurusAktif(tx, rtId, sesi.subjekId);
      const surat = await tx.surat.findFirst({ where: { id }, select: PilihSurat });
      if (!surat) throw new GalatTolak("NOT_FOUND", "Surat tidak ditemukan.");
      if (surat.status === "disetujui") {
        throw new GalatTolak("CONFLICT", "Surat sudah terbit — tidak bisa ditolak.");
      }
      if (surat.status === "ditolak") return { ulang: true, surat };

      const diperbarui = await tx.surat.update({
        where: { id: surat.id },
        data: { status: "ditolak", catatanVerifikasi: catatan, verifikasiRtPada: new Date(), disetujuiOleh: oleh },
        select: PilihSurat,
      });
      await catatAudit(
        {
          ...inputAudit(
            rtId,
            "tolak_surat",
            "Ditolak",
            diperbarui.id,
            `Tolak ${diperbarui.noSurat} (${diperbarui.jenisSurat.nama}) — ${catatan}`,
            { status: surat.status },
            { status: "ditolak", catatan },
          ),
          actorId: oleh,
          ip: req.ipAsli,
        },
        tx,
      );
      return { ulang: false, surat: diperbarui };
    });

    return reply.ok({ ulang: hasil.ulang, surat: jsonSurat(hasil.surat) });
  });

  /** Minta perbaikan — kembalikan ke pemohon dengan catatan (opsional). */
  app.post("/rt/surat/:id/minta-perbaikan", { preHandler: verifikasiCsrf }, async (req, reply) => {
    const { rtId, sesi } = wajibRt(req);
    const { id } = skemaIdParam.parse(req.params);
    const { catatan } = skemaCatatan.parse(req.body ?? {});

    const hasil = await denganScopeRequest(req, async (tx) => {
      const oleh = await pengurusAktif(tx, rtId, sesi.subjekId);
      const surat = await tx.surat.findFirst({ where: { id }, select: PilihSurat });
      if (!surat) throw new GalatTolak("NOT_FOUND", "Surat tidak ditemukan.");
      if (surat.status === "disetujui") {
        throw new GalatTolak("CONFLICT", "Surat sudah terbit — tidak bisa diminta perbaikan.");
      }
      if (surat.status === "perlu_perbaikan") return { ulang: true, surat };

      const diperbarui = await tx.surat.update({
        where: { id: surat.id },
        data: {
          status: "perlu_perbaikan",
          catatanVerifikasi: catatan ?? surat.catatanVerifikasi,
          verifikasiRtPada: new Date(),
          disetujuiOleh: oleh,
        },
        select: PilihSurat,
      });
      await catatAudit(
        {
          ...inputAudit(
            rtId,
            "minta_perbaikan_surat",
            "Perbaikan",
            diperbarui.id,
            `Minta perbaikan ${diperbarui.noSurat} (${diperbarui.jenisSurat.nama})` +
              (catatan ? ` — ${catatan}` : ""),
            { status: surat.status },
            { status: "perlu_perbaikan", catatan: catatan ?? null },
          ),
          actorId: oleh,
          ip: req.ipAsli,
        },
        tx,
      );
      return { ulang: false, surat: diperbarui };
    });

    return reply.ok({ ulang: hasil.ulang, surat: jsonSurat(hasil.surat) });
  });

  // =========================================================================
  // Portal Warga — daftar & ajukan surat (§5.3)
  // =========================================================================

  /**
   * B12 — daftar surat MILIK sesi warga + kop surat untuk unduhan PDF.
   * `wajibWarga` menjamin `warga_id` sesi; filter eksplisit diperlukan karena
   * RLS scope-nya setingkat RT (baris warga lain ikut terlihat oleh scope).
   */
  app.get("/warga/surat", async (req, reply) => {
    const { rtId, wargaId } = wajibWarga(req);
    const q = skemaQuerySurat.parse(req.query ?? {});

    const hasil = await denganScopeRequest(req, async (tx) => {
      const [surat, pengaturan] = await Promise.all([
        tx.surat.findMany({
          where: { rtId, wargaId, ...(q.status ? { status: q.status } : {}) },
          orderBy: [{ diajukanPada: "desc" }, { createdAt: "desc" }],
          take: 100,
          select: PilihSurat,
        }),
        tx.pengaturanRt.findUnique({ where: { rtId }, select: { templateSurat: true } }),
      ]);
      return { surat, kop: bacaKop(pengaturan?.templateSurat ?? null) };
    });

    return reply.ok({ kop: hasil.kop, surat: hasil.surat.map(jsonSurat) });
  });

  /**
   * B12 — ajukan surat dari Portal Warga. TANPA `verifikasiCsrf` mengikuti
   * seluruh rute warga (§5.6). Pemilik = sesi warga (bukan input klien).
   *
   * Batch 9 — dua bentuk diterima: `application/json` (jalur lama, tanpa
   * lampiran) ATAU `multipart/form-data` (field + ≤3 lampiran). Berkas ditulis
   * ke `.data-lampiran/` SEBELUM transaksi (pola A10 — `file_url` tidak bohong):
   * gagal menulis → 500 tanpa baris surat; transaksi gagal → berkas dihapus
   * kembali (tidak ada file yatim). Berkas yang tidak tercatat pada baris
   * akhir (retry idempoten yang menolak duplikat) ikut dibersihkan.
   */
  app.post("/warga/surat", async (req, reply) => {
    const { rtId, wargaId } = wajibWarga(req);

    let input: z.infer<typeof skemaBuatSuratWarga>;
    let berkasMentah: BerkasMentah[] = [];
    if (req.isMultipart()) {
      const hasilBaca = await bacaAjukanMultipart(req);
      input = hasilBaca.input;
      berkasMentah = hasilBaca.berkas;
    } else {
      input = skemaBuatSuratWarga.parse(req.body ?? {});
    }

    const lampiran = await tulisLampiran(berkasMentah);

    let hasil: SuratMentah;
    try {
      hasil = await denganScopeRequest(req, async (tx) => {
        const warga = await tx.warga.findUnique({
          where: { id: wargaId },
          select: { id: true, nama: true, kk: { select: { noKk: true } } },
        });
        if (!warga) throw new GalatTolak("UNAUTHORIZED", "Data warga sesi tidak ditemukan.");

        const jenis = await jenisSuratUntuk(tx, rtId, input.jenis);
        const noSurat = input.noSurat ?? (await nomorSuratBerikutnya(tx, rtId, jenis.kode));
        const baris = await buatBarisSurat(tx, rtId, {
          jenis: input.jenis,
          keperluan: input.keperluan,
          noSurat,
          warga: { id: warga.id, nama: warga.nama, noKk: warga.kk.noKk },
          ...(lampiran.length ? { lampiran } : {}),
        });

        const jumlahLampiran = bacaLampiran(baris.dataPengajuan).length;
        await catatAudit(
          {
            scopeLevel: "rt",
            scopeId: rtId,
            actorId: wargaId,
            actorRole: "warga",
            portal: "warga",
            modul: "surat",
            aksi: "ajukan_surat",
            aksiBadge: "Pengajuan",
            entitas: "surat",
            entitasId: baris.id,
            sebelum: null,
            sesudah: {
              noSurat: baris.noSurat,
              jenis: baris.jenisSurat.nama,
              status: baris.status,
              jumlahLampiran,
            },
            ringkasan: `Ajukan ${baris.jenisSurat.nama} (${baris.noSurat}) — ${baris.keperluan}${
              jumlahLampiran ? ` (+${jumlahLampiran} lampiran)` : ""
            }`,
            ip: req.ipAsli,
          },
          tx,
        );

        return baris;
      });
    } catch (e) {
      // Transaksi gagal / warga tak ditemukan → berkas yang baru ditulis dibuang.
      await hapusLampiran(lampiran);
      throw e;
    }

    // Retry idempoten: baris sudah ada dengan entri lampiran sama → berkas
    // duplikat tidak tercatat di DB, jadi file fisiknya ikut dibuang di sini.
    const tercatat = new Set(bacaLampiran(hasil.dataPengajuan).map((l) => l.berkas));
    await hapusLampiran(lampiran.filter((l) => !tercatat.has(l.berkas)));

    return reply.ok({ surat: jsonSurat(hasil) });
  });

  /**
   * Batch 9 — unduh lampiran pengajuan sebagai SESI WARGA pemilik.
   * Filter `wargaId` wajib eksplisit: RLS scope-nya setingkat RT (baris warga
   * lain ikut terlihat oleh scope, sama seperti `GET /warga/surat`).
   */
  app.get("/warga/surat/:id/lampiran/:idx", async (req, reply) => {
    const { rtId, wargaId } = wajibWarga(req);
    const p = skemaLampiranParam.parse(req.params);

    const baris = await denganScopeRequest(req, (tx) =>
      tx.surat.findUnique({
        where: { id: p.id },
        select: { rtId: true, wargaId: true, dataPengajuan: true },
      }),
    );
    if (!baris || baris.rtId !== rtId || baris.wargaId !== wargaId) {
      throw new GalatTolak("NOT_FOUND", "Surat tidak ditemukan.");
    }

    const { meta, isi } = await ambilLampiran(baris.dataPengajuan, p.idx);
    setHeaderLampiran(reply, meta);
    return reply.send(isi);
  });

  // =========================================================================
  // PUBLIK — verifikasi QR (§5.7 · P0)
  // =========================================================================

  /**
   * B12 (P0) — cek keaslian surat lewat token QR `/q/:token`.
   *
   * TIDAK memakai `denganScopeRequest`: permintaan publik tidak punya sesi
   * sehingga `request.pemohon` bernilai `null`. Kueri berjalan pada scope
   * `platform` (pemecah kebijakan `p_scope_rt`, migration RLS baris 176) —
   * jalur yang sama dengan `dalamScopePlat` pada tes.
   *
   * Jawaban SELALU 200 dengan `{ valid }` (tanpa status 404) agar endpoint ini
   * tidak dipakai untuk enumerasi token; token tak dikenal & surat belum terbit
   * sama-sama `valid: false` tetapi dengan `alasan` berbeda. Baris contoh/demo
   * yang tidak punya baris server menjawab `valid: false` — verifikasi tidak
   * pernah dipalsukan di sisi mana pun.
   */
  app.get("/publik/verifikasi-surat/:qrToken", async (req, reply) => {
    const p = skemaTokenQr.safeParse(req.params);
    if (!p.success) {
      return reply.ok({ valid: false, alasan: "Token verifikasi tidak valid." });
    }

    const surat = await denganScope("platform", null, (tx) =>
      tx.surat.findUnique({
        where: { qrToken: p.data.qrToken },
        select: {
          noSurat: true,
          status: true,
          perluRw: true,
          diajukanPada: true,
          terbitPada: true,
          jenisSurat: { select: { nama: true, kode: true } },
          warga: { select: { nama: true } },
          rt: {
            select: {
              kodeRt: true,
              perumahan: true,
              rw: { select: { kodeRw: true } },
              kelurahan: { select: { nama: true } },
            },
          },
        },
      }),
    );

    if (!surat) {
      return reply.ok({
        valid: false,
        alasan: "Token tidak tercatat di sistem SIWARGA — surat ini tidak sah.",
      });
    }
    if (surat.status !== "disetujui") {
      return reply.ok({
        valid: false,
        alasan: `Surat berstatus "${LABEL_STATUS[surat.status] ?? surat.status}" — belum diterbitkan.`,
      });
    }

    return reply.ok({
      valid: true,
      surat: {
        noSurat: surat.noSurat,
        jenis: surat.jenisSurat.nama,
        kodeJenis: surat.jenisSurat.kode,
        status: surat.status,
        perluRw: surat.perluRw,
        pemohon: surat.warga.nama,
        diajukanPada: surat.diajukanPada ? surat.diajukanPada.toISOString() : null,
        terbitPada: surat.terbitPada ? surat.terbitPada.toISOString() : null,
        rt: {
          kodeRt: surat.rt.kodeRt,
          kodeRw: surat.rt.rw.kodeRw,
          perumahan: surat.rt.perumahan,
          kelurahan: surat.rt.kelurahan.nama,
        },
      },
    });
  });
};

/**
 * Nomor surat berikutnya untuk RT — format sama dengan `generateNoSurat()` FE
 * (`SKP/04-012/09/2026/013`). Hanya dipanggil bila klien tidak mengirim nomor.
 */
async function nomorSuratBerikutnya(
  tx: DbTransaksi,
  rtId: string,
  kode: string,
): Promise<string> {
  const rt = await tx.rt.findUnique({
    where: { id: rtId },
    select: { kodeRt: true, rw: { select: { kodeRw: true } } },
  });
  const daftar = await tx.surat.findMany({ where: { rtId }, select: { noSurat: true }, take: 1000 });
  const urut = daftar
    .map((b) => Number((b.noSurat.match(/\/(\d{1,3})$/) ?? [])[1] ?? 0))
    .filter((n) => Number.isFinite(n) && n > 0);
  const berikut = (urut.length ? Math.max(...urut) : 0) + 1;
  const kini = new Date();
  const bulan = String(kini.getMonth() + 1).padStart(2, "0");
  const pendek = rt ? `${rt.kodeRt}-${rt.rw.kodeRw}` : "00-000";
  return `${kode}/${pendek}/${bulan}/${kini.getFullYear()}/${String(berikut).padStart(3, "0")}`;
}
