import { digitsOnly, fmtWa } from "./shared";
import { dasarDeploy, pathTanpaDasar } from "./deploy";

// ===========================================================================
// UNDANGAN PORTAL WARGA — RT mengundang warga lewat link & QR code.
// Dua mode:
//  • Mode produksi (backend menyala): /undangan/<token> memuat detail dari API
//    lalu warga MEMBUAT KATA SANDI (kebijakan Fase 3, NIST SP 800-63B).
//  • Mode demo (backend mati): token dari daftar lokal → konfirmasi 4 digit
//    terakhir no. HP, seperti rancangan lama.
// Satu sumber kebenaran daftar demo: state `undanganList` di App.tsx
// (dibagikan ke tombol "Undangan" di Data Warga / Portal RT dan halaman
// publik UndanganPage).
// ===========================================================================

export type StatusUndangan = "Terkirim" | "Dipakai" | "Kedaluwarsa";

export interface Undangan {
  id: string;
  /** Token unik yang menjadi isi link & QR code. */
  token: string;
  /** Nama warga yang diundang. */
  nama: string;
  /** Alamat rumah tujuan (format pendek, sama dengan Data Hunian). */
  alamat: string;
  /** Digit nomor HP warga, contoh "081298764321". */
  noWa: string;
  /** Tanggal undangan dikirim, contoh "24 Sep 2026". */
  dibuat: string;
  /** Batas waktu konfirmasi, contoh "01 Okt 2026". */
  berlakuSampai: string;
  status: StatusUndangan;
  /** Pengurus pengirim, contoh "Bpk. Joko Santoso". */
  dikirimOleh: string;
}

/** Seed — token dibuat stempel agar mudah dicoba langsung di browser. */
export const undanganDefault: Undangan[] = [
  {
    id: "un1",
    token: "SGW-7QK2-M4XT",
    nama: "Hendra Kusuma",
    alamat: "Blok B2 No. 14",
    noWa: "081298764321",
    dibuat: "24 Sep 2026",
    berlakuSampai: "01 Okt 2026",
    status: "Terkirim",
    dikirimOleh: "Bpk. Joko Santoso",
  },
  {
    id: "un2",
    token: "SGW-XW3R-6BTF",
    nama: "Rina Kurnia Sari",
    alamat: "Blok A1 No. 1",
    noWa: "081234567890",
    dibuat: "22 Sep 2026",
    berlakuSampai: "29 Sep 2026",
    status: "Terkirim",
    dikirimOleh: "Bpk. Joko Santoso",
  },
  {
    id: "un3",
    token: "SGW-P9VD-3HNR",
    nama: "Yuliana Sari",
    alamat: "Blok C1 No. 8",
    noWa: "081322557788",
    dibuat: "20 Sep 2026",
    berlakuSampai: "27 Sep 2026",
    status: "Dipakai",
    dikirimOleh: "Bpk. Joko Santoso",
  },
  {
    id: "un4",
    token: "SGW-K2LM-8ZCW",
    nama: "Bagus Prakoso",
    alamat: "Blok D1 No. 7",
    noWa: "085711223344",
    dibuat: "05 Sep 2026",
    berlakuSampai: "12 Sep 2026",
    status: "Kedaluwarsa",
    dikirimOleh: "Rahmat Hidayat",
  },
];

/** Token unik URL-safe, format "SGW-XXXX-XXXX". */
export function buatToken(): string {
  const bag = () =>
    Math.random().toString(36).replace(/[^a-z0-9]/gi, "").toUpperCase().padEnd(4, "0").slice(0, 4);
  return `SGW-${bag()}-${bag()}`;
}

/** URL absolut halaman konfirmasi publik untuk sebuah token. */
export function linkUndangan(token: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  // `dasarDeploy()` menambahkan prefix base bila deploy di sub-path
  // (GitHub Pages `/SIWARGA/`); lokal base "/" → hasil identik dulu.
  return `${origin}${dasarDeploy()}undangan/${token}`;
}

/**
 * Ambil token dari path URL saat aplikasi dibuka lewat link/QR:
 *   "/undangan/SGW-7QK2-M4XT"        → "SGW-7QK2-M4XT"   (mode demo)
 *   "/undangan/<uuid>.<kode>"        → "<uuid>.<kode>"    (mode produksi —
 *   titik ikut diizinkan; kode dipisahkan titik terakhir saat dipecah server)
 * Bukan undangan → null.
 */
export function tokenDariPath(): string | null {
  if (typeof window === "undefined") return null;
  // pathTanpaDasar memotong prefix base deploy (/SIWARGA) agar deep-link
  // GitHub Pages tetap match regex yang sama dengan build lokal.
  const m = pathTanpaDasar().match(/^\/undangan\/([A-Za-z0-9._-]+)/);
  return m ? m[1] : null;
}

/** URL absolut halaman aktivasi pendaftaran mandiri RT (Batch 17). */
export function linkAktivasiRt(token: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}${dasarDeploy()}aktivasi-rt/${token}`;
}

/**
 * Ambil token aktivasi pendaftaran RT dari path URL saat tautan dibuka
 * (deep-link `/aktivasi-rt/<uuid>.<kode>` — pola sama `/undangan/<token>`).
 * Bukan tautan aktivasi → null.
 */
export function tokenAktivasiRtDariPath(): string | null {
  if (typeof window === "undefined") return null;
  const m = pathTanpaDasar().match(/^\/aktivasi-rt\/([A-Za-z0-9._-]+)/);
  return m ? m[1] : null;
}

/**
 * Format tanggal pendek gaya Indonesia dari ISO 8601 (atau string apa pun
 * yang bisa dibaca `Date`): "2026-09-29T07:00:00.000Z" → "29 Sep 2026".
 * Bila bukan tanggal valid, string asli dikembalikan apa adanya.
 */
export function tanggalPendek(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
  return `${String(d.getDate()).padStart(2, "0")} ${BULAN[d.getMonth()]} ${d.getFullYear()}`;
}

/** 4 digit terakhir no. HP — kode konfirmasi yang diketahui pemilik nomor. */
export function empatDigitAkhir(noWa: string): string {
  return digitsOnly(noWa).slice(-4);
}

/**
 * Tampilkan nomor dengan 4 digit terakhir disensor:
 * "0812-9876-4321" → "0812-9876-••••" (jawaban konfirmasi tidak bocor).
 */
export function maskWaAkhir(noWa: string): string {
  const f = fmtWa(noWa);
  return f.length > 4 ? `${f.slice(0, -4)}••••` : "••••";
}

/** Isi pesan WhatsApp berisi link undangan (url wa.me + nomor internasional). */
export function pesanWaUndangan(u: Undangan): { url: string; intl: string } {
  const digits = digitsOnly(u.noWa);
  const intl = digits.startsWith("0") ? `62${digits.slice(1)}` : digits;
  const teks =
    `Assalamualaikum Bpk./Ibu ${u.nama},\n\n` +
    `Anda diundang mengaktifkan Portal Warga ${u.alamat}.\n` +
    `Buka link berikut lalu ikuti proses aktivasi (buat kata sandi portal Anda):\n` +
    `${linkUndangan(u.token)}\n\n` +
    `Berlaku s/d ${u.berlakuSampai} — dari ${u.dikirimOleh}.`;
  return { url: `https://wa.me/${intl}?text=${encodeURIComponent(teks)}`, intl };
}

export function badgeUndangan(status: StatusUndangan): string {
  switch (status) {
    case "Terkirim": return "bg-sky-100 text-sky-800";
    case "Dipakai": return "bg-primary-container text-on-primary";
    case "Kedaluwarsa": return "bg-error-container text-on-error";
  }
}
