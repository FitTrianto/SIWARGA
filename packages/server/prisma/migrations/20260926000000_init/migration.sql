-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "RtStatus" AS ENUM ('aktif', 'uji_coba', 'nonaktif', 'menunggu_pembayaran');

-- CreateEnum
CREATE TYPE "JabatanPengurus" AS ENUM ('ketua', 'sekretaris', 'bendahara', 'pengurus');

-- CreateEnum
CREATE TYPE "StatusPengurus" AS ENUM ('active', 'revoked');

-- CreateEnum
CREATE TYPE "ModeAlokasi" AS ENUM ('gabungan', 'terpisah');

-- CreateEnum
CREATE TYPE "StatusHuni" AS ENUM ('milik', 'sewa', 'kontrak', 'kos');

-- CreateEnum
CREATE TYPE "HubunganKk" AS ENUM ('kepala', 'istri', 'anak', 'lainnya');

-- CreateEnum
CREATE TYPE "JenisKelamin" AS ENUM ('laki_laki', 'perempuan');

-- CreateEnum
CREATE TYPE "StatusDemografis" AS ENUM ('aktif', 'pindah', 'meninggal', 'nonaktif');

-- CreateEnum
CREATE TYPE "StatusAkses" AS ENUM ('belum_diundang', 'menunggu_aktivasi', 'kedaluwarsa', 'aktif', 'dinonaktifkan');

-- CreateEnum
CREATE TYPE "JenisPerubahan" AS ENUM ('perubahan_kk', 'tambah_anggota', 'kontak', 'sensitif');

-- CreateEnum
CREATE TYPE "StatusVerifikasi" AS ENUM ('menunggu', 'disetujui', 'ditolak');

-- CreateEnum
CREATE TYPE "StatusUndangan" AS ENUM ('menunggu', 'aktif_dipakai', 'kedaluwarsa', 'dicabut');

-- CreateEnum
CREATE TYPE "PeranSesi" AS ENUM ('warga', 'rt_admin', 'rw_admin', 'super_admin');

-- CreateEnum
CREATE TYPE "StatusOtp" AS ENUM ('menunggu', 'terpakai', 'gagal', 'diblokir');

-- CreateEnum
CREATE TYPE "ChannelOtp" AS ENUM ('whatsapp', 'paid_gateway');

-- CreateEnum
CREATE TYPE "PeranPengguna" AS ENUM ('rt_admin', 'rw_admin', 'super_admin');

-- CreateEnum
CREATE TYPE "StatusAkunPengguna" AS ENUM ('active', 'disabled');

-- CreateEnum
CREATE TYPE "TipeTarif" AS ENUM ('flat', 'per_unit', 'insidental');

-- CreateEnum
CREATE TYPE "SifatIuran" AS ENUM ('wajib', 'opsional');

-- CreateEnum
CREATE TYPE "StatusTagihan" AS ENUM ('belum_bayar', 'sebagian', 'lunas');

-- CreateEnum
CREATE TYPE "SumberPembayaran" AS ENUM ('bendahara', 'upload_warga');

-- CreateEnum
CREATE TYPE "StatusPembayaran" AS ENUM ('menunggu_verifikasi', 'lunas', 'ditolak');

-- CreateEnum
CREATE TYPE "MetodePembayaran" AS ENUM ('tunai', 'transfer', 'qris', 'lainnya');

-- CreateEnum
CREATE TYPE "DiajukanOleh" AS ENUM ('warga', 'bendahara');

-- CreateEnum
CREATE TYPE "TipeMutasi" AS ENUM ('masuk', 'pakai');

-- CreateEnum
CREATE TYPE "RefMutasi" AS ENUM ('pembayaran', 'tagihan');

-- CreateEnum
CREATE TYPE "StatusApproval" AS ENUM ('menunggu', 'disetujui', 'ditolak');

-- CreateEnum
CREATE TYPE "StatusKeringanan" AS ENUM ('aktif', 'selesai', 'dicabut');

-- CreateEnum
CREATE TYPE "ScopeLevel" AS ENUM ('rt', 'rw', 'platform');

-- CreateEnum
CREATE TYPE "TipeKas" AS ENUM ('masuk', 'keluar', 'pembalik');

-- CreateEnum
CREATE TYPE "KategoriTransaksi" AS ENUM ('iuran', 'pemasukan_lain', 'operasional', 'kegiatan', 'dana_sosial', 'lainnya');

-- CreateEnum
CREATE TYPE "ArahKas" AS ENUM ('positif', 'negatif');

-- CreateEnum
CREATE TYPE "SumberKas" AS ENUM ('manual', 'iuran_alokasi', 'pembalik');

-- CreateEnum
CREATE TYPE "StatusSurat" AS ENUM ('draft', 'menunggu_rt', 'menunggu_rw', 'disetujui', 'ditolak', 'perlu_perbaikan');

-- CreateEnum
CREATE TYPE "ModeAksesRw" AS ENUM ('approval', 'direct');

-- CreateEnum
CREATE TYPE "StatusAksesRw" AS ENUM ('menunggu', 'disetujui', 'ditolak', 'diakses_direct');

-- CreateEnum
CREATE TYPE "PaketLangganan" AS ENUM ('free', 'pro', 'max');

-- CreateEnum
CREATE TYPE "StatusLangganan" AS ENUM ('uji_coba', 'aktif', 'grace_period', 'nonaktif');

-- CreateEnum
CREATE TYPE "MetodeLangganan" AS ENUM ('belum', 'tunai', 'transfer', 'qris');

-- CreateEnum
CREATE TYPE "StatusTransaksiLangganan" AS ENUM ('menunggu', 'lunas', 'gagal');

-- CreateEnum
CREATE TYPE "ActorRole" AS ENUM ('warga', 'rt_admin', 'rw_admin', 'super_admin', 'sistem');

-- CreateEnum
CREATE TYPE "PortalAkun" AS ENUM ('warga', 'rt', 'rw', 'admin', 'publik');

-- CreateEnum
CREATE TYPE "TipeNotifikasi" AS ENUM ('undangan', 'aktivasi', 'otp', 'jatuh_tempo', 'surat', 'langganan', 'reminder');

-- CreateEnum
CREATE TYPE "ChannelNotifikasi" AS ENUM ('whatsapp', 'push', 'email', 'log');

-- CreateEnum
CREATE TYPE "StatusNotifikasi" AS ENUM ('queued', 'sending', 'sent', 'failed', 'dead');

-- CreateEnum
CREATE TYPE "StatusImpor" AS ENUM ('proses', 'selesai', 'gagal');

-- CreateTable
CREATE TABLE "kecamatan" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kode" VARCHAR(10) NOT NULL,
    "nama" VARCHAR(120) NOT NULL,

    CONSTRAINT "kecamatan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kelurahan" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kecamatan_id" UUID NOT NULL,
    "kode_kemendagri" VARCHAR(10) NOT NULL,
    "nama" VARCHAR(120) NOT NULL,

    CONSTRAINT "kelurahan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rw" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kelurahan_id" UUID NOT NULL,
    "kode_rw" VARCHAR(3) NOT NULL,
    "nama_ketua" VARCHAR(120),
    "no_hp_ketua" VARCHAR(20),
    "alamat" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "rw_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rt" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "rw_id" UUID NOT NULL,
    "kode_rt" VARCHAR(3) NOT NULL,
    "kode_wilayah" VARCHAR(10) NOT NULL,
    "perumahan" VARCHAR(120),
    "alamat" TEXT,
    "kelurahan_id" UUID NOT NULL,
    "ketua_rt_id" UUID,
    "status" "RtStatus" NOT NULL DEFAULT 'menunggu_pembayaran',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "rt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pengurus_rt" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "rt_id" UUID NOT NULL,
    "nama" VARCHAR(120) NOT NULL,
    "jabatan" "JabatanPengurus" NOT NULL DEFAULT 'pengurus',
    "email" VARCHAR(160) NOT NULL,
    "no_hp" VARCHAR(20),
    "avatar_url" VARCHAR(512),
    "ttd_digital_url" VARCHAR(512),
    "sk_pengurus_url" VARCHAR(512),
    "status" "StatusPengurus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pengurus_rt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pengurus_rw" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "rw_id" UUID NOT NULL,
    "nama" VARCHAR(120) NOT NULL,
    "jabatan" "JabatanPengurus" NOT NULL DEFAULT 'pengurus',
    "email" VARCHAR(160) NOT NULL,
    "no_hp" VARCHAR(20),
    "status" "StatusPengurus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pengurus_rw_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pengaturan_rt" (
    "rt_id" UUID NOT NULL,
    "banner_url" VARCHAR(512),
    "stempel_url" VARCHAR(512),
    "kop_surat_url" VARCHAR(512),
    "mode_alokasi" "ModeAlokasi" NOT NULL DEFAULT 'gabungan',
    "tenggat_hari" INTEGER NOT NULL DEFAULT 10,
    "denda_aktif" BOOLEAN NOT NULL DEFAULT false,
    "notifikasi_wa_enabled" BOOLEAN NOT NULL DEFAULT true,
    "mode_pemeliharaan" BOOLEAN NOT NULL DEFAULT false,
    "ambang_approval_kas" DECIMAL(14,2) NOT NULL DEFAULT 500000,
    "template_surat" JSONB,

    CONSTRAINT "pengaturan_rt_pkey" PRIMARY KEY ("rt_id")
);

-- CreateTable
CREATE TABLE "pengaturan_rw" (
    "rw_id" UUID NOT NULL,
    "notifikasi_wa_enabled" BOOLEAN NOT NULL DEFAULT true,
    "pengaturan_lain" JSONB,

    CONSTRAINT "pengaturan_rw_pkey" PRIMARY KEY ("rw_id")
);

-- CreateTable
CREATE TABLE "rumah" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "rt_id" UUID NOT NULL,
    "kode_rumah" VARCHAR(20) NOT NULL,
    "alamat" VARCHAR(160) NOT NULL,
    "alamat_pendek" VARCHAR(40) NOT NULL,
    "kk_id" UUID,
    "unit_kendaraan_r4" INTEGER NOT NULL DEFAULT 1,
    "status_huni" "StatusHuni" NOT NULL DEFAULT 'milik',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "rumah_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kartu_keluarga" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "rt_id" UUID NOT NULL,
    "no_kk" VARCHAR(20) NOT NULL,
    "kepala_keluarga" VARCHAR(120) NOT NULL,
    "alamat" VARCHAR(160) NOT NULL,
    "jumlah_anggota" INTEGER NOT NULL DEFAULT 0,
    "rumah_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "kartu_keluarga_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warga" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "rt_id" UUID NOT NULL,
    "kk_id" UUID NOT NULL,
    "rumah_id" UUID,
    "nama" VARCHAR(120) NOT NULL,
    "hubungan" "HubunganKk" NOT NULL DEFAULT 'lainnya',
    "nik_encrypted" BYTEA,
    "nik_masked" VARCHAR(20),
    "no_hp" VARCHAR(20),
    "email" VARCHAR(160),
    "tanggal_lahir" DATE,
    "jenisKelamin" "JenisKelamin",
    "pekerjaan" VARCHAR(80),
    "foto_url" VARCHAR(512),
    "agama" VARCHAR(40),
    "tempat_lahir" VARCHAR(80),
    "pendidikan" VARCHAR(60),
    "gol_darah" VARCHAR(5),
    "status_kawin" VARCHAR(40),
    "tanggal_perkawinan" DATE,
    "warga_negara" VARCHAR(20),
    "status_demografis" "StatusDemografis" NOT NULL DEFAULT 'aktif',
    "status_akses" "StatusAkses" NOT NULL DEFAULT 'belum_diundang',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "warga_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "perubahan_data_warga" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "rt_id" UUID NOT NULL,
    "warga_id" UUID NOT NULL,
    "pengaju" VARCHAR(8) NOT NULL,
    "jenis" "JenisPerubahan" NOT NULL,
    "payload_sebelum" JSONB,
    "payload_sesudah" JSONB,
    "status" "StatusVerifikasi" NOT NULL DEFAULT 'menunggu',
    "verifier_pengurus_rt_id" UUID,
    "catatan_verifikasi" TEXT,
    "diajukan_pada" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "diproses_pada" TIMESTAMPTZ(3),

    CONSTRAINT "perubahan_data_warga_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "token_undangan" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "rt_id" UUID NOT NULL,
    "warga_id" UUID NOT NULL,
    "kode_hash" VARCHAR(255) NOT NULL,
    "status" "StatusUndangan" NOT NULL DEFAULT 'menunggu',
    "dibuat_oleh" UUID NOT NULL,
    "dibuat_pada" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kedaluwarsa_pada" TIMESTAMPTZ(3) NOT NULL,
    "dipakai_pada" TIMESTAMPTZ(3),
    "dicabut_oleh" UUID,
    "dicabut_pada" TIMESTAMPTZ(3),
    "percobaan_aktivasi" JSONB NOT NULL DEFAULT '[]',
    "kirim_ke_nomor" VARCHAR(20),

    CONSTRAINT "token_undangan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kredensial_warga" (
    "warga_id" UUID NOT NULL,
    "pin_hash" VARCHAR(255) NOT NULL,
    "dibuat_pada" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "terakhir_diubah_pada" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "gagal_berturut" INTEGER NOT NULL DEFAULT 0,
    "dikunci_sampai" TIMESTAMPTZ(3),

    CONSTRAINT "kredensial_warga_pkey" PRIMARY KEY ("warga_id")
);

-- CreateTable
CREATE TABLE "sesi_login" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "subjek_id" UUID NOT NULL,
    "peran" "PeranSesi" NOT NULL,
    "token_hash" VARCHAR(255) NOT NULL,
    "refresh_hash" VARCHAR(255) NOT NULL,
    "dibuat_pada" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kedaluwarsa_pada" TIMESTAMPTZ(3) NOT NULL,
    "terakhir_aktif" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "info_perangkat" VARCHAR(255),
    "ip" INET,
    "kota" VARCHAR(80),
    "dicabut_pada" TIMESTAMPTZ(3),

    CONSTRAINT "sesi_login_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "percobaan_otp" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "warga_id" UUID NOT NULL,
    "tujuan" VARCHAR(20) NOT NULL,
    "kode_hash" VARCHAR(255) NOT NULL,
    "dikirim_pada" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kedaluwarsa_pada" TIMESTAMPTZ(3) NOT NULL,
    "jumlah_percobaan" INTEGER NOT NULL DEFAULT 0,
    "max" INTEGER NOT NULL DEFAULT 3,
    "status" "StatusOtp" NOT NULL DEFAULT 'menunggu',
    "channel" "ChannelOtp" NOT NULL DEFAULT 'whatsapp',

    CONSTRAINT "percobaan_otp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pengguna_pengurus" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "peran" "PeranPengguna" NOT NULL,
    "rt_id" UUID,
    "rw_id" UUID,
    "email" VARCHAR(160) NOT NULL,
    "no_hp" VARCHAR(20),
    "password_hash" VARCHAR(255) NOT NULL,
    "status" "StatusAkunPengguna" NOT NULL DEFAULT 'active',
    "last_login_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pengguna_pengurus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kategori_iuran" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "rt_id" UUID NOT NULL,
    "nama" VARCHAR(80) NOT NULL,
    "tipe_tarif" "TipeTarif" NOT NULL DEFAULT 'flat',
    "nominal_default" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "wajib_opsional" "SifatIuran" NOT NULL DEFAULT 'wajib',
    "status_aktif" BOOLEAN NOT NULL DEFAULT true,
    "urutan" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "dinonaktifkan_pada" TIMESTAMPTZ(3),

    CONSTRAINT "kategori_iuran_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profil_iuran_warga" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "warga_id" UUID NOT NULL,
    "kategori_id" UUID NOT NULL,
    "rt_id" UUID NOT NULL,
    "nominal_berlaku" DECIMAL(14,2),
    "jumlah_unit" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "profil_iuran_warga_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tagihan" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "rt_id" UUID NOT NULL,
    "warga_id" UUID NOT NULL,
    "kategori_id" UUID NOT NULL,
    "periode" VARCHAR(7) NOT NULL,
    "nominal" DECIMAL(14,2) NOT NULL,
    "nominal_awal" DECIMAL(14,2) NOT NULL,
    "sisa" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "tenggat" DATE,
    "status" "StatusTagihan" NOT NULL DEFAULT 'belum_bayar',
    "dibuat_pada" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sumber" VARCHAR(16) NOT NULL DEFAULT 'bulk',

    CONSTRAINT "tagihan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pembayaran" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "rt_id" UUID NOT NULL,
    "warga_id" UUID NOT NULL,
    "tanggal" DATE NOT NULL,
    "nominal" DECIMAL(14,2) NOT NULL,
    "metode" "MetodePembayaran" NOT NULL,
    "catatan" TEXT,
    "sumber" "SumberPembayaran" NOT NULL DEFAULT 'bendahara',
    "status" "StatusPembayaran" NOT NULL DEFAULT 'menunggu_verifikasi',
    "bukti_url" VARCHAR(512),
    "verified_by" UUID,
    "verified_at" TIMESTAMPTZ(3),
    "diajukan_oleh" "DiajukanOleh" NOT NULL DEFAULT 'bendahara',
    "idempotency_key" VARCHAR(120),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pembayaran_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alokasi_pembayaran" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "pembayaran_id" UUID NOT NULL,
    "tagihan_id" UUID NOT NULL,
    "rt_id" UUID NOT NULL,
    "nominal_dialokasikan" DECIMAL(14,2) NOT NULL,
    "urutan" INTEGER NOT NULL,
    "mode" "ModeAlokasi" NOT NULL,
    "hash_idempotensi" VARCHAR(64) NOT NULL,
    "dibuat_pada" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alokasi_pembayaran_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mutasi_saldo_warga" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "warga_id" UUID NOT NULL,
    "rt_id" UUID NOT NULL,
    "tipe" "TipeMutasi" NOT NULL,
    "nominal" DECIMAL(14,2) NOT NULL,
    "ref_type" "RefMutasi" NOT NULL,
    "ref_id" UUID NOT NULL,
    "saldo_sesudah" DECIMAL(14,2) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mutasi_saldo_warga_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "keringanan" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "rt_id" UUID NOT NULL,
    "warga_id" UUID NOT NULL,
    "kategori_id" UUID NOT NULL,
    "nominal_keringanan" DECIMAL(14,2) NOT NULL,
    "alasan" TEXT,
    "periode_mulai" VARCHAR(7) NOT NULL,
    "periode_sampai" VARCHAR(7),
    "tanggal_tinjau" DATE,
    "status_approval" "StatusApproval" NOT NULL DEFAULT 'menunggu',
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(3),
    "status" "StatusKeringanan" NOT NULL DEFAULT 'aktif',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "keringanan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kas_entry" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "scope_level" "ScopeLevel" NOT NULL,
    "scope_id" UUID NOT NULL,
    "tanggal" DATE NOT NULL,
    "tipe" "TipeKas" NOT NULL DEFAULT 'masuk',
    "kategori" "KategoriTransaksi" NOT NULL,
    "keterangan" VARCHAR(200) NOT NULL,
    "nominal" DECIMAL(14,2) NOT NULL,
    "arah" "ArahKas" NOT NULL DEFAULT 'positif',
    "saldo_sesudah" DECIMAL(14,2) NOT NULL,
    "sumber" "SumberKas" NOT NULL DEFAULT 'manual',
    "ref_type" VARCHAR(24),
    "ref_id" UUID,
    "reversal_of_id" UUID,
    "bukti_url" VARCHAR(512),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kas_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_kas" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "scope_level" "ScopeLevel" NOT NULL,
    "scope_id" UUID NOT NULL,
    "kas_entry_id" UUID,
    "pengaju" UUID NOT NULL,
    "nominal_pengajuan" DECIMAL(14,2) NOT NULL,
    "keterangan" TEXT,
    "ambang_persetujuan" DECIMAL(14,2) NOT NULL,
    "status" "StatusApproval" NOT NULL DEFAULT 'menunggu',
    "approver" UUID,
    "disetujui_pada" TIMESTAMPTZ(3),
    "catatan_keputusan" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_kas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tutup_buku_kas" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "scope_level" "ScopeLevel" NOT NULL,
    "scope_id" UUID NOT NULL,
    "periode" VARCHAR(7) NOT NULL,
    "saldo_awal" DECIMAL(14,2) NOT NULL,
    "total_masuk" DECIMAL(14,2) NOT NULL,
    "total_keluar" DECIMAL(14,2) NOT NULL,
    "saldo_akhir" DECIMAL(14,2) NOT NULL,
    "jumlah_entri" INTEGER NOT NULL,
    "ditutup_oleh" UUID NOT NULL,
    "ditutup_pada" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tutup_buku_kas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jenis_surat" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "rt_id" UUID NOT NULL,
    "nama" VARCHAR(80) NOT NULL,
    "kode" VARCHAR(8) NOT NULL,
    "template_html" TEXT,
    "perlu_rw" BOOLEAN NOT NULL DEFAULT false,
    "field_wajib" JSONB NOT NULL DEFAULT '[]',
    "aktif" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "jenis_surat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "surat" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "rt_id" UUID NOT NULL,
    "jenis_surat_id" UUID NOT NULL,
    "warga_id" UUID NOT NULL,
    "no_kk" VARCHAR(20) NOT NULL,
    "no_surat" VARCHAR(40) NOT NULL,
    "keperluan" VARCHAR(200) NOT NULL,
    "data_pengajuan" JSONB NOT NULL,
    "status" "StatusSurat" NOT NULL DEFAULT 'draft',
    "perlu_rw" BOOLEAN NOT NULL DEFAULT false,
    "catatan_verifikasi" TEXT,
    "qr_token" VARCHAR(64) NOT NULL,
    "diajukan_pada" TIMESTAMPTZ(3),
    "verifikasi_rt_pada" TIMESTAMPTZ(3),
    "verifikasi_rw_pada" TIMESTAMPTZ(3),
    "terbit_pada" TIMESTAMPTZ(3),
    "disetujui_oleh" UUID,
    "file_pdf_url" VARCHAR(512),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "surat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permintaan_akses_detail" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "rw_id" UUID NOT NULL,
    "rt_id" UUID NOT NULL,
    "pengaju" UUID NOT NULL,
    "lingkup" VARCHAR(120) NOT NULL,
    "alasan" TEXT,
    "mode" "ModeAksesRw" NOT NULL DEFAULT 'approval',
    "justifikasi" TEXT,
    "status" "StatusAksesRw" NOT NULL DEFAULT 'menunggu',
    "disetujui_oleh" UUID,
    "masa_berlaku" DATE,
    "diajukan_pada" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "diproses_pada" TIMESTAMPTZ(3),

    CONSTRAINT "permintaan_akses_detail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "langganan" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "rt_id" UUID NOT NULL,
    "paket" "PaketLangganan" NOT NULL DEFAULT 'free',
    "mulai" DATE NOT NULL,
    "aktif_sampai" DATE,
    "status" "StatusLangganan" NOT NULL DEFAULT 'uji_coba',
    "metode_bayar" "MetodeLangganan" NOT NULL DEFAULT 'belum',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "langganan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transaksi_langganan" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "langganan_id" UUID NOT NULL,
    "jumlah" DECIMAL(14,2) NOT NULL,
    "metode" "MetodeLangganan" NOT NULL,
    "status" "StatusTransaksiLangganan" NOT NULL DEFAULT 'menunggu',
    "ref_external" VARCHAR(120),
    "paid_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transaksi_langganan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "konten_landing" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "versi" INTEGER NOT NULL,
    "hero" JSONB NOT NULL,
    "fitur" JSONB NOT NULL,
    "harga" JSONB NOT NULL,
    "persona" JSONB NOT NULL,
    "diubah_oleh" UUID NOT NULL,
    "diubah_pada" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "konten_landing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "scope_level" "ScopeLevel" NOT NULL,
    "scope_id" UUID,
    "actor_id" UUID NOT NULL,
    "actor_role" "ActorRole" NOT NULL,
    "portal" "PortalAkun" NOT NULL,
    "modul" VARCHAR(40) NOT NULL,
    "aksi" VARCHAR(60) NOT NULL,
    "aksi_badge" VARCHAR(40),
    "entitas" VARCHAR(60),
    "entitas_id" UUID,
    "sebelum" JSONB,
    "sesudah" JSONB,
    "ringkasan" TEXT,
    "ip" INET,
    "user_agent" VARCHAR(255),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifikasi_job" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tipe" "TipeNotifikasi" NOT NULL,
    "channel" "ChannelNotifikasi" NOT NULL DEFAULT 'whatsapp',
    "tujuan" VARCHAR(20) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "StatusNotifikasi" NOT NULL DEFAULT 'queued',
    "percobaan" INTEGER NOT NULL DEFAULT 0,
    "jadwal_pada" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dikirim_pada" TIMESTAMPTZ(3),
    "galat" TEXT,

    CONSTRAINT "notifikasi_job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "impor_data" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "rt_id" UUID NOT NULL,
    "file_url" VARCHAR(512) NOT NULL,
    "nama_file" VARCHAR(255) NOT NULL,
    "jumlah_baris" INTEGER NOT NULL DEFAULT 0,
    "berhasil" INTEGER NOT NULL DEFAULT 0,
    "gagal" INTEGER NOT NULL DEFAULT 0,
    "laporan" JSONB,
    "status" "StatusImpor" NOT NULL DEFAULT 'proses',
    "diunggah_oleh" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "impor_data_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "kecamatan_kode_key" ON "kecamatan"("kode");

-- CreateIndex
CREATE UNIQUE INDEX "kelurahan_kecamatan_id_kode_kemendagri_key" ON "kelurahan"("kecamatan_id", "kode_kemendagri");

-- CreateIndex
CREATE UNIQUE INDEX "rw_kelurahan_id_kode_rw_key" ON "rw"("kelurahan_id", "kode_rw");

-- CreateIndex
CREATE UNIQUE INDEX "rt_ketua_rt_id_key" ON "rt"("ketua_rt_id");

-- CreateIndex
CREATE INDEX "rt_kode_wilayah_idx" ON "rt"("kode_wilayah");

-- CreateIndex
CREATE UNIQUE INDEX "rt_rw_id_kode_rt_key" ON "rt"("rw_id", "kode_rt");

-- CreateIndex
CREATE UNIQUE INDEX "pengurus_rt_rt_id_email_key" ON "pengurus_rt"("rt_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "pengurus_rw_rw_id_email_key" ON "pengurus_rw"("rw_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "rumah_rt_id_kode_rumah_key" ON "rumah"("rt_id", "kode_rumah");

-- CreateIndex
CREATE UNIQUE INDEX "rumah_rt_id_alamat_pendek_key" ON "rumah"("rt_id", "alamat_pendek");

-- CreateIndex
CREATE UNIQUE INDEX "kartu_keluarga_rt_id_no_kk_key" ON "kartu_keluarga"("rt_id", "no_kk");

-- CreateIndex
CREATE INDEX "warga_rt_id_nama_idx" ON "warga"("rt_id", "nama");

-- CreateIndex
CREATE INDEX "warga_rt_id_status_akses_idx" ON "warga"("rt_id", "status_akses");

-- CreateIndex
CREATE UNIQUE INDEX "warga_rt_id_no_hp_key" ON "warga"("rt_id", "no_hp");

-- CreateIndex
CREATE INDEX "perubahan_data_warga_rt_id_status_idx" ON "perubahan_data_warga"("rt_id", "status");

-- CreateIndex
CREATE INDEX "token_undangan_rt_id_status_kedaluwarsa_pada_idx" ON "token_undangan"("rt_id", "status", "kedaluwarsa_pada");

-- CreateIndex
CREATE INDEX "token_undangan_warga_id_status_idx" ON "token_undangan"("warga_id", "status");

-- CreateIndex
CREATE INDEX "sesi_login_subjek_id_peran_dicabut_pada_idx" ON "sesi_login"("subjek_id", "peran", "dicabut_pada");

-- CreateIndex
CREATE INDEX "sesi_login_kedaluwarsa_pada_idx" ON "sesi_login"("kedaluwarsa_pada");

-- CreateIndex
CREATE UNIQUE INDEX "sesi_login_token_hash_key" ON "sesi_login"("token_hash");

-- CreateIndex
CREATE INDEX "percobaan_otp_warga_id_status_idx" ON "percobaan_otp"("warga_id", "status");

-- CreateIndex
CREATE INDEX "pengguna_pengurus_peran_status_idx" ON "pengguna_pengurus"("peran", "status");

-- CreateIndex
CREATE UNIQUE INDEX "pengguna_pengurus_email_key" ON "pengguna_pengurus"("email");

-- CreateIndex
CREATE UNIQUE INDEX "kategori_iuran_rt_id_nama_key" ON "kategori_iuran"("rt_id", "nama");

-- CreateIndex
CREATE UNIQUE INDEX "profil_iuran_warga_warga_id_kategori_id_key" ON "profil_iuran_warga"("warga_id", "kategori_id");

-- CreateIndex
CREATE INDEX "tagihan_rt_id_periode_status_idx" ON "tagihan"("rt_id", "periode", "status");

-- CreateIndex
CREATE UNIQUE INDEX "tagihan_warga_id_kategori_id_periode_key" ON "tagihan"("warga_id", "kategori_id", "periode");

-- CreateIndex
CREATE INDEX "pembayaran_rt_id_tanggal_status_idx" ON "pembayaran"("rt_id", "tanggal", "status");

-- CreateIndex
CREATE INDEX "pembayaran_warga_id_tanggal_idx" ON "pembayaran"("warga_id", "tanggal");

-- CreateIndex
CREATE UNIQUE INDEX "alokasi_pembayaran_hash_idempotensi_key" ON "alokasi_pembayaran"("hash_idempotensi");

-- CreateIndex
CREATE INDEX "alokasi_pembayaran_pembayaran_id_urutan_idx" ON "alokasi_pembayaran"("pembayaran_id", "urutan");

-- CreateIndex
CREATE INDEX "mutasi_saldo_warga_warga_id_created_at_idx" ON "mutasi_saldo_warga"("warga_id", "created_at");

-- CreateIndex
CREATE INDEX "keringanan_rt_id_warga_id_status_idx" ON "keringanan"("rt_id", "warga_id", "status");

-- CreateIndex
CREATE INDEX "kas_entry_scope_level_scope_id_tanggal_idx" ON "kas_entry"("scope_level", "scope_id", "tanggal");

-- CreateIndex
CREATE INDEX "approval_kas_scope_level_scope_id_status_idx" ON "approval_kas"("scope_level", "scope_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "tutup_buku_kas_scope_level_scope_id_periode_key" ON "tutup_buku_kas"("scope_level", "scope_id", "periode");

-- CreateIndex
CREATE UNIQUE INDEX "jenis_surat_rt_id_nama_key" ON "jenis_surat"("rt_id", "nama");

-- CreateIndex
CREATE UNIQUE INDEX "surat_qr_token_key" ON "surat"("qr_token");

-- CreateIndex
CREATE INDEX "surat_rt_id_status_idx" ON "surat"("rt_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "surat_rt_id_no_surat_key" ON "surat"("rt_id", "no_surat");

-- CreateIndex
CREATE INDEX "permintaan_akses_detail_rw_id_status_idx" ON "permintaan_akses_detail"("rw_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "langganan_rt_id_key" ON "langganan"("rt_id");

-- CreateIndex
CREATE INDEX "langganan_paket_status_idx" ON "langganan"("paket", "status");

-- CreateIndex
CREATE UNIQUE INDEX "konten_landing_versi_key" ON "konten_landing"("versi");

-- CreateIndex
CREATE INDEX "audit_log_scope_level_scope_id_created_at_idx" ON "audit_log"("scope_level", "scope_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_log_actor_id_created_at_idx" ON "audit_log"("actor_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "notifikasi_job_status_jadwal_pada_idx" ON "notifikasi_job"("status", "jadwal_pada");

-- AddForeignKey
ALTER TABLE "kelurahan" ADD CONSTRAINT "kelurahan_kecamatan_id_fkey" FOREIGN KEY ("kecamatan_id") REFERENCES "kecamatan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rw" ADD CONSTRAINT "rw_kelurahan_id_fkey" FOREIGN KEY ("kelurahan_id") REFERENCES "kelurahan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rt" ADD CONSTRAINT "rt_rw_id_fkey" FOREIGN KEY ("rw_id") REFERENCES "rw"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rt" ADD CONSTRAINT "rt_kelurahan_id_fkey" FOREIGN KEY ("kelurahan_id") REFERENCES "kelurahan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rt" ADD CONSTRAINT "rt_ketua_rt_id_fkey" FOREIGN KEY ("ketua_rt_id") REFERENCES "pengurus_rt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pengurus_rt" ADD CONSTRAINT "pengurus_rt_rt_id_fkey" FOREIGN KEY ("rt_id") REFERENCES "rt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pengurus_rw" ADD CONSTRAINT "pengurus_rw_rw_id_fkey" FOREIGN KEY ("rw_id") REFERENCES "rw"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pengaturan_rt" ADD CONSTRAINT "pengaturan_rt_rt_id_fkey" FOREIGN KEY ("rt_id") REFERENCES "rt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pengaturan_rw" ADD CONSTRAINT "pengaturan_rw_rw_id_fkey" FOREIGN KEY ("rw_id") REFERENCES "rw"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rumah" ADD CONSTRAINT "rumah_rt_id_fkey" FOREIGN KEY ("rt_id") REFERENCES "rt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rumah" ADD CONSTRAINT "rumah_kk_id_fkey" FOREIGN KEY ("kk_id") REFERENCES "kartu_keluarga"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kartu_keluarga" ADD CONSTRAINT "kartu_keluarga_rt_id_fkey" FOREIGN KEY ("rt_id") REFERENCES "rt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kartu_keluarga" ADD CONSTRAINT "kartu_keluarga_rumah_id_fkey" FOREIGN KEY ("rumah_id") REFERENCES "rumah"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warga" ADD CONSTRAINT "warga_rt_id_fkey" FOREIGN KEY ("rt_id") REFERENCES "rt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warga" ADD CONSTRAINT "warga_kk_id_fkey" FOREIGN KEY ("kk_id") REFERENCES "kartu_keluarga"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warga" ADD CONSTRAINT "warga_rumah_id_fkey" FOREIGN KEY ("rumah_id") REFERENCES "rumah"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "perubahan_data_warga" ADD CONSTRAINT "perubahan_data_warga_rt_id_fkey" FOREIGN KEY ("rt_id") REFERENCES "rt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "perubahan_data_warga" ADD CONSTRAINT "perubahan_data_warga_warga_id_fkey" FOREIGN KEY ("warga_id") REFERENCES "warga"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "token_undangan" ADD CONSTRAINT "token_undangan_rt_id_fkey" FOREIGN KEY ("rt_id") REFERENCES "rt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "token_undangan" ADD CONSTRAINT "token_undangan_warga_id_fkey" FOREIGN KEY ("warga_id") REFERENCES "warga"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kredensial_warga" ADD CONSTRAINT "kredensial_warga_warga_id_fkey" FOREIGN KEY ("warga_id") REFERENCES "warga"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "percobaan_otp" ADD CONSTRAINT "percobaan_otp_warga_id_fkey" FOREIGN KEY ("warga_id") REFERENCES "warga"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pengguna_pengurus" ADD CONSTRAINT "pengguna_pengurus_rt_id_fkey" FOREIGN KEY ("rt_id") REFERENCES "rt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pengguna_pengurus" ADD CONSTRAINT "pengguna_pengurus_rw_id_fkey" FOREIGN KEY ("rw_id") REFERENCES "rw"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kategori_iuran" ADD CONSTRAINT "kategori_iuran_rt_id_fkey" FOREIGN KEY ("rt_id") REFERENCES "rt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profil_iuran_warga" ADD CONSTRAINT "profil_iuran_warga_warga_id_fkey" FOREIGN KEY ("warga_id") REFERENCES "warga"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profil_iuran_warga" ADD CONSTRAINT "profil_iuran_warga_kategori_id_fkey" FOREIGN KEY ("kategori_id") REFERENCES "kategori_iuran"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tagihan" ADD CONSTRAINT "tagihan_rt_id_fkey" FOREIGN KEY ("rt_id") REFERENCES "rt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tagihan" ADD CONSTRAINT "tagihan_warga_id_fkey" FOREIGN KEY ("warga_id") REFERENCES "warga"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tagihan" ADD CONSTRAINT "tagihan_kategori_id_fkey" FOREIGN KEY ("kategori_id") REFERENCES "kategori_iuran"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pembayaran" ADD CONSTRAINT "pembayaran_rt_id_fkey" FOREIGN KEY ("rt_id") REFERENCES "rt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pembayaran" ADD CONSTRAINT "pembayaran_warga_id_fkey" FOREIGN KEY ("warga_id") REFERENCES "warga"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alokasi_pembayaran" ADD CONSTRAINT "alokasi_pembayaran_pembayaran_id_fkey" FOREIGN KEY ("pembayaran_id") REFERENCES "pembayaran"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alokasi_pembayaran" ADD CONSTRAINT "alokasi_pembayaran_tagihan_id_fkey" FOREIGN KEY ("tagihan_id") REFERENCES "tagihan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alokasi_pembayaran" ADD CONSTRAINT "alokasi_pembayaran_rt_id_fkey" FOREIGN KEY ("rt_id") REFERENCES "rt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mutasi_saldo_warga" ADD CONSTRAINT "mutasi_saldo_warga_warga_id_fkey" FOREIGN KEY ("warga_id") REFERENCES "warga"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mutasi_saldo_warga" ADD CONSTRAINT "mutasi_saldo_warga_rt_id_fkey" FOREIGN KEY ("rt_id") REFERENCES "rt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "keringanan" ADD CONSTRAINT "keringanan_rt_id_fkey" FOREIGN KEY ("rt_id") REFERENCES "rt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "keringanan" ADD CONSTRAINT "keringanan_warga_id_fkey" FOREIGN KEY ("warga_id") REFERENCES "warga"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "keringanan" ADD CONSTRAINT "keringanan_kategori_id_fkey" FOREIGN KEY ("kategori_id") REFERENCES "kategori_iuran"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kas_entry" ADD CONSTRAINT "kas_entry_reversal_of_id_fkey" FOREIGN KEY ("reversal_of_id") REFERENCES "kas_entry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_kas" ADD CONSTRAINT "approval_kas_kas_entry_id_fkey" FOREIGN KEY ("kas_entry_id") REFERENCES "kas_entry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jenis_surat" ADD CONSTRAINT "jenis_surat_rt_id_fkey" FOREIGN KEY ("rt_id") REFERENCES "rt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surat" ADD CONSTRAINT "surat_rt_id_fkey" FOREIGN KEY ("rt_id") REFERENCES "rt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surat" ADD CONSTRAINT "surat_jenis_surat_id_fkey" FOREIGN KEY ("jenis_surat_id") REFERENCES "jenis_surat"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surat" ADD CONSTRAINT "surat_warga_id_fkey" FOREIGN KEY ("warga_id") REFERENCES "warga"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permintaan_akses_detail" ADD CONSTRAINT "permintaan_akses_detail_rw_id_fkey" FOREIGN KEY ("rw_id") REFERENCES "rw"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permintaan_akses_detail" ADD CONSTRAINT "permintaan_akses_detail_rt_id_fkey" FOREIGN KEY ("rt_id") REFERENCES "rt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "langganan" ADD CONSTRAINT "langganan_rt_id_fkey" FOREIGN KEY ("rt_id") REFERENCES "rt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaksi_langganan" ADD CONSTRAINT "transaksi_langganan_langganan_id_fkey" FOREIGN KEY ("langganan_id") REFERENCES "langganan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "impor_data" ADD CONSTRAINT "impor_data_rt_id_fkey" FOREIGN KEY ("rt_id") REFERENCES "rt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
