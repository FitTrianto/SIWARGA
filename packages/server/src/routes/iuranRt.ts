/**
 * Iuran Portal RT — PRD §5.4 (task B7 alokasi FIFO · B8 kas otomatis · B9 · B10) · F-3.
 *
 *   GET   /rt/iuran/kategori                 → daftar kategori iuran (kolom tabel FE)
 *   GET   /rt/iuran/tagihan?periode=&q=&status=&kategori= → dashboard status per warga
 *   GET   /rt/iuran/pembayaran?status=       → antrean bukti + riwayat pembayaran
 *   POST  /rt/iuran/pembayaran               → catat pembayaran bendahara (alokasi langsung)
 *   POST  /rt/iuran/pembayaran/:id/setujui   → verifikasi: alokasi FIFO + kas otomatis
 *   POST  /rt/iuran/pembayaran/:id/tolak     → tolak bukti (tanpa alokasi, tanpa kas)
 *   GET   /rt/iuran/pengaturan               → modeAlokasi/tenggatHari/dendaAktif (B7)
 *   PATCH /rt/iuran/pengaturan               → ubah pengaturan iuran (B7)
 *   POST  /rt/iuran/tagihan/generate         → generate tagihan bulanan idempoten (B9)
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
import type { Prisma } from "../generated/prisma/client.js";
import type { DbTransaksi } from "../services/db.js";
import { terapkanAlokasiPembayaran, tanggalPendek } from "../services/alokasiRepo.js";
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
const skemaTolak = z.object({ alasan: z.string().trim().min(3, "Alasan penolakan wajib diisi.").max(200).optional() });
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
  })
  .refine(
    (v) => v.modeAlokasi !== undefined || v.tenggatHari !== undefined || v.dendaAktif !== undefined,
    { message: "Minimal satu pengaturan harus diisi.", path: [] },
  );

/**
 * B9 — generate tagihan bulanan: `periode` opsional, mengikuti `PERIODE_AKTIF`
 * (dev `2026-10`) bila tidak dikirim — tombol FE "Buat Tagihan Bulan Ini"
 * cukup mengirim `{}` tanpa menghitung periode sendiri.
 */
const skemaGenerateTagihan = z.object({ periode: skemaPeriode.optional() });

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

/** Default `pengaturan_rt` (§6.4.3) bila baris pengaturan belum pernah dibuat. */
const PENGATURAN_IURAN_DASAR = { modeAlokasi: "gabungan", tenggatHari: 10, dendaAktif: false } as const;

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

/**
 * B9 — tenggat tagihan satu periode: `min(tenggat_hari, hari_akhir_bulan)`
 * sehingga bulan pendek (Feb) tidak pernah melewati akhir bulan (§6.4.3).
 */
function tenggatPeriode(periode: string, tenggatHari: number): Date {
  const [tahun, bulan] = periode.split("-").map(Number);
  const hariAkhirBulan = new Date(Date.UTC(tahun, bulan, 0)).getUTCDate();
  const hari = Math.min(Math.max(1, tenggatHari), hariAkhirBulan);
  return new Date(Date.UTC(tahun, bulan - 1, hari));
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

  /** Tolak bukti — tanpa alokasi, tanpa kas; warga boleh mengajukan ulang. */
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
        data: { status: "ditolak", catatan: alasan ?? "Bukti tidak jelas." },
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
          ringkasan: `Tolak pembayaran Rp ${Number(pembayaran.nominal)}${warga ? ` (${warga.nama})` : ""}${alasan ? ` — ${alasan}` : ""}`,
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
        select: { modeAlokasi: true, tenggatHari: true, dendaAktif: true },
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
        select: { modeAlokasi: true, tenggatHari: true, dendaAktif: true },
      });
      const dasar = lama ?? { ...PENGATURAN_IURAN_DASAR };
      const sesudah = {
        modeAlokasi: input.modeAlokasi ?? dasar.modeAlokasi,
        tenggatHari: input.tenggatHari ?? dasar.tenggatHari,
        dendaAktif: input.dendaAktif ?? dasar.dendaAktif,
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
          ringkasan: `Ubah pengaturan iuran: ${sesudah.modeAlokasi}, tenggat hari ${sesudah.tenggatHari}, denda ${sesudah.dendaAktif ? "aktif" : "nonaktif"}`,
          ip: req.ipAsli,
        },
        tx,
      );

      return sesudah;
    });

    return reply.ok(hasil);
  });

  /**
   * B9 — generate tagihan satu periode (bulk, idempoten).
   *
   * Aturan: warga `status_aktif` × kategori `aktif` dan bukan `insidental`;
   * nominal = `(profil.nominal_berlaku ?? kategori.nominal_default) × (per_unit ? profil.jumlah_unit : 1)`;
   * nominal ≤ 0 dilewati (dihitung `dilewati`); tenggat = `min(tenggat_hari, hari_akhir_bulan)`.
   * Kombinasi `(warga, kategori, periode)` unik → generate ulang tidak pernah
   * menduplikasi tagihan (dihitung juga sebagai `dilewati`).
   */
  app.post("/rt/iuran/tagihan/generate", { preHandler: verifikasiCsrf }, async (req, reply) => {
    const { rtId, sesi } = wajibRt(req);
    const { periode = config.periodeAktif } = skemaGenerateTagihan.parse(req.body ?? {});

    const hasil = await denganScopeRequest(req, async (tx) => {
      const oleh = await pengurusAktif(tx, rtId, sesi.subjekId);
      const pengaturan = await tx.pengaturanRt.findUnique({
        where: { rtId },
        select: { tenggatHari: true },
      });
      const tenggatHari = pengaturan?.tenggatHari ?? PENGATURAN_IURAN_DASAR.tenggatHari;

      const warga = await tx.warga.findMany({
        where: { rtId, statusAkses: "aktif" },
        select: { id: true },
      });
      const kategori = await tx.kategoriIuran.findMany({
        where: { rtId, statusAktif: true, tipeTarif: { not: "insidental" } },
        select: { id: true, tipeTarif: true, nominalDefault: true },
      });
      const profil = await tx.profilIuranWarga.findMany({
        where: { rtId },
        select: { wargaId: true, kategoriId: true, nominalBerlaku: true, jumlahUnit: true },
      });
      const ada = await tx.tagihan.findMany({
        where: { rtId, periode },
        select: { wargaId: true, kategoriId: true },
      });

      const kunciAda = new Set(ada.map((t) => `${t.wargaId}|${t.kategoriId}`));
      const petaProfil = new Map(profil.map((p) => [`${p.wargaId}|${p.kategoriId}`, p]));
      const tenggat = tenggatPeriode(periode, tenggatHari);
      const baris: Prisma.TagihanCreateManyInput[] = [];
      let dibuat = 0;
      let dilewati = 0;

      for (const w of warga) {
        for (const k of kategori) {
          const kunci = `${w.id}|${k.id}`;
          if (kunciAda.has(kunci)) {
            dilewati += 1; // tagihan periode ini sudah ada — idempoten
            continue;
          }
          const p = petaProfil.get(kunci);
          const dasar = p?.nominalBerlaku != null ? Number(p.nominalBerlaku) : Number(k.nominalDefault);
          const unit = k.tipeTarif === "per_unit" ? (p?.jumlahUnit ?? 1) : 1;
          const nominal = r2(dasar * unit);
          if (nominal <= 0) {
            dilewati += 1; // nominal nol = memang tidak ditagihkan
            continue;
          }
          baris.push({
            rtId,
            wargaId: w.id,
            kategoriId: k.id,
            periode,
            nominal,
            nominalAwal: nominal,
            sisa: nominal,
            tenggat,
            status: "belum_bayar",
            sumber: "bulk",
          });
          dibuat += 1;
        }
      }

      if (baris.length > 0) await tx.tagihan.createMany({ data: baris });

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
          sesudah: { periode, dibuat, dilewati },
          ringkasan: `Generate tagihan ${periode}: ${dibuat} dibuat, ${dilewati} dilewati`,
          ip: req.ipAsli,
        },
        tx,
      );

      return { dibuat, dilewati, periode };
    });

    return reply.ok(hasil);
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
