/**
 * Iuran Portal Warga — PRD §5.3 (task B10 status turunan · B7 bukti) · F-3.
 *
 *   GET  /warga/iuran/tagihan?periode=      → tagihan periode + status turunan
 *   GET  /warga/iuran/riwayat?dari=&sampai= → riwayat pembayaran + alokasi
 *   GET  /warga/iuran/kondisional           → tagihan insidental milik sendiri
 *   POST /warga/iuran/bukti                 → ajukan bukti (menunggu_verifikasi)
 *                                              JSON ATAU multipart (file struk
 *                                              ≤5 MB — Batch 15E, penyimpanan F-5)
 *   GET  /warga/iuran/pembayaran/:id/bukti  → unduh file bukti milik sendiri
 *                                              (Batch 15E; pasangan rute RT di
 *                                              plugin ini → bukti tampil 2 portal)
 *
 * Aturan §4.6 yang ditegakkan di sini:
 *   • SELURUH query lewat `denganScopeRequest` (scope RT milik warga login);
 *   • setiap kueri ikut membatasi `warga_id = sesi.subjekId` — RLS hanya
 *     memberi visibilitas setingkat RT, "hanya boleh membaca data sendiri"
 *     tetap menjadi tanggung jawab aplikasi;
 *   • status tagihan DITURUNKAN dari `sisa` (bukan dari pembayaran terakhir)
 *     dan keringanan dilaporkan terpisah (§4.4).
 *
 * Bukti transfer diverifikasi pengurus di `routes/iuranRt.ts`; sampai saat itu
 * pembayaran bernilai `menunggu_verifikasi` dan TIDAK mengurangi `tagihan.sisa`
 * (baru berkurang setelah alokasi FIFO berjalan).
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import multipart from "@fastify/multipart";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { config } from "../config.js";
import { catatAudit } from "../plugins/audit.js";
import { GalatTolak, wajibRt, wajibWarga } from "../plugins/guard.js";
import { denganScopeRequest } from "../plugins/scope.js";
import { tanggalPendek } from "../services/alokasiRepo.js";
import { statusTurunan } from "../services/statusTagihan.js";
import {
  LABEL_PEMBAYARAN,
  headerIdempotensi,
  periodeKeRentang,
  ringkasPembayaran,
  skemaId,
  skemaPeriode,
} from "./iuranUmum.js";

const r2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

const skemaQueryTagihan = z.object({ periode: skemaPeriode.optional() });
const skemaQueryRiwayat = z.object({ dari: skemaPeriode.optional(), sampai: skemaPeriode.optional() });
const skemaBukti = z.object({
  nominal: z.coerce.number().positive("Nominal harus lebih dari 0.").max(1_000_000_000),
  metode: z.enum(["tunai", "transfer", "qris", "lainnya"]).default("transfer"),
  catatan: z.string().trim().max(200).optional(),
  /** referensi bukti (mis. no. mutasi); file struk Batch 15E → `buktiUrl` = nama berkas tersimpan. */
  buktiUrl: z.string().trim().max(512).optional(),
});

// ─── Batch 15E · file bukti (penyimpanan berkas F-5) ─────────────────────────

/** Folder file bukti — pola sama `.data-lampiran` (naik 2 tingkat dari `src/`/`dist/`). */
const DIR_BUKTI = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  ".data-bukti",
);

/** Konten-tipe disusun dari EKSTENSI berkas tersimpan (bukan MIME klaim klien). */
const TIPE_BUKTI: Record<string, string> = {
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
};

/** Daftar putih ekstensi bukti: JPG/PNG/PDF saja. */
const EKSTENSI_BUKTI = new Set(Object.keys(TIPE_BUKTI));

/** Nama file tersimpan — UUID + ekstensi hasil tulisan server (tolak path traversal). */
const NAMA_BERKAS_BUKTI =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,8}$/i;

/** Batas ukuran file bukti (ditegakkan busboy lewat limit multipart). */
const MAKS_BERKAS_BUKTI = 5 * 1024 * 1024;

/** File struk mentah hasil parse multipart (belum tertulis ke disk). */
interface BerkasBukti {
  /** Nama asli dari klien (dipakai hitung ekstensi + pesan galat saja). */
  nama: string;
  isi: Buffer;
  ekstensi: string;
}

/**
 * Baca `POST /warga/iuran/bukti` — dua bentuk sah:
 *   • JSON polos (jalur QRIS/tunai/klien lama) → `skemaBukti` langsung;
 *   • `multipart/form-data` (Batch 15E): field teks + ≤1 file struk
 *     (JPG/PNG/PDF, maks 5 MB — limit `@fastify/multipart`).
 *
 * Batas multipart dilempar busboy sebagai kode `FST_*` ber-status 413 —
 * dipetakan ke `VALIDATION` (400) dengan pesan Indonesia per kasus; galat
 * validasi sendiri (GalatTolak) diteruskan apa adanya.
 */
async function bacaBukti(req: FastifyRequest): Promise<{
  input: z.infer<typeof skemaBukti>;
  berkas: BerkasBukti | null;
}> {
  if (!req.isMultipart()) {
    return { input: skemaBukti.parse(req.body ?? {}), berkas: null };
  }

  const PESAN_FST: Record<string, string> = {
    FST_REQ_FILE_TOO_LARGE: "Ukuran file bukti melebihi 5 MB.",
    FST_FILES_LIMIT: "Cukup satu file bukti per pengajuan.",
    FST_FIELDS_LIMIT: "Terlalu banyak field pada pengajuan bukti.",
    FST_PARTS_LIMIT: "Terlalu banyak bagian pada pengajuan bukti.",
  };

  const kolom: Record<string, string> = {};
  let berkas: BerkasBukti | null = null;
  try {
    for await (const part of req.parts()) {
      if (part.type === "file") {
        // Stream SELALU dibaca dulu (dibatasi 5 MB oleh busboy) SEBELUM
        // validasi apa pun — membuang part di tengah jalan membuat busboy
        // menahan parser pada stream yang tak pernah dibaca (backpressure)
        // dan permintaan bisa menggantung. Pola A10: baca dulu, baru validasi.
        const isi = await part.toBuffer();
        if (berkas) throw new GalatTolak("VALIDATION", "Cukup satu file bukti per pengajuan.");
        const nama = (part.filename ?? "").trim().slice(0, 200);
        if (!nama) throw new GalatTolak("VALIDATION", "Nama file bukti tidak ditemukan.");
        // Ekstensi divalidasi dari NAMA berkas; MIME yang diklaim klien tidak dipercaya.
        const ekstensi = path.extname(nama).toLowerCase();
        if (!EKSTENSI_BUKTI.has(ekstensi)) {
          throw new GalatTolak(
            "VALIDATION",
            `Format file "${ekstensi || "(tanpa ekstensi)"}" tidak didukung — gunakan JPG, PNG, atau PDF.`,
          );
        }
        berkas = { nama, isi, ekstensi };
      } else {
        kolom[part.fieldname] = String(part.value ?? "");
      }
    }
  } catch (e) {
    if (e instanceof GalatTolak) throw e;
    const kode = (e as { code?: string }).code;
    if (typeof kode === "string" && kode.startsWith("FST_")) {
      throw new GalatTolak("VALIDATION", PESAN_FST[kode] ?? "File bukti tidak valid.");
    }
    throw e;
  }

  // Field opsional kosong → hilangkan agar lolos validasi skema sebagai undefined.
  const input = skemaBukti.parse({
    nominal: kolom.nominal,
    ...(kolom.metode ? { metode: kolom.metode } : {}),
    ...(kolom.catatan ? { catatan: kolom.catatan } : {}),
    ...(kolom.buktiUrl ? { buktiUrl: kolom.buktiUrl } : {}),
  });
  return { input, berkas };
}

export const ruteIuranWarga: FastifyPluginAsync = async (app) => {
  // Batch 15E — multipart ter-encapsulate DI SINI (pola A10/impor): hanya
  // rute di plugin ini yang menerima `multipart/form-data`; limit 5 MB,
  // 1 file, 4 field ditegakkan busboy (kode FST_* → 400 di `bacaBukti`).
  await app.register(multipart, {
    limits: { fileSize: MAKS_BERKAS_BUKTI, files: 1, fields: 4 },
  });

  app.get("/warga/iuran/tagihan", async (req, reply) => {
    const { wargaId, rtId } = wajibWarga(req);
    const { periode = config.periodeAktif } = skemaQueryTagihan.parse(req.query);

    const data = await denganScopeRequest(req, async (tx) => {
      const tagihan = await tx.tagihan.findMany({
        where: { rtId, wargaId, periode },
        include: { kategori: { select: { nama: true, urutan: true } } },
        orderBy: [{ dibuatPada: "asc" }],
      });
      const keringanan = await tx.keringanan.findMany({
        where: { rtId, wargaId, status: "aktif", statusApproval: "disetujui" },
        select: { kategoriId: true, periodeMulai: true, periodeSampai: true },
      });
      const menunggu = await tx.pembayaran.count({
        where: { rtId, wargaId, status: "menunggu_verifikasi" },
      });
      // Batch 19 · master kategori iuran RT milik warga login — sumber rincian
      // tagihan di Portal Warga. Sebelumnya FE jatuh ke kategori CONTOH bila
      // state kosong (laporan bug: warga RT baru melihat "Iuran RT Rp 25.000…
      // Kasbon RW" fiktif). Tenant baru → daftar KOSONG (jujur).
      const kategoriMaster = await tx.kategoriIuran.findMany({
        where: { rtId },
        orderBy: [{ urutan: "asc" }, { nama: "asc" }],
        select: {
          id: true,
          nama: true,
          tipeTarif: true,
          nominalDefault: true,
          sifat: true,
          statusAktif: true,
          urutan: true,
        },
      });

      const baris = tagihan.map((t) => {
        const keringananAktif = keringanan.some(
          (k) =>
            k.kategoriId === t.kategoriId &&
            k.periodeMulai <= periode &&
            (!k.periodeSampai || k.periodeSampai >= periode),
        );
        const h = statusTurunan({
          sisa: Number(t.sisa),
          nominalAwal: Number(t.nominal),
          periode: t.periode,
          periodeAktif: config.periodeAktif,
          keringananAktif,
        });
        return {
          id: t.id,
          kategoriId: t.kategoriId,
          kategori: t.kategori.nama,
          urutan: t.kategori.urutan,
          nominal: Number(t.nominal),
          nominalAwal: Number(t.nominalAwal),
          sisa: Number(t.sisa),
          tenggat: t.tenggat ? tanggalPendek(t.tenggat) : null,
          status: h.status,
          label: h.label,
          menunggak: h.menunggak,
          bulanTunggak: h.bulanTunggak,
          keringananAktif: h.keringananAktif,
        };
      });

      const totalTagihan = r2(baris.reduce((a, b) => a + b.nominal, 0));
      const totalSisa = r2(baris.reduce((a, b) => a + b.sisa, 0));
      const totalTerbayar = r2(totalTagihan - totalSisa);

      const status =
        baris.length === 0
          ? { status: "belum_bayar", label: "Belum Bayar" }
          : totalSisa <= 0
            ? { status: "lunas", label: "Lunas" }
            : menunggu > 0
              ? { status: "menunggu_verifikasi", label: "Menunggu Verifikasi" }
              : totalTerbayar > 0
                ? { status: "sebagian", label: "Sebagian" }
                : { status: "belum_bayar", label: "Belum Bayar" };

      return {
        periode,
        kategori: kategoriMaster.map((k) => ({
          ...k,
          nominalDefault: Number(k.nominalDefault),
        })),
        tagihan: baris,
        ringkas: {
          totalTagihan,
          totalSisa,
          totalTerbayar,
          menungguVerifikasi: menunggu,
          ...status,
        },
      };
    });

    return reply.ok(data);
  });

  app.get("/warga/iuran/riwayat", async (req, reply) => {
    const { wargaId, rtId } = wajibWarga(req);
    const { dari, sampai } = skemaQueryRiwayat.parse(req.query);

    const rentang: { gte?: Date; lte?: Date } = {};
    if (dari) rentang.gte = periodeKeRentang(dari).awal;
    if (sampai) rentang.lte = periodeKeRentang(sampai).akhir;

    const riwayat = await denganScopeRequest(req, async (tx) => {
      const pembayaran = await tx.pembayaran.findMany({
        where: {
          rtId,
          wargaId,
          ...(Object.keys(rentang).length > 0 ? { tanggal: rentang } : {}),
        },
        include: {
          alokasiList: {
            orderBy: { urutan: "asc" },
            include: { tagihan: { include: { kategori: { select: { nama: true } } } } },
          },
        },
        orderBy: [{ tanggal: "desc" }, { createdAt: "desc" }],
        take: 200,
      });

      return pembayaran.map((p) => ({
        ...ringkasPembayaran(p),
        periode: p.alokasiList[0]?.tagihan.periode ?? null,
        alokasi: p.alokasiList.map((a) => ({
          tagihanId: a.tagihanId,
          kategori: a.tagihan.kategori.nama,
          periode: a.tagihan.periode,
          nominal: Number(a.nominalDialokasikan),
        })),
      }));
    });

    const jumlah = (status: string): number =>
      riwayat.filter((p) => p.status === status).reduce((a, p) => a + p.nominal, 0);

    return reply.ok({
      riwayat,
      ringkas: {
        totalLunas: r2(jumlah("lunas")),
        totalMenunggu: r2(jumlah("menunggu_verifikasi")),
        totalDitolak: r2(jumlah("ditolak")),
        label: riwayat.length === 0 ? "Belum Ada Pembayaran" : `${riwayat.length} transaksi`,
      },
    });
  });

  /**
   * Tagihan kondisional (insidental) milik warga login — semua periode,
   * status turunan dari `sisa` (§4.4). Sumbernya `POST /rt/iuran/kondisional`
   * (Portal RT); baris dengan `sisa > 0` adalah yang harus dibayar warga.
   */
  app.get("/warga/iuran/kondisional", async (req, reply) => {
    const { wargaId, rtId } = wajibWarga(req);

    const daftar = await denganScopeRequest(req, async (tx) => {
      const tagihan = await tx.tagihan.findMany({
        where: { rtId, wargaId, sumber: "insidental" },
        include: { kategori: { select: { id: true, nama: true } } },
        orderBy: [{ periode: "desc" }, { dibuatPada: "desc" }],
        take: 100,
      });

      return tagihan.map((t) => {
        const h = statusTurunan({
          sisa: Number(t.sisa),
          nominalAwal: Number(t.nominal),
          periode: t.periode,
          periodeAktif: config.periodeAktif,
          keringananAktif: false,
        });
        return {
          id: t.id,
          kategoriId: t.kategoriId,
          nama: t.kategori.nama,
          periode: t.periode,
          nominal: Number(t.nominal),
          sisa: Number(t.sisa),
          tenggat: t.tenggat ? tanggalPendek(t.tenggat) : null,
          status: h.status,
          label: h.label,
        };
      });
    });

    return reply.ok({ daftar });
  });

  /**
   * Batch 15E — dua bentuk input: JSON polos (jalur lama) ATAU multipart
   * (field teks + ≤1 file struk JPG/PNG/PDF 5 MB). File ditulis ke
   * `.data-bukti/<id>.<ekstensi>` SEBELUM baris terbit (gagal tulis = nol
   * perubahan data); setelah baris gagal terbit, file ikut dibuang (tanpa
   * orphan). `buktiUrl` menyimpan nama berkas hasil tulisan server.
   */
  app.post("/warga/iuran/bukti", async (req, reply) => {
    const { wargaId, rtId } = wajibWarga(req);
    const { input, berkas } = await bacaBukti(req);
    const idempotensi = headerIdempotensi(req);

    let berkasTersimpan: string | null = null;
    try {
      const hasil = await denganScopeRequest(req, async (tx) => {
        if (idempotensi) {
          const ada = await tx.pembayaran.findFirst({
            where: { rtId, wargaId, idempotencyKey: idempotensi },
          });
          // Replay idempoten: file (bila ada) TIDAK pernah ditulis — cukup
          // dibuang dari memori; baris asli dikembalikan apa adanya.
          if (ada) return { pembayaran: ada, ulang: true };
        }

        const warga = await tx.warga.findUnique({ where: { id: wargaId }, select: { nama: true } });
        const id = randomUUID();
        if (berkas) {
          try {
            await mkdir(DIR_BUKTI, { recursive: true });
            berkasTersimpan = `${id}${berkas.ekstensi}`;
            await writeFile(path.join(DIR_BUKTI, berkasTersimpan), berkas.isi);
          } catch {
            berkasTersimpan = null;
            throw new GalatTolak(
              "INTERNAL",
              "File bukti gagal disimpan server — pengajuan dibatalkan tanpa perubahan data.",
            );
          }
        }
        const pembayaran = await tx.pembayaran.create({
          data: {
            id,
            rtId,
            wargaId,
            tanggal: new Date(),
            nominal: input.nominal,
            metode: input.metode,
            catatan: input.catatan ?? null,
            sumber: "upload_warga",
            status: "menunggu_verifikasi",
            buktiUrl: berkasTersimpan ?? input.buktiUrl ?? null,
            diajukanOleh: "warga",
            idempotencyKey: idempotensi,
          },
        });

        await catatAudit(
          {
            scopeLevel: "rt",
            scopeId: rtId,
            actorId: wargaId,
            actorRole: "warga",
            portal: "warga",
            modul: "iuran",
            aksi: "ajukan_bukti",
            aksiBadge: "Menunggu",
            entitas: "pembayaran",
            entitasId: pembayaran.id,
            ringkasan: `Bukti pembayaran Rp ${input.nominal} — menunggu verifikasi${berkasTersimpan ? " (file terlampir)" : ""}${warga ? ` (${warga.nama})` : ""}`,
            ip: req.ipAsli,
          },
          tx,
        );

        return { pembayaran, ulang: false };
      });

      return reply.ok({
        pembayaran: ringkasPembayaran(hasil.pembayaran),
        ulang: hasil.ulang,
        statusLabel: LABEL_PEMBAYARAN.menunggu_verifikasi,
      });
    } catch (err) {
      // Baris gagal terbit setelah file sempat tertulis → buang filenya
      // (transaksi DB sudah ter-ROLLBACK oleh `denganScopeRequest`).
      if (berkasTersimpan) {
        await unlink(path.join(DIR_BUKTI, berkasTersimpan)).catch(() => undefined);
      }
      throw err;
    }
  });

  /**
   * Baca file bukti dari disk. `buktiUrl` hanya sah bila berupa nama berkas
   * hasil tulisan server (regex UUID+ekstensi) — path tak pernah berasal dari
   * klien sehingga path traversal tidak mungkin; referensi teks biasa (mis.
   * no. mutasi) menjawab 404 jujur, bukan file karangan.
   */
  async function ambilBerkasBukti(baris: { buktiUrl: string | null }): Promise<{
    berkas: string;
    isi: Buffer;
  }> {
    const nama = baris.buktiUrl ?? "";
    if (!NAMA_BERKAS_BUKTI.test(nama)) {
      throw new GalatTolak("NOT_FOUND", "File bukti tidak ditemukan pada pembayaran ini.");
    }
    try {
      const isi = await readFile(path.join(DIR_BUKTI, nama));
      return { berkas: nama, isi };
    } catch {
      throw new GalatTolak("NOT_FOUND", "File bukti sudah tidak tersedia di server.");
    }
  }

  /** Header unduh: konten-tipe dari EKSTENSI tersimpan; gambar/PDF `inline` (pratinjau). */
  function sajikanBukti(reply: FastifyReply, berkas: string, isi: Buffer): FastifyReply {
    const ekstensi = path.extname(berkas).toLowerCase();
    const pratinjau = [".pdf", ".jpg", ".jpeg", ".png"].includes(ekstensi);
    return reply
      .header("content-type", TIPE_BUKTI[ekstensi] ?? "application/octet-stream")
      .header("x-content-type-options", "nosniff")
      .header("content-disposition", `${pratinjau ? "inline" : "attachment"}; filename="bukti-pembayaran${ekstensi}"`)
      .send(isi);
  }

  /**
   * Batch 15E — unduh file bukti sebagai SESI WARGA pemilik. Filter
   * `wargaId` wajib eksplisit: RLS scope-nya setingkat RT (baris warga lain
   * ikut terlihat oleh scope) — "hanya boleh membaca data sendiri" tetap
   * tanggung jawab aplikasi (§4.6).
   */
  app.get("/warga/iuran/pembayaran/:id/bukti", async (req, reply) => {
    const { rtId, wargaId } = wajibWarga(req);
    const { id } = z.object({ id: skemaId }).parse(req.params);

    const baris = await denganScopeRequest(req, (tx) =>
      tx.pembayaran.findUnique({
        where: { id },
        select: { rtId: true, wargaId: true, buktiUrl: true },
      }),
    );
    if (!baris || baris.rtId !== rtId || baris.wargaId !== wargaId) {
      throw new GalatTolak("NOT_FOUND", "Pembayaran tidak ditemukan.");
    }

    const { berkas, isi } = await ambilBerkasBukti(baris);
    return sajikanBukti(reply, berkas, isi);
  });

  /**
   * Batch 15E — pasangan rute RT: pengurus melihat file bukti yang sama
   * di antrean verifikasi (bukti tampil di DUA portal dari satu baris).
   * Lintas-RT → 404.
   */
  app.get("/rt/iuran/pembayaran/:id/bukti", async (req, reply) => {
    const { rtId } = wajibRt(req);
    const { id } = z.object({ id: skemaId }).parse(req.params);

    const baris = await denganScopeRequest(req, (tx) =>
      tx.pembayaran.findUnique({ where: { id }, select: { rtId: true, buktiUrl: true } }),
    );
    if (!baris || baris.rtId !== rtId) {
      throw new GalatTolak("NOT_FOUND", "Pembayaran tidak ditemukan.");
    }

    const { berkas, isi } = await ambilBerkasBukti(baris);
    return sajikanBukti(reply, berkas, isi);
  });
};
