/**
 * Plugin scope (§4.6) — menjembatani sesi → GUC RLS.
 *
 * DIPANGGIL LANGSUNG dari `buatAplikasi()` (bukan `app.register()`) agar
 * dekorator `request.pemohon` menempel pada instance induk — lihat catatan
 * serupa di `plugins/auth.ts`.
 *
 * `request.pemohon` diisi oleh hook sesi di `pasangAuth()`; rute F-3 memakainya
 * lewat `denganScopeRequest()` sehingga setiap query tenant selalu ber-scope.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { denganScope, type DbTransaksi } from "../services/db.js";
import type { LevelScope, Pemohon } from "../services/scopeCheck.js";

export async function pasangScope(app: FastifyInstance): Promise<void> {
  app.decorateRequest("pemohon", null);
}

/** Level scope untuk query; null bila request belum terautentikasi. */
export function levelPermintaan(req: FastifyRequest): LevelScope | null {
  return req.pemohon?.level ?? null;
}

/**
 * Jalankan query di dalam transaksi ber-scope untuk pemohon request ini.
 * Melempar error bila `pemohon` belum terisi — tidak ada query tanpa scope.
 */
export async function denganScopeRequest<T>(
  req: FastifyRequest,
  fn: (tx: DbTransaksi) => Promise<T>,
): Promise<T> {
  const pemohon: Pemohon | null = req.pemohon;
  if (!pemohon) {
    throw new Error(
      "Scope pemohon belum terpasang — pastikan hook autentikasi berjalan sebelum query.",
    );
  }
  if (pemohon.level === "platform") {
    return denganScope("platform", null, fn);
  }
  if (!pemohon.id) {
    throw new Error(`Scope ID untuk level ${pemohon.level} tidak tersedia.`);
  }
  return denganScope(pemohon.level, pemohon.id, fn);
}
