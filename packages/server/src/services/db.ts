/**
 * Klien database & pembungkus transaksi ber-scope RLS.
 *
 * Kontrak §4.6: SETIAP akses data tenant berjalan di dalam satu transaksi yang
 * diawali `SET LOCAL app.scope_level` + `app.scope_id`. Karena tabel tenant
 * memakai `FORCE ROW LEVEL SECURITY`, koneksi yang lupa menyetel scope akan
 * melihat NOL baris — keadaan gagal-aman, bukan kebocoran.
 *
 * Prisma 7 memisahkan URL koneksi (prisma.config.ts, untuk CLI migrasi) dari
 * runtime client (driver adapter di sini).
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { config } from "../config.js";
import { PrismaClient } from "../generated/prisma/client.js";
import type { LevelScope } from "./scopeCheck.js";

export type Db = PrismaClient;
/** Klien transaksi: seluruh delegate model tersedia, tanpa $connect/$disconnect. */
export type DbTransaksi = Omit<Db, "$connect" | "$disconnect" | "$on" | "$use" | "$extends">;
/** Delegate model tersedia juga pada klien transaksi — dipakai agar helper audit
 *  dapat dipanggil baik di dalam maupun di luar transaksi. */
export type DbApaSaja = Pick<PrismaClient, "auditLog">;

export function databaseTersedia(): boolean {
  return Boolean(config.databaseUrl);
}

export function buatKlienDb(url: string): Db {
  const adapter = new PrismaPg({ connectionString: url });
  return new PrismaClient({ adapter });
}

let klien: Db | null = null;

/** Singleton klien. Melempar pesan jelas bila DATABASE_URL belum diatur. */
export function db(): Db {
  if (klien) return klien;
  if (!config.databaseUrl) {
    throw new Error(
      "DATABASE_URL belum diatur. Salin .env.example → .env lalu isi, " +
        "kemudian jalankan `pnpm prisma:migrate` dan `pnpm db:seed`.",
    );
  }
  klien = buatKlienDb(config.databaseUrl);
  return klien;
}

export async function tutupDb(): Promise<void> {
  if (klien) {
    await klien.$disconnect();
    klien = null;
  }
}

/** Uji koneksi ringan untuk endpoint /health. */
export async function cekKoneksiDb(): Promise<boolean> {
  if (!databaseTersedia()) return false;
  try {
    await db().$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

/**
 * Jalankan `fn` di dalam transaksi yang scope-nya sudah diset.
 *
 *   await denganScope('rt', rtId, async (tx) => {
 *     const baris = await tx.tagihan.findMany(); // otomatis terfilter RLS
 *   });
 */
export async function denganScope<T>(
  level: LevelScope,
  scopeId: string | null,
  fn: (tx: DbTransaksi) => Promise<T>,
): Promise<T> {
  const klien = db();
  return klien.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.scope_level', ${level}::text, true)`;
    await tx.$executeRaw`SELECT set_config('app.scope_id', ${scopeId ?? ""}::text, true)`;
    return fn(tx);
  });
}

/**
 * Transaksi ber-GUC `app.scope_level = 'auth'` — JALUR AUTENTIKASI (F-2).
 *
 * Satu-satunya tempat yang boleh memakai level `auth`: route login warga & hook
 * sesi yang perlu membaca SATU baris `warga` (by no_hp / by id) sebelum scope
 * tenant diketahui. Policy `p_auth_lookup_warga` (migrasi 0003) hanya mengabulkan
 * SELECT pada kondisi ini; seluruh policy lain menolak level `auth`, dan level
 * `auth` tidak pernah dipakai oleh `denganScopeRequest` (pemohon selalu
 * rt/rw/platform).
 */
export async function denganScopeAuth<T>(fn: (tx: DbTransaksi) => Promise<T>): Promise<T> {
  const klien = db();
  return klien.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.scope_level', 'auth'::text, true)`;
    await tx.$executeRaw`SELECT set_config('app.scope_id', ''::text, true)`;
    return fn(tx);
  });
}

/**
 * Set scope pada koneksi SESI (bukan transaksi) — hanya dipakai `prisma/seed.ts`
 * yang bekerja per-RT tanpa transaksi panjang. Request HTTP HARUS memakai
 * `denganScope` (SET LOCAL) supaya scope tidak bocor ke permintaan berikutnya
 * yang kebetulan memakai koneksi pool yang sama.
 */
export async function setScopeSesi(klien: Db, level: LevelScope, scopeId: string | null): Promise<void> {
  await klien.$executeRaw`SELECT set_config('app.scope_level', ${level}::text, false)`;
  await klien.$executeRaw`SELECT set_config('app.scope_id', ${scopeId ?? ""}::text, false)`;
}
