/**
 * deploy — penyesuaian build untuk deploy SUB-PATH (mis. GitHub Pages di
 * `https://<user>.github.io/SIWARGA/`) tanpa mengubah perilaku lokal.
 *
 * Latar: aplikasi dibangun oleh Vite dengan `base` (env `VITE_BASE`, default
 * "/"). Saat base ≠ "/", URL halaman publik berprefix `/SIWARGA` sehingga:
 *   • path deep-link (`/undangan/<token>`, `/q/<token>`, `/admin`) harus
 *     dinormalisasi dulu lewat `pathTanpaDasar()` sebelum di-match;
 *   • tautan absolut (link undangan, QR surat) harus diberi prefix base;
 *   • `history.pushState` harus kembali ke base, bukan `/` root domain.
 *
 * Dua sakelar build (di-set sebagai env `VITE_*` saat `vite build`):
 *   • `VITE_KONSOL_ADMIN=off` — konsol sysadmin DILARANG tampil pada build
 *     publik (portal itu belum punya autentikasi; keputusan produk 1 Okt 2026).
 *     `pathAdmin()` langsung `false` dan App.tsx menolak merender halamannya.
 *   • `VITE_BACKEND=off` — build statis tanpa backend: setiap `minta()`
 *     langsung `OFFLINE` → fallback mode demo, tanpa membanjiri server statis
 *     dengan permintaan `/api/v1/**` yang pasti 404.
 *
 * Build lokal/dev TIDAK mengeset keduanya → perilaku lama dipertahankan.
 */

/** Prefix base deploy dari Vite: `"/"` (lokal) atau `"/SIWARGA/"` (Pages). */
export function dasarDeploy(): string {
  return import.meta.env.BASE_URL;
}

/**
 * Path URL tanpa prefix base deploy:
 *   base `/SIWARGA/` : `/SIWARGA/q/abc` → `/q/abc`, `/SIWARGA/` → `/`
 *   base `/`         : path dikembalikan apa adanya.
 * Bila path di LUAR base (mis. terlanjur di-push ke root), dikembalikan utuh
 * agar deteksi tetap jujur (gagal match = tidak dikenali, bukan salah baca).
 */
export function pathTanpaDasar(pathname?: string): string {
  const dasar = import.meta.env.BASE_URL.replace(/\/+$/, "");
  const p =
    pathname ?? (typeof window !== "undefined" ? window.location.pathname : "");
  if (dasar && (p === dasar || p.startsWith(`${dasar}/`))) {
    return p.slice(dasar.length) || "/";
  }
  return p;
}

/**
 * Konsol sysadmin aktif di build ini?
 * `false` bila `VITE_KONSOL_ADMIN=off` (build publik GitHub Pages) — portal
 * sysadmin belum berautentikasi sehingga tidak ikut dipublikasikan.
 */
export const KONSOL_ADMIN_AKTIF = import.meta.env.VITE_KONSOL_ADMIN !== "off";

/**
 * Backend memanggil API? `true` bila `VITE_BACKEND=off` (build statis tanpa
 * backend) — seluruh permintaan dijawab `OFFLINE` sejak di klien.
 */
export const BACKEND_DIMATIKAN = import.meta.env.VITE_BACKEND === "off";
