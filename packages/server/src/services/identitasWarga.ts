/**
 * Identitas warga untuk jalur autentikasi — F-2 (task B1–B3, §5.1, §5.5).
 *
 * Dua fungsi berikut SATU-SATUNYA pemanggil `denganScopeAuth()` untuk membaca
 * tabel `warga` yang di-RLS `p_scope_rt`:
 *
 *   • `cariWargaUntukLogin(noHp)` — lookup publik saat login (no. HP → warga).
 *   • `cariScopeWarga(wargaId)`   — resolusi scope per request dari cookie sesi.
 *
 * Keduanya SELALU men-target tepat SATU baris (by `no_hp`, atau by `id`) dan
 * hanya mengembalikan kolom minimal — tidak pernah daftar warga. Setelah scope
 * `rt_id` diketahui, seluruh query lain berjalan lewat `denganScopeRequest()`
 * (§4.6) sehingga RLS penuh kembali berlaku.
 */
import { denganScopeAuth } from "./db.js";

const KOLOM_MINIMAL = {
  id: true,
  rtId: true,
  nama: true,
  statusAkses: true,
  isActive: true,
} as const;

export interface WargaUntukLogin {
  id: string;
  rtId: string;
  nama: string;
  /** Enum `StatusAkses` sebagai string — dicek pemanggil (B4/B5). */
  statusAkses: string;
  isActive: boolean;
}

/** Normalisasi no. HP ke format lokal `08xx`: buang pemisah, 62→0, 8→0. */
export function normalisasiNoHp(input: string): string {
  const digit = input.replace(/\D+/g, "");
  if (/^62\d{8,}$/.test(digit)) return `0${digit.slice(2)}`;
  if (/^8\d{8,}$/.test(digit)) return `0${digit}`;
  return digit;
}

/**
 * Cari satu warga berdasarkan no. HP untuk login.
 * Mengembalikan null bila tidak ada ATAU ambigu — pemanggil WAJIB membalas
 * pesan generik yang sama untuk "tidak ada akun" dan "kata sandi salah"
 * (anti-enumerasi §14.1).
 */
export async function cariWargaUntukLogin(noHp: string): Promise<WargaUntukLogin | null> {
  const digit = normalisasiNoHp(noHp);
  if (digit.length < 8) return null;
  return denganScopeAuth(async (tx) => {
    // no_hp unik PER RT (bukan global) → bisa >1 hasil lintas tenant; bila
    // ambigu login ditolak, tidak pernah menebak salah satu baris.
    const baris = await tx.warga.findMany({
      where: { noHp: digit },
      select: KOLOM_MINIMAL,
      take: 2,
      orderBy: { createdAt: "asc" },
    });
    if (baris.length !== 1) return null;
    const b = baris[0];
    return { id: b.id, rtId: b.rtId, nama: b.nama, statusAkses: String(b.statusAkses), isActive: b.isActive };
  });
}

/**
 * Resolusi scope warga dari `warga_id` pada sesi (dijalankan tiap request yang
 * membawa cookie `sid`). Null bila baris tidak ada ATAU aksesnya bukan `aktif`
 * — hook sesi lalu membuang cookie, sehingga penonaktifan akses oleh RT (B5)
 * langsung mengeluarkan warga dari sesi berjalan.
 */
export async function cariScopeWarga(wargaId: string): Promise<WargaUntukLogin | null> {
  return denganScopeAuth(async (tx) => {
    const b = await tx.warga.findUnique({ where: { id: wargaId }, select: KOLOM_MINIMAL });
    if (!b) return null;
    return { id: b.id, rtId: b.rtId, nama: b.nama, statusAkses: String(b.statusAkses), isActive: b.isActive };
  });
}
