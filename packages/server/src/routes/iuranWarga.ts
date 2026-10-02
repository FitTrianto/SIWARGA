/**
 * Iuran Portal Warga — PRD §5.3 (task B10 status turunan · B7 bukti) · F-3.
 *
 *   GET  /warga/iuran/tagihan?periode=      → tagihan periode + status turunan
 *   GET  /warga/iuran/riwayat?dari=&sampai= → riwayat pembayaran + alokasi
 *   GET  /warga/iuran/kondisional           → tagihan insidental milik sendiri
 *   POST /warga/iuran/bukti                 → ajukan bukti (menunggu_verifikasi)
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
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { config } from "../config.js";
import { catatAudit } from "../plugins/audit.js";
import { wajibWarga } from "../plugins/guard.js";
import { denganScopeRequest } from "../plugins/scope.js";
import { tanggalPendek } from "../services/alokasiRepo.js";
import { statusTurunan } from "../services/statusTagihan.js";
import {
  LABEL_PEMBAYARAN,
  headerIdempotensi,
  periodeKeRentang,
  ringkasPembayaran,
  skemaPeriode,
} from "./iuranUmum.js";

const r2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

const skemaQueryTagihan = z.object({ periode: skemaPeriode.optional() });
const skemaQueryRiwayat = z.object({ dari: skemaPeriode.optional(), sampai: skemaPeriode.optional() });
const skemaBukti = z.object({
  nominal: z.coerce.number().positive("Nominal harus lebih dari 0.").max(1_000_000_000),
  metode: z.enum(["tunai", "transfer", "qris", "lainnya"]).default("transfer"),
  catatan: z.string().trim().max(200).optional(),
  /** referensi bukti (mis. no. mutasi) — penyimpanan berkas final ada di F-5. */
  buktiUrl: z.string().trim().max(512).optional(),
});

export const ruteIuranWarga: FastifyPluginAsync = async (app) => {
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

  app.post("/warga/iuran/bukti", async (req, reply) => {
    const { wargaId, rtId } = wajibWarga(req);
    const input = skemaBukti.parse(req.body ?? {});
    const idempotensi = headerIdempotensi(req);

    const hasil = await denganScopeRequest(req, async (tx) => {
      if (idempotensi) {
        const ada = await tx.pembayaran.findFirst({
          where: { rtId, wargaId, idempotencyKey: idempotensi },
        });
        if (ada) return { pembayaran: ada, ulang: true };
      }

      const warga = await tx.warga.findUnique({ where: { id: wargaId }, select: { nama: true } });
      const pembayaran = await tx.pembayaran.create({
        data: {
          rtId,
          wargaId,
          tanggal: new Date(),
          nominal: input.nominal,
          metode: input.metode,
          catatan: input.catatan ?? null,
          sumber: "upload_warga",
          status: "menunggu_verifikasi",
          buktiUrl: input.buktiUrl ?? null,
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
          ringkasan: `Bukti pembayaran Rp ${input.nominal} — menunggu verifikasi${warga ? ` (${warga.nama})` : ""}`,
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
  });
};
