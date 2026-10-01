/**
 * Kas Portal RT — PRD §6.5 (task B8 append-only · B24 cetak) · F-4.
 *
 *   GET  /rt/kas?dari=&sampai=&tipe=&kategori= → buku kas + ringkas saldo
 *   POST /rt/kas                               → catat pemasukan/pengeluaran manual
 *   POST /rt/kas/:id/pembalik                  → jurnal pembalik (koreksi, §4.5)
 *
 * Aturan §4.5:
 *   • Entri `iuran_alokasi` TIDAK lewat `POST /rt/kas` — dibuat otomatis oleh
 *     verifikasi alokasi (`iuranRt.ts` → `alokasiRepo`); endpoint ini hanya
 *     `sumber: "manual"`.
 *   • Tabel `kas_entry` APPEND-ONLY — UPDATE/DELETE diblokir trigger
 *     `fn_tolak_perubahan`; koreksi = baris `pembalik` baru yang menunjuk baris
 *     asal lewat `reversalOfId` (baris asal tidak pernah disentuh).
 *   • Saldo = rantai `saldoSesudah` (urut jurnal `created_at`); rantai yang sama
 *     dipakai `alokasiRepo` untuk entri otomatis.
 *
 * Sisa F-4 (belum diimplementasi — menunggu kebutuhan FE): approval
 * pengeluaran besar (B23), tutup-buku/rekap/cetak (B24), buku kas RW (§7.3).
 * Belum ada kolom idempotensi pada `kas_entry` — klik ganda dicegah FE (baris
 * tombol dinonaktifkan selama permintaan berjalan).
 */
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { catatAudit } from "../plugins/audit.js";
import { verifikasiCsrf } from "../plugins/csrf.js";
import { GalatTolak, wajibRt } from "../plugins/guard.js";
import { denganScopeRequest } from "../plugins/scope.js";
import { pengurusAktif, skemaId } from "./iuranUmum.js";

const r2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

const KATEGORI = [
  "iuran",
  "pemasukan_lain",
  "operasional",
  "kegiatan",
  "dana_sosial",
  "lainnya",
] as const;

const skemaTanggal = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal harus berformat YYYY-MM-DD.");

const skemaQueryKas = z.object({
  dari: skemaTanggal.optional(),
  sampai: skemaTanggal.optional(),
  tipe: z.enum(["masuk", "keluar", "pembalik"]).optional(),
  kategori: z.enum(KATEGORI).optional(),
});

const skemaCatat = z.object({
  tanggal: skemaTanggal.optional(),
  tipe: z.enum(["masuk", "keluar"]),
  kategori: z.enum(KATEGORI).default("lainnya"),
  keterangan: z.string().trim().min(1, "Keterangan wajib diisi.").max(200),
  nominal: z.coerce
    .number()
    .positive("Nominal harus lebih dari 0.")
    .max(1_000_000_000, "Nominal terlalu besar."),
});

const skemaPembalik = z.object({
  alasan: z.string().trim().min(3, "Alasan koreksi wajib diisi.").max(200),
  tanggal: skemaTanggal.optional(),
});

/** Bentuk entri untuk respons API (tanggal `YYYY-MM-DD`, angka biasa). */
interface EntriKasJson {
  id: string;
  tanggal: string;
  tipe: string;
  kategori: string;
  keterangan: string;
  nominal: number;
  arah: string;
  saldoSesudah: number;
  sumber: string;
  reversalOfId: string | null;
  buktiUrl: string | null;
  createdAt: string;
}

type BarisKas = {
  id: string;
  tanggal: Date;
  tipe: string;
  kategori: string;
  keterangan: string;
  nominal: unknown;
  arah: string;
  saldoSesudah: unknown;
  sumber: string;
  reversalOfId: string | null;
  buktiUrl: string | null;
  createdAt: Date;
};

function keJson(e: BarisKas): EntriKasJson {
  return {
    id: e.id,
    tanggal: e.tanggal.toISOString().slice(0, 10),
    tipe: e.tipe,
    kategori: e.kategori,
    keterangan: e.keterangan,
    nominal: Number(e.nominal),
    arah: e.arah,
    saldoSesudah: Number(e.saldoSesudah),
    sumber: e.sumber,
    reversalOfId: e.reversalOfId,
    buktiUrl: e.buktiUrl,
    createdAt: e.createdAt.toISOString(),
  };
}

const SELECT_ENTRI = {
  id: true,
  tanggal: true,
  tipe: true,
  kategori: true,
  keterangan: true,
  nominal: true,
  arah: true,
  saldoSesudah: true,
  sumber: true,
  reversalOfId: true,
  buktiUrl: true,
  createdAt: true,
} as const;

export const ruteKasRt: FastifyPluginAsync = async (app) => {
  app.get("/rt/kas", async (req, reply) => {
    const { rtId } = wajibRt(req);
    const q = skemaQueryKas.parse(req.query);

    const data = await denganScopeRequest(req, async (tx) => {
      // Satu ambilan penuh: ringkas & rantai dihitung atas buku utuh supaya
      // saldo tetap konsisten walau respons difilter (skala RT: baris puluhan–ratusan).
      const semua = await tx.kasEntry.findMany({
        where: { scopeLevel: "rt", scopeId: rtId },
        orderBy: { createdAt: "asc" },
        select: SELECT_ENTRI,
      });

      let totalMasuk = 0;
      let totalKeluar = 0;
      for (const e of semua) {
        if (e.arah === "positif") totalMasuk += Number(e.nominal);
        else totalKeluar += Number(e.nominal);
      }
      const terakhir = semua[semua.length - 1];

      const terpilih = semua.filter((e) => {
        if (q.tipe && e.tipe !== q.tipe) return false;
        if (q.kategori && e.kategori !== q.kategori) return false;
        const tgl = e.tanggal.toISOString().slice(0, 10);
        if (q.dari && tgl < q.dari) return false;
        if (q.sampai && tgl > q.sampai) return false;
        return true;
      });

      return {
        entri: terpilih.map(keJson),
        ringkas: {
          saldoKini: r2(Number(terakhir?.saldoSesudah ?? 0)),
          totalMasuk: r2(totalMasuk),
          totalKeluar: r2(totalKeluar),
          jumlahEntri: semua.length,
        },
      };
    });

    return reply.ok(data);
  });

  app.post("/rt/kas", { preHandler: verifikasiCsrf }, async (req, reply) => {
    const { rtId, sesi } = wajibRt(req);
    const body = skemaCatat.parse(req.body ?? {});

    const entri = await denganScopeRequest(req, async (tx) => {
      const oleh = await pengurusAktif(tx, rtId, sesi.subjekId);

      // Rantai saldo: ambil ekor jurnal lalu tambah bertanda — pola identik dengan
      // entri `iuran_alokasi` di `alokasiRepo` sehingga satu buku tetap utuh.
      const terakhir = await tx.kasEntry.findFirst({
        where: { scopeLevel: "rt", scopeId: rtId },
        orderBy: { createdAt: "desc" },
        select: { saldoSesudah: true },
      });
      const nominal = r2(body.nominal);
      const arah = body.tipe === "keluar" ? "negatif" : "positif";
      const saldoBaru = r2(
        Number(terakhir?.saldoSesudah ?? 0) + (arah === "positif" ? nominal : -nominal),
      );

      const dibuat = await tx.kasEntry.create({
        data: {
          scopeLevel: "rt",
          scopeId: rtId,
          tanggal: new Date(body.tanggal ?? new Date().toISOString().slice(0, 10)),
          tipe: body.tipe,
          kategori: body.kategori,
          keterangan: body.keterangan,
          nominal,
          arah,
          saldoSesudah: saldoBaru,
          sumber: "manual",
          createdBy: oleh,
        },
        select: SELECT_ENTRI,
      });

      await catatAudit(
        {
          scopeLevel: "rt",
          scopeId: rtId,
          actorId: oleh,
          actorRole: "rt_admin",
          portal: "rt",
          modul: "kas",
          aksi: "catat_kas",
          aksiBadge: arah === "positif" ? "Pemasukan" : "Pengeluaran",
          entitas: "kas_entry",
          entitasId: dibuat.id,
          sesudah: {
            tipe: body.tipe,
            kategori: body.kategori,
            nominal,
            saldoSesudah: saldoBaru,
          },
          ringkasan: `${arah === "positif" ? "Pemasukan" : "Pengeluaran"} Rp ${nominal} — ${body.keterangan}`,
          ip: req.ipAsli,
        },
        tx,
      );

      return dibuat;
    });

    return reply.ok({ entri: keJson(entri) });
  });

  app.post("/rt/kas/:id/pembalik", { preHandler: verifikasiCsrf }, async (req, reply) => {
    const { rtId, sesi } = wajibRt(req);
    const { id } = z.object({ id: skemaId }).parse(req.params);
    const { alasan, tanggal } = skemaPembalik.parse(req.body ?? {});

    const hasil = await denganScopeRequest(req, async (tx) => {
      const oleh = await pengurusAktif(tx, rtId, sesi.subjekId);

      // RLS membatasi ke scope sesi → entri RT lain tidak pernah terlihat.
      const asal = await tx.kasEntry.findFirst({ where: { id }, select: SELECT_ENTRI });
      if (!asal) throw new GalatTolak("NOT_FOUND", "Entri kas tidak ditemukan.");
      if (asal.tipe === "pembalik") {
        throw new GalatTolak(
          "CONFLICT",
          "Entri pembalik tidak boleh dibalik lagi — pilih entri asal.",
        );
      }
      // Sekali koreksi per baris: membalik dua kali = koreksi ganda (net nol dua kali).
      const sudahDibalik = await tx.kasEntry.findFirst({
        where: { reversalOfId: id },
        select: { id: true },
      });
      if (sudahDibalik) {
        throw new GalatTolak("CONFLICT", "Entri ini sudah pernah dibalik.");
      }

      const terakhir = await tx.kasEntry.findFirst({
        where: { scopeLevel: "rt", scopeId: rtId },
        orderBy: { createdAt: "desc" },
        select: { saldoSesudah: true },
      });
      const nominal = r2(Number(asal.nominal));
      const arahPembalik = asal.arah === "positif" ? "negatif" : "positif";
      const saldoBaru = r2(
        Number(terakhir?.saldoSesudah ?? 0) + (arahPembalik === "positif" ? nominal : -nominal),
      );

      const dibuat = await tx.kasEntry.create({
        data: {
          scopeLevel: "rt",
          scopeId: rtId,
          tanggal: new Date(tanggal ?? asal.tanggal.toISOString().slice(0, 10)),
          tipe: "pembalik",
          kategori: asal.kategori,
          keterangan: alasan,
          nominal,
          arah: arahPembalik,
          saldoSesudah: saldoBaru,
          sumber: "pembalik",
          refType: "kas_entry",
          refId: asal.id,
          reversalOfId: asal.id,
          createdBy: oleh,
        },
        select: SELECT_ENTRI,
      });

      await catatAudit(
        {
          scopeLevel: "rt",
          scopeId: rtId,
          actorId: oleh,
          actorRole: "rt_admin",
          portal: "rt",
          modul: "kas",
          aksi: "koreksi_kas",
          aksiBadge: "Dikoreksi",
          entitas: "kas_entry",
          entitasId: dibuat.id,
          sebelum: { id: asal.id, saldoSesudah: Number(asal.saldoSesudah) },
          sesudah: { reversalOfId: asal.id, saldoSesudah: saldoBaru },
          ringkasan: `Koreksi entri kas ${asal.id}: ${alasan}`,
          ip: req.ipAsli,
        },
        tx,
      );

      return { asal: keJson(asal), pembalik: keJson(dibuat) };
    });

    return reply.ok(hasil);
  });
};
