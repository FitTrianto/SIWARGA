/**
 * CRUD Data Warga — Portal RT (PRD §6.2 · spesifikasi §5.4 · task B13).
 *
 *   GET    /rt/warga        → `{ warga[], keluarga[] }` — baris tabel + daftar KK
 *   POST   /rt/warga        → buat 1 KK BESERTA seluruh anggotanya (1 request)
 *   PATCH  /rt/warga/:id    → ubah data 1 warga (+ No.KK/alamat/kelala KK bila berubah)
 *   DELETE /rt/warga/:id    → hapus 1 warga (guard riwayat → CONFLICT)
 *
 * Latar (keputusan 30 Sep 2026): sebelumnya Portal RT memakai data demo lokal
 * (`initialKkList` + `wargaRtDefault`) dan edit hanya terjadi in-memory —
 * padahal Portal Warga sudah membaca DB, sehingga perubahan RT tidak pernah
 * sampai ke Warga (penyebab utama "status nikah Dimas" berbeda antar portal).
 * Empat rute inilah yang menyatukan Data Warga RT, Data Keluarga Portal Warga,
 * dan seluruh turunannya (Kas, Iuran, Laporan, Dashboard) pada satu sumber
 * kebenaran.
 *
 * Aturan yang ditegakkan:
 *   • NIK TIDAK PERNAH plaintext (§14/B17): respons hanya memuat `nik_masked`;
 *     No.KK pun disajikan ter-mask `3171-xxxx-xxxx-0002`. NIK baru hanya
 *     diterima bila FE mengetik ulang 16 digit (`nikBaru`) — nilai ter-mask
 *     yang tidak diubah tidak pernah dikirim (validasi FE "masked-unchanged").
 *   • Scope + RLS §4.6: seluruh query di dalam `denganScopeRequest`; target di
 *     luar RT membalas `NOT_FOUND` (404) sehingga keberadaan data tidak bocor.
 *   • Mutasi wajib `verifikasiCsrf` (§5.6) + `pengurusAktif` + `catatAudit`
 *     ber-diff ter-mask (`diffAudit` menandai kunci nik/noKk "disembunyikan");
 *     kas/audit tetap append-only lewat trigger yang sudah ada.
 *   • CHECK DB dijaga sebelum tulis: `tanggal_perkawinan` ↔ `status_kawin`
 *     divalidasi atas gabungan data lama + payload (bukan payload mentah);
 *     enum `gol_darah`/`status_kawin`/`warga_negara` divalidasi zod → 400.
 *   • `hubungan = kepala` ikut memperbarui `kartu_keluarga.kepala_keluarga`
 *     (semangat yang sama dengan patch mode demo di FE).
 *   • P2002 (No.KK bentrok per RT / no. HP sudah terdaftar) → `CONFLICT` (409)
 *     otomatis lewat `plugins/errorHandler.ts`; transaksi di-rollback.
 *   • DELETE: riwayat tagihan/pembayaran/surat/akun/mutasi/ajuan memblokir
 *     penghapusan (409 CONFLICT) — FK CASCADE berbahaya (riwayat keuangan &
 *     akun terhapus diam-diam), FK RESTRICT akan gagal dengan pesan teknis.
 *     Token undangan/OTP (tanpa nilai riwayat) dicabut sebagai pembersihan.
 *     KK TIDAK ikut dihapus (konsisten dengan perilaku FE); `jumlah_anggota`
 *     dan kepala keluarga dihitung ulang dari sisa anggota.
 *
 * Ekstensi bersama `routes/wargaKeluarga.ts`: `PilihAnggota`/`jsonAnggota`
 * kini ikut memuat 4 kolom detail (tempat lahir, pendidikan, tanggal
 * perkawinan, kewarganegaraan) sehingga form Edit Data Warga selalu terisi
 * dari DB — bukan kosong lalu mengosongkan kolom saat disimpan (bug F-6).
 */
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { config } from "../config.js";
import { catatAudit, diffAudit, teksRingkasan } from "../plugins/audit.js";
import { verifikasiCsrf } from "../plugins/csrf.js";
import { GalatTolak, wajibRt } from "../plugins/guard.js";
import { denganScopeRequest } from "../plugins/scope.js";
import type { Prisma } from "../generated/prisma/client.js";
import { normalisasiNoHp } from "../services/identitasWarga.js";
import { sembunyikanNik } from "../services/crypto.js";
import { cabutSesiSubjek } from "../services/sesi.js";
import { pengurusAktif, skemaId } from "./iuranUmum.js";
import {
  jsonAnggota,
  maskNoKk,
  PilihAnggota,
  tanggalIso,
  urutAnggota,
  type AnggotaTerpilih,
} from "./wargaKeluarga.js";

const TGL = /^\d{4}-\d{2}-\d{2}$/;
const NIK16 = /^\d{16}$/;
const HP = /^\d{10,13}$/;

// ---------------------------------------------------------------------------
// Pilihan kolom & pemetaan JSON
// ---------------------------------------------------------------------------

/** Baris warga + KK-nya (ter-mask) untuk tabel Data Warga Portal RT. */
const PilihBaris = {
  id: true,
  nama: true,
  hubungan: true,
  nikMasked: true,
  noHp: true,
  tempatLahir: true,
  tanggalLahir: true,
  jenisKelamin: true,
  agama: true,
  pendidikan: true,
  pekerjaan: true,
  golDarah: true,
  statusKawin: true,
  tanggalPerkawinan: true,
  wargaNegara: true,
  statusAkses: true,
  statusDemografis: true,
  kk: { select: { id: true, noKk: true, alamat: true, kepalaKeluarga: true } },
  rumah: { select: { statusHuni: true } },
} as const;

type BarisTerpilih = {
  id: string;
  nama: string;
  hubungan: string;
  nikMasked: string | null;
  noHp: string | null;
  tempatLahir: string | null;
  tanggalLahir: Date | null;
  jenisKelamin: string | null;
  agama: string | null;
  pendidikan: string | null;
  pekerjaan: string | null;
  golDarah: string | null;
  statusKawin: string | null;
  tanggalPerkawinan: Date | null;
  wargaNegara: string | null;
  statusAkses: string;
  statusDemografis: string;
  kk: { id: string; noKk: string; alamat: string; kepalaKeluarga: string };
  rumah: { statusHuni: string } | null;
};

/** Satu baris warga → JSON respons (NIK hanya `nikMasked`, No.KK ter-mask). */
function jsonBaris(b: BarisTerpilih) {
  return {
    id: b.id,
    nama: b.nama,
    nikMasked: b.nikMasked,
    noHp: b.noHp,
    hubungan: b.hubungan,
    tempatLahir: b.tempatLahir,
    tanggalLahir: tanggalIso(b.tanggalLahir),
    jenisKelamin: b.jenisKelamin,
    agama: b.agama,
    pendidikan: b.pendidikan,
    pekerjaan: b.pekerjaan,
    golDarah: b.golDarah,
    statusKawin: b.statusKawin,
    tanggalPerkawinan: tanggalIso(b.tanggalPerkawinan),
    wargaNegara: b.wargaNegara,
    statusAkses: b.statusAkses,
    statusDemografis: b.statusDemografis,
    statusHuni: b.rumah?.statusHuni ?? null,
    kk: {
      id: b.kk.id,
      noKk: maskNoKk(b.kk.noKk),
      alamat: b.kk.alamat,
      kepala: b.kk.kepalaKeluarga,
    },
  };
}

const PilihKeluarga = {
  id: true,
  noKk: true,
  kepalaKeluarga: true,
  alamat: true,
  anggotaList: { select: PilihAnggota },
} as const;

type KeluargaTerpilih = {
  id: string;
  noKk: string;
  kepalaKeluarga: string;
  alamat: string;
  anggotaList: AnggotaTerpilih[];
};

/**
 * Satu KK → `{ kk, anggota }` bentuk IDENTIK `GET /warga/keluarga` (tanpa
 * `ajuan` — antrean ajuan RT punya rute sendiri) sehingga FE memakai
 * `keluargaKeKkData()` yang sama untuk kedua portal.
 */
function jsonKeluarga(k: KeluargaTerpilih) {
  const anggota = urutAnggota(k.anggotaList);
  return {
    kk: {
      id: k.id,
      noKk: maskNoKk(k.noKk),
      kepala: k.kepalaKeluarga,
      alamat: k.alamat,
      jumlahAnggota: anggota.length,
    },
    anggota: anggota.map(jsonAnggota),
  };
}

// ---------------------------------------------------------------------------
// Skema payload
// ---------------------------------------------------------------------------

/** Satu anggota untuk `POST /rt/warga` (label FE sudah dikonversi ke enum). */
const skemaAnggotaBaru = z.object({
  nama: z.string().trim().min(1, "Nama anggota wajib diisi.").max(120, "Nama anggota maksimal 120 karakter."),
  nik: z.string().regex(NIK16, "NIK harus 16 digit angka."),
  hubungan: z.enum(["kepala", "istri", "anak", "lainnya"]),
  jenisKelamin: z.enum(["laki_laki", "perempuan"]).nullable(),
  agama: z.string().trim().max(40, "Agama maksimal 40 karakter.").nullable(),
  tanggalLahir: z.string().regex(TGL, "Tanggal lahir harus format YYYY-MM-DD.").nullable(),
  pekerjaan: z.string().trim().max(80, "Pekerjaan maksimal 80 karakter.").nullable(),
  noHp: z.string().trim().regex(HP, "No. HP harus 10–13 digit angka.").nullable(),
});

const skemaTambah = z.object({
  noKk: z.string().regex(NIK16, "No. KK harus 16 digit angka."),
  alamat: z.string().trim().min(1, "Alamat wajib diisi.").max(160, "Alamat maksimal 160 karakter."),
  anggota: z
    .array(skemaAnggotaBaru)
    .min(1, "Isi minimal satu anggota keluarga.")
    .max(50, "Satu KK maksimal 50 anggota."),
});

/**
 * Patch sebagian `PATCH /rt/warga/:id`. Field `undefined` = tidak diubah;
 * `null` = bersihkan (khusus kolom nullable). NIK & No.KK HANYA dikirim bila
 * FE mengetik nilai 16-digit baru (`nikBaru`/`noKk`) — nilai ter-mask yang
 * tidak berubah tidak pernah masuk payload.
 */
const skemaUbah = z
  .object({
    nama: z.string().trim().min(1, "Nama lengkap wajib diisi.").max(120, "Nama maksimal 120 karakter.").optional(),
    nikBaru: z.string().regex(NIK16, "NIK harus 16 digit angka.").optional(),
    noHp: z.string().trim().regex(HP, "No. HP harus 10–13 digit angka.").optional(),
    alamat: z.string().trim().min(1, "Alamat wajib diisi.").max(160, "Alamat maksimal 160 karakter.").optional(),
    noKk: z.string().regex(NIK16, "No. KK harus 16 digit angka.").optional(),
    statusAkses: z.enum(["belum_diundang", "menunggu_aktivasi", "kedaluwarsa", "aktif", "dinonaktifkan"]).optional(),
    hubungan: z.enum(["kepala", "istri", "anak", "lainnya"]).optional(),
    tempatLahir: z.string().trim().max(80, "Tempat lahir maksimal 80 karakter.").nullable().optional(),
    tanggalLahir: z.string().regex(TGL, "Tanggal lahir harus format YYYY-MM-DD.").nullable().optional(),
    jenisKelamin: z.enum(["laki_laki", "perempuan"]).nullable().optional(),
    agama: z.string().trim().max(40, "Agama maksimal 40 karakter.").nullable().optional(),
    pendidikan: z.string().trim().max(60, "Pendidikan maksimal 60 karakter.").nullable().optional(),
    pekerjaan: z.string().trim().max(80, "Pekerjaan maksimal 80 karakter.").nullable().optional(),
    golDarah: z.enum(["A", "B", "AB", "O"]).nullable().optional(),
    statusKawin: z.enum(["Belum Menikah", "Menikah", "Cerai Hidup", "Cerai Mati"]).nullable().optional(),
    tanggalPerkawinan: z.string().regex(TGL, "Tanggal perkawinan harus format YYYY-MM-DD.").nullable().optional(),
    wargaNegara: z.enum(["WNI", "WNA"]).nullable().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: "Tidak ada perubahan yang dikirim.",
  });

/**
 * Target `PATCH /rt/warga/:id/akses` (task B5, §5.4): hanya dua perpindahan
 * AKSES portal. Menerima `statusAkses` (konvensi kode) maupun `status_akses`
 * (tulisan §5.4 dokumen desain) — keduanya bernilai sama.
 */
const skemaAkses = z.object({
  statusAkses: z.enum(["dinonaktifkan", "aktif"]).optional(),
  status_akses: z.enum(["dinonaktifkan", "aktif"]).optional(),
});

/** `"YYYY-MM-DD" | null` → `Date` (kolom `@db.Date`); `undefined` = tak diubah. */
function tanggalDariIso(v: string | null | undefined): Date | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  return new Date(v);
}

/** Normalisasi nilai untuk perbandingan audit: `Date` → ISO, kosong → null. */
function norm(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (v instanceof Date) return tanggalIso(v);
  return String(v);
}

// ---------------------------------------------------------------------------
// Rute
// ---------------------------------------------------------------------------

export const ruteRtDataWarga: FastifyPluginAsync = async (app) => {
  /**
   * Daftar seluruh warga + KK di lingkup RT sesi (§5.4).
   * Tanpa CSRF (baca saja); NIK hanya `nik_masked`, No.KK ter-mask.
   */
  app.get("/rt/warga", async (req, reply) => {
    const { rtId } = wajibRt(req);

    const hasil = await denganScopeRequest(req, async (tx) => {
      const [baris, kks] = await Promise.all([
        tx.warga.findMany({ where: { rtId }, orderBy: [{ nama: "asc" }], select: PilihBaris }),
        tx.kartuKeluarga.findMany({
          where: { rtId },
          orderBy: [{ createdAt: "asc" }],
          select: PilihKeluarga,
        }),
      ]);
      return { warga: baris.map(jsonBaris), keluarga: kks.map(jsonKeluarga) };
    });

    return reply.ok(hasil);
  });

  /**
   * Tambah Data KK (wizard form RT): satu request membuat 1 `kartu_keluarga`
   * + seluruh `warga` anggotanya dalam SATU transaksi — NIK dienkripsi
   * (`sembunyikanNik`), link rumah dicari best-effort by alamat (prasyarat
   * penerbitan undangan: `warga.noHp + warga.rumahId`).
   */
  app.post("/rt/warga", { preHandler: verifikasiCsrf }, async (req, reply) => {
    const { rtId, sesi } = wajibRt(req);
    const body = skemaTambah.parse(req.body ?? {});

    // NIK/No. HP ganda DI DALAM form → 400 sebelum menyentuh DB (DB tidak
    // punya unique NIK; aturan FE "NIK sama dipakai lebih dari satu anggota"
    // ditegakkan ulang di sini). Bentrok dengan data terdaftar → P2002 → 409.
    const nikDipakai = new Set<string>();
    const hpDipakai = new Set<string>();
    for (const a of body.anggota) {
      if (nikDipakai.has(a.nik)) {
        throw new GalatTolak("VALIDATION", "NIK sama dipakai lebih dari satu anggota.");
      }
      nikDipakai.add(a.nik);
      const hp = a.noHp ? normalisasiNoHp(a.noHp) : null;
      if (hp) {
        if (hpDipakai.has(hp)) {
          throw new GalatTolak("VALIDATION", "No. HP sama dipakai lebih dari satu anggota.");
        }
        hpDipakai.add(hp);
      }
    }

    const hasil = await denganScopeRequest(req, async (tx) => {
      const oleh = await pengurusAktif(tx, rtId, sesi.subjekId);

      // Link rumah "best-effort": alamat persis dengan `rumah.alamat` ATAU
      // `rumah.alamat_pendek` (case-insensitive). Tidak ketemu → tanpa rumah
      // (undangan baru bisa diterbitkan setelah hunian dipasang).
      const rumah = await tx.rumah.findFirst({
        where: {
          rtId,
          OR: [
            { alamat: { equals: body.alamat, mode: "insensitive" } },
            { alamatPendek: { equals: body.alamat, mode: "insensitive" } },
          ],
        },
        select: { id: true },
      });

      const kepala =
        body.anggota.find((a) => a.hubungan === "kepala")?.nama ?? body.anggota[0].nama;

      // No.KK unik per RT & no. HP unik per RT → P2002 → CONFLICT 409;
      // kegagalan di tengah transaksi me-rollback KK yang baru dibuat.
      const kk = await tx.kartuKeluarga.create({
        data: {
          rtId,
          noKk: body.noKk,
          kepalaKeluarga: kepala,
          alamat: body.alamat,
          jumlahAnggota: body.anggota.length,
          rumahId: rumah?.id ?? null,
        },
        select: { id: true },
      });

      for (const a of body.anggota) {
        const { nikEncrypted, nikMasked } = sembunyikanNik(a.nik, config.nikKey);
        await tx.warga.create({
          data: {
            rtId,
            kkId: kk.id,
            rumahId: rumah?.id ?? null,
            nama: a.nama,
            hubungan: a.hubungan,
            nikEncrypted,
            nikMasked,
            noHp: a.noHp ? normalisasiNoHp(a.noHp) : null,
            tanggalLahir: tanggalDariIso(a.tanggalLahir) ?? null,
            jenisKelamin: a.jenisKelamin,
            agama: a.agama || null,
            pekerjaan: a.pekerjaan || null,
            statusAkses: "belum_diundang",
            statusDemografis: "aktif",
          },
        });
      }

      const [baris, keluarga] = await Promise.all([
        tx.warga.findMany({ where: { kkId: kk.id }, orderBy: [{ nama: "asc" }], select: PilihBaris }),
        tx.kartuKeluarga.findUnique({ where: { id: kk.id }, select: PilihKeluarga }),
      ]);
      if (!keluarga) throw new Error("KK baru tidak ditemukan setelah dibuat — transaksi dibatalkan.");

      await catatAudit(
        {
          scopeLevel: "rt",
          scopeId: rtId,
          actorId: oleh,
          actorRole: "rt_admin",
          portal: "rt",
          modul: "data_warga",
          aksi: "tambah_warga",
          aksiBadge: "Data Warga",
          entitas: "kartu_keluarga",
          entitasId: kk.id,
          sesudah: {
            noKk: maskNoKk(body.noKk),
            alamat: body.alamat,
            kepalaKeluarga: kepala,
            jumlahAnggota: body.anggota.length,
          },
          ringkasan: `Tambah KK ${maskNoKk(body.noKk)} — ${body.anggota.length} anggota (Kepala: ${kepala}, ${body.alamat})`,
          ip: req.ipAsli,
        },
        tx,
      );

      return { warga: baris.map(jsonBaris), keluarga: jsonKeluarga(keluarga) };
    });

    return reply.ok(hasil);
  });

  /**
   * Ubah 1 warga (form Edit Data Warga). Whitelist ketat: kolom di luar
   * `skemaUbah` di-strip zod sehingga tidak pernah menyentuh kolom protektif.
   * Respons memuat baris + keluarga TERKINI agar FE memakai server sebagai
   * sumber kebenaran (bukan nilai form lokal yang mungkin ter-mask).
   */
  app.patch("/rt/warga/:id", { preHandler: verifikasiCsrf }, async (req, reply) => {
    const { rtId, sesi } = wajibRt(req);
    const { id } = z.object({ id: skemaId }).parse(req.params);
    const body = skemaUbah.parse(req.body ?? {});

    const hasil = await denganScopeRequest(req, async (tx) => {
      const lama = await tx.warga.findFirst({ where: { id, rtId }, select: PilihBaris });
      // ID asing / lintas RT → NOT_FOUND (404): jangan bocorkan keberadaan baris.
      if (!lama) throw new GalatTolak("NOT_FOUND", "Data warga tidak ditemukan.");

      // CHECK DB `warga_tanggal_kawin_konsisten`: tanggal_perkawinan wajib
      // punya status_kawin — divalidasi atas GABUNGAN data lama + payload,
      // bukan payload mentah (patch sebagian boleh mengirim salah satunya saja).
      const statusKawinAkhir = body.statusKawin !== undefined ? body.statusKawin : lama.statusKawin;
      const tglKawinAkhir =
        body.tanggalPerkawinan !== undefined
          ? body.tanggalPerkawinan
          : tanggalIso(lama.tanggalPerkawinan);
      if (tglKawinAkhir && !statusKawinAkhir) {
        throw new GalatTolak(
          "VALIDATION",
          "Tanggal Perkawinan hanya boleh diisi bersama Status Perkawinan.",
        );
      }

      const oleh = await pengurusAktif(tx, rtId, sesi.subjekId);

      // Snapshot awal untuk diff audit; nilai noKk/nik yang TERLARANG untuk
      // disimpan mentah ditandai "(disembunyikan)" oleh `diffAudit`.
      const snapLama: Record<string, unknown> = {
        nama: lama.nama,
        nik: lama.nikMasked,
        noHp: lama.noHp,
        hubungan: lama.hubungan,
        tempatLahir: lama.tempatLahir,
        tanggalLahir: lama.tanggalLahir,
        jenisKelamin: lama.jenisKelamin,
        agama: lama.agama,
        pendidikan: lama.pendidikan,
        pekerjaan: lama.pekerjaan,
        golDarah: lama.golDarah,
        statusKawin: lama.statusKawin,
        tanggalPerkawinan: lama.tanggalPerkawinan,
        wargaNegara: lama.wargaNegara,
        statusAkses: lama.statusAkses,
        noKk: lama.kk.noKk,
        alamat: lama.kk.alamat,
        kepalaKeluarga: lama.kk.kepalaKeluarga,
      };
      const snapBaru: Record<string, unknown> = { ...snapLama };

      const dataWarga: Record<string, unknown> = {};
      const isi = (kolom: string, nilai: unknown, nilaiLama: unknown) => {
        if (nilai === undefined) return; // tidak dikirim → tidak diubah
        if (norm(nilai) === norm(nilaiLama)) return; // sama → tidak perlu tulis
        dataWarga[kolom] = nilai;
        snapBaru[kolom] = nilai;
      };

      isi("nama", body.nama, lama.nama);
      isi("noHp", body.noHp === undefined ? undefined : normalisasiNoHp(body.noHp), lama.noHp);
      isi("hubungan", body.hubungan, lama.hubungan);
      isi("tempatLahir", body.tempatLahir, lama.tempatLahir);
      isi("tanggalLahir", tanggalDariIso(body.tanggalLahir), lama.tanggalLahir);
      isi("jenisKelamin", body.jenisKelamin, lama.jenisKelamin);
      isi("agama", body.agama, lama.agama);
      isi("pendidikan", body.pendidikan, lama.pendidikan);
      isi("pekerjaan", body.pekerjaan, lama.pekerjaan);
      isi("golDarah", body.golDarah, lama.golDarah);
      isi("statusKawin", body.statusKawin, lama.statusKawin);
      isi("tanggalPerkawinan", tanggalDariIso(body.tanggalPerkawinan), lama.tanggalPerkawinan);
      isi("wargaNegara", body.wargaNegara, lama.wargaNegara);
      isi("statusAkses", body.statusAkses, lama.statusAkses);

      // NIK baru hanya bila dikirim 16 digit; pembandingnya `nik_masked`
      // hasil enkripsi baru (nilai mentah tidak pernah ikut snapshot/diff).
      if (body.nikBaru !== undefined) {
        const rahasia = sembunyikanNik(body.nikBaru, config.nikKey);
        if (rahasia.nikMasked !== lama.nikMasked) {
          dataWarga.nikEncrypted = rahasia.nikEncrypted;
          dataWarga.nikMasked = rahasia.nikMasked;
          snapBaru.nik = rahasia.nikMasked;
        }
      }

      const namaAkhir = body.nama ?? lama.nama;
      const dataKk: Record<string, unknown> = {};
      if (body.noKk !== undefined && body.noKk !== lama.kk.noKk) {
        dataKk.noKk = body.noKk; // P2002 (bentrok per RT) → CONFLICT 409
        snapBaru.noKk = body.noKk;
      }
      let alamatBaru: string | null = null;
      if (body.alamat !== undefined && body.alamat !== lama.kk.alamat) {
        dataKk.alamat = body.alamat;
        snapBaru.alamat = body.alamat;
        alamatBaru = body.alamat;
      }
      // Re-link rumah saat alamat berubah: alamat dicocokan ulang dengan
      // aturan yang SAMA seperti POST /rt/warga (alamat ATAU alamat_pendek,
      // case-insensitive). Tanpa ini, rumah_id tetap menunjuk rumah LAMA —
      // Status Hunian salah & prasyarat undangan §6.3 terbaca keliru; alamat
      // baru tanpa unit hunian → null (undangan menunggu hunian dibuat dulu).
      let idRumahTujuan: string | null = null;
      if (alamatBaru !== null) {
        const rumahBaru = await tx.rumah.findFirst({
          where: {
            rtId,
            OR: [
              { alamat: { equals: alamatBaru, mode: "insensitive" } },
              { alamatPendek: { equals: alamatBaru, mode: "insensitive" } },
            ],
          },
          select: { id: true },
        });
        idRumahTujuan = rumahBaru?.id ?? null;
        dataKk.rumahId = idRumahTujuan;
      }
      // Semangat patch mode demo: hubungan menjadi "kepala" → nama kepala
      // keluarga di KK ikut menunjuk warga ini.
      if (body.hubungan === "kepala" && lama.kk.kepalaKeluarga !== namaAkhir) {
        dataKk.kepalaKeluarga = namaAkhir;
        snapBaru.kepalaKeluarga = namaAkhir;
      }

      const adaWarga = Object.keys(dataWarga).length > 0;
      const adaKk = Object.keys(dataKk).length > 0;

      if (adaWarga) {
        await tx.warga.update({
          where: { id: lama.id },
          data: dataWarga as Prisma.WargaUpdateInput,
        });
      }
      if (adaKk) {
        await tx.kartuKeluarga.update({
          where: { id: lama.kk.id },
          data: dataKk as Prisma.KartuKeluargaUpdateInput,
        });
      }
      if (alamatBaru !== null) {
        // Seluruh anggota KK ikut pindah: `rumah_id` tersimpan per baris warga
        // (bukan hanya warga yang diedit) karena prasyarat undangan §6.3
        // dihitung per warga.
        await tx.warga.updateMany({
          where: { kkId: lama.kk.id },
          data: { rumahId: idRumahTujuan },
        });
      }

      if (adaWarga || adaKk) {
        const diff = diffAudit(snapLama, snapBaru);
        const sebelum = Object.fromEntries(diff.map((d) => [d.field, d.lama]));
        const sesudah = Object.fromEntries(diff.map((d) => [d.field, d.baru]));
        await catatAudit(
          {
            scopeLevel: "rt",
            scopeId: rtId,
            actorId: oleh,
            actorRole: "rt_admin",
            portal: "rt",
            modul: "data_warga",
            aksi: "ubah_warga",
            aksiBadge: "Data Warga",
            entitas: "warga",
            entitasId: lama.id,
            sebelum,
            sesudah,
            ringkasan: `Perbarui data ${namaAkhir} — ${teksRingkasan(diff)}`,
            ip: req.ipAsli,
          },
          tx,
        );
      }

      const [baris, keluarga] = await Promise.all([
        tx.warga.findFirst({ where: { id: lama.id }, select: PilihBaris }),
        tx.kartuKeluarga.findUnique({ where: { id: lama.kk.id }, select: PilihKeluarga }),
      ]);
      if (!baris || !keluarga) throw new GalatTolak("NOT_FOUND", "Data warga tidak ditemukan.");

      return { warga: jsonBaris(baris), keluarga: jsonKeluarga(keluarga) };
    });

    return reply.ok(hasil);
  });

  /**
   * Ubah AKSES portal 1 warga (task B5 · §5.4) — `dinonaktifkan` | `aktif`.
   *
   * Dipisah dari `PATCH /rt/warga/:id` karena dampaknya KEAMANAN, bukan data:
   *   • `dinonaktifkan` — mencabut seluruh sesi login warga (`cabutSesiSubjek`)
   *     DAN token undangan yang masih `menunggu`; tanpa itu, aktivasi dari
   *     tautan lama bisa menghidupkan kembali portal yang baru dinonaktifkan.
   *     SATU pun data demografis TIDAK dihapus/disembunyikan (§6.2).
   *   • `aktif` — hanya dari `dinonaktifkan` DAN hanya bila kredensial login
   *     sudah ada; selain itu → 409 dengan panduan menerbitkan undangan
   *     (`POST /rt/warga/:id/undangan`) — akses portal tidak pernah "ditembak"
   *     langsung karena kata sandinya harus dibuat pemilik akun.
   *
   * Idempoten: status sudah sama → `{ ubah: false }` tanpa audit ganda.
   * Scope SELALU dari sesi (§4.6); lintas RT → 404.
   */
  app.patch("/rt/warga/:id/akses", { preHandler: verifikasiCsrf }, async (req, reply) => {
    const { rtId, sesi } = wajibRt(req);
    const { id } = z.object({ id: skemaId }).parse(req.params);
    const body = skemaAkses.parse(req.body ?? {});
    const tujuan = body.statusAkses ?? body.status_akses;
    if (!tujuan) {
      throw new GalatTolak("VALIDATION", "status_akses wajib diisi ('dinonaktifkan' | 'aktif').");
    }

    const hasil = await denganScopeRequest(req, async (tx) => {
      const warga = await tx.warga.findFirst({
        where: { id, rtId },
        select: { id: true, nama: true, statusAkses: true, isActive: true },
      });
      // ID asing / lintas RT → NOT_FOUND (404): jangan bocorkan keberadaan baris.
      if (!warga) throw new GalatTolak("NOT_FOUND", "Data warga tidak ditemukan.");
      if (!warga.isActive) {
        throw new GalatTolak("CONFLICT", `${warga.nama} berstatus non-aktif — aktifkan dulu datanya.`);
      }
      if (warga.statusAkses === tujuan) {
        return { id: warga.id, statusAkses: warga.statusAkses, ubah: false, perluCabutSesi: false };
      }

      if (tujuan === "dinonaktifkan") {
        if (warga.statusAkses === "belum_diundang") {
          throw new GalatTolak(
            "CONFLICT",
            `${warga.nama} belum pernah diundang — belum ada akses portal untuk dinonaktifkan.`,
          );
        }
        const oleh = await pengurusAktif(tx, rtId, sesi.subjekId);
        // Token 'menunggu' ikut dicabut supaya tautan lama tak bisa mengaktifkan
        // kembali portal yang baru dinonaktifkan.
        const undangan = await tx.tokenUndangan.updateMany({
          where: { wargaId: warga.id, status: "menunggu" },
          data: { status: "dicabut", dicabutOleh: oleh, dicabutPada: new Date() },
        });
        await tx.warga.update({ where: { id: warga.id }, data: { statusAkses: "dinonaktifkan" } });

        await catatAudit(
          {
            scopeLevel: "rt",
            scopeId: rtId,
            actorId: oleh,
            actorRole: "rt_admin",
            portal: "rt",
            modul: "data_warga",
            aksi: "nonaktifkan_akses",
            aksiBadge: "Akses",
            entitas: "warga",
            entitasId: warga.id,
            sebelum: { statusAkses: warga.statusAkses },
            sesudah: { statusAkses: "dinonaktifkan", undanganDicabut: undangan.count },
            ringkasan:
              `Nonaktifkan akses portal ${warga.nama}` +
              (undangan.count ? ` (${undangan.count} undangan dicabut)` : ""),
            ip: req.ipAsli,
          },
          tx,
        );
        return { id: warga.id, statusAkses: "dinonaktifkan", ubah: true, perluCabutSesi: true };
      }

      // tujuan === 'aktif'
      if (warga.statusAkses !== "dinonaktifkan") {
        throw new GalatTolak(
          "CONFLICT",
          `${warga.nama} bukan berstatus Dinonaktifkan — portal diaktifkan lewat undangan, bukan lewat rute ini.`,
        );
      }
      const kredensial = await tx.kredensialWarga.findUnique({
        where: { wargaId: warga.id },
        select: { wargaId: true },
      });
      if (!kredensial) {
        throw new GalatTolak(
          "CONFLICT",
          `${warga.nama} belum punya kredensial login — terbitkan undangan dulu agar kata sandi dibuat pemilik akun.`,
        );
      }
      await tx.warga.update({ where: { id: warga.id }, data: { statusAkses: "aktif" } });
      await catatAudit(
        {
          scopeLevel: "rt",
          scopeId: rtId,
          actorId: sesi.subjekId,
          actorRole: "rt_admin",
          portal: "rt",
          modul: "data_warga",
          aksi: "aktifkan_akses",
          aksiBadge: "Akses",
          entitas: "warga",
          entitasId: warga.id,
          sebelum: { statusAkses: warga.statusAkses },
          sesudah: { statusAkses: "aktif" },
          ringkasan: `Aktifkan kembali akses portal ${warga.nama}`,
          ip: req.ipAsli,
        },
        tx,
      );
      return { id: warga.id, statusAkses: "aktif", ubah: true, perluCabutSesi: false };
    });

    // Di luar transaksi scope: `sesi_login` tanpa RLS dan memakai klien induk.
    const sesiDicabut = hasil.perluCabutSesi ? await cabutSesiSubjek(hasil.id, "warga") : 0;

    return reply.ok({
      id: hasil.id,
      statusAkses: hasil.statusAkses,
      ubah: hasil.ubah,
      sesiDicabut,
    });
  });

  /**
   * Hapus 1 warga. Guard riwayat (lihat catatan berkas) → 409 CONFLICT;
   * tanpa riwayat → token undangan/OTP dicabut lalu baris dihapus, KK tetap
   * ada dengan `jumlah_anggota` + kepala keluarga dihitung ulang.
   */
  app.delete("/rt/warga/:id", { preHandler: verifikasiCsrf }, async (req, reply) => {
    const { rtId, sesi } = wajibRt(req);
    const { id } = z.object({ id: skemaId }).parse(req.params);

    const hasil = await denganScopeRequest(req, async (tx) => {
      const target = await tx.warga.findFirst({
        where: { id, rtId },
        select: {
          id: true,
          nama: true,
          hubungan: true,
          kkId: true,
          kk: { select: { id: true, noKk: true, alamat: true } },
        },
      });
      if (!target) throw new GalatTolak("NOT_FOUND", "Data warga tidak ditemukan.");

      const [tagihan, pembayaran, surat, akun, mutasi, ajuan] = await Promise.all([
        tx.tagihan.count({ where: { wargaId: target.id } }),
        tx.pembayaran.count({ where: { wargaId: target.id } }),
        tx.surat.count({ where: { wargaId: target.id } }),
        tx.kredensialWarga.count({ where: { wargaId: target.id } }),
        tx.mutasiSaldoWarga.count({ where: { wargaId: target.id } }),
        tx.perubahanDataWarga.count({ where: { wargaId: target.id } }),
      ]);
      const riwayat: string[] = [];
      if (tagihan) riwayat.push(`tagihan (${tagihan})`);
      if (pembayaran) riwayat.push(`pembayaran (${pembayaran})`);
      if (surat) riwayat.push(`surat (${surat})`);
      if (akun) riwayat.push("akun portal");
      if (mutasi) riwayat.push(`mutasi saldo (${mutasi})`);
      if (ajuan) riwayat.push(`ajuan perubahan (${ajuan})`);
      if (riwayat.length > 0) {
        throw new GalatTolak(
          "CONFLICT",
          `Warga ini memiliki riwayat ${riwayat.join(", ")} dan tidak bisa dihapus — gunakan Status Portal "Dinonaktifkan" bila perlu.`,
        );
      }

      const oleh = await pengurusAktif(tx, rtId, sesi.subjekId);

      // Token undangan/OTP tanpa nilai riwayat: dicabut agar FK RESTRICT pada
      // `token_undangan` tidak mematikan penghapusan warga yang belum aktif.
      await tx.tokenUndangan.deleteMany({ where: { wargaId: target.id } });
      await tx.percobaanOtp.deleteMany({ where: { wargaId: target.id } });
      await tx.warga.delete({ where: { id: target.id } });

      // KK dibiarkan (konsisten dengan perilaku FE yang tak punya "hapus KK");
      // jumlah anggota & kepala keluarga dihitung ulang dari sisa anggota.
      const sisa = await tx.warga.findMany({
        where: { kkId: target.kkId },
        orderBy: [{ nama: "asc" }],
        select: { nama: true, hubungan: true },
      });
      const kepalaKeluargaBaru =
        target.hubungan === "kepala" || sisa.length === 0
          ? (sisa.find((w) => w.hubungan === "kepala")?.nama ?? sisa[0]?.nama ?? "")
          : undefined; // bukan kepala & masih ada anggota → tak diubah
      await tx.kartuKeluarga.update({
        where: { id: target.kkId },
        data: {
          jumlahAnggota: sisa.length,
          ...(kepalaKeluargaBaru !== undefined ? { kepalaKeluarga: kepalaKeluargaBaru } : {}),
        },
      });

      const keluarga = await tx.kartuKeluarga.findUnique({
        where: { id: target.kkId },
        select: PilihKeluarga,
      });

      await catatAudit(
        {
          scopeLevel: "rt",
          scopeId: rtId,
          actorId: oleh,
          actorRole: "rt_admin",
          portal: "rt",
          modul: "data_warga",
          aksi: "hapus_warga",
          aksiBadge: "Data Warga",
          entitas: "warga",
          entitasId: target.id,
          sebelum: {
            nama: target.nama,
            hubungan: target.hubungan,
            noKk: maskNoKk(target.kk.noKk),
            alamat: target.kk.alamat,
          },
          sesudah: { nama: null, sisaAnggota: sisa.length },
          ringkasan: `Hapus warga ${target.nama} (${maskNoKk(target.kk.noKk)} — ${target.kk.alamat})`,
          ip: req.ipAsli,
        },
        tx,
      );

      return { id: target.id, keluarga: keluarga ? jsonKeluarga(keluarga) : null };
    });

    return reply.ok(hasil);
  });
};
