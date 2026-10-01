/**
 * Data Keluarga Portal Warga — PRD §5.1 (task A5 · F-6).
 *
 *   GET  /warga/keluarga              → KK milik sesi warga + daftar anggota
 *   POST /warga/keluarga/:id/kontak   → simpan pembaruan kontak anggota 1 KK
 *
 * Deviasi terdokumentasi (keputusan 29 Sep 2026) atas tabel §5.3 spesifikasi
 * yang hanya memetakan `GET /warga/keluarga` + `POST /warga/keluarga/ajuan`
 * (B11): form "Pembaruan Kontak & Foto Mandiri" di UI berjanji SIMPAN LANGSUNG
 * tanpa jeda Pengurus RT, maka jalur tulis langsung disediakan DAN DIBATASI
 * hanya field kontak/pekerjaan: no. HP, surel, pekerjaan, agama, gol. darah,
 * status kawin. NIK, nama, hubungan, tanggal lahir & jenis kelamin TIDAK bisa
 * disentuh rute ini (whitelist ketat di bawah) — perubahan struktural tetap
 * lewat ajuan `POST /warga/keluarga/ajuan` (B11/F-5, menunggu modul verifikasi).
 *
 * Aturan yang ditegakkan:
 *   • NIK TIDAK PERNAH plaintext (§14/B17): respons hanya memuat `nik_masked`;
 *     No.KK pun disajikan ter-mask gaya `3171-xxxx-xxxx-0002`.
 *   • Target wajib 1 KK dengan sesi warga — ID asing / beda KK balas
 *     `NOT_FOUND` (404) agar keberadaan data warga lain tidak bocor; jangkauan
 *     RT tetap dijaga scope sesi + RLS `p_scope_rt` (§4.6).
 *   • `no_hp` dinormalisasi `normalisasiNoHp` (→ `08xx`) supaya konsisten dengan
 *     jalur login dan unique index `warga(rt_id, no_hp)`; bentrok → `CONFLICT`.
 *   • Tanpa `verifikasiCsrf`, mengikuti rute warga lain (§5.6: cookie SameSite
 *     =Lax + httpOnly); setiap simpan tercatat `audit_log` ber-diff sebelum/
 *     sesudah (append-only).
 *
 * Ajuan perubahan resmi (B11/B20, terpasang 29 Sep 2026):
 *   POST /warga/keluarga/ajuan  → baris `perubahan_data_warga` (status
 *   `menunggu`) + audit; respons termuat kembali lewat `GET /warga/keluarga`
 *   sebagai daftar `ajuan` (status pengajuan di panel kanan). Antrean &
 *   verifikasi RT ada di `routes/rtAjuanPerubahan.ts`. Penerapan perubahan
 *   struktural (tambah anggota dsb.) tetap lewat CRUD Data Warga RT — form
 *   ajuan hanya memuat keterangan, bukan field terstruktur.
 *
 * Sisa: unggah foto anggota menunggu keputusan penyimpanan berkas
 * (kolom `foto_url` sudah ada, endpoint berkasnya belum).
 */
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { catatAudit } from "../plugins/audit.js";
import { GalatTolak, wajibWarga } from "../plugins/guard.js";
import { denganScopeRequest } from "../plugins/scope.js";
import { normalisasiNoHp } from "../services/identitasWarga.js";
import { skemaId } from "./iuranUmum.js";

/**
 * Kolom anggota yang boleh terlihat/diubah — NIK plaintext tidak pernah ikut.
 * DIPAKAI BERSAMA oleh `GET /warga/keluarga` dan `GET/PATCH/POST /rt/warga`
 * (spesifikasi §5.4 · B13): 4 kolom detail (tempat lahir, pendidikan,
 * tanggal perkawinan, kewarganegaraan) ikut dipilih supaya form Edit Data
 * Warga Portal RT selalu terisi dari DB — bukan kosong lalu tak sengaja
 * mengosongkan kolom saat disimpan (bug F-6).
 */
export const PilihAnggota = {
  id: true,
  nama: true,
  hubungan: true,
  nikMasked: true,
  noHp: true,
  email: true,
  tanggalLahir: true,
  jenisKelamin: true,
  pekerjaan: true,
  agama: true,
  golDarah: true,
  statusKawin: true,
  tempatLahir: true,
  pendidikan: true,
  tanggalPerkawinan: true,
  wargaNegara: true,
  fotoUrl: true,
  statusAkses: true,
} as const;

/** Bentuk hasil `findMany({ select: PilihAnggota })` — dipetakan struktural. */
export type AnggotaTerpilih = {
  id: string;
  nama: string;
  hubungan: string;
  nikMasked: string | null;
  noHp: string | null;
  email: string | null;
  tanggalLahir: Date | null;
  jenisKelamin: string | null;
  pekerjaan: string | null;
  agama: string | null;
  golDarah: string | null;
  statusKawin: string | null;
  tempatLahir: string | null;
  pendidikan: string | null;
  tanggalPerkawinan: Date | null;
  wargaNegara: string | null;
  fotoUrl: string | null;
  statusAkses: string;
};

/**
 * Whitelist pembaruan kontak — hanya field ini yang diterima; objek apa pun di
 * luar ini di-strip zod (unknown keys) sehingga tidak pernah menyentuh kolom
 * protektif (nama/hubungan/NIK/tanggal lahir).
 */
const skemaKontak = z
  .object({
    noHp: z.string().trim().regex(/^\d{10,13}$/, "No. HP harus 10–13 digit angka.").optional(),
    email: z
      .union([z.string().trim().email("Format surel tidak valid.").max(160, "Surel maksimal 160 karakter."), z.literal("")])
      .optional(),
    pekerjaan: z.string().trim().max(80, "Pekerjaan maksimal 80 karakter.").optional(),
    agama: z.string().trim().max(40, "Agama maksimal 40 karakter.").optional(),
    golDarah: z.enum(["A", "B", "AB", "O"]).optional(),
    statusKawin: z.enum(["Belum Menikah", "Menikah", "Cerai Hidup", "Cerai Mati"]).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: "Tidak ada perubahan yang dikirim.",
  });

/** No.KK → gaya tampilan `3171-xxxx-xxxx-0002`; nilai non-16-digit diteruskan utuh. */
export function maskNoKk(raw: string): string {
  const d = raw.replace(/\D/g, "");
  return d.length === 16 ? `${d.slice(0, 4)}-xxxx-xxxx-${d.slice(12)}` : raw;
}

/**
 * Skema `POST /warga/keluarga/ajuan` (§5.3 · B11). `jenis` = enum DB
 * `JenisPerubahan`; `targetWargaId` wajib anggota 1 KK dengan sesi.
 */
const skemaAjuan = z.object({
  targetWargaId: skemaId,
  jenis: z.enum(["perubahan_kk", "tambah_anggota", "kontak", "sensitif"]),
  namaAnggota: z.string().trim().min(1, "Nama anggota wajib diisi.").max(120, "Nama anggota maksimal 120 karakter."),
  keterangan: z.string().trim().min(10, "Keterangan minimal 10 karakter.").max(500, "Keterangan maksimal 500 karakter."),
});

/** Kolom ajuan yang dibaca portal warga — NIK/field mentah tidak pernah ikut. */
const PilihAjuan = {
  id: true,
  jenis: true,
  status: true,
  payloadSesudah: true,
  catatanVerifikasi: true,
  diajukanPada: true,
  diprosesPada: true,
} as const;

type AjuanTerpilih = {
  id: string;
  jenis: string;
  status: string;
  payloadSesudah: unknown;
  catatanVerifikasi: string | null;
  diajukanPada: Date;
  diprosesPada: Date | null;
};

/** Satu baris ajuan → JSON panel "Status Pengajuan" (enum mentah, label di FE). */
function jsonAjuan(a: AjuanTerpilih) {
  const sesudah = (a.payloadSesudah ?? {}) as Record<string, unknown>;
  return {
    id: a.id,
    jenis: a.jenis,
    status: a.status,
    namaAnggota: typeof sesudah.namaAnggota === "string" ? sesudah.namaAnggota : null,
    keterangan: typeof sesudah.keterangan === "string" ? sesudah.keterangan : null,
    catatanVerifikasi: a.catatanVerifikasi,
    diajukanPada: a.diajukanPada.toISOString(),
    diprosesPada: a.diprosesPada ? a.diprosesPada.toISOString() : null,
  };
}

/** Urutan tampil kartu: kepala → istri → anak (tua muda) → lainnya → nama. */
const URUT_HUBUNGAN: Record<string, number> = { kepala: 0, istri: 1, anak: 2, lainnya: 3 };

export function urutAnggota<T extends { hubungan: string; tanggalLahir: Date | null; nama: string }>(list: T[]): T[] {
  return [...list].sort(
    (a, b) =>
      (URUT_HUBUNGAN[a.hubungan] ?? 9) - (URUT_HUBUNGAN[b.hubungan] ?? 9) ||
      (a.tanggalLahir?.getTime() ?? Number.MAX_SAFE_INTEGER) - (b.tanggalLahir?.getTime() ?? Number.MAX_SAFE_INTEGER) ||
      a.nama.localeCompare(b.nama),
  );
}

/** `Date?` kolom `@db.Date` → string ISO `YYYY-MM-DD` (tanpa geser zona). */
export function tanggalIso(t: Date | null): string | null {
  return t ? t.toISOString().slice(0, 10) : null;
}

/** Satu baris anggota → JSON ter-mask (§14/B17 — `nikMasked` saja). */
export function jsonAnggota(a: AnggotaTerpilih) {
  return {
    id: a.id,
    nama: a.nama,
    hubungan: a.hubungan,
    nikMasked: a.nikMasked,
    noHp: a.noHp,
    email: a.email,
    tanggalLahir: tanggalIso(a.tanggalLahir),
    jenisKelamin: a.jenisKelamin,
    pekerjaan: a.pekerjaan,
    agama: a.agama,
    golDarah: a.golDarah,
    statusKawin: a.statusKawin,
    tempatLahir: a.tempatLahir,
    pendidikan: a.pendidikan,
    tanggalPerkawinan: tanggalIso(a.tanggalPerkawinan),
    wargaNegara: a.wargaNegara,
    fotoUrl: a.fotoUrl,
    statusAkses: a.statusAkses,
  };
}

function bangunKeluarga(
  kk: { id: string; noKk: string; kepalaKeluarga: string; alamat: string },
  anggota: AnggotaTerpilih[],
  ajuan: AjuanTerpilih[],
) {
  const urut = urutAnggota(anggota);
  return {
    kk: {
      id: kk.id,
      noKk: maskNoKk(kk.noKk),
      kepala: kk.kepalaKeluarga,
      alamat: kk.alamat,
      jumlahAnggota: urut.length,
    },
    anggota: urut.map(jsonAnggota),
    // Status pengajuan (B11/B20): subjek ajuan selalu anggota 1 KK yang sama,
    // jadi penyaring lewat relasi `warga.kkId` mencakup seluruh anggota sesi.
    ajuan: ajuan.map(jsonAjuan),
  };
}

export const ruteWargaKeluarga: FastifyPluginAsync = async (app) => {
  /** Baca KK milik sesi warga — selalu melalui scope miliknya sendiri (§4.6). */
  app.get("/warga/keluarga", async (req, reply) => {
    const { wargaId, rtId } = wajibWarga(req);
    const hasil = await denganScopeRequest(req, async (tx) => {
      const diri = await tx.warga.findFirst({
        where: { id: wargaId, rtId },
        select: { kkId: true },
      });
      if (!diri) throw new GalatTolak("NOT_FOUND", "Data warga tidak ditemukan.");
      const kk = await tx.kartuKeluarga.findFirst({
        where: { id: diri.kkId, rtId },
        select: { id: true, noKk: true, kepalaKeluarga: true, alamat: true },
      });
      if (!kk) throw new GalatTolak("NOT_FOUND", "Kartu Keluarga tidak ditemukan.");
      const anggota = await tx.warga.findMany({
        where: { kkId: kk.id, rtId },
        select: PilihAnggota,
      });
      const ajuan = await tx.perubahanDataWarga.findMany({
        where: { rtId, warga: { kkId: kk.id } },
        orderBy: { diajukanPada: "desc" },
        take: 20,
        select: PilihAjuan,
      });
      return bangunKeluarga(kk, anggota, ajuan);
    });
    return reply.ok(hasil);
  });

  /** Simpan kontak anggota 1 KK (deviasi §5.3 — lihat catatan berkas ini). */
  app.post("/warga/keluarga/:id/kontak", async (req, reply) => {
    const { wargaId, rtId } = wajibWarga(req);
    const { id } = z.object({ id: skemaId }).parse(req.params);
    const body = skemaKontak.parse(req.body ?? {});

    const diperbarui = await denganScopeRequest(req, async (tx) => {
      const diri = await tx.warga.findFirst({
        where: { id: wargaId, rtId },
        select: { kkId: true },
      });
      if (!diri) throw new GalatTolak("NOT_FOUND", "Data warga tidak ditemukan.");
      const target = await tx.warga.findFirst({
        where: { id, rtId },
        select: { ...PilihAnggota, kkId: true },
      });
      // ID asing ATAU beda KK → NOT_FOUND: jangan bocorkan keberadaan baris
      // warga lain kepada sesi ini.
      if (!target || target.kkId !== diri.kkId) {
        throw new GalatTolak("NOT_FOUND", "Anggota tidak ditemukan dalam Kartu Keluarga Anda.");
      }

      const sebelum = {
        noHp: target.noHp,
        email: target.email,
        pekerjaan: target.pekerjaan,
        agama: target.agama,
        golDarah: target.golDarah,
        statusKawin: target.statusKawin,
      };

      const data = {
        ...(body.noHp !== undefined ? { noHp: normalisasiNoHp(body.noHp) } : {}),
        ...(body.email !== undefined ? { email: body.email === "" ? null : body.email } : {}),
        ...(body.pekerjaan !== undefined ? { pekerjaan: body.pekerjaan } : {}),
        ...(body.agama !== undefined ? { agama: body.agama } : {}),
        ...(body.golDarah !== undefined ? { golDarah: body.golDarah } : {}),
        ...(body.statusKawin !== undefined ? { statusKawin: body.statusKawin } : {}),
      };

      // Bentrok no. HP unik per RT (index `warga_rt_id_no_hp_key`) meledak di
      // sini → errorHandler memetakan P2002 → CONFLICT 409 (bukan 500).
      const hasil = await tx.warga.update({
        where: { id: target.id },
        data,
        select: PilihAnggota,
      });

      await catatAudit(
        {
          scopeLevel: "rt",
          scopeId: rtId,
          actorId: wargaId,
          actorRole: "warga",
          portal: "warga",
          modul: "data_keluarga",
          aksi: "perbarui_kontak",
          aksiBadge: "Data Keluarga",
          entitas: "warga",
          entitasId: target.id,
          sebelum,
          sesudah: {
            noHp: hasil.noHp,
            email: hasil.email,
            pekerjaan: hasil.pekerjaan,
            agama: hasil.agama,
            golDarah: hasil.golDarah,
            statusKawin: hasil.statusKawin,
          },
          ringkasan: `Pembaruan kontak ${target.nama} (${Object.keys(data).join(", ")})`,
          ip: req.ipAsli,
        },
        tx,
      );

      return hasil;
    });

    return reply.ok({ anggota: jsonAnggota(diperbarui) });
  });

  /**
   * Ajukan perubahan resmi KK (§5.3 · B11) — baris `perubahan_data_warga`
   * ber-status `menunggu`, dibaca ulang lewat `GET /warga/keluarga.ajuan` dan
   * diverifikasi RT (`/rt/ajuan-perubahan/*`, B20).
   */
  app.post("/warga/keluarga/ajuan", async (req, reply) => {
    const { wargaId, rtId } = wajibWarga(req);
    const body = skemaAjuan.parse(req.body ?? {});

    const ajuan = await denganScopeRequest(req, async (tx) => {
      const diri = await tx.warga.findFirst({
        where: { id: wargaId, rtId },
        select: { kkId: true, nama: true },
      });
      if (!diri) throw new GalatTolak("NOT_FOUND", "Data warga tidak ditemukan.");

      const target = await tx.warga.findFirst({
        where: { id: body.targetWargaId, rtId },
        select: { id: true, nama: true, hubungan: true, nikMasked: true, noHp: true, pekerjaan: true, kkId: true },
      });
      // ID asing ATAU beda KK → NOT_FOUND (sama dengan rute kontak).
      if (!target || target.kkId !== diri.kkId) {
        throw new GalatTolak("NOT_FOUND", "Anggota tidak ditemukan dalam Kartu Keluarga Anda.");
      }

      // Satu jenis cukup satu antrean menunggu — cegah spam dobel tanpa
      // memblokir pengajuan jenis lain yang memang berbeda.
      const kembar = await tx.perubahanDataWarga.findFirst({
        where: { rtId, wargaId: target.id, jenis: body.jenis, status: "menunggu" },
        select: { id: true },
      });
      if (kembar) {
        throw new GalatTolak("CONFLICT", "Pengajuan sejenis masih menunggu verifikasi Pengurus RT.");
      }

      const dibuat = await tx.perubahanDataWarga.create({
        data: {
          rtId,
          // `wargaId` = SUBJEK perubahan (anggota KK); pengaju tercatat di
          // payload + `audit_log.actor_id` (append-only).
          wargaId: target.id,
          pengaju: "warga",
          jenis: body.jenis,
          payloadSebelum: {
            pengajuNama: diri.nama,
            nama: target.nama,
            hubungan: target.hubungan,
            // Snapshot hanya nilai ter-mask — tabel ini tak pernah menyimpan
            // NIK plaintext (§14/B17).
            nikMasked: target.nikMasked,
            noHp: target.noHp,
            pekerjaan: target.pekerjaan,
          },
          payloadSesudah: { namaAnggota: body.namaAnggota, keterangan: body.keterangan },
          status: "menunggu",
        },
      });

      await catatAudit(
        {
          scopeLevel: "rt",
          scopeId: rtId,
          actorId: wargaId,
          actorRole: "warga",
          portal: "warga",
          modul: "ajuan_perubahan",
          aksi: "ajukan_perubahan",
          aksiBadge: "Pengajuan",
          entitas: "perubahan_data_warga",
          entitasId: dibuat.id,
          sebelum: null,
          sesudah: { jenis: body.jenis, status: "menunggu", namaAnggota: body.namaAnggota },
          ringkasan: `Ajukan perubahan resmi (${body.jenis}) untuk ${body.namaAnggota}`,
          ip: req.ipAsli,
        },
        tx,
      );

      return dibuat;
    });

    return reply.ok({ ajuan: jsonAjuan(ajuan) });
  });
};
