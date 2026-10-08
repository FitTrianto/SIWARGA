// State & tipe yang dibagikan antara Portal Warga dan Portal RT.
// Sumber kebenaran tunggal untuk data yang harus sinkron dua arah.
import { generateNoSurat, tenant } from "./tenant";
import { pathTanpaDasar } from "./deploy";

// ===========================================================================
// TIPE KK/WARGA — sebelumnya lokal di PortalWarga/DataKeluarga.
// Dipindah ke sini agar seluruh portal memakai tipe & data yang sama.
// ===========================================================================
export type MemberFilter = "all" | "kepala" | "istri" | "anak" | "lainnya";

export interface FamilyMember {
  name: string;
  initials: string;
  role: string;
  filter: MemberFilter;
  gender: string;
  age: number;
  birthDate: string;
  nik: string;
  /**
   * NIK plaintext HANYA untuk data demo; anggota yang datang dari API tidak
   * pernah memilikinya (§14/B17 — portal warga selalu ter-mask). Modal NIK
   * memakai `nikFull ?? nik` sehingga ketiadaannya tetap tampil jujur.
   */
  nikFull?: string;
  relation: string;
  job: string;
  wa: string;
  email: string;
  blood: string;
  agama: string;
  statusPernikahan: string;
  statusNote: string;
  statusIcon: string;
  statusColor: string;
  avatar: string;
  ringColor: string;
  /** UUID baris `warga` dari API — kunci simpan kontak (F-6); anggota demo/ketik-lokal tidak punya. */
  idWarga?: string;
  // ---------------------------------------------------------------------------
  // Data KK lengkap yang bisa diperbaiki Pengurus RT (Data Warga → Edit).
  // Semua opsional agar data lama tetap valid.
  // ---------------------------------------------------------------------------
  /** Tempat lahir ("Jakarta"). */
  tempatLahir?: string;
  /** Pendidikan terakhir ("S1"). */
  pendidikan?: string;
  /** Tanggal perkawinan ("12 April 1998"). */
  tglPerkawinan?: string;
  /** Kewarganegaraan ("WNI"). */
  wargaNegara?: string;
}

export interface KkData {
  id: string;
  noKk: string;
  kepala: string;
  alamat: string;
  anggota: FamilyMember[];
}

// ===========================================================================
// AJUAN PERUBAHAN DATA WARGA — F-5 · B11/B20 (verifikasi resmi KK).
// Nilai enum persis dengan DB (`JenisPerubahan`, `StatusVerifikasi`); label
// disusun di sini supaya Portal Warga dan Portal RT selalu menampilkan teks
// yang sama.
// ===========================================================================
export type JenisAjuan = "perubahan_kk" | "tambah_anggota" | "kontak" | "sensitif";
export type StatusAjuan = "menunggu" | "disetujui" | "ditolak";

/** Satu ajuan di panel "Status Pengajuan" Portal Warga (`GET /warga/keluarga`). */
export interface AjuanPerubahan {
  id: string;
  jenis: JenisAjuan;
  status: StatusAjuan;
  /** Nama anggota tujuan ajuan (teks bebas dari form; bukan NIK). */
  namaAnggota: string | null;
  keterangan: string | null;
  catatanVerifikasi: string | null;
  /** ISO 8601 dari server; `""` untuk baris lokal (mode demo/OFFLINE). */
  diajukanPada: string;
  diprosesPada: string | null;
}

/** Satu baris antrean RT (`GET /rt/ajuan-perubahan`) — subjek + KK-nya. */
export interface AjuanPerubahanRt {
  id: string;
  jenis: JenisAjuan;
  status: StatusAjuan;
  namaWarga: string;
  hubungan: string;
  alamat: string;
  kepala: string;
  pengajuNama: string | null;
  namaAnggota: string | null;
  keterangan: string | null;
  catatanVerifikasi: string | null;
  diajukanPada: string;
  diprosesPada: string | null;
}

export const LABEL_JENIS_AJUAN: Record<JenisAjuan, string> = {
  tambah_anggota: "Penambahan Anggota Baru",
  perubahan_kk: "Perubahan Data KK",
  kontak: "Pembaruan Kontak / Pekerjaan",
  sensitif: "Koreksi Data Sensitif (NIK)",
};

export const LABEL_STATUS_AJUAN: Record<StatusAjuan, string> = {
  menunggu: "Menunggu Verifikasi",
  disetujui: "Disetujui RT",
  ditolak: "Ditolak RT",
};

/**
 * Tampilan chip status — dipakai kedua portal; ikon & warna identik dengan
 * riwayat ajuan lama agar tidak ada perubahan visual yang tak diperlukan.
 */
export const KIRI_AJUAN: Record<StatusAjuan, { icon: string; kelas: string }> = {
  menunggu: { icon: "schedule", kelas: "bg-surface-container-highest text-on-surface-variant" },
  disetujui: { icon: "check_circle", kelas: "bg-secondary-container text-on-secondary-fixed-variant" },
  ditolak: { icon: "cancel", kelas: "bg-error-container/50 text-on-error-container" },
};

/** Data demo (mode OFFLINE) — riwayat ajuan yang dulu ditulis langsung di halaman. */
export const ajuanPerubahanDefault: AjuanPerubahan[] = [
  {
    id: "aj-demo-1",
    jenis: "tambah_anggota",
    status: "menunggu",
    namaAnggota: "Bayi Baru Lahir",
    keterangan: "Surat keterangan lahir dari rumah sakit rujukan menunggu verifikasi fisik saat rapat warga.",
    catatanVerifikasi: "Menunggu verifikasi fisik surat keterangan lahir dari rumah sakit rujukan saat rapat warga.",
    diajukanPada: "2026-09-28T07:20:00.000Z",
    diprosesPada: null,
  },
  {
    id: "aj-demo-2",
    jenis: "sensitif",
    status: "disetujui",
    namaAnggota: "Anisa Supriyanto",
    keterangan: "Penyesuaian e-KTP Pemula 17 tahun — resi rekam Disdukcapil dilampirkan.",
    catatanVerifikasi: "Data akta kelahiran & resi rekam e-KTP tervalidasi lengkap. Dokumen DKB diupdate.",
    diajukanPada: "2026-09-10T02:00:00.000Z",
    diprosesPada: "2026-09-12T03:00:00.000Z",
  },
];

// ===========================================================================
// PERIODE PENAGIHAN BERJALAN — dipakai tagihan RT & pembayaran warga
// supaya status selalu match antar portal (jangan pakai label paket).
// ===========================================================================
export const PERIODE_AKTIF = "Oktober 2026";

// ---------------------------------------------------------------------------
// Iuran: kategori & nominal dikelola Pengurus RT (PRD §6.4.1), tampil di
// Portal Warga. Nilai `tipe` & `sifat` memakai KAMUS YANG SAMA dengan enum
// database (`tipe_tarif` = flat | per_unit | insidental,
// `wajib_opsional` = wajib | opsional) supaya seed backend, API F-3, dan form
// "Atur Kategori Iuran" di Portal RT selalu sepadan (Keputusan B).
// ---------------------------------------------------------------------------
export type TipeTarif = "flat" | "per_unit" | "insidental";
export type SifatIuran = "wajib" | "opsional";

export interface KategoriIuran {
  id: string;
  nama: string;
  nominal: number;
  /** flat = nominal tetap per rumah · per_unit = × unit R4 · insidental = tagih manual. */
  tipe: TipeTarif;
  /** wajib = ditagihkan otomatis · opsional = hanya bila warga punya profil/unit. */
  sifat: SifatIuran;
  /** Urutan tampil di form & daftar (seed mengisi 1..n; kategori baru = terakhir). */
  urutan: number;
  /** false = dinonaktifkan — PRD §6.4.1 memakai "menonaktifkan", bukan hapus fisik. */
  statusAktif: boolean;
}

/** Label Bahasa Indonesia untuk ketiga nilai enum `tipe_tarif`. */
export const tipeTarifLabel: Record<TipeTarif, string> = {
  flat: "Flat per rumah",
  per_unit: "Per unit R4",
  insidental: "Insidental (manual)",
};

export const tipeTarifOpsi: TipeTarif[] = ["flat", "per_unit", "insidental"];

/** Label & urutan opsi sifat di form kategori iuran. */
export const sifatIuranLabel: Record<SifatIuran, string> = { wajib: "Wajib", opsional: "Opsional" };

export const sifatIuranOpsi: SifatIuran[] = ["wajib", "opsional"];

/** Kategori awal — identik dengan `KATEGORI_SEED` di `packages/server/prisma/seed.ts`. */
export const kategoriIuranDefault: KategoriIuran[] = [
  { id: "keamanan", nama: "Keamanan & Pos Ronda", nominal: 50000, tipe: "flat", sifat: "wajib", urutan: 1, statusAktif: true },
  { id: "kebersihan", nama: "Kebersihan & Lingkungan", nominal: 45000, tipe: "flat", sifat: "wajib", urutan: 2, statusAktif: true },
  { id: "sosial", nama: "Dana Sosial & Kematian", nominal: 25000, tipe: "flat", sifat: "wajib", urutan: 3, statusAktif: true },
  { id: "r4", nama: "Kendaraan R4 (per unit)", nominal: 25000, tipe: "per_unit", sifat: "opsional", urutan: 4, statusAktif: true },
];

/**
 * Kategori yang masih aktif, terurut `urutan` — dasar tampilan daftar kategori.
 * Tidak mengganti `[]` dengan default: pemanggil yang ingin fallback sudah
 * memakai `kategoriIuranDefault` sendiri (perilaku lama dipertahankan).
 */
export function kategoriAktif(kategori: KategoriIuran[]): KategoriIuran[] {
  return kategori.filter((k) => k.statusAktif).sort((a, b) => a.urutan - b.urutan);
}

/**
 * Kategori yang ditagihkan otomatis tiap bulan (PRD §6.4.3):
 *   • `wajib` + bukan insidental → selalu;
 *   • `per_unit` → ikut meski opsional, karena nominalnya ikut jumlah unit warga
 *     (unit 0 = Rp 0, otomatis tidak tertagih);
 *   • `insidental` → tidak pernah otomatis, ditambah manual oleh Bendahara.
 * Kategori nonaktif tidak pernah ditagihkan.
 */
export function kategoriTagihan(kategori: KategoriIuran[]): KategoriIuran[] {
  return kategoriAktif(kategori).filter(
    (k) => k.tipe !== "insidental" && (k.sifat === "wajib" || k.tipe === "per_unit")
  );
}

/** Total iuran bulanan sebuah rumah = item wajib + item per_unit × unit R4. */
export function hitungIuranBulanan(kategori: KategoriIuran[], r4Count: number): number {
  return kategoriTagihan(kategori).reduce(
    (sum, k) => sum + (k.tipe === "per_unit" ? k.nominal * Math.max(r4Count, 0) : k.nominal),
    0
  );
}

/**
 * Deskripsi iuran untuk tampilan (kolom "Deskripsi" di riwayat pembayaran dan
 * chip/pill di dashboard Portal Warga): nama kategori pokok (bagian sebelum "&")
 * + Kendaraan R4 bila unitnya terdaftar. Contoh: "Keamanan, Kebersihan, Dana
 * Sosial, Kendaraan R4" — mengikuti kategori yang dikonfigurasi Pengurus RT.
 */
export function deskripsiIuran(
  kategori: KategoriIuran[],
  r4Count: number,
  pemisah = ", "
): string {
  const kat = kategori.length > 0 ? kategori : kategoriIuranDefault;
  const bagian = kategoriTagihan(kat)
    .filter((k) => k.tipe !== "per_unit" || r4Count > 0)
    .map((k) => (k.tipe === "per_unit" ? "Kendaraan R4" : k.nama.split(" & ")[0].trim()));
  return bagian.length > 0 ? bagian.join(pemisah) : "Iuran Bulanan";
}

// ---------------------------------------------------------------------------
// Pembayaran: diajukan warga → diverifikasi Pengurus RT → status terbit
// di kedua portal.
// ---------------------------------------------------------------------------
export type StatusPembayaran = "Lunas" | "Menunggu Verifikasi" | "Ditolak";

export interface Pembayaran {
  id: string;
  /** Iuran berdasarkan alamat rumah, bukan KK. */
  alamat: string;
  nama: string;
  /** Selalu PERIODE_AKTIF untuk tagihan berjalan — kunci pencocokan status. */
  periode: string;
  /** Label paket durasi ("1 Bulan", "3 Bulan") — hanya untuk tampilan riwayat. */
  paket?: string;
  jumlah: number;
  metode: string;
  metodeIcon: string;
  tanggal: string;
  status: StatusPembayaran;
}

/** Ambil alamat pendek ("Blok B4 No. 12") dari alamat lengkap untuk pencocokan. */
export function shortAlamat(alamat: string): string {
  return alamat.split(",")[0].trim();
}

export const pembayaranDefault: Pembayaran[] = [
  {
    id: "pay-1", alamat: "Blok B4 No. 12", nama: "Bambang Supriyanto",
    periode: "Oktober 2026", jumlah: 145000, metode: "QRIS", metodeIcon: "qr_code_2",
    tanggal: "16 Sep 2026", status: "Menunggu Verifikasi",
  },
  {
    id: "pay-2", alamat: "Blok A1 No. 1", nama: "Rahmat Hidayat",
    periode: "Oktober 2026", jumlah: 145000, metode: "Transfer Bank", metodeIcon: "account_balance",
    tanggal: "17 Sep 2026", status: "Menunggu Verifikasi",
  },
  {
    id: "pay-3", alamat: "Blok A1 No. 1", nama: "Rahmat Hidayat",
    periode: "September 2026", jumlah: 145000, metode: "Tunai", metodeIcon: "payments",
    tanggal: "05 Sep 2026", status: "Lunas",
  },
];

// ---------------------------------------------------------------------------
// Pengurus RT: dapat dikelola admin pengurus (Pengaturan), termasuk TTD digital.
// ---------------------------------------------------------------------------
export interface Pengurus {
  id: string;
  nama: string;
  jabatan: string;
  status: string;
  initials: string;
  bgColor: string;
  textColor: string;
  /** Data-URL hasil unggah TTD digital (PNG/JPG/SVG). */
  ttd?: string;
}

export const pengurusDefault: Pengurus[] = [
  { id: "p1", nama: "Bpk. Joko Santoso", jabatan: "Ketua RT", status: "active", initials: "JS", bgColor: "bg-primary-container", textColor: "text-on-primary-container" },
  { id: "p2", nama: "Rahmat Hidayat", jabatan: "Sekretaris", status: "active", initials: "RH", bgColor: "bg-secondary-container", textColor: "text-on-secondary-container" },
  { id: "p3", nama: "Hj. Siti Rahmawati", jabatan: "Bendahara", status: "active", initials: "SR", bgColor: "bg-tertiary-container", textColor: "text-on-tertiary-container" },
];

// ---------------------------------------------------------------------------
// Langganan: lisensi Profil + masa aktif + perpanjangan via QRIS.
// ---------------------------------------------------------------------------
export type PaketLangganan = "Free" | "Pro" | "Max";

export interface Langganan {
  paket: PaketLangganan;
  mulai: string;
  aktifSampai: string;
}

export const langgananDefault: Langganan = {
  paket: "Pro",
  mulai: "01 Okt 2025",
  aktifSampai: "30 Sep 2026",
};

export const paketInfo: Record<PaketLangganan, { harga: number; per: string; fitur: string[] }> = {
  Free: {
    harga: 0,
    per: "selamanya",
    fitur: ["Maks. 30 KK", "Dashboard dasar", "Iuran manual"],
  },
  Pro: {
    harga: 99000,
    per: "tahun",
    fitur: ["KK tanpa batas", "Verifikasi iuran QRIS", "Laporan & audit log"],
  },
  Max: {
    harga: 249000,
    per: "tahun",
    fitur: ["Semua fitur Pro", "Multi-RW & agregasi", "Prioritas dukungan"],
  },
};

// ---------------------------------------------------------------------------
// Helper util
// ---------------------------------------------------------------------------
export function formatRupiah(n: number): string {
  return `Rp ${n.toLocaleString("id-ID")}`;
}

export function downloadText(filename: string, content: string, mime = "text/csv;charset=utf-8") {
  const blob = new Blob(["\ufeff" + content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const BULAN_PENDEK = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

function tglPendek(d: Date): string {
  return `${String(d.getDate()).padStart(2, "0")} ${BULAN_PENDEK[d.getMonth()]} ${d.getFullYear()}`;
}

/** "24 Sep 2026" */
export function hariIni(): string {
  return tglPendek(new Date());
}

/** "24 Sep 2026, 14:05" */
export function waktuSekarang(): string {
  const d = new Date();
  return `${tglPendek(d)}, ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Tanggal + n hari, format "01 Okt 2026". */
export function tanggalPlusHari(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return tglPendek(d);
}

// ===========================================================================
// SURAT — state bersama Warga ↔ RT ↔ RW (sinkron status, §7.4)
// ===========================================================================
export type StatusSurat =
  | "Draft"
  | "Menunggu RT"
  | "Menunggu RW"
  | "Disetujui"
  | "Ditolak"
  | "Perlu Perbaikan";

/**
 * Batch 9 — satu lampiran pengajuan surat (deviasi §5.3: metadata disimpan di
 * kolom JSON `surat.data_pengajuan.lampiran`, tanpa migrasi skema).
 *
 *   `nama`  nama asli berkas dari pengunggah (tampilan & unduhan)
 *   `ukuran` byte · `tipe` konten-tipe hasil hitungan ekstensi SERVER
 *   `idx`   nomor urut unduhan `GET …/lampiran/:idx` (server menyimpan nama
 *           berkas tersimpan terpisah — path tak pernah dikirim ke klien)
 */
export interface LampiranSurat {
  nama: string;
  ukuran: number;
  tipe: string;
  /** Indeks baris pada metadata lampiran — dipakai membangun tautan unduh. */
  idx: number;
}

/** Format ukuran berkas ramah (KB/MB) — dipakai daftar lampiran surat. */
export function ukuranBerkas(ukuran: number): string {
  if (ukuran >= 1024 * 1024) return `${(ukuran / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(ukuran / 1024))} KB`;
}

export interface Surat {
  id: string;
  noSurat: string; // "" bila belum diterbitkan RT
  jenis: string;
  pemohon: string;
  keperluan: string;
  tanggal: string; // "01 September 2026"
  status: StatusSurat;
  /**
   * Batch 9 — lampiran pengajuan (≤3 berkas, 5 MB/berkas). Selalu ada (boleh
   * `[]`) untuk baris server; baris demo/offline juga `[]` (mode demo tidak
   * menyimpan berkas — diberi tahu jujur lewat flash saat pengajuan).
   */
  lampiran?: LampiranSurat[];
  /** Jenis surat yang butuh persetujuan tingkat RW sebelum terbit final. */
  perluRw: boolean;
  /** Catatan dari RT (penolakan/perbaikan). */
  catatan?: string;
  /** Catatan verifikasi RW. */
  catatanRw?: string;
  /** No. KK pemilik surat — untuk menyaring surat milik warga yang login. */
  noKk?: string;
  /**
   * B12 — UUID baris `surat` pada server. Baris demo / mode OFFLINE tidak
   * memilikinya; keberadaannya membedakan "perlu diproses lewat API" vs
   * "cukup ditangani lokal" pada aksi terbit/tolak/perbaikan.
   */
  serverId?: string;
  /**
   * B12 — token QR verifikasi (`/q/<token>`) yang ditanam server saat baris
   * dibuat. Baris demo tidak punya → PDF-nya tetap terbit namun tautan QR
   * dijawab `valid: false` oleh endpoint publik (verifikasi tidak pernah
   * dipalsukan, lihat `lib/pdfSurat.ts`).
   */
  qrToken?: string;
}

// ===========================================================================
// B12 · PERSURATAN RESMI — status server, kop surat & token QR (§6.6)
// ===========================================================================
/**
 * Enam status enum `StatusSurat` pada DB. Label Indonesia untuk UI disusun di
 * sini (`labelStatusSurat`) supaya Portal Warga, Portal RT, dan Portal RW
 * selalu menampilkan teks yang sama untuk baris yang sama.
 */
export type StatusSuratServer =
  | "draft"
  | "menunggu_rt"
  | "menunggu_rw"
  | "disetujui"
  | "ditolak"
  | "perlu_perbaikan";

/** Enum server → label FE (`"Menunggu RT"`, `"Disetujui"`, …). */
export const labelStatusSurat: Record<StatusSuratServer, StatusSurat> = {
  draft: "Draft",
  menunggu_rt: "Menunggu RT",
  menunggu_rw: "Menunggu RW",
  disetujui: "Disetujui",
  ditolak: "Ditolak",
  perlu_perbaikan: "Perlu Perbaikan",
};

/**
 * B12 — tiga baris kop surat resmi. Disimpan server pada
 * `pengaturan_rt.template_surat.kop` (JSON) dan ikut dalam respons
 * `GET /rt/pengaturan` serta `GET /warga/surat` untuk preview & unduhan PDF.
 */
export interface KopSurat {
  baris1: string;
  baris2: string;
  baris3: string;
}

/**
 * B12 — kop bawaan bila RT belum pernah mengisinya (atau mode OFFLINE).
 * Teksnya identik dengan kop hardcoded pada preview Surat Pengantar lama,
 * sehingga tampilan tidak berubah saat konfigurasi masih kosong.
 */
export function kopSuratDefault(): KopSurat {
  return {
    baris1: "PEMERINTAH PROVINSI DKI JAKARTA",
    baris2: `KELURAHAN ${tenant.kelurahan.toUpperCase()} — KEC. ${tenant.kecamatan.toUpperCase()}`,
    baris3: `${tenant.rtFull} ${tenant.rwFull} — ${tenant.perumahan}`,
  };
}

/**
 * B12 — token QR verifikasi surat dari path URL saat halaman dibuka lewat
 * link/QR: `"/q/8f3a…"` → `"8f3a…"`, selain itu `null`.
 * Regex sengaja dijaga sama dengan `tokenDariPath()` (undangan) agar keduanya
 * tidak pernah saling berebut path.
 */
export function tokenQrDariPath(): string | null {
  if (typeof window === "undefined") return null;
  // pathTanpaDasar memotong prefix base deploy (/SIWARGA) — lihat lib/deploy.
  const m = pathTanpaDasar().match(/^\/q\/([A-Za-z0-9._-]+)/);
  return m ? m[1] : null;
}

/** Surat yang butuh persetujuan RW: SKCK, Pindah, Nikah. */
export function suratPerluRw(jenis: string): boolean {
  return /SKCK|Pindah|Nikah/i.test(jenis);
}

/**
 * Daftar jenis surat SATU untuk kedua portal (Portal Warga & Portal RT).
 * Dulu daftarnya berbeda sehingga pengajuan warga tidak selalu muncul saat
 * RT menyaring jenis — disatukan agar pengajuan warga = yang di Portal RT.
 * "Surat Lainnya..." = pilihan bebas untuk warga; RT ikut memakainya saat
 * menampilkan opsi filter agar daftarnya identik.
 */
export const jenisSuratOptions = [
  "Surat Keterangan Domisili",
  "Surat Keterangan Tidak Mampu",
  "Surat Pengantar SKCK",
  "Surat Pengantar Pindah",
  "Surat Pengantar Nikah",
  "Surat Keterangan Usaha",
  "Surat Keterangan Kelahiran",
  "Surat Keterangan Kematian",
  "Surat Lainnya...",
];

/**
 * No. Surat baru: urut tertinggi yang sudah terpakai + 1.
 * Dipakai Portal Warga (saat mengajukan — nomor wajib ada sejak awal) dan
 * Portal RT (saat menerbitkan surat yang belum punya nomor), sehingga kedua
 * portal tidak pernah menghasilkan nomor kembar.
 */
export function noSuratOtomatis(list: Surat[]): string {
  const urut = list
    .map((s) => Number((s.noSurat.match(/\/(\d{1,3})$/) ?? [])[1] ?? 0))
    .filter((n) => Number.isFinite(n) && n > 0);
  const berikutnya = (urut.length > 0 ? Math.max(...urut) : 0) + 1;
  const kini = new Date();
  return generateNoSurat("SKP", kini.getMonth() + 1, kini.getFullYear(), berikutnya);
}

export const suratBadge: Record<StatusSurat, string> = {
  Draft: "bg-surface-container-high text-on-surface-variant",
  "Menunggu RT": "bg-primary-container text-on-primary-container",
  "Menunggu RW": "bg-secondary-fixed text-on-secondary-fixed",
  Disetujui: "bg-secondary-container text-on-secondary-container",
  Ditolak: "bg-error-container/40 text-on-error-container",
  "Perlu Perbaikan": "bg-tertiary-container text-on-tertiary-container",
};

const KK_WARGA = "3171-xxxx-xxxx-0988";

export const suratDefault: Surat[] = [
  // — Antrian persetujuan tingkat RW (§7.4) —
  { id: "s9", noSurat: "SKP/04-012/09/2026/009", jenis: "Surat Pengantar Pindah", pemohon: "Dewi Kartika Sari", keperluan: "Pindah domisili ke Bandung", tanggal: "22 September 2026", status: "Menunggu RW", perluRw: true },
  { id: "s10", noSurat: "SKP/04-012/09/2026/010", jenis: "Surat Pengantar SKCK", pemohon: "Hendra Kusuma", keperluan: "Perpanjangan SKCK tahunan", tanggal: "23 September 2026", status: "Menunggu RW", perluRw: true },
  // — Antrian & arsip RT —
  { id: "s1", noSurat: "SKP/04-012/09/2026/001", jenis: "Surat Pengantar SKCK", pemohon: "Bambang Supriyanto", keperluan: "Pengajuan SKCK untuk melamar kerja", tanggal: "01 September 2026", status: "Disetujui", perluRw: true, noKk: KK_WARGA },
  { id: "s2", noSurat: "SKP/04-012/09/2026/002", jenis: "Surat Keterangan Domisili", pemohon: "Hendra Kusuma", keperluan: "Pengajuan KPR Bank Mandiri", tanggal: "03 September 2026", status: "Disetujui", perluRw: false },
  { id: "s3", noSurat: "SKP/04-012/09/2026/003", jenis: "Surat Keterangan Usaha", pemohon: "Dewi Kartika Sari", keperluan: "Perizinan Usaha Kuliner", tanggal: "05 September 2026", status: "Disetujui", perluRw: false },
  { id: "s4", noSurat: "SKP/04-012/09/2026/004", jenis: "Surat Pengantar Nikah", pemohon: "Ahmad Fauzi", keperluan: "Pengajuan nikah di KUA", tanggal: "07 September 2026", status: "Menunggu RT", perluRw: true },
  { id: "s5", noSurat: "SKP/04-012/09/2026/005", jenis: "Surat Keterangan Tidak Mampu", pemohon: "Warsito", keperluan: "Pengajuan bantuan subsidi iuran", tanggal: "08 September 2026", status: "Ditolak", perluRw: false, catatan: "Data pendapatan tidak sesuai dengan penghasilan yang dilaporkan" },
  { id: "s6", noSurat: "SKP/04-012/09/2026/006", jenis: "Surat Pengantar SKCK", pemohon: "Rina Wulandari", keperluan: "Pengajuan SKCK untuk beasiswa", tanggal: "10 September 2026", status: "Disetujui", perluRw: true },
  { id: "s7", noSurat: "", jenis: "Surat Keterangan Domisili", pemohon: "Gunawan Prasetyo", keperluan: "Pendaftaran sekolah anak", tanggal: "12 September 2026", status: "Menunggu RT", perluRw: false },
  { id: "s8", noSurat: "", jenis: "Surat Pengantar Pindah", pemohon: "Putri Anggraini", keperluan: "Pindah domisili ke Surabaya", tanggal: "14 September 2026", status: "Draft", perluRw: true },
  // — Pengajuan milik warga yang login (noKk cocok → tampil di Portal Warga) —
  { id: "w1", noSurat: "SKP/04-012/09/2026/011", jenis: "Surat Keterangan Domisili", pemohon: "Bambang Supriyanto", keperluan: "Pengajuan KPR Bank Mandiri", tanggal: "15 September 2026", status: "Menunggu RT", perluRw: false, catatan: "Menunggu verifikasi data hunian oleh RT", noKk: KK_WARGA },
  { id: "w2", noSurat: "SKT/04-012/09/2026/002", jenis: "Surat Keterangan Tidak Mampu", pemohon: "Bambang Supriyanto", keperluan: "Bantuan Pendidikan Anak", tanggal: "10 September 2026", status: "Disetujui", perluRw: false, noKk: KK_WARGA },
  { id: "w4", noSurat: "SKP/04-012/09/2026/012", jenis: "Surat Keterangan Usaha", pemohon: "Bambang Supriyanto", keperluan: "Perpanjangan Izin Usaha", tanggal: "01 September 2026", status: "Ditolak", perluRw: false, catatan: "Data usaha tidak sesuai dengan laporan pendapatan yang diberikan", noKk: KK_WARGA },
  { id: "w5", noSurat: "SKL/04-012/08/2026/008", jenis: "Surat Keterangan Kelahiran", pemohon: "Bambang Supriyanto", keperluan: "Pembuatan Akta Kelahiran", tanggal: "28 Agustus 2026", status: "Disetujui", perluRw: false, noKk: KK_WARGA },
];

// ===========================================================================
// AUDIT LOG — state bersama. Portal RT melihat SEMUA; RW melihat miliknya.
// Seluruh akses RW (approval maupun direct) wajib tercatat (§7.5).
// ===========================================================================
export interface AuditEntry {
  id: string;
  waktu: string;
  user: string;
  aksi: string;
  aksiBadge: string;
  dataDiakses: string;
  detail: string;
  ipAddress: string;
  portal: "rt" | "rw" | "warga";
  kategori: "data" | "akses" | "surat" | "kas";
}

/** Label portal untuk tampilan/ekspor audit (konsisten di semua halaman). */
export function labelPortal(portal: AuditEntry["portal"]): string {
  if (portal === "rw") return "Portal RW";
  if (portal === "warga") return "Portal Warga";
  return "Portal RT";
}

export function badgeAksi(aksi: string): string {
  if (/setujui/i.test(aksi)) return "bg-secondary-container text-on-secondary-container";
  if (/tolak/i.test(aksi)) return "bg-error-container/40 text-on-error-container";
  if (/akses|direct|ajukan/i.test(aksi)) return "bg-tertiary/20 text-tertiary";
  if (/verifikasi/i.test(aksi)) return "bg-primary-container text-on-primary-container";
  if (/kas|catat/i.test(aksi)) return "bg-secondary-container text-on-secondary-container";
  if (/export/i.test(aksi)) return "bg-tertiary-container text-on-tertiary-container";
  if (/cetak/i.test(aksi)) return "bg-secondary-container text-on-secondary-container";
  if (/edit/i.test(aksi)) return "bg-tertiary/20 text-tertiary";
  return "bg-primary-container text-on-primary-container";
}

export const auditDefault: AuditEntry[] = [
  // — Entri Portal RW (§7.6) —
  { id: "ar1", waktu: "20 Sep 2026, 11:30", user: "Pengurus RW", aksi: "Catat Kas", aksiBadge: badgeAksi("Catat Kas"), dataDiakses: "Buku Kas RW", detail: "Pemasukan Retribusi Lapak Pasar RW — Rp 2.100.000", ipAddress: "192.168.1.50", portal: "rw", kategori: "kas" },  { id: "ar2", waktu: "17 Sep 2026, 10:12", user: "Pengurus RW", aksi: "Akses Direct", aksiBadge: badgeAksi("Akses Direct"), dataDiakses: "Data Kependudukan RT 02", detail: "Mode direct (bypass approval) — justifikasi: penanganan cepat laporan banjir warga RT 02", ipAddress: "192.168.1.50", portal: "rw", kategori: "akses" },
  { id: "ar3", waktu: "16 Sep 2026, 14:40", user: "Pengurus RW", aksi: "Ajukan Akses", aksiBadge: badgeAksi("Ajukan Akses"), dataDiakses: "Data Kependudukan RT 07", detail: "Permintaan approval akses detail warga ke RT_ADMIN", ipAddress: "192.168.1.50", portal: "rw", kategori: "akses" },
  { id: "ar4", waktu: "15 Sep 2026, 09:05", user: "Pengurus RW", aksi: "Verifikasi Surat", aksiBadge: badgeAksi("Verifikasi Surat"), dataDiakses: "Surat Pengantar", detail: "Persetujuan tingkat RW: SKP/04-012/09/2026/011", ipAddress: "192.168.1.50", portal: "rw", kategori: "surat" },
  // — Entri Portal RT —
  { id: "a1", waktu: "14 Sep 2026, 09:15", user: "Bpk. Joko Santoso", aksi: "Lihat", aksiBadge: "bg-primary-container text-on-primary-container", dataDiakses: "Data Warga", detail: "NIK: 3171-xxxx-xxxx-0004", ipAddress: "192.168.1.105", portal: "rt", kategori: "data" },
  { id: "a2", waktu: "14 Sep 2026, 08:42", user: "Hj. Siti Rahmawati", aksi: "Export", aksiBadge: "bg-tertiary-container text-on-tertiary-container", dataDiakses: "Laporan Keuangan", detail: "Export laporan bulanan September 2026", ipAddress: "192.168.1.110", portal: "rt", kategori: "kas" },
  { id: "a3", waktu: "13 Sep 2026, 16:30", user: "Rahmat Hidayat", aksi: "Cetak", aksiBadge: "bg-secondary-container text-on-secondary-container", dataDiakses: "Surat Pengantar", detail: "SKP/04-012/09/2026/001", ipAddress: "192.168.1.108", portal: "rt", kategori: "surat" },
  { id: "a4", waktu: "13 Sep 2026, 14:22", user: "Bpk. Joko Santoso", aksi: "Edit", aksiBadge: "bg-tertiary/20 text-tertiary", dataDiakses: "Data Warga", detail: "Update status Huni Bpk. Warsito", ipAddress: "192.168.1.105", portal: "rt", kategori: "data" },
  { id: "a5", waktu: "13 Sep 2026, 11:05", user: "Hj. Siti Rahmawati", aksi: "Lihat", aksiBadge: "bg-primary-container text-on-primary-container", dataDiakses: "Buku Kas", detail: "Saldo per 13 September 2026", ipAddress: "192.168.1.110", portal: "rt", kategori: "kas" },
  { id: "a6", waktu: "12 Sep 2026, 17:45", user: "Bpk. Joko Santoso", aksi: "Edit", aksiBadge: "bg-tertiary/20 text-tertiary", dataDiakses: "Iuran Warga", detail: "Tandai lunas Bpk. Ahmad Fauzi", ipAddress: "192.168.1.105", portal: "rt", kategori: "kas" },
  { id: "a7", waktu: "12 Sep 2026, 15:10", user: "Rahmat Hidayat", aksi: "Cetak", aksiBadge: "bg-secondary-container text-on-secondary-container", dataDiakses: "Surat Pengantar", detail: "SKP/04-012/09/2026/002", ipAddress: "192.168.1.108", portal: "rt", kategori: "surat" },
  { id: "a8", waktu: "12 Sep 2026, 10:00", user: "Hj. Siti Rahmawati", aksi: "Export", aksiBadge: "bg-tertiary-container text-on-tertiary-container", dataDiakses: "Data Kependudukan", detail: "Export rekapitulasi KK aktif", ipAddress: "192.168.1.110", portal: "rt", kategori: "data" },
  { id: "a9", waktu: "11 Sep 2026, 09:30", user: "Bpk. Joko Santoso", aksi: "Lihat", aksiBadge: "bg-primary-container text-on-primary-container", dataDiakses: "Data Warga", detail: "NIK: 3171-xxxx-xxxx-0012", ipAddress: "192.168.1.105", portal: "rt", kategori: "data" },
  { id: "a10", waktu: "11 Sep 2026, 08:15", user: "Rahmat Hidayat", aksi: "Lihat", aksiBadge: "bg-primary-container text-on-primary-container", dataDiakses: "Data Hunian", detail: "Blok A1-A5 status hunian", ipAddress: "192.168.1.108", portal: "rt", kategori: "data" },
  { id: "a11", waktu: "10 Sep 2026, 16:00", user: "Hj. Siti Rahmawati", aksi: "Edit", aksiBadge: "bg-tertiary/20 text-tertiary", dataDiakses: "Buku Kas", detail: "Catat pengeluaran honor satpam", ipAddress: "192.168.1.110", portal: "rt", kategori: "kas" },
  { id: "a12", waktu: "10 Sep 2026, 14:20", user: "Bpk. Joko Santoso", aksi: "Cetak", aksiBadge: "bg-secondary-container text-on-secondary-container", dataDiakses: "Laporan Bulanan", detail: "Laporan Agustus 2026 final", ipAddress: "192.168.1.105", portal: "rt", kategori: "kas" },
  { id: "a13", waktu: "09 Sep 2026, 11:45", user: "Rahmat Hidayat", aksi: "Edit", aksiBadge: "bg-tertiary/20 text-tertiary", dataDiakses: "Data Warga", detail: "Tambah warga baru: Putri Anggraini", ipAddress: "192.168.1.108", portal: "rt", kategori: "data" },
  { id: "a14", waktu: "09 Sep 2026, 09:00", user: "Hj. Siti Rahmawati", aksi: "Lihat", aksiBadge: "bg-primary-container text-on-primary-container", dataDiakses: "Iuran Warga", detail: "Tunggakan September 2026", ipAddress: "192.168.1.110", portal: "rt", kategori: "kas" },
  { id: "a15", waktu: "08 Sep 2026, 13:30", user: "Bpk. Joko Santoso", aksi: "Export", aksiBadge: "bg-tertiary-container text-on-tertiary-container", dataDiakses: "Audit Log", detail: "Export log akses bulan Agustus", ipAddress: "192.168.1.105", portal: "rt", kategori: "data" },
  // — Entri Portal Warga (konfirmasi undangan link/QR, §undangan) —
  { id: "aw1", waktu: "20 Sep 2026, 08:31", user: "Yuliana Sari", aksi: "Konfirmasi Undangan", aksiBadge: badgeAksi("Konfirmasi Undangan"), dataDiakses: "Portal Warga", detail: "Token SGW-P9VD-3HNR — konfirmasi 4 digit terakhir no. HP", ipAddress: "192.168.1.77", portal: "warga", kategori: "akses" },
];

// ===========================================================================
// AKSES DETAIL WARGA — approval workflow RW → RT_ADMIN (§7.5)
// ===========================================================================
export type StatusAkses = "Menunggu" | "Disetujui" | "Ditolak" | "Diakses Direct";

export interface PermintaanAkses {
  id: string;
  pengaju: string;
  rtTujuan: string;
  lingkup: string;
  alasan: string;
  mode: "approval" | "direct";
  /** Wajib min. 20 karakter untuk mode direct (syarat audit §7.5). */
  justifikasi?: string;
  status: StatusAkses;
  tanggal: string;
  disetujuiOleh?: string;
  masaBerlaku?: string;
  catatan?: string;
}

/** Syarat UI mode direct: justifikasi minimal 20 karakter. */
export const MIN_JUSTIFIKASI = 20;

export const lingkupAksesOptions = [
  "Data Kependudukan (Identitas, Hubungan Keluarga)",
  "Data Domisili & Status Hunian",
  "Kontak Warga (No. WA/Telepon)",
];

export const aksesDefault: PermintaanAkses[] = [
  { id: "ax1", pengaju: "Pengurus RW", rtTujuan: "RT 07", lingkup: lingkupAksesOptions[0], alasan: "Verifikasi data kependudukan untuk laporan semester Kelurahan.", mode: "approval", status: "Menunggu", tanggal: "16 Sep 2026" },
  { id: "ax2", pengaju: "Pengurus RW", rtTujuan: "RT 04", lingkup: lingkupAksesOptions[1], alasan: "Pemaduan data hunian kosong untuk pendataan PBB RW 012.", mode: "approval", status: "Disetujui", tanggal: "14 Sep 2026", disetujuiOleh: "Admin RT — Bpk. Joko Santoso", masaBerlaku: "30 Sep 2026" },
  { id: "ax3", pengaju: "Pengurus RW", rtTujuan: "RT 02", lingkup: lingkupAksesOptions[0], alasan: "Mendukung laporan warga terdampak kebakaran.", mode: "direct", justifikasi: "Penanganan cepat laporan banjir warga RT 02 malam ini.", status: "Diakses Direct", tanggal: "17 Sep 2026" },
  { id: "ax4", pengaju: "Pengurus RW", rtTujuan: "RT 05", lingkup: lingkupAksesOptions[2], alasan: "Pengumpulan kontak pengurus untuk grup koordinasi.", mode: "approval", status: "Ditolak", tanggal: "10 Sep 2026", catatan: "Gunakan agregat kontak pengurus RT, bukan kontak seluruh warga." },
];

// ===========================================================================
// DATA AGREGAT PER RT (§7.1 & §7.2) — HANYA agregat, tanpa data individu.
// ===========================================================================
export interface RtAgregat {
  rt: string;
  kk: number;
  warga: number;
  totalRumah: number;
  hunian: number; // unit terisi
  kepatuhan: number; // persen iuran (agregat)
  terkumpul: number;
  subsidiJumlah: number;
  subsidiNominal: number;
  tunggakan: number;
}

export const rtAgregatDefault: RtAgregat[] = [
  { rt: "RT 01", kk: 74, warga: 254, totalRumah: 76, hunian: 71, kepatuhan: 94.6, terkumpul: 9740000, subsidiJumlah: 5, subsidiNominal: 365000, tunggakan: 555000 },
  { rt: "RT 02", kk: 66, warga: 226, totalRumah: 69, hunian: 65, kepatuhan: 91.2, terkumpul: 8600000, subsidiJumlah: 4, subsidiNominal: 290000, tunggakan: 825000 },
  { rt: "RT 03", kk: 84, warga: 289, totalRumah: 87, hunian: 82, kepatuhan: 88.5, terkumpul: 10525000, subsidiJumlah: 7, subsidiNominal: 510000, tunggakan: 1365000 },
  { rt: "RT 04", kk: 78, warga: 267, totalRumah: 80, hunian: 76, kepatuhan: 96.1, terkumpul: 10590000, subsidiJumlah: 3, subsidiNominal: 220000, tunggakan: 430000 },
  { rt: "RT 05", kk: 60, warga: 205, totalRumah: 62, hunian: 58, kepatuhan: 92.7, terkumpul: 7800000, subsidiJumlah: 4, subsidiNominal: 290000, tunggakan: 610000 },
  { rt: "RT 06", kk: 70, warga: 241, totalRumah: 73, hunian: 69, kepatuhan: 85.4, terkumpul: 8545000, subsidiJumlah: 8, subsidiNominal: 580000, tunggakan: 1460000 },
  { rt: "RT 07", kk: 64, warga: 219, totalRumah: 67, hunian: 63, kepatuhan: 90.3, terkumpul: 8250000, subsidiJumlah: 5, subsidiNominal: 365000, tunggakan: 885000 },
  { rt: "RT 08", kk: 57, warga: 196, totalRumah: 60, hunian: 55, kepatuhan: 87.9, terkumpul: 7010000, subsidiJumlah: 6, subsidiNominal: 435000, tunggakan: 965000 },
];

/** Tren pertumbuhan warga agregat 6 bulan. */
export const trenPenduduk = [
  { bulan: "Apr", warga: 1812 },
  { bulan: "Mei", warga: 1829 },
  { bulan: "Jun", warga: 1845 },
  { bulan: "Jul", warga: 1859 },
  { bulan: "Agu", warga: 1876 },
  { bulan: "Sep", warga: 1897 },
];

// ===========================================================================
// KAS RW — terpisah dari kas RT, prinsip APPEND-ONLY (§7.3)
// ===========================================================================
export interface KasRw {
  id: string;
  tanggal: string;
  keterangan: string;
  kategori: string;
  tipe: "Pemasukan" | "Pengeluaran";
  nominal: number;
  saldo: number;
}

export const kasRwKategori = [
  "Iuran RW",
  "Kegiatan Lintas-RT",
  "Honor & Operasional",
  "Sumbangan",
  "Retribusi",
  "Koreksi",
];

export const kasRwDefault: KasRw[] = [
  { id: "krw1", tanggal: "01 Sep 2026", keterangan: "Setoran Iuran RW Triwulan III", kategori: "Iuran RW", tipe: "Pemasukan", nominal: 6300000, saldo: 18750000 },
  { id: "krw2", tanggal: "05 Sep 2026", keterangan: "Honor Petugas Kebersihan RW", kategori: "Honor & Operasional", tipe: "Pengeluaran", nominal: 1400000, saldo: 17350000 },
  { id: "krw3", tanggal: "08 Sep 2026", keterangan: "Konsumsi Rapat Koordinasi Lintas-RT", kategori: "Kegiatan Lintas-RT", tipe: "Pengeluaran", nominal: 450000, saldo: 16900000 },
  { id: "krw4", tanggal: "12 Sep 2026", keterangan: "Sumbangan Kegiatan Ziarah RW", kategori: "Sumbangan", tipe: "Pemasukan", nominal: 1250000, saldo: 18150000 },
  { id: "krw5", tanggal: "17 Sep 2026", keterangan: "Perlengkapan Pos Kamling RW", kategori: "Kegiatan Lintas-RT", tipe: "Pengeluaran", nominal: 875000, saldo: 17275000 },
  { id: "krw6", tanggal: "20 Sep 2026", keterangan: "Retribusi Lapak Pasar RW", kategori: "Retribusi", tipe: "Pemasukan", nominal: 2100000, saldo: 19375000 },
];

// ===========================================================================
// FORMAT & PENCOCOKAN DATA WARGA — dipindah dari DataWargaRT agar seluruh
// portal memakai logika merge/format yang sama.
// ===========================================================================
export function digitsOnly(v: string): string {
  return v.replace(/\D/g, "");
}

export function noKkNorm(v: string): string {
  return v.replace(/[^0-9x]/gi, "").toLowerCase();
}

export function initialsOf(nama: string): string {
  return nama.split(" ").map((n) => n[0]).filter(Boolean).join("").slice(0, 2).toUpperCase();
}

/** Format digit WA menjadi "0812-3456-7890". */
export function fmtWa(digits: string): string {
  const d = digitsOnly(digits);
  if (d.length >= 11) return `${d.slice(0, 4)}-${d.slice(4, 8)}-${d.slice(8)}`;
  if (d.length >= 7) return `${d.slice(0, 4)}-${d.slice(4)}`;
  return d;
}

/** Digit WA dari field wa member ("+62 812-3456-7890" -> "081234567890"). */
export function waDigitsFromMember(wa: string): string {
  let d = digitsOnly(wa);
  if (d.startsWith("620")) d = d.slice(2);
  else if (d.startsWith("62")) d = "0" + d.slice(2);
  return d;
}

/** Simpan ke FamilyMember.wa dengan gaya "+62 812-3456-7890". */
export function memberWaValue(digits: string): string {
  const d = digitsOnly(digits);
  const local = d.startsWith("0") ? d.slice(1) : d.startsWith("62") ? d.slice(2) : d;
  const grouped = local.length === 11
    ? `${local.slice(0, 3)}-${local.slice(3, 7)}-${local.slice(7)}`
    : local;
  return `+62 ${grouped}`;
}

/** NIK tampilan ter-mask ala data KK: "3171-xxxx-xxxx-0004". */
export function maskedNik(nik: string): string {
  const d = digitsOnly(nik);
  if (d.length !== 16) return nik;
  return `${d.slice(0, 4)}-xxxx-xxxx-${d.slice(12)}`;
}

/** Format No. KK menjadi grup 4-4-4-4 ("3171-xxxx-xxxx-0988"). */
export function fmtNoKk(raw: string): string {
  const d = noKkNorm(raw);
  if (d.length !== 16) return raw;
  return `${d.slice(0, 4)}-${d.slice(4, 8)}-${d.slice(8, 12)}-${d.slice(12)}`;
}

/** Masking No. KK untuk ditampilkan: "3171-xxxx-xxxx-0001". Idempoten (input ter-mask tetap utuh). */
export function maskedNoKk(raw: string): string {
  const n = noKkNorm(raw);
  if (n.length !== 16) return raw;
  return `${n.slice(0, 4)}-xxxx-xxxx-${n.slice(12)}`;
}

export function badgePortal(status: string): string {
  if (status === "Aktif") return "bg-secondary-container text-on-secondary-container";
  if (status === "Undangan Dikirim") return "bg-tertiary-container text-on-tertiary-container";
  return "bg-surface-container-high text-on-surface-variant";
}

// ===========================================================================
// TANGGAL INDONESIA ↔ ISO — untuk form Edit Data Warga (Portal RT) yang
// memakai <input type="date"> sedangkan data KK menyimpan "14 Mei 1972".
// ===========================================================================
const BULAN_ID = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

/** "1972-05-14" → "14 Mei 1972". Bila gagal dibaca, nilai asli dikembalikan. */
export function isoKeTgl(iso: string): string {
  if (!iso) return "";
  const tgl = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(tgl.getTime())) return iso;
  return `${tgl.getDate()} ${BULAN_ID[tgl.getMonth()]} ${tgl.getFullYear()}`;
}

/** "14 Mei 1972" → "1972-05-14". Bila tidak dikenal, string kosong dikembalikan. */
export function tglKeIso(tgl: string): string {
  const s = tgl.trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (!m) return "";
  const bln = BULAN_ID.findIndex((b) => b.toLowerCase() === m[2].toLowerCase());
  if (bln < 0) return "";
  const d = new Date(Number(m[3]), bln, Number(m[1]));
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Usia (tahun) dari tanggal tampilan; bila tidak terbaca → 0. */
export function usiaDariTgl(tgl: string): number {
  const iso = tglKeIso(tgl);
  if (!iso) return 0;
  const lahir = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(lahir.getTime())) return 0;
  return Math.floor((Date.now() - lahir.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
}

// ===========================================================================
// DETAIL KK LENGKAP — dipakai form Edit Data Warga (Portal RT) untuk 14 kolom
// wajib: NIK, No. KK, nama, tempat/tanggal lahir, jenis kelamin, agama,
// pendidikan, pekerjaan, gol. darah, status & tanggal perkawinan, hubungan
// dalam keluarga, dan warga negara.
// ===========================================================================
export interface DetailKk {
  tempatLahir: string;
  tglLahir: string;
  jenisKelamin: string;
  agama: string;
  pendidikan: string;
  pekerjaan: string;
  goldarah: string;
  statusKawin: string;
  tglKawin: string;
  hubungan: string;
  wargaNegara: string;
}

export const detailKosong: DetailKk = {
  tempatLahir: "",
  tglLahir: "",
  jenisKelamin: "",
  agama: "",
  pendidikan: "",
  pekerjaan: "",
  goldarah: "",
  statusKawin: "",
  tglKawin: "",
  hubungan: "",
  wargaNegara: "",
};

/** "-" dan "O (Rhesus +)" → tampilan form yang bersih. */
function bersihkanNilai(v: string | undefined, bersihRhesus = false): string {
  const s = (v ?? "").trim();
  if (!s || s === "-") return "";
  return bersihRhesus ? s.replace(/\s*\(Rhesus.*?\)\s*$/i, "") : s;
}

/** Detail KK dari anggota keluarga (Portal Warga / Data Keluarga). */
export function detailDariMember(m: FamilyMember): DetailKk {
  return {
    tempatLahir: bersihkanNilai(m.tempatLahir),
    tglLahir: bersihkanNilai(m.birthDate),
    jenisKelamin: bersihkanNilai(m.gender),
    agama: bersihkanNilai(m.agama),
    pendidikan: bersihkanNilai(m.pendidikan),
    pekerjaan: bersihkanNilai(m.job),
    goldarah: bersihkanNilai(m.blood, true),
    statusKawin: bersihkanNilai(m.statusPernikahan),
    tglKawin: bersihkanNilai(m.tglPerkawinan),
    hubungan: bersihkanNilai(m.relation),
    wargaNegara: bersihkanNilai(m.wargaNegara),
  };
}

/** Salin isi DetailKk ke field opsional milik baris WargaRt. */
export function detailKeRow(w: WargaRt, d: DetailKk): WargaRt {
  return { ...w, ...d };
}

/** Ambil detail KK dari baris WargaRt (baris lokal yang tidak terpasang di kkList). */
export function detailDariRow(w: WargaRt): DetailKk {
  return {
    tempatLahir: w.tempatLahir ?? "",
    tglLahir: w.tglLahir ?? "",
    jenisKelamin: w.jenisKelamin ?? "",
    agama: w.agama ?? "",
    pendidikan: w.pendidikan ?? "",
    pekerjaan: w.pekerjaan ?? "",
    goldarah: w.goldarah ?? "",
    statusKawin: w.statusKawin ?? "",
    tglKawin: w.tglKawin ?? "",
    hubungan: w.hubungan ?? "",
    wargaNegara: w.wargaNegara ?? "",
  };
}

/**
 * Tulis hasil form Edit Data Warga ke anggota keluarga (Portal Warga).
 * Kolom yang kosong disimpan sebagai placeholder "-" agar tampilan kartu KK
 * tetap sama seperti saat diisi oleh Data Keluarga.
 */
export function terapkanDetailKeMember(m: FamilyMember, d: DetailKk): FamilyMember {
  const dash = (v: string) => v.trim() || "-";
  const hubungan = d.hubungan.trim() || m.relation;
  const filter: MemberFilter =
    hubungan === "Kepala Keluarga" ? "kepala" : hubungan === "Istri" ? "istri" : "anak";
  return {
    ...m,
    tempatLahir: d.tempatLahir.trim() || undefined,
    birthDate: dash(d.tglLahir),
    age: usiaDariTgl(d.tglLahir),
    gender: dash(d.jenisKelamin),
    agama: dash(d.agama),
    pendidikan: d.pendidikan.trim() || undefined,
    job: dash(d.pekerjaan),
    blood: d.goldarah.trim() ? `${d.goldarah.trim()} (Rhesus +)` : "-",
    statusPernikahan: dash(d.statusKawin),
    tglPerkawinan: d.tglKawin.trim() || undefined,
    relation: hubungan,
    role: hubungan,
    filter,
    wargaNegara: d.wargaNegara.trim() || undefined,
  };
}

// ===========================================================================
// DATA WARGA RT — seed bersama (DataWargaRT, DashboardRT, LaporanBulananRT).
// ===========================================================================
export interface WargaRt {
  id: string;
  /**
   * UUID baris `warga` dari API `GET/POST/PATCH /rt/warga` — kunci pencocokan
   * `linkFor` & `gabungDaftarWarga` karena NIK ter-mask (8 digit) bisa sama
   * antar warga. Baris demo lokal tidak memilikinya.
   */
  idWarga?: string;
  nama: string;
  nik: string;
  noKk: string;
  alamat: string;
  statusPortal: string;
  statusBadge: string;
  noWa: string;
  status: string;
  statusColor: string;
  // ---------------------------------------------------------------------------
  // Data KK lengkap (diisi Pengurus RT lewat Edit di Data Warga).
  // Dipakai sebagai salinan lokal untuk baris yang tidak terpasang di kkList;
  // untuk baris terpasang, sumber kebenaran tetap anggota keluarga di kkList.
  // ---------------------------------------------------------------------------
  tempatLahir?: string;
  tglLahir?: string;
  jenisKelamin?: string;
  agama?: string;
  pendidikan?: string;
  pekerjaan?: string;
  goldarah?: string;
  statusKawin?: string;
  tglKawin?: string;
  hubungan?: string;
  wargaNegara?: string;
  /**
   * Batch 14 — ISO `kartu_keluarga.created_at` (dasar KPI "KK Masuk" =
   * KK terdaftar bulan berjalan). Baris demo OFFLINE tidak memilikinya.
   */
  kkCreatedAt?: string;
  /**
   * Batch 14 — `status_demografis` server (`aktif|pindah|meninggal|nonaktif`);
   * dasar KPI "KK Keluar" (KK yang semua anggotanya pindah/meninggal).
   * Baris demo OFFLINE tidak memilikinya — diperlakukan sebagai `aktif`
   * (tidak pernah dihitung keluar — konservatif, tanpa asumsi keliru).
   */
  statusDemografis?: string;
}

export const wargaRtDefault: WargaRt[] = [
  { id: "w1", nama: "Bambang Supriyanto", nik: "3171051405720004", noKk: "3171050101050001", alamat: "Blok B4 No. 12", statusPortal: "Aktif", statusBadge: "bg-secondary-container text-on-secondary-container", noWa: "0812-3456-7890", status: "Warga", statusColor: "text-on-surface-variant" },
  { id: "w2", nama: "Siti Rahmawati", nik: "3171052208761120", noKk: "3171050101050001", alamat: "Blok B4 No. 12", statusPortal: "Aktif", statusBadge: "bg-secondary-container text-on-secondary-container", noWa: "0813-9876-5432", status: "Bendahara", statusColor: "text-secondary" },
  { id: "w3", nama: "Rahmat Hidayat", nik: "3171051003850012", noKk: "3171050101050002", alamat: "Blok A1 No. 1", statusPortal: "Aktif", statusBadge: "bg-secondary-container text-on-secondary-container", noWa: "0857-1122-3344", status: "Sekretaris", statusColor: "text-primary" },
  { id: "w4", nama: "Hendra Kusuma", nik: "3171050506900015", noKk: "3171050101050003", alamat: "Blok A2 No. 5", statusPortal: "Aktif", statusBadge: "bg-secondary-container text-on-secondary-container", noWa: "0812-5566-7788", status: "Warga", statusColor: "text-on-surface-variant" },
  { id: "w5", nama: "Dewi Kartika Sari", nik: "3171051510950008", noKk: "3171050101050004", alamat: "Blok B1 No. 3", statusPortal: "Aktif", statusBadge: "bg-secondary-container text-on-secondary-container", noWa: "0856-4433-2211", status: "Warga", statusColor: "text-on-surface-variant" },
  { id: "w6", nama: "Ahmad Fauzi", nik: "3171052003880019", noKk: "3171050101050005", alamat: "Blok B2 No. 14", statusPortal: "Undangan Dikirim", statusBadge: "bg-tertiary-container text-on-tertiary-container", noWa: "0812-9988-7766", status: "Penyewa", statusColor: "text-on-surface-variant" },
  { id: "w7", nama: "Rina Wulandari", nik: "3171050304920006", noKk: "3171050101050006", alamat: "Blok C1 No. 8", statusPortal: "Belum Aktif", statusBadge: "bg-surface-container-high text-on-surface-variant", noWa: "0857-1234-5678", status: "Warga", statusColor: "text-on-surface-variant" },
  { id: "w8", nama: "H. Sudirman", nik: "3171051206750011", noKk: "3171050101050007", alamat: "Blok C3 No. 22", statusPortal: "Aktif", statusBadge: "bg-secondary-container text-on-secondary-container", noWa: "0813-8765-4321", status: "Warga", statusColor: "text-on-surface-variant" },
  { id: "w9", nama: "Putri Anggraini", nik: "3171052801980024", noKk: "3171050101050008", alamat: "Blok D1 No. 7", statusPortal: "Undangan Dikirim", statusBadge: "bg-tertiary-container text-on-tertiary-container", noWa: "0856-8877-6655", status: "Penyewa", statusColor: "text-on-surface-variant" },
  { id: "w10", nama: "Gunawan Prasetyo", nik: "3171051112820017", noKk: "3171050101050009", alamat: "Blok D2 No. 11", statusPortal: "Belum Aktif", statusBadge: "bg-surface-container-high text-on-surface-variant", noWa: "0812-2233-4455", status: "Warga", statusColor: "text-on-surface-variant" },
];

// ---------------------------------------------------------------------------
// Mode demo OFFLINE (Okt 2026 — "login jujur saat server tak terjangkau"):
// hanya IDENTITAS DEMO yang dikenal yang boleh masuk tanpa server, dan nama
// yang tampil adalah persona ASLINYA (bukan nama acak). Identitas asing →
// ditolak oleh LoginPage dengan pesan jujur "server tidak terjangkau":
// sukses login atas nama siapa pun adalah kebohongan.
// ---------------------------------------------------------------------------

/** Profil demo warga: no. HP → persona `wargaRtDefault`; tak dikenal → null. */
export function profilDemoWarga(noHp: string): { peran: "warga"; nama: string } | null {
  const t = digitsOnly(noHp);
  const w = wargaRtDefault.find((x) => digitsOnly(x.noWa) === t);
  return w ? { peran: "warga", nama: w.nama } : null;
}

/** Profil demo pengurus: surel akun seed → persona (tanpa fallback nama lain). */
export function profilDemoPengurus(email: string): {
  peran: "rt_admin" | "rw_admin";
  nama: string;
  jabatan: string;
  email: string;
} | null {
  const e = email.trim().toLowerCase();
  const peta: Record<string, { peran: "rt_admin" | "rw_admin"; nama: string; jabatan: string }> = {
    "rt04@siwarga.id": { peran: "rt_admin", nama: "Joko Santoso", jabatan: "Ketua RT" },
    "rt05@siwarga.id": { peran: "rt_admin", nama: "Budi Hartono", jabatan: "Ketua RT" },
    "rw012@siwarga.id": { peran: "rw_admin", nama: "H. Subaidi", jabatan: "Ketua RW" },
  };
  const d = peta[e];
  return d ? { ...d, email: e } : null;
}

/** Pasangkan baris warga dengan KK di kkList: cocokkan NIK anggota dulu, lalu No. KK. */
export interface KkLink {
  kkId: string;
  /** Index anggota di dalam kk.anggota; -1 = No. KK cocok tapi anggota belum ada. */
  idx: number;
}

export function linkFor(w: WargaRt, kkList: KkData[]): KkLink | null {
  // Pencocokan PERTAMA: ID baris `warga` (data API) — NIK ter-mask hanya 8
  // digit sehingga bisa tabrak antar warga; ID dijamin unik. Bila anggota
  // belum ada di KK mana pun, lanjut ke fallback No.KK (kedua sisi ter-mask
  // dan sama → noKkNorm berdimensi 16 tetap cocok).
  if (w.idWarga) {
    for (const kk of kkList) {
      const idx = kk.anggota.findIndex((m) => m.idWarga === w.idWarga);
      if (idx >= 0) return { kkId: kk.id, idx };
    }
  }
  const nik = digitsOnly(w.nik);
  if (nik.length === 16) {
    for (const kk of kkList) {
      const idx = kk.anggota.findIndex((m) => digitsOnly(m.nikFull ?? m.nik) === nik);
      if (idx >= 0) return { kkId: kk.id, idx };
    }
  }
  const noKk = noKkNorm(w.noKk);
  if (noKk.length === 16) {
    for (const kk of kkList) {
      if (noKkNorm(kk.noKk) === noKk) return { kkId: kk.id, idx: -1 };
    }
  }
  return null;
}

export function buildMember(nama: string, nik: string, waDigits: string): FamilyMember {
  return {
    name: nama,
    initials: initialsOf(nama),
    role: "Anggota",
    filter: "anak",
    gender: "-",
    age: 0,
    birthDate: "-",
    nik: maskedNik(nik),
    nikFull: nik,
    relation: "Anggota Keluarga",
    job: "-",
    wa: memberWaValue(waDigits),
    email: "",
    blood: "-",
    agama: "-",
    statusPernikahan: "-",
    statusNote: "Ditambahkan oleh Pengurus RT",
    statusIcon: "person",
    statusColor: "text-primary",
    avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(nama)}&background=random&color=fff&size=128`,
    ringColor: "ring-surface-variant",
  };
}

// ---------------------------------------------------------------------------
// TAMBAH DATA KK (Portal RT) — 1 Kartu Keluarga memuat beberapa NIK
// (Kepala Keluarga, Istri, Anak, …). Data ringkas dulu; kolom lain dilengkapi
// lewat Edit Data Warga.
// ---------------------------------------------------------------------------
export interface AnggotaBaru {
  nama: string;
  nik: string;
  hubungan: string;
  jenisKelamin: string;
  agama: string;
  /** Tanggal lahir ISO "1990-05-14" (input type="date"). */
  tglLahir: string;
  pekerjaan: string;
  /** Digit No. WA ("081234567890"). */
  waDigits: string;
}

/** Satu baris kosong untuk form Tambah Data KK (anggota pertama = Kepala). */
export function anggotaKosong(): AnggotaBaru {
  return {
    nama: "",
    nik: "",
    hubungan: "",
    jenisKelamin: "",
    agama: "",
    tglLahir: "",
    pekerjaan: "",
    waDigits: "",
  };
}

/** True bila satu baris anggota sama sekali belum diisi (diabaikan saat simpan). */
export function anggotaTerisi(a: AnggotaBaru): boolean {
  return Boolean(
    a.nama.trim() || a.nik || a.hubungan || a.jenisKelamin || a.agama || a.tglLahir || a.pekerjaan.trim() || a.waDigits
  );
}

/** Susun FamilyMember dari isian ringkas form Tambah Data KK. */
export function buildMemberBaru(a: AnggotaBaru): FamilyMember {
  const nama = a.nama.trim();
  const hubungan = a.hubungan.trim() || "Anggota Keluarga";
  const filter: MemberFilter =
    hubungan === "Kepala Keluarga" ? "kepala" : hubungan === "Istri" ? "istri" : "anak";
  return {
    name: nama,
    initials: initialsOf(nama),
    role: hubungan,
    filter,
    gender: a.jenisKelamin || "-",
    age: usiaDariTgl(a.tglLahir),
    birthDate: a.tglLahir ? isoKeTgl(a.tglLahir) : "-",
    nik: maskedNik(a.nik),
    nikFull: a.nik,
    relation: hubungan,
    job: a.pekerjaan.trim() || "-",
    wa: memberWaValue(a.waDigits),
    email: "",
    blood: "-",
    agama: a.agama || "-",
    statusPernikahan: "-",
    statusNote: "Ditambahkan oleh Pengurus RT",
    statusIcon: "person",
    statusColor: "text-primary",
    avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(nama)}&background=random&color=fff&size=128`,
    ringColor: "ring-surface-variant",
  };
}

/** Baris tampilan daftar warga: gabungan data RT + data KK dari Portal Warga. */
export function gabungDaftarWarga(kkList: KkData[], wargaRt: WargaRt[]): WargaRt[] {
  const rows: WargaRt[] = [];
  const seenNik = new Set<string>();

  for (const w of wargaRt) {
    const link = linkFor(w, kkList);
    if (link && link.idx >= 0) {
      const kk = kkList.find((k) => k.id === link.kkId);
      const m = kk?.anggota[link.idx];
      if (kk && m) {
        seenNik.add(digitsOnly(m.nikFull ?? m.nik));
        // Identitas & detail KK mengikuti anggota keluarga (sumber kebenaran
        // Portal Warga); status portal tetap dari data lokal RT.
        rows.push({
          ...w,
          nama: m.name,
          nik: m.nikFull ?? m.nik,
          noKk: kk.noKk,
          alamat: shortAlamat(kk.alamat),
          noWa: fmtWa(waDigitsFromMember(m.wa)),
          ...detailDariMember(m),
        });
        continue;
      }
    }
    if (link) seenNik.add(digitsOnly(w.nik));
    rows.push(w);
  }

  for (const kk of kkList) {
    kk.anggota.forEach((m, i) => {
      // Kunci ID baris `warga` (data API): NIK ter-mask bisa sama antar warga,
      // jadi dedup/kecocokan memakai ID — NIK hanya untuk baris demo lokal.
      if (m.idWarga) {
        if (wargaRt.some((w) => w.idWarga === m.idWarga)) return; // sudah ada barisnya
        rows.push({
          idWarga: m.idWarga,
          id: `kk-${kk.id}-${i}`,
          nama: m.name,
          nik: m.nikFull ?? m.nik,
          noKk: kk.noKk,
          alamat: shortAlamat(kk.alamat),
          statusPortal: "Belum Aktif",
          statusBadge: badgePortal("Belum Aktif"),
          noWa: fmtWa(waDigitsFromMember(m.wa)),
          status: "Warga",
          statusColor: "text-on-surface-variant",
          ...detailDariMember(m),
        });
        return;
      }
      const n = digitsOnly(m.nikFull ?? m.nik);
      if (!n || seenNik.has(n)) return;
      if (wargaRt.some((w) => digitsOnly(w.nik) === n)) {
        seenNik.add(n);
        return;
      }
      seenNik.add(n);
      rows.push({
        id: `kk-${kk.id}-${i}`,
        nama: m.name,
        nik: m.nikFull ?? m.nik,
        noKk: kk.noKk,
        alamat: shortAlamat(kk.alamat),
        statusPortal: "Belum Aktif",
        statusBadge: badgePortal("Belum Aktif"),
        noWa: fmtWa(waDigitsFromMember(m.wa)),
        status: "Warga",
        statusColor: "text-on-surface-variant",
        ...detailDariMember(m),
      });
    });
  }

  return rows;
}

/** Rekap populasi (KK unik & jiwa) dari data gabungan — dipakai Dashboard & Laporan. */
export function hitungPopulasi(kkList: KkData[], wargaRt: WargaRt[]): { kk: number; jiwa: number } {
  const rows = gabungDaftarWarga(kkList, wargaRt);
  const noKk = new Set(rows.map((r) => noKkNorm(r.noKk)).filter(Boolean));
  return { kk: noKk.size, jiwa: rows.length };
}

// ===========================================================================
// DATA HUNIAN RT — seed bersama (DataHunianRT, DashboardRT, LaporanBulananRT).
// ===========================================================================
export interface HunianRumah {
  id: string;
  blok: string;
  alamat: string;
  jenis: string;
  /** Status tersimpan (dihuni pemilik / sewa / multi-kk / kosong). */
  status: string;
  /** Jumlah KK manual yang terdaftar pada alamat ini (bisa > 1 = Multi-KK). */
  kkTerdaftar: number;
  /** Nama kepala/penghuni KK yang ditambahkan manual lewat form. */
  penghuni: string[];
  /**
   * Batch 15 · unit kendaraan roda 4 (0–99, opsional — data demo tanpa nilai
   * tampil memakai default 1). Dasar iuran kendaraan bila diaktifkan; belum
   * dipakai perhitungan tagihan.
   */
  unitKendaraanR4?: number;
}

export const hunianDefault: HunianRumah[] = [
  { id: "r1", blok: "A1", alamat: "Blok A1 No. 1", jenis: "Rumah Tinggal", status: "Dihuni Pemilik", kkTerdaftar: 1, penghuni: [] },
  { id: "r2", blok: "A2", alamat: "Blok A2 No. 5", jenis: "Rumah Tinggal", status: "Dihuni Pemilik", kkTerdaftar: 1, penghuni: [] },
  { id: "r3", blok: "B1", alamat: "Blok B1 No. 3", jenis: "Rumah Tinggal", status: "Multi-KK", kkTerdaftar: 2, penghuni: [] },
  { id: "r4", blok: "B2", alamat: "Blok B2 No. 14", jenis: "Rumah Sewa", status: "Sewa/Kontrak", kkTerdaftar: 1, penghuni: [] },
  { id: "r0", blok: "B4", alamat: "Blok B4 No. 12", jenis: "Rumah Tinggal", status: "Dihuni Pemilik", kkTerdaftar: 1, penghuni: ["Bambang Supriyanto"] },
  { id: "r5", blok: "C1", alamat: "Blok C1 No. 8", jenis: "Rumah Tinggal", status: "Dihuni Pemilik", kkTerdaftar: 1, penghuni: [] },
  { id: "r6", blok: "C3", alamat: "Blok C3 No. 22", jenis: "Rumah Tinggal", status: "Dihuni Pemilik", kkTerdaftar: 1, penghuni: ["H. Sudirman"] },
  { id: "r7", blok: "D1", alamat: "Blok D1 No. 7", jenis: "Rumah Sewa", status: "Sewa/Kontrak", kkTerdaftar: 1, penghuni: [] },
  { id: "r8", blok: "D2", alamat: "Blok D2 No. 11", jenis: "Rumah Tinggal", status: "Multi-KK", kkTerdaftar: 3, penghuni: [] },
];

/** Rekap hunian untuk KPI Dashboard/Laporan — identik dengan Data Hunian RT. */
export function hitungHunian(hunian: HunianRumah[]): { total: number; terisi: number; multi: number; kosong: number } {
  return {
    total: hunian.length,
    terisi: hunian.filter((h) => h.status !== "Kosong").length,
    multi: hunian.filter((h) => h.status === "Multi-KK" || h.kkTerdaftar > 1).length,
    kosong: hunian.filter((h) => h.status === "Kosong").length,
  };
}

// ===========================================================================
// KAS RT — seed bersama (KasRT, DashboardRT, LaporanBulananRT, Portal Warga).
// Nominal bertanda: pemasukan positif, pengeluaran negatif → rantai saldo.
// ===========================================================================
export interface KasRt {
  id: string;
  tanggal: string;
  keterangan: string;
  kategori: string;
  tipe: "Pemasukan" | "Pengeluaran";
  /** Bertanda: pemasukan +, pengeluaran −. */
  nominal: number;
  saldo: number;
  bukti: boolean;
  /**
   * B8 — asal entri server (`manual` | `iuran_alokasi` | `pembalik`).
   * Opsional: baris data demo tidak memuatnya → diperlakukan sebagai manual.
   */
  sumber?: string;
  /** B8 — id baris yang DIBALIK oleh baris ini (baris hasil koreksi). */
  reversalOfId?: string | null;
}

export const kasRtDefault: KasRt[] = [
  { id: "k1", tanggal: "01 Oktober 2026", keterangan: "Iuran Warga Blok A1-A2", kategori: "Iuran", tipe: "Pemasukan", nominal: 1750000, saldo: 15200000, bukti: false },
  { id: "k2", tanggal: "01 Oktober 2026", keterangan: "Iuran Warga Blok B1-B4", kategori: "Iuran", tipe: "Pemasukan", nominal: 2100000, saldo: 17300000, bukti: false },
  { id: "k3", tanggal: "03 Oktober 2026", keterangan: "Setoran Tunai Iuran C1-C3", kategori: "Setoran Lain-lain", tipe: "Pemasukan", nominal: 1350000, saldo: 18650000, bukti: true },
  { id: "k4", tanggal: "05 Oktober 2026", keterangan: "Honor Satpam Bulanan", kategori: "Honor", tipe: "Pengeluaran", nominal: -2000000, saldo: 16650000, bukti: true },
  { id: "k5", tanggal: "07 Oktober 2026", keterangan: "Armada Sampah DLH", kategori: "Operasional", tipe: "Pengeluaran", nominal: -1800000, saldo: 14850000, bukti: true },
  { id: "k6", tanggal: "08 Oktober 2026", keterangan: "Listrik Pos Ronda", kategori: "Sarana", tipe: "Pengeluaran", nominal: -450000, saldo: 14400000, bukti: true },
  { id: "k7", tanggal: "10 Oktober 2026", keterangan: "Iuran Warga Blok D1-D2", kategori: "Iuran", tipe: "Pemasukan", nominal: 1050000, saldo: 15450000, bukti: false },
  { id: "k8", tanggal: "12 Oktober 2026", keterangan: "ATK Kantor RT", kategori: "Operasional", tipe: "Pengeluaran", nominal: -250000, saldo: 15200000, bukti: true },
  { id: "k9", tanggal: "15 Oktober 2026", keterangan: "Setoran Tunai Iuran Blok B", kategori: "Setoran Lain-lain", tipe: "Pemasukan", nominal: 800000, saldo: 16000000, bukti: true },
  { id: "k10", tanggal: "17 Oktober 2026", keterangan: "Pembayaran Listrik RT", kategori: "Sarana", tipe: "Pengeluaran", nominal: -600000, saldo: 15400000, bukti: true },
  { id: "k11", tanggal: "20 Oktober 2026", keterangan: "Iuran Warga Blok A1-A2 (Susulan)", kategori: "Iuran", tipe: "Pemasukan", nominal: 350000, saldo: 15750000, bukti: false },
  { id: "k12", tanggal: "22 Oktober 2026", keterangan: "Perawatan Taman RT", kategori: "Operasional", tipe: "Pengeluaran", nominal: -300000, saldo: 15450000, bukti: true },
];

export function badgeKasTipe(tipe: "Pemasukan" | "Pengeluaran"): string {
  return tipe === "Pemasukan"
    ? "bg-secondary-container text-on-secondary-container"
    : "bg-error-container/40 text-on-error-container";
}

/** Saldo kas RT terkini = saldo baris terakhir. */
export function saldoKasRt(kas: KasRt[]): number {
  return kas.length ? kas[kas.length - 1].saldo : 0;
}

export function rekapKasRt(kas: KasRt[]): { pemasukan: number; pengeluaran: number } {
  let pemasukan = 0;
  let pengeluaran = 0;
  for (const k of kas) {
    if (k.tipe === "Pemasukan") pemasukan += k.nominal;
    else pengeluaran += Math.abs(k.nominal);
  }
  return { pemasukan, pengeluaran };
}

// ===========================================================================
// TAGIHAN PER RUMAH & REKAP IURAN — dipindah dari IuranRT agar KPI Iuran,
// Dashboard, dan Laporan selalu memakai baris & angka yang sama.
// ===========================================================================
export interface RumahTagihan {
  id: string;
  alamat: string;
  kepalaKk: string;
  kkCount: number;
  /** Jumlah unit kendaraan R4 di rumah ini (untuk item kategori tipe "per_unit"). */
  unitR4: number;
  periode: string;
  seedStatus: string;
  seedTanggalBayar: string;
}

export interface TagihanRow extends RumahTagihan {
  jumlah: number;
  status: string;
  tanggalBayar: string;
}

export const tagihanRumahDefault: RumahTagihan[] = [
  { id: "r1", alamat: "Blok B4 No. 12", kepalaKk: "Bambang Supriyanto", kkCount: 1, unitR4: 1, periode: "Oktober 2026", seedStatus: "Lunas", seedTanggalBayar: "05 Oktober 2026" },
  { id: "r2", alamat: "Blok A1 No. 1", kepalaKk: "Rahmat Hidayat", kkCount: 1, unitR4: 1, periode: "Oktober 2026", seedStatus: "Lunas", seedTanggalBayar: "03 Oktober 2026" },
  { id: "r3", alamat: "Blok A2 No. 5", kepalaKk: "Hendra Kusuma", kkCount: 1, unitR4: 1, periode: "Oktober 2026", seedStatus: "Belum Bayar", seedTanggalBayar: "-" },
  { id: "r4", alamat: "Blok B1 No. 3", kepalaKk: "Dewi Kartika Sari", kkCount: 2, unitR4: 1, periode: "Oktober 2026", seedStatus: "Sebagian", seedTanggalBayar: "12 Oktober 2026" },
  { id: "r5", alamat: "Blok B2 No. 14", kepalaKk: "Ahmad Fauzi", kkCount: 1, unitR4: 1, periode: "Oktober 2026", seedStatus: "Belum Bayar", seedTanggalBayar: "-" },
  { id: "r6", alamat: "Blok C1 No. 8", kepalaKk: "Rina Wulandari", kkCount: 1, unitR4: 1, periode: "Oktober 2026", seedStatus: "Lunas", seedTanggalBayar: "01 Oktober 2026" },
  { id: "r7", alamat: "Blok C3 No. 22", kepalaKk: "H. Sudirman", kkCount: 1, unitR4: 2, periode: "Oktober 2026", seedStatus: "Denda", seedTanggalBayar: "15 Oktober 2026" },
  { id: "r8", alamat: "Blok D1 No. 7", kepalaKk: "Putri Anggraini", kkCount: 1, unitR4: 1, periode: "Oktober 2026", seedStatus: "Lunas", seedTanggalBayar: "06 Oktober 2026" },
  { id: "r9", alamat: "Blok D2 No. 11", kepalaKk: "Gunawan Prasetyo", kkCount: 1, unitR4: 1, periode: "Oktober 2026", seedStatus: "Belum Bayar", seedTanggalBayar: "-" },
];

/** Status turunan: bila ada pembayaran utk alamat+periode tsb, ikuti statusnya. */
export function statusDerivatifTagihan(
  row: RumahTagihan,
  pembayaran: Pembayaran[]
): { status: string; tanggalBayar: string } {
  const terkait = pembayaran.filter(
    (p) => shortAlamat(p.alamat) === row.alamat && p.periode === row.periode
  );
  const lunas = terkait.find((p) => p.status === "Lunas");
  if (lunas) return { status: "Lunas", tanggalBayar: lunas.tanggal };
  const pending = terkait.find((p) => p.status === "Menunggu Verifikasi");
  if (pending) return { status: "Menunggu Verifikasi", tanggalBayar: pending.tanggal };
  return { status: row.seedStatus, tanggalBayar: row.seedTanggalBayar };
}

export interface OpsiTagihan {
  /** Alamat pendek hunian warga yang login — unit R4-nya ikut pengaturan warga. */
  alamatWarga?: string;
  unitR4Warga?: number;
}

/** Baris tagihan per rumah: jumlah = kategori × unit R4 (unit warga diselaraskan). */
export function hitungTagihanRows(
  kategori: KategoriIuran[],
  pembayaran: Pembayaran[],
  ops?: OpsiTagihan
): TagihanRow[] {
  const kat = kategori.length > 0 ? kategori : kategoriIuranDefault;
  return tagihanRumahDefault.map((row) => {
    const unitR4 =
      ops?.alamatWarga && row.alamat === ops.alamatWarga
        ? ops.unitR4Warga ?? row.unitR4
        : row.unitR4;
    const { status, tanggalBayar } = statusDerivatifTagihan(row, pembayaran);
    return { ...row, unitR4, jumlah: hitungIuranBulanan(kat, unitR4), status, tanggalBayar };
  });
}

/** Rekap iuran agregat — satu-satunya sumber KPI iuran di semua portal. */
export function rekapIuran(
  rows: TagihanRow[],
  pembayaran: Pembayaran[]
): { terkumpul: number; kepatuhan: number; tunggakan: number; lunasCount: number; belumCount: number } {
  const lunasRows = rows.filter((r) => r.status === "Lunas");
  const tunggakanRows = rows.filter(
    (r) => r.status === "Belum Bayar" || r.status === "Sebagian" || r.status === "Denda"
  );
  const terkumpul =
    pembayaran
      .filter((p) => p.status === "Lunas")
      .reduce((sum, p) => sum + p.jumlah, 0) +
    lunasRows
      .filter(
        (r) =>
          !pembayaran.some(
            (p) =>
              p.status === "Lunas" &&
              shortAlamat(p.alamat) === r.alamat &&
              p.periode === r.periode
          )
      )
      .reduce((sum, r) => sum + r.jumlah, 0);
  return {
    terkumpul,
    kepatuhan: rows.length ? (lunasRows.length / rows.length) * 100 : 0,
    tunggakan: tunggakanRows.reduce((sum, r) => sum + r.jumlah, 0),
    lunasCount: lunasRows.length,
    belumCount: rows.length - lunasRows.length,
  };
}

// ===========================================================================
// TAGIHAN TAMBAHAN (iuran kondisional) — dibuat Pengurus RT, tampil & dibayar
// di Portal Warga; statusnya terlihat kembali di Portal RT.
// ===========================================================================
export type StatusTagihanTambahan = "Belum" | "Lunas";

export interface TagihanTambahan {
  id: string;
  icon: string;
  nama: string;
  ref: string;
  nominal: number;
  /** Sisa tagihan bila sudah dibayar sebagian (dari server; hilang = penuh). */
  sisa?: number;
  tenggat: string;
  status: StatusTagihanTambahan;
  /** Tidak diisi / "semua" = tagihan seluruh hunian; selain itu alamat pendek target. */
  target?: string;
  /** Jumlah warga target (Portal RT) — progres "3/5 Lunas". */
  total?: number;
  /** Jumlah warga yang sudah lunas (Portal RT). */
  lunasCount?: number;
  /** "YYYY-MM" periode tagihan bila berbeda dari periode berjalan. */
  periode?: string;
  /** true bila seluruh hunian berpenghuni ikut ditagih (Portal RT). */
  targetSemua?: boolean;
}

export type TagihanTambahanBaru = Omit<TagihanTambahan, "id" | "icon" | "ref" | "status"> & {
  /** Tenggat ISO "YYYY-MM-DD" untuk API; `tenggat` (tampilan) dipakai mode demo. */
  tenggatIso?: string;
};

export const tagihanTambahanDefault: TagihanTambahan[] = [
  // Baris "Iuran Fogging" DIHAPUS (permintaan Okt 2026): fogging tidak lagi
  // tampil di dashboard Portal Warga — termasuk tak ada sisa tagihan residu
  // di DB dev (dibersihkan pada batch yang sama).
  { id: "k2", icon: "gavel", nama: "Iuran Perbaikan Pagar RT", ref: "INV-2026-10-PG01", nominal: 35000, tenggat: "30 Okt 2026", status: "Belum", target: "semua" },
];
