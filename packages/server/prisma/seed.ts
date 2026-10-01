/**
 * Data awal SIWARGA — menggantikan mock `apps/web/src/lib/shared.ts` (task B16).
 *
 * Cara menjalankan:
 *   pnpm prisma:deploy      # terapkan migrasi (butuh DATABASE_URL di .env)
 *   pnpm db:seed            # isi data contoh
 *   pnpm db:seed -- --force # isi ulang (menghapus data seed terlebih dulu)
 *
 * Desain penting:
 *   • Seed MENGGUNAKAN scope RLS, bukan menembusnya. Wilayah & RT dibuat dengan
 *     scope 'platform', lalu seluruh data RT dibuat dengan scope 'rt' yang sesuai.
 *     Bila RLS bocor atau scope salah, seed ini gagal — jadi seed sekaligus menjadi
 *     pengujian RLS nyata.
 *   • NIK disimpan ter-encryption (AES-256-GCM) + ter-mask; TIDAK pernah plaintext.
 *   • Kata sandi (pengurus & warga) di-hash argon2id.
 *   • Alokasi pembayaran dihitung lewat `alokasiFIFO` (bukan di-hardcode), sehingga
 *     aturan FIFO & idempotensi ikut teruji saat seed berjalan.
 */
import {
  alokasikan,
  type TagihanAlokasi,
} from "../src/services/alokasiFIFO.js";
import { catatAudit } from "../src/plugins/audit.js";
import { config } from "../src/config.js";
import { sembunyikanNik } from "../src/services/crypto.js";
import { db, setScopeSesi, tutupDb, type Db } from "../src/services/db.js";
import { hashKataSandi } from "../src/services/kredensial.js";
import { tokenBaru, buatKodeUndangan, hashKodeUndangan } from "../src/services/tokenUndangan.js";

const PERIODE_AKTIF = "2026-10"; // Oktober 2026 (periode aktif sistem)
// Kebijakan Fase 3: login warga memakai kata sandi (min 8), bukan PIN 6-digit.
const SANDI_WARGA = "WargaDev2026";
const SANDI_RT = "rahasia123";

const log = (...args: unknown[]) => console.log("[seed]", ...args);

function nikDari(tanggalLahir: string, seri: string): string {
  const [tahun, bulan, hari] = tanggalLahir.split("-");
  return `317105${tahun!.slice(2)}${bulan}${hari}${seri}`;
}

function tgl(iso: string): Date {
  const d = new Date(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`Tanggal tidak valid: ${iso}`);
  return d;
}

interface WargaSeed {
  nama: string;
  hubungan: "kepala" | "istri" | "anak" | "lainnya";
  tanggalLahir: string;
  jenisKelamin: "laki_laki" | "perempuan";
  noHp: string | null;
  pekerjaan: string;
  agama: string;
  /**
   * Detail KK — 6 field tambahan dari form Edit Data Warga (Portal RT).
   * Nilainya sengaja disamakan persis dengan daftar opsi di FE
   * (`DataWargaRT.tsx`) sehingga lolos CHECK constraint di database.
   */
  tempatLahir: string;
  pendidikan: string;
  golDarah: "A" | "B" | "AB" | "O";
  statusKawin: "Belum Menikah" | "Menikah" | "Cerai Hidup" | "Cerai Mati";
  /** ISO `YYYY-MM-DD`; `null` bila belum menikah/tidak relevan. */
  tanggalPerkawinan: string | null;
  wargaNegara: "WNI" | "WNA";
  seriNik: string;
  statusAkses: "belum_diundang" | "menunggu_aktivasi" | "aktif";
  portalAktif: boolean;
}

// -----------------------------------------------------------------------------
// Data contoh
// -----------------------------------------------------------------------------

const KEPALA_KK: Array<{
  noKk: string;
  kepala: string;
  alamat: string;
  rumah: "B4-12" | "B4-13" | "A1-03";
  anggota: WargaSeed[];
}> = [
  {
    noKk: "3171050101050002",
    kepala: "Bambang Supriyanto",
    alamat: "Jl. Melati Blok B No. 12",
    rumah: "B4-12",
    anggota: [
      {
        nama: "Bambang Supriyanto",
        hubungan: "kepala",
        tanggalLahir: "1985-06-06",
        jenisKelamin: "laki_laki",
        noHp: "081234567890",
        pekerjaan: "Pegawai Swasta",
        agama: "Islam",
        tempatLahir: "Jakarta",
        pendidikan: "S1",
        golDarah: "O",
        statusKawin: "Menikah",
        tanggalPerkawinan: "2008-07-19",
        wargaNegara: "WNI",
        seriNik: "0001",
        statusAkses: "aktif",
        portalAktif: true,
      },
      {
        nama: "Siti Nurhaliza",
        hubungan: "istri",
        tanggalLahir: "1987-09-14",
        jenisKelamin: "perempuan",
        noHp: "081234567891",
        pekerjaan: "Ibu Rumah Tangga",
        agama: "Islam",
        tempatLahir: "Jakarta",
        pendidikan: "SMA / SMK",
        golDarah: "A",
        statusKawin: "Menikah",
        tanggalPerkawinan: "2008-07-19",
        wargaNegara: "WNI",
        seriNik: "0002",
        statusAkses: "belum_diundang",
        portalAktif: false,
      },
      {
        nama: "Rina Amelia",
        hubungan: "anak",
        tanggalLahir: "2010-03-21",
        jenisKelamin: "perempuan",
        noHp: null,
        pekerjaan: "Pelajar",
        agama: "Islam",
        tempatLahir: "Jakarta",
        pendidikan: "SMA / SMK",
        golDarah: "B",
        statusKawin: "Belum Menikah",
        tanggalPerkawinan: null,
        wargaNegara: "WNI",
        seriNik: "0003",
        statusAkses: "belum_diundang",
        portalAktif: false,
      },
      {
        nama: "Dimas Prasetyo",
        hubungan: "anak",
        tanggalLahir: "2013-11-02",
        jenisKelamin: "laki_laki",
        noHp: null,
        pekerjaan: "Pelajar",
        agama: "Islam",
        tempatLahir: "Jakarta",
        pendidikan: "SMP",
        golDarah: "O",
        statusKawin: "Belum Menikah",
        tanggalPerkawinan: null,
        wargaNegara: "WNI",
        seriNik: "0004",
        statusAkses: "belum_diundang",
        portalAktif: false,
      },
    ],
  },
  {
    // Satu alamat yang sama menampung > 1 KK — didukung skema (keputusan desain)
    noKk: "3171051203100011",
    kepala: "Hendra Gunawan",
    alamat: "Jl. Melati Blok B No. 12",
    rumah: "B4-12",
    anggota: [
      {
        nama: "Hendra Gunawan",
        hubungan: "kepala",
        tanggalLahir: "1982-02-19",
        jenisKelamin: "laki_laki",
        noHp: "081234567892",
        pekerjaan: "Wiraswasta",
        agama: "Kristen Protestan",
        tempatLahir: "Bogor",
        pendidikan: "S1",
        golDarah: "A",
        statusKawin: "Menikah",
        tanggalPerkawinan: "2007-05-12",
        wargaNegara: "WNI",
        seriNik: "0005",
        statusAkses: "menunggu_aktivasi",
        portalAktif: false,
      },
      {
        nama: "Maya Sari",
        hubungan: "istri",
        tanggalLahir: "1984-07-30",
        jenisKelamin: "perempuan",
        noHp: "081234567893",
        pekerjaan: "Guru / Dosen",
        agama: "Kristen Protestan",
        tempatLahir: "Bogor",
        pendidikan: "S1",
        golDarah: "B",
        statusKawin: "Menikah",
        tanggalPerkawinan: "2007-05-12",
        wargaNegara: "WNI",
        seriNik: "0006",
        // Token undangan terbit di bawah → status akses ikut §6.3
        statusAkses: "menunggu_aktivasi",
        portalAktif: false,
      },
      {
        nama: "Farhan Maulana",
        hubungan: "anak",
        tanggalLahir: "2015-05-17",
        jenisKelamin: "laki_laki",
        noHp: null,
        pekerjaan: "Pelajar",
        agama: "Kristen Protestan",
        tempatLahir: "Bogor",
        pendidikan: "SD",
        golDarah: "AB",
        statusKawin: "Belum Menikah",
        tanggalPerkawinan: null,
        wargaNegara: "WNI",
        seriNik: "0007",
        statusAkses: "belum_diundang",
        portalAktif: false,
      },
    ],
  },
  {
    noKk: "3171052008980007",
    kepala: "Ahmad Fauzi",
    alamat: "Jl. Melati Blok A No. 3",
    rumah: "A1-03",
    anggota: [
      {
        nama: "Ahmad Fauzi",
        hubungan: "kepala",
        tanggalLahir: "1990-12-01",
        jenisKelamin: "laki_laki",
        noHp: "081234567894",
        pekerjaan: "Pegawai Swasta",
        agama: "Islam",
        tempatLahir: "Jakarta",
        pendidikan: "SMA / SMK",
        golDarah: "O",
        statusKawin: "Menikah",
        tanggalPerkawinan: "2013-06-15",
        wargaNegara: "WNI",
        seriNik: "0008",
        statusAkses: "aktif",
        portalAktif: true,
      },
      {
        nama: "Zahra Aini",
        hubungan: "istri",
        tanggalLahir: "1992-04-25",
        jenisKelamin: "perempuan",
        noHp: "081234567895",
        pekerjaan: "Kesehatan",
        agama: "Islam",
        tempatLahir: "Depok",
        pendidikan: "Diploma",
        golDarah: "O",
        statusKawin: "Menikah",
        tanggalPerkawinan: "2013-06-15",
        wargaNegara: "WNI",
        seriNik: "0009",
        statusAkses: "belum_diundang",
        portalAktif: false,
      },
    ],
  },
];

/**
 * Jenis surat RT 004 — NAMA & FLAG `perluRw` SAMA PERSIS dengan
 * `jenisSuratOptions` + `suratPerluRw()` di `apps/web/src/lib/shared.ts`
 * (Keputusan B), supaya pengajuan warga selalu muncul di antrian Portal RT dan
 * hanya SKCK/Pindah/Nikah yang menunggu persetujuan RW.
 * "Surat Lainnya..." sengaja TIDAK di-seed: opsi itu pilihan bebas warga,
 * bukan baris `jenis_surat`.
 */
const JENIS_SURAT_SEED = [
  {
    nama: "Surat Keterangan Domisili",
    kode: "SKD",
    perluRw: false,
    fieldWajib: ["keperluan", "lama_tinggal"],
  },
  {
    nama: "Surat Keterangan Tidak Mampu",
    kode: "SKTM",
    perluRw: false,
    fieldWajib: ["keperluan", "alasan"],
  },
  {
    nama: "Surat Pengantar SKCK",
    kode: "SKCK",
    perluRw: true,
    fieldWajib: ["keperluan", "tanggal_berangkat"],
  },
  {
    nama: "Surat Pengantar Pindah",
    kode: "SKP",
    perluRw: true,
    fieldWajib: ["keperluan", "alamat_tujuan", "tanggal_pindah"],
  },
  {
    nama: "Surat Pengantar Nikah",
    kode: "SKN",
    perluRw: true,
    fieldWajib: ["keperluan", "tanggal_berangkat"],
  },
  {
    nama: "Surat Keterangan Usaha",
    kode: "SKU",
    perluRw: false,
    fieldWajib: ["keperluan", "nama_usaha", "alamat_usaha"],
  },
  {
    nama: "Surat Keterangan Kelahiran",
    kode: "SKL",
    perluRw: false,
    fieldWajib: ["keperluan", "nama_anak", "tanggal_lahir"],
  },
  {
    nama: "Surat Keterangan Kematian",
    kode: "SKK",
    perluRw: false,
    fieldWajib: ["keperluan", "nama_almarhum", "tanggal_meninggal"],
  },
];

// -----------------------------------------------------------------------------
// Utilitas
// -----------------------------------------------------------------------------

const URUTAN_HAPUS = [
  "audit_log",
  "alokasi_pembayaran",
  "approval_kas",
  "kas_entry",
  "tutup_buku_kas",
  "pembayaran",
  "tagihan",
  "keringanan",
  "mutasi_saldo_warga",
  "profil_iuran_warga",
  "kategori_iuran",
  "surat",
  "jenis_surat",
  "token_undangan",
  "percobaan_otp",
  "kredensial_warga",
  "sesi_login",
  "perubahan_data_warga",
  "warga",
  "kartu_keluarga",
  "rumah",
  "pengaturan_rt",
  "pengurus_rt",
  "impor_data",
  "transaksi_langganan",
  "langganan",
  "permintaan_akses_detail",
  "pengguna_pengurus",
  "pengaturan_rw",
  "pengurus_rw",
  "rt",
  "rw",
  "kelurahan",
  "kecamatan",
  "konten_landing",
  "notifikasi_job",
] as const;

async function bersihkan(klien: Db): Promise<void> {
  log("menghapus data lama (--force)…");
  await setScopeSesi(klien, "platform", null);
  // Putus referensi melingkar sebelum DELETE (FK dua arah rumah ↔ kartu_keluarga,
  // dan rt.ketua_rt_id → pengurus_rt) supaya tidak melanggar constraint.
  await klien.$executeRawUnsafe(`UPDATE "rt" SET "ketua_rt_id" = NULL`);
  await klien.$executeRawUnsafe(`UPDATE "rumah" SET "kk_id" = NULL`);
  await klien.$executeRawUnsafe(`UPDATE "kartu_keluarga" SET "rumah_id" = NULL`);
  // Append-only (B8) memblokir DELETE pada empat tabel. Untuk reset data dev ini
  // trigger dimatikan sementara lalu SELALU dipasang kembali (try/finally) —
  // jalur inilah yang disarankan guard "database sudah terisi → --force".
  const appendOnly = [
    ["kas_entry", "trg_kas_entry_append_only"],
    ["audit_log", "trg_audit_log_append_only"],
    ["mutasi_saldo_warga", "trg_mutasi_saldo_append_only"],
    ["alokasi_pembayaran", "trg_alokasi_append_only"],
  ] as const;
  for (const [tabel, trigger] of appendOnly) {
    await klien.$executeRawUnsafe(`ALTER TABLE "${tabel}" DISABLE TRIGGER "${trigger}"`);
  }
  try {
    for (const tabel of URUTAN_HAPUS) {
      await klien.$executeRawUnsafe(`DELETE FROM "${tabel}"`);
    }
  } finally {
    for (const [tabel, trigger] of appendOnly) {
      await klien.$executeRawUnsafe(`ALTER TABLE "${tabel}" ENABLE TRIGGER "${trigger}"`);
    }
  }
}

// -----------------------------------------------------------------------------
// Seed
// -----------------------------------------------------------------------------

async function main(): Promise<void> {
  const klien = db();

  // Scope platform dahulu: tanpa scope, RLS menyembunyikan semua baris sehingga
  // pengecekan "sudah terisi?" akan selalu bernilai 0.
  await setScopeSesi(klien, "platform", null);

  const jumlahRt = await klien.rt.count();
  if (jumlahRt > 0) {
    if (process.argv.includes("--force")) {
      await bersihkan(klien);
    } else {
      log(`database sudah berisi ${jumlahRt} RT — dilewati.`);
      log("jalankan `pnpm db:seed -- --force` untuk mengisi ulang, atau `prisma migrate reset`.");
      return;
    }
  }

  const mulai = Date.now();

  // === SCOPE PLATFORM: wilayah & registrasi tenant ============================
  await setScopeSesi(klien, "platform", null);

  const kecamatan = await klien.kecamatan.upsert({
    where: { kode: "317105" },
    create: { kode: "317105", nama: "Kecamatan Cengkareng" },
    update: {},
  });

  const kelurahan = await klien.kelurahan.upsert({
    where: {
      kecamatanId_kodeKemendagri: { kecamatanId: kecamatan.id, kodeKemendagri: "3171050008" },
    },
    create: {
      kecamatanId: kecamatan.id,
      kodeKemendagri: "3171050008",
      nama: "Kelurahan Rawa Buaya",
    },
    update: {},
  });

  const rw = await klien.rw.upsert({
    where: { kelurahanId_kodeRw: { kelurahanId: kelurahan.id, kodeRw: "012" } },
    create: {
      kelurahanId: kelurahan.id,
      kodeRw: "012",
      namaKetua: "Drs. H. Sutrisno",
      noHpKetua: "08111000112",
      alamat: "Jl. Rawa Buaya Raya No. 8",
    },
    update: {},
  });

  const rt04 = await klien.rt.upsert({
    where: { rwId_kodeRt: { rwId: rw.id, kodeRt: "004" } },
    create: {
      rwId: rw.id,
      kelurahanId: kelurahan.id,
      kodeRt: "004",
      kodeWilayah: "3171050404",
      perumahan: "Perumahan Griya Asri",
      alamat: "Jl. Melati, RT 004 / RW 012",
      status: "aktif",
    },
    update: {},
  });

  // RT kedua — dipakai pengujian isolasi tenant (data RT05 tidak boleh terlihat RT04)
  const rt05 = await klien.rt.upsert({
    where: { rwId_kodeRt: { rwId: rw.id, kodeRt: "005" } },
    create: {
      rwId: rw.id,
      kelurahanId: kelurahan.id,
      kodeRt: "005",
      kodeWilayah: "3171050504",
      perumahan: "Perumahan Griya Asri",
      alamat: "Jl. Kenanga, RT 005 / RW 012",
      status: "aktif",
    },
    update: {},
  });

  await klien.pengurusRw.upsert({
    where: { rwId_email: { rwId: rw.id, email: "rw012@siwarga.id" } },
    create: {
      rwId: rw.id,
      nama: "Drs. H. Sutrisno",
      jabatan: "ketua",
      email: "rw012@siwarga.id",
      noHp: "08111000112",
    },
    update: {},
  });

  const pengurusRt04 = await klien.pengurusRt.upsert({
    where: { rtId_email: { rtId: rt04.id, email: "rt04@siwarga.id" } },
    create: {
      rtId: rt04.id,
      nama: "Joko Santoso",
      jabatan: "ketua",
      email: "rt04@siwarga.id",
      noHp: "081234567004",
    },
    update: {},
  });
  await klien.rt.update({ where: { id: rt04.id }, data: { ketuaRtId: pengurusRt04.id } });

  await klien.pengurusRt.upsert({
    where: { rtId_email: { rtId: rt05.id, email: "rt05@siwarga.id" } },
    create: {
      rtId: rt05.id,
      nama: "Budi Hartono",
      jabatan: "ketua",
      email: "rt05@siwarga.id",
      noHp: "081234567005",
    },
    update: {},
  });

  const sandiRt = await hashKataSandi(SANDI_RT);
  const sandiRw = await hashKataSandi(SANDI_RT);
  const sandiAdmin = await hashKataSandi("adminrahasia");

  await klien.penggunaPengurus.upsert({
    where: { email: "rt04@siwarga.id" },
    create: {
      peran: "rt_admin",
      rtId: rt04.id,
      email: "rt04@siwarga.id",
      noHp: "081234567890",
      passwordHash: sandiRt,
    },
    update: {},
  });
  // Profil RT05 (tenant isolasi) tanpa akun login = tak bisa masuk sama sekali;
  // akun ini dibuat agar uji lintas-tenant (sid RT05) & E2E bisa login dengan
  // sandi yang sama seperti pengurus RT lain (catatan kredensial dev).
  await klien.penggunaPengurus.upsert({
    where: { email: "rt05@siwarga.id" },
    create: {
      peran: "rt_admin",
      rtId: rt05.id,
      email: "rt05@siwarga.id",
      noHp: "081234567005",
      passwordHash: sandiRt,
    },
    update: {},
  });
  await klien.penggunaPengurus.upsert({
    where: { email: "rw012@siwarga.id" },
    create: {
      peran: "rw_admin",
      rwId: rw.id,
      email: "rw012@siwarga.id",
      noHp: "08111000112",
      passwordHash: sandiRw,
    },
    update: {},
  });
  await klien.penggunaPengurus.upsert({
    where: { email: "admin@siwarga.id" },
    create: {
      peran: "super_admin",
      email: "admin@siwarga.id",
      noHp: "08111000001",
      passwordHash: sandiAdmin,
    },
    update: {},
  });

  await klien.kontenLanding.upsert({
    where: { versi: 1 },
    create: {
      versi: 1,
      diubahOleh: "00000000-0000-4000-8000-000000000001",
      hero: {
        judul: "Satu Akses Digital untuk Rukun Warga",
        subjudul: "Kelola iuran, kas, surat, dan data warga dalam satu tempat.",
      },
      fitur: ["Data Warga", "Iuran & Tagihan", "Kas Transparan", "Surat Digital"],
      harga: [
        { nama: "Free", nominal: 0, fiturMaksimal: "1 RT" },
        { nama: "Pro", nominal: 150000, fiturMaksimal: "10 RT" },
        { nama: "Max", nominal: 400000, fiturMaksimal: "Tanpa batas" },
      ],
      persona: ["Ketua RT", "Bendahara", "Warga"],
    },
    update: {},
  });

  await klien.langganan.upsert({
    where: { rtId: rt04.id },
    create: {
      rtId: rt04.id,
      paket: "pro",
      mulai: tgl("2026-10-01"),
      aktifSampai: tgl("2027-10-01"),
      status: "aktif",
      metodeBayar: "transfer",
    },
    update: {},
  });

  // === SCOPE RT 004: data operasional ========================================
  await setScopeSesi(klien, "rt", rt04.id);

  await klien.pengaturanRt.upsert({
    where: { rtId: rt04.id },
    create: {
      rtId: rt04.id,
      modeAlokasi: "gabungan",
      tenggatHari: 10,
      dendaAktif: false,
      notifikasiWaEnabled: true,
      ambangApprovalKas: 500000,
      templateSurat: JENIS_SURAT_SEED.map((s) => ({ kode: s.kode, fieldWajib: s.fieldWajib })),
    },
    update: {},
  });

  const rumahB412 = await klien.rumah.upsert({
    where: { rtId_kodeRumah: { rtId: rt04.id, kodeRumah: "B4-12" } },
    create: {
      rtId: rt04.id,
      kodeRumah: "B4-12",
      alamat: "Jl. Melati Blok B No. 12",
      alamatPendek: "Blok B4 No. 12",
      unitKendaraanR4: 2,
      statusHuni: "milik",
    },
    update: {},
  });
  const rumahA103 = await klien.rumah.upsert({
    where: { rtId_kodeRumah: { rtId: rt04.id, kodeRumah: "A1-03" } },
    create: {
      rtId: rt04.id,
      kodeRumah: "A1-03",
      alamat: "Jl. Melati Blok A No. 3",
      alamatPendek: "Blok A1 No. 3",
      unitKendaraanR4: 1,
      statusHuni: "milik",
    },
    update: {},
  });

  const sandiWargaHash = await hashKataSandi(SANDI_WARGA);
  const idWarga: Record<string, string> = {};

  for (const kk of KEPALA_KK) {
    const rumah = kk.rumah === "B4-12" ? rumahB412 : rumahA103;
    const kartu = await klien.kartuKeluarga.upsert({
      where: { rtId_noKk: { rtId: rt04.id, noKk: kk.noKk } },
      create: {
        rtId: rt04.id,
        noKk: kk.noKk,
        kepalaKeluarga: kk.kepala,
        alamat: kk.alamat,
        rumahId: rumah.id,
        jumlahAnggota: kk.anggota.length,
      },
      update: {},
    });

    for (const anggota of kk.anggota) {
      const nik = nikDari(anggota.tanggalLahir, anggota.seriNik);
      const { nikEncrypted, nikMasked } = sembunyikanNik(nik, config.nikKey);
      // `create` biasa: seed hanya berjalan pada database kosong (atau --force),
      // sehingga tidak ada risiko duplikat — dan no_hp NULL tidak bisa dipakai
      // sebagai kunci upsert.
      const warga = await klien.warga.create({
        data: {
          rtId: rt04.id,
          kkId: kartu.id,
          rumahId: rumah.id,
          nama: anggota.nama,
          hubungan: anggota.hubungan,
          nikEncrypted,
          nikMasked,
          noHp: anggota.noHp,
          tanggalLahir: tgl(anggota.tanggalLahir),
          jenisKelamin: anggota.jenisKelamin,
          pekerjaan: anggota.pekerjaan,
          agama: anggota.agama,
          tempatLahir: anggota.tempatLahir,
          pendidikan: anggota.pendidikan,
          golDarah: anggota.golDarah,
          statusKawin: anggota.statusKawin,
          tanggalPerkawinan: anggota.tanggalPerkawinan ? tgl(anggota.tanggalPerkawinan) : null,
          wargaNegara: anggota.wargaNegara,
          statusDemografis: "aktif",
          statusAkses: anggota.statusAkses,
          isActive: true,
        },
      });
      idWarga[anggota.nama] = warga.id;

      if (anggota.portalAktif) {
        await klien.kredensialWarga.upsert({
          where: { wargaId: warga.id },
          create: { wargaId: warga.id, passwordHash: sandiWargaHash },
          update: { passwordHash: sandiWargaHash },
        });
      }
    }
  }

  // Token undangan contoh (status 'menunggu') — memudahkan pengujian alur aktivasi.
  // Kode asli TIDAK PERNAH disimpan (hanya hash argon2id), jadi seed SELALU
  // menerbitkan token baru agar tautan yang dicetak di bawah benar-benar valid
  // (token lama dari seed sebelumnya ikut dicabut — satu undangan per warga).
  const wargaDiundang = idWarga["Maya Sari"]!;
  const kodeUndangan = buatKodeUndangan();
  const token = tokenBaru(new Date());
  await klien.tokenUndangan.updateMany({
    where: { rtId: rt04.id, wargaId: wargaDiundang, status: "menunggu" },
    data: { status: "dicabut", dicabutOleh: pengurusRt04.id, dicabutPada: new Date() },
  });
  const undanganBaru = await klien.tokenUndangan.create({
    data: {
      rtId: rt04.id,
      wargaId: wargaDiundang,
      kodeHash: await hashKodeUndangan(kodeUndangan),
      status: token.status,
      dibuatOleh: pengurusRt04.id,
      kedaluwarsaPada: token.kedaluwarsaPada,
      kirimKeNomor: "081234567893",
    },
  });
  await klien.warga.update({
    where: { id: wargaDiundang },
    data: { statusAkses: "menunggu_aktivasi" },
  });
  log(`tautan aktivasi contoh (Maya Sari, 081234567893):`);
  log(`  http://localhost:5173/undangan/${undanganBaru.id}.${kodeUndangan}`);

  // Kategori iuran — NAMA, NOMINAL, TIPED, DAN SIFAT IDENTIK dengan
  // `kategoriIuranDefault` di `apps/web/src/lib/shared.ts` (Keputusan B).
  // Nilai enum mengikuti skema DB (PRD §6.4.1): flat | per_unit | insidental
  // dan wajib | opsional. Data awal ini yang lalu diedit lewat form
  // "Atur Kategori Iuran" di Portal RT.
  const kategori: {
    id: string;
    nama: string;
    nominal: number;
    tipe: "flat" | "per_unit" | "insidental";
    sifat: "wajib" | "opsional";
  }[] = [];
  const KATEGORI_SEED = [
    { nama: "Keamanan & Pos Ronda", nominal: 50000, tipe: "flat", sifat: "wajib" },
    { nama: "Kebersihan & Lingkungan", nominal: 45000, tipe: "flat", sifat: "wajib" },
    { nama: "Dana Sosial & Kematian", nominal: 25000, tipe: "flat", sifat: "wajib" },
    { nama: "Kendaraan R4 (per unit)", nominal: 25000, tipe: "per_unit", sifat: "opsional" },
  ] as const;
  for (const [urutan, k] of KATEGORI_SEED.entries()) {
    const baris = await klien.kategoriIuran.upsert({
      where: { rtId_nama: { rtId: rt04.id, nama: k.nama } },
      create: {
        rtId: rt04.id,
        nama: k.nama,
        tipeTarif: k.tipe,
        nominalDefault: k.nominal,
        sifat: k.sifat,
        urutan: urutan + 1,
        statusAktif: true,
      },
      update: {},
    });
    kategori.push({
      id: baris.id,
      nama: k.nama,
      nominal: k.nominal,
      tipe: k.tipe,
      sifat: k.sifat,
    });
  }

  // Tagihan: dua bulan terdahulu (untuk tunggakan) + periode aktif
  const tagihanDisimpan: Array<{
    id: string;
    kategoriId: string;
    periode: string;
    tenggat: string;
    sisa: number;
    nominalAwal: number;
    wargaId: string;
  }> = [];

  const semuaWarga = await klien.warga.findMany({
    where: { rtId: rt04.id, statusDemografis: "aktif" },
    orderBy: { nama: "asc" },
  });

  const periodeTagihan = ["2026-08", "2026-09", PERIODE_AKTIF];

  // Unit R4 per rumah → nominal kategori `per_unit` ikut jumlah kendaraan.
  const daftarRumah = await klien.rumah.findMany({ where: { rtId: rt04.id } });
  const unitPerRumah = new Map(daftarRumah.map((r) => [r.id, r.unitKendaraanR4]));

  for (const warga of semuaWarga) {
    const unit = warga.rumahId ? (unitPerRumah.get(warga.rumahId) ?? 0) : 0;
    // Kategori yang ditagihkan otomatis: wajib (flat) + per_unit (ikut unit
    // rumah); insidental tidak pernah — aturan sama dengan `kategoriTagihan()`
    // di FE, sehingga angka seed dan form Portal RT tidak pernah berbeda.
    const kategoriWarga = kategori
      .filter((k) => k.tipe !== "insidental" && (k.sifat === "wajib" || k.tipe === "per_unit"))
      .map((k) => ({ ...k, nominal: k.tipe === "per_unit" ? k.nominal * unit : k.nominal }))
      .filter((k) => k.nominal > 0);

    for (const periode of periodeTagihan) {
      for (const k of kategoriWarga) {
        // tunggakan hanya untuk kepala keluarga agar data contoh tidak meledak
        if (periode !== PERIODE_AKTIF && warga.hubungan !== "kepala") continue;
        // tagihan kendaraan melekat pada rumah → cukup satu, diarahkan ke kepala
        if (k.tipe === "per_unit" && warga.hubungan !== "kepala") continue;
        const tenggat = `${periode}-10`;
        const dibuat = await klien.tagihan.upsert({
          where: {
            wargaId_kategoriId_periode: {
              wargaId: warga.id,
              kategoriId: k.id,
              periode,
            },
          },
          create: {
            rtId: rt04.id,
            wargaId: warga.id,
            kategoriId: k.id,
            periode,
            nominal: k.nominal,
            nominalAwal: k.nominal,
            sisa: k.nominal,
            tenggat: tgl(tenggat),
            status: "belum_bayar",
            sumber: "bulk",
          },
          update: {},
        });
        tagihanDisimpan.push({
          id: dibuat.id,
          kategoriId: k.id,
          periode,
          tenggat,
          sisa: Number(dibuat.sisa),
          nominalAwal: Number(dibuat.nominalAwal),
          wargaId: warga.id,
        });
      }
    }
  }

  // Pembayaran contoh → alokasi FIFO → kas (alur §6.4.5 dijalankan sungguhan)
  const wargaBayar = idWarga["Bambang Supriyanto"]!;
  const tagihanBambang = tagihanDisimpan.filter((t) => t.wargaId === wargaBayar);
  const pembayaran = await klien.pembayaran.create({
    data: {
      rtId: rt04.id,
      wargaId: wargaBayar,
      tanggal: tgl("2026-10-05"),
      nominal: 80000,
      metode: "tunai",
      catatan: "Pembayaran contoh — dibuka lewat Portal Warga",
      sumber: "bendahara",
      status: "lunas",
      diajukanOleh: "bendahara",
      verifiedBy: pengurusRt04.id,
      verifiedAt: new Date(),
    },
  });

  // Pembayaran MENUNGGU verifikasi — bukti diunggah warga lewat Portal Warga.
  // Menjadi antrean verifikasi Pengurus RT dan sumber status "Menunggu
  // Verifikasi" di Portal Warga; sisa tagihan sengaja belum berkurang karena
  // alokasi FIFO hanya berjalan setelah RT menyetujui (§6.4.4/§6.4.5).
  // Nominal = total sisa seluruh periode Bambang: Agustus 90.000 + September
  // 170.000 + Oktober 170.000 = 430.000 (pelunasan penuh setelah disetujui).
  await klien.pembayaran.create({
    data: {
      rtId: rt04.id,
      wargaId: wargaBayar,
      tanggal: tgl("2026-10-16"),
      nominal: 430000,
      metode: "transfer",
      catatan: "Pelunasan tunggakan Agustus–Oktober 2026 (menunggu verifikasi RT)",
      sumber: "upload_warga",
      status: "menunggu_verifikasi",
      diajukanOleh: "warga",
    },
  });

  const rencana = alokasikan(
    { id: pembayaran.id, nominal: Number(pembayaran.nominal) },
    tagihanBambang.map(
      (t): TagihanAlokasi => ({
        id: t.id,
        kategoriId: t.kategoriId,
        periode: t.periode,
        tenggat: t.tenggat,
        sisa: t.sisa,
        nominalAwal: t.nominalAwal,
      }),
    ),
    "gabungan",
  );

  for (const baris of rencana.alokasi) {
    await klien.alokasiPembayaran.create({
      data: {
        pembayaranId: pembayaran.id,
        tagihanId: baris.tagihanId,
        rtId: rt04.id,
        nominalDialokasikan: baris.nominal,
        urutan: baris.urutan,
        mode: "gabungan",
        hashIdempotensi: baris.hashIdempotensi,
      },
    });
    const sisaBaru = Math.round((tagihanBambang.find((t) => t.id === baris.tagihanId)!.sisa - baris.nominal) * 100) / 100;
    await klien.tagihan.update({
      where: { id: baris.tagihanId },
      data: {
        sisa: sisaBaru,
        status: sisaBaru === 0 ? "lunas" : "sebagian",
      },
    });
  }

  // Buku kas: saldo awal + entri alokasi iuran + operasional.
  // Rantai dimulai dari NOL: saldo awal periode direpresentasikan sebagai
  // BARIS PERTAMA array ("Saldo awal kas RT dari periode sebelumnya" +1.250.000)
  // — inisialisasi di sini harus 0 supaya tidak menghitung saldo awal ganda.
  let saldo = 0;
  const kasEntries: Array<{
    tanggal: Date;
    tipe: "masuk" | "keluar";
    kategori: "iuran" | "operasional" | "kegiatan";
    keterangan: string;
    nominal: number;
    arah: "positif" | "negatif";
    sumber: "manual" | "iuran_alokasi";
    refType: string | null;
    refId: string | null;
  }> = [
    {
      tanggal: tgl("2026-10-01"),
      tipe: "masuk",
      kategori: "iuran",
      keterangan: "Saldo awal kas RT dari periode sebelumnya",
      nominal: 1250000,
      arah: "positif",
      sumber: "manual",
      refType: null,
      refId: null,
    },
  ];

  if (rencana.totalDialokasikan > 0) {
    kasEntries.push({
      tanggal: tgl("2026-10-05"),
      tipe: "masuk",
      kategori: "iuran",
      keterangan: "Alokasi pembayaran iuran Bambang Supriyanto",
      nominal: rencana.totalDialokasikan,
      arah: "positif",
      sumber: "iuran_alokasi",
      refType: "pembayaran",
      refId: pembayaran.id,
    });
  }
  kasEntries.push(
    {
      tanggal: tgl("2026-10-07"),
      tipe: "keluar",
      kategori: "operasional",
      keterangan: "Pembelian alat kebersihan lingkungan",
      nominal: 85000,
      arah: "negatif",
      sumber: "manual",
      refType: null,
      refId: null,
    },
    {
      tanggal: tgl("2026-10-12"),
      tipe: "keluar",
      kategori: "kegiatan",
      keterangan: "Konsumsi kerja bakti RW 012",
      nominal: 150000,
      arah: "negatif",
      sumber: "manual",
      refType: null,
      refId: null,
    },
  );

  for (const e of kasEntries) {
    saldo = Math.round((saldo + (e.arah === "positif" ? e.nominal : -e.nominal)) * 100) / 100;
    await klien.kasEntry.create({
      data: {
        scopeLevel: "rt",
        scopeId: rt04.id,
        tanggal: e.tanggal,
        tipe: e.tipe,
        kategori: e.kategori,
        keterangan: e.keterangan,
        nominal: e.nominal,
        arah: e.arah,
        saldoSesudah: saldo,
        sumber: e.sumber,
        refType: e.refType,
        refId: e.refId,
        createdBy: pengurusRt04.id,
      },
    });
  }

  // Jenis surat
  for (const s of JENIS_SURAT_SEED) {
    await klien.jenisSurat.upsert({
      where: { rtId_nama: { rtId: rt04.id, nama: s.nama } },
      create: {
        rtId: rt04.id,
        nama: s.nama,
        kode: s.kode,
        perluRw: s.perluRw,
        fieldWajib: s.fieldWajib,
        aktif: true,
      },
      update: {},
    });
  }

  await catatAudit(
    {
      scopeLevel: "rt",
      scopeId: rt04.id,
      actorId: "00000000-0000-4000-8000-000000000000",
      actorRole: "sistem",
      portal: "rt",
      modul: "seed",
      aksi: "Seed data",
      aksiBadge: "Sistem",
      entitas: "rt",
      entitasId: rt04.id,
      ringkasan: `Data contoh RT 004 diisi: ${semuaWarga.length} warga, ${tagihanDisimpan.length} tagihan, ${kasEntries.length} entri kas.`,
      ip: null,
      userAgent: "prisma/seed.ts",
    },
    klien,
  );

  // === SCOPE RT 005: pembuktian isolasi tenant ===============================
  await setScopeSesi(klien, "rt", rt05.id);
  await klien.pengaturanRt.upsert({
    where: { rtId: rt05.id },
    create: { rtId: rt05.id, modeAlokasi: "terpisah", tenggatHari: 15 },
    update: {},
  });
  const rumahRt05 = await klien.rumah.upsert({
    where: { rtId_kodeRumah: { rtId: rt05.id, kodeRumah: "K1-01" } },
    create: {
      rtId: rt05.id,
      kodeRumah: "K1-01",
      alamat: "Jl. Kenanga Blok K No. 1",
      alamatPendek: "Blok K1 No. 1",
      statusHuni: "milik",
    },
    update: {},
  });
  const kkRt05 = await klien.kartuKeluarga.upsert({
    where: { rtId_noKk: { rtId: rt05.id, noKk: "3171050101050099" } },
    create: {
      rtId: rt05.id,
      noKk: "3171050101050099",
      kepalaKeluarga: "Rudi Setiawan",
      alamat: "Jl. Kenanga Blok K No. 1",
      rumahId: rumahRt05.id,
      jumlahAnggota: 1,
    },
    update: {},
  });
  const nikRt05 = sembunyikanNik(nikDari("1988-01-05", "0099"), config.nikKey);
  await klien.warga.upsert({
    where: { rtId_noHp: { rtId: rt05.id, noHp: "081234567999" } },
    create: {
      rtId: rt05.id,
      kkId: kkRt05.id,
      rumahId: rumahRt05.id,
      nama: "Rudi Setiawan",
      hubungan: "kepala",
      nikEncrypted: nikRt05.nikEncrypted,
      nikMasked: nikRt05.nikMasked,
      noHp: "081234567999",
      tanggalLahir: tgl("1988-01-05"),
      jenisKelamin: "laki_laki",
      pekerjaan: "Petugas Keamanan",
      agama: "Islam",
      statusDemografis: "aktif",
      statusAkses: "belum_diundang",
    },
    update: {},
  });

  // === Selesai ================================================================
  await setScopeSesi(klien, "platform", null);

  const wargaRt04 = await klien.warga.count({ where: { rtId: rt04.id } });
  const kasAkhir = await klien.kasEntry.findFirst({
    where: { scopeLevel: "rt", scopeId: rt04.id },
    orderBy: { createdAt: "desc" },
  });

  log(`selesai dalam ${((Date.now() - mulai) / 1000).toFixed(1)}s`);
  log(`RT 004 : ${wargaRt04} warga, ${tagihanDisimpan.length} tagihan`);
  log(`kas    : saldo akhir Rp ${Number(kasAkhir?.saldoSesudah ?? 0).toLocaleString("id-ID")}`);
  log("akun contoh (dari .env.example / README):");
  log(`  RT   : rt04@siwarga.id / ${SANDI_RT}   (atau no. HP 081234567890)`);
  log(`  RW   : rw012@siwarga.id / ${SANDI_RT}`);
  log(`  Admin: admin@siwarga.id / adminrahasia`);
  log(`  Warga: 081234567890 / ${SANDI_WARGA} (Bambang Supriyanto)`);
}

main()
  .catch((err) => {
    console.error("[seed] GAGAL:", err);
    process.exitCode = 1;
  })
  .finally(() => void tutupDb());
