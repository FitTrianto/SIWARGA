/**
 * CSRF double-submit — PRD §5.6 (cookie `sid` + CSRF token untuk pengurus/admin).
 *
 * Token = `<nonce>.<HMAC-SHA256(nonce|sid, SESSION_SECRET)>`. Tidak perlu
 * penyimpanan sisi server: token terikat pada sid sesi dan dapat diverifikasi
 * ulang dari cookie + header `x-csrf-token`.
 *
 * Rute mutasi pengurus WAJIB memakai `verifikasiCsrf` (dipasang di F-2 bersama
 * route auth); rute warga cukup SameSite=Lax + cookie httpOnly (§5.6).
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { config } from "../config.js";
import { NAMA_COOKIE_CSRF } from "./auth.js";

function tandaTangan(nonce: string, sid: string): string {
  return createHmac("sha256", config.sessionSecret).update(`${nonce}|${sid}`).digest("base64url");
}

export function buatTokenCsrf(sid: string): string {
  const nonce = randomBytes(16).toString("base64url");
  return `${nonce}.${tandaTangan(nonce, sid)}`;
}

export function verifikasiTokenCsrf(sid: string, token: string | undefined | null): boolean {
  if (!token) return false;
  const [nonce, tanda] = token.split(".");
  if (!nonce || !tanda) return false;
  const harapan = tandaTangan(nonce, sid);
  const a = Buffer.from(tanda);
  const b = Buffer.from(harapan);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * preHandler untuk rute mutasi pengurus/admin: cookie `csrf_token` + header
 * `x-csrf-token` harus cocok dan sesi harus ada.
 */
export async function verifikasiCsrf(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
  if (!req.sesi) {
    await reply.gagal("UNAUTHORIZED", "Sesi tidak valid.");
    return;
  }
  const cookie = req.cookies?.[NAMA_COOKIE_CSRF];
  const header = req.headers["x-csrf-token"];
  const nilaiHeader = Array.isArray(header) ? header[0] : header;
  if (!verifikasiTokenCsrf(req.sesi.sid, cookie) || !verifikasiTokenCsrf(req.sesi.sid, nilaiHeader)) {
    await reply.gagal("UNAUTHORIZED", "Token CSRF tidak valid — muat ulang halaman.");
  }
}

/** Set cookie CSRF (panggilan sekali setelah login). */
export function tanamCookieCsrf(reply: FastifyReply, sid: string, maxAgeDetik: number): void {
  reply.setCookie(NAMA_COOKIE_CSRF, buatTokenCsrf(sid), {
    httpOnly: false, // JS front-end perlu membacanya untuk header `x-csrf-token`
    secure: config.isProduksi,
    sameSite: "lax",
    path: "/",
    maxAge: maxAgeDetik,
  });
}
