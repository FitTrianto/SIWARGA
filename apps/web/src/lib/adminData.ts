import { PaketLangganan } from "./shared";
import { KONSOL_ADMIN_AKTIF, pathTanpaDasar } from "./deploy";

// ---------------------------------------------------------------------------
// System Admin (Platform Owner) — §8 spesifikasi SIWARGA.
// Portal ini TIDAK punya tautan di UI mana pun: hanya dapat diakses dengan
// menambahkan path `/admin` di URL (mis. http://localhost:5173/admin).
// Build PUBLIK (GitHub Pages) mengeset `VITE_KONSOL_ADMIN=off` → konsol
// sysadmin dinonaktifkan sepenuhnya (portal belum berautentikasi, keputusan
// produk 1 Okt 2026) — path apa pun pun tetap mendarat di halaman awal.
// ---------------------------------------------------------------------------

/** Akses hanya via path — tidak pernah ditautkan dari halaman publik. */
export const ADMIN_PATH = "/admin";

export function pathAdmin(): boolean {
  if (!KONSOL_ADMIN_AKTIF) return false;
  if (typeof window === "undefined") return false;
  // pathTanpaDasar: pada build sub-path, `/SIWARGA/admin` → `/admin`.
  return pathTanpaDasar().toLowerCase().startsWith(ADMIN_PATH);
}

// ---------------------------------------------------------------------------
// Tenant multi-wilayah (satu tenant = satu RW beserta RT binaannya).
// ---------------------------------------------------------------------------
export type StatusTenant = "Aktif" | "Nonaktif" | "Uji Coba" | "Menunggu Pembayaran";

export interface Tenant {
  id: string;
  /** Nama resmi tenant, contoh: "RW 012 Pulo Gadung". */
  nama: string;
  kelurahan: string;
  kota: string;
  jumlahRt: number;
  jumlahKk: number;
  jumlahWarga: number;
  paket: PaketLangganan;
  status: StatusTenant;
  sejak: string;
  /** Nama pengurus yang terdaftar sebagai admin tenant. */
  admin: string;
  kontak: string;
}

export const tenantDefault: Tenant[] = [
  { id: "t1", nama: "RW 012 Pulo Gadung", kelurahan: "Pulo Gadung", kota: "Jakarta Timur", jumlahRt: 8, jumlahKk: 553, jumlahWarga: 1897, paket: "Pro", status: "Aktif", sejak: "12 Jan 2025", admin: "H. Subaidi", kontak: "+62 812-9001-1200" },
  { id: "t2", nama: "RW 003 Cakung", kelurahan: "Cakung", kota: "Jakarta Timur", jumlahRt: 6, jumlahKk: 402, jumlahWarga: 1408, paket: "Max", status: "Aktif", sejak: "03 Feb 2025", admin: "Drs. Tarno", kontak: "+62 813-2210-4455" },
  { id: "t3", nama: "RW 007 Pulogadung", kelurahan: "Pulogadung", kota: "Jakarta Timur", jumlahRt: 5, jumlahKk: 331, jumlahWarga: 1139, paket: "Pro", status: "Aktif", sejak: "18 Mar 2025", admin: "Ust. Kamaludin", kontak: "+62 857-6621-8890" },
  { id: "t4", nama: "RW 015 Kramat Jati", kelurahan: "Kramat Jati", kota: "Jakarta Timur", jumlahRt: 7, jumlahKk: 480, jumlahWarga: 1666, paket: "Pro", status: "Uji Coba", sejak: "01 Sep 2026", admin: "Siti Aminah", kontak: "+62 812-4478-0912" },
  { id: "t5", nama: "RW 021 Jatinegara", kelurahan: "Jatinegara", kota: "Jakarta Timur", jumlahRt: 4, jumlahKk: 268, jumlahWarga: 940, paket: "Free", status: "Aktif", sejak: "22 Apr 2025", admin: "Bpk. Warsito", kontak: "+62 856-9910-3321" },
  { id: "t6", nama: "RW 009 Matraman", kelurahan: "Matraman", kota: "Jakarta Timur", jumlahRt: 5, jumlahKk: 350, jumlahWarga: 1218, paket: "Free", status: "Nonaktif", sejak: "09 Jun 2025", admin: "Hj. Marhamah", kontak: "+62 811-2234-7788" },
  { id: "t7", nama: "RW 044 Pondok Kopi", kelurahan: "Pondok Kopi", kota: "Jakarta Timur", jumlahRt: 6, jumlahKk: 410, jumlahWarga: 1440, paket: "Pro", status: "Menunggu Pembayaran", sejak: "14 Jul 2025", admin: "Agus Setiawan", kontak: "+62 878-1102-5566" },
  { id: "t8", nama: "RW 006 Bekasi Barat", kelurahan: "Bekasi Barat", kota: "Kota Bekasi", jumlahRt: 9, jumlahKk: 620, jumlahWarga: 2178, paket: "Pro", status: "Aktif", sejak: "27 Agu 2025", admin: "H. Sumarno", kontak: "+62 813-7789-0044" },
  { id: "t9", nama: "RW 011 Sukmajaya", kelurahan: "Sukmajaya", kota: "Kota Depok", jumlahRt: 5, jumlahKk: 344, jumlahWarga: 1196, paket: "Free", status: "Nonaktif", sejak: "05 Nov 2025", admin: "Rina Kurniasih", kontak: "+62 852-3345-9911" },
  { id: "t10", nama: "RW 002 Cibinong", kelurahan: "Cibinong", kota: "Kab. Bogor", jumlahRt: 11, jumlahKk: 780, jumlahWarga: 2740, paket: "Max", status: "Aktif", sejak: "19 Des 2025", admin: "Dedi Supriadi", kontak: "+62 819-6677-1122" },
];

export function rekapPlatform(tenants: Tenant[]): {
  totalRw: number;
  totalRt: number;
  totalKk: number;
  totalWarga: number;
  perPaket: Record<PaketLangganan, number>;
  perStatus: Record<StatusTenant, number>;
} {
  const perPaket: Record<PaketLangganan, number> = { Free: 0, Pro: 0, Max: 0 };
  const perStatus: Record<StatusTenant, number> = { Aktif: 0, Nonaktif: 0, "Uji Coba": 0, "Menunggu Pembayaran": 0 };
  for (const t of tenants) {
    perPaket[t.paket] += 1;
    perStatus[t.status] += 1;
  }
  return {
    totalRw: tenants.length,
    totalRt: tenants.reduce((a, t) => a + t.jumlahRt, 0),
    totalKk: tenants.reduce((a, t) => a + t.jumlahKk, 0),
    totalWarga: tenants.reduce((a, t) => a + t.jumlahWarga, 0),
    perPaket,
    perStatus,
  };
}

// ---------------------------------------------------------------------------
// Transaksi langganan (pemantauan pembayaran paket Free/Pro/Max).
// ---------------------------------------------------------------------------
export type StatusTransaksi = "Lunas" | "Menunggu" | "Gagal";

export interface TransaksiLangganan {
  id: string;
  invoice: string;
  tanggal: string;
  tenantId: string;
  tenantNama: string;
  paket: PaketLangganan;
  nominal: number;
  metode: string;
  status: StatusTransaksi;
}

export const transaksiLanggananDefault: TransaksiLangganan[] = [
  { id: "tx1", invoice: "INV/2026/09/001", tanggal: "05 Sep 2026", tenantId: "t8", tenantNama: "RW 006 Bekasi Barat", paket: "Max", nominal: 249000, metode: "QRIS", status: "Lunas" },
  { id: "tx2", invoice: "INV/2026/09/002", tanggal: "02 Sep 2026", tenantId: "t2", tenantNama: "RW 003 Cakung", paket: "Max", nominal: 249000, metode: "Transfer Bank", status: "Lunas" },
  { id: "tx3", invoice: "INV/2026/08/014", tanggal: "28 Agu 2026", tenantId: "t1", tenantNama: "RW 012 Pulo Gadung", paket: "Pro", nominal: 99000, metode: "QRIS", status: "Lunas" },
  { id: "tx4", invoice: "INV/2026/08/011", tanggal: "15 Agu 2026", tenantId: "t3", tenantNama: "RW 007 Pulogadung", paket: "Pro", nominal: 99000, metode: "Virtual Account", status: "Lunas" },
  { id: "tx5", invoice: "INV/2026/09/003", tanggal: "20 Sep 2026", tenantId: "t4", tenantNama: "RW 015 Kramat Jati", paket: "Pro", nominal: 99000, metode: "QRIS", status: "Menunggu" },
  { id: "tx6", invoice: "INV/2026/09/004", tanggal: "22 Sep 2026", tenantId: "t7", tenantNama: "RW 044 Pondok Kopi", paket: "Pro", nominal: 99000, metode: "QRIS", status: "Menunggu" },
  { id: "tx7", invoice: "INV/2026/07/008", tanggal: "10 Jul 2026", tenantId: "t10", tenantNama: "RW 002 Cibinong", paket: "Max", nominal: 249000, metode: "Transfer Bank", status: "Lunas" },
  { id: "tx8", invoice: "INV/2026/03/002", tanggal: "03 Mar 2026", tenantId: "t5", tenantNama: "RW 021 Jatinegara", paket: "Free", nominal: 0, metode: "QRIS", status: "Lunas" },
  { id: "tx9", invoice: "INV/2026/09/005", tanggal: "01 Sep 2026", tenantId: "t8", tenantNama: "RW 006 Bekasi Barat", paket: "Pro", nominal: 99000, metode: "QRIS", status: "Gagal" },
  { id: "tx10", invoice: "INV/2026/02/004", tanggal: "12 Feb 2026", tenantId: "t6", tenantNama: "RW 009 Matraman", paket: "Pro", nominal: 99000, metode: "Transfer Bank", status: "Lunas" },
];

export function rekapTransaksi(list: TransaksiLangganan[]): {
  lunas: number;
  menunggu: number;
  gagal: number;
  pemasukan: number;
  tertunggak: number;
} {
  return {
    lunas: list.filter((t) => t.status === "Lunas").length,
    menunggu: list.filter((t) => t.status === "Menunggu").length,
    gagal: list.filter((t) => t.status === "Gagal").length,
    pemasukan: list.filter((t) => t.status === "Lunas").reduce((a, t) => a + t.nominal, 0),
    tertunggak: list.filter((t) => t.status !== "Lunas").reduce((a, t) => a + t.nominal, 0),
  };
}

// ---------------------------------------------------------------------------
// Audit log platform-wide (lintas tenant, §8.4).
// ---------------------------------------------------------------------------
export type KategoriAuditPlatform = "akses" | "tenant" | "langganan" | "konten" | "sistem";

export interface AuditPlatform {
  id: string;
  waktu: string;
  aktor: string;
  aksi: string;
  /** Tenant yang terdampak, atau "Platform" bila lintas-tenant. */
  target: string;
  ipAddress: string;
  kategori: KategoriAuditPlatform;
}

export const auditPlatformDefault: AuditPlatform[] = [
  { id: "ap1", waktu: "24 Sep 2026, 09:15", aktor: "admin@siwarga.id", aksi: "Login System Admin", target: "Platform", ipAddress: "103.94.20.18", kategori: "akses" },
  { id: "ap2", waktu: "23 Sep 2026, 16:42", aktor: "ops@siwarga.id", aksi: "Aktivasi Tenant", target: "RW 015 Kramat Jati", ipAddress: "103.94.20.18", kategori: "tenant" },
  { id: "ap3", waktu: "23 Sep 2026, 11:03", aktor: "system", aksi: "Notifikasi Jatuh Tempo Langganan", target: "RW 044 Pondok Kopi", ipAddress: "internal", kategori: "langganan" },
  { id: "ap4", waktu: "22 Sep 2026, 14:28", aktor: "admin@siwarga.id", aksi: "Perbarui Konten Landing Page", target: "Platform", ipAddress: "103.94.20.18", kategori: "konten" },
  { id: "ap5", waktu: "22 Sep 2026, 03:00", aktor: "system", aksi: "Backup Harian Berhasil", target: "Platform", ipAddress: "internal", kategori: "sistem" },
  { id: "ap6", waktu: "21 Sep 2026, 10:11", aktor: "cs@siwarga.id", aksi: "Verifikasi Pembayaran Langganan", target: "RW 006 Bekasi Barat", ipAddress: "182.253.44.90", kategori: "langganan" },
  { id: "ap7", waktu: "20 Sep 2026, 08:54", aktor: "ops@siwarga.id", aksi: "Nonaktifasi Tenant", target: "RW 011 Sukmajaya", ipAddress: "103.94.20.18", kategori: "tenant" },
  { id: "ap8", waktu: "19 Sep 2026, 21:37", aktor: "system", aksi: "Pembaruan Basis Data Selesai", target: "Platform", ipAddress: "internal", kategori: "sistem" },
  { id: "ap9", waktu: "18 Sep 2026, 13:22", aktor: "admin@siwarga.id", aksi: "Reset Password Admin Tenant", target: "RW 009 Matraman", ipAddress: "103.94.20.18", kategori: "akses" },
  { id: "ap10", waktu: "17 Sep 2026, 15:09", aktor: "cs@siwarga.id", aksi: "Provisioning Tenant Baru", target: "RW 015 Kramat Jati", ipAddress: "182.253.44.90", kategori: "tenant" },
];

export function badgeKategoriAudit(k: KategoriAuditPlatform): string {
  switch (k) {
    case "akses": return "bg-sky-100 text-sky-800";
    case "tenant": return "bg-primary-container text-on-primary-container";
    case "langganan": return "bg-amber-100 text-amber-800";
    case "konten": return "bg-violet-100 text-violet-800";
    case "sistem": return "bg-surface-container-high text-on-surface-variant";
  }
}

export function catatanLabel(k: KategoriAuditPlatform): string {
  switch (k) {
    case "akses": return "Akses & Identitas";
    case "tenant": return "Kelola Tenant";
    case "langganan": return "Langganan";
    case "konten": return "Konten";
    case "sistem": return "Sistem";
  }
}

// ---------------------------------------------------------------------------
// Kesehatan sistem (§8.5).
// ---------------------------------------------------------------------------
export type StatusLayanan = "Sehat" | "Degradasi" | "Gangguan";

export interface LayananSistem {
  id: string;
  nama: string;
  status: StatusLayanan;
  /** Uptime 30 hari terakhir dalam persen. */
  uptime: number;
  /** Latensi rata-rata dalam milidetik. */
  latensi: number;
  catatan: string;
}

export interface MetrikSistem {
  uptime30Hari: number;
  penggunaAktifHariIni: number;
  antreanNotifikasi: number;
  ukuranBasisData: string;
  backupTerakhir: string;
  cpu: number;
  memori: number;
  penyimpanan: number;
}

export const layananSistemDefault: LayananSistem[] = [
  { id: "ls1", nama: "API Gateway", status: "Sehat", uptime: 99.96, latensi: 142, catatan: "Respons normal, tanpa galat 5xx 24 jam terakhir." },
  { id: "ls2", nama: "Basis Data Utama (PostgreSQL)", status: "Sehat", uptime: 99.99, latensi: 38, catatan: "Replasi sinkron, kueri rata-rata di bawah ambang." },
  { id: "ls3", nama: "Penyimpanan Objek (Bukti & PDF)", status: "Sehat", uptime: 99.93, latensi: 96, catatan: "Kuota 38% terpakai dari total 500 GB." },
  { id: "ls4", nama: "Gerbang WhatsApp Gateway", status: "Degradasi", uptime: 98.72, latensi: 812, catatan: "Antrean pengingat iuran melambat — mitra pelaporan sedang ditangani." },
  { id: "ls5", nama: "Webhook QRIS", status: "Sehat", uptime: 99.88, latensi: 210, catatan: "Semua callback pembayaran terkonfirmasi." },
  { id: "ls6", nama: "Server Backup Harian", status: "Sehat", uptime: 100, latensi: 0, catatan: "Backup terakhir berhasil pukul 03.00 WIB." },
];

export const metrikSistemDefault: MetrikSistem = {
  uptime30Hari: 99.87,
  penggunaAktifHariIni: 2415,
  antreanNotifikasi: 37,
  ukuranBasisData: "42,7 GB",
  backupTerakhir: "24 Sep 2026, 03.00 WIB",
  cpu: 34,
  memori: 61,
  penyimpanan: 38,
};

// ---------------------------------------------------------------------------
// Kelola konten Landing Page (§8.2 P1): info produk, harga, peta masalah
// per persona. Seed menyalin persis copy landing agar tampilan awal tidak
// berubah — admin cukup mengubah teks yang diinginkan.
// ---------------------------------------------------------------------------
export interface KontenLanding {
  hero: {
    badge: string;
    judulAwal: string;
    judulAksen: string;
    sub: string;
  };
  fitur: { judul: string; deskripsi: string }[];
  harga: { nama: string; harga: string; satuan: string; deskripsi: string }[];
  persona: { judul: string; masalah: string; solusi: string; footer: string }[];
}

export const kontenLandingDefault: KontenLanding = {
  hero: {
    badge: "Pelayanan Rukun Tetangga & Rukun Warga",
    judulAwal: "Administrasi RT & RW Jadi Mudah, Cepat, dan",
    judulAksen: "Transparan.",
    sub: "Platform digital terpadu untuk warga, pengurus RT/RW, hingga kelurahan. Kelola pembukuan kas otomatis, iuran warga tanpa ribet, surat digital ber-QR code, dan transparansi lingkungan dalam satu genggaman.",
  },
  fitur: [
    {
      judul: "Buku Kas Append-Only & Alokasi FIFO",
      deskripsi: "Pencatatan kas anti-manipulasi dengan riwayat append-only. Iuran bulanan warga teralokasi otomatis dengan metode First-In First-Out sehingga tidak ada tunggakan terlewat.",
    },
    {
      judul: "Pengingat WhatsApp Otomatis",
      deskripsi: "Kirim invoice dan kuitansi iuran langsung ke nomor WhatsApp warga tanpa perlu simpan nomor kontak satu per satu. Dilengkapi tombol bayar dan cek mutasi langsung.",
    },
    {
      judul: "Masking NIK & Kepatuhan UU PDP",
      deskripsi: "Melindungi data sensitif warga. NIK 16 digit otomatis tersensor (3171••••0004). Unmasking hanya untuk pengurus berwenang dan tercatat di audit trail.",
    },
    {
      judul: "Surat Pengantar Digital & QR TTE",
      deskripsi: "Pembuatan Surat Pengantar KTP, Nikah, Domisili, dan Kematian mandiri via web. Ditandatangani digital oleh Ketua RT dan tervalidasi publik via scan QR code.",
    },
    {
      judul: "Laporan Keuangan Transparan Warga",
      deskripsi: "Tingkatkan rasa saling percaya. Setiap pengeluaran kas RT dilengkapi foto bukti kuitansi nota yang dapat dilihat warga secara akuntabel dan transparan.",
    },
    {
      judul: "Sensus & Rekapitulasi KK Instan",
      deskripsi: "Rekam status rumah (milik/sewa/kontrak), lansia, balita, hingga penerima bansos. Ekspor ke Excel & PDF resmi format Kemendagri dalam satu klik.",
    },
  ],
  harga: [
    {
      nama: "Paket Free",
      harga: "Rp 0",
      satuan: " / bulan / RT",
      deskripsi: "Untuk RT yang baru mulai melangkah ke digitalisasi administrasi lingkungan.",
    },
    {
      nama: "Paket Pro",
      harga: "Rp 99.000",
      satuan: " / bulan / RT",
      deskripsi: "Untuk RT & RW aktif dengan operasional penuh, pengingat WhatsApp, dan surat TTE.",
    },
    {
      nama: "Paket Max",
      harga: "Kustom",
      satuan: " / paket wilayah",
      deskripsi: "Untuk RW besar, kawasan perumahan mandiri, atau kemitraan tingkat Kelurahan / Desa.",
    },
  ],
  persona: [
    {
      judul: "Warga & Penghuni",
      masalah: '"Bingung iuran sudah dicatat atau tercecer, canggung menagih kuitansi, dan antre minta surat ke rumah Pak RT waktu jam kerja."',
      solusi: "Akses portal warga tanpa instal aplikasi. Cek buku iuran mandiri 24 jam, bayar via QRIS/Transfer, dan unduh Surat Pengantar PDF ber-QR code instan.",
      footer: "Portal Mobile Warga Mandiri",
    },
    {
      judul: "Pengurus RT",
      masalah: '"Pembukuan buku kas manual rentan selisih, sungkan nagih door-to-door, dan waktu istirahat terganggu ketukan pintu pemohon surat."',
      solusi: "Sistem pembukuan kas otomatis sistem FIFO, pengingat iuran ramah via WhatsApp, serta persetujuan surat hanya dengan satu ketukan tombol di HP.",
      footer: "Otomasi Buku Kas & WhatsApp",
    },
    {
      judul: "Pengurus RW",
      masalah: '"Format laporan tiap RT berbeda-beda, sulit memantau RT yang tertib vs menunggak, serta tidak ada rekapan kependudukan real-time."',
      solusi: "Dasbor agregat terpusat menyajikan metrik kepatuhan semua RT binaan, data agregat KK/warga terpadu, dan standarisasi penomoran surat resmi.",
      footer: "Dasbor Konsolidasi Multi-RT",
    },
    {
      judul: "Kelurahan & Desa",
      masalah: '"Lambatnya kompilasi profil data warga saat bansos, validasi manual surat pengantar rentan dipalsukan atau tidak sinkron."',
      solusi: "Arsip digital interoperable, verifikasi QR surat pengantar terhubung ke database kelurahan, dan statistik demografi akurat untuk kebijakan publik.",
      footer: "Ekspor Agregat & Validasi Instan",
    },
  ],
};

// ---------------------------------------------------------------------------
// Badge bersama agar konsisten di seluruh halaman Admin.
// ---------------------------------------------------------------------------
export function badgeStatusTenant(status: StatusTenant): string {
  switch (status) {
    case "Aktif": return "bg-primary-container text-on-primary";
    case "Nonaktif": return "bg-error-container text-on-error";
    case "Uji Coba": return "bg-sky-100 text-sky-800";
    case "Menunggu Pembayaran": return "bg-amber-100 text-amber-800";
  }
}

export function badgePaket(paket: PaketLangganan): string {
  switch (paket) {
    case "Free": return "bg-surface-container-high text-on-surface-variant";
    case "Pro": return "bg-primary-container text-on-primary";
    case "Max": return "bg-tertiary-container text-on-tertiary";
  }
}

export function badgeStatusTransaksi(status: StatusTransaksi): string {
  switch (status) {
    case "Lunas": return "bg-primary-container text-on-primary";
    case "Menunggu": return "bg-amber-100 text-amber-800";
    case "Gagal": return "bg-error-container text-on-error";
  }
}

export function badgeStatusLayanan(status: StatusLayanan): string {
  switch (status) {
    case "Sehat": return "bg-primary-container text-on-primary";
    case "Degradasi": return "bg-amber-100 text-amber-800";
    case "Gangguan": return "bg-error-container text-on-error";
  }
}
