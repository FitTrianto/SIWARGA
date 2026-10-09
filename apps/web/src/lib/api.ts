/**
 * Klien API SIWARGA — kontrak envelope PRD §5.0 / spesifikasi §5:
 *   `{ ok: true, data }`  |  `{ ok: false, error: { code, message } }`
 *
 * Prinsip:
 *  • Semua permintaan lewat proxy Vite (`/api` → `http://127.0.0.1:3000`) sehingga
 *    berjalan satu origin — cookie `sid` (httpOnly) & `csrf_token` ikut terkirim,
 *    tanpa perlu CORS.
 *  • Galat `OFFLINE` berarti backend tidak sedang menyala atau responsnya bukan
 *    API (proxy mengembalikan halaman/error HTML). PEMANGGIL memutuskan fallback
 *    (mis. mode demo memakai data seed) — klien tidak pernah menyamar sebagai sukses.
 *  • `flash()` TIDAK boleh dipakai untuk `window.alert()`; galat dikembalikan
 *    sebagai objek agar ditampilkan inline oleh komponen.
 */

import {
  PERIODE_AKTIF,
  badgePortal,
  digitsOnly,
  fmtWa,
  isoKeTgl,
  memberWaValue,
  shortAlamat,
  type AjuanPerubahan,
  type AjuanPerubahanRt,
  type FamilyMember,
  type HunianRumah,
  type JenisAjuan,
  type KategoriIuran,
  type KkData,
  type KasRt,
  type KopSurat,
  type MemberFilter,
  type Pembayaran,
  type SifatIuran,
  type StatusAjuan,
  type StatusSuratServer,
  type Surat,
  type TagihanTambahan,
  type TipeTarif,
  type WargaRt,
  labelStatusSurat,
} from "./shared";
import { BACKEND_DIMATIKAN } from "./deploy";
import { Undangan, tanggalPendek } from "./undangan";

export const PREFIX_API = "/api/v1";

export class GalatApi extends Error {
  override readonly name = "GalatApi";
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Backend tidak terjangkau / respons bukan API (mode demo). */
export function galatOffline(): GalatApi {
  return new GalatApi("OFFLINE", "Server belum menyala.", 0);
}

function bacaCookie(nama: string): string | null {
  if (typeof document === "undefined") return null;
  const cari = document.cookie
    .split("; ")
    .find((k) => k.startsWith(`${nama}=`));
  return cari ? decodeURIComponent(cari.slice(nama.length + 1)) : null;
}

const TIMEOUT_MS = 8_000;

interface Opsi {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  /** Header tambahan, mis. `Idempotency-Key`. */
  headers?: Record<string, string>;
  /** Kirim header CSRF dari cookie `csrf_token` (wajib untuk mutasi pengurus). */
  csrf?: boolean;
}

/**
 * Inti klien: mengirim permintaan lalu mengembalikan `data` dari envelope.
 * Menerjemahkan kegagalan menjadi `GalatApi` dengan `code` dari API.
 */
export async function minta<T>(path: string, opsi: Opsi = {}): Promise<T> {
  // Build statis tanpa backend (GitHub Pages, `VITE_BACKEND=off`): langsung
  // OFFLINE — pemanggil memakai fallback demo. Menghemat puluhan request
  // `/api/v1/**` yang pasti 404 di host statis.
  if (BACKEND_DIMATIKAN) throw galatOffline();

  const kontrol = new AbortController();
  const timer = setTimeout(() => kontrol.abort(), TIMEOUT_MS);

  const headers: Record<string, string> = { ...(opsi.headers ?? {}) };
  // `FormData` (impor berkas A10): browser menyetel `multipart/form-data`
  // beserta boundary-nya sendiri — menyetel `content-type` secara manual
  // justru merusak parse berkas di server.
  const multipart = opsi.body instanceof FormData;
  if (opsi.body !== undefined && !multipart) headers["content-type"] = "application/json";
  if (opsi.csrf) {
    const csrf = bacaCookie("csrf_token");
    if (csrf) headers["x-csrf-token"] = csrf;
  }

  let res: Response;
  try {
    res = await fetch(`${PREFIX_API}${path}`, {
      method: opsi.method ?? "GET",
      credentials: "same-origin",
      headers,
      body:
        opsi.body === undefined ? undefined : multipart ? (opsi.body as FormData) : JSON.stringify(opsi.body),
      signal: kontrol.signal,
    });
  } catch {
    // jaringan gagal / timeout → backend mati
    throw galatOffline();
  } finally {
    clearTimeout(timer);
  }

  // Proxy Vite yang tak punya backend menjawab dengan HTML (atau error non-JSON).
  const jenis = res.headers.get("content-type") ?? "";
  if (!jenis.includes("application/json")) throw galatOffline();

  let isi: { ok?: boolean; data?: T; error?: { code: string; message: string } };
  try {
    isi = (await res.json()) as typeof isi;
  } catch {
    throw galatOffline();
  }

  if (isi.ok === true && isi.data !== undefined) return isi.data as T;
  if (isi.error) throw new GalatApi(isi.error.code, isi.error.message, res.status);
  throw new GalatApi("INTERNAL", "Respons server tidak sesuai kontrak.", res.status);
}

// ---------------------------------------------------------------------------
// Auth — F-2 (spesifikasi §5.1)
// ---------------------------------------------------------------------------

export interface ProfilLogin {
  peran: "warga" | "rt_admin" | "rw_admin" | "super_admin";
  nama: string;
  /** Jabatan pengurus (`pengurus_rt/rw`) — kosong bila akun tak tercatat di sana. */
  jabatan?: string;
  /** Surel akun pengurus — jatuh-tampilan identitas bila `nama` kosong. */
  email?: string;
  /**
   * Bukan dari server: ditandai FE saat login OFFLINE masuk mode demo
   * (identitas demo yang dikenal saja) — dipakai banner "MODE DEMO" jujur.
   */
  modeDemo?: boolean;
}

/**
 * Label jabatan pengurus (enum DB → tampilan). Tanpa jabatan → "Ketua"
 * (tampilan lama sebelum nama/jabatan ikut respons login) — bila `nama`
 * kosong, caller menampilkan surel sebagai identitas jujur, bukan nama palsu.
 */
export function jabatanKeLabel(jabatan?: string): string {
  if (jabatan === "sekretaris") return "Sekretaris";
  if (jabatan === "bendahara") return "Bendahara";
  return "Ketua"; // enum `ketua` / nilai tak dikenal / kosong
}

/**
 * Normalisasi no. HP untuk API: `62812…` / `812…` → `0812…`
 * (input FE memakai prefiks terpisah "+62" sehingga nilainya tanpa kode negara).
 */
export function normalisasiNoHp(nilai: string): string {
  const digits = nilai.replace(/\D/g, "");
  if (digits.startsWith("62")) return `0${digits.slice(2)}`;
  if (digits.startsWith("8")) return `0${digits}`;
  return digits;
}

/** POST /auth/warga/login — `{ noHp, password }` (kata sandi, bukan PIN). */
export function loginWarga(noHp: string, password: string): Promise<ProfilLogin> {
  return minta<ProfilLogin>("/auth/warga/login", {
    method: "POST",
    body: { noHp: normalisasiNoHp(noHp), password },
  });
}

/** POST /auth/pengurus/login — `{ email, password }`. */
export function loginPengurus(email: string, password: string): Promise<ProfilLogin> {
  return minta<ProfilLogin>("/auth/pengurus/login", {
    method: "POST",
    body: { email: email.trim(), password },
  });
}

/** POST /auth/warga/logout — membuang cookie sesi (tak mengapa gagal). */
export function logoutWarga(): Promise<unknown> {
  return minta("/auth/warga/logout", { method: "POST", csrf: true }).catch(() => undefined);
}

/** POST /auth/pengurus/logout — wajib header `x-csrf-token`. */
export function logoutPengurus(): Promise<unknown> {
  return minta("/auth/pengurus/logout", { method: "POST", csrf: true }).catch(() => undefined);
}

/** GET /auth/warga/sesi — cek sesi masih berlaku. */
export function sesiWarga(): Promise<{ nama: string; sisaDetik: number }> {
  return minta("/auth/warga/sesi");
}

/**
 * Satu baris riwayat login (B3) — `GET /auth/warga/riwayat-login`:
 * 20 sesi terbaru milik akun login ini, terbaru dahulu. Token tidak pernah
 * dikirim (server hanya menyimpan SHA-256), jadi tampilan murni metadata.
 */
export interface EntriRiwayatLogin {
  /** Kapan sesi TERAKHIR dipakai — dipakai FE sebagai "waktu login". */
  waktu: string;
  masukPada: string;
  berlakuSampai: string;
  perangkat: string | null;
  ip: string | null;
  kota: string | null;
  /** true → baris ini adalah sesi yang sedang dipakai perangkat ini. */
  sesiIni: boolean;
  dicabut: boolean;
}

/** GET /auth/warga/riwayat-login — riwayat login sendiri (guard `wajibWarga`). */
export function riwayatLoginWarga(): Promise<{ daftar: EntriRiwayatLogin[] }> {
  return minta("/auth/warga/riwayat-login");
}

// ---------------------------------------------------------------------------
// Pendaftaran mandiri RT — Batch 17 (PRD §9.5, rute PUBLIK /publik/*)
// ---------------------------------------------------------------------------

/** Input formulir "Daftarkan RT" di Landing Page (kolom wilayah per level). */
export interface InputPendaftaranRt {
  namaKetua: string;
  whatsapp: string;
  rt: string;
  rw: string;
  kecamatan: string;
  kelurahan: string;
  kota: string;
  paket: "pro_trial" | "free";
  setuju: boolean;
}

/** Balasan `POST /publik/pendaftaran` — token hanya dikembalikan SEKALI di sini. */
export interface HasilPendaftaranRt {
  pendaftaranId: string;
  token: string;
  /** ISO 8601 — tautan aktivasi berlaku 24 jam, sekali pakai. */
  kedaluwarsaPada: string;
}

/**
 * POST /publik/pendaftaran — kirim formulir pendaftaran; server MENYIMPANNYA
 * sebagai antrean aktivasi dan menerbitkan token. Galat: `VALIDATION` (400),
 * `RATE_LIMITED` (429); `OFFLINE` (0) bila server tak terjangkau — tanda
 * data TIDAK tersimpan.
 */
export function daftarRt(input: InputPendaftaranRt): Promise<HasilPendaftaranRt> {
  return minta<HasilPendaftaranRt>("/publik/pendaftaran", { method: "POST", body: input });
}

/** Balasan `POST /publik/aktivasi` — tenant & akun jadi, sesi RT terpasang (auto-login). */
export interface HasilAktivasiRt {
  peran: "rt_admin";
  nama: string;
  email: string;
}

/**
 * POST /publik/aktivasi — tukar tautan `<id>.<kode>` menjadi akun pengurus RT
 * (provisioning tenant: wilayah → RT → langganan → pengurus → akun) + sesi.
 * Galat: `NOT_FOUND` (404), `TOKEN_EXPIRED` (410), `CONFLICT` (409),
 * `VALIDATION` (400).
 */
export function aktivasiAkunRt(input: {
  token: string;
  email: string;
  password: string;
  konfirmasiPassword: string;
}): Promise<HasilAktivasiRt> {
  return minta<HasilAktivasiRt>("/publik/aktivasi", { method: "POST", body: input });
}

// ---------------------------------------------------------------------------
// Undangan & aktivasi Portal Warga — F-2 (spesifikasi §5.2)
// ---------------------------------------------------------------------------

/**
 * GET publik `/auth/warga/undangan/:token` — detail minimal undangan.
 * No. HP pemegang sengaja TIDAK dikirim (data minimization); `berlakuSampai`
 * berupa ISO 8601 — format tampilan dihitung di klien (`tanggalPendek`).
 * Galat: `NOT_FOUND` (404) / `TOKEN_EXPIRED` (410) / `TOKEN_INVALID` (400).
 */
export interface DetailUndangan {
  nama: string;
  alamat: string;
  dikirimOleh: string;
  berlakuSampai: string;
}

/** POST `/rt/warga/:id/undangan` — hasil penerbitan undangan oleh Pengurus RT. */
export interface HasilUndanganRt {
  id: string;
  /** `<uuid>.<kode>` — kode asli tak pernah disimpan server (argon2id). */
  token: string;
  nama: string;
  alamat: string;
  dikirimOleh: string;
  berlakuSampai: string;
  noWa: string;
}

export function detailUndangan(token: string): Promise<DetailUndangan> {
  return minta(`/auth/warga/undangan/${encodeURIComponent(token)}`);
}

/**
 * POST publik `/auth/warga/undangan/:token/aktivasi` — membuat kata sandi;
 * respons sukses berarti sesi warga sudah tertanam (cookie `sid` httpOnly).
 */
export function aktivasiUndangan(
  token: string,
  payload: { password: string; konfirmasiPassword: string; consent: boolean },
): Promise<{ peran: "warga"; nama: string }> {
  return minta(`/auth/warga/undangan/${encodeURIComponent(token)}/aktivasi`, {
    method: "POST",
    body: payload,
  });
}

/**
 * POST RT `/rt/warga/:id/undangan` — `idWarga` menerima UUID warga ATAU no. HP
 * (server selalu membatasi ke RT pemilik sesi; wajib cookie CSRF).
 * Galat: `CONFLICT` (warga sudah aktif) / `VALIDATION` (data belum lengkap).
 */
export function buatUndanganRt(idWarga: string): Promise<HasilUndanganRt> {
  return minta(`/rt/warga/${encodeURIComponent(idWarga)}/undangan`, {
    method: "POST",
    csrf: true,
  });
}

// --- B5/B6 · manajemen undangan & inspeksi keamanan (spesifikasi §5.4) --------

/**
 * POST `/rt/undangan/:id/kirim-ulang` (B5) — mencabut token `menunggu` lama
 * (milik warga yang sama; termasuk yang SUDAH kedaluwarsa — §4.2 "lewat 24
 * jam → kedaluwarsa, boleh dibuat token baru") lalu menerbitkan token BARU
 * dengan kode segar. `noHpBaru` opsional (10–13 digit) mengganti no. HP warga
 * sekaligus. Galat: `NOT_FOUND` (404 lintas RT) / `CONFLICT` (sudah dipakai /
 * warga aktif / dinonaktifkan / non-aktif) / `VALIDATION` (no. HP atau data
 * rumah-KK belum lengkap).
 */
export function kirimUlangUndanganRt(
  id: string,
  noHpBaru?: string,
): Promise<HasilUndanganRt> {
  return minta(`/rt/undangan/${encodeURIComponent(id)}/kirim-ulang`, {
    method: "POST",
    body: noHpBaru ? { noHpBaru } : {},
    csrf: true,
  });
}

/**
 * DELETE `/rt/undangan/:id` (B5) — cabut undangan. Idempoten: baris yang sudah
 * `dicabut` membalas `{ ulang: true }` tanpa audit ganda; `aktif_dipakai` → 409.
 */
export function cabutUndanganRt(id: string): Promise<{ id: string; ulang: boolean }> {
  return minta(`/rt/undangan/${encodeURIComponent(id)}`, { method: "DELETE", csrf: true });
}

/**
 * Okt 2026 · GET `/rt/undangan` — daftar undangan NON-dicabut milik RT sesi
 * dengan status EFEKTIF (`kedaluwarsa` dihitung dari waktu server §4.2, bukan
 * hanya kolom status). Kode token TIDAK pernah ikut (argon2id, §5.1); inilah
 * sumber tombol Cabut/Kirim Ulang + label "Kedaluwarsa" yang tetap akurat
 * setelah F5 (sebelumnya daftar hilang → aksi tak berdaya).
 */
export interface UndanganServer {
  id: string;
  wargaId: string;
  nama: string;
  alamat: string;
  noWa: string;
  status: "menunggu" | "aktif_dipakai" | "kedaluwarsa";
  dibuatPada: string;
  kedaluwarsaPada: string;
  dikirimOleh: string;
}

export function daftarUndanganRt(): Promise<{ undangan: UndanganServer[] }> {
  return minta("/rt/undangan");
}

/**
 * `UndanganServer` → baris FE. `token` = string kosong — kode asli tak pernah
 * disimpan server, sehingga entri daftar tak pernah menghasilkan link/QR palsu
 * (halaman publik mode produksi memuat token dari URL, bukan dari daftar ini).
 */
export function undanganServerKeUndangan(u: UndanganServer): Undangan {
  return {
    id: u.id,
    token: "",
    nama: u.nama,
    alamat: u.alamat,
    noWa: u.noWa,
    dibuat: tanggalPendek(u.dibuatPada),
    berlakuSampai: tanggalPendek(u.kedaluwarsaPada),
    status:
      u.status === "aktif_dipakai" ? "Dipakai" : u.status === "kedaluwarsa" ? "Kedaluwarsa" : "Terkirim",
    dikirimOleh: u.dikirimOleh,
  };
}

/**
 * PATCH `/rt/warga/:id/akses` (B5) — HANYA `dinonaktifkan` (keputusan produk
 * Okt 2026: pengurus RT hanya dapat mengubah status portal menjadi nonaktif —
 * `aktif` ditolak server 400 VALIDATION).
 */
export function ubahAksesWargaRt(
  id: string,
  statusAkses: "dinonaktifkan",
): Promise<{ id: string; statusAkses: StatusAksesServer; ubah: boolean; sesiDicabut: number }> {
  return minta(`/rt/warga/${encodeURIComponent(id)}/akses`, {
    method: "PATCH",
    body: { status_akses: statusAkses },
    csrf: true,
  });
}

/** Satu percobaan aktivasi yang tercatat server (`TokenUndangan.percobaanAktivasi`). */
export interface PercobaanAktivasiServer {
  waktu: string;
  deviceHash: string;
  ip: string | null;
  hasil: string | null;
}

/** Temuan `GET /rt/undangan/inspeksi` (B6): token yang disentuh >1 perangkat. */
export interface TemuanInspeksiUndangan {
  id: string;
  status: string;
  wargaId: string;
  nama: string;
  statusAkses: StatusAksesServer;
  noHp: string | null;
  dibuatPada: string;
  berlakuSampai: string;
  dipakaiPada: string | null;
  jumlahPercobaan: number;
  jumlahPerangkat: number;
  percobaan: PercobaanAktivasiServer[];
}

/** GET `/rt/undangan/inspeksi` (B6) — kotak masuk keamanan Data Warga RT. */
export function inspeksiUndanganRt(): Promise<{ daftar: TemuanInspeksiUndangan[] }> {
  return minta("/rt/undangan/inspeksi");
}

// ---------------------------------------------------------------------------
// Iuran (Portal Warga + Portal RT) — F-3/F-6 (spesifikasi §5.3–§5.4)
// ---------------------------------------------------------------------------

/** Status baris pembayaran versi server (kamus `LABEL_PEMBAYARAN`). */
type StatusServer = "menunggu_verifikasi" | "lunas" | "ditolak";

/**
 * Baris riwayat `GET /warga/iuran/riwayat`; rute RT `GET /rt/iuran/pembayaran`
 * menambah `nama` + `alamat`. `periode` berasal dari alokasi pertama dan
 * `null` bila bukti belum dialokasi (masih menunggu verifikasi).
 */
export interface BarisPembayaranServer {
  id: string;
  wargaId: string;
  tanggal: string; // "YYYY-MM-DD"
  nominal: number;
  metode: string;
  status: StatusServer;
  statusLabel: string;
  catatan: string | null;
  sumber: string;
  periode: string | null; // "YYYY-MM" | null
  alokasi: Array<{ tagihanId: string; kategori: string; periode: string; nominal: number }>;
  nama?: string;
  alamat?: string;
}

/** `GET /warga/iuran/tagihan` — status turunan tagihan periode aktif (B10). */
export interface RingkasTagihanServer {
  periode: string;
  ringkas: {
    totalTagihan: number;
    totalSisa: number;
    totalTerbayar: number;
    menungguVerifikasi: number;
    status: "lunas" | "menunggu_verifikasi" | "sebagian" | "belum_bayar";
    label: string;
  };
}

/** GET riwayat pembayaran milik warga login (maks. 200 baris terbaru). */
export function riwayatIuran(): Promise<{
  riwayat: BarisPembayaranServer[];
  ringkas: { totalLunas: number; totalMenunggu: number; totalDitolak: number; label: string };
}> {
  return minta("/warga/iuran/riwayat");
}

/** GET tagihan warga per periode + ringkas status turunan. */
export function tagihanIuran(periode?: string): Promise<RingkasTagihanServer> {
  return minta(`/warga/iuran/tagihan${periode ? `?periode=${periode}` : ""}`);
}

/**
 * POST bukti bayar warga → `menunggu_verifikasi`. `kunciIdempotensi` dikirim
 * sebagai header `Idempotency-Key` (id baris dari FE) agar klik ganda tidak
 * menggandakan pengajuan.
 */
export function ajukanBuktiIuran(
  payload: { nominal: number; metode: string; catatan?: string; buktiUrl?: string },
  kunciIdempotensi: string,
): Promise<{ pembayaran: BarisPembayaranServer; ulang: boolean; statusLabel: string }> {
  return minta("/warga/iuran/bukti", {
    method: "POST",
    body: payload,
    headers: { "Idempotency-Key": kunciIdempotensi },
  });
}

/** GET antrean pembayaran sesi RT (`?status=` & `?periode=` opsional). */
export function pembayaranRt(): Promise<{
  pembayaran: BarisPembayaranServer[];
  ringkas: { menunggu: number; lunas: number; ditolak: number; labelMenunggu: string };
}> {
  return minta("/rt/iuran/pembayaran");
}

/** POST setujui bukti → alokasi FIFO + kas otomatis (wajib CSRF). */
export function setujuiPembayaranRt(
  id: string,
  catatan?: string,
  /** B7 — mode alokasi `terpisah`: kategori tujuan alokasi (opsional). */
  kategoriTujuan?: string,
): Promise<unknown> {
  const body: Record<string, string> = {};
  if (catatan) body.catatan = catatan;
  if (kategoriTujuan) body.kategoriTujuan = kategoriTujuan;
  return minta(`/rt/iuran/pembayaran/${encodeURIComponent(id)}/setujui`, {
    method: "POST",
    body,
    csrf: true,
  });
}

// ---------------------------------------------------------------------------
// B7 · pengaturan iuran per-RT (§6.4.5 · §6.4.10)
// ---------------------------------------------------------------------------

/** `GET/PATCH /rt/iuran/pengaturan` — mode alokasi, tenggat, denda, mode tagihan. */
export interface PengaturanIuranRt {
  modeAlokasi: "gabungan" | "terpisah";
  tenggatHari: number;
  dendaAktif: boolean;
  /** Batch 15 — tagihan dibuat otomatis pada `hariGenerate` atau manual lewat tombol. */
  modeTagihan: "otomatis" | "manual";
  /** Batch 15 — tanggal generate bulanan (1–28, Asia/Jakarta); default 1. */
  hariGenerate: number;
}

/** B7 — baca pengaturan iuran RT sesi. Baris belum ada → default skema. */
export function pengaturanIuranRt(): Promise<PengaturanIuranRt> {
  return minta("/rt/iuran/pengaturan");
}

/** B7 — simpan pengaturan iuran (parsial, wajib CSRF) → nilai sesudah. */
export function simpanPengaturanIuranRt(
  patch: Partial<PengaturanIuranRt>,
): Promise<PengaturanIuranRt> {
  return minta("/rt/iuran/pengaturan", { method: "PATCH", body: patch, csrf: true });
}

// ---------------------------------------------------------------------------
// B9 · generate tagihan bulanan, profil iuran warga, tagihan tercatat
// ---------------------------------------------------------------------------

/** Hasil `POST /rt/iuran/tagihan/generate` (idempoten per warga+kategori+periode). */
export interface HasilGenerateTagihan {
  dibuat: number;
  dilewati: number;
  /** Tagihan BELUM teralokasi yang disesuaikan dengan profil iuran (`sinkronProfil`). */
  sinkron?: number;
  periode: string;
}

/**
 * B9 — "Buat Tagihan Bulan Ini"; tanpa `periode` server memakai `PERIODE_AKTIF`.
 * `sinkronProfil` (FE selalu true) menyesuaikan tagihan yang belum teralokasi
 * dengan profil iuran terbaru — inilah jalur bendahara "memodifikasi" tagihan.
 */
export function generateTagihanRt(
  periode?: string,
  sinkronProfil = true,
): Promise<HasilGenerateTagihan> {
  return minta("/rt/iuran/tagihan/generate", {
    method: "POST",
    body: { ...(periode ? { periode } : {}), sinkronProfil },
    csrf: true,
  });
}

/** Batch 15 — status tutup buku iuran (dibaca dari `GET /rt/iuran/tagihan`). */
export interface StatusTutupBukuIuran {
  periodeTertutup: string;
  ditutupPada: string;
  alasan: string | null;
}

/**
 * Batch 15 — TUTUP BUKU IURAN (sementara, bisa dibuka): generate periode
 * SETELAH `periodeTertutup` ditolak server (409). Tanpa `periodeTertutup`
 * server memakai periode berjalan. Balasan = baris tersimpan.
 */
export function tutupBukuIuranRt(payload: {
  periodeTertutup?: string;
  alasan?: string;
}): Promise<StatusTutupBukuIuran> {
  return minta("/rt/iuran/tutup-buku", { method: "POST", body: payload, csrf: true });
}

/** Batch 15 — buka kembali buku iuran; generate berjalan kembali. */
export function bukaBukuIuranRt(): Promise<{
  periodeTertutup: string;
  dibukaKembaliPada: string | null;
}> {
  return minta("/rt/iuran/tutup-buku/buka", { method: "POST", body: {}, csrf: true });
}

/** Satu baris `GET /rt/iuran/kategori` (master server — bukan state demo FE). */
export interface KategoriIuranServer {
  id: string;
  nama: string;
  tipeTarif: "flat" | "per_unit" | "insidental";
  nominalDefault: number;
  sifat: "wajib" | "opsional";
  statusAktif: boolean;
  urutan: number;
}

export function kategoriIuranRt(): Promise<{ kategori: KategoriIuranServer[] }> {
  return minta("/rt/iuran/kategori");
}

/** `GET /rt/iuran/kategori` → state `KategoriIuran` FE (unifikasi sumber kategori). */
export function serverKeKategori(k: KategoriIuranServer): KategoriIuran {
  return {
    id: k.id,
    nama: k.nama,
    nominal: k.nominalDefault,
    tipe: k.tipeTarif,
    sifat: k.sifat,
    urutan: k.urutan,
    statusAktif: k.statusAktif,
  };
}

/** Payload `POST /rt/iuran/kategori` — `urutan` (terakhir) dihitung server (§6.4.1). */
export interface TambahKategoriRtPayload {
  nama: string;
  nominal: number;
  tipe: TipeTarif;
  sifat: SifatIuran;
}

/** POST `/rt/iuran/kategori` — tambah master kategori (wajib CSRF, nama unik per RT). */
export function tambahKategoriRt(
  payload: TambahKategoriRtPayload,
): Promise<{ kategori: KategoriIuranServer }> {
  return minta("/rt/iuran/kategori", { method: "POST", body: payload, csrf: true });
}

/** PATCH `/rt/iuran/kategori/:id` — ubah kategori / toggle status aktif (PRD §6.4.1). */
export function ubahKategoriRt(
  id: string,
  patch: Partial<TambahKategoriRtPayload> & { statusAktif?: boolean },
): Promise<{ kategori: KategoriIuranServer }> {
  return minta(`/rt/iuran/kategori/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: patch,
    csrf: true,
  });
}

// ---------------------------------------------------------------------------
// Iuran kondisional (tagihan insidental, `Tagihan.sumber = "insidental"`) —
// dibuat Portal RT, terlihat & dibayar di Portal Warga, status kembali ke RT.
// ---------------------------------------------------------------------------

/** Satu kelompok tagihan insidental `GET /rt/iuran/kondisional` (per kategori+periode). */
export interface KondisionalRtServer {
  id: string; // "<kategoriId>|<periode>" — kunci grup FE
  kategoriId: string;
  periode: string;
  nama: string;
  nominal: number;
  tenggat: string | null; // "25 Okt 2026" (server `tanggalPendek`)
  total: number;
  lunas: number;
  belum: number;
  /** true bila seluruh hunian berpenghuni ikut ditagih. */
  targetSemua: boolean;
  baris: Array<{
    wargaId: string;
    nama: string;
    alamat: string;
    nominal: number;
    sisa: number;
    status: string; // "lunas" | "sebagian" | "belum_bayar"
    label: string;
  }>;
}

/** Satu baris `GET /warga/iuran/kondisional` — tagihan insidental milik sendiri. */
export interface KondisionalWargaServer {
  id: string;
  kategoriId: string;
  nama: string;
  periode: string;
  nominal: number;
  sisa: number;
  tenggat: string | null;
  status: string; // "lunas" | "sebagian" | "belum_bayar"
  label: string;
}

/** GET daftar kondisional di Portal RT (periode berjalan + tunggakan insidental). */
export function daftarKondisionalRt(periode?: string): Promise<{ periode: string; daftar: KondisionalRtServer[] }> {
  return minta(`/rt/iuran/kondisional${periode ? `?periode=${encodeURIComponent(periode)}` : ""}`);
}

/** POST buat tagihan kondisional (wajib CSRF). `target` "semua" | wargaId[]. */
export function buatKondisionalRt(payload: {
  nama: string;
  nominal: number;
  tenggat?: string; // "YYYY-MM-DD"
  target?: "semua" | string[];
  periode?: string;
}): Promise<{ kategoriId: string; periode: string; dibuat: number; target: number }> {
  return minta("/rt/iuran/kondisional", { method: "POST", body: payload, csrf: true });
}

/** GET tagihan kondisional milik warga login (semua periode, terbaru dulu). */
export function kondisionalWarga(): Promise<{ daftar: KondisionalWargaServer[] }> {
  return minta("/warga/iuran/kondisional");
}

/** Ikon material mengikuti isi tagihan (hanya glyph — tanpa data lain). */
function ikonKondisional(nama: string): string {
  const n = nama.toLowerCase();
  if (n.includes("fogging") || n.includes("nyamuk") || n.includes("pest")) return "pest_control";
  if (n.includes("pagar") || n.includes("renov") || n.includes("perbaikan") || n.includes("gedung")) return "construction";
  if (n.includes("keamanan") || n.includes("siskam") || n.includes("ronda")) return "shield";
  if (n.includes("kebersihan") || n.includes("sampah") || n.includes("lingkungan")) return "delete_sweep";
  if (n.includes("acara") || n.includes("syukuran") || n.includes("event")) return "celebration";
  if (n.includes("kematian") || n.includes("musibah") || n.includes("santunan")) return "volunteer_activism";
  return "receipt";
}

/** Referensi tampilan yang tetap bisa dicek pengurus (id kategori server). */
function refKondisional(kategoriId: string): string {
  return `KOND-${kategoriId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
}

/** Baris RT → kartu `TagihanTambahan` (progres per warga ikut dibawa). */
export function kondisionalRtKeKartu(k: KondisionalRtServer): TagihanTambahan {
  return {
    id: k.id,
    icon: ikonKondisional(k.nama),
    nama: k.nama,
    ref: refKondisional(k.kategoriId),
    nominal: k.nominal,
    tenggat: k.tenggat ?? "-",
    status: k.total > 0 && k.lunas >= k.total ? "Lunas" : "Belum",
    total: k.total,
    lunasCount: k.lunas,
    periode: k.periode,
    ...(k.targetSemua ? { targetSemua: true } : {}),
  };
}

/** Baris warga → kartu `TagihanTambahan` di Portal Warga (sisa dibawa). */
export function kondisionalWargaKeKartu(k: KondisionalWargaServer): TagihanTambahan {
  return {
    id: k.id,
    icon: ikonKondisional(k.nama),
    nama: k.nama,
    ref: refKondisional(k.kategoriId),
    nominal: k.nominal,
    sisa: k.sisa,
    tenggat: k.tenggat ?? "-",
    status: k.status === "lunas" ? "Lunas" : "Belum",
    periode: k.periode,
  };
}

/** B9/B10 — satu baris `GET /rt/iuran/tagihan` (satu warga, beragam kategori). */
export interface BarisTagihanRtServer {
  wargaId: string;
  nama: string;
  alamat: string;
  jumlah: number;
  sisa: number;
  /** B10 — badge: ada keringanan aktif pada salah satu tagihan baris ini. */
  keringananAktif?: boolean;
  /** B10 — badge: jumlah bulan tunggakan tertua warga (0 bila tidak). */
  tunggakanBulan?: number;
  perKategori: Array<{
    /** Batch 15C — id tagihan baris ini (sasaran PATCH edit nominal). */
    tagihanId: string;
    kategoriId: string;
    kategori: string;
    nominal: number;
    sisa: number;
    status: string;
    label: string;
  }>;
  status: "Lunas" | "Sebagian" | "Belum Bayar" | "Menunggu Verifikasi";
  tanggalBayar: string | null;
}

/** B9/B10 — dashboard tagihan per warga; `q`/`status`/`kategori` difilter server. */
export function tagihanRtServer(
  opsi: { periode?: string; kategori?: string; status?: string; q?: string } = {},
): Promise<{
  periode: string;
  rows: BarisTagihanRtServer[];
  /** Batch 15 — apakah periode berjalan sudah punya tagihan (gerbang tombol generate). */
  sudahDibuat: boolean;
  /** Batch 15 — status tutup buku iuran; `null` bila buku terbuka. */
  tutupBuku: {
    periodeTertutup: string;
    ditutupPada: string;
    alasan: string | null;
  } | null;
  rekap: {
    total: number;
    lunas: number;
    sebagian: number;
    menungguVerifikasi: number;
    belumBayar: number;
    target: number;
    terkumpul: number;
  };
}> {
  const q = new URLSearchParams();
  if (opsi.periode) q.set("periode", opsi.periode);
  if (opsi.kategori) q.set("kategori", opsi.kategori);
  if (opsi.status) q.set("status", opsi.status);
  if (opsi.q) q.set("q", opsi.q);
  const rintik = q.toString();
  return minta(`/rt/iuran/tagihan${rintik ? `?${rintik}` : ""}`);
}

/** Satu baris `GET /rt/warga/:id/profil-iuran` — override nominal/unit. */
export interface BarisProfilIuran {
  kategoriId: string;
  nama: string;
  tipeTarif: "flat" | "per_unit" | "insidental";
  nominalDefault: number;
  /** null = ikut `nominal_default` kategori. */
  nominalBerlaku: number | null;
  jumlahUnit: number;
}

export function profilIuranRt(wargaId: string): Promise<{
  warga: { id: string; nama: string };
  baris: BarisProfilIuran[];
}> {
  return minta(`/rt/warga/${encodeURIComponent(wargaId)}/profil-iuran`);
}

/** B9 — simpan profil iuran (upsert + audit); berlaku untuk tagihan berikutnya. */
export function simpanProfilIuranRt(
  wargaId: string,
  payload: { kategoriId: string; nominalBerlaku?: number | null; jumlahUnit?: number },
): Promise<{ warga: { id: string; nama: string }; profil: { kategoriId: string; nama: string } }> {
  return minta(`/rt/warga/${encodeURIComponent(wargaId)}/profil-iuran`, {
    method: "PUT",
    body: payload,
    csrf: true,
  });
}

/**
 * Batch 15C — tolak bukti → tanpa alokasi/kas (wajib CSRF). `alasan` WAJIB di
 * server (min. 3 karakter): warga berhak tahu apa yang harus diperbaiki saat
 * mengajukan ulang.
 */
export function tolakPembayaranRt(id: string, alasan: string): Promise<unknown> {
  return minta(`/rt/iuran/pembayaran/${encodeURIComponent(id)}/tolak`, {
    method: "POST",
    body: { alasan },
    csrf: true,
  });
}

/**
 * Batch 15C — PATCH /rt/iuran/tagihan/:id (edit nominal satu tagihan; wajib
 * CSRF). Hanya tagihan yang BELUM punya pembayaran teralokasi (409 bila sudah);
 * 404 bila id bukan milik RT sesi (RLS).
 */
export function ubahNominalTagihanRt(
  id: string,
  nominal: number,
): Promise<{ id: string; nominal: number; sisa: number; periode: string }> {
  return minta(`/rt/iuran/tagihan/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: { nominal },
    csrf: true,
  });
}

const BULAN_PANJANG = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];
const BULAN_PENDEK = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

/** `"2026-10"` → `"Oktober 2026"`; `null` → periode aktif (bukti belum dialokasi). */
export function labelPeriodeServer(periode: string | null): string {
  if (!periode) return PERIODE_AKTIF;
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(periode);
  return m ? `${BULAN_PANJANG[Number(m[2]) - 1]} ${m[1]}` : PERIODE_AKTIF;
}

const METODE_FE: Record<string, { label: string; ikon: string }> = {
  qris: { label: "QRIS", ikon: "qr_code_2" },
  tunai: { label: "Tunai", ikon: "payments" },
  transfer: { label: "Transfer Bank", ikon: "account_balance" },
  lainnya: { label: "Lainnya", ikon: "payments" },
};

/** Label metode FE (`"QRIS"`, `"Transfer Bank"`, `"Tunai"`) → enum API. */
export function metodeKeServer(label: string): string {
  const s = label.toLowerCase();
  if (s.includes("qris")) return "qris";
  if (s.includes("tunai")) return "tunai";
  if (s.includes("transfer")) return "transfer";
  return "lainnya";
}

function statusKeFe(status: StatusServer): Pembayaran["status"] {
  return status === "lunas" ? "Lunas" : status === "ditolak" ? "Ditolak" : "Menunggu Verifikasi";
}

/** Tanggal API (`YYYY-MM-DD`) → label FE ala `tanggalPendek` (bebas zona waktu). */
function tanggalServer(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (m) return `${m[3]} ${BULAN_PENDEK[Number(m[2]) - 1]} ${m[1]}`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${String(d.getDate()).padStart(2, "0")} ${BULAN_PENDEK[d.getMonth()]} ${d.getFullYear()}`;
}

/**
 * Peta baris API → entitas FE `Pembayaran`:
 *  • `periode` = alokasi periode aktif bila ada, lalu alokasi pertama; bukti
 *    yang belum dialokasi (`null`) selalu dihitung periode aktif — kunci
 *    derivasi status Lunas/Menunggu di Portal Warga;
 *  • `alamat`/`nama` diisi dari sesi/daftar KK FE (endpoint riwayat tidak
 *    membawa keduanya).
 */
export function barisKePembayaran(
  r: BarisPembayaranServer,
  alamat: string,
  nama: string,
): Pembayaran {
  const alokasi = r.alokasi ?? [];
  const periodeAktif =
    alokasi.find((a) => labelPeriodeServer(a.periode) === PERIODE_AKTIF)?.periode ??
    alokasi[0]?.periode ??
    null;
  const metode = METODE_FE[r.metode] ?? { label: r.metode, ikon: "payments" };
  return {
    id: r.id,
    alamat,
    nama,
    periode: labelPeriodeServer(periodeAktif),
    jumlah: r.nominal,
    metode: metode.label,
    metodeIcon: metode.ikon,
    tanggal: tanggalServer(r.tanggal),
    status: statusKeFe(r.status),
  };
}

// ---------------------------------------------------------------------------
// Kas — F-4 / F-6 (spesifikasi §5.4, PRD §6.5)
// ---------------------------------------------------------------------------

/** Baris `GET /rt/kas`: `tanggal` `YYYY-MM-DD`, `saldoSesudah` = rantai jurnal. */
export interface EntriKasServer {
  id: string;
  tanggal: string;
  tipe: "masuk" | "keluar" | "pembalik";
  kategori: string;
  keterangan: string;
  nominal: number;
  arah: "positif" | "negatif";
  saldoSesudah: number;
  sumber: string;
  reversalOfId: string | null;
  buktiUrl: string | null;
  createdAt: string;
}

/** GET buku kas sesi RT — urut jurnal (baris terakhir = saldo terkini). */
export function daftarKasRt(): Promise<{
  entri: EntriKasServer[];
  ringkas: { saldoKini: number; totalMasuk: number; totalKeluar: number; jumlahEntri: number };
}> {
  return minta("/rt/kas");
}

/**
 * POST catat kas manual (wajib CSRF). Entri `iuran_alokasi` datang otomatis
 * dari verifikasi iuran — tidak pernah lewat endpoint ini (spesifikasi §5.4).
 */
export function catatKasRt(payload: {
  tanggal?: string;
  tipe: "masuk" | "keluar";
  kategori: string;
  keterangan: string;
  nominal: number;
}): Promise<{ entri: EntriKasServer }> {
  return minta("/rt/kas", { method: "POST", body: payload, csrf: true });
}

/**
 * B8 — koreksi lewat jurnal pembalik (`POST /rt/kas/:id/pembalik`, wajib CSRF).
 * Baris asal tidak pernah diubah (append-only); `alasan` 3–200 karakter —
 * validasi FE disamakan dengan zod server.
 */
export function koreksiKasRt(
  id: string,
  alasan: string,
): Promise<{ asal: EntriKasServer; pembalik: EntriKasServer }> {
  return minta(`/rt/kas/${encodeURIComponent(id)}/pembalik`, {
    method: "POST",
    body: { alasan },
    csrf: true,
  });
}

/** `YYYY-MM-DD` → label panjang KasRT (`"01 Oktober 2026"`) tanpa geser zona. */
function tanggalPanjang(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (m) return `${m[3]} ${BULAN_PANJANG[Number(m[2]) - 1]} ${m[1]}`;
  return iso;
}

/** Label kategori pada form kas FE → enum server. */
export function kategoriKasKeServer(label: string): string {
  const s = label.toLowerCase();
  if (s.includes("iuran")) return "iuran";
  if (s.includes("setoran")) return "pemasukan_lain";
  if (s.includes("honor") || s.includes("sarana") || s.includes("operasional")) return "operasional";
  if (s.includes("kegiatan")) return "kegiatan";
  if (s.includes("sosial")) return "dana_sosial";
  return "lainnya";
}

const KATEGORI_KAS_FE: Record<string, string> = {
  iuran: "Iuran Warga",
  pemasukan_lain: "Setoran Lain-lain",
  operasional: "Operasional",
  kegiatan: "Kegiatan",
  dana_sosial: "Dana Sosial",
  lainnya: "Lain-lain",
};

/** Baris server → entitas FE `KasRt` (nominal bertanda; saldo = rantai server). */
export function entriKeKasRt(e: EntriKasServer): KasRt {
  return {
    id: e.id,
    tanggal: tanggalPanjang(e.tanggal),
    keterangan: e.keterangan,
    kategori: KATEGORI_KAS_FE[e.kategori] ?? e.kategori,
    tipe: e.arah === "positif" ? "Pemasukan" : "Pengeluaran",
    nominal: e.arah === "positif" ? e.nominal : -e.nominal,
    saldo: e.saldoSesudah,
    bukti: e.buktiUrl !== null,
    // B8 — jejak jurnal: dari mana baris berasal & baris mana yang dibalik
    // (baris hasil koreksi memakai `reversalOfId` → tombol + badge di KasRT).
    sumber: e.sumber,
    reversalOfId: e.reversalOfId,
  };
}

/** Label panjang FE (`"01 Oktober 2026"`) → `YYYY-MM-DD` untuk payload POST. */
export function labelKeIso(tanggal: string): string {
  const m = /^(\d{2})\s+(\S+)\s+(\d{4})$/.exec(tanggal.trim());
  if (!m) return "";
  const idx = BULAN_PANJANG.findIndex((b) => b.toLowerCase() === m[2].toLowerCase());
  if (idx < 0) return "";
  return `${m[3]}-${String(idx + 1).padStart(2, "0")}-${m[1]}`;
}

// ===========================================================================
// DATA KELUARGA — F-6 (PRD §5.1 · task A5): baca KK milik sesi warga
// (`GET /warga/keluarga`) + simpan kontak langsung
// (`POST /warga/keluarga/:id/kontak` — deviasi terdokumentasi §5.3 atas jalur
// ajuan B11; lihat catatan deviasi spesifikasi & routes/wargaKeluarga.ts).
// ===========================================================================

/** Anggota KK dari server — NIK TIDAK PERNAH plaintext (hanya `nikMasked`). */
export interface AnggotaKeluargaServer {
  id: string;
  nama: string;
  hubungan: "kepala" | "istri" | "anak" | "lainnya";
  nikMasked: string | null;
  noHp: string | null;
  email: string | null;
  /** Kolom `@db.Date` → `"YYYY-MM-DD"`; null bila kosong. */
  tanggalLahir: string | null;
  jenisKelamin: string | null;
  pekerjaan: string | null;
  agama: string | null;
  golDarah: string | null;
  statusKawin: string | null;
  /** 4 kolom detail (F-6/bug form Edit): ikut dipilih sejak perluasan PilihAnggota. */
  tempatLahir: string | null;
  pendidikan: string | null;
  /** `"YYYY-MM-DD"`; tampilan FE memakai `tanggalPanjang` (lihat `anggotaKeFamilyMember`). */
  tanggalPerkawinan: string | null;
  wargaNegara: string | null;
  fotoUrl: string | null;
  statusAkses: string;
}

export interface KeluargaServer {
  kk: { id: string; noKk: string; kepala: string; alamat: string; jumlahAnggota: number };
  anggota: AnggotaKeluargaServer[];
  /** Status pengajuan (B11/B20) — terbaru dulu; daftar kosong = belum pernah ajukan. */
  ajuan: AjuanPerubahan[];
}

/**
 * Bentuk `GET /rt/warga.keluarga` & respons mutasi CRUD: `KeluargaServer`
 * TANPA `ajuan` (antrean ajuan RT punya rute sendiri). Keduanya memakai
 * `keluargaKeKkData()` yang sama sehingga Portal RT & Portal Warga identik.
 */
export type KeluargaRingkasServer = Omit<KeluargaServer, "ajuan">;

/** Satu-satunya field yang boleh ditulis warga via `POST /warga/keluarga/:id/kontak`. */
export interface PatchKontakKeluarga {
  /** Digit 10–13; server menormalkan ke `08xx` sebelum menyimpan. */
  noHp?: string;
  /** `""` = bersihkan surel (server menyimpan null). */
  email?: string;
  pekerjaan?: string;
  agama?: string;
  golDarah?: "A" | "B" | "AB" | "O";
  statusKawin?: "Belum Menikah" | "Menikah" | "Cerai Hidup" | "Cerai Mati";
}

/** GET /warga/keluarga — KK + anggota sesi login; galat OFFLINE → pemanggil memakai data demo. */
export function ambilKeluargaWarga(): Promise<KeluargaServer> {
  return minta("/warga/keluarga");
}

/** POST /warga/keluarga/:id/kontak — simpan kontak anggota 1 KK (wajib sesi warga). */
export function simpanKontakKeluarga(
  idAnggota: string,
  patch: PatchKontakKeluarga,
): Promise<{ anggota: AnggotaKeluargaServer }> {
  return minta(`/warga/keluarga/${encodeURIComponent(idAnggota)}/kontak`, {
    method: "POST",
    body: patch,
    csrf: true,
  });
}

// ===========================================================================
// AJUAN PERUBAHAN DATA WARGA — F-5 · B11/B20 (verifikasi resmi KK).
// ===========================================================================

/**
 * POST /warga/keluarga/ajuan — buat baris `perubahan_data_warga` (status
 * `menunggu`). `targetWargaId` wajib anggota 1 KK dengan sesi (server balas
 * 404 bila beda KK); antrean sejenis masih menunggu → 409 CONFLICT.
 * Rute warga tanpa CSRF (mengikuti rute warga lain §5.6); FE tetap kirim token.
 */
export function ajukanPerubahanKeluarga(body: {
  targetWargaId: string;
  jenis: JenisAjuan;
  namaAnggota: string;
  keterangan: string;
}): Promise<{ ajuan: AjuanPerubahan }> {
  return minta("/warga/keluarga/ajuan", { method: "POST", body, csrf: true });
}

/** GET /rt/ajuan-perubahan?status= — antrean verifikasi (wajib sesi RT). */
export function daftarAjuanPerubahanRt(status?: StatusAjuan): Promise<{ ajuan: AjuanPerubahanRt[] }> {
  return minta(`/rt/ajuan-perubahan${status ? `?status=${encodeURIComponent(status)}` : ""}`);
}

/**
 * POST /rt/ajuan-perubahan/:id/{setujui,tolak} — verifikasi 1 ajuan.
 * `tolak` mewajibkan `catatan` (alasan) di server; `setujui` opsional.
 * Respons `ulang: true` = sudah pernah diproses (idempoten, tanpa audit ganda).
 */
export function verifikasiAjuanPerubahanRt(
  id: string,
  aksi: "setujui" | "tolak",
  catatan?: string,
): Promise<{
  ulang: boolean;
  ajuan: {
    id: string;
    jenis: JenisAjuan;
    status: StatusAjuan;
    catatanVerifikasi: string | null;
    diprosesPada: string | null;
  };
}> {
  return minta(`/rt/ajuan-perubahan/${encodeURIComponent(id)}/${aksi}`, {
    method: "POST",
    body: catatan ? { catatan } : {},
    csrf: true,
  });
}

// --- Pemetaan server → tampilan FE -----------------------------------------

const HUBUNGAN_FE: Record<
  AnggotaKeluargaServer["hubungan"],
  { role: string; relation: string; filter: MemberFilter; ringColor: string }
> = {
  kepala: {
    role: "Kepala Keluarga",
    relation: "Kepala Keluarga",
    filter: "kepala",
    ringColor: "ring-primary-fixed",
  },
  istri: { role: "Istri", relation: "Istri", filter: "istri", ringColor: "ring-secondary-container" },
  anak: { role: "Anak Kandung", relation: "Anak", filter: "anak", ringColor: "ring-surface-variant" },
  lainnya: { role: "Lainnya", relation: "Lainnya", filter: "lainnya", ringColor: "ring-surface-variant" },
};

const AKSES_FE: Record<string, { statusNote: string; statusIcon: string; statusColor: string }> = {
  aktif: { statusNote: "Akun Portal Warga Aktif", statusIcon: "verified", statusColor: "text-secondary" },
  menunggu_aktivasi: { statusNote: "Menunggu Aktivasi Akun", statusIcon: "schedule", statusColor: "text-primary" },
  belum_diundang: { statusNote: "Belum Diundang ke Portal", statusIcon: "person_off", statusColor: "text-outline" },
  kedaluwarsa: { statusNote: "Undangan Kedaluwarsa", statusIcon: "timer_off", statusColor: "text-outline" },
  dinonaktifkan: { statusNote: "Akses Dinonaktifkan", statusIcon: "block", statusColor: "text-outline" },
};

function inisialDariNama(nama: string): string {
  return nama
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((kata) => kata[0]?.toUpperCase() ?? "")
    .join("");
}

/** Usia dari `"YYYY-MM-DD"` — dibandingkan kalender murni (tanpa geser zona). */
function usiaDariIso(iso: string | null): number {
  if (!iso) return 0;
  const [th, bl, hr] = iso.split("-").map(Number);
  if (!th || !bl || !hr) return 0;
  const kini = new Date();
  let usia = kini.getFullYear() - th;
  const selisihBulan = kini.getMonth() + 1 - bl;
  if (selisihBulan < 0 || (selisihBulan === 0 && kini.getDate() < hr)) usia -= 1;
  return Math.max(usia, 0);
}

/**
 * Anggota server → kartu `FamilyMember`.
 * • Golongan darah memakai konvensi display FE `"A (Rhesus +)"` (sama seperti
 *   mapper impor CSV) karena DB hanya menyimpan huruf `A/B/AB/O`;
 * • `nikFull` TIDAK PERNAH diisi untuk data API (§14/B17 — modal menampilkan
 *   `nikFull ?? nik`, jadi warga portal selalu melihat nilai ter-mask);
 * • `avatar` = `foto_url` (null → kartu memakai inisial, lihat DataKeluarga).
 */
export function anggotaKeFamilyMember(
  a: AnggotaKeluargaServer,
  anakKe?: Map<string, number>,
): FamilyMember {
  const h = HUBUNGAN_FE[a.hubungan] ?? HUBUNGAN_FE.lainnya;
  const s =
    AKSES_FE[a.statusAkses] ?? {
      statusNote: "Terverifikasi RT",
      statusIcon: "verified",
      statusColor: "text-secondary",
    };
  return {
    idWarga: a.id,
    name: a.nama,
    initials: inisialDariNama(a.nama),
    role: h.role,
    filter: h.filter,
    gender:
      a.jenisKelamin === "perempuan" ? "Perempuan" : a.jenisKelamin === "laki_laki" ? "Laki-laki" : "-",
    age: usiaDariIso(a.tanggalLahir),
    birthDate: a.tanggalLahir ? tanggalPanjang(a.tanggalLahir) : "-",
    nik: a.nikMasked ?? "",
    relation: a.hubungan === "anak" && anakKe?.has(a.id) ? `Anak ke-${anakKe.get(a.id)}` : h.relation,
    job: a.pekerjaan ?? "",
    wa: a.noHp ? memberWaValue(a.noHp) : "",
    email: a.email ?? "",
    blood: a.golDarah ? `${a.golDarah} (Rhesus +)` : "",
    agama: a.agama ?? "",
    statusPernikahan: a.statusKawin ?? "",
    statusNote: s.statusNote,
    statusIcon: s.statusIcon,
    statusColor: s.statusColor,
    avatar: a.fotoUrl ?? "",
    ringColor: h.ringColor,
    // 4 kolom detail (F-6/bug form Edit): tampilan memakai gaya panjang yang
    // sama seperti `birthDate` sehingga `tglKeIso` bisa mengisinya kembali.
    tempatLahir: a.tempatLahir ?? undefined,
    pendidikan: a.pendidikan ?? undefined,
    tglPerkawinan: a.tanggalPerkawinan ? tanggalPanjang(a.tanggalPerkawinan) : undefined,
    wargaNegara: a.wargaNegara ?? undefined,
  };
}

/** Server → `KkData` siap dipakai state App (`noKk` sudah ter-mask dari server). */
export function keluargaKeKkData(k: KeluargaRingkasServer): KkData {
  // "Anak ke-N" mengikuti tanggal lahir; dihitung ulang di sini supaya mandiri
  // terhadap urutan payload.
  const anak = k.anggota
    .filter((a) => a.hubungan === "anak" && a.tanggalLahir)
    .sort((x, y) => ((x.tanggalLahir ?? "") < (y.tanggalLahir ?? "") ? -1 : 1));
  const anakKe = new Map(anak.map((a, indeks) => [a.id, indeks + 1] as const));
  return {
    id: k.kk.id,
    noKk: k.kk.noKk,
    kepala: k.kk.kepala,
    alamat: k.kk.alamat,
    anggota: k.anggota.map((a) => anggotaKeFamilyMember(a, anakKe)),
  };
}

/**
 * Patch kontak → padanan tampilan FE. HANYA dipakai bila API `OFFLINE` (mode
 * demo): setelah sukses tersimpan, baris server yang jadi sumber utama —
 * padanan ini menjaga format WA & gol. darah identik dengan hasil reload.
 */
export function patchKontakKeFe(patch: PatchKontakKeluarga): Partial<FamilyMember> {
  return {
    ...(patch.noHp ? { wa: memberWaValue(patch.noHp) } : {}),
    ...(patch.email !== undefined ? { email: patch.email } : {}),
    ...(patch.pekerjaan !== undefined ? { job: patch.pekerjaan } : {}),
    ...(patch.agama !== undefined ? { agama: patch.agama } : {}),
    ...(patch.golDarah !== undefined ? { blood: `${patch.golDarah} (Rhesus +)` } : {}),
    ...(patch.statusKawin !== undefined ? { statusPernikahan: patch.statusKawin } : {}),
  };
}

// ===========================================================================
// CRUD DATA WARGA — B13 · spesifikasi §5.4 (Portal RT).
//   GET/POST /rt/warga · POST /rt/warga/:kkId/anggota · PATCH/DELETE /rt/warga/:id
// NIK TIDAK PERNAH plaintext (hanya `nikMasked`); No.KK dari server ter-mask.
// ===========================================================================

/** Enum `status_akses` DB (§5.4) — padanan label FE lihat `statusAksesKePortal`. */
export type StatusAksesServer =
  | "belum_diundang"
  | "menunggu_aktivasi"
  | "kedaluwarsa"
  | "aktif"
  | "dinonaktifkan";

/** Enum `hubungan` DB — label FE dikonversi `hubunganKeServer`. */
export type HubunganServer = "kepala" | "istri" | "anak" | "lainnya";

/** Satu baris `GET /rt/warga` (mentah, sebelum dipetakan ke `WargaRt`). */
export interface BarisWargaRtServer {
  id: string;
  nama: string;
  /** Hanya 8 digit pertama+terakhir (§14 — tidak pernah plaintext). */
  nikMasked: string | null;
  noHp: string | null;
  hubungan: HubunganServer;
  tempatLahir: string | null;
  /** `@db.Date` → `"YYYY-MM-DD"`. */
  tanggalLahir: string | null;
  jenisKelamin: "laki_laki" | "perempuan" | null;
  agama: string | null;
  pendidikan: string | null;
  pekerjaan: string | null;
  golDarah: "A" | "B" | "AB" | "O" | null;
  statusKawin: string | null;
  tanggalPerkawinan: string | null;
  wargaNegara: "WNI" | "WNA" | null;
  statusAkses: StatusAksesServer;
  statusDemografis: "aktif" | "meninggal" | "pindah" | "nonaktif";
  statusHuni: string | null;
  kk: { id: string; noKk: string; alamat: string; kepala: string; createdAt: string };
}

/** Anggota `POST /rt/warga` — label FE sudah dikonversi ke enum DB. */
export interface AnggotaBaruServer {
  nama: string;
  nik: string;
  hubungan: HubunganServer;
  jenisKelamin: "laki_laki" | "perempuan" | null;
  agama: string | null;
  /** `"YYYY-MM-DD"` atau null. */
  tanggalLahir: string | null;
  pekerjaan: string | null;
  /** Digit 10–13 atau null. */
  noHp: string | null;
}

export interface TambahWargaRtPayload {
  /** 16 digit angka (mentah — server memaskernya). */
  noKk: string;
  alamat: string;
  anggota: AnggotaBaruServer[];
}

/**
 * `PATCH /rt/warga/:id` — SEMUA field opsional (Zod `.partial()` + refine
 * minimal 1 field). Field bernilai `null` = bersihkan; field `undefined`
 * (tidak dikirim) = tidak diubah. `nikBaru`/`noKk` hanya nilai 16 digit mentah.
 * `statusAkses` TIDAK ada di sini: perubahan status portal hanya lewat
 * `PATCH /rt/warga/:id/akses` (server menolaknya di edit umum — cabut sesi +
 * token undangan dijalankan di satu pintu itu).
 */
export interface PatchWargaRt {
  nama?: string;
  /** 16 digit mentah; server menyimpan `nikEncrypted` + `nikMasked` baru. */
  nikBaru?: string;
  noHp?: string;
  alamat?: string;
  noKk?: string;
  hubungan?: HubunganServer;
  tempatLahir?: string | null;
  tanggalLahir?: string | null;
  jenisKelamin?: "laki_laki" | "perempuan" | null;
  agama?: string | null;
  pendidikan?: string | null;
  pekerjaan?: string | null;
  golDarah?: "A" | "B" | "AB" | "O" | null;
  statusKawin?: "Belum Menikah" | "Menikah" | "Cerai Hidup" | "Cerai Mati" | null;
  tanggalPerkawinan?: string | null;
  wargaNegara?: "WNI" | "WNA" | null;
}

/** GET /rt/warga — daftar baris warga + keluarga RT sesi (sumber kebenaran). */
export function daftarWargaRt(): Promise<{
  warga: BarisWargaRtServer[];
  keluarga: KeluargaRingkasServer[];
}> {
  return minta("/rt/warga");
}

/** POST /rt/warga — tambah 1 KK (N anggota). Gagal TIDAK menyisakan baris parsial (§5.4). */
export function tambahWargaRt(
  payload: TambahWargaRtPayload,
): Promise<{ warga: BarisWargaRtServer[]; keluarga: KeluargaRingkasServer }> {
  return minta("/rt/warga", { method: "POST", body: payload, csrf: true });
}

/**
 * POST /rt/warga/:kkId/anggota — tambah anggota ke KK YANG SUDAH ADA (Okt
 * 2026 · pintu "Tambah Anggota" menu Data Warga). No. KK & alamat TIDAK ikut
 * payload: tujuan dipegang UUID `kkId` dari `kkList`, sehingga anggota baru
 * mustahil dirujuk ke KK lain. Respons identik bentuk `tambahWargaRt`
 * (`{ warga[], keluarga }`) agar penerapan state di halaman sama.
 */
export function tambahAnggotaKk(
  kkId: string,
  anggota: AnggotaBaruServer[],
): Promise<{ warga: BarisWargaRtServer[]; keluarga: KeluargaRingkasServer }> {
  return minta(`/rt/warga/${encodeURIComponent(kkId)}/anggota`, {
    method: "POST",
    body: { anggota },
    csrf: true,
  });
}

// --- A10 · Migrasi Data (§9.1(6)) — impor CSV/XLSX warga ---------------------

/** Satu baris yang ditolak impor (nomor baris file + nama + alasan — tanpa NIK). */
export interface AlasanTolakImpor {
  nomor: number;
  nama: string;
  pesan: string;
}

/** Hasil `POST /rt/warga/import` — ringkasan + alasan penolakan per baris. */
export interface HasilImporWarga {
  id: string;
  namaFile: string;
  status: "selesai" | "gagal";
  jumlahBaris: number;
  berhasil: number;
  gagal: number;
  alasan: AlasanTolakImpor[];
}

/**
 * POST /rt/warga/import — berkas multipart (≤5 MB, `.csv`/`.xlsx`, §5.4).
 * Respons 200 walau 0 baris masuk (`status: "gagal"`) — `alasan[]` menjelaskan
 * kenapa; struktur file salah (kolom wajib hilang dll.) membalas GalatApi 400.
 */
export function imporWargaRt(file: File): Promise<HasilImporWarga> {
  const form = new FormData();
  form.append("file", file, file.name);
  return minta("/rt/warga/import", { method: "POST", body: form, csrf: true });
}

/** PATCH /rt/warga/:id — ubah sebagian (mode patch: hanya field yang dikirim). */
export function ubahWargaRt(
  id: string,
  patch: PatchWargaRt,
): Promise<{ warga: BarisWargaRtServer; keluarga: KeluargaRingkasServer }> {
  return minta(`/rt/warga/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: patch,
    csrf: true,
  });
}

/** DELETE /rt/warga/:id — hapus anggota; bila KK kosong tetap dipertahankan (§5.4). */
export function hapusWargaRt(
  id: string,
): Promise<{ id: string; keluarga: KeluargaRingkasServer | null }> {
  return minta(`/rt/warga/${encodeURIComponent(id)}`, { method: "DELETE", csrf: true });
}

// ===========================================================================
// DATA HUNIAN — §5.4 (GET/POST /rt/hunian) · PRD §6.1 (Portal RT).
// Sebelumnya unit hunian hanya state demo FE — hilang saat muat ulang, alamat
// baru tak muncul di dropdown Data Warga, dan KK di alamat itu tetap tanpa
// `rumah_id` (Status Hunian kosong + prasyarat undangan §6.3 terblokir).
// ===========================================================================

/** Satu baris `GET /rt/hunian` — `jumlahKk`/`penghuni` turunan dari KK ter-link. */
export interface HunianServer {
  id: string;
  kodeRumah: string;
  alamat: string;
  alamatPendek: string;
  statusHuni: "milik" | "sewa" | "kontrak" | "kos";
  unitKendaraanR4: number;
  jumlahKk: number;
  penghuni: string[];
}

/** GET /rt/hunian — daftar unit hunian milik RT sesi (sumber kebenaran). */
export function daftarHunianRt(): Promise<{ hunian: HunianServer[] }> {
  return minta("/rt/hunian");
}

/** Payload `POST /rt/hunian` — gabungan dua pilihan form FE sudah jadi enum. */
export interface TambahHunianRtPayload {
  kodeRumah: string;
  alamat: string;
  statusHuni: "milik" | "sewa" | "kontrak" | "kos";
  /**
   * Batch 15 (Okt 2026) · jumlah kendaraan roda 4 unit (0–99). Opsional di
   * POST (DB `@default(1)`); belum menjadi dasar generate tagihan iuran —
   * "data dulu, billing nanti" (keputusan desain 8 Okt 2026).
   */
  unitKendaraanR4?: number;
}

/**
 * POST /rt/hunian — buat 1 unit; server sekalian menautkan balik KK/warga pada
 * alamat itu yang belum punya `rumah_id` (pemulihan "proses terputus", §6.1).
 */
export function tambahHunianRt(
  payload: TambahHunianRtPayload,
): Promise<{ hunian: HunianServer }> {
  return minta("/rt/hunian", { method: "POST", body: payload, csrf: true });
}

/**
 * PATCH /rt/hunian/:id — edit SATU unit (Okt 2026 — "Edit hanya per hunian").
 * `undefined` = tidak diubah; galat `CONFLICT` bila blok/alamat kembar (di luar
 * baris sendiri). Opsi `kkTertaut` dijawab bila alamat baru menautkan KK lama.
 */
export function ubahHunianRt(
  id: string,
  patch: Partial<TambahHunianRtPayload>,
): Promise<{ hunian: HunianServer; kkTertaut?: number }> {
  return minta(`/rt/hunian/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: patch,
    csrf: true,
  });
}

/**
 * DELETE /rt/hunian/:id — hapus SATU unit. Galat `CONFLICT` (409) bila unit
 * masih menampung KK/warga — kosongkan dulu lewat Data Warga.
 */
export function hapusHunianRt(id: string): Promise<{ id: string }> {
  return minta(`/rt/hunian/${encodeURIComponent(id)}`, { method: "DELETE", csrf: true });
}

/** Hasil hapus massal: sukses parsial — per baris dilaporkan jujur. */
export interface HasilHapusHunian {
  terhapus: string[];
  tertolak: Array<{ id: string; alamat: string; alasan: string }>;
}

/**
 * DELETE /rt/hunian — hapus MASSAL `{ ids }` (Okt 2026 — "hapus >1 data
 * hunian dengan selected data"). Sukses 200 dengan hasil parsial:
 * `tertolak` berisi unit yang ditolak (mis. masih berpenghuni) beserta alasan.
 */
export function hapusBanyakHunianRt(ids: string[]): Promise<HasilHapusHunian> {
  return minta("/rt/hunian", { method: "DELETE", body: { ids }, csrf: true });
}

// ===========================================================================
// HUNIAN MILIK WARGA (Batch 15 · Okt 2026) — portal warga membaca & meng-upde
// jumlah kendaraan roda 4 huniannya sendiri (persiapan dasar iuran kendaraan).
// ===========================================================================

/** Satu baris `GET /warga/hunian` — unit rumah milik sesi warga. */
export interface HunianWargaServer {
  kodeRumah: string;
  alamat: string;
  alamatPendek: string;
  statusHuni: "milik" | "sewa" | "kontrak" | "kos";
  unitKendaraanR4: number;
}

/** GET /warga/hunian — `null` bila warga belum tertaut unit hunian. */
export function hunianWarga(): Promise<{ hunian: HunianWargaServer | null }> {
  return minta("/warga/hunian");
}

/**
 * PATCH /warga/hunian — perbarui unit kendaraan roda 4 (integer 0–99) milik
 * sesi warga; tanpa CSRF (§5.6, pola rute warga lain). Galat `CONFLICT` (409)
 * bila warga belum tertaut hunian — halaman menampilkan pesan jujur, bukan
 * sukses palsu.
 */
export function ubahKendaraanR4Warga(unitKendaraanR4: number): Promise<{ hunian: HunianWargaServer }> {
  return minta("/warga/hunian", { method: "PATCH", body: { unitKendaraanR4 } });
}

/**
 * Pemetaan dua select form FE → enum `status_huni` (PRD §6.1) — aturan
 * gabungan: jenis "Rumah Kos" → `kos`, "Rumah Sewa" → `sewa`, status
 * "Sewa/Kontrak" → `sewa`, selainnya (termasuk "Kosong") → `milik`. Status
 * "Kosong" TIDAK ada di enum — tampil diturunkan FE dari jumlah KK = 0.
 */
export function statusHuniDariForm(
  jenis: string,
  status: string,
): "milik" | "sewa" | "kontrak" | "kos" {
  if (jenis === "Rumah Kos") return "kos";
  if (jenis === "Rumah Sewa") return "sewa";
  if (status === "Sewa/Kontrak") return "sewa";
  return "milik";
}

/** Label tampilan `status_huni` (dipakai turunan status baris hunian). */
const LABEL_STATUS_HUNI: Partial<Record<HunianServer["statusHuni"], string>> = {
  milik: "Dihuni Pemilik",
  sewa: "Sewa/Kontrak",
  kontrak: "Sewa/Kontrak",
  kos: "Kos",
};

/**
 * `GET /rt/hunian` → `HunianRumah` tampilan. Turunan status dari `jumlahKk`
 * (0 = "Kosong", >1 = "Multi-KK", selain itu label `status_huni`); kolom
 * `jenis` turunan `statusHuni` — label demo "Ruko" tak punya padanan enum
 * (dicatat sebagai deviasi di laporan perbaikan).
 */
export function hunianServerKeHunian(h: HunianServer): HunianRumah {
  const status =
    h.jumlahKk === 0
      ? "Kosong"
      : h.jumlahKk > 1
        ? "Multi-KK"
        : (LABEL_STATUS_HUNI[h.statusHuni] ?? "Dihuni Pemilik");
  const jenis =
    h.statusHuni === "kos" ? "Rumah Kos" : h.statusHuni === "sewa" || h.statusHuni === "kontrak" ? "Rumah Sewa" : "Rumah Tinggal";
  return {
    id: h.id,
    blok: h.kodeRumah,
    alamat: h.alamat,
    jenis,
    status,
    kkTerdaftar: h.jumlahKk,
    penghuni: h.penghuni,
    unitKendaraanR4: h.unitKendaraanR4,
  };
}

// --- Konversi label FE ↔ enum DB (kamus PRD §13: label Indonesia di UI) -------

const STATUS_AKSES_KE_PORTAL: Partial<Record<StatusAksesServer, string>> = {
  aktif: "Aktif",
  belum_diundang: "Belum Aktif",
  menunggu_aktivasi: "Undangan Dikirim",
  kedaluwarsa: "Kedaluwarsa",
  dinonaktifkan: "Dinonaktifkan",
};

const PORTAL_KE_STATUS_AKSES: Partial<Record<string, StatusAksesServer>> = {
  Aktif: "aktif",
  "Belum Aktif": "belum_diundang",
  "Undangan Dikirim": "menunggu_aktivasi",
  Kedaluwarsa: "kedaluwarsa",
  Dinonaktifkan: "dinonaktifkan",
};

/** Enum `status_akses` → label pill/selector FE (`"Undangan Dikirim"` dsb.). */
export function statusAksesKePortal(v: string): string {
  return STATUS_AKSES_KE_PORTAL[v as StatusAksesServer] ?? "Belum Aktif";
}

/** Label portal FE → enum `status_akses`; nilai tak dikenal → `belum_diundang`. */
export function portalKeStatusAkses(label: string): StatusAksesServer {
  return PORTAL_KE_STATUS_AKSES[label] ?? "belum_diundang";
}

/** Label hubungan FE ("Kepala Keluarga", "Ayah / Ibu", …) → enum `hubungan`. */
export function hubunganKeServer(label: string): HubunganServer {
  const s = label.trim().toLowerCase();
  if (s.startsWith("kepala")) return "kepala";
  if (s.startsWith("istri")) return "istri";
  if (s.startsWith("anak")) return "anak";
  return "lainnya";
}

/** Label gender FE ("Laki-laki"/"Perempuan") → enum; kosong/tak dikenal → null. */
export function jenisKelaminKeServer(
  label: string | null | undefined,
): "laki_laki" | "perempuan" | null {
  const s = (label ?? "").trim().toLowerCase().replace(/[-\s]/g, "");
  if (s === "lakilaki") return "laki_laki";
  if (s === "perempuan") return "perempuan";
  return null;
}

/** Gol. darah FE ("A (Rhesus +)" dsb.) → enum `gol_darah` (huruf saja). */
export function golDarahKeServer(v: string | null | undefined): "A" | "B" | "AB" | "O" | null {
  const s = (v ?? "")
    .replace(/\s*\(rhesus[^)]*\)/gi, "")
    .trim()
    .toUpperCase();
  return s === "A" || s === "B" || s === "AB" || s === "O" ? s : null;
}

/** Status kawin FE → enum CHECK DB; nilai di luar kamus → null. */
export function statusKawinKeServer(
  v: string | null | undefined,
): "Belum Menikah" | "Menikah" | "Cerai Hidup" | "Cerai Mati" | null {
  const s = (v ?? "").trim();
  return s === "Belum Menikah" ||
    s === "Menikah" ||
    s === "Cerai Hidup" ||
    s === "Cerai Mati"
    ? s
    : null;
}

/** Warga negara FE → enum; kosong/tak dikenal → null. */
export function wargaNegaraKeServer(v: string | null | undefined): "WNI" | "WNA" | null {
  const s = (v ?? "").trim().toUpperCase();
  return s === "WNI" || s === "WNA" ? s : null;
}

/**
 * Hasil konversi enum untuk payload PATCH: nilai valid → kirim; nilai kosong →
 * `null` (bersihkan di server); nilai tak dikenal → `undefined` (TIDAK dikirim —
 * mencegah mengosongkan data lama yang tidak bisa direpresentasikan).
 */
export function enumAman<T>(
  nilai: string | null | undefined,
  hasil: T | null,
): T | null | undefined {
  const s = (nilai ?? "").trim();
  if (hasil !== null) return hasil;
  return s === "" ? null : undefined;
}

const HUNI_KE_STATUS: Partial<Record<string, string>> = {
  milik: "Warga",
  sewa: "Penyewa",
  kontrak: "Kontrak",
  kos: "Kos",
};

function labelJenisKelamin(v: string | null): string {
  if (v === "laki_laki") return "Laki-laki";
  if (v === "perempuan") return "Perempuan";
  return v ?? "";
}

/**
 * Satu baris `GET /rt/warga` → `WargaRt` tampilan.
 * • `idWarga` = UUID baris `warga` — kunci pencocokan `linkFor`/`gabungDaftarWarga`
 *   (NIK ter-mask 8 digit TIDAK bisa dipakai mencocokkan);
 * • tanggal → gaya panjang (`tglKeIso` mengisinya kembali untuk form Edit);
 * • NIK/No.KK tetap nilai ter-mask dari server.
 */
export function barisServerKeWargaRt(b: BarisWargaRtServer): WargaRt {
  const portal = statusAksesKePortal(b.statusAkses);
  const hubungan =
    (HUBUNGAN_FE[b.hubungan] ?? HUBUNGAN_FE.lainnya).relation;
  return {
    id: b.id,
    idWarga: b.id,
    nama: b.nama,
    nik: b.nikMasked ?? "",
    noKk: b.kk.noKk,
    alamat: shortAlamat(b.kk.alamat),
    statusPortal: portal,
    statusBadge: badgePortal(portal),
    noWa: b.noHp ? fmtWa(digitsOnly(b.noHp)) : "",
    status: (b.statusHuni && HUNI_KE_STATUS[b.statusHuni]) || "Warga",
    statusColor: "text-on-surface-variant",
    tempatLahir: b.tempatLahir ?? "",
    tglLahir: b.tanggalLahir ? isoKeTgl(b.tanggalLahir) : "",
    jenisKelamin: labelJenisKelamin(b.jenisKelamin),
    agama: b.agama ?? "",
    pendidikan: b.pendidikan ?? "",
    pekerjaan: b.pekerjaan ?? "",
    goldarah: b.golDarah ?? "",
    statusKawin: b.statusKawin ?? "",
    tglKawin: b.tanggalPerkawinan ? isoKeTgl(b.tanggalPerkawinan) : "",
    hubungan,
    wargaNegara: b.wargaNegara ?? "",
    // Batch 14 — dasar KPI Data Warga: pendaftaran KK (ISO) & status demografis.
    kkCreatedAt: b.kk.createdAt,
    statusDemografis: b.statusDemografis,
  };
}

// ---------------------------------------------------------------------------
// B12 · persuratan resmi & verifikasi QR (§6.6 · §5.3 · §5.7)
// ---------------------------------------------------------------------------

/** B12 — `GET/PATCH /rt/pengaturan` (whitelist server: kop + profil visual + profil RT). */
export interface PengaturanSuratRt {
  /** Kop tersimpan; `null` = RT belum pernah mengisi (FE memakai `kopSuratDefault`). */
  kop: KopSurat | null;
  bannerUrl: string | null;
  stempelUrl: string | null;
  kopSuratUrl: string | null;
  notifikasiWaEnabled: boolean;
  modePemeliharaan: boolean;
  /**
   * Profil RT dari baris `rt` (kontrak §5.4): `namaRt` = kolom `perumahan`
   * (nama komplek), `alamat` = alamat lengkap. Kosong (`""`) bila belum diisi.
   */
  profil: { namaRt: string; alamat: string };
}

/** B12 — satu baris daftar surat (`jsonSurat` server; enum status dipertahankan mentah). */
export interface BarisSuratServer {
  id: string;
  noSurat: string;
  jenis: string;
  kodeJenis: string;
  pemohon: string;
  keperluan: string;
  status: StatusSuratServer;
  perluRw: boolean;
  catatan: string | null;
  /** Token QR `/q/:token` — selalu terisi (kolom NOT NULL, dibuat server). */
  qrToken: string;
  noKk: string;
  /** ISO 8601 — `diajukanPada` bila ada, selain itu `createdAt`. */
  diajukanPada: string;
  terbitPada: string | null;
  /**
   * Batch 9 — metadata lampiran pengajuan (≤3, 5 MB/berkas). Nama berkas
   * tersimpan server TIDAK pernah dikirim — unduhan murni lewat indeks
   * `…/lampiran/:idx` (`tautanLampiranSurat`); `tipe` dihitung server dari
   * ekstensi tersimpan (bukan MIME yang diklaim klien).
   */
  lampiran: { nama: string; tipe: string; ukuran: number }[];
}

/**
 * B12 — hasil `GET /publik/verifikasi-surat/:qrToken`. Server SELALU menjawab
 * 200 dengan `{ valid }` agar endpoint tidak dipakai untuk enumerasi token;
 * `surat` hanya ada saat `valid: true` (tanpa NIK/keperluan — data minim yang
 * cukup untuk membuktikan keaslian di pihak ketiga).
 */
export interface HasilVerifikasiSurat {
  valid: boolean;
  alasan?: string;
  surat?: {
    noSurat: string;
    jenis: string;
    kodeJenis: string;
    status: StatusSuratServer;
    perluRw: boolean;
    pemohon: string;
    diajukanPada: string | null;
    terbitPada: string | null;
    rt: { kodeRt: string; kodeRw: string; perumahan: string | null; kelurahan: string };
  };
}

/** B12 — baca kop + profil visual surat RT (wajib sesi pengurus). */
export function pengaturanSuratRt(): Promise<PengaturanSuratRt> {
  return minta("/rt/pengaturan");
}

/** B12 — simpan kop/profil surat + profil RT (parsial, wajib CSRF) → nilai sesudah. */
export function simpanPengaturanSuratRt(patch: {
  kop?: Partial<KopSurat>;
  bannerUrl?: string | null;
  stempelUrl?: string | null;
  kopSuratUrl?: string | null;
  notifikasiWaEnabled?: boolean;
  modePemeliharaan?: boolean;
  /** Profil RT — kirim `namaRt` & `alamat` lengkap (satu unit form). */
  profil?: { namaRt: string; alamat: string };
}): Promise<PengaturanSuratRt> {
  return minta("/rt/pengaturan", { method: "PATCH", body: patch, csrf: true });
}

/** B12 — antrian/arsip persuratan RT; `status` dihilangkan = seluruh status. */
export function daftarSuratRt(status?: StatusSuratServer): Promise<{ surat: BarisSuratServer[] }> {
  return minta(status ? `/rt/surat?status=${encodeURIComponent(status)}` : "/rt/surat");
}

/**
 * B12 — buat baris surat atas permintaan warga yang datang langsung
 * (deviasi terdokumentasi §5.4 — lihat kepala `routes/rtSurat.ts`).
 * Nomor wajib dikirim FE (`noSuratOtomatis`) supaya idempoten per RT.
 */
export function buatSuratRt(payload: {
  jenis: string;
  keperluan: string;
  noSurat: string;
  pemohon?: string;
  wargaId?: string;
}): Promise<{ surat: BarisSuratServer }> {
  return minta("/rt/surat", { method: "POST", body: payload, csrf: true });
}

/** Empat aksi persuratan Portal RT — semuanya POST + CSRF (§5.6). */
export type AksiSuratRt = "terbitkan" | "setujui" | "tolak" | "minta-perbaikan";

/**
 * B12 — jalankan satu aksi persuratan. `catatan` wajib untuk `tolak` (zod
 * min. 3), opsional untuk `minta-perbaikan`, diabaikan dua aksi lainnya.
 * `ulang: true` = baris sudah dalam status tujuan (idempoten, tanpa audit ganda).
 */
export function prosesSuratRt(
  id: string,
  aksi: AksiSuratRt,
  catatan?: string,
): Promise<{ ulang: boolean; surat: BarisSuratServer }> {
  return minta(`/rt/surat/${encodeURIComponent(id)}/${aksi}`, {
    method: "POST",
    body: catatan ? { catatan } : {},
    csrf: true,
  });
}

/** B12 — daftar surat MILIK sesi warga + kop surat RT (untuk preview/unduh PDF). */
export function suratWarga(status?: StatusSuratServer): Promise<{
  kop: KopSurat | null;
  surat: BarisSuratServer[];
}> {
  return minta(status ? `/warga/surat?status=${encodeURIComponent(status)}` : "/warga/surat");
}

/**
 * B12 — ajukan surat dari Portal Warga; TANPA CSRF mengikuti seluruh rute warga.
 *
 * Batch 9 — bila ada lampiran dikirim sebagai `multipart/form-data` (field teks
 * + berkas, ≤3 · 5 MB/berkas, divalidasi lagi di server); tanpa lampiran tetap
 * JSON seperti semula (jalur lama tak berubah).
 */
export function ajukanSuratWarga(
  payload: { jenis: string; keperluan: string; noSurat?: string },
  lampiran?: File[],
): Promise<{ surat: BarisSuratServer }> {
  if (!lampiran?.length) return minta("/warga/surat", { method: "POST", body: payload });
  const form = new FormData();
  form.append("jenis", payload.jenis);
  form.append("keperluan", payload.keperluan);
  if (payload.noSurat) form.append("noSurat", payload.noSurat);
  for (const f of lampiran) form.append("lampiran", f, f.name);
  return minta("/warga/surat", { method: "POST", body: form });
}

/**
 * Batch 9 — tautan unduh lampiran (endpoint memakai cookie sesi; tidak ada
 * token di URL). `idx` = indeks baris metadata di server, bukan path berkas
 * (klien tak pernah menentukan path — anti path traversal).
 */
export function tautanLampiranSurat(
  serverId: string | undefined,
  idx: number,
  portal: "rt" | "warga",
): string | null {
  if (!serverId) return null;
  const basis = portal === "rt" ? "/rt/surat" : "/warga/surat";
  return `${PREFIX_API}${basis}/${encodeURIComponent(serverId)}/lampiran/${idx}`;
}

/** B12 — cek keaslian surat lewat QR (PUBLIK, tanpa sesi, selalu 200). */
export function verifikasiSuratPublik(qrToken: string): Promise<HasilVerifikasiSurat> {
  return minta(`/publik/verifikasi-surat/${encodeURIComponent(qrToken)}`);
}

/**
 * B12 — baris server → row `Surat` FE. `serverId` diisi agar aksi berikutnya
 * tahu baris ini punya representasi di DB; tanggal & status memakai label
 * Indonesia yang sama dengan baris demo.
 */
export function barisSuratServerKeFe(b: BarisSuratServer): Surat {
  return {
    id: b.id,
    serverId: b.id,
    noSurat: b.noSurat,
    jenis: b.jenis,
    pemohon: b.pemohon,
    keperluan: b.keperluan,
    tanggal: tanggalPanjang(b.diajukanPada),
    status: labelStatusSurat[b.status] ?? "Draft",
    perluRw: b.perluRw,
    ...(b.catatan ? { catatan: b.catatan } : {}),
    qrToken: b.qrToken,
    noKk: b.noKk,
    // Batch 9 — `berkas` (nama tersimpan server) sengaja tidak dibawa ke FE;
    // klien hanya butuh `idx` untuk tautan unduh `…/lampiran/:idx`.
    lampiran: (b.lampiran ?? []).map((l, idx) => ({
      nama: l.nama,
      ukuran: l.ukuran,
      tipe: l.tipe,
      idx,
    })),
  };
}
