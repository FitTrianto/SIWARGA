/**
 * Konfigurasi Prisma CLI (Prisma 7).
 *
 * Catatan Prisma 7:
 *   • `url` datasource TIDAK lagi ditulis di `schema.prisma` → pindah ke sini.
 *   • Seed tidak lagi di kunci `prisma` pada package.json → pindah ke `migrations.seed`.
 *
 * `.env` dibaca lewat `dotenv/config` karena CLI Prisma 7 tidak lagi memuatnya
 * secara otomatis. Salin `.env.example` → `.env` sebelum menjalankan migrasi.
 */
import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  // Path relatif terhadap lokasi file konfigurasi ini (packages/server)
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Sengaja tanpa fallback: `prisma migrate` / `db seed` gagal jelas bila
    // DATABASE_URL belum diisi, daripada diam-diam menyambung ke DB salah sasaran.
    url: process.env.DATABASE_URL,
  },
});
