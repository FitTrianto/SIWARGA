/**
 * Persuratan resmi & verifikasi publik — PRD §6.6 (task B12 · P0).
 *
 *   GET    /rt/pengaturan                    → kop surat + profil visual (B12)
 *   PATCH  /rt/pengaturan                    → simpan kop (whitelist, wajib CSRF)
 *   GET    /rt/surat?status=                 → antrian & arsip persuratan RT
 *   POST   /rt/surat                         → buat baris surat (lihat deviasi)
 *   POST   /rt/surat/:id/terbitkan           → alur RW otomatis bila `perlu_rw`
 *   POST   /rt/surat/:id/setujui             → persetujuan RT (alias terbitkan)
 *   POST   /rt/surat/:id/tolak               → `ditolak` + alasan wajib
 *   POST   /rt/surat/:id/minta-perbaikan     → `perlu_perbaikan` + catatan
 *   GET    /warga/surat?status=              → daftar surat milik sesi + kop
 *   POST   /warga/surat                      → ajukan surat (form Portal Warga)
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
 *     `stempelUrl`, `kopSuratUrl`, `notifikasiWaEnabled`, `modePemeliharaan`
 *     (sesuai ringkasan kontrak §5.4). Field iuran (`modeAlokasi`, `tenggatHari`,
 *     `dendaAktif`, `ambangApprovalKas`) TIDAK diterima di sini karena sudah
 *     dimiliki `GET/PATCH /rt/iuran/pengaturan` (B7) — dua tulis ke baris yang
 *     sama dari dua endpoint berbeda akan saling menimpa.
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
 *
 * Guard §5.0: rute `/rt/**` memakai `wajibRt`, rute `/warga/**` memakai
 * `wajibWarga` tanpa `verifikasiCsrf` (§5.6). Jangkauan data dijaga RLS
 * `p_scope_rt` lewat `denganScopeRequest`; rute PUBLIK memakai
 * `denganScope("platform", …)` karena tidak ada sesi (lihat catatan di bawah).
 * Setiap mutasi mencatat `audit_log` (append-only) dengan diff sebelum/sesudah.
 */
import { randomBytes } from "node:crypto";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
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
  jenisSurat: { nama: string; kode: string };
  warga: { nama: string; kk: { noKk: string } };
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
  if (ada) return ada;

  return tx.surat.create({
    data: {
      rtId,
      jenisSuratId: jenis.id,
      wargaId: input.warga.id,
      noKk: input.warga.noKk,
      noSurat: input.noSurat,
      keperluan: input.keperluan,
      dataPengajuan: { keperluan: input.keperluan, sumber: "portal" },
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

/** Whitelist PATCH /rt/pengaturan — lihat catatan desain di kepala berkas. */
const skemaPatchPengaturan = z
  .object({
    kop: skemaKop.optional(),
    bannerUrl: z.string().trim().max(512).nullable().optional(),
    stempelUrl: z.string().trim().max(512).nullable().optional(),
    kopSuratUrl: z.string().trim().max(512).nullable().optional(),
    notifikasiWaEnabled: z.boolean().optional(),
    modePemeliharaan: z.boolean().optional(),
  })
  .refine(
    (v) =>
      v.kop !== undefined ||
      v.bannerUrl !== undefined ||
      v.stempelUrl !== undefined ||
      v.kopSuratUrl !== undefined ||
      v.notifikasiWaEnabled !== undefined ||
      v.modePemeliharaan !== undefined,
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

type JsonPengaturanSurat = ReturnType<typeof jsonPengaturanSurat>;

export const ruteRtSurat: FastifyPluginAsync = async (app) => {
  // =========================================================================
  // B12 · pengaturan kop & profil visual surat
  // =========================================================================

  /** B12 — baca kop surat + profil visual; GET tidak pernah menulis. */
  app.get("/rt/pengaturan", async (req, reply) => {
    const { rtId } = wajibRt(req);
    const baris = await denganScopeRequest(req, (tx) =>
      tx.pengaturanRt.findUnique({
        where: { rtId },
        select: {
          bannerUrl: true,
          stempelUrl: true,
          kopSuratUrl: true,
          notifikasiWaEnabled: true,
          modePemeliharaan: true,
          templateSurat: true,
        },
      }),
    );
    return reply.ok(jsonPengaturanSurat(baris));
  });

  /**
   * B12 — simpan kop surat (parsial, wajib CSRF) + audit ber-diff.
   * Baris `pengaturan_rt` dibuat bila belum ada (upsert seperti B7).
   */
  app.patch("/rt/pengaturan", { preHandler: verifikasiCsrf }, async (req, reply) => {
    const { rtId, sesi } = wajibRt(req);
    const input = skemaPatchPengaturan.parse(req.body ?? {});

    const hasil: JsonPengaturanSurat = await denganScopeRequest(req, async (tx) => {
      const oleh = await pengurusAktif(tx, rtId, sesi.subjekId);
      const lama = await tx.pengaturanRt.findUnique({ where: { rtId } });
      const sebelum = jsonPengaturanSurat(lama);

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

      await tx.pengaturanRt.upsert({
        where: { rtId },
        create: { rtId, ...data },
        update: data,
      });

      // Baca ulang: `sesudah` harus mencerminkan baris tersimpan apa adanya
      // (merge kop bisa menyisakan kunci lama seperti `daftarTemplate`).
      const kini = await tx.pengaturanRt.findUnique({
        where: { rtId },
        select: {
          bannerUrl: true,
          stempelUrl: true,
          kopSuratUrl: true,
          notifikasiWaEnabled: true,
          modePemeliharaan: true,
          templateSurat: true,
        },
      });
      const sesudah = jsonPengaturanSurat(kini);
      await catatAudit(
        {
          ...inputAudit(
            rtId,
            "ubah_pengaturan_surat",
            "Pengaturan",
            rtId,
            `Ubah pengaturan surat: kop ${sesudah.kop ? "diperbarui" : "tidak berubah"}` +
              (input.modePemeliharaan !== undefined
                ? `, mode pemeliharaan ${input.modePemeliharaan ? "aktif" : "nonaktif"}`
                : ""),
            sebelum,
            sesudah,
            "pengaturan_rt",
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
   */
  app.post("/warga/surat", async (req, reply) => {
    const { rtId, wargaId } = wajibWarga(req);
    const input = skemaBuatSuratWarga.parse(req.body ?? {});

    const hasil = await denganScopeRequest(req, async (tx) => {
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
      });

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
          sesudah: { noSurat: baris.noSurat, jenis: baris.jenisSurat.nama, status: baris.status },
          ringkasan: `Ajukan ${baris.jenisSurat.nama} (${baris.noSurat}) — ${baris.keperluan}`,
          ip: req.ipAsli,
        },
        tx,
      );

      return baris;
    });

    return reply.ok({ surat: jsonSurat(hasil) });
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
