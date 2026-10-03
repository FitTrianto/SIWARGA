/**
 * CRUD Data Hunian — Portal RT (PRD §6.1 · kontrak §5.4 baris 563).
 *
 *   GET  /rt/hunian  → `{ hunian: [...] }` — daftar unit hunian RT sesi
 *   POST /rt/hunian  → buat 1 unit rumah + tautan balik KK/warga di alamat itu
 *
 * Latar (bug "input data hunian terputus", Okt 2026): sebelumnya Data Hunian
 * Portal RT hanya memakai state demo lokal (`hunianList` di App.tsx) dan tak
 * pernah menyentuh tabel `rumah`, sehingga:
 *   • unit baru hilang saat halaman dimuat ulang;
 *   • alamat baru tidak muncul di dropdown "alamat terdaftar" Data Warga;
 *   • KK/warga pada alamat itu tidak menemukan `rumah` → `rumah_id = NULL`
 *     → kolom Status Hunian kosong & prasyarat undangan §6.3 (wajib punya
 *     `rumah_id` + `kk_id`) ikut terblokir — "proses terputus".
 *
 * Aturan yang ditegakkan:
 *   • Scope + RLS §4.6: seluruh query di dalam `denganScopeRequest`; luar RT →
 *     data tidak terlihat (daftar) / 401 (mutasi tanpa sesi RT + CSRF §5.6).
 *   • Mutasi wajib `verifikasiCsrf` + `pengurusAktif` + `catatAudit`.
 *   • `kode_rumah` (blok) & `alamat_pendek` unik per RT (⭐ §3.2): pre-check
 *     case-insensitive → 409 CONFLICT dengan pesan spesifik; P2002 tetap
 *     jaring pengaman otomatis lewat `plugins/errorHandler.ts`.
 *   • `alamat_pendek` = bagian sebelum koma (pola `shortAlamat` FE), maks 40
 *     karakter sesuai kolom.
 *   • Tautan balik: KK/warga terdaftar pada alamat tersebut yang `rumah_id`
 *     IS NULL ikut ditautkan — aturan pencocokan SAMA dengan `POST /rt/warga`
 *     (alamat ATAU alamat_pendek, case-insensitive). Ini memulihkan data
 *     "terputus" yang terlanjur masuk sebelum hunian tercatat.
 *
 * Pemetaan field FE → skema PRD §6.1 (alamat, kode_rumah, status huni,
 * kepemilikan): `jenis` & daftar `penghuni` manual dari form demo TIDAK punya
 * kolom — turunan `jumlah_kk`/penghuni dihitung dari `kartu_keluarga` ter-link;
 * status "Kosong"/"Multi-KK" diturunkan FE dari jumlah KK (enum `status_huni`
 * = milik|sewa|kontrak|kos tanpa nilai "kosong").
 *
 * Deviasi terdokumentasi (dicatat juga di dokumen desain §5.4): baris kontrak
 * menyebut `/rt/hunian/:id`; FE tak punya UI edit/hapus → `PATCH`/`DELETE`
 * `/:id` belum diimplementasikan.
 */
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { catatAudit } from "../plugins/audit.js";
import { verifikasiCsrf } from "../plugins/csrf.js";
import { GalatTolak, wajibRt } from "../plugins/guard.js";
import { denganScopeRequest } from "../plugins/scope.js";
import type { Prisma } from "../generated/prisma/client.js";
import { pengurusAktif } from "./iuranUmum.js";

/** Baris hunian + turunannya (KK ter-link → jumlah_kk & nama penghuni). */
const PilihRumah = {
  id: true,
  kodeRumah: true,
  alamat: true,
  alamatPendek: true,
  statusHuni: true,
  unitKendaraanR4: true,
  kkAsal: { select: { kepalaKeluarga: true } },
} satisfies Prisma.RumahSelect;

type RumahTerpilih = Prisma.RumahGetPayload<{ select: typeof PilihRumah }>;

/** Satu baris `GET /rt/hunian` — turunan dihitung dari `kartu_keluarga` ter-link. */
function jsonHunian(r: RumahTerpilih) {
  return {
    id: r.id,
    kodeRumah: r.kodeRumah,
    alamat: r.alamat,
    alamatPendek: r.alamatPendek,
    statusHuni: r.statusHuni,
    unitKendaraanR4: r.unitKendaraanR4,
    jumlahKk: r.kkAsal.length,
    penghuni: r.kkAsal.map((k) => k.kepalaKeluarga),
  };
}

/** `alamat_pendek` = bagian sebelum koma — pola `shortAlamat` di shared.ts FE. */
function pendekDari(alamat: string): string {
  return alamat.split(",")[0].trim();
}

const skemaTambah = z.object({
  kodeRumah: z.string().trim().min(1, "Blok wajib diisi.").max(20, "Blok maksimal 20 karakter."),
  alamat: z.string().trim().min(1, "Alamat wajib diisi.").max(160, "Alamat maksimal 160 karakter."),
  statusHuni: z.enum(["milik", "sewa", "kontrak", "kos"]).default("milik"),
});

export const ruteRtHunian: FastifyPluginAsync = async (app) => {
  /** Daftar hunian milik RT sesi (sumber kebenaran Data Hunian Portal RT). */
  app.get("/rt/hunian", async (req, reply) => {
    const { rtId } = wajibRt(req);
    const daftar = await denganScopeRequest(req, (tx) =>
      tx.rumah.findMany({
        where: { rtId },
        orderBy: [{ kodeRumah: "asc" }],
        select: PilihRumah,
      }),
    );
    return reply.ok({ hunian: daftar.map(jsonHunian) });
  });

  /**
   * Tambah 1 unit hunian. Sekaligus menautkan balik KK/warga pada alamat itu
   * yang belum punya `rumah_id` (dibuat sebelum hunian tercatat) sehingga
   * Status Hunian langsung terisi dan prasyarat undangan §6.3 terbuka.
   */
  app.post("/rt/hunian", { preHandler: verifikasiCsrf }, async (req, reply) => {
    const { rtId, sesi } = wajibRt(req);
    const body = skemaTambah.parse(req.body ?? {});

    const alamatPendek = pendekDari(body.alamat);
    if (!alamatPendek) {
      throw new GalatTolak("VALIDATION", "Alamat minimal berisi teks sebelum tanda koma.");
    }
    if (alamatPendek.length > 40) {
      throw new GalatTolak(
        "VALIDATION",
        "Bagian alamat sebelum tanda koma maksimal 40 karakter — persingkat alamat unit.",
      );
    }

    const hasil = await denganScopeRequest(req, async (tx) => {
      const oleh = await pengurusAktif(tx, rtId, sesi.subjekId);

      // Unik per RT (⭐ §3.2): pre-check case-insensitive agar pesan spesifik
      // (bukan "Data bentrok" generik); P2002 tetap menutup celah lain.
      const kembar = await tx.rumah.findFirst({
        where: {
          rtId,
          OR: [
            { kodeRumah: { equals: body.kodeRumah, mode: "insensitive" } },
            { alamatPendek: { equals: alamatPendek, mode: "insensitive" } },
          ],
        },
        select: { kodeRumah: true, alamatPendek: true },
      });
      if (kembar) {
        if (kembar.kodeRumah.toLowerCase() === body.kodeRumah.toLowerCase()) {
          throw new GalatTolak("CONFLICT", `Blok "${body.kodeRumah}" sudah terdaftar sebagai unit hunian.`);
        }
        throw new GalatTolak(
          "CONFLICT",
          `Alamat "${alamatPendek}" sudah terdaftar sebagai unit hunian (blok "${kembar.kodeRumah}"). Satu alamat menampung banyak KK — daftarkan KK lewat menu Data Warga.`,
        );
      }

      const rumah = await tx.rumah.create({
        data: {
          rtId,
          kodeRumah: body.kodeRumah,
          alamat: body.alamat,
          alamatPendek,
          statusHuni: body.statusHuni,
        },
        select: { id: true },
      });

      // Tautan balik (pemulihan "proses terputus"): KK terdaftar pada alamat
      // ini tanpa rumah ikut ditautkan — aturan sama dengan POST /rt/warga.
      const kkTertaut = await tx.kartuKeluarga.findMany({
        where: {
          rtId,
          rumahId: null,
          OR: [
            { alamat: { equals: body.alamat, mode: "insensitive" } },
            { alamat: { equals: alamatPendek, mode: "insensitive" } },
          ],
        },
        select: { id: true },
      });
      if (kkTertaut.length > 0) {
        const ids = kkTertaut.map((k) => k.id);
        await tx.kartuKeluarga.updateMany({ where: { id: { in: ids } }, data: { rumahId: rumah.id } });
        await tx.warga.updateMany({
          where: { rtId, kkId: { in: ids }, rumahId: null },
          data: { rumahId: rumah.id },
        });
      }

      const baris = await tx.rumah.findUnique({ where: { id: rumah.id }, select: PilihRumah });
      if (!baris) throw new GalatTolak("NOT_FOUND", "Hunian baru tidak ditemukan setelah dibuat.");

      await catatAudit(
        {
          scopeLevel: "rt",
          scopeId: rtId,
          actorId: oleh,
          actorRole: "rt_admin",
          portal: "rt",
          modul: "data_hunian",
          aksi: "tambah_hunian",
          aksiBadge: "Data Hunian",
          entitas: "rumah",
          entitasId: rumah.id,
          sesudah: {
            kodeRumah: body.kodeRumah,
            alamat: body.alamat,
            statusHuni: body.statusHuni,
          },
          ringkasan:
            `Tambah hunian ${body.kodeRumah} — ${body.alamat}` +
            (kkTertaut.length > 0 ? ` (${kkTertaut.length} KK tertaut)` : ""),
          ip: req.ipAsli,
        },
        tx,
      );

      return { hunian: jsonHunian(baris) };
    });

    return reply.ok(hasil);
  });
};
