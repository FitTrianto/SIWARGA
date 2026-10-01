/**
 * Antrean verifikasi perubahan data warga — PRD §6.2 (task B11/B20 · F-5).
 *
 *   GET  /rt/ajuan-perubahan?status=      → antrean ajuan (B11)
 *   POST /rt/ajuan-perubahan/:id/setujui  → `{ catatan? }` → disetujui + audit (B20)
 *   POST /rt/ajuan-perubahan/:id/tolak    → `{ catatan }`  → ditolak  + audit (B20)
 *
 * "Sinkron ke warga" (B20) = kolom `perubahan_data_warga.status` yang dibaca
 * ulang portal warga lewat `GET /warga/keluarga.ajuan` — tanpa menyentuh data
 * demografis. Form ajuan warga hanya memuat keterangan (bukan field
 * terstruktur), jadi penerapan perubahan struktural (tambah anggota, mutasi,
 * koreksi NIK) tetap lewat CRUD Data Warga RT; catatan verifier tersimpan
 * `catatan_verifikasi` dan tampil di panel warga.
 *
 * Guard §5.0: semua rute butuh sesi `RT_ADMIN` (`wajibRt`); mutasi wajib cookie
 * `csrf_token` + header `x-csrf-token` (`verifikasiCsrf`). Jangkauan data
 * dijaga RLS `p_scope_rt` — `findFirst` tanpa `rtId` pun hanya melihat baris
 * RT sendiri; ajuan RT lain → `NOT_FOUND` (404), bukan bocor status.
 */
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { catatAudit } from "../plugins/audit.js";
import { verifikasiCsrf } from "../plugins/csrf.js";
import { GalatTolak, wajibRt } from "../plugins/guard.js";
import { denganScopeRequest } from "../plugins/scope.js";
import { pengurusAktif, skemaId } from "./iuranUmum.js";

const skemaQuery = z.object({
  status: z.enum(["menunggu", "disetujui", "ditolak"]).optional(),
});

const skemaSetujui = z.object({ catatan: z.string().trim().max(200).optional() });
const skemaTolak = z.object({
  catatan: z.string().trim().min(3, "Alasan penolakan wajib diisi.").max(200),
});

/** Bentuk `findMany` bergabung `warga → kk` (untuk tampilan antrean). */
type AjuanRt = {
  id: string;
  jenis: string;
  status: string;
  payloadSebelum: unknown;
  payloadSesudah: unknown;
  catatanVerifikasi: string | null;
  diajukanPada: Date;
  diprosesPada: Date | null;
  warga: { nama: string; hubungan: string; kk: { alamat: string; kepalaKeluarga: string } };
};

/** Enum mentah dipertahankan; label ("Menunggu Verifikasi" dsb.) disusun FE. */
function jsonAjuanRt(a: AjuanRt) {
  const sebelum = (a.payloadSebelum ?? {}) as Record<string, unknown>;
  const sesudah = (a.payloadSesudah ?? {}) as Record<string, unknown>;
  return {
    id: a.id,
    jenis: a.jenis,
    status: a.status,
    namaWarga: a.warga.nama,
    hubungan: a.warga.hubungan,
    alamat: a.warga.kk.alamat,
    kepala: a.warga.kk.kepalaKeluarga,
    pengajuNama: typeof sebelum.pengajuNama === "string" ? sebelum.pengajuNama : null,
    namaAnggota: typeof sesudah.namaAnggota === "string" ? sesudah.namaAnggota : null,
    keterangan: typeof sesudah.keterangan === "string" ? sesudah.keterangan : null,
    catatanVerifikasi: a.catatanVerifikasi,
    diajukanPada: a.diajukanPada.toISOString(),
    diprosesPada: a.diprosesPada ? a.diprosesPada.toISOString() : null,
  };
}

/** Kolom ringkas hasil verifikasi (respons mutasi). */
const PilihRingkas = {
  id: true,
  jenis: true,
  status: true,
  payloadSesudah: true,
  catatanVerifikasi: true,
  diajukanPada: true,
  diprosesPada: true,
} as const;

export const ruteRtAjuanPerubahan: FastifyPluginAsync = async (app) => {
  /** Antrean ajuan (B11) — `?status=` kosong = seluruh status. */
  app.get("/rt/ajuan-perubahan", async (req, reply) => {
    const { rtId } = wajibRt(req);
    const q = skemaQuery.parse(req.query ?? {});

    const daftar = await denganScopeRequest(req, (tx) =>
      tx.perubahanDataWarga.findMany({
        where: { rtId, ...(q.status ? { status: q.status } : {}) },
        orderBy: { diajukanPada: "desc" },
        take: 100,
        select: {
          id: true,
          jenis: true,
          status: true,
          payloadSebelum: true,
          payloadSesudah: true,
          catatanVerifikasi: true,
          diajukanPada: true,
          diprosesPada: true,
          warga: {
            select: {
              nama: true,
              hubungan: true,
              kk: { select: { alamat: true, kepalaKeluarga: true } },
            },
          },
        },
      }),
    );

    return reply.ok({ ajuan: daftar.map(jsonAjuanRt) });
  });

  /** Setujui ajuan — idempoten (ulang = `ulang: true`), audit ber-diff. */
  app.post("/rt/ajuan-perubahan/:id/setujui", { preHandler: verifikasiCsrf }, async (req, reply) => {
    const { rtId, sesi } = wajibRt(req);
    const { id } = z.object({ id: skemaId }).parse(req.params);
    const { catatan } = skemaSetujui.parse(req.body ?? {});

    const hasil = await denganScopeRequest(req, async (tx) => {
      // RLS membatasi `rt_id = scope` → ajuan RT lain tidak pernah terlihat.
      const ajuan = await tx.perubahanDataWarga.findFirst({ where: { id } });
      if (!ajuan) throw new GalatTolak("NOT_FOUND", "Pengajuan tidak ditemukan.");
      if (ajuan.status === "disetujui") return { ulang: true, ajuan };
      if (ajuan.status === "ditolak") {
        throw new GalatTolak("CONFLICT", "Pengajuan sudah ditolak — minta warga mengajukan ulang.");
      }

      const oleh = await pengurusAktif(tx, rtId, sesi.subjekId);
      const target = await tx.warga.findUnique({
        where: { id: ajuan.wargaId },
        select: { nama: true },
      });
      const diperbarui = await tx.perubahanDataWarga.update({
        where: { id: ajuan.id },
        data: {
          status: "disetujui",
          verifierId: oleh,
          catatanVerifikasi: catatan ?? null,
          diprosesPada: new Date(),
        },
        select: PilihRingkas,
      });

      await catatAudit(
        {
          scopeLevel: "rt",
          scopeId: rtId,
          actorId: oleh,
          actorRole: "rt_admin",
          portal: "rt",
          modul: "ajuan_perubahan",
          aksi: "setujui_ajuan",
          aksiBadge: "Disetujui",
          entitas: "perubahan_data_warga",
          entitasId: ajuan.id,
          sebelum: { status: ajuan.status },
          sesudah: { status: "disetujui", catatan: catatan ?? null },
          ringkasan: `Setujui ajuan ${ajuan.jenis}${target ? ` (${target.nama})` : ""}${catatan ? ` — ${catatan}` : ""}`,
          ip: req.ipAsli,
        },
        tx,
      );

      return { ulang: false, ajuan: diperbarui };
    });

    return reply.ok({
      ulang: hasil.ulang,
      ajuan: {
        id: hasil.ajuan.id,
        jenis: hasil.ajuan.jenis,
        status: hasil.ajuan.status,
        catatanVerifikasi: hasil.ajuan.catatanVerifikasi,
        diprosesPada: hasil.ajuan.diprosesPada ? hasil.ajuan.diprosesPada.toISOString() : null,
      },
    });
  });

  /** Tolak ajuan — alasan wajib; warga boleh mengajukan ulang setelahnya. */
  app.post("/rt/ajuan-perubahan/:id/tolak", { preHandler: verifikasiCsrf }, async (req, reply) => {
    const { rtId, sesi } = wajibRt(req);
    const { id } = z.object({ id: skemaId }).parse(req.params);
    const { catatan } = skemaTolak.parse(req.body ?? {});

    const hasil = await denganScopeRequest(req, async (tx) => {
      const ajuan = await tx.perubahanDataWarga.findFirst({ where: { id } });
      if (!ajuan) throw new GalatTolak("NOT_FOUND", "Pengajuan tidak ditemukan.");
      if (ajuan.status === "ditolak") return { ulang: true, ajuan };
      if (ajuan.status === "disetujui") {
        throw new GalatTolak("CONFLICT", "Pengajuan sudah disetujui — tidak bisa ditolak.");
      }

      const oleh = await pengurusAktif(tx, rtId, sesi.subjekId);
      const target = await tx.warga.findUnique({
        where: { id: ajuan.wargaId },
        select: { nama: true },
      });
      const diperbarui = await tx.perubahanDataWarga.update({
        where: { id: ajuan.id },
        data: {
          status: "ditolak",
          verifierId: oleh,
          catatanVerifikasi: catatan,
          diprosesPada: new Date(),
        },
        select: PilihRingkas,
      });

      await catatAudit(
        {
          scopeLevel: "rt",
          scopeId: rtId,
          actorId: oleh,
          actorRole: "rt_admin",
          portal: "rt",
          modul: "ajuan_perubahan",
          aksi: "tolak_ajuan",
          aksiBadge: "Ditolak",
          entitas: "perubahan_data_warga",
          entitasId: ajuan.id,
          sebelum: { status: ajuan.status },
          sesudah: { status: "ditolak", catatan },
          ringkasan: `Tolak ajuan ${ajuan.jenis}${target ? ` (${target.nama})` : ""} — ${catatan}`,
          ip: req.ipAsli,
        },
        tx,
      );

      return { ulang: false, ajuan: diperbarui };
    });

    return reply.ok({
      ulang: hasil.ulang,
      ajuan: {
        id: hasil.ajuan.id,
        jenis: hasil.ajuan.jenis,
        status: hasil.ajuan.status,
        catatanVerifikasi: hasil.ajuan.catatanVerifikasi,
        diprosesPada: hasil.ajuan.diprosesPada ? hasil.ajuan.diprosesPada.toISOString() : null,
      },
    });
  });
};
