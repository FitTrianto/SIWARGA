/**
 * Tipe domain yang dipakai lintas plugin/route.
 * Dipisah dari `fastify.d.ts` agar file augmentation tetap murni deklarasi.
 */

/** Kode error API — PRD §5.0. */
export type KodeApi =
  | "UNAUTHORIZED"
  | "FORBIDDEN_SCOPE"
  | "VALIDATION"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "TOKEN_INVALID"
  | "TOKEN_EXPIRED"
  /** Akun terkunci ≥3x salah kata sandi (423) — dahulu `PIN_LOCKED`. */
  | "ACCOUNT_LOCKED"
  | "INTERNAL";

export type PeranSesi = "warga" | "rt_admin" | "rw_admin" | "super_admin";

export interface SesiAktif {
  sid: string;
  /** warga_id / pengurus id sesuai `peran` */
  subjekId: string;
  peran: PeranSesi;
  kedaluwarsaPada: Date;
  terakhirAktif?: Date;
}
