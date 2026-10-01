/**
 * Lifecycle token undangan — PRD §5.5/§6.3/§14.1 (task B4, B6) · aturan §4.2.
 *
 *   menunggu ──aktivasi sukses──▶ aktif_dipakai   (irreversible)
 *      │  └──lewat 24 jam──────▶ kedaluwarsa      (boleh dibuat token baru)
 *      └──cabut RT────────────▶ dicabut           (boleh dibuat token baru)
 *
 * Token terikat pada satu `wargaId` sehingga tidak bisa pindahtangankan, kode
 * asli TIDAK PERNAH disimpan (hanya hash argon2id), dan percobaan dari perangkat
 * berbeda dicatat untuk deteksi multi-perangkat (B6).
 */
import { createHash, randomBytes } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import { config } from "../config.js";
import { OPSI_ARGON2 } from "./kredensial.js";

export type StatusUndangan = "menunggu" | "aktif_dipakai" | "kedaluwarsa" | "dicabut";

export interface PercobaanAktivasi {
  /** ISO timestamp */
  waktu: string;
  deviceHash: string;
  ip: string | null;
  /**
   * B6 — hasil percobaan: `berhasil` (aktivasi tuntas) atau kode penolakan
   * (`gagal_validasi`, `kedaluwarsa`, `sudah_dipakai`, `dicabut`, `tidak_ditemukan`,
   * `balapan`). Opsional agar entri lama (tanpa field ini) tetap terbaca.
   */
  hasil?: string;
}

export interface TokenUndangan {
  status: StatusUndangan;
  kedaluwarsaPada: Date;
  dipakaiPada: Date | null;
  dicabutPada: Date | null;
  percobaanAktivasi: PercobaanAktivasi[];
}

export type HasilToken =
  | { hasil: "sah" }
  | { hasil: "kedaluwarsa" }
  | { hasil: "sudah_dipakai" }
  | { hasil: "dicabut" }
  | { hasil: "tidak_ditemukan" };

/** Kode pendek tanpa karakter mudah tertukar (tanpa 0/O dan 1/I). */
const ALFABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const PANJANG_KODE = 10;

export function buatKodeUndangan(): string {
  const acak = randomBytes(PANJANG_KODE);
  let hasil = "";
  for (const b of acak) hasil += ALFABET[b % ALFABET.length];
  return hasil;
}

export function hashKodeUndangan(kode: string): Promise<string> {
  return hash(kode.toUpperCase().trim(), { ...OPSI_ARGON2 });
}

export async function cocokkanKodeUndangan(kodeHash: string, kode: string): Promise<boolean> {
  try {
    return await verify(kodeHash, kode.toUpperCase().trim(), { ...OPSI_ARGON2 });
  } catch {
    return false;
  }
}

export function kedaluwarsaDari(dibuatPada: Date, jam: number = config.undanganJam): Date {
  return new Date(dibuatPada.getTime() + jam * 3_600_000);
}

export function tokenBaru(dibuatPada: Date = new Date()): TokenUndangan {
  return {
    status: "menunggu",
    kedaluwarsaPada: kedaluwarsaDari(dibuatPada),
    dipakaiPada: null,
    dicabutPada: null,
    percobaanAktivasi: [],
  };
}

/** Evaluasi status token pada waktu `now` (murni, tanpa I/O). */
export function verifikasiToken(token: TokenUndangan | null, now: Date = new Date()): HasilToken {
  if (!token) return { hasil: "tidak_ditemukan" };
  if (token.status === "aktif_dipakai") return { hasil: "sudah_dipakai" };
  if (token.status === "dicabut") return { hasil: "dicabut" };
  if (token.status === "kedaluwarsa") return { hasil: "kedaluwarsa" };
  if (token.kedaluwarsaPada.getTime() <= now.getTime()) return { hasil: "kedaluwarsa" };
  return { hasil: "sah" };
}

/**
 * Transisi `menunggu → aktif_dipakai`. Irreversible: token yang sudah terpakai
 * tidak bisa diaktifkan ulang oleh alur apa pun (§4.2).
 */
export function aktivasiBerhasil(token: TokenUndangan, now: Date = new Date()): TokenUndangan {
  if (token.status !== "menunggu" || token.kedaluwarsaPada.getTime() <= now.getTime()) {
    throw new Error("Token tidak dalam status menunggu / sudah kedaluwarsa.");
  }
  return {
    ...token,
    status: "aktif_dipakai",
    dipakaiPada: now,
  };
}

/** Penandaan waktu bila token dibiarkan lewat 24 jam (dipanggil job `kedaluwarsakanToken`). */
export function tandaiKedaluwarsa(token: TokenUndangan, now: Date = new Date()): TokenUndangan {
  if (token.status === "menunggu" && token.kedaluwarsaPada.getTime() <= now.getTime()) {
    return { ...token, status: "kedaluwarsa" };
  }
  return token;
}

/** Pencabutan oleh pengurus RT — setelah dicabut, token tidak bisa dipakai. */
export function cabutToken(token: TokenUndangan, now: Date = new Date()): TokenUndangan {
  if (token.status === "aktif_dipakai") {
    throw new Error("Token sudah terpakai dan tidak dapat dicabut.");
  }
  return { ...token, status: "dicabut", dicabutPada: now };
}

/**
 * B6 — deteksi multi-perangkat: `device_hash` berbeda pada token sama berarti
 * ada pihak lain yang mencoba mengaktifkan akun warga tersebut.
 */
export function perangkatBaruTerdeteksi(token: TokenUndangan, deviceHash: string): boolean {
  const terakhir = token.percobaanAktivasi[token.percobaanAktivasi.length - 1];
  return terakhir !== undefined && terakhir.deviceHash !== deviceHash;
}

/**
 * Bentuk SATU entri percobaan (tanpa menuliskannya ke database — penyimpanan
 * ada di rute aktivasi, task B6: setiap POST aktivasi menghasilkan tepi satu
 * entri, termasuk yang ditolak).
 */
export function catatPercobaan(
  token: TokenUndangan,
  input: { deviceHash: string; ip?: string | null; now?: Date; hasil?: string },
  batas = 20,
): TokenUndangan {
  const entri: PercobaanAktivasi = {
    waktu: (input.now ?? new Date()).toISOString(),
    deviceHash: input.deviceHash,
    ip: input.ip ?? null,
    ...(input.hasil ? { hasil: input.hasil } : {}),
  };
  const daftar = [...token.percobaanAktivasi, entri].slice(-batas);
  return { ...token, percobaanAktivasi: daftar };
}

/** Entri baru untuk `percobaan_aktivasi` (dipakai rute aktivasi B6). */
export function entriPercobaan(input: {
  deviceHash: string;
  ip?: string | null;
  now?: Date;
  hasil: string;
}): PercobaanAktivasi {
  return {
    waktu: (input.now ?? new Date()).toISOString(),
    deviceHash: input.deviceHash,
    ip: input.ip ?? null,
    hasil: input.hasil,
  };
}

/** Hash stabil untuk identitas perangkat (device_hash pada field `percobaan_aktivasi`). */
export function hashPerangkat(userAgent: string, ip: string | null): string {
  return createHash("sha256").update(`${userAgent}|${ip ?? ""}`).digest("hex");
}

/** Pemetaan hasil ke kode error API (§5.0). */
export function kodeApiToken(hasil: HasilToken): "TOKEN_INVALID" | "TOKEN_EXPIRED" | null {
  switch (hasil.hasil) {
    case "kedaluwarsa":
      return "TOKEN_EXPIRED";
    case "sudah_dipakai":
    case "dicabut":
    case "tidak_ditemukan":
      return "TOKEN_INVALID";
    case "sah":
      return null;
  }
}
