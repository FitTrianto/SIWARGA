-- =============================================================================
-- SIWARGA — Migrasi batch 15 (Okt 2026): mode tagihan + tutup buku iuran
-- Acuan: spek batch 15 + keputusan desain 8 Okt 2026
--   • mode_tagihan / hari_generate: tagihan bulanan dibuat OTOMATIS pada
--     hari_generate (1–28, Asia/Jakarta) atau MANUAL lewat tombol Portal RT.
--     Default `otomatis` + `1` = perilaku lama (generate tgl 1) tidak berubah.
--   • tutup_buku_iuran: satu baris per RT. Selama baris AKTIF
--     (dibuka_kembali_pada IS NULL), generate tagihan periode SETELAH
--     periode_tertutup ditolak — "tak mengulang ke bulan berikutnya".
--     Sifatnya SEMENTARA: buka kembali mengisi dibuka_kembali_pada dan
--     mengaktifkan kembali generate; riwayat tutup/buka ada di audit_log.
-- =============================================================================

-- CreateEnum
CREATE TYPE "ModeTagihan" AS ENUM ('otomatis', 'manual');

-- AlterTable
ALTER TABLE "pengaturan_rt" ADD COLUMN "hari_generate" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "pengaturan_rt" ADD COLUMN "mode_tagihan" "ModeTagihan" NOT NULL DEFAULT 'otomatis';

-- CreateTable
CREATE TABLE "tutup_buku_iuran" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "rt_id" UUID NOT NULL,
    "periode_tertutup" VARCHAR(7) NOT NULL,
    "alasan" VARCHAR(300),
    "ditutup_oleh" UUID NOT NULL,
    "ditutup_pada" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dibuka_kembali_pada" TIMESTAMPTZ(3),

    CONSTRAINT "tutup_buku_iuran_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tutup_buku_iuran_rt_id_key" ON "tutup_buku_iuran"("rt_id");

-- AddForeignKey
ALTER TABLE "tutup_buku_iuran" ADD CONSTRAINT "tutup_buku_iuran_rt_id_fkey" FOREIGN KEY ("rt_id") REFERENCES "rt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- RLS — pola A (migrasi 0002 §C): tabel bertenant dengan kolom rt_id.
-- Kedua GUC dibaca dengan current_setting(..., true) → keadaan default AMAN:
-- bila scope belum diset, baris tidak terlihat/ditulis sama sekali.
-- -----------------------------------------------------------------------------
ALTER TABLE "tutup_buku_iuran" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tutup_buku_iuran" FORCE ROW LEVEL SECURITY;
CREATE POLICY p_scope_rt ON "tutup_buku_iuran" FOR ALL
  USING (
    COALESCE(current_setting('app.scope_level', true), '') = 'platform'
    OR (
      COALESCE(current_setting('app.scope_level', true), '') = 'rt'
      AND "tutup_buku_iuran"."rt_id" = NULLIF(current_setting('app.scope_id', true), '')::uuid
    )
  )
  WITH CHECK (
    COALESCE(current_setting('app.scope_level', true), '') = 'platform'
    OR (
      COALESCE(current_setting('app.scope_level', true), '') = 'rt'
      AND "tutup_buku_iuran"."rt_id" = NULLIF(current_setting('app.scope_id', true), '')::uuid
    )
  );
