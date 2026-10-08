/**
 * Iuran Portal RT — PRD §5.4 (task B7 alokasi FIFO · B8 kas otomatis · B9 · B10) · F-3.
 *
 *   GET   /rt/iuran/kategori                 → daftar kategori iuran (kolom tabel FE)
 *   POST  /rt/iuran/kategori                 → tambah master kategori (§5.4)
 *   PATCH /rt/iuran/kategori/:id             → ubah kategori / toggle status aktif
 *   (DELETE sengaja tidak ada — PRD §6.4.1: "menonaktifkan, bukan hapus fisik";
 *    FE juga tak punya aksi hapus, lihat catatan di bawah rute PATCH)
 *   GET   /rt/iuran/tagihan?periode=&q=&status=&kategori= → dashboard status per warga
 *   GET   /rt/iuran/pembayaran?status=       → antrean bukti + riwayat pembayaran
 *   POST  /rt/iuran/pembayaran               → catat pembayaran bendahara (alokasi langsung)
 *   POST  /rt/iuran/pembayaran/:id/setujui   → verifikasi: alokasi FIFO + kas otomatis
 *   POST  /rt/iuran/pembayaran/:id/tolak     → tolak bukti (tanpa alokasi, tanpa kas)
 *   GET   /rt/iuran/pengaturan               → modeAlokasi/tenggatHari/dendaAktif (B7)
 *   PATCH /rt/iuran/pengaturan               → ubah pengaturan iuran (B7)
 *   POST  /rt/iuran/tagihan/generate         → generate tagihan bulanan idempoten (B9)
 *   POST  /rt/iuran/kondisional              → buat tagihan insidental (iuran kondisional)
 *   GET   /rt/iuran/kondisional              → daftar tagihan insidental + status per warga
 *   GET   /rt/warga/:id/profil-iuran         → profil iuran per warga (B9, deviasi kontrak)
 *   PUT   /rt/warga/:id/profil-iuran         → simpan nominal/unit override (B9, deviasi kontrak)
 *
 * Guard §5.0: semua `/rt/**` butuh sesi `RT_ADMIN` (`wajibRt`) dan seluruh mutasi
 * butuh cookie `csrf_token` + header `x-csrf-token` (`verifikasiCsrf`). Scope
 * selalu berasal dari `request.pemohon` — ID RT dari body tidak pernah dipercaya.
 *
 * Alur verifikasi (§6.4.5) berjalan DALAM SATU transaksi:
 * `pembayaran → alokasi_pembayaran → tagihan(sisa/status) → kas_entry`,
 * sehingga status lunas di Portal Warga tidak mungkin terpisah dari bukti kas.
 */
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { config } from "../config.js";
import { catatAudit } from "../plugins/audit.js";
import { verifikasiCsrf } from "../plugins/csrf.js";
import { GalatTolak, wajibRt } from "../plugins/guard.js";
import { denganScopeRequest } from "../plugins/scope.js";
import type { DbTransaksi } from "../services/db.js";
import { terapkanAlokasiPembayaran, tanggalPendek } from "../services/alokasiRepo.js";
import {
  PENGATURAN_IURAN_DASAR,
  generateTagihanPeriode,
  tenggatPeriode,
} from "../services/generateTagihan.js";
import { selisihBulan, statusTurunan } from "../services/statusTagihan.js";
import {
  LABEL_PEMBAYARAN,
  headerIdempotensi,
  pengurusAktif,
  ringkasPembayaran,
  skemaId,
  skemaPeriode,
  type StatusBarisRt,
} from "./iuranUmum.js";

const r2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

const skemaQueryTagihan = z.object({
  periode: skemaPeriode.optional(),
  q: z.string().trim().max(80).optional(),
  status: z.enum(["Lunas", "Sebagian", "Belum Bayar", "Menunggu Verifikasi"]).optional(),
  // B10 — filter per kategori (dokumentasi API §5.4; sebelumnya hanya ada di FE)
  kategori: skemaId.optional(),
});
const skemaQueryPembayaran = z.object({
  status: z.enum(["menunggu_verifikasi", "lunas", "ditolak"]).optional(),
  periode: skemaPeriode.optional(),
});
const skemaSetujui = z.object({
  catatan: z.string().trim().max(200).optional(),
  // B7 — mode terpisah: bendahara memilih kategori tujuan alokasi
  kategoriTujuan: skemaId.optional(),
});
// Batch 15C — alasan tolak WAJIB: warga berhak tahu apa yang harus
// diperbaiki; tanpa alasan → 400 (bukan diam-diam memakai teks default).
// Pesan per-check eksplisit: invalid_type (undefined/non-teks), too_small, too_big.
const skemaTolak = z.object({
  alasan: z
    .string({ error: "Alasan penolakan wajib diisi." })
    .trim()
    .min(3, "Alasan penolakan wajib diisi (min. 3 karakter).")
    .max(200, "Alasan terlalu panjang (maks. 200 karakter)."),
});
// Batch 15C — edit nominal tagihan (PATCH /rt/iuran/tagihan/:id).
const skemaNominalTagihan = z.object({
  nominal: z.coerce.number().positive("Nominal harus lebih dari 0.").max(1_000_000_000, "Nominal terlalu besar."),
});
const skemaCatat = z.object({
  wargaId: skemaId,
  nominal: z.coerce.number().positive("Nominal harus lebih dari 0.").max(1_000_000_000),
  metode: z.enum(["tunai", "transfer", "qris", "lainnya"]).default("tunai"),
  catatan: z.string().trim().max(200).optional(),
  tanggal: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal harus berformat YYYY-MM-DD.")
    .optional(),
  // B7 — mode terpisah: alokasi hanya ke satu kategori (§4.1)
  kategoriTujuan: skemaId.optional(),
});

/** B7 — pengaturan iuran; PATCH menerima minimal satu field (parsial). */
const skemaPengaturanIuran = z
  .object({
    modeAlokasi: z.enum(["gabungan", "terpisah"]).optional(),
    tenggatHari: z.coerce.number().int("Tenggat harus bilangan bulat.").min(1).max(31).optional(),
    dendaAktif: z.boolean().optional(),
    // Batch 15 — generate otomatis pada tanggal ini (1–28, Asia/Jakarta) vs
    // manual lewat tombol. Default skema: otomatis tgl 1.
    modeTagihan: z.enum(["otomatis", "manual"]).optional(),
    hariGenerate: z.coerce
      .number()
      .int("Hari generate harus bilangan bulat.")
      .min(1, "Hari generate minimal 1.")
      .max(28, "Hari generate maksimal 28.")
      .optional(),
  })
  .refine(
    (v) =>
      v.modeAlokasi !== undefined ||
      v.tenggatHari !== undefined ||
      v.dendaAktif !== undefined ||
      v.modeTagihan !== undefined ||
      v.hariGenerate !== undefined,
    { message: "Minimal satu pengaturan harus diisi.", path: [] },
  );

/**
 * Batch 15 — tutup buku iuran. `periodeTertutup` default = periode berjalan
 * (FE tidak menampilkan pemilih periode — tombol selalu menutup bulan ini);
 * batas atas `periodeAktif` dijaga di handler (kejujuran: tidak bisa menutup
 * buku "bulan depan").
 */
const skemaTutupBukuIuran = z.object({
  periodeTertutup: skemaPeriode.optional(),
  alasan: z.string().trim().max(300, "Alasan tutup buku maksimal 300 karakter.").optional(),
});

/**
 * B9 — generate tagihan bulanan: `periode` opsional, mengikuti `PERIODE_AKTIF`
 * (dev `2026-10`) bila tidak dikirim — tombol FE "Buat Tagihan Bulan Ini"
 * cukup mengirim `{}` tanpa menghitung periode sendiri. `sinkronProfil`
 * menyesuaikan tagihan yang belum teralokasi dengan profil iuran terbaru.
 */
const skemaGenerateTagihan = z.object({
  periode: skemaPeriode.optional(),
  sinkronProfil: z.boolean().optional(),
});

/** Kondisional (insidental): tagihan sekali jalan buatan pengurus RT. */
const skemaKondisional = z.object({
  nama: z.string().trim().min(2, "Nama tagihan minimal 2 karakter.").max(80),
  nominal: z.coerce.number().positive("Nominal harus lebih dari 0.").max(1_000_000_000),
  tenggat: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Tenggat harus berformat YYYY-MM-DD.")
    .optional(),
  // "semua" = seluruh warga aktif; selain itu daftar wargaId milik RT.
  target: z.union([z.literal("semua"), z.array(skemaId).min(1).max(2000)]).default("semua"),
  periode: skemaPeriode.optional(),
});
const skemaQueryKondisional = z.object({ periode: skemaPeriode.optional() });

/** B9 — override nominal/unit per warga untuk satu kategori. */
const skemaProfilIuran = z.object({
  kategoriId: skemaId,
  // `z.null()` di depan `z.coerce` — coerce akan mengubah null menjadi 0.
  nominalBerlaku: z
    .union([
      z.null(),
      z.coerce
        .number()
        .min(0, "Nominal tidak boleh negatif.")
        .max(1_000_000_000, "Nominal terlalu besar."),
    ])
    .optional(),
  jumlahUnit: z.coerce.number().int("Jumlah unit harus bilangan bulat.").min(1).max(999).optional(),
});

/**
 * B7 — validasi `kategoriTujuan` SEBELUM alokasi dijalankan: kategori wajib
 * milik RT yang sama dan masih aktif. Dilempar di awal transaksi supaya tidak
 * pernah ada baris pembayaran/alokasi yatim untuk kategori yang salah.
 */
async function pastikanKategoriTujuan(tx: DbTransaksi, rtId: string, kategoriId: string): Promise<void> {
  const kategori = await tx.kategoriIuran.findFirst({
    where: { id: kategoriId, rtId, statusAktif: true },
    select: { id: true },
  });
  if (!kategori) {
    throw new GalatTolak("NOT_FOUND", "Kategori iuran tujuan tidak ditemukan.");
  }
}

export const ruteIuranRt: FastifyPluginAsync = async (app) => {
  app.get("/rt/iuran/kategori", async (req, reply) => {
    const { rtId } = wajibRt(req);
    const kategori = await denganScopeRequest(req, (tx) =>
      tx.kategoriIuran.findMany({
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
      }),
    );
    return reply.ok({
      kategori: kategori.map((k) => ({ ...k, nominalDefault: Number(k.nominalDefault) })),
    });
  });

  // -------------------------------------------------------------------------
  // Master kategori — POST/PATCH (kontrak §5.4 "GET/POST/PATCH/DELETE"; FE
  // punya form tambah/edit + toggle status → POST & PATCH inilah yang
  // dibutuhkan). Sebelumnya CRUD kategori hanya mengubah state demo FE:
  // kategori baru tidak pernah sampai ke server, hilang saat muat ulang, dan
  // tidak ikut generate tagihan / dropdown alokasi yang dibaca dari server.
  // -------------------------------------------------------------------------

  const skemaKategoriBaru = z.object({
    nama: z.string().trim().min(1, "Nama kategori wajib diisi.").max(80, "Nama kategori maksimal 80 karakter."),
    nominal: z.coerce.number().min(0, "Nominal tidak boleh negatif.").max(1_000_000_000, "Nominal terlalu besar."),
    tipe: z.enum(["flat", "per_unit", "insidental"]),
    sifat: z.enum(["wajib", "opsional"]),
  });

  const skemaKategoriUbah = z
    .object({
      nama: z.string().trim().min(1, "Nama kategori wajib diisi.").max(80, "Nama kategori maksimal 80 karakter.").optional(),
      nominal: z.coerce.number().min(0, "Nominal tidak boleh negatif.").max(1_000_000_000, "Nominal terlalu besar.").optional(),
      tipe: z.enum(["flat", "per_unit", "insidental"]).optional(),
      sifat: z.enum(["wajib", "opsional"]).optional(),
      statusAktif: z.boolean().optional(),
    })
    .refine((v) => Object.keys(v).length > 0, { message: "Tidak ada perubahan yang dikirim." });

  /** Aturan bentuk yang sama dengan FE: selain `insidental`, nominal wajib > 0. */
  function validasiNominal(tipe: string, nominal: number): void {
    if (tipe !== "insidental" && nominal <= 0) {
      throw new GalatTolak("VALIDATION", "Nominal harus lebih dari 0.");
    }
  }

  /** Tambah master kategori milik RT sesi (urutan = terakhir, +1 dari server). */
  app.post("/rt/iuran/kategori", { preHandler: verifikasiCsrf }, async (req, reply) => {
    const { rtId, sesi } = wajibRt(req);
    const body = skemaKategoriBaru.parse(req.body ?? {});
    validasiNominal(body.tipe, body.nominal);

    const hasil = await denganScopeRequest(req, async (tx) => {
      const oleh = await pengurusAktif(tx, rtId, sesi.subjekId);

      // Nama unik per RT (⭐ schema) — pre-check case-insensitive untuk pesan
      // jelas; P2002 tetap jaring pengaman di layer errorHandler.
      const kembar = await tx.kategoriIuran.findFirst({
        where: { rtId, nama: { equals: body.nama, mode: "insensitive" } },
        select: { id: true },
      });
      if (kembar) throw new GalatTolak("CONFLICT", `Kategori "${body.nama}" sudah terdaftar.`);

      const maks = await tx.kategoriIuran.aggregate({ where: { rtId }, _max: { urutan: true } });
      const kategori = await tx.kategoriIuran.create({
        data: {
          rtId,
          nama: body.nama,
          tipeTarif: body.tipe,
          nominalDefault: body.nominal,
          sifat: body.sifat,
          urutan: (maks._max.urutan ?? 0) + 1,
        },
        select: { id: true, nama: true, tipeTarif: true, nominalDefault: true, sifat: true, statusAktif: true, urutan: true },
      });

      await catatAudit(
        {
          scopeLevel: "rt",
          scopeId: rtId,
          actorId: oleh,
          actorRole: "rt_admin",
          portal: "rt",
          modul: "iuran",
          aksi: "tambah_kategori",
          aksiBadge: "Iuran",
          entitas: "kategori_iuran",
          entitasId: kategori.id,
          sesudah: {
            nama: kategori.nama,
            tipeTarif: kategori.tipeTarif,
            nominalDefault: Number(kategori.nominalDefault),
            sifat: kategori.sifat,
          },
          ringkasan: `Tambah kategori "${kategori.nama}" (${kategori.tipeTarif})`,
          ip: req.ipAsli,
        },
        tx,
      );

      return { kategori: { ...kategori, nominalDefault: Number(kategori.nominalDefault) } };
    });

    return reply.ok(hasil);
  });

  /**
   * Ubah 1 kategori (form edit) ATAU toggle status aktif (PRD §6.4.1:
   * "menonaktifkan, bukan hapus fisik" — `dinonaktifkan_pada` diisi saat
   * dinonaktifkan, dikosongkan saat aktif kembali).
   *
   * Deviasi terdokumentasi atas baris kontrak §5.4: `DELETE /rt/iuran/kategori`
   * sengaja TIDAK dibuat — riwayat tagihan/pembayaran tidak boleh kehilangan
   * induknya, dan FE tak punya aksi hapus (satu-satunya jalan keluar = nonaktif).
   */
  app.patch("/rt/iuran/kategori/:id", { preHandler: verifikasiCsrf }, async (req, reply) => {
    const { rtId, sesi } = wajibRt(req);
    const { id } = z.object({ id: skemaId }).parse(req.params);
    const body = skemaKategoriUbah.parse(req.body ?? {});

    const hasil = await denganScopeRequest(req, async (tx) => {
      const oleh = await pengurusAktif(tx, rtId, sesi.subjekId);
      // ID asing / lintas RT → 404 (keberadaan baris tidak bocor).
      const lama = await tx.kategoriIuran.findFirst({
        where: { id, rtId },
        select: {
          id: true,
          nama: true,
          tipeTarif: true,
          nominalDefault: true,
          sifat: true,
          statusAktif: true,
          urutan: true,
          dinonaktifkanPada: true,
        },
      });
      if (!lama) throw new GalatTolak("NOT_FOUND", "Kategori iuran tidak ditemukan.");

      const tipeAkhir = body.tipe ?? lama.tipeTarif;
      const nominalAkhir = body.nominal ?? Number(lama.nominalDefault);
      validasiNominal(tipeAkhir, nominalAkhir);

      if (body.nama !== undefined && body.nama !== lama.nama) {
        const kembar = await tx.kategoriIuran.findFirst({
          where: { rtId, nama: { equals: body.nama, mode: "insensitive" }, NOT: { id: lama.id } },
          select: { id: true },
        });
        if (kembar) throw new GalatTolak("CONFLICT", `Kategori "${body.nama}" sudah terdaftar.`);
      }

      const data: Record<string, unknown> = {};
      if (body.nama !== undefined && body.nama !== lama.nama) data.nama = body.nama;
      if (body.tipe !== undefined && body.tipe !== lama.tipeTarif) data.tipeTarif = body.tipe;
      if (body.nominal !== undefined && nominalAkhir !== Number(lama.nominalDefault)) {
        data.nominalDefault = nominalAkhir;
      }
      if (body.sifat !== undefined && body.sifat !== lama.sifat) data.sifat = body.sifat;
      if (body.statusAktif !== undefined && body.statusAktif !== lama.statusAktif) {
        data.statusAktif = body.statusAktif;
        // Nonaktif → stempel waktu; aktif kembali → bersihkan (riwayat di DB
        // mengabadikan kapan kategori sempat mati).
        data.dinonaktifkanPada = body.statusAktif ? null : (lama.dinonaktifkanPada ?? new Date());
      }
      if (Object.keys(data).length === 0) {
        throw new GalatTolak("VALIDATION", "Tidak ada perubahan yang dikirim.");
      }

      const kategori = await tx.kategoriIuran.update({
        where: { id: lama.id },
        data,
        select: { id: true, nama: true, tipeTarif: true, nominalDefault: true, sifat: true, statusAktif: true, urutan: true },
      });

      await catatAudit(
        {
          scopeLevel: "rt",
          scopeId: rtId,
          actorId: oleh,
          actorRole: "rt_admin",
          portal: "rt",
          modul: "iuran",
          aksi: "ubah_kategori",
          aksiBadge: "Iuran",
          entitas: "kategori_iuran",
          entitasId: lama.id,
          sebelum: {
            nama: lama.nama,
            tipeTarif: lama.tipeTarif,
            nominalDefault: Number(lama.nominalDefault),
            sifat: lama.sifat,
            statusAktif: lama.statusAktif,
          },
          sesudah: {
            nama: kategori.nama,
            tipeTarif: kategori.tipeTarif,
            nominalDefault: Number(kategori.nominalDefault),
            sifat: kategori.sifat,
            statusAktif: kategori.statusAktif,
          },
          ringkasan: `Ubah kategori "${kategori.nama}" — ${Object.keys(data).join(", ")}`,
          ip: req.ipAsli,
        },
        tx,
      );

      return { kategori: { ...kategori, nominalDefault: Number(kategori.nominalDefault) } };
    });

    return reply.ok(hasil);
  });

  app.get("/rt/iuran/tagihan", async (req, reply) => {
    const { rtId } = wajibRt(req);
    const { periode = config.periodeAktif, q, status, kategori } = skemaQueryTagihan.parse(req.query);

    const rows = await denganScopeRequest(req, async (tx) => {
      const tagihan = await tx.tagihan.findMany({
        where: { rtId, periode, ...(kategori ? { kategoriId: kategori } : {}) },
        include: {
          kategori: { select: { id: true, nama: true } },
          warga: { select: { id: true, nama: true, rumahId: true } },
        },
      });
      const keringanan = await tx.keringanan.findMany({
        where: { rtId, status: "aktif", statusApproval: "disetujui" },
        select: { wargaId: true, kategoriId: true, periodeMulai: true, periodeSampai: true },
      });
      const menunggu = await tx.pembayaran.findMany({
        where: { rtId, status: "menunggu_verifikasi" },
        select: { wargaId: true },
      });
      const terbayar = await tx.pembayaran.findMany({
        where: { rtId, status: "lunas", alokasiList: { some: { tagihan: { periode } } } },
        select: { wargaId: true, tanggal: true },
        orderBy: { tanggal: "desc" },
      });
      const rumah = await tx.rumah.findMany({
        where: { rtId },
        select: { id: true, alamatPendek: true },
      });
      // B10 — badge tunggakan per warga: periode TERTUA yang belum dibayar
      // sebelum periode aktif. Satu `groupBy` untuk seluruh baris (tanpa N+1).
      const tunggakan = await tx.tagihan.groupBy({
        by: ["wargaId"],
        where: {
          rtId,
          sisa: { gt: 0 },
          status: "belum_bayar",
          periode: { lt: config.periodeAktif },
        },
        _min: { periode: true },
      });
      // Batch 15 — gerbang tombol "Buat Tagihan Bulan Ini" (portal mengikuti
      // kebenaran server, bukan status klik di FE): apakah periode berjalan
      // SUDAH punya tagihan, dan apakah buku iuran sedang ditutup (bila ya,
      // periode setelah periodeTertutup tidak dapat dibuat lagi).
      const [periodeAktifAda, tutupBukuBaris] = await Promise.all([
        tx.tagihan.findFirst({ where: { rtId, periode: config.periodeAktif }, select: { id: true } }),
        tx.tutupBukuIuran.findUnique({ where: { rtId } }),
      ]);

      const petaRumah = new Map(rumah.map((r) => [r.id, r.alamatPendek]));
      const petaMenunggu = new Set(menunggu.map((m) => m.wargaId));
      const petaTunggakan = new Map<string, number>();
      for (const t of tunggakan) {
        if (t._min.periode) {
          petaTunggakan.set(t.wargaId, Math.max(0, selisihBulan(t._min.periode, config.periodeAktif)));
        }
      }
      const petaTanggalBayar = new Map<string, string>();
      for (const p of terbayar) {
        if (!petaTanggalBayar.has(p.wargaId)) petaTanggalBayar.set(p.wargaId, tanggalPendek(p.tanggal));
      }

      type Baris = {
        wargaId: string;
        nama: string;
        alamat: string;
        jumlah: number;
        sisa: number;
        /** B10 — badge: ada keringanan aktif pada salah satu tagihan baris ini. */
        keringananAktif: boolean;
        /** B10 — badge: jumlah bulan tunggakan tertua warga (0 bila tidak). */
        tunggakanBulan: number;
        perKategori: Array<{
          /** Batch 15C — id tagihan baris ini (sasaran PATCH edit nominal). */
          tagihanId: string;
          kategoriId: string;
          kategori: string;
          nominal: number;
          sisa: number;
          status: string;
          label: string;
        }>;
      };
      const peta = new Map<string, Baris>();

      for (const t of tagihan) {
        const w = t.warga;
        let baris = peta.get(w.id);
        if (!baris) {
          baris = {
            wargaId: w.id,
            nama: w.nama,
            alamat: (w.rumahId ? petaRumah.get(w.rumahId) : null) ?? "-",
            jumlah: 0,
            sisa: 0,
            keringananAktif: false,
            tunggakanBulan: petaTunggakan.get(w.id) ?? 0,
            perKategori: [],
          };
          peta.set(w.id, baris);
        }
        const keringananAktif = keringanan.some(
          (k) =>
            k.wargaId === w.id &&
            k.kategoriId === t.kategoriId &&
            k.periodeMulai <= periode &&
            (!k.periodeSampai || k.periodeSampai >= periode),
        );
        if (keringananAktif) baris.keringananAktif = true;
        const h = statusTurunan({
          sisa: Number(t.sisa),
          nominalAwal: Number(t.nominal),
          periode: t.periode,
          periodeAktif: config.periodeAktif,
          keringananAktif,
        });
        baris.jumlah = r2(baris.jumlah + Number(t.nominal));
        baris.sisa = r2(baris.sisa + Number(t.sisa));
        baris.perKategori.push({
          tagihanId: t.id,
          kategoriId: t.kategoriId,
          kategori: t.kategori.nama,
          nominal: Number(t.nominal),
          sisa: Number(t.sisa),
          status: h.status,
          label: h.label,
        });
      }

      const semua = [...peta.values()].map((b): Baris & { status: StatusBarisRt; tanggalBayar: string | null } => {
        const status: StatusBarisRt =
          b.sisa <= 0
            ? "Lunas"
            : petaMenunggu.has(b.wargaId)
              ? "Menunggu Verifikasi"
              : b.sisa < b.jumlah
                ? "Sebagian"
                : "Belum Bayar";
        return { ...b, status, tanggalBayar: petaTanggalBayar.get(b.wargaId) ?? null };
      });

      const kata = q?.toLowerCase();
      const difilter = semua.filter((b) => {
        if (kata && !b.nama.toLowerCase().includes(kata) && !b.alamat.toLowerCase().includes(kata)) return false;
        if (status && b.status !== status) return false;
        return true;
      });

      difilter.sort((a, b) => a.alamat.localeCompare(b.alamat, "id") || a.nama.localeCompare(b.nama, "id"));

      return {
        rows: difilter,
        sudahDibuat: periodeAktifAda !== null,
        tutupBuku:
          tutupBukuBaris && !tutupBukuBaris.dibukaKembaliPada
            ? {
                periodeTertutup: tutupBukuBaris.periodeTertutup,
                ditutupPada: tutupBukuBaris.ditutupPada.toISOString(),
                alasan: tutupBukuBaris.alasan,
              }
            : null,
        rekap: {
          total: semua.length,
          lunas: semua.filter((b) => b.status === "Lunas").length,
          sebagian: semua.filter((b) => b.status === "Sebagian").length,
          menungguVerifikasi: semua.filter((b) => b.status === "Menunggu Verifikasi").length,
          belumBayar: semua.filter((b) => b.status === "Belum Bayar").length,
          target: r2(semua.reduce((a, b) => a + b.jumlah, 0)),
          terkumpul: r2(semua.reduce((a, b) => a + b.jumlah - b.sisa, 0)),
        },
      };
    });

    return reply.ok({ periode, ...rows });
  });

  app.get("/rt/iuran/pembayaran", async (req, reply) => {
    const { rtId } = wajibRt(req);
    const { status, periode } = skemaQueryPembayaran.parse(req.query);

    const pembayaran = await denganScopeRequest(req, async (tx) => {
      const baris = await tx.pembayaran.findMany({
        where: { rtId, ...(status ? { status } : {}) },
        include: {
          warga: { select: { id: true, nama: true, rumahId: true } },
          alokasiList: {
            orderBy: { urutan: "asc" },
            include: { tagihan: { include: { kategori: { select: { nama: true } } } } },
          },
        },
        orderBy: [{ tanggal: "desc" }, { createdAt: "desc" }],
        take: 500,
      });
      const rumah = await tx.rumah.findMany({
        where: { rtId },
        select: { id: true, alamatPendek: true },
      });
      const petaRumah = new Map(rumah.map((r) => [r.id, r.alamatPendek]));

      return baris
        .filter((p) => {
          // bukti yang belum diverifikasi belum punya periode alokasi — selalu
          // tampil pada filter apa pun agar antrean tidak pernah kosong keliru.
          if (p.status === "menunggu_verifikasi") return true;
          if (!periode) return true;
          return p.alokasiList.some((a) => a.tagihan.periode === periode);
        })
        .map((p) => ({
          ...ringkasPembayaran(p),
          nama: p.warga.nama,
          alamat: (p.warga.rumahId ? petaRumah.get(p.warga.rumahId) : null) ?? "-",
          periode: p.alokasiList[0]?.tagihan.periode ?? null,
          alokasi: p.alokasiList.map((a) => ({
            tagihanId: a.tagihanId,
            kategori: a.tagihan.kategori.nama,
            periode: a.tagihan.periode,
            nominal: Number(a.nominalDialokasikan),
          })),
        }));
    });

    return reply.ok({
      pembayaran,
      ringkas: {
        menunggu: pembayaran.filter((p) => p.status === "menunggu_verifikasi").length,
        lunas: pembayaran.filter((p) => p.status === "lunas").length,
        ditolak: pembayaran.filter((p) => p.status === "ditolak").length,
        labelMenunggu: LABEL_PEMBAYARAN.menunggu_verifikasi,
      },
    });
  });

  /** Catat pembayaran bendahara → alokasi FIFO berjalan seketika (§4.1). */
  app.post("/rt/iuran/pembayaran", { preHandler: verifikasiCsrf }, async (req, reply) => {
    const { rtId, sesi } = wajibRt(req);
    const input = skemaCatat.parse(req.body ?? {});
    const idempotensi = headerIdempotensi(req);

    const hasil = await denganScopeRequest(req, async (tx) => {
      if (idempotensi) {
        const ada = await tx.pembayaran.findFirst({ where: { rtId, idempotencyKey: idempotensi } });
        if (ada) return { ulang: true, pembayaran: ada, terapkan: null };
      }

      const warga = await tx.warga.findUnique({ where: { id: input.wargaId }, select: { nama: true } });
      if (!warga) throw new GalatTolak("NOT_FOUND", "Warga tidak ditemukan.");

      // B7 — kategori tujuan divalidasi lebih dulu: kalau tidak valid, transaksi
      // dibatalkan sebelum baris pembayaran/alokasi/kas sempat tertulis.
      if (input.kategoriTujuan) await pastikanKategoriTujuan(tx, rtId, input.kategoriTujuan);

      const oleh = await pengurusAktif(tx, rtId, sesi.subjekId);
      const pengaturan = await tx.pengaturanRt.findUnique({
        where: { rtId },
        select: { modeAlokasi: true },
      });
      const pembayaran = await tx.pembayaran.create({
        data: {
          rtId,
          wargaId: input.wargaId,
          tanggal: input.tanggal ? new Date(`${input.tanggal}T00:00:00.000Z`) : new Date(),
          nominal: input.nominal,
          metode: input.metode,
          catatan: input.catatan ?? null,
          sumber: "bendahara",
          status: "lunas",
          diajukanOleh: "bendahara",
          verifiedBy: oleh,
          verifiedAt: new Date(),
          idempotencyKey: idempotensi,
        },
      });

      const terapkan = await terapkanAlokasiPembayaran(tx, {
        rtId,
        pembayaran: { id: pembayaran.id, wargaId: pembayaran.wargaId, nominal: input.nominal, tanggal: pembayaran.tanggal },
        mode: pengaturan?.modeAlokasi ?? "gabungan",
        kategoriTujuan: input.kategoriTujuan ?? null,
        oleh,
        namaWarga: warga.nama,
      });

      await catatAudit(
        {
          scopeLevel: "rt",
          scopeId: rtId,
          actorId: oleh,
          actorRole: "rt_admin",
          portal: "rt",
          modul: "iuran",
          aksi: "catat_pembayaran",
          aksiBadge: "Lunas",
          entitas: "pembayaran",
          entitasId: pembayaran.id,
          sesudah: { status: "lunas", nominal: input.nominal, totalDialokasikan: terapkan.totalDialokasikan },
          ringkasan: `Catat pembayaran Rp ${input.nominal} (${warga.nama})`,
          ip: req.ipAsli,
        },
        tx,
      );

      return { ulang: false, pembayaran, terapkan };
    });

    return reply.ok({
      ulang: hasil.ulang,
      pembayaran: ringkasPembayaran(hasil.pembayaran),
      alokasi: hasil.terapkan?.alokasi ?? [],
      totalDialokasikan: hasil.terapkan?.totalDialokasikan ?? 0,
      kelebihanBayar: hasil.terapkan?.kelebihanBayar ?? 0,
      tagihan: hasil.terapkan?.tagihan ?? [],
      kas: hasil.terapkan?.kas ?? null,
    });
  });

  /** Verifikasi bukti warga → alokasi FIFO + entri kas otomatis (§6.4.5). */
  app.post("/rt/iuran/pembayaran/:id/setujui", { preHandler: verifikasiCsrf }, async (req, reply) => {
    const { rtId, sesi } = wajibRt(req);
    const { id } = z.object({ id: skemaId }).parse(req.params);
    const { catatan, kategoriTujuan } = skemaSetujui.parse(req.body ?? {});

    const hasil = await denganScopeRequest(req, async (tx) => {
      // RLS membatasi `rt_id = scope` → pembayaran RT lain tidak pernah terlihat
      const pembayaran = await tx.pembayaran.findFirst({ where: { id } });
      if (!pembayaran) throw new GalatTolak("NOT_FOUND", "Pembayaran tidak ditemukan.");
      if (pembayaran.status === "lunas") return { ulang: true, pembayaran, terapkan: null };
      if (pembayaran.status === "ditolak") {
        throw new GalatTolak("CONFLICT", "Pembayaran sudah ditolak — minta warga mengajukan ulang.");
      }

      // B7 — kategori tujuan divalidasi dulu (mode terpisah); bila salah,
      // transaksi batal → tagihan, alokasi, dan kas tetap utuh.
      if (kategoriTujuan) await pastikanKategoriTujuan(tx, rtId, kategoriTujuan);

      const oleh = await pengurusAktif(tx, rtId, sesi.subjekId);
      const warga = await tx.warga.findUnique({
        where: { id: pembayaran.wargaId },
        select: { nama: true },
      });
      const pengaturan = await tx.pengaturanRt.findUnique({
        where: { rtId },
        select: { modeAlokasi: true },
      });

      const terapkan = await terapkanAlokasiPembayaran(tx, {
        rtId,
        pembayaran: {
          id: pembayaran.id,
          wargaId: pembayaran.wargaId,
          nominal: Number(pembayaran.nominal),
          tanggal: pembayaran.tanggal,
        },
        mode: pengaturan?.modeAlokasi ?? "gabungan",
        kategoriTujuan: kategoriTujuan ?? null,
        oleh,
        namaWarga: warga?.nama,
      });

      const diperbarui = await tx.pembayaran.update({
        where: { id: pembayaran.id },
        data: {
          status: "lunas",
          verifiedBy: oleh,
          verifiedAt: new Date(),
          ...(catatan ? { catatan } : {}),
        },
      });

      await catatAudit(
        {
          scopeLevel: "rt",
          scopeId: rtId,
          actorId: oleh,
          actorRole: "rt_admin",
          portal: "rt",
          modul: "iuran",
          aksi: "verifikasi_pembayaran",
          aksiBadge: "Disetujui",
          entitas: "pembayaran",
          entitasId: pembayaran.id,
          sebelum: { status: pembayaran.status },
          sesudah: { status: "lunas", totalDialokasikan: terapkan.totalDialokasikan },
          ringkasan: `Verifikasi pembayaran Rp ${Number(pembayaran.nominal)}${warga ? ` (${warga.nama})` : ""}`,
          ip: req.ipAsli,
        },
        tx,
      );

      return { ulang: false, pembayaran: diperbarui, terapkan };
    });

    return reply.ok({
      ulang: hasil.ulang,
      pembayaran: ringkasPembayaran(hasil.pembayaran),
      alokasi: hasil.terapkan?.alokasi ?? [],
      totalDialokasikan: hasil.terapkan?.totalDialokasikan ?? 0,
      kelebihanBayar: hasil.terapkan?.kelebihanBayar ?? 0,
      tagihan: hasil.terapkan?.tagihan ?? [],
      kas: hasil.terapkan?.kas ?? null,
    });
  });

  /**
   * Tolak bukti — tanpa alokasi, tanpa kas; warga boleh mengajukan ulang
   * dengan bukti baru. Batch 15C: `alasan` WAJIB (skemaTolak) — tanpa/pendek →
   * 400 sebelum menyentuh data; alasan tersimpan di `catatan` + Audit Log.
   */
  app.post("/rt/iuran/pembayaran/:id/tolak", { preHandler: verifikasiCsrf }, async (req, reply) => {
    const { rtId, sesi } = wajibRt(req);
    const { id } = z.object({ id: skemaId }).parse(req.params);
    const { alasan } = skemaTolak.parse(req.body ?? {});

    const hasil = await denganScopeRequest(req, async (tx) => {
      const pembayaran = await tx.pembayaran.findFirst({ where: { id } });
      if (!pembayaran) throw new GalatTolak("NOT_FOUND", "Pembayaran tidak ditemukan.");
      if (pembayaran.status === "lunas") {
        throw new GalatTolak("CONFLICT", "Pembayaran sudah diverifikasi lunas — tidak bisa ditolak.");
      }
      if (pembayaran.status === "ditolak") return { ulang: true, pembayaran };

      const oleh = await pengurusAktif(tx, rtId, sesi.subjekId);
      const warga = await tx.warga.findUnique({
        where: { id: pembayaran.wargaId },
        select: { nama: true },
      });
      const diperbarui = await tx.pembayaran.update({
        where: { id: pembayaran.id },
        data: { status: "ditolak", catatan: alasan },
      });

      await catatAudit(
        {
          scopeLevel: "rt",
          scopeId: rtId,
          actorId: oleh,
          actorRole: "rt_admin",
          portal: "rt",
          modul: "iuran",
          aksi: "tolak_pembayaran",
          aksiBadge: "Ditolak",
          entitas: "pembayaran",
          entitasId: pembayaran.id,
          sebelum: { status: pembayaran.status },
          sesudah: { status: "ditolak" },
          ringkasan: `Tolak pembayaran Rp ${Number(pembayaran.nominal)}${warga ? ` (${warga.nama})` : ""} — ${alasan}`,
          ip: req.ipAsli,
        },
        tx,
      );

      return { ulang: false, pembayaran: diperbarui };
    });

    return reply.ok({
      ulang: hasil.ulang,
      pembayaran: ringkasPembayaran(hasil.pembayaran),
      statusLabel: LABEL_PEMBAYARAN.ditolak,
    });
  });

  // ───────────────────────── B7 · B9 ────────────────────────────────────────

  /**
   * B7 — baca pengaturan iuran (`modeAlokasi`, `tenggatHari`, `dendaAktif`).
   * Baris `pengaturan_rt` belum dibuat → kembalikan default skema; GET tidak
   * pernah menulis apa pun.
   */
  app.get("/rt/iuran/pengaturan", async (req, reply) => {
    const { rtId } = wajibRt(req);
    const pengaturan = await denganScopeRequest(req, (tx) =>
      tx.pengaturanRt.findUnique({
        where: { rtId },
        select: { modeAlokasi: true, tenggatHari: true, dendaAktif: true, modeTagihan: true, hariGenerate: true },
      }),
    );
    return reply.ok(pengaturan ?? { ...PENGATURAN_IURAN_DASAR });
  });

  /**
   * B7 — ubah pengaturan iuran (parsial, minimal satu field) + audit
   * `ubah_pengaturan_iuran` dengan nilai sebelum & sesudah.
   */
  app.patch("/rt/iuran/pengaturan", { preHandler: verifikasiCsrf }, async (req, reply) => {
    const { rtId, sesi } = wajibRt(req);
    const input = skemaPengaturanIuran.parse(req.body ?? {});

    const hasil = await denganScopeRequest(req, async (tx) => {
      const oleh = await pengurusAktif(tx, rtId, sesi.subjekId);
      const lama = await tx.pengaturanRt.findUnique({
        where: { rtId },
        select: { modeAlokasi: true, tenggatHari: true, dendaAktif: true, modeTagihan: true, hariGenerate: true },
      });
      const dasar = lama ?? { ...PENGATURAN_IURAN_DASAR };
      const sesudah = {
        modeAlokasi: input.modeAlokasi ?? dasar.modeAlokasi,
        tenggatHari: input.tenggatHari ?? dasar.tenggatHari,
        dendaAktif: input.dendaAktif ?? dasar.dendaAktif,
        modeTagihan: input.modeTagihan ?? dasar.modeTagihan,
        hariGenerate: input.hariGenerate ?? dasar.hariGenerate,
      };

      await tx.pengaturanRt.upsert({
        where: { rtId },
        create: { rtId, ...sesudah },
        update: { ...sesudah },
      });

      await catatAudit(
        {
          scopeLevel: "rt",
          scopeId: rtId,
          actorId: oleh,
          actorRole: "rt_admin",
          portal: "rt",
          modul: "iuran",
          aksi: "ubah_pengaturan_iuran",
          aksiBadge: "Pengaturan",
          entitas: "pengaturan_rt",
          entitasId: rtId,
          sebelum: lama ?? null,
          sesudah,
          ringkasan:
            `Ubah pengaturan iuran: ${sesudah.modeAlokasi}, tenggat hari ${sesudah.tenggatHari}, ` +
            `denda ${sesudah.dendaAktif ? "aktif" : "nonaktif"}, tagihan ` +
            (sesudah.modeTagihan === "otomatis" ? `otomatis tgl ${sesudah.hariGenerate}` : "manual"),
          ip: req.ipAsli,
        },
        tx,
      );

      return sesudah;
    });

    return reply.ok(hasil);
  });

  /**
   * B9 — generate tagihan satu periode (bulk, idempoten). `sinkronProfil`
   * (opsional) menyesuaikan tagihan yang BELUM teralokasi dengan profil iuran
   * terbaru — inilah jalur "bendahara memodifikasi tagihan" (§6.4.3).
   * Logika penuh terpusat di `services/generateTagihan.ts` dan dipakai juga
   * oleh pemeriksa otomatis `plugins/autoTagihan.ts`.
   */
  app.post("/rt/iuran/tagihan/generate", { preHandler: verifikasiCsrf }, async (req, reply) => {
    const { rtId, sesi } = wajibRt(req);
    const { periode = config.periodeAktif, sinkronProfil } = skemaGenerateTagihan.parse(req.body ?? {});

    const hasil = await denganScopeRequest(req, async (tx) => {
      const oleh = await pengurusAktif(tx, rtId, sesi.subjekId);
      // Batch 15 — tutup buku: selama buku AKTIF, generate periode SETELAH
      // periodeTertutup ditolak ("tak mengulang ke bulan berikutnya").
      // Periode ≤ periodeTertutup tetap boleh (backfill bulan yang ditutup).
      const tutup = await tx.tutupBukuIuran.findUnique({ where: { rtId } });
      if (tutup && !tutup.dibukaKembaliPada && periode > tutup.periodeTertutup) {
        throw new GalatTolak(
          "CONFLICT",
          `Buku iuran sudah ditutup per ${tutup.periodeTertutup} — tagihan ${periode} tidak dapat dibuat. ` +
            `Buka kembali buku iuran bila memang perlu.`,
        );
      }
      const gen = await generateTagihanPeriode(tx, rtId, periode, {
        sinkronProfil: sinkronProfil === true,
      });

      await catatAudit(
        {
          scopeLevel: "rt",
          scopeId: rtId,
          actorId: oleh,
          actorRole: "rt_admin",
          portal: "rt",
          modul: "iuran",
          aksi: "generate_tagihan",
          aksiBadge: "Dibuat",
          entitas: "tagihan",
          sesudah: { periode, dibuat: gen.dibuat, dilewati: gen.dilewati, sinkron: gen.sinkron },
          ringkasan:
            `Generate tagihan ${periode}: ${gen.dibuat} dibuat, ${gen.dilewati} dilewati` +
            (gen.sinkron > 0 ? `, ${gen.sinkron} disinkronkan dengan profil` : ""),
          ip: req.ipAsli,
        },
        tx,
      );

      return { dibuat: gen.dibuat, dilewati: gen.dilewati, sinkron: gen.sinkron, periode };
    });

    return reply.ok(hasil);
  });

  /**
   * Batch 15C — EDIT NOMINAL TAGIHAN: RT mengoreksi nominal satu tagihan
   * (warga+kategori+periode) tanpa menghapus/membuat ulang. Hanya tagihan milik
   * RT sesi (scope RLS) yang BELUM punya alokasi pembayaran — setelah ada
   * pembayaran, `nominal`/`sisa` adalah jejak kas → 409 jujur. `nominalAwal`
   * ikut ditulis agar tetap konsisten (pola sama dengan sinkron profil di
   * `generateTagihan`); audit `ubah_nominal_tagihan` membawa sebelum/sesudah.
   */
  app.patch("/rt/iuran/tagihan/:id", { preHandler: verifikasiCsrf }, async (req, reply) => {
    const { rtId, sesi } = wajibRt(req);
    const { id } = z.object({ id: skemaId }).parse(req.params);
    const { nominal } = skemaNominalTagihan.parse(req.body ?? {});

    const hasil = await denganScopeRequest(req, async (tx) => {
      const tagihan = await tx.tagihan.findFirst({
        where: { id },
        include: { kategori: { select: { nama: true } }, warga: { select: { nama: true } } },
      });
      if (!tagihan) throw new GalatTolak("NOT_FOUND", "Tagihan tidak ditemukan.");

      const teralokasi = await tx.alokasiPembayaran.count({ where: { tagihanId: id } });
      if (teralokasi > 0) {
        throw new GalatTolak(
          "CONFLICT",
          "Tagihan sudah memiliki pembayaran — nominal tidak dapat diubah. " +
            "Untuk koreksi permanen ubah profil iuran warga, untuk koreksi kas gunakan koreksi entri kas.",
        );
      }

      const sebelum = r2(Number(tagihan.nominal));
      if (sebelum === r2(nominal)) {
        throw new GalatTolak("VALIDATION", "Nominal baru sama dengan nominal lama.");
      }

      const oleh = await pengurusAktif(tx, rtId, sesi.subjekId);
      await tx.tagihan.update({
        where: { id },
        data: { nominal, nominalAwal: nominal, sisa: nominal },
      });
      await catatAudit(
        {
          scopeLevel: "rt",
          scopeId: rtId,
          actorId: oleh,
          actorRole: "rt_admin",
          portal: "rt",
          modul: "iuran",
          aksi: "ubah_nominal_tagihan",
          aksiBadge: "Diubah",
          entitas: "tagihan",
          entitasId: id,
          sebelum: { nominal: sebelum },
          sesudah: { nominal: r2(nominal) },
          ringkasan:
            `Ubah nominal tagihan ${tagihan.kategori.nama} (${tagihan.warga.nama}) ` +
            `${tagihan.periode}: Rp ${sebelum} → Rp ${r2(nominal)}`,
          ip: req.ipAsli,
        },
        tx,
      );

      return { id, nominal: r2(nominal), sisa: r2(nominal), periode: tagihan.periode };
    });

    return reply.ok(hasil);
  });

  /**
   * Batch 15 — TUTUP BUKU IURAN (sementara, bisa dibuka): selama baris
   * AKTIF, `POST /rt/iuran/tagihan/generate` untuk periode SETELAH
   * `periodeTertutup` ditolak 409 — "tak mengulang ke bulan berikutnya"
   * (keputusan desain 8 Okt 2026). Satu baris per RT; menutup saat sudah
   * aktif → 409 (buka dulu). `periodeTertutup` default periode berjalan dan
   * tidak boleh melebihi bulan berjalan.
   */
  app.post("/rt/iuran/tutup-buku", { preHandler: verifikasiCsrf }, async (req, reply) => {
    const { rtId, sesi } = wajibRt(req);
    const input = skemaTutupBukuIuran.parse(req.body ?? {});
    const periode = input.periodeTertutup ?? config.periodeAktif;
    if (periode > config.periodeAktif) {
      throw new GalatTolak(
        "VALIDATION",
        `Periode tutup buku tidak boleh melebihi bulan berjalan (${config.periodeAktif}).`,
      );
    }

    const hasil = await denganScopeRequest(req, async (tx) => {
      const oleh = await pengurusAktif(tx, rtId, sesi.subjekId);
      const lama = await tx.tutupBukuIuran.findUnique({ where: { rtId } });
      if (lama && !lama.dibukaKembaliPada) {
        throw new GalatTolak(
          "CONFLICT",
          `Buku iuran sudah ditutup per ${lama.periodeTertutup} — buka kembali dulu sebelum menutup ulang.`,
        );
      }
      const tutup = await tx.tutupBukuIuran.upsert({
        where: { rtId },
        create: { rtId, periodeTertutup: periode, alasan: input.alasan, ditutupOleh: oleh },
        // Tutup ulang (sesudah pernah dibuka) menimpa sisa nilai penutupan
        // sebelumnya — `alasan` dikosongkan bila tidak dikirim (tanpa sisa
        // alasan lama yang menyesatkan).
        update: {
          periodeTertutup: periode,
          alasan: input.alasan ?? null,
          ditutupOleh: oleh,
          ditutupPada: new Date(),
          dibukaKembaliPada: null,
        },
      });

      await catatAudit(
        {
          scopeLevel: "rt",
          scopeId: rtId,
          actorId: oleh,
          actorRole: "rt_admin",
          portal: "rt",
          modul: "iuran",
          aksi: "tutup_buku_iuran",
          aksiBadge: "Tutup Buku",
          entitas: "tutup_buku_iuran",
          entitasId: tutup.id,
          sesudah: { periodeTertutup: periode, alasan: input.alasan ?? null },
          ringkasan:
            `Tutup buku iuran per ${periode} — generate tagihan periode berikutnya ` +
            `berhenti sampai buku dibuka kembali`,
          ip: req.ipAsli,
        },
        tx,
      );

      return {
        periodeTertutup: tutup.periodeTertutup,
        ditutupPada: tutup.ditutupPada.toISOString(),
        alasan: tutup.alasan,
      };
    });

    return reply.ok(hasil);
  });

  /**
   * Batch 15 — BUKA KEMBALI buku iuran (tutup buku sementara): mengisi
   * `dibuka_kembali_pada`, generate kembali berjalan untuk periode apa pun.
   * Baris TIDAK dihapus (jejak penutupan terakhir tetap terbaca) — riwayat
   * tutup/buka lengkap tersimpan di `audit_log` (append-only).
   */
  app.post("/rt/iuran/tutup-buku/buka", { preHandler: verifikasiCsrf }, async (req, reply) => {
    const { rtId, sesi } = wajibRt(req);

    const hasil = await denganScopeRequest(req, async (tx) => {
      const oleh = await pengurusAktif(tx, rtId, sesi.subjekId);
      const lama = await tx.tutupBukuIuran.findUnique({ where: { rtId } });
      if (!lama || lama.dibukaKembaliPada) {
        throw new GalatTolak("CONFLICT", "Tidak ada tutup buku iuran yang sedang aktif.");
      }
      const tutup = await tx.tutupBukuIuran.update({
        where: { rtId },
        data: { dibukaKembaliPada: new Date() },
      });

      await catatAudit(
        {
          scopeLevel: "rt",
          scopeId: rtId,
          actorId: oleh,
          actorRole: "rt_admin",
          portal: "rt",
          modul: "iuran",
          aksi: "buka_buku_iuran",
          aksiBadge: "Buka Buku",
          entitas: "tutup_buku_iuran",
          entitasId: tutup.id,
          sebelum: { periodeTertutup: tutup.periodeTertutup, alasan: tutup.alasan },
          sesudah: { dibukaKembaliPada: tutup.dibukaKembaliPada?.toISOString() ?? null },
          ringkasan: `Buka kembali buku iuran (tutup per ${tutup.periodeTertutup}) — generate tagihan berjalan kembali`,
          ip: req.ipAsli,
        },
        tx,
      );

      return {
        periodeTertutup: tutup.periodeTertutup,
        dibukaKembaliPada: tutup.dibukaKembaliPada?.toISOString() ?? null,
      };
    });

    return reply.ok(hasil);
  });

  /**
   * Kondisional (insidental) — tagihan sekali jalan yang dibuat pengurus RT
   * dan terlihat DI KEDUA portal (§6.4.1 tipe `insidental`, `sifat opsional`;
   * tidak ikut generate bulanan).
   *
   *   POST /rt/iuran/kondisional → buat tagihan untuk target warga
   *
   * Kategori insidental dibuat sekali per nama (unik per RT) lalu dipakai
   * ulang — pembuatan berikutnya dengan nama sama tinggal menambah baris
   * `tagihan` (`sumber: "insidental"`). `target` "semua" = seluruh warga
   * aktif; selain itu daftar wargaId yang divalidasi milik RT & aktif.
   */
  app.post("/rt/iuran/kondisional", { preHandler: verifikasiCsrf }, async (req, reply) => {
    const { rtId, sesi } = wajibRt(req);
    const input = skemaKondisional.parse(req.body ?? {});
    const periode = input.periode ?? config.periodeAktif;

    const hasil = await denganScopeRequest(req, async (tx) => {
      const oleh = await pengurusAktif(tx, rtId, sesi.subjekId);

      let tenggat: Date;
      if (input.tenggat) {
        const d = new Date(`${input.tenggat}T00:00:00.000Z`);
        if (Number.isNaN(d.getTime())) {
          throw new GalatTolak("VALIDATION", "Tenggat tidak valid.");
        }
        tenggat = d;
      } else {
        const pengaturan = await tx.pengaturanRt.findUnique({
          where: { rtId },
          select: { tenggatHari: true },
        });
        const tenggatHari = pengaturan?.tenggatHari ?? PENGATURAN_IURAN_DASAR.tenggatHari;
        tenggat = tenggatPeriode(periode, tenggatHari);
      }

      // Kategori insidental per nama (unik per RT) — buat sekali, pakai ulang.
      let kategori = await tx.kategoriIuran.findFirst({
        where: { rtId, nama: input.nama },
        select: { id: true, tipeTarif: true },
      });
      if (kategori && kategori.tipeTarif !== "insidental") {
        throw new GalatTolak(
          "VALIDATION",
          `Nama "${input.nama}" sudah dipakai kategori iuran reguler — pilih nama lain.`,
        );
      }
      if (!kategori) {
        const urutan = await tx.kategoriIuran.count({ where: { rtId } });
        kategori = await tx.kategoriIuran.create({
          data: {
            rtId,
            nama: input.nama,
            tipeTarif: "insidental",
            sifat: "opsional",
            nominalDefault: input.nominal,
            urutan,
            statusAktif: true,
          },
          select: { id: true, tipeTarif: true },
        });
      }
      const kategoriId = kategori.id;

      let target: Array<{ id: string }>;
      if (input.target === "semua") {
        target = await tx.warga.findMany({
          where: { rtId, statusAkses: "aktif" },
          select: { id: true },
        });
      } else {
        target = await tx.warga.findMany({
          where: { rtId, statusAkses: "aktif", id: { in: input.target } },
          select: { id: true },
        });
        if (target.length === 0) {
          throw new GalatTolak("VALIDATION", "Target tagihan tidak berisi warga aktif RT ini.");
        }
      }
      if (target.length === 0) {
        throw new GalatTolak("VALIDATION", "Belum ada warga aktif untuk ditagihkan.");
      }

      // `skipDuplicates` + unique (warga, kategori, periode) → klik dobel /
      // buat ulang dengan nama sama tidak pernah menggandakan tagihan.
      const buat = await tx.tagihan.createMany({
        data: target.map((w) => ({
          rtId,
          wargaId: w.id,
          kategoriId,
          periode,
          nominal: input.nominal,
          nominalAwal: input.nominal,
          sisa: input.nominal,
          tenggat,
          status: "belum_bayar" as const,
          sumber: "insidental",
        })),
        skipDuplicates: true,
      });

      await catatAudit(
        {
          scopeLevel: "rt",
          scopeId: rtId,
          actorId: oleh,
          actorRole: "rt_admin",
          portal: "rt",
          modul: "iuran",
          aksi: "buat_tagihan_kondisional",
          aksiBadge: "Dibuat",
          entitas: "tagihan",
          sesudah: {
            nama: input.nama,
            nominal: input.nominal,
            periode,
            target: target.length,
            dibuat: buat.count,
          },
          ringkasan: `Tagihan kondisional "${input.nama}" Rp ${input.nominal} — ${buat.count} warga ditagih (${periode})`,
          ip: req.ipAsli,
        },
        tx,
      );

      return { kategoriId, periode, dibuat: buat.count, target: target.length };
    });

    return reply.ok(hasil);
  });

  /**
   * Daftar tagihan kondisional di Portal RT: periode berjalan (apa adanya) +
   * tagihan periode LAMPAU yang masih punya sisa — pengurus selalu bisa
   * melihat kewajiban yang belum lunas untuk diverifikasi.
   */
  app.get("/rt/iuran/kondisional", async (req, reply) => {
    const { rtId } = wajibRt(req);
    const { periode = config.periodeAktif } = skemaQueryKondisional.parse(req.query);

    const daftar = await denganScopeRequest(req, async (tx) => {
      const tagihan = await tx.tagihan.findMany({
        where: {
          rtId,
          sumber: "insidental",
          OR: [{ periode }, { sisa: { gt: 0 } }],
        },
        include: {
          kategori: { select: { id: true, nama: true } },
          warga: { select: { id: true, nama: true, rumahId: true } },
        },
        orderBy: [{ periode: "asc" }, { dibuatPada: "asc" }],
      });
      const rumah = await tx.rumah.findMany({
        where: { rtId },
        select: { id: true, alamatPendek: true },
      });
      const petaRumah = new Map(rumah.map((r) => [r.id, r.alamatPendek]));
      // Seluruh hunian berpenghuni (warga aktif) — pembanding label target FE.
      const wargaAktif = await tx.warga.findMany({
        where: { rtId, statusAkses: "aktif" },
        select: { rumahId: true },
      });
      const alamatBerpenghuni = new Set(
        wargaAktif
          .map((w) => (w.rumahId ? petaRumah.get(w.rumahId) : null))
          .filter((a): a is string => Boolean(a)),
      );

      const grup = new Map<
        string,
        {
          id: string;
          kategoriId: string;
          periode: string;
          nama: string;
          nominal: number;
          tenggat: string | null;
          baris: Array<{
            wargaId: string;
            nama: string;
            alamat: string;
            nominal: number;
            sisa: number;
            status: string;
            label: string;
          }>;
        }
      >();

      for (const t of tagihan) {
        const kunci = `${t.kategori.id}|${t.periode}`;
        let g = grup.get(kunci);
        if (!g) {
          g = {
            id: kunci,
            kategoriId: t.kategori.id,
            periode: t.periode,
            nama: t.kategori.nama,
            nominal: Number(t.nominal),
            tenggat: t.tenggat ? tanggalPendek(t.tenggat) : null,
            baris: [],
          };
          grup.set(kunci, g);
        }
        const h = statusTurunan({
          sisa: Number(t.sisa),
          nominalAwal: Number(t.nominal),
          periode: t.periode,
          periodeAktif: config.periodeAktif,
          keringananAktif: false,
        });
        g.baris.push({
          wargaId: t.warga.id,
          nama: t.warga.nama,
          alamat: (t.warga.rumahId ? petaRumah.get(t.warga.rumahId) : null) ?? "-",
          nominal: Number(t.nominal),
          sisa: Number(t.sisa),
          status: h.status,
          label: h.label,
        });
      }

      return [...grup.values()].map((g) => {
        const lunas = g.baris.filter((b) => b.status === "lunas").length;
        const alamats = new Set(g.baris.map((b) => b.alamat));
        const targetSemua =
          alamatBerpenghuni.size > 0 &&
          [...alamatBerpenghuni].every((a) => alamats.has(a));
        return { ...g, total: g.baris.length, lunas, belum: g.baris.length - lunas, targetSemua };
      });
    });

    return reply.ok({ periode, daftar });
  });

  /**
   * B9 — profil iuran satu warga: daftar kategori aktif + override
   * `nominal_berlaku` / `jumlah_unit`.
   *
   * DEVIASI KONTRAK: dokumen API §5.4 hanya mencantumkan `PATCH /rt/warga/:id/unit-r4`
   * (yang tidak pernah ada di implementasi); `GET|PUT /rt/warga/:id/profil-iuran`
   * adalah penggantinya agar seluruh kategori bisa dioverride lewat satu rute.
   */
  app.get("/rt/warga/:id/profil-iuran", async (req, reply) => {
    const { rtId } = wajibRt(req);
    const { id } = z.object({ id: skemaId }).parse(req.params);

    const data = await denganScopeRequest(req, async (tx) => {
      // RLS membatasi `rt_id = scope` → warga RT lain terlihat sebagai 404
      const warga = await tx.warga.findFirst({ where: { id }, select: { id: true, nama: true } });
      if (!warga) throw new GalatTolak("NOT_FOUND", "Warga tidak ditemukan.");

      const daftar = await tx.kategoriIuran.findMany({
        where: { rtId, statusAktif: true, tipeTarif: { not: "insidental" } },
        orderBy: [{ urutan: "asc" }, { nama: "asc" }],
        select: { id: true, nama: true, tipeTarif: true, nominalDefault: true },
      });
      const profil = await tx.profilIuranWarga.findMany({
        where: { wargaId: id, rtId },
        select: { kategoriId: true, nominalBerlaku: true, jumlahUnit: true },
      });
      const peta = new Map(profil.map((p) => [p.kategoriId, p]));

      return {
        warga,
        baris: daftar.map((k) => {
          const p = peta.get(k.id);
          return {
            kategoriId: k.id,
            nama: k.nama,
            tipeTarif: k.tipeTarif,
            nominalDefault: Number(k.nominalDefault),
            // null = ikut `nominal_default` kategori
            nominalBerlaku: p?.nominalBerlaku != null ? Number(p.nominalBerlaku) : null,
            jumlahUnit: p?.jumlahUnit ?? 1,
          };
        }),
      };
    });

    return reply.ok(data);
  });

  /**
   * B9 — simpan profil iuran (upsert `warga + kategori`) + audit
   * `ubah_profil_iuran`. Berlaku untuk tagihan BERIKUTNYA, bukan retroaktif.
   */
  app.put("/rt/warga/:id/profil-iuran", { preHandler: verifikasiCsrf }, async (req, reply) => {
    const { rtId, sesi } = wajibRt(req);
    const { id } = z.object({ id: skemaId }).parse(req.params);
    const input = skemaProfilIuran.parse(req.body ?? {});

    const hasil = await denganScopeRequest(req, async (tx) => {
      const oleh = await pengurusAktif(tx, rtId, sesi.subjekId);
      const warga = await tx.warga.findFirst({ where: { id }, select: { id: true, nama: true } });
      if (!warga) throw new GalatTolak("NOT_FOUND", "Warga tidak ditemukan.");
      const kategori = await tx.kategoriIuran.findFirst({
        where: { id: input.kategoriId, rtId, statusAktif: true },
        select: { id: true, nama: true, tipeTarif: true },
      });
      if (!kategori) throw new GalatTolak("NOT_FOUND", "Kategori iuran tidak ditemukan.");
      if (input.jumlahUnit !== undefined && kategori.tipeTarif !== "per_unit") {
        throw new GalatTolak("VALIDATION", "Jumlah unit hanya berlaku untuk iuran per unit (R4).");
      }

      const lama = await tx.profilIuranWarga.findFirst({
        where: { wargaId: id, kategoriId: input.kategoriId },
        select: { id: true, nominalBerlaku: true, jumlahUnit: true },
      });
      const nominalBerlaku =
        input.nominalBerlaku !== undefined ? input.nominalBerlaku : (lama?.nominalBerlaku ?? null);
      const jumlahUnit =
        input.jumlahUnit ?? (kategori.tipeTarif === "per_unit" ? (lama?.jumlahUnit ?? 1) : 1);

      const disimpan = await tx.profilIuranWarga.upsert({
        where: { wargaId_kategoriId: { wargaId: id, kategoriId: input.kategoriId } },
        create: { wargaId: id, kategoriId: input.kategoriId, rtId, nominalBerlaku, jumlahUnit },
        update: { nominalBerlaku, jumlahUnit },
      });

      await catatAudit(
        {
          scopeLevel: "rt",
          scopeId: rtId,
          actorId: oleh,
          actorRole: "rt_admin",
          portal: "rt",
          modul: "iuran",
          aksi: "ubah_profil_iuran",
          aksiBadge: "Profil Iuran",
          entitas: "profil_iuran_warga",
          entitasId: disimpan.id,
          sebelum: lama
            ? {
                nominalBerlaku: lama.nominalBerlaku != null ? Number(lama.nominalBerlaku) : null,
                jumlahUnit: lama.jumlahUnit,
              }
            : null,
          sesudah: {
            nominalBerlaku: disimpan.nominalBerlaku != null ? Number(disimpan.nominalBerlaku) : null,
            jumlahUnit: disimpan.jumlahUnit,
          },
          ringkasan: `Ubah profil iuran ${kategori.nama} — ${warga.nama}`,
          ip: req.ipAsli,
        },
        tx,
      );

      return {
        warga,
        profil: {
          kategoriId: kategori.id,
          nama: kategori.nama,
          nominalBerlaku: disimpan.nominalBerlaku != null ? Number(disimpan.nominalBerlaku) : null,
          jumlahUnit: disimpan.jumlahUnit,
        },
      };
    });

    return reply.ok(hasil);
  });
};
