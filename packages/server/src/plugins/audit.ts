/**
 * Penulis audit_log (PRD §14, §6.8 · task B15).
 *
 * Satu tabel `audit_log` append-only untuk SELURUH portal (warga, RT, RW,
 * admin). Baris tidak pernah diubah/dihapus — trigger di migration 0002
 * menolak UPDATE/DELETE. Setiap mutasi warga/pengurus wajib memanggil ini.
 */
import { Prisma } from "../generated/prisma/client.js";
import { db, type DbApaSaja } from "../services/db.js";

export type LevelScopeAudit = "rt" | "rw" | "platform";
export type PeranActor = "warga" | "rt_admin" | "rw_admin" | "super_admin" | "sistem";
export type PortalAudit = "warga" | "rt" | "rw" | "admin" | "publik";

export interface InputAudit {
  scopeLevel: LevelScopeAudit;
  scopeId?: string | null;
  actorId: string;
  actorRole: PeranActor;
  portal: PortalAudit;
  modul: string;
  aksi: string;
  aksiBadge?: string | null;
  entitas?: string | null;
  entitasId?: string | null;
  sebelum?: Prisma.InputJsonValue | null;
  sesudah?: Prisma.InputJsonValue | null;
  ringkasan?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

export async function catatAudit(input: InputAudit, klien: DbApaSaja = db()): Promise<void> {
  await klien.auditLog.create({
    data: {
      scopeLevel: input.scopeLevel,
      scopeId: input.scopeId ?? null,
      actorId: input.actorId,
      actorRole: input.actorRole,
      portal: input.portal,
      modul: input.modul.slice(0, 40),
      aksi: input.aksi.slice(0, 60),
      aksiBadge: input.aksiBadge?.slice(0, 40) ?? null,
      entitas: input.entitas?.slice(0, 60) ?? null,
      entitasId: input.entitasId ?? null,
      sebelum: input.sebelum ?? Prisma.JsonNull,
      sesudah: input.sesudah ?? Prisma.JsonNull,
      ringkasan: input.ringkasan ?? null,
      ip: input.ip ?? null,
      userAgent: input.userAgent?.slice(0, 255) ?? null,
    },
  });
}

/** Nilai yang aman ditampilkan (NIK/No.KK tetap di-mask). */
export type AmanNilai = string | number | boolean | null;

export interface SelisihField {
  field: string;
  lama: AmanNilai;
  baru: AmanNilai;
}

/**
 * Diff dua objek untuk kolom `sebelum`/`sesudah`.
 * Kunci berawalan `nik`, `noKk`, `pin`, `password`, `token` TIDAK PERNAH ikut
 * disimpan — cukup ditandai bahwa nilainya berubah (prinsip masking §14).
 */
const KUNCI_TERLARANG = /^(nik|noKk|no_kk|pin|password|kataSandi|token|kodeUndangan)/i;

export function diffAudit<T extends Record<string, unknown>>(
  sebelum: T,
  sesudah: T,
  daftarKunci: (keyof T & string)[] = Object.keys({ ...sebelum, ...sesudah }) as (keyof T & string)[],
): SelisihField[] {
  const hasil: SelisihField[] = [];
  for (const kunci of daftarKunci) {
    const a = sebelum[kunci];
    const b = sesudah[kunci];
    if (samaNilai(a, b)) continue;
    if (KUNCI_TERLARANG.test(kunci)) {
      hasil.push({ field: kunci, lama: "(disembunyikan)", baru: "(diubah)" });
      continue;
    }
    hasil.push({ field: kunci, lama: tampilan(a), baru: tampilan(b) });
  }
  return hasil;
}

/**
 * Perbandingan nilai.
 *
 * Buffer (kolom ter-encrypt seperti `nik_encrypted`) dibandingkan ISINYA,
 * bukan representasinya — kalau tidak, dua nilai ter-encrypt yang berbeda
 * dianggap sama dan perubahan rahasia tidak pernah masuk audit log.
 * Tampilannya tetap menyembunyikan isi.
 */
function samaNilai(a: unknown, b: unknown): boolean {
  if (Buffer.isBuffer(a) && Buffer.isBuffer(b)) return a.equals(b);
  return normalisasi(a) === normalisasi(b);
}

/** Representasi aman untuk disimpan di kolom JSON audit. */
function tampilan(nilai: unknown): AmanNilai {
  return Buffer.isBuffer(nilai) ? "(ter-encrypt)" : normalisasi(nilai);
}

function normalisasi(nilai: unknown): AmanNilai {
  if (nilai === undefined || nilai === null) return null;
  if (nilai instanceof Date) return nilai.toISOString();
  if (Buffer.isBuffer(nilai)) return "(ter-encrypt)";
  if (typeof nilai === "object") return JSON.stringify(nilai) as unknown as AmanNilai;
  if (typeof nilai === "string" || typeof nilai === "number" || typeof nilai === "boolean") return nilai;
  return String(nilai);
}

/** Ringkasan manusia: "nama: Bambang → Suci; noHp: 0812… → 0813…" */
export function teksRingkasan(diff: SelisihField[], maks = 300): string {
  const teks = diff
    .map((d) => `${d.field}: ${tampil(d.lama)} → ${tampil(d.baru)}`)
    .join("; ");
  return teks.length > maks ? `${teks.slice(0, maks - 1)}…` : teks;
}

function tampil(v: AmanNilai): string {
  if (v === null) return "-";
  return String(v);
}
