/**
 * Guard peran (§5.0 tabel "Guard peran") — F-2/F-3.
 *
 * Route cukup memanggil guard sebagai baris pertama; bila sesi tidak cocok,
 * `GalatTolak` dilempar lalu dipetakan `plugins/errorHandler.ts` menjadi kontrak
 * `{ ok: false, error: { code, message } }` — tidak ada `reply.gagal(...)`
 * terulang di setiap handler.
 *
 * Scope wilayah SELALU diambil dari `request.pemohon` (hasil hook sesi), bukan
 * dari body/query klien — sehingga penyusupan ID RT tidak mungkin (§4.6).
 */
import type { FastifyRequest } from "fastify";
import type { KodeApi, SesiAktif } from "../types.js";

export class GalatTolak extends Error {
  override readonly name = "GalatTolak";
  constructor(
    readonly kode: KodeApi,
    message: string,
  ) {
    super(message);
  }
}

function scopeRt(req: FastifyRequest): string {
  const id = req.pemohon?.level === "rt" ? req.pemohon.id : null;
  if (!id) throw new GalatTolak("FORBIDDEN_SCOPE", "Scope RT tidak tersedia untuk sesi ini.");
  return id;
}

/**
 * Pesan untuk sesi yang TIDAK ADA (kedaluwarsa/dicabut) — dipisahkan dari
 * salah peran supaya pengguna tidak melihat "Hanya Pengurus RT…" saat sesinya
 * memang sudah habis (akar kebingungan laporan bug B13).
 */
const PESAN_SESI_HABIS = "Sesi Anda telah berakhir — silakan masuk kembali.";

/** Warga login — mengembalikan `warga_id` subjek + `rt_id` pemilik datanya. */
export function wajibWarga(req: FastifyRequest): { sesi: SesiAktif; wargaId: string; rtId: string } {
  if (!req.sesi) throw new GalatTolak("UNAUTHORIZED", PESAN_SESI_HABIS);
  if (req.sesi.peran !== "warga") {
    throw new GalatTolak("UNAUTHORIZED", "Sesi warga tidak valid.");
  }
  const rtId = scopeRt(req);
  return { sesi: req.sesi, wargaId: req.sesi.subjekId, rtId };
}

/** Pengurus RT (RT_ADMIN) — seluruh rute `/rt/**` dijaga ini. */
export function wajibRt(req: FastifyRequest): { sesi: SesiAktif; rtId: string } {
  if (!req.sesi) throw new GalatTolak("UNAUTHORIZED", PESAN_SESI_HABIS);
  if (req.sesi.peran !== "rt_admin") {
    throw new GalatTolak("UNAUTHORIZED", "Hanya Pengurus RT yang boleh mengakses rute ini.");
  }
  const rtId = scopeRt(req);
  return { sesi: req.sesi, rtId };
}

/** Pengurus RW (RW_ADMIN) — seluruh rute `/rw/**` dijaga ini (Batch 20). */
export function wajibRw(req: FastifyRequest): { sesi: SesiAktif; rwId: string } {
  if (!req.sesi) throw new GalatTolak("UNAUTHORIZED", PESAN_SESI_HABIS);
  if (req.sesi.peran !== "rw_admin") {
    throw new GalatTolak("UNAUTHORIZED", "Hanya Pengurus RW yang boleh mengakses rute ini.");
  }
  const rwId = req.pemohon?.level === "rw" ? req.pemohon.id : null;
  if (!rwId) throw new GalatTolak("FORBIDDEN_SCOPE", "Scope RW tidak tersedia untuk sesi ini.");
  return { sesi: req.sesi, rwId };
}
