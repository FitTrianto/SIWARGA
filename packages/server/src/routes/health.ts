/**
 * Rute kesehatan — satu-satunya endpoint publik pada F-1.
 * Berguna untuk uptime probe & memastikan migrasi database sudah diterapkan.
 */
import type { FastifyPluginAsync } from "fastify";
import { config } from "../config.js";
import { cekKoneksiDb, databaseTersedia, db } from "../services/db.js";

interface CekMigrasi {
  diterapkan: number;
  menunggu: number;
  gagal: number;
}

async function cekMigrasi(): Promise<CekMigrasi | null> {
  try {
    const baris = await db().$queryRaw<
      { diterapkan: bigint; menunggu: bigint; gagal: bigint }[]
    >`
      SELECT
        count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS diterapkan,
        count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL)       AS menunggu,
        count(*) FILTER (WHERE rolled_back_at IS NOT NULL)                           AS gagal
      FROM _prisma_migrations`;
    const b = baris[0];
    if (!b) return null;
    return {
      diterapkan: Number(b.diterapkan),
      menunggu: Number(b.menunggu),
      gagal: Number(b.gagal),
    };
  } catch {
    // tabel _prisma_migrations belum ada = migrasi belum pernah dijalankan
    return { diterapkan: 0, menunggu: 0, gagal: 0 };
  }
}

export const ruteHealth: FastifyPluginAsync = async (app) => {
  app.get("/health", async (_req, reply) => {
    const adaDatabase = databaseTersedia();
    const terhubung = adaDatabase ? await cekKoneksiDb() : false;
    const migrasi = adaDatabase && terhubung ? await cekMigrasi() : null;

    const status = !adaDatabase
      ? "tanpa_database"
      : !terhubung
        ? "database_terputus"
        : migrasi && migrasi.menunggu > 0
          ? "migrasi_tertinggal"
          : "sehat";

    return reply.ok({
      status,
      env: config.env,
      versi: "0.1.0",
      uptimeDetik: Math.round(process.uptime()),
      waktu: new Date().toISOString(),
      database: !adaDatabase ? "belum_dikonfigurasi" : terhubung ? "terhubung" : "terputus",
      migrasi,
    });
  });
};
