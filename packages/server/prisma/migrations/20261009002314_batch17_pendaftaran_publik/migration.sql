-- CreateEnum
CREATE TYPE "StatusPendaftaran" AS ENUM ('menunggu_aktivasi', 'aktif', 'kedaluwarsa');

-- AlterTable
ALTER TABLE "kecamatan" ALTER COLUMN "kode" DROP NOT NULL;

-- AlterTable
ALTER TABLE "kelurahan" ALTER COLUMN "kode_kemendagri" DROP NOT NULL;

-- AlterTable
ALTER TABLE "rt" ALTER COLUMN "kode_wilayah" DROP NOT NULL;

-- CreateTable
CREATE TABLE "pendaftaran_rt" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "rt_id" UUID,
    "nama_ketua" VARCHAR(120) NOT NULL,
    "whatsapp" VARCHAR(20) NOT NULL,
    "kode_rt" VARCHAR(3) NOT NULL,
    "kode_rw" VARCHAR(3) NOT NULL,
    "kecamatan" VARCHAR(120) NOT NULL,
    "kelurahan" VARCHAR(120) NOT NULL,
    "kota" VARCHAR(80) NOT NULL,
    "paket" "PaketLangganan" NOT NULL,
    "setuju_pdp" BOOLEAN NOT NULL DEFAULT true,
    "status" "StatusPendaftaran" NOT NULL DEFAULT 'menunggu_aktivasi',
    "kode_hash" VARCHAR(255) NOT NULL,
    "kedaluwarsa_pada" TIMESTAMPTZ(3) NOT NULL,
    "dipakai_pada" TIMESTAMPTZ(3),
    "ip" INET,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "pendaftaran_rt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pendaftaran_rt_rt_id_key" ON "pendaftaran_rt"("rt_id");

-- CreateIndex
CREATE INDEX "pendaftaran_rt_status_kedaluwarsa_pada_idx" ON "pendaftaran_rt"("status", "kedaluwarsa_pada");

-- AddForeignKey
ALTER TABLE "pendaftaran_rt" ADD CONSTRAINT "pendaftaran_rt_rt_id_fkey" FOREIGN KEY ("rt_id") REFERENCES "rt"("id") ON DELETE SET NULL ON UPDATE CASCADE;
