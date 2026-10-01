/**
 * Tipe tambahan untuk instance Fastify (augmentation).
 * Dipisah ke file .d.ts agar seluruh plugin melihat dekorasi yang sama.
 */
import type { Pemohon } from "./services/scopeCheck.js";
import type { KodeApi, SesiAktif } from "./types.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Sesi aktif hasil verifikasi cookie `sid`; null bila belum/login publik. */
    sesi: SesiAktif | null;
    /** Ringkasan scope pemohon untuk cek eksplisit (§4.6). */
    pemohon: Pemohon | null;
    /** IP asli bila melewati proxy tepercaya. */
    ipAsli: string;
  }

  interface FastifyReply {
    /** Respons sukses: `{ ok: true, data }` (§5.0). */
    ok(data: unknown): FastifyReply;
    /** Respons gagal: `{ ok: false, error: { code, message } }` (§5.0). */
    gagal(kode: KodeApi, message: string, detail?: unknown): FastifyReply;
  }
}
