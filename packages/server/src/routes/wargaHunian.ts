/**
 * Hunian milik sesi warga — Batch 15 (Okt 2026, permintaan "portal warga
 * dapat meng-update jumlah kendaraan roda 4").
 *
 *   GET   /warga/hunian → unit rumah tempat warga login (atau `null` bila
 *                         warga belum tertaut `rumah_id`)
 *   PATCH /warga/hunian → perbarui JUMLAH KENDARAAN RODA 4 saja
 *
 * Aturan yang ditegakkan:
 *   • Guard `wajibWarga`: sesi RT/admin ditolak 401 — rute ini murni milik
 *     warga (pola rute warga lain, §5.6 tanpa `verifikasiCsrf`).
 *   • Scope + RLS §4.6: seluruh kueri lewat `denganScopeRequest` dan selalu
 *     membatasi `id = sesi.subjekId AND rt_id = scope` — warga hanya bisa
 *     membaca/mengubah HUNIANNYA SENDIRI; tidak ada endpoint yang menerima
 *     `rumahId` dari klien (tak ada ID asing yang bisa dipalsukan).
 *   • Whitelist ketat: hanya `unitKendaraanR4` (integer 0–99). Alamat, blok
 *     & status hunian tetap kewenangan Pengurus RT (perubahan resmi lewat
 *     ajuan `POST /warga/keluarga/ajuan`).
 *   • Tanpa `rumah_id` → 409 CONFLICT dengan pesan jujur (hubungi pengurus
 *     untuk menautkan), bukan sukses palsu.
 *   • Tanpa perubahan (nilai sama) → 400 VALIDATION — konsisten dengan
 *     pola `skemaUbah` PATCH rute RT.
 *   • Setiap simpan tercatat `audit_log` ber-diff `unit_kendaraan_r4`
 *     sebelum/sesudah (append-only), actor = warga bersangkutan.
 *
 * Catatan desain (keputusan 8 Okt 2026): nilai ini BELUM menjadi dasar
 * generate tagihan iuran kendaraan — "data dulu, billing nanti"; sumber unit
 * tagihan tetap Profil Iuran (`jumlah_unit`) sampai iuran kendaraan aktif.
 * Pemetaan FE: `GET /warga/hunian` → state `kendaraanR4Count` App.tsx (dipakai
 * DataKeluarga + estimasi iuran); simpan dari modal "Detail Hunian Rumah".
 */
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { catatAudit } from "../plugins/audit.js";
import { GalatTolak, wajibWarga } from "../plugins/guard.js";
import { denganScopeRequest } from "../plugins/scope.js";

/** Kolom rumah yang boleh terlihat/diubah lewat rute ini (tanpa data RT lain). */
const PilihHunianWarga = {
  id: true,
  kodeRumah: true,
  alamat: true,
  alamatPendek: true,
  statusHuni: true,
  unitKendaraanR4: true,
} as const;

/** Satu baris hunian milik sesi warga → JSON (tanpa data warga/RT lain). */
function jsonHunianWarga(r: {
  kodeRumah: string;
  alamat: string;
  alamatPendek: string;
  statusHuni: string;
  unitKendaraanR4: number;
}) {
  return {
    kodeRumah: r.kodeRumah,
    alamat: r.alamat,
    alamatPendek: r.alamatPendek,
    statusHuni: r.statusHuni,
    unitKendaraanR4: r.unitKendaraanR4,
  };
}

/** Satu-satunya kolom yang boleh diubah warga mandiri — integer 0–99. */
const skemaUbahWarga = z.object({
  unitKendaraanR4: z
    .number()
    .int("Jumlah kendaraan harus bilangan bulat.")
    .min(0, "Minimal 0 unit.")
    .max(99, "Maksimal 99 unit."),
});

export const ruteWargaHunian: FastifyPluginAsync = async (app) => {
  /** Baca unit rumah milik sesi warga — `null` bila belum tertaut hunian. */
  app.get("/warga/hunian", async (req, reply) => {
    const { wargaId, rtId } = wajibWarga(req);
    const hasil = await denganScopeRequest(req, async (tx) => {
      const diri = await tx.warga.findFirst({
        where: { id: wargaId, rtId },
        select: { rumahId: true },
      });
      if (!diri) throw new GalatTolak("NOT_FOUND", "Data warga tidak ditemukan.");
      if (!diri.rumahId) return { hunian: null };
      const rumah = await tx.rumah.findFirst({
        where: { id: diri.rumahId, rtId },
        select: PilihHunianWarga,
      });
      // Rumah terhapus/di-luar scope → jangan bocorkan; layar memakai nilai
      // awalnya dan menyebut hunian belum terhubung.
      return { hunian: rumah ? jsonHunianWarga(rumah) : null };
    });
    return reply.ok(hasil);
  });

  /**
   * Perbarui jumlah kendaraan roda 4 hunian milik sendiri (permintaan Batch 15
   * — "warga dapat meng-updatenya" untuk menyiapkan dasar iuran kendaraan).
   * Tidak ada `rumahId` di body: selalu mengikuti tautan `warga.rumah_id`
   * sesi sehingga mustahil menyentuh unit milik warga/RT lain.
   */
  app.patch("/warga/hunian", async (req, reply) => {
    const { wargaId, rtId } = wajibWarga(req);
    const body = skemaUbahWarga.parse(req.body ?? {});

    const hasil = await denganScopeRequest(req, async (tx) => {
      const diri = await tx.warga.findFirst({
        where: { id: wargaId, rtId },
        select: { rumahId: true, nama: true },
      });
      if (!diri) throw new GalatTolak("NOT_FOUND", "Data warga tidak ditemukan.");
      if (!diri.rumahId) {
        throw new GalatTolak(
          "CONFLICT",
          "Data Anda belum terhubung ke unit hunian — hubungi Pengurus RT untuk menautkan alamat rumah Anda terlebih dahulu.",
        );
      }
      const lama = await tx.rumah.findFirst({
        where: { id: diri.rumahId, rtId },
        select: PilihHunianWarga,
      });
      if (!lama) {
        throw new GalatTolak("NOT_FOUND", "Unit hunian Anda tidak ditemukan.");
      }
      if (lama.unitKendaraanR4 === body.unitKendaraanR4) {
        throw new GalatTolak("VALIDATION", "Tidak ada perubahan yang dikirim.");
      }

      const rumah = await tx.rumah.update({
        where: { id: lama.id },
        data: { unitKendaraanR4: body.unitKendaraanR4 },
        select: PilihHunianWarga,
      });

      await catatAudit(
        {
          scopeLevel: "rt",
          scopeId: rtId,
          actorId: wargaId,
          actorRole: "warga",
          portal: "warga",
          modul: "data_hunian",
          aksi: "warga_ubah_kendaraan_r4",
          aksiBadge: "Data Keluarga",
          entitas: "rumah",
          entitasId: lama.id,
          sebelum: { unitKendaraanR4: lama.unitKendaraanR4 },
          sesudah: { unitKendaraanR4: body.unitKendaraanR4 },
          ringkasan:
            `Pembaruan mandiri warga ${diri.nama} — unit kendaraan roda 4 ` +
            `${lama.unitKendaraanR4} → ${body.unitKendaraanR4} (${lama.kodeRumah})`,
          ip: req.ipAsli,
        },
        tx,
      );

      return { hunian: jsonHunianWarga(rumah) };
    });

    return reply.ok(hasil);
  });
};
