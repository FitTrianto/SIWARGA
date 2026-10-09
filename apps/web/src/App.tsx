import { useEffect, useRef, useState } from "react";
import { LandingPage } from "./pages/LandingPage";
import { LoginPage } from "./pages/LoginPage";
import {
  ajukanBuktiIuran,
  ajukanPerubahanKeluarga,
  ajukanSuratWarga,
  ambilKeluargaWarga,
  anggotaKeFamilyMember,
  barisKePembayaran,
  barisServerKeWargaRt,
  barisSuratServerKeFe,
  buatKondisionalRt,
  buatSuratRt,
  buatUndanganRt,
  cabutUndanganRt,
  catatKasRt,
  daftarAjuanPerubahanRt,
  daftarHunianRt,
  bukaBukuIuranRt,
  daftarKasRt,
  daftarKondisionalRt,
  daftarSuratRt,
  daftarUndanganRt,
  daftarWargaRt,
  entriKeKasRt,
  GalatApi,
  generateTagihanRt,
  hapusBanyakHunianRt,
  hapusHunianRt,
  hapusWargaRt,
  hunianServerKeHunian,
  hunianWarga,
  imporWargaRt,
  inspeksiUndanganRt,
  kategoriIuranRt,
  kategoriKasKeServer,
  keluargaKeKkData,
  kirimUlangUndanganRt,
  kondisionalRtKeKartu,
  kondisionalWarga,
  kondisionalWargaKeKartu,
  koreksiKasRt,
  labelKeIso,
  logoutPengurus,
  logoutWarga,
  metodeKeServer,
  patchKontakKeFe,
  pembayaranRt,
  pengaturanIuranRt,
  pengaturanSuratRt,
  profilIuranRt,
  prosesSuratRt,
  riwayatIuran,
  riwayatLoginWarga,
  setujuiPembayaranRt,
  simpanKontakKeluarga,
  simpanPengaturanIuranRt,
  simpanPengaturanSuratRt,
  simpanProfilIuranRt,
  suratWarga,
  tambahAnggotaKk,
  tambahHunianRt,
  tambahKategoriRt,
  tambahWargaRt,
  tagihanIuran,
  tagihanRtServer,
  tolakPembayaranRt,
  tutupBukuIuranRt,
  ubahAksesWargaRt,
  ubahHunianRt,
  ubahKategoriRt,
  ubahKendaraanR4Warga,
  ubahNominalTagihanRt,
  ubahWargaRt,
  undanganServerKeUndangan,
  verifikasiAjuanPerubahanRt,
  type AksiSuratRt,
  type AnggotaBaruServer,
  type BarisProfilIuran,
  type BarisSuratServer,
  type BarisWargaRtServer,
  type EntriRiwayatLogin,
  type HasilGenerateTagihan,
  type HasilHapusHunian,
  type HasilImporWarga,
  type HunianServer,
  type KeluargaRingkasServer,
  type KategoriIuranServer,
  type PatchKontakKeluarga,
  type PatchWargaRt,
  type PengaturanIuranRt,
  type PengaturanSuratRt,
  type ProfilLogin,
  type RingkasTagihanServer,
  type StatusAksesServer,
  type StatusTutupBukuIuran,
  type TambahHunianRtPayload,
  type TambahKategoriRtPayload,
  type TambahWargaRtPayload,
  type TemuanInspeksiUndangan,
} from "./lib/api";
import { KonfirmasiDialog } from "./components/KonfirmasiDialog";
import { SyaratKetentuanPage } from "./pages/Legal/SyaratKetentuan";
import { KebijakanPrivasiPage } from "./pages/Legal/KebijakanPrivasi";
import { PortalWarga } from "./pages/PortalWarga/PortalWarga";
import { DataKeluarga } from "./pages/PortalWarga/DataKeluarga";
import { IuranTagihan } from "./pages/PortalWarga/IuranTagihan";
import { PengajuanSurat } from "./pages/PortalWarga/PengajuanSurat";
import { RiwayatAktivitas } from "./pages/PortalWarga/RiwayatAktivitas";
import { PortalWargaLayout } from "./pages/PortalWarga/PortalWargaLayout";
import { PortalRTLayout } from "./pages/PortalRT/PortalRTLayout";
import { DashboardRT } from "./pages/PortalRT/DashboardRT";
import { DataHunianRT } from "./pages/PortalRT/DataHunianRT";
import { DataWargaRT } from "./pages/PortalRT/DataWargaRT";
import { IuranRT } from "./pages/PortalRT/IuranRT";
import { KasRT } from "./pages/PortalRT/KasRT";
import { SuratPengantarRT } from "./pages/PortalRT/SuratPengantarRT";
import { LaporanBulananRT } from "./pages/PortalRT/LaporanBulananRT";
import { AuditLogPDP } from "./pages/PortalRT/AuditLogPDP";
import { PengaturanRT } from "./pages/PortalRT/PengaturanRT";
import { PortalRWLayout } from "./pages/PortalRW/PortalRWLayout";
import { DashboardRW } from "./pages/PortalRW/DashboardRW";
import { IuranRW } from "./pages/PortalRW/IuranRW";
import { KasRW } from "./pages/PortalRW/KasRW";
import { VerifikasiSuratRW } from "./pages/PortalRW/VerifikasiSuratRW";
import { AksesDetailRW } from "./pages/PortalRW/AksesDetailRW";
import { RiwayatRW } from "./pages/PortalRW/RiwayatRW";
import { LaporanRW } from "./pages/PortalRW/LaporanRW";
import { PengaturanRW } from "./pages/PortalRW/PengaturanRW";
import { AdminLayout } from "./pages/Admin/AdminLayout";
import { DashboardAdmin } from "./pages/Admin/DashboardAdmin";
import { LanggananAdmin } from "./pages/Admin/LanggananAdmin";
import { TenantAdmin } from "./pages/Admin/TenantAdmin";
import { KontenAdmin } from "./pages/Admin/KontenAdmin";
import { AuditAdmin } from "./pages/Admin/AuditAdmin";
import { SistemAdmin } from "./pages/Admin/SistemAdmin";
import { UndanganPage } from "./pages/Undangan/UndanganPage";
import { VerifikasiSuratPage } from "./pages/VerifikasiSuratPage";
import { AktivasiRtPage } from "./pages/AktivasiRtPage";
import { tenant } from "./lib/tenant";
import {
  Tenant, tenantDefault,
  TransaksiLangganan, transaksiLanggananDefault,
  AuditPlatform, auditPlatformDefault,
  LayananSistem, layananSistemDefault,
  MetrikSistem, metrikSistemDefault,
  KontenLanding, kontenLandingDefault,
  pathAdmin,
} from "./lib/adminData";
import { KONSOL_ADMIN_AKTIF, dasarDeploy } from "./lib/deploy";
import {
  KategoriIuran, kategoriIuranDefault,
  Pembayaran, pembayaranDefault,
  Pengurus, pengurusDefault,
  Langganan, langgananDefault,
  shortAlamat, digitsOnly,
  Surat, suratDefault,
  KopSurat, suratPerluRw, noSuratOtomatis, StatusSurat,
  PermintaanAkses, aksesDefault, MIN_JUSTIFIKASI,
  KasRw, kasRwDefault,
  AuditEntry, auditDefault, badgeAksi, badgePortal,
  waktuSekarang, hariIni, tanggalPlusHari,
  KkData,
  PERIODE_AKTIF,
  WargaRt, wargaRtDefault,
  HunianRumah, hunianDefault,
  KasRt, kasRtDefault,
  TagihanTambahan, tagihanTambahanDefault, TagihanTambahanBaru,
  AjuanPerubahan, AjuanPerubahanRt, JenisAjuan, StatusAjuan,
  ajuanPerubahanDefault,
  tokenQrDariPath,
} from "./lib/shared";
import {
  Undangan, undanganDefault,
  buatToken, tokenDariPath, tokenAktivasiRtDariPath, empatDigitAkhir, tanggalPendek,
} from "./lib/undangan";

type Page =
  | "landing" | "login"
  | "portal-warga" | "data-keluarga" | "iuran-tagihan" | "pengajuan-surat" | "riwayat-aktivitas"
  | "dashboard-rt" | "data-hunian-rt" | "data-warga-rt" | "iuran-rt" | "kas-rt"
  | "surat-pengantar-rt" | "laporan-bulanan-rt" | "audit-log-pdp" | "pengaturan-rt"
  | "dashboard-rw" | "iuran-rw" | "kas-rw" | "surat-rw" | "akses-rw"
  | "riwayat-rw" | "laporan-rw" | "pengaturan-rw"
  | "dashboard-admin" | "langganan-admin" | "tenant-admin"
  | "konten-admin" | "audit-admin" | "sistem-admin"
  | "syarat-ketentuan" | "kebijakan-privasi"
  | "undangan-publik" | "verifikasi-surat"
  | "aktivasi-rt";

// Gerbang peran (§5.0): setiap halaman portal punya pemilik peran — halaman
// hanya terbuka bila `peranMasuk` cocok. Tanpa ini, sesi warga/RW/admin bisa
// melihat halaman Portal RT (mis. lewat tombol kembali undangan) lalu gagal
// dengan galat guard yang membingungkan saat menyimpan.
const PORTAL_HALAMAN: Partial<Record<Page, "warga" | "rt" | "rw">> = {
  "portal-warga": "warga",
  "data-keluarga": "warga",
  "iuran-tagihan": "warga",
  "pengajuan-surat": "warga",
  "riwayat-aktivitas": "warga",
  "dashboard-rt": "rt",
  "data-hunian-rt": "rt",
  "data-warga-rt": "rt",
  "iuran-rt": "rt",
  "kas-rt": "rt",
  "surat-pengantar-rt": "rt",
  "laporan-bulanan-rt": "rt",
  "audit-log-pdp": "rt",
  "pengaturan-rt": "rt",
  "dashboard-rw": "rw",
  "iuran-rw": "rw",
  "kas-rw": "rw",
  "surat-rw": "rw",
  "akses-rw": "rw",
  "riwayat-rw": "rw",
  "laporan-rw": "rw",
  "pengaturan-rw": "rw",
};

/** Halaman tujuan bila gerbang peran mengalihkan sesi ke portal miliknya. */
const BERANDA_PORTAL: Record<"warga" | "rt" | "rw", Page> = {
  warga: "portal-warga",
  rt: "dashboard-rt",
  rw: "dashboard-rw",
};

const initialKkList: KkData[] = [
  {
    id: "kk1",
    noKk: "3171-xxxx-xxxx-0988",
    kepala: "Bambang Supriyanto",
    alamat: `Blok B4 No. 12, ${tenant.label}`,
    anggota: [
      {
        name: "Bambang Supriyanto", initials: "BS", role: "Kepala Keluarga", filter: "kepala",
        gender: "Laki-laki", age: 52, birthDate: "14 Mei 1972",
        nik: "3171-xxxx-xxxx-0004", nikFull: "3171051405720004",
        relation: "Kepala Keluarga", job: "Karyawan Swasta",
        wa: "+62 812-3456-7890", email: "bambang.supriyanto@gmail.com",
        blood: "O (Rhesus +)", agama: "Islam", statusPernikahan: "Menikah",
        statusNote: "Terdaftar Aktif di DKB Ditjen Dukcapil",
        statusIcon: "verified", statusColor: "text-secondary",
        avatar: "https://lh3.googleusercontent.com/aida-public/AB6AXuCTUZo61na-G0petq_ViSUWDM11glUb9JnNFCYcMwmq3TcgnaKiAHbHeq8sAx6Y_cq1QODcOAxGIRrS6x35NHAZMZ3S2K3UU4u2z1eTs30B4dKOTnrSbXMkuIh5zJ5V2nDwCOF9rNgAh7-bHgVYcRreDVxttbS-OHBoFfHwI9oMioqELpwqEO7eQ0j_loRz8Yn_sQv1RCrcRchse3wx5cPhhJPs9djqSyHijlAXjXN63zze-lx7OW3d",
        ringColor: "ring-primary-fixed",
      },
      {
        name: "Siti Rahmawati", initials: "SR", role: "Istri", filter: "istri",
        gender: "Perempuan", age: 48, birthDate: "22 Agustus 1976",
        nik: "3171-xxxx-xxxx-1120", nikFull: "3171052208761120",
        relation: "Istri", job: "Wirausaha / Mandiri",
        wa: "+62 813-9876-5432", email: "siti.rahmawati@gmail.com",
        blood: "B (Rhesus +)", agama: "Islam", statusPernikahan: "Menikah",
        statusNote: "Kontak Darurat Utama Keluarga",
        statusIcon: "check_circle", statusColor: "text-secondary",
        avatar: "https://lh3.googleusercontent.com/aida-public/AB6AXuCS5u9Uv4U9RD4qSqRNZHv1msUO-at3KOjRTH9p60L1D_zU3eba_LHUscQiY3ztVZ4tlRcBmgEnnf99nC8LdTzIOzbrpy7tzBqrwmdK-rBEBpHA2-qhgPcR6O3h-VC7VwzOmvntmc6bBnldPr-VMbdn-7uLvTAHc-PtVIBkukk5G5jYkSCKW2L4WQoifjpsxLAIMU9ZWpCm9aq703HO114XsmYkJc1vLrgy7g-DKzAO-XXaBasqIJPA",
        ringColor: "ring-secondary-container",
      },
      {
        name: "Dimas Supriyanto", initials: "DS", role: "Anak Kandung", filter: "anak",
        gender: "Laki-laki", age: 21, birthDate: "10 Januari 2003",
        nik: "3171-xxxx-xxxx-3341", nikFull: "3171051001033341",
        relation: "Anak ke-1", job: "Mahasiswa / Magang",
        wa: "+62 857-1122-3344", email: "dimas.supriyanto@gmail.com",
        blood: "O (Rhesus +)", agama: "Islam", statusPernikahan: "Belum Menikah",
        statusNote: "Pemegang e-KTP Aktif Mandiri",
        statusIcon: "school", statusColor: "text-primary",
        avatar: "https://lh3.googleusercontent.com/aida-public/AB6AXuCPI6Jd0ozgqcAqB7dviFeyJFAzyQwpVN2jsjGpXR8S3_nky2z3jTdU5Vum3LVhar7OS0aKnIvo87M199fZE2CLxa_lyb7mqD-ecbFgTew6CzewMkbtpuDezYxIBrGrQWvcNsRiPHdObGUOjw6FzJFMcyuLf4h42nz5O6uaufJ9fl6HFc9328metuo_aIct2c_eV0B6JfzfvkV5K7TmtP6NZURuMtpd-rsgH28w6qSrYcQ1CAQcPbo3",
        ringColor: "ring-surface-variant",
      },
      {
        name: "Anisa Supriyanto", initials: "AS", role: "Anak Kandung", filter: "anak",
        gender: "Perempuan", age: 17, birthDate: "05 Maret 2007",
        nik: "3171-xxxx-xxxx-7822", nikFull: "3171050503077822",
        relation: "Anak ke-2", job: "Pelajar SMA / Sederajat",
        wa: "+62 856-9988-7711", email: "anisa.supriyanto@gmail.com",
        blood: "A (Rhesus +)", agama: "Islam", statusPernikahan: "Belum Menikah",
        statusNote: "NIK Baru Diperbarui & Disetujui RT (Sep 2026)",
        statusIcon: "task_alt", statusColor: "text-secondary",
        avatar: "https://lh3.googleusercontent.com/aida-public/AB6AXuCwhHKOe87oaucdauUbIp_eMPt2nYXU-FWW35Vb48EZJqDjKp7UaryTk1GH5EzqiPRN9rumUjsyfpmfUY1bAIHAiM26uYVyd3fy4jxqRwYl40XLRCcDTfHVNSfEmEJBmfc6ByGD0j452Kp9_CbQ7MLZt5CihrkLPRnrLPmuJSUfxHQOnIUnVelVjOEQS2YvLDSe-NeKQr4u-Ehn3_9Im_7zOq2RWs0hdVVKpKeZd0DEwosClttd3q-O",
        ringColor: "ring-surface-variant",
      },
    ],
  },
];

/**
 * B12 · gabung baris surat FE dengan baris server (§6.6). Baris FE yang punya
 * `serverId` cocok → diperbarui dari server (id FE dipertahankan sebagai kunci
 * React; `noKk` sesi dipertahankan/dipaksa bila `noKkSesi` diisi agar filter
 * Portal Warga tetap menangkap baris dengan format No. KK yang berbeda);
 * baris server yang belum ada disisipkan di depan; baris demo tanpa `serverId`
 * tidak dibuang agar mode OFFLINE tetap menampilkan data contoh.
 */
function gabungSuratServer(
  daftar: Surat[],
  server: BarisSuratServer[],
  noKkSesi?: string | null,
): Surat[] {
  const peta = new Map(server.map((b) => [b.id, b]));
  const tersambung = new Set<string>();
  const diperbarui = daftar.map((s) => {
    const b = s.serverId ? peta.get(s.serverId) : undefined;
    if (!b) return s;
    tersambung.add(b.id);
    const segar: Surat = { ...s, ...barisSuratServerKeFe(b), id: s.id };
    if (noKkSesi) return { ...segar, noKk: noKkSesi };
    return s.noKk ? { ...segar, noKk: s.noKk } : segar;
  });
  const tambahan = server
    .filter((b) => !tersambung.has(b.id))
    .map((b) => {
      const r = barisSuratServerKeFe(b);
      return noKkSesi ? { ...r, noKk: noKkSesi } : r;
    });
  return [...tambahan, ...diperbarui];
}

/**
 * B12 · perbarui SATU baris FE dari baris server (dipakai setelah create/aksi
 * persuratan) — id & `noKk` FE dipertahankan agar kunci React dan filter
 * Portal Warga tidak berganti di tengah jalan.
 */
function perbaruiSuratServer(prev: Surat[], idLokal: string, b: BarisSuratServer): Surat[] {
  return prev.map((s) => {
    if (s.id !== idLokal) return s;
    const segar: Surat = { ...s, ...barisSuratServerKeFe(b), id: s.id };
    return s.noKk ? { ...segar, noKk: s.noKk } : segar;
  });
}

export default function App() {
  // Portal System Admin hanya dapat diakses dengan menambahkan path /admin
  // di URL — tidak ada tautan ke portal ini dari halaman mana pun (§8).
  // Halaman undangan publik dibuka lewat path /undangan/<token> via link/QR.
  const [tokenUndangan] = useState<string | null>(() => tokenDariPath());
  // Halaman publik verifikasi surat (/q/<token>) — dibuka lewat pemindaian QR
  // pada surat terbit, tanpa sesi & tanpa layout portal (§5.7).
  const [tokenQrSurat] = useState<string | null>(() => tokenQrDariPath());
  // Halaman publik aktivasi pendaftaran mandiri (/aktivasi-rt/<token>) —
  // dibuka dari tautan yang diterima setelah formulir Landing Page terkirim.
  const [tokenAktivasiRt] = useState<string | null>(() => tokenAktivasiRtDariPath());
  const [page, setPage] = useState<Page>(() =>
    tokenAktivasiRtDariPath()
      ? "aktivasi-rt"
      : tokenDariPath()
      ? "undangan-publik"
      : tokenQrDariPath()
      ? "verifikasi-surat"
      : pathAdmin()
      ? "dashboard-admin"
      : "landing"
  );
  // Halaman tempat tautan dokumen hukum diklik — tombol "Kembali" mengembalikan
  // pengguna ke sana (landing atau portal yang sedang dibuka).
  const [halamanSebelumnya, setHalamanSebelumnya] = useState<Page>("landing");
  // Peran yang sedang masuk — dipilih endpoint sesi mana yang dicabut saat logout.
  const [peranMasuk, setPeranMasuk] = useState<"warga" | "rt" | "rw" | null>(null);
  // Profil login sesi berjalan (nama/jabatan dari respons login, `modeDemo`
  // saat masuk offline) — header & sapaan portal SELALU sama dengan data
  // login (Okt 2026: "Profile login harus sesuai dengan data login").
  const [profilSesi, setProfilSesi] = useState<ProfilLogin | null>(null);
  // Keterangan untuk halaman masuk (mis. sesi habis terdeteksi saat memuat data).
  const [pesanSesi, setPesanSesi] = useState<string | null>(null);
  // B3 · konfirmasi keluar — `logout()` hanya MEMBUKA dialog ini, sehingga
  // keempat layout (Warga/RT/RW/Admin) berbagi satu titik konfirmasi tanpa
  // state sendiri-sendiri.
  const [konfirmasiKeluar, setKonfirmasiKeluar] = useState(false);
  // B3 · peringatan sesi diam — tampil ±1 menit sebelum auto-logout 30 menit.
  const [peringatanSesi, setPeringatanSesi] = useState(false);
  // Waktu aktivitas pointer/keyboard terakhir — diukur pengukur sesi diam.
  const aktivitasRef = useRef<number>(Date.now());
  // Batch 9 · Bug A — generasi pemuatan data sesi RT. Setiap permintaan muat
  // ulang menaikkan nomor; hasil permintaan LAMA yang terlambat datang lalu
  // diabaikan (tak menimpa data sesi yang lebih baru). Dinaikkan juga saat
  // peran berakhir/berganti supaya pemuatan yang masih berjalan gugur.
  const generasiMuatRtRef = useRef(0);
  // Tanda server RT benar-benar menjawab (GET pertama sukses) — polling 45 dtk
  // hanya berjalan selama ini `true`; OFFLINE → `false` & polling berhenti
  // supaya mode demo tidak membanjiri server/jaringan dengan galat percuma.
  const rtServerSehatRef = useRef(true);
  const [kkList, setKkList] = useState<KkData[]>(initialKkList);
  const [kendaraanR4Count, setKendaraanR4Count] = useState(1);

  // State bersama Portal Warga ↔ Portal RT (sinkron dua arah).
  const [kategoriIuran, setKategoriIuran] = useState<KategoriIuran[]>(kategoriIuranDefault);
  const [pembayaran, setPembayaran] = useState<Pembayaran[]>(pembayaranDefault);
  // F-6 · ringkas tagihan warga login dari API — `null` = mode demo/offline
  // (status diturunkan dari riwayat lokal); bila terisi, API jadi sumber status
  // Lunas / Menunggu Verifikasi / Belum Dibayar + nominal yang masih harus dibayar.
  const [ringkasTagihanWarga, setRingkasTagihanWarga] = useState<
    RingkasTagihanServer["ringkas"] | null
  >(null);
  const [pengurus, setPengurus] = useState<Pengurus[]>(pengurusDefault);
  const [langganan, setLangganan] = useState<Langganan>(langgananDefault);

  // State bersama lintas-portal: surat (Warga ↔ RT ↔ RW), akses detail (RW ↔ RT),
  // kas RW (append-only), dan audit log (semua akses wajib tercatat, §7.5).
  const [suratList, setSuratList] = useState<Surat[]>(suratDefault);
  const [aksesList, setAksesList] = useState<PermintaanAkses[]>(aksesDefault);
  const [kasRwList, setKasRwList] = useState<KasRw[]>(kasRwDefault);
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>(auditDefault);

  // Undangan portal warga (link & QR invitation) — dibagikan ke Portal RT
  // (pengirim) dan halaman publik /undangan/<token>: mode produksi memuat
  // detail dari API lalu warga buat kata sandi; mode demo (backend mati)
  // konfirmasi 4 digit terakhir no. HP.
  const [undanganList, setUndanganList] = useState<Undangan[]>(undanganDefault);

  // State bersama data pokok RT: warga, hunian, kas RT, tagihan tambahan.
  // Semua halaman turunan membaca state ini — input di satu halaman langsung
  // terlihat di halaman lain, tanpa seed lokal kedua.
  const [wargaRtList, setWargaRtList] = useState<WargaRt[]>(wargaRtDefault);
  const [hunianList, setHunianList] = useState<HunianRumah[]>(hunianDefault);
  const [kasRtList, setKasRtList] = useState<KasRt[]>(kasRtDefault);
  // F-5 · B11/B20: ajuan perubahan resmi — panel Portal Warga (default = data
  // demo, diganti respons server saat daring) & antrean verifikasi Portal RT
  // (kosong sampai dimuat; RT tidak punya data demo ajuan).
  const [ajuanWarga, setAjuanWarga] = useState<AjuanPerubahan[]>(ajuanPerubahanDefault);
  const [ajuanRt, setAjuanRt] = useState<AjuanPerubahanRt[]>([]);
  const [tagihanTambahanList, setTagihanTambahanList] = useState<TagihanTambahan[]>(tagihanTambahanDefault);

  // State khusus System Admin (platform-wide, lintas tenant §8).
  const [adminTenants, setAdminTenants] = useState<Tenant[]>(tenantDefault);
  const [adminTransaksi] = useState<TransaksiLangganan[]>(transaksiLanggananDefault);
  const [auditPlatform, setAuditPlatform] = useState<AuditPlatform[]>(auditPlatformDefault);
  const [layananSistem] = useState<LayananSistem[]>(layananSistemDefault);
  const [metrikSistem] = useState<MetrikSistem>(metrikSistemDefault);
  const [kontenLanding, setKontenLanding] = useState<KontenLanding>(kontenLandingDefault);

  // Catat aksi admin ke audit log platform-wide.
  const catatAuditPlatform = (
    e: Omit<AuditPlatform, "id" | "waktu" | "ipAddress"> & { ipAddress?: string }
  ) => {
    setAuditPlatform((prev) => [
      { ipAddress: "103.94.20.18", ...e, id: `ap${Date.now()}`, waktu: waktuSekarang() },
      ...prev,
    ]);
  };

  // Aktivasi/nonaktivasi tenant (P0 §8.3) — selalu tercatat di audit platform.
  const toggleTenant = (id: string) => {
    const t = adminTenants.find((x) => x.id === id);
    if (!t) return;
    const aktif = t.status !== "Nonaktif";
    setAdminTenants((prev) =>
      prev.map((x) => (x.id === id ? { ...x, status: aktif ? "Nonaktif" : "Aktif" } : x))
    );
    catatAuditPlatform({
      aktor: "admin@siwarga.id",
      aksi: aktif ? "Nonaktifasi Tenant" : "Aktivasi Tenant",
      target: t.nama,
      kategori: "tenant",
    });
  };

  // Simpan perubahan konten landing page (P1 §8.2).
  const simpanKontenLanding = (k: KontenLanding) => {
    setKontenLanding(k);
    catatAuditPlatform({
      aktor: "admin@siwarga.id",
      aksi: "Perbarui Konten Landing Page",
      target: "Platform",
      kategori: "konten",
    });
  };

  // Nilai turunan: alamat pendek hunian warga yang login (pemilik tagihan iuran).
  const alamatWarga = shortAlamat(kkList[0]?.alamat ?? "");
  // B12 · penandatangan surat pengantar — pemakaian bersama preview Portal RT
  // dan unduhan PDF Portal Warga supaya blok TTD selalu identik.
  const ketuaRt =
    pengurus.find((p) => p.jabatan.toLowerCase().includes("ketua")) ?? pengurus[0];

  /**
   * Galat `UNAUTHORIZED` dari API = sesi sudah habis/ditolak server (bukan
   * OFFLINE, bukan salah peran — gerbang peran di bawah menutup itu). Jangan
   * biarkan data demo tampil "hidup": tutup sesi lokal, kembali ke halaman
   * masuk, dan bawa keterangan agar pengguna paham harus masuk ulang.
   */
  const tanganiSesiHabis = (e: unknown): boolean => {
    if (!(e instanceof GalatApi && e.code === "UNAUTHORIZED")) return false;
    setPesanSesi("Sesi Anda telah berakhir — silakan masuk kembali.");
    setPeranMasuk(null);
    setProfilSesi(null);
    setPage("login");
    return true;
  };

  // --- B3 · sesi diam di sisi klien -----------------------------------------
  // Batas 30 menit MENGIKUTI default `SESSION_IDLE_DETIK` server (1800 s);
  // server tetap sumber kebenaran (`sisaDetik` GET /auth/warga/sesi) — FE hanya
  // menutup tab lama lebih awal supaya pengguna sempat melihat peringatan.
  const IDLE_MILI = 30 * 60_000;
  const PERINGATAN_MILI = 29 * 60_000;

  /** Akhiri sesi karena diam: cabut cookie server (best-effort) → halaman masuk + keterangan. */
  const akhiriSesiDiam = async (): Promise<void> => {
    if (peranMasuk === "warga") await logoutWarga();
    else if (peranMasuk) await logoutPengurus();
    setPesanSesi(
      "Sesi Anda berakhir karena tidak ada aktivitas selama 30 menit — silakan masuk kembali.",
    );
    setPeranMasuk(null);
    setProfilSesi(null);
    setPeringatanSesi(false);
    setPage("login");
  };

  // Pengukur: berjalan hanya selama ada sesi masuk; TIAP aktivitas pengguna
  // me-reset pengukur (bukan tiap render), jadi membuka tab diam-diam tidak
  // pernah me-reset hitungan mundur auto-logout.
  useEffect(() => {
    if (!peranMasuk) return undefined;
    aktivitasRef.current = Date.now();
    const tandaiAktif = () => {
      aktivitasRef.current = Date.now();
      // Hanya menyentuh state bila peringatan sedang tampil (hindari render sia-sia).
      setPeringatanSesi((p) => (p ? false : p));
    };
    const peristiwa = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
    for (const p of peristiwa) window.addEventListener(p, tandaiAktif, { passive: true });

    const jeda = window.setInterval(() => {
      const diam = Date.now() - aktivitasRef.current;
      if (diam >= IDLE_MILI) {
        window.clearInterval(jeda);
        void akhiriSesiDiam();
      } else if (diam >= PERINGATAN_MILI) {
        setPeringatanSesi(true);
      }
    }, 10_000);

    return () => {
      for (const p of peristiwa) window.removeEventListener(p, tandaiAktif);
      window.clearInterval(jeda);
      setPeringatanSesi(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peranMasuk]);

  /**
   * Batch 9 · Bug A — muat SELURUH data sesi RT dari API (8 GET; pola sama
   * dengan blok boot lama). Ditarik keluar dari efek boot supaya dapat
   * dipanggil ulang dari empat titik:
   *   1. boot peran `rt` (efek `[peranMasuk]`),
   *   2. berpindah halaman dalam Portal RT (efek `[page, peranMasuk]`),
   *   3. jendela kembali fokus/terlihat (debounce 400 ms),
   *   4. polling 45 detik — hanya bila tab terlihat DAN server sehat.
   * Dengan itu input dari Portal Warga (data keluarga, iuran, pengajuan surat)
   * langsung terlihat di Portal RT tanpa logout-login. Sengaja TANPA
   * websocket/push: cakupan ini sudah menutup alur pemakaian nyata dengan
   * biaya & kompleksitas jauh lebih kecil (jujur di laporan batch 9 §7).
   *
   * Guard `generasiMuatRtRef`: tiap panggilan menaikkan nomor; pemuatan lama
   * yang datang belakangan menganggur (tak menimpa sesi yang lebih baru), dan
   * nomor ikut naik saat peran berakhir/berganti. OFFLINE → data demo
   * dipertahankan & `rtServerSehatRef` jadi `false` (polling berhenti).
   */
  const muatDataRtSesi = async (): Promise<void> => {
    const generasi = ++generasiMuatRtRef.current;
    const batal = () => generasiMuatRtRef.current !== generasi;
    // OFFLINE menandai server tidak sehat; kegagalan non-OFFLINE (mis. sesi
    // habis) tidak ikut menyalakan tanda ini — urusannya sudah ditangani
    // `tanganiSesiHabis`/console di bawah.
    const tandaiOffline = (e: unknown) => {
      if (e instanceof GalatApi && e.code === "OFFLINE") rtServerSehatRef.current = false;
    };

    // B13 · CRUD Data Warga (§5.4): daftar baris warga + KK dari server
    // menjadi sumber kebenaran bersama Portal RT ↔ Portal Warga. OFFLINE /
    // sesi habis → pertahankan data demo (pola sama dengan iuran/kas).
    try {
      const d = await daftarWargaRt();
      if (batal()) return;
      // GET pertama sukses → server memang menyala; polling 45 dtk boleh jalan
      // lagi (mis. setelah server sempat OFFLINE lalu dinyalakan ulang).
      rtServerSehatRef.current = true;
      setWargaRtList(d.warga.map(barisServerKeWargaRt));
      setKkList(d.keluarga.map(keluargaKeKkData));
    } catch (e) {
      if (batal()) return;
      tandaiOffline(e);
      if (tanganiSesiHabis(e)) return;
      console.info("[data-warga] memakai data demo:", e instanceof GalatApi ? e.code : e);
    }
    // §5.4 · Data Hunian: daftar unit dari server jadi sumber kebenaran
    // (sebelumnya state demo FE — "input hunian terputus" tak pernah
    // tersimpan). OFFLINE / sesi habis → data demo dipertahankan.
    try {
      const h = await daftarHunianRt();
      if (batal()) return;
      setHunianList(h.hunian.map(hunianServerKeHunian));
    } catch (e) {
      if (batal()) return;
      tandaiOffline(e);
      if (tanganiSesiHabis(e)) return;
      console.info("[hunian] memakai data demo:", e instanceof GalatApi ? e.code : e);
    }
    // Okt 2026 · daftar undangan dari server: status token SEBENARNYA
    // (termasuk "Kedaluwarsa" lewat 24 jam §4.2) + UUID token sehingga
    // tombol Cabut/Kirim Ulang tetap berdaya setelah F5. OFFLINE → daftar
    // demo dipertahankan (jalur mode demo).
    try {
      const u = await daftarUndanganRt();
      if (batal()) return;
      setUndanganList(u.undangan.map(undanganServerKeUndangan));
    } catch (e) {
      if (batal()) return;
      tandaiOffline(e);
      if (tanganiSesiHabis(e)) return;
      console.info("[undangan] memakai data demo:", e instanceof GalatApi ? e.code : e);
    }
    try {
      const r = await pembayaranRt();
      if (batal()) return;
      setPembayaran(
        r.pembayaran.map((b) => barisKePembayaran(b, b.alamat ?? "-", b.nama ?? "-")),
      );
    } catch (e) {
      if (batal()) return;
      tandaiOffline(e);
      console.info("[iuran] memakai data demo:", e instanceof GalatApi ? e.code : e);
    }
    // Iuran kondisional di sisi RT: daftar tagihan insidental + progres
    // per warga dari server; OFFLINE → data demo dipertahankan.
    try {
      const k = await daftarKondisionalRt();
      if (batal()) return;
      setTagihanTambahanList(k.daftar.map(kondisionalRtKeKartu));
    } catch (e) {
      if (batal()) return;
      tandaiOffline(e);
      console.info("[kondisional-rt] memakai data demo:", e instanceof GalatApi ? e.code : e);
    }
    // F-6 · buku kas: ganti seluruh state (urut jurnal — baris terakhir = saldo
    // terkini). Galat terpisah supaya kegagalan kas tidak membatalkan iuran.
    try {
      const k = await daftarKasRt();
      if (batal()) return;
      setKasRtList(k.entri.map(entriKeKasRt));
    } catch (e) {
      if (batal()) return;
      tandaiOffline(e);
      console.info("[kas] memakai data demo:", e instanceof GalatApi ? e.code : e);
    }
    // F-5 · B11: antrean ajuan perubahan data warga (tanpa filter status →
    // seluruh riwayat; panel RT menampilkan yang `menunggu` untuk diproses).
    try {
      const a = await daftarAjuanPerubahanRt();
      if (batal()) return;
      setAjuanRt(a.ajuan);
    } catch (e) {
      if (batal()) return;
      tandaiOffline(e);
      console.info("[ajuan] antrean kosong:", e instanceof GalatApi ? e.code : e);
    }
    // B12 · antrian persuratan (§6.6): baris server = rujukan status & nomor
    // untuk Surat Pengantar; OFFLINE / sesi habis → data demo dipertahankan.
    // `lampiran` baris ikut terbawa (Batch 9) sehingga berkas pengajuan warga
    // langsung terlihat di Portal RT.
    try {
      const s = await daftarSuratRt();
      if (batal()) return;
      setSuratList((prev) => gabungSuratServer(prev, s.surat));
    } catch (e) {
      if (batal()) return;
      tandaiOffline(e);
      if (tanganiSesiHabis(e)) return;
      console.info("[surat] memakai data demo:", e instanceof GalatApi ? e.code : e);
    }
  };

  // F-6 · muat data keluarga + modul iuran dari API begitu sesi peran terpasang
  // (API-first). Galat OFFLINE → pertahankan data demo; sesi habis → alihkan ke
  // halaman masuk (`tanganiSesiHabis`). Tampilan tak pernah putus.
  useEffect(() => {
    if (peranMasuk === "warga") {
      let batal = false;
      void (async () => {
        // Data keluarga didahulukan: sumber kebenaran nama & alamat turunan
        // (tagihan iuran, kartu, surat). OFFLINE → tetap memakai data demo.
        let kkDariApi: KkData | null = null;
        try {
          const k = await ambilKeluargaWarga();
          kkDariApi = keluargaKeKkData(k);
          if (!batal) setKkList([kkDariApi]);
          // Status pengajuan (B11/B20): respons sukses → daftar server jadi
          // rujukan (bisa kosong = memang belum pernah mengajukan).
          if (!batal) setAjuanWarga(k.ajuan ?? []);
        } catch (e) {
          if (tanganiSesiHabis(e)) return;
          console.info("[keluarga] memakai data demo:", e instanceof GalatApi ? e.code : e);
        }
        // Batch 15 · jumlah kendaraan R4 dari hunian milik sendiri —
        // OFFLINE / belum tertaut hunian → nilai awal dipertahankan (layar
        // tetap utuh; tidak pernah mengaku angka server yang tak terbaca).
        try {
          const h = await hunianWarga();
          if (batal) return;
          if (h.hunian) setKendaraanR4Count(h.hunian.unitKendaraanR4);
        } catch (e) {
          if (tanganiSesiHabis(e)) return;
          console.info("[hunian-warga] memakai nilai awal:", e instanceof GalatApi ? e.code : e);
        }
        try {
          const [riwayat, tagihan] = await Promise.all([riwayatIuran(), tagihanIuran()]);
          if (batal) return;
          setRingkasTagihanWarga(tagihan.ringkas);
          const nama = kkDariApi?.kepala ?? kkList[0]?.kepala ?? "Warga";
          const alamat = shortAlamat(kkDariApi?.alamat ?? alamatWarga);
          // Ganti SELURUH baris: riwayat ini milik hunian login dan sudah
          // membawa alamat dari server. Merge+filter lama menyisakan baris demo
          // bila alamat DB ≠ mock → dua baris untuk pembayaran yang sama.
          setPembayaran(riwayat.riwayat.map((b) => barisKePembayaran(b, alamat, nama)));
        } catch (e) {
          if (tanganiSesiHabis(e)) return;
          console.info("[iuran] memakai data demo:", e instanceof GalatApi ? e.code : e);
        }
        // Iuran kondisional (tagihan insidental buatan pengurus) — daftar server
        // jadi rujukan kartu "Iuran Kondisional"; OFFLINE → data demo dipakai.
        try {
          const k = await kondisionalWarga();
          if (batal) return;
          setTagihanTambahanList(k.daftar.map(kondisionalWargaKeKartu));
        } catch (e) {
          if (tanganiSesiHabis(e)) return;
          console.info("[kondisional] memakai data demo:", e instanceof GalatApi ? e.code : e);
        }
        // B12 · persuratan resmi (§5.3): daftar surat milik warga + baris dari
        // server jadi rujukan; `noKk` dipaksa ke nilai KK sesi ini agar filter
        // Pengajuan Surat tetap menangkap baris server (format No. KK DB bisa
        // berbeda dari tampilan FE). OFFLINE → data demo dipertahankan.
        try {
          const s = await suratWarga();
          if (batal) return;
          setSuratList((prev) =>
            gabungSuratServer(prev, s.surat, kkDariApi?.noKk ?? kkList[0]?.noKk ?? null),
          );
        } catch (e) {
          if (tanganiSesiHabis(e)) return;
          console.info("[surat] memakai data demo:", e instanceof GalatApi ? e.code : e);
        }
      })();
      return () => {
        batal = true;
      };
    }
    setRingkasTagihanWarga(null);
    // Peran berakhir/berganti → kembalikan daftar KK ke demo: data keluarga
    // tersambung API tidak boleh bocor ke sesi RT/RW berikutnya. Identity-guard
    // (bila sudah `initialKkList` → referensi sama) membuatnya aman dijalankan
    // berulang tanpa render ulang. Panel ajuan warga ikut dikembalikan; antrean
    // ajuan RT dikosongkan di luar sesi RT.
    setKkList((prev) => (prev === initialKkList ? prev : initialKkList));
    setAjuanWarga(ajuanPerubahanDefault);
    setAjuanRt((prev) => (prev.length ? [] : prev));
    // Baris Data Warga milik sesi RT sebelumnya TIDAK boleh bocor ke sesi
    // berikutnya — kembalikan ke demo dengan identity-guard seperti kkList.
    setWargaRtList((prev) => (prev === wargaRtDefault ? prev : wargaRtDefault));
    // Daftar hunian server (hasil GET /rt/hunian sesi RT) juga tidak boleh
    // bocor — kembalikan ke seed demo (pola identity-guard yang sama).
    setHunianList((prev) => (prev === hunianDefault ? prev : hunianDefault));
    // Kartu iuran kondisional daftar sesi sebelumnya juga tidak boleh bocor
    // (pola sama: identity-guard ke data demo).
    setTagihanTambahanList((prev) => (prev === tagihanTambahanDefault ? prev : tagihanTambahanDefault));
    // Daftar undangan server (GET /rt/undangan sesi RT) tidak boleh bocor ke
    // sesi berikutnya — kembalikan ke seed demo (identity-guard sama).
    setUndanganList((prev) => (prev === undanganDefault ? prev : undanganDefault));
    if (peranMasuk === "rt") {
      // Batch 9 · Bug A — blok 8 GET lama diekstrak menjadi `muatDataRtSesi`
      // (lihat di atas) agar bisa dipanggil ulang saat navigasi/fokus/polling.
      void muatDataRtSesi();
      return () => {
        // Peran berakhir/berganti → pemuatan yang masih berjalan gugur
        // (hasilnya tak boleh bocor ke sesi berikutnya).
        generasiMuatRtRef.current += 1;
      };
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peranMasuk]);

  /**
   * Batch 9 · Bug A (pemicu 2) — muat ulang data sesi RT SETIAP BERPINDAH
   * HALAMAN dalam Portal RT: pengurus kembali ke dashboard/daftar, data terbaru
   * dari Portal Warga (data keluarga, iuran, pengajuan surat) langsung terbaca
   * tanpa logout-login. Sesi `warga` tidak ikut — Portal Warga sudah punya
   * refresh-on-page (iuran) dan polling miliknya sendiri.
   *
   * Efek boot lama TETAP jalan duluan saat login; untuk menghindari dua pemuatan
   * 8 GET berbarengan, perpindahan dari halaman `login` dilewati (baris `sudah`
   * = navigasi login→portal sudah ditangani boot `[peranMasuk]`).
   */
  const peranRtPernahBoot = useRef(false);
  useEffect(() => {
    if (peranMasuk !== "rt") {
      peranRtPernahBoot.current = false;
      return;
    }
    if (!peranRtPernahBoot.current) {
      // Boot `[peranMasuk]` baru saja memuat — tandai selesai, jangan dobel.
      peranRtPernahBoot.current = true;
      return;
    }
    void muatDataRtSesi();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, peranMasuk]);

  /**
   * Batch 9 · Bug A (pemicu 3) — jendela kembali FOKUS / tab terlihat lagi:
   * pengurus selesai ngobrol di WhatsApp lalu kembali → data disegarkan
   * (debounce 400 ms supaya `focus` + `visibilitychange` yang datang berbarengan
   * hanya memicu SATU muat ulang).
   */
  useEffect(() => {
    if (peranMasuk !== "rt") return;
    let jeda = 0;
    const segarkan = () => {
      window.clearTimeout(jeda);
      jeda = window.setTimeout(() => void muatDataRtSesi(), 400);
    };
    window.addEventListener("focus", segarkan);
    document.addEventListener("visibilitychange", segarkan);
    return () => {
      window.clearTimeout(jeda);
      window.removeEventListener("focus", segarkan);
      document.removeEventListener("visibilitychange", segarkan);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peranMasuk]);

  /**
   * Batch 9 · Bug A (pemicu 4) — polling 45 detik HANYA bila tab terlihat DAN
   * server pernah menjawab (`rtServerSehatRef`): mode demo/offline tidak akan
   * membanjiri jaringan dengan 8 GET mati tiap 45 detik, dan tab di latar
   * belakang tidak boros baterai/kuota. TANPA websocket/push — keputusan
   * sadar-sadar dicatat di laporan batch 9 §7.
   */
  useEffect(() => {
    if (peranMasuk !== "rt") return;
    const jeda = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (!rtServerSehatRef.current) return;
      void muatDataRtSesi();
    }, 45_000);
    return () => window.clearInterval(jeda);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peranMasuk]);

  // F-6/iuran · muat ulang ringkas + riwayat + iuran kondisional milik warga
  // login. Dipanggil saat halaman iuran DIBUKAKAN dan saat polling selama status
  // masih "Menunggu Verifikasi" — tanpa ini Portal Warga tertinggal jauh di
  // "Menunggu Verifikasi" sesudah pengurus memverifikasi (isu status sync).
  const muatIuranWargaSesi = async (): Promise<void> => {
    try {
      const [riwayat, tagihan] = await Promise.all([riwayatIuran(), tagihanIuran()]);
      setRingkasTagihanWarga(tagihan.ringkas);
      const nama = kkList[0]?.kepala ?? "Warga";
      setPembayaran(riwayat.riwayat.map((b) => barisKePembayaran(b, alamatWarga, nama)));
    } catch (e) {
      if (tanganiSesiHabis(e)) return;
      console.info("[iuran] gagal memuat ulang:", e instanceof GalatApi ? e.code : e);
    }
    try {
      const k = await kondisionalWarga();
      setTagihanTambahanList(k.daftar.map(kondisionalWargaKeKartu));
    } catch (e) {
      console.info("[kondisional] memakai data demo:", e instanceof GalatApi ? e.code : e);
    }
  };

  // Refresh tiap kali halaman iuran warga dibuka (bukan cuma sekali saat login).
  useEffect(() => {
    if (peranMasuk === "warga" && page === "iuran-tagihan") void muatIuranWargaSesi();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, peranMasuk]);

  // Polling ringan 30 detik HANYA selama status "Menunggu Verifikasi" — badge
  // berubah sendiri sesudah pengurus menyetujui (janji teks di halaman iuran).
  useEffect(() => {
    if (peranMasuk !== "warga" || ringkasTagihanWarga?.status !== "menunggu_verifikasi") return;
    const jeda = window.setInterval(() => void muatIuranWargaSesi(), 30_000);
    return () => window.clearInterval(jeda);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peranMasuk, ringkasTagihanWarga?.status]);

  // Gerbang peran: bila halaman portal tidak cocok dengan sesi berjalan (mis.
  // sesi warga terdorong ke halaman Portal RT lewat tombol kembali undangan),
  // alihkan ke beranda portal milik sesi — atau halaman masuk bila tak ada sesi.
  useEffect(() => {
    const portalHalaman = PORTAL_HALAMAN[page];
    if (portalHalaman && peranMasuk !== portalHalaman) {
      setPage(peranMasuk ? BERANDA_PORTAL[peranMasuk] : "login");
    }
  }, [page, peranMasuk]);

  // Kas RT append-only (sama seperti Kas RW): hanya menambah baris + rantai saldo.
  // F-6: API-first — server (bukan FE) yang menghitung rantai `saldoSesudah`;
  // `OFFLINE` saja yang jatuh ke pencatatan lokal (mode demo), galat lain
  // diteruskan supaya Komponen tidak menampilkan "berhasil" untuk kegagalan.
  const tambahKasRt = async (t: Omit<KasRt, "id" | "saldo">): Promise<void> => {
    let entriBaru: ReturnType<typeof entriKeKasRt> | null = null;
    try {
      const iso = labelKeIso(t.tanggal);
      const hasil = await catatKasRt({
        ...(iso ? { tanggal: iso } : {}),
        tipe: t.tipe === "Pemasukan" ? "masuk" : "keluar",
        kategori: kategoriKasKeServer(t.kategori),
        keterangan: t.keterangan,
        nominal: Math.abs(t.nominal),
      });
      entriBaru = entriKeKasRt(hasil.entri);
    } catch (e) {
      if (!(e instanceof GalatApi && e.code === "OFFLINE")) {
        tanganiSesiHabis(e);
        throw e;
      }
    }
    if (entriBaru) {
      // Daftar disimpan urut jurnal → entri terbaru selalu di ekor (saldo berjalan).
      setKasRtList((prev) => [...prev, entriBaru]);
    } else {
      setKasRtList((prev) => {
        const saldoAkhir = prev.length ? prev[prev.length - 1].saldo : 0;
        return [...prev, { ...t, id: `kt${Date.now()}`, saldo: saldoAkhir + t.nominal }];
      });
    }
  };

  // B8 · koreksi entri kas RT — kas & alokasi bersifat APPEND-ONLY, jadi koreksi
  // TIDAK pernah mengedit/menghapus baris lama: server menulis baris pembalik
  // baru (nilai berlawanan) + menyimpan `reversalOfId` sebagai jejak audit.
  // API-first seperti tambahKasRt: OFFLINE → baris pembalik lokal (mode demo),
  // galat lain diteruskan supaya dialog menampilkan gagal, bukan sukses.
  // `true` = baris pembalik dari server; `false` = baris demo lokal (OFFLINE)
  // — pemanggil wajib membedakan agar pesan sukses tidak pernah palsu.
  const koreksiEntriKas = async (id: string, alasan: string): Promise<boolean> => {
    let pembalik: ReturnType<typeof entriKeKasRt> | null = null;
    try {
      const hasil = await koreksiKasRt(id, alasan);
      pembalik = entriKeKasRt(hasil.pembalik);
    } catch (e) {
      if (!(e instanceof GalatApi && e.code === "OFFLINE")) {
        tanganiSesiHabis(e);
        throw e;
      }
    }
    if (pembalik) {
      setKasRtList((prev) => [...prev, pembalik]);
      return true;
    } else {
      // Mode demo: baris pembalik lokal membalik nominal entri yang dikoreksi.
      setKasRtList((prev) => {
        const asal = prev.find((k) => k.id === id);
        if (!asal) return prev;
        const saldoAkhir = prev.length ? prev[prev.length - 1].saldo : 0;
        return [
          ...prev,
          {
            id: `kt${Date.now()}`,
            tanggal: asal.tanggal,
            tipe: asal.tipe === "Pemasukan" ? "Pengeluaran" : "Pemasukan",
            kategori: asal.kategori,
            keterangan: `Koreksi: ${asal.keterangan} — ${alasan}`,
            nominal: -asal.nominal,
            saldo: saldoAkhir - asal.nominal,
            bukti: false,
            sumber: "pembalik",
            reversalOfId: asal.id,
          },
        ];
      });
      return false;
    }
  };

  // --- B7 · pengaturan iuran per-RT (API-first) ------------------------------
  // Pola sama dengan helper lain: OFFLINE → `null` (form memakai nilai lokal
  // mode demo), galat lain DITERUSKAN setelah `tanganiSesiHabis` supaya halaman
  // menampilkan gagal — bukan sukses untuk sesi habis/server menolak.
  const muatPengaturanIuran = async (): Promise<PengaturanIuranRt | null> => {
    try {
      return await pengaturanIuranRt();
    } catch (err) {
      if (err instanceof GalatApi && err.code === "OFFLINE") return null;
      tanganiSesiHabis(err);
      throw err;
    }
  };

  const simpanPengaturanIuranSesi = async (
    patch: Partial<PengaturanIuranRt>,
  ): Promise<PengaturanIuranRt | null> => {
    try {
      return await simpanPengaturanIuranRt(patch);
    } catch (err) {
      if (err instanceof GalatApi && err.code === "OFFLINE") return null;
      tanganiSesiHabis(err);
      throw err;
    }
  };

  // --- B9 · generate tagihan bulanan, profil iuran, tagihan tercatat --------
  const generateTagihanSesi = async (periode?: string): Promise<HasilGenerateTagihan | null> => {
    try {
      return await generateTagihanRt(periode);
    } catch (err) {
      if (err instanceof GalatApi && err.code === "OFFLINE") return null;
      tanganiSesiHabis(err);
      throw err;
    }
  };

  // --- Batch 15 · tutup/buka buku iuran (sementara, bisa dibuka) -----------
  const tutupBukuSesi = async (payload: {
    periodeTertutup?: string;
    alasan?: string;
  }): Promise<StatusTutupBukuIuran | null> => {
    try {
      return await tutupBukuIuranRt(payload);
    } catch (err) {
      if (err instanceof GalatApi && err.code === "OFFLINE") return null;
      tanganiSesiHabis(err);
      throw err;
    }
  };

  const bukaBukuSesi = async (): Promise<{
    periodeTertutup: string;
    dibukaKembaliPada: string | null;
  } | null> => {
    try {
      return await bukaBukuIuranRt();
    } catch (err) {
      if (err instanceof GalatApi && err.code === "OFFLINE") return null;
      tanganiSesiHabis(err);
      throw err;
    }
  };

  const muatKategoriServer = async (): Promise<KategoriIuranServer[] | null> => {
    try {
      return (await kategoriIuranRt()).kategori;
    } catch (err) {
      if (err instanceof GalatApi && err.code === "OFFLINE") return null;
      tanganiSesiHabis(err);
      throw err;
    }
  };

  const muatTagihanServer = async (
    opsi: {
      periode?: string;
      kategori?: string;
      status?: string;
      q?: string;
    },
  ): Promise<Awaited<ReturnType<typeof tagihanRtServer>> | null> => {
    try {
      return await tagihanRtServer(opsi);
    } catch (err) {
      if (err instanceof GalatApi && err.code === "OFFLINE") return null;
      tanganiSesiHabis(err);
      throw err;
    }
  };

  const muatProfilIuranSesi = async (
    wargaId: string,
  ): Promise<{ warga: { id: string; nama: string }; baris: BarisProfilIuran[] } | null> => {
    try {
      return await profilIuranRt(wargaId);
    } catch (err) {
      if (err instanceof GalatApi && err.code === "OFFLINE") return null;
      tanganiSesiHabis(err);
      throw err;
    }
  };

  const simpanProfilIuranSesi = async (
    wargaId: string,
    payload: { kategoriId: string; nominalBerlaku?: number | null; jumlahUnit?: number },
  ): Promise<{ warga: { id: string; nama: string }; profil: { kategoriId: string; nama: string } } | null> => {
    try {
      return await simpanProfilIuranRt(wargaId, payload);
    } catch (err) {
      if (err instanceof GalatApi && err.code === "OFFLINE") return null;
      tanganiSesiHabis(err);
      throw err;
    }
  };

  // Batch 15C · edit nominal tagihan (`PATCH /rt/iuran/tagihan/:id`) —
  // API-first: sukses → nilai server; OFFLINE → null (halaman menghitungnya
  // gagal & menampilkan pesan jujur "tidak tersimpan"); galat server (409
  // sudah teralokasi, 404, validasi) DITERUSKAN agar pesan galat tampil —
  // tidak pernah mengklaim tersimpan padahal server menolak.
  const ubahNominalTagihanSesi = async (
    id: string,
    nominal: number,
  ): Promise<{ id: string; nominal: number; sisa: number; periode: string } | null> => {
    try {
      return await ubahNominalTagihanRt(id, nominal);
    } catch (err) {
      if (err instanceof GalatApi && err.code === "OFFLINE") return null;
      tanganiSesiHabis(err);
      throw err;
    }
  };

  // F-6 · simpan kontak anggota keluarga — API-first seperti tambahKasRt:
  // sukses → baris server jadi rujukan (NIK tetap ter-mask, format konsisten);
  // OFFLINE (server mati/demo) → patch lokal dengan padanan tampilan identik;
  // galat lain (sesi habis, validasi, bentrok no. HP) DITERUSKAN supaya halaman
  // menampilkan gagal — tidak pernah "berhasil" untuk kegagalan.
  const simpanKontakAnggota = async (idWarga: string, patch: PatchKontakKeluarga): Promise<void> => {
    let segar: ReturnType<typeof anggotaKeFamilyMember> | null = null;
    try {
      const hasil = await simpanKontakKeluarga(idWarga, patch);
      segar = anggotaKeFamilyMember(hasil.anggota);
    } catch (e) {
      if (!(e instanceof GalatApi && e.code === "OFFLINE")) {
        tanganiSesiHabis(e);
        throw e;
      }
    }
    setKkList((prev) =>
      prev.map((kk) => ({
        ...kk,
        anggota: kk.anggota.map((a) => {
          if (a.idWarga !== idWarga) return a;
          // Spread di atas baris lama agar `idWarga` dsb. tidak hilang; OFFLINE
          // → `patchKontakKeFe` menjaga format WA/gol. darah sama dgn reload.
          return segar ? { ...a, ...segar } : { ...a, ...patchKontakKeFe(patch) };
        }),
      })),
    );
  };

  // Batch 15 · unit kendaraan roda 4 milik sendiri (`PATCH /warga/hunian`) —
  // API-first: sukses → nilai server; OFFLINE → nilai lokal + `false` (halaman
  // menampilkan pesan jujur "hanya layar ini"); galat lain (validasi, 409
  // belum tertaut, sesi habis) DITERUSKAN → tombol menampilkan gagal — tidak
  // pernah sukses palsu.
  const simpanKendaraanR4Warga = async (count: number): Promise<boolean> => {
    try {
      await ubahKendaraanR4Warga(count);
      setKendaraanR4Count(count);
      return true;
    } catch (e) {
      if (e instanceof GalatApi && e.code === "OFFLINE") {
        setKendaraanR4Count(count);
        return false;
      }
      tanganiSesiHabis(e);
      throw e;
    }
  };

  // B13 · CRUD Data Warga Portal RT (§5.4) — API-first TIPIS: meneruskan
  // hasil server; OFFLINE → `null` (DataWargaRT lanjut jalur demo lokal);
  // galat lain (validasi, 404 lintas-RT, 409 riwayat) DITERUSKAN agar pesan
  // server tampil — tidak pernah "berhasil" untuk kegagalan. Penerapan state
  // (baris + KK dari respons) dilakukan DataWargaRT lewat `onWargaRtChange` /
  // `onKkUpdated` / `onKkAdded` agar jalur API & demo satu pintu.
  const simpanWargaRt = async (
    id: string,
    patch: PatchWargaRt,
  ): Promise<{ warga: BarisWargaRtServer; keluarga: KeluargaRingkasServer } | null> => {
    try {
      return await ubahWargaRt(id, patch);
    } catch (e) {
      if (e instanceof GalatApi && e.code === "OFFLINE") return null;
      // Sesi habis → alihkan ke halaman masuk; galat tetap diteruskan agar
      // DataWargaRT tidak pernah menampilkan sukses palsu.
      tanganiSesiHabis(e);
      throw e;
    }
  };

  const tambahDataWargaRt = async (
    payload: TambahWargaRtPayload,
  ): Promise<{ warga: BarisWargaRtServer[]; keluarga: KeluargaRingkasServer } | null> => {
    try {
      return await tambahWargaRt(payload);
    } catch (e) {
      if (e instanceof GalatApi && e.code === "OFFLINE") return null;
      tanganiSesiHabis(e);
      throw e;
    }
  };

  // Okt 2026 · Tambah anggota ke KK yang sudah ada (POST /rt/warga/:kkId/anggota)
  // — pola API-first yang sama: sukses → baris + keluarga server; OFFLINE →
  // `null` (halaman lanjut jalur demo lokal dengan pesan jujur); galat lain
  // (404 lintas-RT, 409 no. HP bentrok, 400 batas 50) DITERUSKAN agar pesan
  // server tampil — tidak pernah "berhasil" untuk kegagalan.
  const tambahAnggotaKkSesi = async (
    kkId: string,
    anggota: AnggotaBaruServer[],
  ): Promise<{ warga: BarisWargaRtServer[]; keluarga: KeluargaRingkasServer } | null> => {
    try {
      return await tambahAnggotaKk(kkId, anggota);
    } catch (e) {
      if (e instanceof GalatApi && e.code === "OFFLINE") return null;
      tanganiSesiHabis(e);
      throw e;
    }
  };

  // §5.4 · Data Hunian (GET/POST /rt/hunian) — API-first pola sama: sukses →
  // baris server; OFFLINE → `null` (halaman lanjut jalur demo lokal); galat
  // lain (validasi, 409 blok/alamat kembar, sesi habis) DITERUSKAN supaya pesan
  // server tampil — tidak pernah "berhasil" untuk kegagalan.
  const tambahHunianSesi = async (payload: TambahHunianRtPayload): Promise<HunianServer | null> => {
    try {
      const h = await tambahHunianRt(payload);
      return h.hunian;
    } catch (e) {
      if (e instanceof GalatApi && e.code === "OFFLINE") return null;
      tanganiSesiHabis(e);
      throw e;
    }
  };

  // Okt 2026 · Edit & Hapus Data Hunian — API-first pola sama dengan tambah:
  // `null` = OFFLINE (halaman lanjut jalur demo lokal dengan pesan jujur);
  // galat lain (409 kembar/berpenghuni, 404, validasi) DITERUSKAN supaya pesan
  // server tampil — tidak pernah "berhasil" untuk kegagalan. State baris
  // diperbarui HALAMAN lewat `onHunianChange` (penulis tunggal, seperti tambah).
  const ubahHunianSesi = async (
    id: string,
    patch: Partial<TambahHunianRtPayload>,
  ): Promise<{ hunian: HunianServer; kkTertaut?: number } | null> => {
    try {
      return await ubahHunianRt(id, patch);
    } catch (e) {
      if (e instanceof GalatApi && e.code === "OFFLINE") return null;
      tanganiSesiHabis(e);
      throw e;
    }
  };

  const hapusHunianSesi = async (id: string): Promise<boolean | null> => {
    try {
      await hapusHunianRt(id);
      return true;
    } catch (e) {
      if (e instanceof GalatApi && e.code === "OFFLINE") return null;
      tanganiSesiHabis(e);
      throw e;
    }
  };

  /** Sukses parsial: `terhapus` masuk, `tertolak` (mis. berpenghuni) dilaporkan per baris. */
  const hapusBanyakHunianSesi = async (ids: string[]): Promise<HasilHapusHunian | null> => {
    try {
      return await hapusBanyakHunianRt(ids);
    } catch (e) {
      if (e instanceof GalatApi && e.code === "OFFLINE") return null;
      tanganiSesiHabis(e);
      throw e;
    }
  };

  // §6.4.1 · master kategori iuran — CRUD API-first: hasil server menggantikan
  // state (bukan lagi state demo FE); OFFLINE → `null` → jalur demo jujur;
  // galat 409 nama bentrok & validasi DITERUSKAN agar pesan server tampil.
  const tambahKategoriSesi = async (
    payload: TambahKategoriRtPayload,
  ): Promise<KategoriIuranServer | null> => {
    try {
      const h = await tambahKategoriRt(payload);
      return h.kategori;
    } catch (e) {
      if (e instanceof GalatApi && e.code === "OFFLINE") return null;
      tanganiSesiHabis(e);
      throw e;
    }
  };

  const ubahKategoriSesi = async (
    id: string,
    patch: Partial<TambahKategoriRtPayload> & { statusAktif?: boolean },
  ): Promise<KategoriIuranServer | null> => {
    try {
      const h = await ubahKategoriRt(id, patch);
      return h.kategori;
    } catch (e) {
      if (e instanceof GalatApi && e.code === "OFFLINE") return null;
      tanganiSesiHabis(e);
      throw e;
    }
  };

  const hapusDataWargaRt = async (
    id: string,
  ): Promise<{ id: string; keluarga: KeluargaRingkasServer | null } | null> => {
    try {
      return await hapusWargaRt(id);
    } catch (e) {
      if (e instanceof GalatApi && e.code === "OFFLINE") return null;
      tanganiSesiHabis(e);
      throw e;
    }
  };

  // A10 · Migrasi Data (§9.1(6)) — impor CSV/XLSX: API-first tipis seperti B13;
  // OFFLINE → `null` (DataWargaRT lanjut jalur demo dengan pesan jujur); galat
  // lain (400 kolom salah, 413 kebesaran, sesi habis) DITERUSKAN — tidak pernah
  // "berhasil" untuk kegagalan. Sukses → MUAT ULANG daftar warga + KK dari
  // server (impor dapat membuat puluhan KK sekaligus — daripada menerapkan
  // per-item lewat callback, daftar segar inilah sumber kebenarannya).
  const imporDataWargaRt = async (file: File): Promise<HasilImporWarga | null> => {
    let hasil: HasilImporWarga;
    try {
      hasil = await imporWargaRt(file);
    } catch (e) {
      if (e instanceof GalatApi && e.code === "OFFLINE") return null;
      tanganiSesiHabis(e);
      throw e;
    }
    try {
      const d = await daftarWargaRt();
      setWargaRtList(d.warga.map(barisServerKeWargaRt));
      setKkList(d.keluarga.map(keluargaKeKkData));
    } catch (e) {
      // Impor SUDAH tercatat di server; kegagalan muat-ulang hanya membuat
      // tampilan usang sampai muat berikutnya — sesi habis tetap dialihkan.
      tanganiSesiHabis(e);
    }
    return hasil;
  };

  // Baris ajuan lokal (mode demo/OFFLINE) — identik bentuknya dengan baris
  // server supaya panel tidak bercabang.
  const ajuanLokal = (p: {
    jenis: JenisAjuan;
    namaAnggota: string;
    keterangan: string;
  }): AjuanPerubahan => ({
    id: `aj${Date.now()}`,
    jenis: p.jenis,
    status: "menunggu",
    namaAnggota: p.namaAnggota,
    keterangan: p.keterangan,
    catatanVerifikasi: null,
    diajukanPada: new Date().toISOString(),
    diprosesPada: null,
  });

  // F-5 · B11: ajuan perubahan resmi KK — API-first (pola simpanKontakAnggota):
  // sukses → baris server jadi rujukan; OFFLINE / tanpa `targetWargaId` (data
  // demo) → baris lokal; galat lain (409 antrean penuh, sesi habis) DITERUSKAN
  // supaya halaman menampilkan gagal — tidak pernah "berhasil" untuk kegagalan.
  const ajukanPerubahanAnggota = async (payload: {
    targetWargaId: string | null;
    jenis: JenisAjuan;
    namaAnggota: string;
    keterangan: string;
  }): Promise<boolean> => {
    // `true` = ajuan benar-benar tercatat di server; `false` = hanya baris
    // lokal (baris demo tanpa id server, atau server tidak terjangkau).
    // Pemanggil WAJIB membedakan keduanya agar pesan sukses tidak palsu.
    if (!payload.targetWargaId) {
      setAjuanWarga((prev) => [ajuanLokal(payload), ...prev]);
      return false;
    }
    let baris: AjuanPerubahan | null = null;
    try {
      const hasil = await ajukanPerubahanKeluarga({
        targetWargaId: payload.targetWargaId,
        jenis: payload.jenis,
        namaAnggota: payload.namaAnggota,
        keterangan: payload.keterangan,
      });
      baris = hasil.ajuan;
    } catch (e) {
      if (!(e instanceof GalatApi && e.code === "OFFLINE")) {
        tanganiSesiHabis(e);
        throw e;
      }
    }
    setAjuanWarga((prev) => [baris ?? ajuanLokal(payload), ...prev]);
    return baris !== null;
  };

  // F-5 · B20: verifikasi ajuan oleh RT — status + catatan sinkron ke portal
  // warga (baris `perubahan_data_warga` yang dibaca ulang lewat GET keluarga).
  // OFFLINE → baris lokal; galat lain DITERUSKAN (jangan pernah tampilkan sukses).
  const verifikasiAjuanRt = async (
    id: string,
    aksi: "setujui" | "tolak",
    catatan?: string,
  ): Promise<void> => {
    let diperbarui: {
      status: StatusAjuan;
      catatanVerifikasi: string | null;
      diprosesPada: string | null;
    } | null = null;
    try {
      const hasil = await verifikasiAjuanPerubahanRt(id, aksi, catatan);
      // `ulang: true` = sudah pernah diproses → tampilkan isi server apa adanya
      // (respons tetap memuat baris; tanpa audit ganda di server).
      diperbarui = hasil.ajuan;
    } catch (e) {
      if (!(e instanceof GalatApi && e.code === "OFFLINE")) {
        tanganiSesiHabis(e);
        throw e;
      }
    }
    const lokal = diperbarui ?? {
      status: (aksi === "setujui" ? "disetujui" : "ditolak") as StatusAjuan,
      catatanVerifikasi: catatan ?? null,
      diprosesPada: new Date().toISOString(),
    };
    setAjuanRt((prev) => prev.map((a) => (a.id === id ? { ...a, ...lokal } : a)));
  };

  // --- B12 · persuratan resmi API-first (§6.6) -------------------------------
  // Pola sama dengan helper B7/B13: OFFLINE → fallback lokal/`null` (mode demo),
  // galat lain DITERUSKAN setelah `tanganiSesiHabis` supaya halaman menampilkan
  // pesan server — tidak pernah "berhasil" untuk kegagalan.

  /** B12 — `GET /rt/pengaturan` (kop & profil visual surat); `null` = OFFLINE. */
  const muatPengaturanSuratRtSesi = async (): Promise<PengaturanSuratRt | null> => {
    try {
      return await pengaturanSuratRt();
    } catch (err) {
      if (err instanceof GalatApi && err.code === "OFFLINE") return null;
      tanganiSesiHabis(err);
      throw err;
    }
  };

  /** B12 — `PATCH /rt/pengaturan` (parsial, wajib CSRF) → nilai sesudah; `null` = OFFLINE. */
  const simpanPengaturanSuratRtSesi = async (
    patch: Parameters<typeof simpanPengaturanSuratRt>[0],
  ): Promise<PengaturanSuratRt | null> => {
    try {
      return await simpanPengaturanSuratRt(patch);
    } catch (err) {
      if (err instanceof GalatApi && err.code === "OFFLINE") return null;
      tanganiSesiHabis(err);
      throw err;
    }
  };

  /**
   * B12 — kop surat untuk unduhan PDF Portal Warga dari `GET /warga/surat`
   * (rute warga tidak bisa memakai guard `wajibRt`); `null` = OFFLINE →
   * PDF memakai kop bawaan.
   */
  const muatKopSuratWargaSesi = async (): Promise<KopSurat | null> => {
    try {
      return (await suratWarga()).kop;
    } catch (err) {
      if (err instanceof GalatApi && err.code === "OFFLINE") return null;
      tanganiSesiHabis(err);
      throw err;
    }
  };

  /**
   * B12 — aksi persuratan Portal RT (terbitkan/setujui/tolak/minta-perbaikan).
   * Baris yang belum punya representasi server dibuat dulu lewat `POST /rt/surat`
   * (deviasi terdokumentasi §5.4) lalu aksanya dijalankan atas baris tersebut —
   * server idempoten pada `(rtId, noSurat)` sehingga duplikat tidak mungkin.
   * OFFLINE → patch lokal tanpa token QR; galat lain DITERUSKAN (baris create
   * tetap disinkronkan lebih dulu supaya percobaan berikutnya tidak dobel).
   * Mengembalikan baris FE hasil aksi untuk pesan sukses di halaman.
   */
  const prosesSuratRtSesi = async (
    row: Surat,
    aksi: AksiSuratRt,
    catatan?: string,
  ): Promise<{ surat: Surat; dariServer: boolean }> => {
    // `dariServer` membedakan hasil server vs patch lokal OFFLINE — halaman
    // wajib mengaku "hanya di sesi ini" untuk yang kedua (prinsip kejujuran).
    // Status lokal (mode OFFLINE) — keputusan RW mengikuti regex jenis yang sama
    // dengan server (`jenis_surat.perlu_rw` diisi dari nama jenis yang sama).
    const statusLokal: StatusSurat =
      aksi === "tolak"
        ? "Ditolak"
        : aksi === "minta-perbaikan"
        ? "Perlu Perbaikan"
        : suratPerluRw(row.jenis)
        ? "Menunggu RW"
        : "Disetujui";

    let dariServer: BarisSuratServer | null = null;
    try {
      let idServer = row.serverId;
      if (!idServer) {
        const dibuat = await buatSuratRt({
          jenis: row.jenis,
          keperluan: row.keperluan,
          noSurat: row.noSurat || noSuratOtomatis(suratList),
          pemohon: row.pemohon,
        });
        idServer = dibuat.surat.id;
        setSuratList((prev) => perbaruiSuratServer(prev, row.id, dibuat.surat));
      }
      dariServer = (await prosesSuratRt(idServer, aksi, catatan)).surat;
    } catch (e) {
      if (e instanceof GalatApi && e.code === "OFFLINE") {
        const lokal: Surat = { ...row, status: statusLokal, ...(catatan ? { catatan } : {}) };
        setSuratList((prev) => prev.map((s) => (s.id === row.id ? lokal : s)));
        return { surat: lokal, dariServer: false };
      }
      tanganiSesiHabis(e);
      throw e;
    }
    const hasil: Surat = {
      ...row,
      ...barisSuratServerKeFe(dariServer),
      id: row.id,
      ...(row.noKk ? { noKk: row.noKk } : {}),
    };
    setSuratList((prev) =>
      prev.map((s) =>
        s.id === row.id || (row.serverId && s.serverId === row.serverId) ? hasil : s,
      ),
    );
    return { surat: hasil, dariServer: true };
  };

  /**
   * B12 — warga mengajukan surat (`POST /warga/surat`, tanpa CSRF §5.6).
   * Nomor surat TIDAK dikirim: server yang menghasilkannya dari antrean DB
   * sehingga tidak pernah bentrok dengan nomor milik warga lain. `noKk` baris
   * dipaksa ke nilai sesi agar filter Pengajuan Surat tetap menangkap baris
   * server. OFFLINE → baris lokal (mode demo); galat lain DITERUSKAN.
   *
   * Batch 9 — `lampiran` ikut dikirim sebagai multipart (≤3 · 5 MB/berkas).
   * MENJAWAB `true` hanya bila baris tersimpan di server; `false` = baris
   * lokal mode demo (berkas TIDAK tersimpan — pemicu flash jujur di komponen).
   */
  const ajukanSuratWargaSesi = async (
    s: Omit<Surat, "id">,
    lampiran?: File[],
  ): Promise<boolean> => {
    let baris: Surat | null = null;
    try {
      const hasil = await ajukanSuratWarga({ jenis: s.jenis, keperluan: s.keperluan }, lampiran);
      baris = { ...barisSuratServerKeFe(hasil.surat), ...(s.noKk ? { noKk: s.noKk } : {}) };
    } catch (e) {
      if (!(e instanceof GalatApi && e.code === "OFFLINE")) {
        tanganiSesiHabis(e);
        throw e;
      }
    }
    // Baris demo/offline TIDAK PERNAH membawa lampiran — tak ada berkas yang
    // benar-benar tersimpan, jangan ditampilkan seolah ada.
    const baru: Surat = baris ?? { ...s, id: `s${Date.now()}`, lampiran: [] };
    setSuratList((prev) => [baru, ...prev]);
    return baris !== null;
  };

  // RT membuat tagihan kondisional → API-first (POST /rt/iuran/kondisional):
  // tagihan benar-benar tersimpan & tampil di Portal Warga. OFFLINE → baris
  // lokal mode demo (tetap disebut demo, bukan sukses server). Galat lain
  // (validasi / sesi habis) DITERUSKAN agar komponen menampilkan gagal.
  // `true` = tagihan tercatat di server; `false` = baris demo lokal (OFFLINE)
  // — halaman wajib membedakan keduanya pada pesan suksesnya.
  const tambahTagihanTambahan = async (t: TagihanTambahanBaru): Promise<boolean> => {
    // Target "alamat rumah" dipetakan ke wargaId aktif milik RT tersebut.
    const targetWargaId =
      t.target && t.target !== "semua"
        ? wargaRtList
            .filter((w) => w.idWarga && shortAlamat(w.alamat) === shortAlamat(t.target as string))
            .map((w) => w.idWarga as string)
        : undefined;
    if (t.target && t.target !== "semua" && (!targetWargaId || targetWargaId.length === 0)) {
      throw new Error(`Rumah "${t.target}" tidak ditemukan pada data warga aktif.`);
    }
    try {
      await buatKondisionalRt({
        nama: t.nama,
        nominal: t.nominal,
        ...(t.tenggatIso ? { tenggat: t.tenggatIso } : {}),
        ...(targetWargaId ? { target: targetWargaId } : {}),
      });
    } catch (e) {
      if (!(e instanceof GalatApi && e.code === "OFFLINE")) {
        tanganiSesiHabis(e);
        throw e;
      }
      // OFFLINE → mode demo: baris lokal (perilaku lama) tanpa mengaku tersimpan.
      setTagihanTambahanList((prev) => [
        {
          ...t,
          id: `tt${Date.now()}`,
          icon: t.target && t.target !== "semua" ? "home_work" : "receipt",
          ref: `INV-2026-10-${String(prev.length + 1).padStart(2, "0")}`,
          status: "Belum",
        },
        ...prev,
      ]);
      return false;
    }
    // Sukses server → muat ulang daftar agar progres & label ikut terbarui;
    // bila muat ulang gagal, tagihan tetap tercatat (tampil pada muat berikutnya).
    try {
      const k = await daftarKondisionalRt();
      setTagihanTambahanList(k.daftar.map(kondisionalRtKeKartu));
    } catch {
      /* tagihan sudah tercatat di server — daftar dimuat ulang pada akses berikutnya */
    }
    return true;
  };

  // Warga membayar tagihan kondisional → AJUAN BUKTI ke server (status
  // "Menunggu Verifikasi" sampai pengurus memverifikasi) — bukan penanda lunas
  // sepihak seperti perilaku demo lama. OFFLINE → baris lokal berstatus jujur
  // "Menunggu Verifikasi" (mode demo), bukan "Lunas".
  const bayarTagihanTambahan = async (t: TagihanTambahan): Promise<boolean> => {
    const nominal = t.sisa !== undefined && t.sisa > 0 ? t.sisa : t.nominal;
    const nama = kkList[0]?.kepala ?? "Warga";
    const alamat = shortAlamat(kkList[0]?.alamat ?? "");
    let baris: Pembayaran;
    let dariServer = true;
    try {
      const hasil = await ajukanBuktiIuran(
        { nominal, metode: "transfer", catatan: `Tagihan kondisional: ${t.nama}` },
        `knd-${t.id}-${Date.now()}`,
      );
      baris = barisKePembayaran(hasil.pembayaran, alamat, nama);
    } catch (e) {
      if (!(e instanceof GalatApi && e.code === "OFFLINE")) {
        tanganiSesiHabis(e);
        throw e;
      }
      dariServer = false;
      baris = {
        id: `pay-${Date.now()}`,
        alamat,
        nama,
        periode: PERIODE_AKTIF,
        paket: t.nama,
        jumlah: nominal,
        metode: "Transfer Bank",
        metodeIcon: "account_balance",
        tanggal: hariIni(),
        status: "Menunggu Verifikasi",
      };
    }
    setPembayaran((prev) => [baris, ...prev.filter((x) => x.id !== baris.id)]);
    // Ringkas status (Menunggu → Lunas setelah verifikasi) ikut diperbarui.
    void tagihanIuran()
      .then((r) => setRingkasTagihanWarga(r.ringkas))
      .catch(() => undefined);
    return dariServer;
  };

  const catatAudit = (e: Omit<AuditEntry, "id" | "waktu" | "aksiBadge" | "ipAddress"> & { ipAddress?: string }) => {
    setAuditEntries((prev) => [
      { ipAddress: "192.168.1.50", ...e, id: `ax${Date.now()}`, waktu: waktuSekarang(), aksiBadge: badgeAksi(e.aksi) },
      ...prev,
    ]);
  };

  // RW memverifikasi surat tingkat RW → status tersinkron ke Portal RT & Warga (§7.4).
  const verifikasiSuratRw = (id: string, status: "Disetujui" | "Ditolak", catatanRw?: string) => {
    const row = suratList.find((s) => s.id === id);
    setSuratList((prev) => prev.map((s) => (s.id === id ? { ...s, status, catatanRw: catatanRw || s.catatanRw } : s)));
    catatAudit({
      user: "Pengurus RW",
      aksi: status === "Disetujui" ? "Verifikasi Surat" : "Tolak Surat",
      dataDiakses: "Surat Pengantar",
      detail: `${row?.noSurat || row?.jenis || id} — persetujuan tingkat RW: ${status}${catatanRw ? ` (${catatanRw})` : ""}`,
      portal: "rw",
      kategori: "surat",
    });
  };

  // Kas RW bersifat append-only (§7.3): hanya menambah, tidak pernah mengubah/menghapus.
  const tambahKasRw = (t: Omit<KasRw, "id" | "saldo">) => {
    setKasRwList((prev) => {
      const saldoAkhir = prev.length ? prev[prev.length - 1].saldo : 0;
      const delta = t.tipe === "Pemasukan" ? t.nominal : -t.nominal;
      return [...prev, { ...t, id: `kw${Date.now()}`, saldo: saldoAkhir + delta }];
    });
    catatAudit({
      user: "Pengurus RW",
      aksi: "Catat Kas",
      dataDiakses: "Buku Kas RW",
      detail: `${t.tipe}: ${t.keterangan} — Rp ${t.nominal.toLocaleString("id-ID")}`,
      portal: "rw",
      kategori: "kas",
    });
  };

  // Akses detail warga (§7.5): mode approval → menunggu RT; mode direct → wajib
  // justifikasi minimal MIN_JUSTIFIKASI karakter dan tetap tercatat di audit log.
  const ajukanAkses = (req: { rtTujuan: string; lingkup: string; alasan: string; mode: "approval" | "direct"; justifikasi?: string }) => {
    const justifikasi = (req.justifikasi ?? "").trim();
    if (req.mode === "direct" && justifikasi.length < MIN_JUSTIFIKASI) return; // UI juga memvalidasi
    setAksesList((prev) => [
      {
        id: `ax${Date.now()}`,
        pengaju: "Pengurus RW",
        rtTujuan: req.rtTujuan,
        lingkup: req.lingkup,
        alasan: req.alasan,
        mode: req.mode,
        justifikasi: req.mode === "direct" ? justifikasi : undefined,
        status: req.mode === "direct" ? "Diakses Direct" : "Menunggu",
        tanggal: hariIni(),
      },
      ...prev,
    ]);
    catatAudit({
      user: "Pengurus RW",
      aksi: req.mode === "direct" ? "Akses Direct" : "Ajukan Akses",
      dataDiakses: `Data Kependudukan ${req.rtTujuan}`,
      detail:
        req.mode === "direct"
          ? `Mode direct (bypass approval) — justifikasi: ${justifikasi}`
          : `Permintaan approval akses detail warga ke RT_ADMIN — ${req.alasan}`,
      portal: "rw",
      kategori: "akses",
    });
  };

  // Sisi RT_ADMIN: memutus permintaan akses RW → wajib tercatat juga (§7.5).
  const putusAkses = (id: string, status: "Disetujui" | "Ditolak", catatan?: string) => {
    const row = aksesList.find((a) => a.id === id);
    setAksesList((prev) =>
      prev.map((a) =>
        a.id === id
          ? {
              ...a,
              status,
              catatan,
              disetujuiOleh: status === "Disetujui" ? "Admin RT — Bpk. Joko Santoso" : undefined,
              masaBerlaku: status === "Disetujui" ? tanggalPlusHari(7) : undefined,
            }
          : a
      )
    );
    catatAudit({
      user: "Bpk. Joko Santoso",
      aksi: status === "Disetujui" ? "Setujui Akses" : "Tolak Akses",
      dataDiakses: `Data Kependudukan ${row?.rtTujuan ?? ""}`,
      detail: catatan || row?.alasan || `Keputusan ${status} atas permintaan akses RW`,
      portal: "rt",
      kategori: "akses",
      ipAddress: "192.168.1.105",
    });
  };

  // Tombol "Undangan" di Data Warga — SELALU API-first (Fase 3):
  //   • Backend menyala → terbitkan token asli lewat POST /rt/warga/:id/undangan
  //     (server mencabut token 'menunggu' lama → tepat satu undangan aktif
  //     per warga; penerbitan ulang selalu menghasilkan link baru).
  //   • Backend mati (galat OFFLINE) → get-or-create daftar lokal (mode demo).
  //   • Galat API lain (CONFLICT/VALIDATION/UNAUTHORIZED) DILEMPAR ke pemanggil
  //     agar ditampilkan via `flash` — tidak pernah menyamar sebagai sukses.
  const undanganUntukWarga = async (data: {
    nama: string;
    alamat: string;
    noWa: string;
    idWarga?: string;
  }): Promise<Undangan> => {
    try {
      // Kunci penerima `POST /rt/warga/:id/undangan`: UUID warga bila ada.
      // Tanpa ini, warga TANPA no. HP menghasilkan path kosong
      // (`/rt/warga//undangan` → 404) sehingga undangan tak pernah terbit.
      // Id lokal mode-demo (bukan UUID) tidak dikirim — fallback no. HP.
      const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const wa = digitsOnly(data.noWa);
      const kunci = data.idWarga && RE_UUID.test(data.idWarga) ? data.idWarga : wa;
      if (!kunci) {
        // Jujur & spesifik — jangan biarkan server menjawab 404 path kosong.
        throw new GalatApi(
          "VALIDATION",
          `${data.nama} belum punya no. HP — wajib diisi dulu di Data Warga (syarat login portal).`,
          400,
        );
      }
      const hasil = await buatUndanganRt(kunci);
      const baru: Undangan = {
        id: hasil.id,
        token: hasil.token,
        nama: hasil.nama,
        alamat: hasil.alamat,
        noWa: digitsOnly(hasil.noWa),
        dibuat: hariIni(),
        berlakuSampai: tanggalPendek(hasil.berlakuSampai),
        status: "Terkirim",
        dikirimOleh: hasil.dikirimOleh,
      };
      // Token baru menggantikan entri undangan sebelumnya milik warga ini.
      setUndanganList((prev) => [
        baru,
        ...prev.filter((x) => digitsOnly(x.noWa) !== digitsOnly(baru.noWa)),
      ]);
      catatAudit({
        user: "Bpk. Joko Santoso",
        aksi: "Kirim Undangan",
        dataDiakses: "Undangan Portal Warga",
        detail: `${baru.nama} — ${baru.alamat} • token ${baru.token} berlaku s/d ${baru.berlakuSampai}`,
        portal: "rt",
        kategori: "akses",
        ipAddress: "192.168.1.105",
      });
      return baru;
    } catch (err) {
      if (!(err instanceof GalatApi) || err.code !== "OFFLINE") throw err;

      // — Mode demo (backend mati): get-or-create pada daftar lokal —
      const digit = digitsOnly(data.noWa);
      if (digit.length < 10) {
        // Konfirmasi mode demo memakai 4 digit terakhir no. HP → tanpa nomor
        // yang lengkap, undangan tak akan bisa diaktifkan. Tolak dengan pesan
        // jujur, jangan menerbitkan token yang pasti buntu.
        throw new GalatApi(
          "VALIDATION",
          `${data.nama} belum punya no. HP — wajib diisi dulu di Data Warga (syarat login portal).`,
          400,
        );
      }
      const ada = undanganList.find(
        (x) => digitsOnly(x.noWa) === digit && x.status !== "Kedaluwarsa"
      );
      if (ada) return ada;
      const baru: Undangan = {
        id: `un${Date.now()}`,
        token: buatToken(),
        nama: data.nama.trim(),
        alamat: data.alamat,
        noWa: digit,
        dibuat: hariIni(),
        berlakuSampai: tanggalPlusHari(30),
        status: "Terkirim",
        dikirimOleh: "Bpk. Joko Santoso",
      };
      setUndanganList((prev) => [baru, ...prev]);
      catatAudit({
        user: "Bpk. Joko Santoso",
        aksi: "Kirim Undangan",
        dataDiakses: "Undangan Portal Warga",
        detail: `${baru.nama} — ${baru.alamat} • token ${baru.token} berlaku s/d ${baru.berlakuSampai}`,
        portal: "rt",
        kategori: "akses",
        ipAddress: "192.168.1.105",
      });
      return baru;
    }
  };

  // --- B3 · riwayat login warga (API-first) ---------------------------------
  // OFFLINE → `null` (halaman memakai data demo); galat lain DITERUSKAN setelah
  // `tanganiSesiHabis` supaya halaman menampilkan pesan gagal, bukan sukses.
  const riwayatLogin = async (): Promise<EntriRiwayatLogin[] | null> => {
    try {
      const hasil = await riwayatLoginWarga();
      return hasil.daftar;
    } catch (err) {
      if (err instanceof GalatApi && err.code === "OFFLINE") return null;
      tanganiSesiHabis(err);
      throw err;
    }
  };

  // --- B6 · inspeksi undangan multi-perangkat --------------------------------
  // Sumber kotak masuk keamanan Data Warga RT; OFFLINE → `null` (chip "Perlu
  // Perhatian" disembunyikan — mode demo tidak punya data percobaan).
  const inspeksiUndangan = async (): Promise<TemuanInspeksiUndangan[] | null> => {
    try {
      const hasil = await inspeksiUndanganRt();
      return hasil.daftar;
    } catch (err) {
      if (err instanceof GalatApi && err.code === "OFFLINE") return null;
      tanganiSesiHabis(err);
      throw err;
    }
  };

  // --- B5 · kirim ulang / cabut undangan & ubah akses portal -----------------
  /** Token lama dicabut server, token baru terbit — daftar undangan ikut disinkronkan. */
  const kirimUlangUndangan = async (
    tokenId: string,
    noHpBaru?: string,
  ): Promise<Undangan | null> => {
    try {
      const h = await kirimUlangUndanganRt(tokenId, noHpBaru);
      const baru: Undangan = {
        id: h.id,
        token: h.token,
        nama: h.nama,
        alamat: h.alamat,
        noWa: digitsOnly(h.noWa),
        dibuat: hariIni(),
        berlakuSampai: tanggalPendek(h.berlakuSampai),
        status: "Terkirim",
        dikirimOleh: h.dikirimOleh,
      };
      // Token BARU menggantikan seluruh entri undangan warga tersebut.
      setUndanganList((prev) => [
        baru,
        ...prev.filter((x) => x.id !== baru.id && digitsOnly(x.noWa) !== digitsOnly(baru.noWa)),
      ]);
      catatAudit({
        user: "Bpk. Joko Santoso",
        aksi: "Kirim Ulang Undangan",
        dataDiakses: "Undangan Portal Warga",
        detail: `${baru.nama} — ${baru.alamat} • token baru berlaku s/d ${baru.berlakuSampai}`,
        portal: "rt",
        kategori: "akses",
        ipAddress: "192.168.1.105",
      });
      return baru;
    } catch (err) {
      if (err instanceof GalatApi && err.code === "OFFLINE") return null;
      tanganiSesiHabis(err);
      throw err;
    }
  };

  /** Cabut token (idempoten di server) — entri undangan dikeluarkan dari daftar. */
  const cabutUndangan = async (tokenId: string): Promise<boolean | null> => {
    try {
      await cabutUndanganRt(tokenId);
      setUndanganList((prev) => prev.filter((x) => x.id !== tokenId));
      catatAudit({
        user: "Bpk. Joko Santoso",
        aksi: "Cabut Undangan",
        dataDiakses: "Undangan Portal Warga",
        detail: `Token ${tokenId} dicabut — tautan tidak lagi dapat dipakai`,
        portal: "rt",
        kategori: "akses",
        ipAddress: "192.168.1.105",
      });
      return true;
    } catch (err) {
      if (err instanceof GalatApi && err.code === "OFFLINE") return null;
      tanganiSesiHabis(err);
      throw err;
    }
  };

  /**
   * Nonaktifkan akses portal (satu-satunya arah yang diizinkan — Okt 2026:
   * pengurus RT hanya dapat mengubah status portal MENJADI nonaktif; server
   * menolak `aktif`). Server mencabut sesi warga yang sedang login;
   * `null` = OFFLINE (mode demo).
   */
  const ubahAksesWarga = async (
    idWarga: string,
    tujuan: "dinonaktifkan",
  ): Promise<StatusAksesServer | null> => {
    try {
      const hasil = await ubahAksesWargaRt(idWarga, tujuan);
      return hasil.statusAkses;
    } catch (err) {
      if (err instanceof GalatApi && err.code === "OFFLINE") return null;
      tanganiSesiHabis(err);
      throw err;
    }
  };

  // Warga mengonfirmasi 4 digit terakhir no. HP di halaman publik undangan.
  const konfirmasiUndangan = (
    token: string,
    empatDigit: string
  ): "ok" | "salah" | "tidak-ditemukan" | "kedaluwarsa" => {
    const u = undanganList.find((x) => x.token === token);
    if (!u) return "tidak-ditemukan";
    if (u.status === "Kedaluwarsa") return "kedaluwarsa";
    if (digitsOnly(empatDigit) !== empatDigitAkhir(u.noWa)) return "salah";
    if (u.status !== "Dipakai") {
      setUndanganList((prev) =>
        prev.map((x) => (x.id === u.id ? { ...x, status: "Dipakai" as const } : x))
      );
      // Sinkron dua arah: warga sudah konfirmasi → di Data Warga statusnya jadi Aktif.
      setWargaRtList((prev) =>
        prev.map((x) =>
          digitsOnly(x.noWa) === digitsOnly(u.noWa)
            ? { ...x, statusPortal: "Aktif", statusBadge: badgePortal("Aktif") }
            : x
        )
      );
      catatAudit({
        user: u.nama,
        aksi: "Konfirmasi Undangan",
        dataDiakses: "Portal Warga",
        detail: `Token ${token} — konfirmasi 4 digit terakhir no. HP (${u.alamat})`,
        portal: "warga",
        kategori: "akses",
        ipAddress: "192.168.1.77",
      });
    }
    return "ok";
  };

  const navigate = (p: string) => {
    // Navigasi manual ke halaman masuk → keterangan sesi lama tidak usang.
    if (p === "login") setPesanSesi(null);
    // Membuka dokumen hukum mencatat halaman asal agar "Kembali" berfungsi.
    // Berpindah antar dokumen hukum TIDAK menimpa asal — "Kembali" selalu
    // mengembalikan pengguna ke tempat tautan pertama diklik.
    const bukaDokumenHukum = p === "syarat-ketentuan" || p === "kebijakan-privasi";
    const sedangDiDokumenHukum = page === "syarat-ketentuan" || page === "kebijakan-privasi";
    if (bukaDokumenHukum && !sedangDiDokumenHukum) setHalamanSebelumnya(page);
    setPage(p as Page);
  };
  // B3 · logout SELALU lewat konfirmasi (dialog bersama keempat layout) —
  // server baru dicabut setelah pengguna menekan "Ya, Keluar".
  const logout = () => setKonfirmasiKeluar(true);

  /** Menjalankan logout setelah konfirmasi — perilaku logout lama dipertahankan. */
  const keluarAkun = () => {
    setKonfirmasiKeluar(false);
    // Cabut sesi di server bila backend menyala (best-effort — mode demo tanpa
    // backend tetap berjalan; api.ts menelan galat `OFFLINE`).
    if (peranMasuk === "warga") void logoutWarga();
    else if (peranMasuk) void logoutPengurus();
    setPeranMasuk(null);
    setProfilSesi(null);
    setPeringatanSesi(false);
    // Keluar dari konsol admin juga menghapus path /admin dari URL.
    if (pathAdmin() && typeof window !== "undefined") {
      window.history.pushState({}, "", dasarDeploy());
    }
    setPage("landing");
  };

  // B3 · seluruh konten halaman dirender lewat fungsi ini — konfirmasi keluar
  // & peringatan sesi lalu ditumpuk di ATAS halaman mana pun (dialog global
  // hanya boleh punya satu titik render, bukan disalin ke 13 return).
  const renderHalaman = (): React.ReactNode => {
    // Halaman publik undangan (/undangan/<token>, dibuka via link atau QR) —
    // berdiri sendiri tanpa layout portal.
    // Render guard: satu frame pun halaman portal yang tidak berhak tidak boleh
    // tampil — gerbang peran di atas menyelesaikan pengalihan lebih dulu.
    if (PORTAL_HALAMAN[page] && peranMasuk !== PORTAL_HALAMAN[page]) return null;

    if (page === "verifikasi-surat") {
      // Halaman publik /q/<token> (§5.7) — tanpa sesi, tanpa layout portal;
      // "Kembali" mengembalikan pengguna ke beranda dan membersihkan path QR.
      return (
        <VerifikasiSuratPage
          token={tokenQrSurat ?? ""}
          onKembali={() => {
            if (typeof window !== "undefined") window.history.pushState({}, "", dasarDeploy());
            setPage("landing");
          }}
        />
      );
    }

    if (page === "undangan-publik") {
      return (
        <UndanganPage
          token={tokenUndangan ?? ""}
          undangan={undanganList}
          onKonfirmasi={konfirmasiUndangan}
          onMasukPortal={(aktif) => {
            // Mode produksi: aktivasi API berhasil — server sudah menanam sesi
            // warga. Sinkronkan daftar demo (status baris Data Warga) + audit lokal
            // agar tampilan Portal RT konsisten (audit resmi tercatat di server).
            if (aktif) {
              setWargaRtList((prev) =>
                prev.map((x) =>
                  x.nama === aktif.nama && x.alamat === aktif.alamat
                    ? { ...x, statusPortal: "Aktif", statusBadge: badgePortal("Aktif") }
                    : x
                )
              );
              catatAudit({
                user: aktif.nama,
                aksi: "Aktivasi Undangan",
                dataDiakses: "Portal Warga",
                detail: `Aktivasi berhasil — kata sandi dibuat (${aktif.alamat})`,
                portal: "warga",
                kategori: "akses",
                ipAddress: "192.168.1.77",
              });
            }
            // Profil menjadi rujukan nama di Portal Warga. Mode demo (aktivasi
            // saat server mati): nama warga diambil dari daftar undangan lokal
            // via token aktif + ditandai `modeDemo` (banner jujur); mode
            // produksi: nama dari hasil/detail aktivasi server.
            const namaDemo = tokenUndangan
              ? undanganList.find((u) => u.token === tokenUndangan)?.nama
              : undefined;
            setProfilSesi(
              aktif
                ? { peran: "warga", nama: aktif.nama }
                : namaDemo
                  ? { peran: "warga", nama: namaDemo, modeDemo: true }
                  : null,
            );
            setPeranMasuk("warga");
            if (typeof window !== "undefined") window.history.pushState({}, "", dasarDeploy());
            setPage("portal-warga");
          }}
          onKembali={() => {
            // Tombol kembali diarahkan ke halaman Data Warga (Portal RT).
            if (typeof window !== "undefined") window.history.pushState({}, "", dasarDeploy());
            setPage("data-warga-rt");
          }}
        />
      );
    }

    if (page === "portal-warga") {
      return (
        <PortalWargaLayout currentPage={page} onNavigate={navigate} onLogout={logout} profil={profilSesi}>
          <PortalWarga
            onNavigate={navigate}
            kkList={kkList}
            kategoriIuran={kategoriIuran}
            kendaraanR4Count={kendaraanR4Count}
            kasRt={kasRtList}
            surat={suratList}
            tagihanTambahan={tagihanTambahanList}
            pembayaran={pembayaran}
            onBayarTagihanTambahan={bayarTagihanTambahan}
          />
        </PortalWargaLayout>
      );
    }

    if (page === "data-keluarga") {
      return (
        <PortalWargaLayout currentPage={page} onNavigate={navigate} onLogout={logout} profil={profilSesi}>
          <DataKeluarga
            onNavigate={navigate}
            kkList={kkList}
            onKkAdded={(kk) => setKkList((prev) => [...prev, kk])}
            onKkUpdated={(kkId, patch) =>
              setKkList((prev) => prev.map((k) => (k.id === kkId ? { ...k, ...patch } : k)))
            }
            onSimpanKontak={simpanKontakAnggota}
            ajuan={ajuanWarga}
            onAjukan={ajukanPerubahanAnggota}
            kendaraanR4Count={kendaraanR4Count}
            onKendaraanR4Change={simpanKendaraanR4Warga}
          />
        </PortalWargaLayout>
      );
    }

    if (page === "iuran-tagihan") {
      return (
        <PortalWargaLayout currentPage={page} onNavigate={navigate} onLogout={logout} profil={profilSesi}>
          <IuranTagihan
            onNavigate={navigate}
            kendaraanR4Count={kendaraanR4Count}
            kategoriIuran={kategoriIuran}
            alamat={shortAlamat(kkList[0]?.alamat ?? "")}
            nama={kkList[0]?.kepala ?? "Warga"}
            pembayaran={pembayaran}
            ringkasServer={ringkasTagihanWarga}
            onBayar={async (p) => {
              // F-6: ajukan ke API; OFFLINE → baris lokal (mode demo). Galat lain
              // (mis. sesi habis) diteruskan agar halaman menampilkan gagal, bukan sukses.
              let baris: Pembayaran;
              let dariApi = false;
              try {
                const hasil = await ajukanBuktiIuran(
                  {
                    nominal: p.jumlah,
                    metode: metodeKeServer(p.metode),
                    ...(p.paket ? { catatan: `Paket ${p.paket}` } : {}),
                  },
                  p.id,
                );
                baris = barisKePembayaran(hasil.pembayaran, p.alamat, p.nama);
                dariApi = true;
              } catch (e) {
                if (!(e instanceof GalatApi && e.code === "OFFLINE")) {
                  tanganiSesiHabis(e);
                  throw e;
                }
                baris = { ...p, periode: PERIODE_AKTIF };
              }
              setPembayaran((prev) => [baris, ...prev.filter((x) => x.id !== baris.id)]);
              if (dariApi) {
                // Segarkan ringkas status tagihan (→ menunggu verifikasi); gagal →
                // `null` supaya status kembali diturunkan dari riwayat lokal.
                const t = await tagihanIuran().catch(() => null);
                setRingkasTagihanWarga(t ? t.ringkas : null);
              }
            }}
            kasRt={kasRtList}
            tagihanTambahan={tagihanTambahanList}
            onBayarTagihanTambahan={bayarTagihanTambahan}
          />
        </PortalWargaLayout>
      );
    }

    if (page === "pengajuan-surat") {
      return (
        <PortalWargaLayout currentPage={page} onNavigate={navigate} onLogout={logout} profil={profilSesi}>
          <PengajuanSurat
            onNavigate={navigate}
            surat={suratList}
            noKk={kkList[0]?.noKk ?? ""}
            pemohon={kkList[0]?.kepala ?? "Warga"}
            ketuaRt={ketuaRt}
            onAjukan={ajukanSuratWargaSesi}
            onMuatKopSurat={muatKopSuratWargaSesi}
            onEdit={(id, patch) =>
              setSuratList((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)))
            }
            onHapus={(id) => setSuratList((prev) => prev.filter((s) => s.id !== id))}
          />
        </PortalWargaLayout>
      );
    }

    if (page === "riwayat-aktivitas") {
      return (
        <PortalWargaLayout currentPage={page} onNavigate={navigate} onLogout={logout} profil={profilSesi}>
          <RiwayatAktivitas
            onNavigate={navigate}
            pembayaran={pembayaran}
            surat={suratList}
            tagihanTambahan={tagihanTambahanList}
            alamat={alamatWarga}
            noKk={kkList[0]?.noKk ?? ""}
            onRiwayatLogin={riwayatLogin}
          />
        </PortalWargaLayout>
      );
    }

    const rtPages: Record<string, React.ReactNode> = {
      "dashboard-rt": <DashboardRT
        onNavigate={navigate}
        profil={profilSesi}
        kkList={kkList}
        wargaRt={wargaRtList}
        hunian={hunianList}
        kasRt={kasRtList}
        kategoriIuran={kategoriIuran}
        pembayaran={pembayaran}
        surat={suratList}
        tagihanTambahan={tagihanTambahanList}
      />,
      "data-hunian-rt": <DataHunianRT
        onNavigate={navigate}
        kkList={kkList}
        hunian={hunianList}
        onHunianChange={setHunianList}
        onTambahHunian={tambahHunianSesi}
        onUbahHunian={ubahHunianSesi}
        onHapusHunian={hapusHunianSesi}
        onHapusBanyak={hapusBanyakHunianSesi}
      />,
      "data-warga-rt": <DataWargaRT
        onNavigate={navigate}
        // Sakelar kejujuran mutasi: sesi daring ≠ mode demo → galat OFFLINE
        // adalah kegagalan nyata (form terbuka + pesan TIDAK tersimpan),
        // bukan fallback lokal yang mengaku "berhasil".
        modeDemo={profilSesi?.modeDemo}
        kkList={kkList}
        wargaRt={wargaRtList}
        hunian={hunianList}
        onWargaRtChange={setWargaRtList}
        onKkUpdated={(kkId, patch) =>
          setKkList((prev) => prev.map((k) => (k.id === kkId ? { ...k, ...patch } : k)))
        }
        onKkAdded={(kk) => setKkList((prev) => [...prev, kk])}
        onSimpanWarga={simpanWargaRt}
        onTambahWarga={tambahDataWargaRt}
        onTambahAnggotaKk={tambahAnggotaKkSesi}
        onHapusWarga={hapusDataWargaRt}
        onImporWarga={imporDataWargaRt}
        undangan={undanganList}
        onUndanganWarga={undanganUntukWarga}
        ajuan={ajuanRt}
        onVerifikasiAjuan={verifikasiAjuanRt}
        onKirimUlangUndangan={kirimUlangUndangan}
        onCabutUndangan={cabutUndangan}
        onUbahAksesWarga={ubahAksesWarga}
        onInspeksiUndangan={inspeksiUndangan}
      />,
      "iuran-rt": <IuranRT
        onNavigate={navigate}
        kategoriIuran={kategoriIuran}
        onKategoriChange={setKategoriIuran}
        onTambahKategori={tambahKategoriSesi}
        onUbahKategori={ubahKategoriSesi}
        pembayaran={pembayaran}
        onVerifikasi={async (id, status, kategoriTujuan, alasan) => {
          try {
            if (status === "Lunas") await setujuiPembayaranRt(id, undefined, kategoriTujuan);
            // Batch 15C — alasan tolak WAJIB di server; dialog IuranRT sudah
            // memastikan ≥3 karakter sebelum sampai ke sini.
            else await tolakPembayaranRt(id, alasan ?? "");
            // F-4: alokasi yang disetujui menulis entri kas OTOMATIS di server →
            // muat ulang buku kas agar langsung terlihat (daring saja; senyap bila
            // OFFLINE karena state demo tetap dipakai).
            void daftarKasRt()
              .then((k) => setKasRtList(k.entri.map(entriKeKasRt)))
              .catch(() => undefined);
            // Sinkron status dua arah: baris pembayaran & kartu kondisional RT
            // dimuat ulang dari server (alokasi/sisa terbaru, bukan cache lokal).
            void pembayaranRt()
              .then((r) =>
                setPembayaran(
                  r.pembayaran.map((b) => barisKePembayaran(b, b.alamat ?? "-", b.nama ?? "-")),
                ),
              )
              .catch(() => undefined);
            void daftarKondisionalRt()
              .then((k) => setTagihanTambahanList(k.daftar.map(kondisionalRtKeKartu)))
              .catch(() => undefined);
          } catch (e) {
            // OFFLINE → mode demo, tetap perbarui state lokal; galat lain (sesi
            // habis / server menolak) diteruskan — jangan pernah tampilkan sukses.
            if (!(e instanceof GalatApi && e.code === "OFFLINE")) {
              tanganiSesiHabis(e);
              throw e;
            }
          }
          setPembayaran((prev) => prev.map((p) => (p.id === id ? { ...p, status } : p)));
        }}
        alamatWarga={alamatWarga}
        kendaraanR4Count={kendaraanR4Count}
        tagihanTambahan={tagihanTambahanList}
        onTambahTagihanTambahan={tambahTagihanTambahan}
        onMuatKategoriServer={muatKategoriServer}
        onMuatPengaturanIuran={muatPengaturanIuran}
        onGenerateTagihan={generateTagihanSesi}
        onTutupBuku={tutupBukuSesi}
        onBukaBuku={bukaBukuSesi}
        onMuatTagihanServer={muatTagihanServer}
        onMuatProfilIuran={muatProfilIuranSesi}
        onSimpanProfilIuran={simpanProfilIuranSesi}
        onUbahNominalTagihan={ubahNominalTagihanSesi}
      />,
      "kas-rt": <KasRT onNavigate={navigate} kasRt={kasRtList} onTambahKas={tambahKasRt} onKoreksiKas={koreksiEntriKas} />,
      "surat-pengantar-rt": <SuratPengantarRT
        onNavigate={navigate}
        pengurus={pengurus}
        surat={suratList}
        onProsesSurat={prosesSuratRtSesi}
        onMuatPengaturanSurat={muatPengaturanSuratRtSesi}
      />,
      "laporan-bulanan-rt": <LaporanBulananRT
        onNavigate={navigate}
        kkList={kkList}
        wargaRt={wargaRtList}
        hunian={hunianList}
        kasRt={kasRtList}
        kategoriIuran={kategoriIuran}
        pembayaran={pembayaran}
        surat={suratList}
        pengurus={pengurus}
      />,
      "audit-log-pdp": <AuditLogPDP
        onNavigate={navigate}
        entries={auditEntries}
        aksesList={aksesList}
        onPutusAkses={putusAkses}
      />,
      "pengaturan-rt": <PengaturanRT
        onNavigate={navigate}
        pengurus={pengurus}
        onPengurusChange={setPengurus}
        langganan={langganan}
        onLanggananChange={setLangganan}
        onMuatPengaturanIuran={muatPengaturanIuran}
        onSimpanPengaturanIuran={simpanPengaturanIuranSesi}
        onMuatPengaturanSurat={muatPengaturanSuratRtSesi}
        onSimpanPengaturanSurat={simpanPengaturanSuratRtSesi}
      />,
    };

    if (page in rtPages) {
      return (
        <PortalRTLayout currentPage={page} onNavigate={navigate} onLogout={logout} profil={profilSesi}>
          {rtPages[page]}
        </PortalRTLayout>
      );
    }

    const rwPages: Record<string, React.ReactNode> = {
      "dashboard-rw": <DashboardRW
        onNavigate={navigate}
        surat={suratList}
        akses={aksesList}
        kasRw={kasRwList}
      />,
      "iuran-rw": <IuranRW onNavigate={navigate} />,
      "kas-rw": <KasRW
        onNavigate={navigate}
        kasRw={kasRwList}
        onTambah={tambahKasRw}
      />,
      "surat-rw": <VerifikasiSuratRW
        onNavigate={navigate}
        surat={suratList}
        onVerifikasi={verifikasiSuratRw}
      />,
      "akses-rw": <AksesDetailRW
        onNavigate={navigate}
        akses={aksesList}
        onAjukan={ajukanAkses}
      />,
      "riwayat-rw": <RiwayatRW
        onNavigate={navigate}
        entries={auditEntries}
        akses={aksesList}
        kasRw={kasRwList}
      />,
      "laporan-rw": <LaporanRW
        onNavigate={navigate}
        kasRw={kasRwList}
      />,
      "pengaturan-rw": <PengaturanRW onNavigate={navigate} />,
    };

    if (page in rwPages) {
      return (
        <PortalRWLayout currentPage={page} onNavigate={navigate} onLogout={logout}>
          {rwPages[page]}
        </PortalRWLayout>
      );
    }

    const adminPages: Record<string, React.ReactNode> = {
      "dashboard-admin": <DashboardAdmin
        onNavigate={navigate}
        tenants={adminTenants}
        transaksi={adminTransaksi}
        layanan={layananSistem}
        metrik={metrikSistem}
      />,
      "langganan-admin": <LanggananAdmin
        tenants={adminTenants}
        transaksi={adminTransaksi}
      />,
      "tenant-admin": <TenantAdmin
        tenants={adminTenants}
        onToggleStatus={toggleTenant}
      />,
      "konten-admin": <KontenAdmin
        konten={kontenLanding}
        onSimpan={simpanKontenLanding}
      />,
      "audit-admin": <AuditAdmin entries={auditPlatform} />,
      "sistem-admin": <SistemAdmin
        layanan={layananSistem}
        metrik={metrikSistem}
      />,
    };

    if (page in adminPages) {
      // Build publik (GitHub Pages) menonaktifkan konsol sysadmin — portal ini
      // belum berautentikasi sehingga tidak ikut dipublikasikan. Baik lewat
      // path /admin maupun navigasi state, hasilnya selalu halaman awal.
      if (!KONSOL_ADMIN_AKTIF) return <LandingPage onNavigate={navigate} konten={kontenLanding} />;
      return (
        <AdminLayout currentPage={page} onNavigate={navigate} onLogout={logout}>
          {adminPages[page]}
        </AdminLayout>
      );
    }

    if (page === "login") {
      return (
        <LoginPage
          pesanAwal={pesanSesi}
          onBack={() => setPage("landing")}
          onNavigate={navigate}
          onLogin={(role, profil) => {
            setPesanSesi(null);
            setPeranMasuk(role);
            // Profil login = rujukan nama/jabatan di header portal + tanda
            // "MODE DEMO" bila masuk saat server tidak terjangkau (Okt 2026:
            // "Profile login harus sesuai dengan data login").
            setProfilSesi(profil ?? null);
            if (role === "warga") setPage("portal-warga");
            if (role === "rt") setPage("dashboard-rt");
            if (role === "rw") setPage("dashboard-rw");
          }}
        />
      );
    }

    if (page === "syarat-ketentuan") {
      return <SyaratKetentuanPage onBack={() => setPage(halamanSebelumnya)} onNavigate={navigate} />;
    }
    if (page === "kebijakan-privasi") {
      return <KebijakanPrivasiPage onBack={() => setPage(halamanSebelumnya)} onNavigate={navigate} />;
    }

    if (page === "aktivasi-rt") {
      // Halaman publik aktivasi pendaftaran mandiri — sukses = sesi RT sudah
      // terpasang server; portlet langsung menyetel peran & masuk portal.
      return (
        <AktivasiRtPage
          token={tokenAktivasiRt ?? ""}
          onKembali={() => setPage("landing")}
          onLogin={(profil) => {
            // Bersihkan path /aktivasi-rt/<token> agar refresh tidak
            // membuka ulang tautan yang sudah terpakai.
            if (typeof window !== "undefined") window.history.pushState({}, "", dasarDeploy());
            setPeranMasuk("rt");
            setProfilSesi(profil);
            setPage("dashboard-rt");
          }}
        />
      );
    }

    return <LandingPage onNavigate={navigate} konten={kontenLanding} />;
  };

  // B3 · dialog global — konfirmasi keluar & peringatan sesi dirender di
  // atas halaman apa pun sehingga keempat layout berbagi satu titik render.
  return (
    <>
      {renderHalaman()}

      {/* Okt 2026 · kejujuran mode demo: banner global selama sesi OFFLINE —
          data di layar adalah contoh di memori, bukan data RT sungguhan. */}
      {profilSesi?.modeDemo && (
        <div
          role="status"
          className="fixed inset-x-0 top-0 z-[60] bg-amber-400/95 text-amber-950 text-center text-[11px] sm:text-xs font-extrabold tracking-wide py-1.5 px-4 shadow-md"
        >
          MODE DEMO — server tidak terjangkau; data contoh di memori, bukan data RT sungguhan.
        </div>
      )}

      {konfirmasiKeluar && (
        <KonfirmasiDialog
          judul="Keluar dari akun?"
          pesan="Sesi Anda akan diakhiri dan Anda harus masuk kembali untuk membuka portal."
          labelYa="Ya, Keluar"
          labelBatal="Batal"
          ikon="logout"
          aksen="error"
          onBatal={() => setKonfirmasiKeluar(false)}
          onYa={keluarAkun}
        />
      )}

      {peringatanSesi && (
        <KonfirmasiDialog
          judul="Sesi Hampir Berakhir"
          pesan="Anda belum beraktivitas selama hampir 30 menit — sesi akan keluar otomatis dalam ±1 menit."
          labelYa="Tetap Masuk"
          labelBatal="Keluar Sekarang"
          ikon="timer"
          aksen="primary"
          onBatal={() => void akhiriSesiDiam()}
          onYa={() => {
            aktivitasRef.current = Date.now();
            setPeringatanSesi(false);
          }}
        />
      )}
    </>
  );
}
