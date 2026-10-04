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
 * menyebut `/rt/hunian/:id` — kini `PATCH`/`DELETE /:id` (edit per unit, hapus
 * satuan) SUDAH diimplementasikan (Okt 2026, permintaan Edit + Hapus Data
 * Hunian), ditambah `DELETE /rt/hunian` (hapus massal `{ ids }` untuk UI
 * seleksi ganda — tambahan di luar baris kontrak lama).
 */
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { catatAudit } from "../plugins/audit.js";
import { verifikasiCsrf } from "../plugins/csrf.js";
import { GalatTolak, wajibRt } from "../plugins/guard.js";
import { denganScopeRequest } from "../plugins/scope.js";
import type { Prisma } from "../generated/prisma/client.js";
import type { DbTransaksi } from "../services/db.js";
import { pengurusAktif, skemaId } from "./iuranUmum.js";

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

/** Patch sebagian `PATCH /rt/hunian/:id` — `undefined` = tidak diubah. */
const skemaUbah = z
  .object({
    kodeRumah: z.string().trim().min(1, "Blok wajib diisi.").max(20, "Blok maksimal 20 karakter.").optional(),
    alamat: z.string().trim().min(1, "Alamat wajib diisi.").max(160, "Alamat maksimal 160 karakter.").optional(),
    statusHuni: z.enum(["milik", "sewa", "kontrak", "kos"]).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: "Tidak ada perubahan yang dikirim.",
  });

/**
 * Guard hapus: unit yang masih menampung KK/warga TIDAK boleh dihapus —
 * data demografis tak boleh kehilangan rujukan rumahnya diam-diam (§6.1).
 */
async function wajibKosong(tx: DbTransaksi, rumahId: string, alamat: string): Promise<void> {
  const [kk, warga] = await Promise.all([
    tx.kartuKeluarga.count({ where: { rumahId } }),
    tx.warga.count({ where: { rumahId } }),
  ]);
  if (kk > 0 || warga > 0) {
    throw new GalatTolak(
      "CONFLICT",
      `Hunian "${alamat}" masih menampung ${kk} KK (${warga} warga) — kosongkan dulu lewat Data Warga sebelum unit dihapus.`,
    );
  }
}

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

  // -------------------------------------------------------------------------
  // Edit 1 unit (Okt 2026 — permintaan "Edit hanya per hunian") · PRD §6.1:
  // `kode_rumah` & alamat boleh berubah (UUID abadi §6.1 — relasi tak putus);
  // sifat unik ganda tetap ditegak lewat pre-check KECUALI baris sendiri.
  // -------------------------------------------------------------------------
  app.patch("/rt/hunian/:id", { preHandler: verifikasiCsrf }, async (req, reply) => {
    const { rtId, sesi } = wajibRt(req);
    const { id } = z.object({ id: skemaId }).parse(req.params);
    const body = skemaUbah.parse(req.body ?? {});

    const alamatPendekBaru = body.alamat !== undefined ? pendekDari(body.alamat) : null;
    if (body.alamat !== undefined) {
      if (!alamatPendekBaru) {
        throw new GalatTolak("VALIDATION", "Alamat minimal berisi teks sebelum tanda koma.");
      }
      if (alamatPendekBaru.length > 40) {
        throw new GalatTolak(
          "VALIDATION",
          "Bagian alamat sebelum tanda koma maksimal 40 karakter — persingkat alamat unit.",
        );
      }
    }

    const hasil = await denganScopeRequest(req, async (tx) => {
      const lama = await tx.rumah.findFirst({ where: { id, rtId }, select: PilihRumah });
      // ID asing / lintas RT → 404: keberadaan baris tidak bocor.
      if (!lama) throw new GalatTolak("NOT_FOUND", "Hunian tidak ditemukan.");
      const oleh = await pengurusAktif(tx, rtId, sesi.subjekId);

      if (body.kodeRumah !== undefined || body.alamat !== undefined) {
        const OR: NonNullable<Prisma.RumahWhereInput["OR"]> = [];
        if (body.kodeRumah !== undefined) {
          OR.push({ kodeRumah: { equals: body.kodeRumah, mode: "insensitive" } });
        }
        if (alamatPendekBaru !== null) {
          OR.push({ alamatPendek: { equals: alamatPendekBaru, mode: "insensitive" } });
        }
        const kembar = await tx.rumah.findFirst({
          where: { rtId, id: { not: id }, OR },
          select: { kodeRumah: true, alamatPendek: true },
        });
        if (kembar) {
          if (
            body.kodeRumah !== undefined &&
            kembar.kodeRumah.toLowerCase() === body.kodeRumah.toLowerCase()
          ) {
            throw new GalatTolak("CONFLICT", `Blok "${body.kodeRumah}" sudah terdaftar sebagai unit hunian.`);
          }
          throw new GalatTolak(
            "CONFLICT",
            `Alamat "${alamatPendekBaru ?? lama.alamatPendek}" sudah terdaftar sebagai unit hunian (blok "${kembar.kodeRumah}"). Satu alamat menampung banyak KK — daftarkan KK lewat menu Data Warga.`,
          );
        }
      }

      const data: Prisma.RumahUpdateInput = {
        ...(body.kodeRumah !== undefined ? { kodeRumah: body.kodeRumah } : {}),
        // `alamatPendekBaru` non-null selalu — sudah divalidasi di atas saat
        // `body.alamat` terisi.
        ...(body.alamat !== undefined
          ? { alamat: body.alamat, alamatPendek: alamatPendekBaru as string }
          : {}),
        ...(body.statusHuni !== undefined ? { statusHuni: body.statusHuni } : {}),
      };
      await tx.rumah.update({ where: { id }, data });

      // Tautan balik bila alamat berubah — aturan SAMA dengan POST /rt/hunian:
      // KK terdaftar pada alamat baru yang belum punya rumah ikut tertaut
      // (Status Hunian + prasyarat undangan §6.3 langsung terbuka).
      let kkTertaut = 0;
      if (body.alamat !== undefined) {
        const kkBaru = await tx.kartuKeluarga.findMany({
          where: {
            rtId,
            rumahId: null,
            OR: [
              { alamat: { equals: body.alamat, mode: "insensitive" } },
              { alamat: { equals: alamatPendekBaru as string, mode: "insensitive" } },
            ],
          },
          select: { id: true },
        });
        if (kkBaru.length > 0) {
          const ids = kkBaru.map((k) => k.id);
          await tx.kartuKeluarga.updateMany({ where: { id: { in: ids } }, data: { rumahId: id } });
          await tx.warga.updateMany({
            where: { rtId, kkId: { in: ids }, rumahId: null },
            data: { rumahId: id },
          });
          kkTertaut = kkBaru.length;
        }
      }

      const baris = await tx.rumah.findUnique({ where: { id }, select: PilihRumah });
      if (!baris) throw new GalatTolak("NOT_FOUND", "Hunian tidak ditemukan setelah diubah.");

      const sebelum: Record<string, string> = {};
      const sesudah: Record<string, string> = {};
      if (body.kodeRumah !== undefined) {
        sebelum.kodeRumah = lama.kodeRumah;
        sesudah.kodeRumah = body.kodeRumah;
      }
      if (body.alamat !== undefined) {
        sebelum.alamat = lama.alamat;
        sesudah.alamat = body.alamat;
      }
      if (body.statusHuni !== undefined) {
        sebelum.statusHuni = lama.statusHuni;
        sesudah.statusHuni = body.statusHuni;
      }

      await catatAudit(
        {
          scopeLevel: "rt",
          scopeId: rtId,
          actorId: oleh,
          actorRole: "rt_admin",
          portal: "rt",
          modul: "data_hunian",
          aksi: "ubah_hunian",
          aksiBadge: "Data Hunian",
          entitas: "rumah",
          entitasId: id,
          sebelum,
          sesudah,
          ringkasan:
            `Ubah hunian ${baris.kodeRumah} — ${baris.alamat}` +
            (kkTertaut > 0 ? ` (${kkTertaut} KK tertaut)` : ""),
          ip: req.ipAsli,
        },
        tx,
      );

      return { hunian: jsonHunian(baris), ...(kkTertaut > 0 ? { kkTertaut } : {}) };
    });

    return reply.ok(hasil);
  });

  // -------------------------------------------------------------------------
  // Hapus 1 unit (Okt 2026 — permintaan Edit & Hapus Data Hunian) · §6.1:
  // unit berpenghuni → 409 CONFLICT dengan jumlah KK/warga (tak pernah hapus
  // diam-diam); tanpa penghuni → baris dihapus + audit `hapus_hunian`.
  // -------------------------------------------------------------------------
  app.delete("/rt/hunian/:id", { preHandler: verifikasiCsrf }, async (req, reply) => {
    const { rtId, sesi } = wajibRt(req);
    const { id } = z.object({ id: skemaId }).parse(req.params);

    await denganScopeRequest(req, async (tx) => {
      const lama = await tx.rumah.findFirst({ where: { id, rtId }, select: PilihRumah });
      if (!lama) throw new GalatTolak("NOT_FOUND", "Hunian tidak ditemukan.");
      const alamat = `${lama.kodeRumah} — ${lama.alamat}`;
      await wajibKosong(tx, id, alamat);
      const oleh = await pengurusAktif(tx, rtId, sesi.subjekId);

      await tx.rumah.delete({ where: { id } });
      await catatAudit(
        {
          scopeLevel: "rt",
          scopeId: rtId,
          actorId: oleh,
          actorRole: "rt_admin",
          portal: "rt",
          modul: "data_hunian",
          aksi: "hapus_hunian",
          aksiBadge: "Data Hunian",
          entitas: "rumah",
          entitasId: id,
          sebelum: {
            kodeRumah: lama.kodeRumah,
            alamat: lama.alamat,
            statusHuni: lama.statusHuni,
          },
          ringkasan: `Hapus hunian ${alamat}`,
          ip: req.ipAsli,
        },
        tx,
      );
    });

    return reply.ok({ id });
  });

  // -------------------------------------------------------------------------
  // Hapus MASSAL (Okt 2026 — "hapus lebih dari 1 data hunian dengan selected
  // data"): `{ ids: [...] }` → jawaban sukses PARSIAL `{ terhapus, tertolak }`.
  // Unit berpenghuni/tak ditemukan dilaporkan per baris — satu unit gagal tidak
  // membatalkan seluruh batch, dan FE menampilkan ringkasan jujur hasilnya.
  // -------------------------------------------------------------------------
  app.delete("/rt/hunian", { preHandler: verifikasiCsrf }, async (req, reply) => {
    const { rtId, sesi } = wajibRt(req);
    const body = z
      .object({
        ids: z
          .array(skemaId)
          .min(1, "Pilih minimal satu unit hunian.")
          .max(100, "Satu kali hapus maksimal 100 unit."),
      })
      .parse(req.body ?? {});

    const hasil = await denganScopeRequest(req, async (tx) => {
      const oleh = await pengurusAktif(tx, rtId, sesi.subjekId);
      const terhapus: string[] = [];
      const tertolak: Array<{ id: string; alamat: string; alasan: string }> = [];
      const daftarHapus: Array<{ id: string; kodeRumah: string; alamat: string }> = [];

      for (const id of [...new Set(body.ids)]) {
        const lama = await tx.rumah.findFirst({ where: { id, rtId }, select: PilihRumah });
        if (!lama) {
          tertolak.push({ id, alamat: "-", alasan: "Hunian tidak ditemukan." });
          continue;
        }
        try {
          await wajibKosong(tx, id, `${lama.kodeRumah} — ${lama.alamat}`);
        } catch (e) {
          tertolak.push({
            id,
            alamat: lama.alamat,
            alasan: e instanceof GalatTolak ? e.message : "Gagal memeriksa unit.",
          });
          continue;
        }
        await tx.rumah.delete({ where: { id } });
        terhapus.push(id);
        daftarHapus.push({ id, kodeRumah: lama.kodeRumah, alamat: lama.alamat });
      }

      if (daftarHapus.length > 0) {
        await catatAudit(
          {
            scopeLevel: "rt",
            scopeId: rtId,
            actorId: oleh,
            actorRole: "rt_admin",
            portal: "rt",
            modul: "data_hunian",
            aksi: "hapus_hunian",
            aksiBadge: "Data Hunian",
            entitas: "rumah",
            entitasId: daftarHapus[0].id,
            sebelum: { daftar: daftarHapus },
            ringkasan:
              `Hapus ${daftarHapus.length} unit hunian (massal) — ` +
              daftarHapus.map((h) => h.kodeRumah).join(", "),
            ip: req.ipAsli,
          },
          tx,
        );
      }

      return { terhapus, tertolak };
    });

    return reply.ok(hasil);
  });
};
