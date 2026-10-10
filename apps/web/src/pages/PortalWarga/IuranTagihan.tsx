import { useState } from "react";
import { tenant } from "../../lib/tenant";
import {
  KategoriIuran,
  KasRt,
  Pembayaran,
  Pengurus,
  PERIODE_AKTIF,
  StatusPembayaran,
  TagihanTambahan,
  deskripsiIuran,
  formatRupiah,
  hariIni,
  hitungIuranBulanan,
  kategoriTagihan,
  rekapKasRt,
  saldoKasRt,
  shortAlamat,
} from "../../lib/shared";
import { useFlash } from "../../lib/useFlash";
import { buktiHref, labelPeriodeServer, type RingkasTagihanServer } from "../../lib/api";

interface IuranTagihanProps {
  onNavigate?: (page: string) => void;
  kendaraanR4Count?: number;
  kategoriIuran: KategoriIuran[];
  alamat: string;
  nama: string;
  pembayaran: Pembayaran[];
  /** Batch 19 · pengurus RT tercatat — sumber nama Bendahara (bukan contoh). */
  pengurus?: Pengurus[];
  /** F-6: ringkas tagihan dari API (null = mode demo → turunan riwayat lokal). */
  ringkasServer?: RingkasTagihanServer["ringkas"] | null;
  /**
   * API-first (Batch 15E) — komponen menunggu sebelum flash; balikan
   * `"server"` (benar-benar terkirim) | `"lokal"` (mode demo/OFFLINE) dipakai
   * untuk flash yang jujur. `berkas` = file struk (dikirim multipart).
   */
  onBayar: (p: Pembayaran, berkas?: File) => Promise<"server" | "lokal">;
  kasRt: KasRt[];
  tagihanTambahan: TagihanTambahan[];
  /** Bayar tagihan kondisional → ajukan bukti (true = terkirim ke server). */
  onBayarTagihanTambahan: (t: TagihanTambahan) => Promise<boolean> | boolean;
}

/** Arsip statis riwayat periode sebelumnya (hunian ini). */
interface RiwayatBayar {
  id: string;
  tanggal: string;
  jam: string;
  periodeLabel: string;
  periodeDetail: string;
  total: number;
  metode: string;
  metodeIcon: string;
  status: StatusPembayaran;
}

/** Satu baris tabel riwayat = pengajuan warga (shared) + arsip statis. */
interface BarisRiwayat {
  id: string;
  tanggal: string;
  jam: string;
  /** Deskripsi pembayaran (kategori iuran) — informasi utama kolom riwayat. */
  deskripsi: string;
  periodeLabel: string;
  periodeDetail: string;
  total: string;
  /** Nominal mentah (untuk PDF kuitansi — `total` hanya label tampilan). */
  jumlah: number;
  metode: string;
  metodeIcon: string;
  status: StatusPembayaran;
  atasNama: string;
  hunian: string;
  /** Batch 15E — file bukti tersimpan/URL (null = baris arsip/demo). */
  bukti?: string | null;
  /** Baris Ditolak → alasan penolakan dari RT (dasar "Ajukan Ulang"). */
  alasan?: string | null;
  /** ISO verifikasi — hanya baris server yang sudah diverifikasi. */
  diverifikasiPada?: string | null;
}

const periodeBayar = [
  { label: "1 Bulan", sub: "Bulanan Reguler", months: 1, badge: "" },
  { label: "2 Bulan", sub: "Bayar Ganda", months: 2, badge: "" },
  { label: "3 Bulan", sub: "Triwulan", months: 3, badge: "" },
  { label: "4 Bulan", sub: "4 Bulan", months: 4, badge: "" },
  { label: "6 Bulan", sub: "Semester", months: 6, badge: "Praktis" },
  { label: "1 Tahun", sub: "12 Bulan Penuh", months: 12, badge: "Bebas Ribet" },
];

/** Warna bar berputar untuk pos alokasi hasil agregasi buku kas. */
const WARNA_ALOKASI = ["bg-primary", "bg-secondary", "bg-tertiary", "bg-outline-variant"];

const kategoriIconById: Record<string, string> = {
  keamanan: "shield",
  kebersihan: "delete_sweep",
  sosial: "volunteer_activism",
  r4: "directions_car",
};

function iconKategori(k: KategoriIuran): string {
  if (k.tipe === "per_unit") return "directions_car";
  return kategoriIconById[k.id] ?? "receipt";
}

const badgeStatus: Record<StatusPembayaran, string> = {
  Lunas: "bg-secondary-container text-on-secondary-container",
  "Menunggu Verifikasi": "bg-tertiary-container text-on-tertiary-container",
  Ditolak: "bg-error-container text-on-error-container",
};

const dotStatus: Record<StatusPembayaran, string> = {
  Lunas: "bg-secondary",
  "Menunggu Verifikasi": "bg-tertiary",
  Ditolak: "bg-error",
};

const riwayatPembayaran: RiwayatBayar[] = [
  {
    id: "rb1",
    tanggal: "05 Okt 2026",
    jam: "09:15 WIB",
    periodeLabel: "Oktober 2026",
    periodeDetail: "1 Bulan",
    total: 170000,
    metode: "QRIS Mandiri",
    metodeIcon: "qr_code_2",
    status: "Lunas",
  },
  {
    id: "rb2",
    tanggal: "05 Jul 2026",
    jam: "19:40 WIB",
    periodeLabel: "Jul - Sep 2026",
    periodeDetail: "3 Bulan",
    total: 510000,
    metode: "Tunai Bendahara RT",
    metodeIcon: "payments",
    status: "Lunas",
  },
  {
    id: "rb3",
    tanggal: "08 Apr 2026",
    jam: "14:22 WIB",
    periodeLabel: "Apr - Agu 2026",
    periodeDetail: "5 Bulan",
    total: 850000,
    metode: "Transfer Bank BCA",
    metodeIcon: "account_balance",
    status: "Lunas",
  },
  {
    id: "rb4",
    tanggal: "03 Jan 2026",
    jam: "10:05 WIB",
    periodeLabel: "Jan - Jun 2026",
    periodeDetail: "6 Bulan",
    total: 1020000,
    metode: "QRIS Mandiri",
    metodeIcon: "qr_code_2",
    status: "Lunas",
  },
];

export function IuranTagihan({
  onNavigate,
  kendaraanR4Count = 1,
  kategoriIuran,
  alamat,
  nama,
  pembayaran,
  pengurus = [],
  ringkasServer = null,
  onBayar,
  kasRt = [],
  tagihanTambahan = [],
  onBayarTagihanTambahan,
}: IuranTagihanProps) {
  const [selectedPeriode, setSelectedPeriode] = useState(0);
  const [showQris, setShowQris] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [showTunai, setShowTunai] = useState(false);
  const [tunaiNominal, setTunaiNominal] = useState("");
  const [tunaiPeriode, setTunaiPeriode] = useState("");
  // Batch 15E — unggah bukti nyata: file dipilih warga & dikirim multipart;
  // `ulangDari` = baris Ditolak yang diajukan ulang lewat modal yang sama.
  const [fileBukti, setFileBukti] = useState<File | null>(null);
  const [ulangDari, setUlangDari] = useState<BarisRiwayat | null>(null);
  const [uploadSedang, setUploadSedang] = useState(false);
  const { flash, toast } = useFlash();

  /** Tutup modal unggah + buang state sementara (file & konteks ulang). */
  function tutupUpload() {
    setShowUpload(false);
    setUlangDari(null);
    setFileBukti(null);
  }

  /** Buka modal unggah dalam mode reguler (tanpa konteks ulang). */
  function bukaUpload() {
    setUlangDari(null);
    setFileBukti(null);
    setShowUpload(true);
  }

  /** Buka modal unggah untuk AJUKAN ULANG baris yang ditolak (Batch 15E). */
  function bukaUploadUlang(rb: BarisRiwayat) {
    setUlangDari(rb);
    setFileBukti(null);
    setShowUpload(true);
  }

  // Sumber kebenaran rincian & total tagihan = kategori iuran dari Pengurus RT.
  // Rincian hanya memuat kategori yang ditagihkan (nonaktif/insidental ditiadakan)
  // supaya penjumlahan kolom = totalBulanan. Batch 19 · TANPA fallback contoh —
  // warga RT baru melihat rincian kosong (jujur), bukan kategori karangan.
  const rincianKategori = kategoriTagihan(kategoriIuran);
  const totalBulanan = hitungIuranBulanan(rincianKategori, kendaraanR4Count);
  const paket = periodeBayar[selectedPeriode];
  const totalPaket = totalBulanan * paket.months;

  // Angka kas & alokasi dana selalu derive dari buku kas RT (sama dengan Portal RT).
  const saldoKas = saldoKasRt(kasRt);
  const rekap = rekapKasRt(kasRt);
  // Batch 19 · alokasi dana = pengeluaran buku kas RT NYATA, dikelompokkan
  // per kategori kas dengan porsi terhadap total pengeluaran. Sebelumnya pos
  // ("Honor Satpam 40%", "Sampah DLH 35%"…) di-hardcode — angka & nama
  // fiktif bahkan untuk tenant baru. Tanpa entri pengeluaran → daftar kosong.
  const alokasiMap = new Map<string, number>();
  for (const k of kasRt) {
    if (k.tipe === "Pengeluaran") {
      alokasiMap.set(k.kategori, (alokasiMap.get(k.kategori) ?? 0) + Math.abs(k.nominal));
    }
  }
  const alokasiDana = [...alokasiMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, realisasi], i) => ({
      label,
      pct: rekap.pengeluaran ? Math.round((realisasi / rekap.pengeluaran) * 1000) / 10 : 0,
      amount: formatRupiah(realisasi),
      color: WARNA_ALOKASI[i % WARNA_ALOKASI.length],
    }));

  // Riwayat hunian ini: pengajuan/pembayaran terbaru di atas + arsip periode sebelumnya.
  const riwayatSaya = pembayaran.filter((p) => shortAlamat(p.alamat) === shortAlamat(alamat));
  const pembayaranLunas = riwayatSaya.filter((p) => p.status === "Lunas");
  const totalTerbayar = pembayaranLunas.reduce((sum, p) => sum + p.jumlah, 0);

  // --- Status tagihan PERIODE AKTIF — turunan dari riwayat warga ini ---------
  // Bug Fase 3: badge "Belum Dibayar" & "1 Tagihan Tertunggak" dulu di-hardcode
  // sehingga tidak pernah berubah walau Pengurus RT sudah memverifikasi
  // pembayaran (laporan: "setelah RT verifikasi, portal warga tidak lunas").
  const bayarPeriodeAktif = riwayatSaya.filter((p) => p.periode === PERIODE_AKTIF);
  // Turunan riwayat lokal — dipakai saat mode demo/offline (`ringkasServer` null).
  const lunasDariRiwayat = bayarPeriodeAktif.some((p) => p.status === "Lunas");
  const menungguDariRiwayat =
    !lunasDariRiwayat && bayarPeriodeAktif.some((p) => p.status === "Menunggu Verifikasi");
  // F-6: bila API mengirim ringkas tagihan, server jadi sumber status — menangkap
  // juga kasus "lunas hanya sebagian" yang tak terlihat dari satu baris riwayat.
  const statusDariServer: "Lunas" | "Menunggu Verifikasi" | "Belum Dibayar" | null =
    ringkasServer === null
      ? null
      : ringkasServer.status === "lunas"
        ? "Lunas"
        : ringkasServer.status === "menunggu_verifikasi"
          ? "Menunggu Verifikasi"
          : "Belum Dibayar";
  const statusTagihanAktif: "Lunas" | "Menunggu Verifikasi" | "Belum Dibayar" =
    statusDariServer ??
    (lunasDariRiwayat ? "Lunas" : menungguDariRiwayat ? "Menunggu Verifikasi" : "Belum Dibayar");
  const lunasPeriodeAktif = statusTagihanAktif === "Lunas";
  const menungguPeriodeAktif = statusTagihanAktif === "Menunggu Verifikasi";
  /** Rp yang masih benar-benar harus dibayar periode ini (kartu KPI pertama). */
  const perluDibayar =
    statusTagihanAktif === "Belum Dibayar"
      ? (ringkasServer ? ringkasServer.totalSisa : totalBulanan)
      : 0;
  /** Angka panel status: total lunas / total diajukan / total paket terpilih. */
  const nilaiPanel = lunasPeriodeAktif
    ? bayarPeriodeAktif.filter((p) => p.status === "Lunas").reduce((s, p) => s + p.jumlah, 0)
    : menungguPeriodeAktif
      ? bayarPeriodeAktif.filter((p) => p.status !== "Ditolak").reduce((s, p) => s + p.jumlah, 0)
      : totalPaket;
  /** Gaya badge/ikon/panel mengikuti status (paket warna dari `badgeStatus`). */
  const gayaTagihanAktif =
    statusTagihanAktif === "Lunas"
      ? {
          ikon: "check_circle",
          wrap: "bg-secondary-container text-on-secondary-container",
          badge: badgeStatus.Lunas,
          dot: dotStatus.Lunas,
          panel: "bg-secondary-container/10 border-secondary/30",
          ikonPanel: "text-secondary",
          labelKpi: "Tagihan Lunas",
        }
      : statusTagihanAktif === "Menunggu Verifikasi"
        ? {
            ikon: "schedule",
            wrap: "bg-tertiary-container text-on-tertiary-container",
            badge: badgeStatus["Menunggu Verifikasi"],
            dot: dotStatus["Menunggu Verifikasi"],
            panel: "bg-tertiary-container/10 border-tertiary-container/40",
            ikonPanel: "text-tertiary",
            labelKpi: "Menunggu Verifikasi",
          }
        : {
            ikon: "error",
            wrap: "bg-error-container text-on-error-container",
            badge: "bg-error-container text-on-error-container",
            dot: "bg-error",
            panel: "bg-error-container/10 border-error/20",
            ikonPanel: "text-error",
            labelKpi: "1 Tagihan Tertunggak",
          };
  const periodeSaya = new Set(riwayatSaya.map((p) => p.periode));
  // Batch 19 · arsip riwayat CONTOH hanya untuk mode demo/OFFLINE
  // (`ringkasServer` null) — sesi daring menampilkan baris riwayat server
  // saja; tanpa gerbang ini warga RT baru melihat "Jan–Jun 2026 Rp 1.020.000
  // Lunas" yang tidak pernah mereka bayar.
  const arsipRiwayat =
    ringkasServer === null
      ? riwayatPembayaran.filter((rb) => !periodeSaya.has(rb.periodeLabel))
      : [];
  const deskripsiBayar = `Iuran ${deskripsiIuran(rincianKategori, kendaraanR4Count)}`;
  const barisRiwayat: BarisRiwayat[] = [
    ...riwayatSaya.map((p) => ({
      id: p.id,
      tanggal: p.tanggal,
      jam: "",
      deskripsi: deskripsiBayar,
      periodeLabel: p.periode,
      periodeDetail: p.paket || "-",
      total: formatRupiah(p.jumlah),
      jumlah: p.jumlah,
      metode: p.metode,
      metodeIcon: p.metodeIcon,
      status: p.status,
      atasNama: p.nama,
      hunian: p.alamat,
      // Batch 15E — bukti & alasan server: baris Ditolak membawa alasan RT
      // (ditulis ulang saat penolakan) + file untuk tautan "Lihat Bukti".
      bukti: p.bukti ?? null,
      alasan: p.status === "Ditolak" ? p.catatan ?? null : null,
      diverifikasiPada: p.diverifikasiPada ?? null,
    })),
    ...arsipRiwayat.map((rb) => ({
      id: rb.id,
      tanggal: rb.tanggal,
      jam: rb.jam,
      deskripsi: deskripsiBayar,
      periodeLabel: rb.periodeLabel,
      periodeDetail: rb.periodeDetail,
      total: formatRupiah(rb.total),
      jumlah: rb.total,
      metode: rb.metode,
      metodeIcon: rb.metodeIcon,
      status: rb.status,
      atasNama: nama,
      hunian: alamat,
    })),
  ];

  // Tagihan kondisional dari Pengurus RT (bukan seed lokal).
  const tagihanWarga = tagihanTambahan.filter(
    (t) => !t.target || t.target === "semua" || t.target === alamat
  );

  // Batch 19 · bendahara dari pengurus tercatat (bukan "Hj. Siti Rahmawati"
  // contoh); tanpa baris → label umum tanpa nama karangan.
  const bendahara = pengurus.find((p) => p.jabatan === "Bendahara");
  const namaBendahara = bendahara?.nama ?? "Bendahara RT";


  function tanggalHariIni(): string {
    return hariIni();
  }

  /**
   * Ajukan pembayaran → diverifikasi Pengurus RT (status: Menunggu Verifikasi).
   * Periode SELALU `PERIODE_AKTIF` (pencocokan status lintas portal); label paket
   * hanya disimpan untuk tampilan riwayat. `onBayar` API-first — flash sukses hanya
   * muncul setelah pengajuan benar-benar diterima server; OFFLINE (`"lokal"`):
   * mode demo, jujur — termasuk kabar bahwa FILE BUKTI TIDAK ikut tersimpan.
   * Batch 15E: `berkas` = file struk (multipart); `pesanUlang` dipakai aksi
   * "Ajukan Ulang" baris ditolak.
   */
  async function ajukanPembayaran(
    metode: string,
    metodeIcon: string,
    jumlah: number,
    paketLabel?: string,
    berkas?: File,
    pesanUlang?: string,
  ) {
    if (!jumlah || jumlah <= 0) {
      flash("Nominal pembayaran belum diisi.");
      return;
    }
    if (uploadSedang) return; // anti submit ganda — tunggu permintaan selesai
    setUploadSedang(true);
    try {
      const asal = await onBayar(
        {
          id: `pay-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          alamat,
          nama,
          periode: PERIODE_AKTIF,
          paket: paketLabel,
          jumlah,
          metode,
          metodeIcon,
          tanggal: tanggalHariIni(),
          status: "Menunggu Verifikasi",
        },
        berkas,
      );
      if (asal === "server") {
        flash(pesanUlang ?? "Pembayaran diajukan — menunggu verifikasi pengurus RT.");
      } else {
        flash(
          berkas
            ? "Mode demo (server mati): pengajuan TIDAK terkirim — file bukti tidak tersimpan di mana pun."
            : "Mode demo (server mati): pengajuan dicatat lokal — tidak terkirim ke pengurus RT.",
        );
      }
    } catch {
      flash("Pengajuan pembayaran gagal — periksa koneksi lalu coba lagi.");
    } finally {
      setUploadSedang(false);
    }
  }

  function bukaTunai(periode: string, jumlah: number) {
    setTunaiPeriode(periode);
    setTunaiNominal(String(jumlah));
    setShowTunai(true);
  }

  /**
   * Unduh kuitansi — kini PDF (A5, jsPDF) via dynamic import, konsisten dengan
   * `lib/pdfSurat.ts`. Berjalan penuh di klien sehingga OFFLINE pun unduhan
   * tetap jujur (tanpa menyamar sukses server).
   */
  async function unduhKuitansi(r: BarisRiwayat) {
    try {
      const { simpanPdfKuitansi } = await import("../../lib/pdfKuitansi");
      simpanPdfKuitansi({
        judul: r.status === "Lunas" ? "Kuitansi Pembayaran Iuran" : "Pengajuan Pembayaran Iuran",
        ref: r.id.toUpperCase(),
        tanggal: `${r.tanggal}${r.jam ? ` ${r.jam}` : ""}`,
        warga: r.atasNama,
        hunian: r.hunian,
        periode: `${r.periodeLabel}${r.periodeDetail && r.periodeDetail !== "-" ? ` (${r.periodeDetail})` : ""}`,
        jumlah: r.jumlah,
        metode: r.metode,
        status: r.status,
        // Batch 15E — cap verifikasi hanya bila server benar-benar mencatatnya.
        diverifikasi: r.diverifikasiPada
          ? new Date(r.diverifikasiPada).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })
          : null,
      });
      flash(
        r.status === "Lunas"
          ? "Kuitansi PDF berhasil diunduh."
          : "Bukti pengajuan PDF diunduh — kuitansi resmi terbit setelah verifikasi Bendahara RT."
      );
    } catch {
      flash("Kuitansi gagal dibuat — coba lagi.");
    }
  }

  return (
    <div className="min-h-dvh bg-background font-body-md text-on-surface antialiased">
      {toast}

      <div className="max-w-7xl mx-auto px-4 lg:px-12 py-6 flex flex-col gap-6">
        {/* Breadcrumb & Timestamp */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <div className="flex items-center gap-2 text-on-surface-variant text-sm">
            <button type="button" className="hover:text-primary transition-colors flex items-center gap-1" onClick={() => onNavigate?.("portal-warga")}><span className="material-symbols-outlined text-[16px]">home</span>
              Portal Warga
            </button>
            <span className="material-symbols-outlined text-[14px]">chevron_right</span>
            <span className="font-semibold text-primary">Iuran &amp; Tagihan</span>
          </div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-surface-container-low text-on-surface-variant text-xs">
            <span className="inline-block w-2 h-2 rounded-full bg-secondary-container animate-pulse" />
            <span>Rekonsiliasi Kas RT Terakhir: <strong>Kemarin, 21:40 WIB</strong></span>
          </div>
        </div>

        {/* Header */}
        <section className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
          <div className="space-y-1.5 max-w-3xl">
            <div className="inline-flex items-center gap-1.5 text-primary text-sm font-bold uppercase tracking-wider">
              <span className="material-symbols-outlined text-[16px]">account_balance_wallet</span>
              Keuangan &amp; Akuntabilitas Warga
            </div>
            <h1 className="text-2xl lg:text-[32px] text-on-surface tracking-tight font-extrabold">
              Iuran &amp; Tagihan Warga
            </h1>
            <p className="text-sm text-on-surface-variant">
              Kelola kewajiban iuran bulanan, riwayat pembayaran resmi, unggah bukti bayar, dan pantau transparansi alokasi dana warga di lingkungan {tenant.perumahan}.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 shrink-0">
            {statusTagihanAktif === "Belum Dibayar" && (
              <button className="h-11 px-5 rounded-lg text-on-primary bg-primary-container shadow-md hover:bg-primary transition-all flex items-center gap-2" onClick={bukaUpload}>
                <span className="material-symbols-outlined text-[20px]">cloud_upload</span>
                + Unggah Bukti Bayar
              </button>
            )}
          </div>
        </section>

        {/* 4 KPI Cards */}
        <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <div className="bg-surface-container-lowest rounded-xl p-4 shadow-sm flex flex-col justify-between">
            <div className="flex items-start justify-between">
              <div>
                <span className="text-xs text-on-surface-variant block">Tagihan Perlu Dibayar</span>
                <span className="text-3xl font-extrabold text-on-surface mt-1 block font-mono">{formatRupiah(perluDibayar)}</span>
              </div>
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${gayaTagihanAktif.wrap}`}>
                <span className="material-symbols-outlined text-[22px]">{gayaTagihanAktif.ikon}</span>
              </div>
            </div>
            <div className="mt-4 pt-2 flex items-center justify-between">
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold ${gayaTagihanAktif.badge}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${gayaTagihanAktif.dot}`} />
                {gayaTagihanAktif.labelKpi}
              </span>
              <span className="text-xs text-on-surface-variant">
                {statusTagihanAktif === "Belum Dibayar" ? "Tempo: 20 Okt 2026" : `Periode: ${PERIODE_AKTIF}`}
              </span>
            </div>
          </div>

          <div className="bg-surface-container-lowest rounded-xl p-4 shadow-sm flex flex-col justify-between">
            <div className="flex items-start justify-between">
              <div>
                <span className="text-xs text-on-surface-variant block">Total Terbayar (2026)</span>
                <span className="text-3xl font-extrabold text-primary block mt-1 font-mono">{formatRupiah(totalTerbayar)}</span>
              </div>
              <div className="w-10 h-10 rounded-full bg-primary-fixed flex items-center justify-center text-on-primary-fixed-variant">
                <span className="material-symbols-outlined text-[22px]">check_circle</span>
              </div>
            </div>
            <div className="mt-4 pt-2 flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-surface-container-low text-on-primary-fixed-variant text-xs font-bold">
                <span className="w-1.5 h-1.5 rounded-full bg-secondary" />
                {pembayaranLunas.length}x Pembayaran Lunas
              </span>
              <span className="text-xs text-on-surface-variant">Jan - Okt 2026</span>
            </div>
          </div>

          <div className="bg-surface-container-lowest rounded-xl p-4 shadow-sm flex flex-col justify-between">
            <div className="flex items-start justify-between">
              <div>
                <span className="text-xs text-on-surface-variant block">Kepatuhan Iuran Rumah</span>
                <div className="flex items-baseline gap-2 mt-1">
                  <span className="text-3xl font-extrabold text-on-surface">85.7%</span>
                  <span className="text-xs text-secondary font-bold">Kategori Baik</span>
                </div>
              </div>
              <div className="w-10 h-10 rounded-full bg-surface-container-low flex items-center justify-center text-primary">
                <span className="material-symbols-outlined text-[22px]">speed</span>
              </div>
            </div>
            <div className="mt-4 pt-2 space-y-1.5">
              <div className="w-full bg-surface-container-highest rounded-full h-2 overflow-hidden">
                <div className="bg-primary h-2 rounded-full" style={{ width: "85.7%" }} />
              </div>
              <div className="flex justify-between text-xs text-on-surface-variant">
                <span>6 dari 7 pos tertib</span>
                <span>Target RT: 90%</span>
              </div>
            </div>
          </div>

          <div className="bg-surface-container-lowest rounded-xl p-4 shadow-sm flex flex-col justify-between">
            <div className="flex items-start justify-between">
              <div>
                <span className="text-xs text-on-surface-variant block">Saldo Kas Terbuka {tenant.rtFull}</span>
                <span className="text-3xl font-extrabold text-tertiary block mt-1 font-mono">{formatRupiah(saldoKas)}</span>
              </div>
              <div className="w-10 h-10 rounded-full bg-tertiary-fixed flex items-center justify-center text-on-tertiary-fixed-variant">
                <span className="material-symbols-outlined text-[22px]">account_balance</span>
              </div>
            </div>
            <div className="mt-4 pt-2 flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-tertiary-fixed text-on-tertiary-fixed text-xs font-bold">
                Kondisi Sehat
              </span>
              <span className="text-xs text-on-surface-variant">Audit Bendahara Aktif</span>
            </div>
          </div>
        </section>

        {/* Banner Tagihan Aktif */}
        <section className="bg-gradient-to-r from-primary-container via-primary to-primary-container rounded-2xl p-6 text-on-primary shadow-lg relative overflow-hidden">
          <div className="absolute -right-12 -bottom-12 w-64 h-64 rounded-full bg-secondary-container/10 pointer-events-none blur-2xl" />
          <div className="relative z-10 space-y-5">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div className="space-y-1 max-w-2xl">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-on-primary/10 text-on-primary text-xs backdrop-blur-sm">
                  <span className="material-symbols-outlined text-[16px]">notifications_active</span>
                  Tagihan Terbuka Hunian: {alamat} ({nama})
                </div>
                <h2 className="text-lg font-bold tracking-tight text-on-primary">Paket Iuran &amp; Frekuensi Pembayaran Fleksibel</h2>
                <p className="text-sm text-on-primary/80">
                  Pilih frekuensi pembayaran sesuai kenyamanan keluarga Anda. Total tagihan mengikuti kategori iuran yang dikonfigurasi Pengurus RT {tenant.rtFull}. Iuran kondisional dari Pengurus RT (seperti fogging) juga akan muncul di rincian.
                </p>
              </div>
              <div className="text-xs text-on-primary/80">
                Pilih frekuensi pembayaran sesuai kenyamanan keluarga Anda.
              </div>
            </div>

            {/* Billing Frequency Switcher */}
            <div className="bg-surface-container-lowest/10 backdrop-blur-md rounded-xl p-4 space-y-3 border border-white/10">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-bold text-on-primary flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[18px]">event_repeat</span>
                  Pilih Skema Periode Bayar:
                </span>
                <span className="text-xs text-on-primary/80">Mencegah tunggakan &amp; administrasi otomatis lunas</span>
              </div>
              <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
                {periodeBayar.map((p, i) => {
                  const totalPrice = totalBulanan * p.months;
                  return (
                    <button
                      key={i}
                      className={`relative p-3 rounded-lg text-left transition-all border flex flex-col justify-between active:scale-95 ${
                        selectedPeriode === i
                          ? "bg-secondary-fixed text-on-secondary-fixed shadow-md border-secondary-fixed"
                          : "bg-white/10 hover:bg-white/20 border-white/20 text-white"
                      }`}
                      onClick={() => setSelectedPeriode(i)}
                    >
                      {p.badge && (
                        <div className="absolute top-1 right-2">
                          <span className="px-1.5 py-0.5 rounded bg-primary text-on-primary text-[10px] font-extrabold uppercase">{p.badge}</span>
                        </div>
                      )}
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-bold">{p.label}</span>
                        {selectedPeriode === i ? (
                          <span className="material-symbols-outlined text-[18px]">radio_button_checked</span>
                        ) : (
                          <span className="material-symbols-outlined text-[18px] text-white/70">radio_button_unchecked</span>
                        )}
                      </div>
                      <span className="text-xs opacity-90 mt-1">{p.sub}</span>
                      <span className="text-base font-extrabold mt-1 font-mono">{formatRupiah(totalPrice)}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Dynamic Summary & Payment Bar */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pt-2">
              <div className="flex flex-wrap items-center gap-4 text-on-primary/90 text-xs">
                {rincianKategori.length === 0 && (
                  <span className="flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[18px] text-secondary-fixed">info</span>
                    Rincian tagihan belum dikonfigurasi Pengurus RT
                  </span>
                )}
                {rincianKategori.map((k) => {
                  const nilai =
                    k.tipe === "per_unit"
                      ? k.nominal * Math.max(kendaraanR4Count, 0)
                      : k.nominal;
                  const label =
                    k.tipe === "per_unit" ? `${k.nama} × ${kendaraanR4Count} unit` : k.nama;
                  return (
                    <div key={k.id} className="flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-[18px] text-secondary-fixed">{iconKategori(k)}</span>
                      {label}: {formatRupiah(nilai)}
                    </div>
                  );
                })}
                <div className="flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[18px] text-secondary-fixed">event_repeat</span>
                  Paket: {paket.label} = <strong>{formatRupiah(totalPaket)}</strong>
                </div>
              </div>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 shrink-0">
                {statusTagihanAktif === "Belum Dibayar" ? (
                  <>
                    <button className="h-11 px-5 rounded-lg text-sm font-bold bg-secondary-fixed text-on-secondary-fixed hover:bg-secondary-fixed-dim shadow transition-all flex items-center justify-center gap-2 active:scale-95" onClick={() => setShowQris(true)}>
                      <span className="material-symbols-outlined text-[20px]">qr_code_scanner</span>
                      Bayar via QRIS Otomatis
                    </button>
                    <button className="h-11 px-4 rounded-lg text-sm text-on-primary bg-on-primary/15 hover:bg-on-primary/25 transition-all flex items-center justify-center gap-2" onClick={() => setShowUpload(true)}>
                      <span className="material-symbols-outlined text-[20px]">receipt_long</span>
                      Unggah Bukti Transfer
                    </button>
                  </>
                ) : (
                  <span className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-on-primary/15 text-on-primary text-sm font-bold backdrop-blur-sm">
                    <span className="material-symbols-outlined text-[18px]">{gayaTagihanAktif.ikon}</span>
                    {statusTagihanAktif}
                  </span>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Tagihan Aktif */}
        <section className="bg-surface-container-lowest rounded-xl shadow-sm overflow-hidden">
          <div className="px-6 py-4 bg-surface-container-low/50 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-primary text-[22px]">receipt</span>
              <h3 className="text-base font-bold text-on-surface">Tagihan Aktif</h3>
            </div>
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${gayaTagihanAktif.badge}`}>
              {statusTagihanAktif}
            </span>
          </div>
          <div className="p-6 space-y-4">
            <div className={`flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 p-4 rounded-xl border ${gayaTagihanAktif.panel}`}>
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-sm text-on-surface-variant">
                  <span className={`material-symbols-outlined text-[18px] ${gayaTagihanAktif.ikonPanel}`}>
                    {statusTagihanAktif === "Belum Dibayar" ? "timer" : gayaTagihanAktif.ikon}
                  </span>
                  {statusTagihanAktif === "Belum Dibayar" ? "Jatuh Tempo Pembayaran" : "Status Pembayaran"}
                </div>
                <span className="text-2xl font-extrabold text-on-surface">
                  {statusTagihanAktif === "Belum Dibayar" ? "20 Oktober 2026" : statusTagihanAktif}
                </span>
                <span className="text-xs text-on-surface-variant block">
                  {statusTagihanAktif === "Lunas"
                    ? `Periode ${PERIODE_AKTIF} sudah terbayar penuh — terima kasih.`
                    : statusTagihanAktif === "Menunggu Verifikasi"
                      ? `Bukti pembayaran periode ${PERIODE_AKTIF} diterima — menunggu verifikasi Pengurus RT.`
                      : `Sisa 6 hari lagi — Paket ${paket.label}`}
                </span>
              </div>
              <div className="text-right">
                <span className="text-xs text-on-surface-variant">
                  {statusTagihanAktif === "Lunas"
                    ? "Total terbayar"
                    : statusTagihanAktif === "Menunggu Verifikasi"
                      ? "Total diajukan"
                      : "Total yang harus dibayar"}
                </span>
                <span className="text-2xl font-extrabold text-primary block font-mono">{formatRupiah(nilaiPanel)}</span>
              </div>
            </div>
            {statusTagihanAktif === "Belum Dibayar" ? (
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                <button className="h-11 px-5 rounded-lg text-sm font-bold bg-primary text-on-primary hover:bg-primary-container shadow transition-all flex items-center justify-center gap-2 active:scale-95" onClick={() => setShowQris(true)}>
                  <span className="material-symbols-outlined text-[20px]">qr_code_scanner</span>
                  Bayar via QRIS
                </button>
                <button className="h-11 px-4 rounded-lg text-sm font-bold text-on-surface bg-secondary-container hover:bg-secondary-container/80 transition-all flex items-center justify-center gap-2" onClick={() => bukaTunai(paket.label, totalPaket)}>
                  <span className="material-symbols-outlined text-[20px]">payments</span>
                  Bayar Tunai
                </button>
                <button className="h-11 px-4 rounded-lg text-sm text-on-surface bg-surface-container hover:bg-surface-container-high transition-all flex items-center justify-center gap-2" onClick={() => setShowUpload(true)}>
                  <span className="material-symbols-outlined text-[20px]">cloud_upload</span>
                  Unggah Bukti Transfer
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm text-on-surface-variant">
                <span className="material-symbols-outlined text-[18px] text-primary">
                  {lunasPeriodeAktif ? "verified" : "hourglass_top"}
                </span>
                {lunasPeriodeAktif
                  ? `Tagihan ${PERIODE_AKTIF} sudah lunas — riwayat pembayarannya tercantum di bawah.`
                  : "Pembayaran sedang diverifikasi Pengurus RT — status akan berubah otomatis setelah disetujui."}
              </div>
            )}
          </div>
        </section>

        {/* Iuran Kondisional dari Pengurus RT */}
        <section className="bg-surface-container-lowest rounded-xl shadow-sm overflow-hidden">
          <div className="px-6 py-4 bg-surface-container-low/50 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-tertiary text-[22px]">add_task</span>
              <h3 className="text-base font-bold text-on-surface">Iuran Kondisional dari Pengurus RT</h3>
            </div>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-tertiary-container text-on-tertiary-container text-[10px] font-bold">
              {tagihanWarga.length} Tagihan
            </span>
          </div>
          <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
            {tagihanWarga.length === 0 ? (
              <p className="text-sm text-on-surface-variant">Tidak ada tagihan kondisional untuk hunian Anda.</p>
            ) : tagihanWarga.map((item) => (
              <div key={item.id} className="bg-tertiary-container/10 border border-tertiary-container/30 rounded-xl p-4 flex flex-col justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-tertiary-container flex items-center justify-center text-on-tertiary-container shrink-0">
                    <span className="material-symbols-outlined text-[22px]">{item.icon}</span>
                  </div>
                  <div className="min-w-0">
                    <span className="text-sm font-bold text-on-surface block">{item.nama}</span>
                    <span className="text-xs text-on-surface-variant">REF: {item.ref}</span>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-lg font-extrabold text-error font-mono">
                      {formatRupiah(item.sisa !== undefined && item.sisa > 0 ? item.sisa : item.nominal)}
                    </span>
                    <span className="block text-xs text-on-surface-variant">
                      {item.periode ? `${labelPeriodeServer(item.periode)} · ` : ""}
                      Jatuh Tempo: {item.tenggat}
                    </span>
                    {item.sisa !== undefined && item.sisa > 0 && item.sisa < item.nominal && (
                      <span className="block text-[11px] text-on-surface-variant">
                        Sisa dari {formatRupiah(item.nominal)} (sebagian terbayar)
                      </span>
                    )}
                  </div>
                  {item.status === "Lunas" ? (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-secondary-container text-on-secondary-container">
                      Lunas
                    </span>
                  ) : (
                    <button
                      className="h-9 px-4 rounded-lg bg-primary text-on-primary text-sm font-bold hover:bg-primary-container transition-all active:scale-95"
                      onClick={async () => {
                        try {
                          const dariServer = await onBayarTagihanTambahan(item);
                          flash(
                            dariServer
                              ? `Pembayaran ${item.nama} diajukan — menunggu verifikasi pengurus RT.`
                              : `Mode demo (server mati): pembayaran ${item.nama} dicatat lokal — status tetap "Menunggu Verifikasi".`
                          );
                        } catch {
                          flash("Pengajuan pembayaran gagal — periksa koneksi lalu coba lagi.");
                        }
                      }}
                    >
                      Bayar
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Riwayat Pembayaran */}
        <section className="bg-surface-container-lowest rounded-xl shadow-sm overflow-hidden">
          <div className="px-6 py-4 bg-surface-container-low/50 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-primary text-[22px]">history</span>
              <h3 className="text-base font-bold text-on-surface">Riwayat Pembayaran</h3>
            </div>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-secondary-container text-on-secondary-container text-[10px] font-bold">
              {barisRiwayat.length} Transaksi
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-on-surface">
              <thead className="bg-surface-container-low text-xs text-on-surface-variant uppercase tracking-wider">
                <tr>
                  <th className="py-3 px-6">Tanggal Bayar</th>
                  <th className="py-3 px-4">Deskripsi</th>
                  <th className="py-3 px-4">Total Bayar</th>
                  <th className="py-3 px-4">Metode</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-6 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y-0 text-sm">
                {barisRiwayat.map((rb) => (
                  <tr key={rb.id} className="hover:opacity-95 transition-colors">
                    <td className="py-4 px-6">
                      <span className="font-semibold text-on-surface block">{rb.tanggal}</span>
                      <span className="text-xs text-on-surface-variant">{rb.jam || rb.hunian}</span>
                    </td>
                    <td className="py-4 px-4">
                      <span className="font-semibold text-on-surface block">{rb.deskripsi}</span>
                      <span className="text-xs text-on-surface-variant">
                        {rb.periodeLabel}
                        {rb.periodeDetail && rb.periodeDetail !== "-" ? ` • ${rb.periodeDetail}` : ""}
                      </span>
                    </td>
                    <td className="py-4 px-4 text-base font-extrabold text-on-surface font-mono">{rb.total}</td>
                    <td className="py-4 px-4">
                      <div className="inline-flex items-center gap-1 text-xs text-on-surface bg-surface-container-low px-2 py-0.5 rounded">
                        <span className="material-symbols-outlined text-[14px] text-secondary">{rb.metodeIcon}</span>
                        {rb.metode}
                      </div>
                    </td>
                    <td className="py-4 px-4">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${badgeStatus[rb.status]}`}>
                        <span className={`w-2 h-2 rounded-full ${dotStatus[rb.status]}`} />
                        {rb.status}
                      </span>
                      {/* Batch 15E — alasan penolakan dari RT (warga berhak tahu
                          apa yang harus diperbaiki sebelum mengajukan ulang). */}
                      {rb.status === "Ditolak" && rb.alasan && (
                        <span className="mt-1 block text-[11px] leading-snug text-error max-w-[240px]" title={rb.alasan}>
                          {rb.alasan}
                        </span>
                      )}
                    </td>
                    <td className="py-4 px-6 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {/* Batch 15E — tautan file bukti milik sendiri (null bila
                            baris tanpa file / baris arsip statis). */}
                        {buktiHref(rb.id, rb.bukti, "warga") && (
                          <a
                            className="h-9 px-3 rounded-lg bg-surface-container-low text-on-surface-variant hover:text-primary hover:bg-surface-container text-sm font-semibold inline-flex items-center gap-1 transition-colors"
                            href={buktiHref(rb.id, rb.bukti, "warga")!}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Buka file bukti yang Anda unggah"
                          >
                            <span className="material-symbols-outlined text-[16px]">receipt_long</span>
                            Bukti
                          </a>
                        )}
                        {/* Batch 15E — ajukan ulang setelah ditolak: baris lama
                            tetap (jejak audit), pengajuan baru menyusul. */}
                        {rb.status === "Ditolak" && (
                          <button
                            className="h-9 px-3 rounded-lg bg-error-container/40 text-error hover:bg-error-container text-sm font-semibold inline-flex items-center gap-1 transition-colors"
                            onClick={() => bukaUploadUlang(rb)}
                          >
                            <span className="material-symbols-outlined text-[16px]">redo</span>
                            Ajukan Ulang
                          </button>
                        )}
                        <button className="h-9 px-3 rounded-lg bg-surface-container-low text-on-surface-variant hover:text-primary hover:bg-surface-container text-sm font-semibold inline-flex items-center gap-1 transition-colors" onClick={() => unduhKuitansi(rb)}>
                          <span className="material-symbols-outlined text-[16px]">download</span>
                          Unduh Kuitansi
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Transparansi Finansial */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Alokasi Dana */}
          <div className="bg-surface-container-lowest rounded-xl p-6 shadow-sm flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-base font-bold text-on-surface">Alokasi Dana Iuran Warga</h4>
                <span className="text-xs text-primary bg-primary-fixed px-2 py-0.5 rounded-full font-bold">Buku Kas {tenant.rtFull}</span>
              </div>
              <p className="text-xs text-on-surface-variant mb-4">
                Pengeluaran buku kas RT per kategori — porsi terhadap total pengeluaran periode tercatat.
              </p>
              <div className="space-y-3">
                {alokasiDana.length === 0 && (
                  <p className="text-xs text-on-surface-variant p-2 rounded-lg bg-surface-container-low">
                    Belum ada pengeluaran tercatat pada buku kas RT.
                  </p>
                )}
                {alokasiDana.map((a) => (
                  <div key={a.label}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="font-semibold text-on-surface">{a.label} ({a.pct}%)</span>
                      <span className="font-bold text-primary font-mono">{a.amount}</span>
                    </div>
                    <div className="w-full bg-surface-container-low rounded-full h-2">
                      <div className={`${a.color} h-2 rounded-full`} style={{ width: `${a.pct}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-4 pt-3 flex items-center justify-between text-on-surface-variant text-xs border-t border-outline-variant/20">
              <span>Laporan Kas Terbuka {tenant.rtFull}</span>
              <button
                type="button"
                className="text-primary font-bold hover:underline inline-flex items-center gap-1"
                onClick={() => flash("Buku kas lengkap disiapkan Bendahara RT — hubungi via WhatsApp untuk salinan resmi.")}
              >
                Buku Kas Lengkap
                <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
              </button>
            </div>
          </div>

          {/* Bendahara Resmi — Batch 19: tanpa foto stok, nomor WA karangan,
              dan masa jabatan karangan; nama dari pengurus tercatat. */}
          <div className="bg-surface-container-lowest rounded-xl p-6 shadow-sm flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className="material-symbols-outlined text-secondary text-[24px]">verified</span>
                <h4 className="text-base font-bold text-on-surface">Bendahara Resmi {tenant.rtFull}</h4>
              </div>
              <div className="flex items-center gap-4 p-3 rounded-xl bg-surface-container-low mb-4">
                <div className="w-14 h-14 rounded-full bg-tertiary-container text-on-tertiary-container flex items-center justify-center font-bold shrink-0 shadow-sm">
                  {bendahara?.initials ?? "?"}
                </div>
                <div className="min-w-0">
                  <span className="text-sm font-bold text-on-surface block truncate">
                    {bendahara ? namaBendahara : "Belum tercatat"}
                  </span>
                  <span className="text-xs text-on-surface-variant block">Bendahara {tenant.rtFull} {tenant.perumahanSingkat}</span>
                  <span className="inline-flex items-center gap-1 text-secondary text-xs font-bold mt-0.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-secondary" />
                    Siaga Konfirmasi Tunai
                  </span>
                </div>
              </div>
              <p className="text-xs text-on-surface-variant mb-4">
                Jika Anda membayar secara tunai langsung ke rumah Bendahara, pastikan meminta paraf kartu iuran fisik atau unggah foto tanda terima pada tombol di atas.
              </p>
            </div>
            <div className="space-y-2">
              <span className="w-full h-11 px-4 rounded-lg bg-surface-container text-sm font-bold text-on-surface flex items-center justify-center gap-2">
                <span className="material-symbols-outlined text-[18px] text-secondary">info</span>
                Nomor WhatsApp bendahara belum tercatat di sistem
              </span>
              <span className="text-center block text-xs text-on-surface-variant">Alamat: {tenant.perumahan} (Pukul 08.00 - 20.00 WIB)</span>
            </div>
          </div>

          {/* Kebijakan Pembayaran */}
          <div className="bg-surface-container-low p-4 rounded-xl flex flex-col gap-3">
            <div className="flex items-center gap-2.5 text-primary">
              <span className="material-symbols-outlined text-[24px]">shield_lock</span>
              <h4 className="text-sm font-bold text-on-surface">Kebijakan Pembayaran &amp; UU PDP</h4>
            </div>
            <p className="text-xs text-on-surface-variant leading-relaxed">
              Seluruh data transaksi iuran Anda dilindungi enkripsi <strong>AES-256</strong> sesuai amanat <strong>UU No. 27/2022</strong> tentang Perlindungan Data Pribadi. Bukti pembayaran hanya diakses oleh Bendahara RT yang bertugas.
            </p>
            <div className="flex items-center gap-2 text-[11px] text-on-surface-variant">
              <span className="w-2 h-2 rounded-full bg-secondary" />
              Kepatuhan UU PDP No. 27/2022 — Audit Transparansi {tenant.rtFull}
            </div>
          </div>
        </section>
      </div>

      {/* Modal: QRIS */}
      {showQris && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-on-background/60 backdrop-blur-sm">
          <div className="bg-surface-container-lowest rounded-2xl shadow-xl max-w-md w-full mx-4 sm:mx-auto p-6 relative space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[24px]">qr_code_scanner</span>
                <h3 className="text-base font-bold text-on-surface">QRIS Resmi {tenant.rtFull} {tenant.perumahanSingkat}</h3>
              </div>
              <button className="p-1 rounded-full text-on-surface-variant hover:bg-surface-container-low" onClick={() => setShowQris(false)}>
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>
            <div className="text-center space-y-1">
              <span className="text-sm text-on-surface-variant">Total Pembayaran Tagihan:</span>
              <div className="text-3xl font-extrabold text-primary font-mono">{formatRupiah(totalPaket)}</div>
              <span className="text-xs text-on-surface-variant block">Iuran {periodeBayar[selectedPeriode].label} - Periode {periodeBayar[selectedPeriode].sub}</span>
            </div>
            <div className="bg-surface-container-low p-4 rounded-xl flex flex-col items-center justify-center text-center space-y-3">
              <div className="bg-white p-3 rounded-lg shadow-sm">
                <div className="w-48 h-48 bg-gray-100 rounded flex items-center justify-center text-on-surface-variant text-sm">QR Code</div>
              </div>
              <div className="text-xs text-on-surface-variant">
                NMID: <strong>ID102026190204928</strong> (NSP: Bank Indonesia)
              </div>
              <span className="inline-flex items-center gap-1 text-secondary text-xs font-bold">
                <span className="w-2 h-2 rounded-full bg-secondary animate-ping" />
                Menunggu Pembayaran Otomatis
              </span>
            </div>
            <div className="space-y-2">
              <button className="w-full h-11 rounded-lg bg-primary text-on-primary text-sm font-bold hover:bg-primary-container shadow transition-all" onClick={() => { setShowQris(false); ajukanPembayaran("QRIS", "qr_code_2", totalPaket, paket.label); }}>
                Konfirmasi Pembayaran QRIS
              </button>
              <button className="w-full h-10 rounded-lg text-on-surface-variant text-sm hover:bg-surface-container-low transition-colors" onClick={() => setShowQris(false)}>
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Unggah Bukti — mode reguler atau AJUKAN ULANG baris ditolak */}
      {showUpload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-on-background/60 backdrop-blur-sm">
          <div className="bg-surface-container-lowest rounded-2xl shadow-xl max-w-lg w-full mx-4 sm:mx-auto p-6 relative space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[24px]">upload_file</span>
                <h3 className="text-base font-bold text-on-surface">
                  {ulangDari ? "Ajukan Ulang Pengajuan" : "Unggah Bukti Transfer Manual"}
                </h3>
              </div>
              <button className="p-1 rounded-full text-on-surface-variant hover:bg-surface-container-low" onClick={tutupUpload}>
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            {/* Batch 15E — pengajuan ulang: alasan penolakan RT ditampilkan
                apa adanya agar warga tahu apa yang harus diperbaiki. */}
            {ulangDari && (
              <div className="p-3 rounded-lg bg-error-container/40 border border-error/30 space-y-1">
                <div className="text-xs font-bold text-error flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[16px]">cancel</span>
                  Pengajuan sebelumnya ditolak ({ulangDari.tanggal})
                </div>
                <p className="text-xs text-on-surface">
                  <strong>Alasan RT:</strong> {ulangDari.alasan || "Tidak ada alasan tercatat."}
                </p>
                <p className="text-xs text-on-surface-variant">
                  {ulangDari.total} · {ulangDari.metode} — baris lama tetap tersimpan sebagai jejak; kirim
                  pengajuan baru dengan bukti yang sudah diperbaiki.
                </p>
              </div>
            )}

            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                // File WAJIB pada modal ini — inilah bukti yang diminta; tanpa
                // file pengajuan sama dengan menutup jalan verifikasi.
                if (!fileBukti) {
                  flash("Pilih file struk terlebih dahulu.");
                  return;
                }
                const berkas = fileBukti;
                tutupUpload();
                if (ulangDari) {
                  const target = ulangDari;
                  void ajukanPembayaran(
                    target.metode,
                    target.metodeIcon,
                    target.jumlah,
                    target.periodeDetail !== "-" ? target.periodeDetail : undefined,
                    berkas,
                    "Pengajuan ulang dikirim — menunggu verifikasi pengurus RT.",
                  );
                } else {
                  void ajukanPembayaran("Transfer Bank", "account_balance", totalPaket, paket.label, berkas);
                }
              }}
            >
              {!ulangDari && (
                <div className="space-y-1">
                  <label className="text-sm font-semibold text-on-surface">Pilih Tagihan yang Dibayar</label>
                  <select className="w-full h-11 px-3 rounded-lg bg-surface-container-low text-on-surface text-sm focus:outline-none focus:ring-2 focus:ring-primary">
                    <option>Iuran {periodeBayar[selectedPeriode].label} ({formatRupiah(totalPaket)})</option>
                    <option>Iuran Kondisional Lainnya</option>
                  </select>
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-sm font-semibold text-on-surface">Bank / Dompet Pengirim</label>
                  <input className="w-full h-11 px-3 rounded-lg bg-surface-container-low text-on-surface text-sm focus:outline-none focus:ring-2 focus:ring-primary" placeholder="BCA / Mandiri / GoPay" required type="text" defaultValue="BCA" />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-semibold text-on-surface">Nama Pemilik Rekening</label>
                  <input className="w-full h-11 px-3 rounded-lg bg-surface-container-low text-on-surface text-sm focus:outline-none focus:ring-2 focus:ring-primary" required type="text" defaultValue={nama} />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-semibold text-on-surface">File Struk / Tangkapan Layar (JPG, PNG, PDF maks 5MB)</label>
                <label className="border-2 border-dashed border-outline-variant hover:border-primary rounded-xl p-6 text-center bg-surface-container-low/50 cursor-pointer transition-colors block">
                  <input
                    className="hidden"
                    type="file"
                    accept=".jpg,.jpeg,.png,.pdf"
                    onChange={(e) => {
                      const file = e.target.files?.[0] ?? null;
                      setFileBukti(file);
                      // Tanpa flash "siap dikirim" — file BELUM dikirim apa pun;
                      // pengiriman hanya terjadi saat tombol Kirim ditekan.
                    }}
                  />
                  <span className="material-symbols-outlined text-primary text-[36px] block">cloud_upload</span>
                  <span className="text-sm text-on-surface font-bold mt-1 block">
                    {fileBukti ? fileBukti.name : "Klik untuk memilih file struk transfer"}
                  </span>
                  <span className="text-xs text-on-surface-variant block">
                    {fileBukti
                      ? `${Math.max(1, Math.round(fileBukti.size / 1024))} KB siap dikirim — tekan "Kirim Bukti Pembayaran"`
                      : "atau seret dan lepas file di sini (JPG, PNG, PDF maks 5MB)"}
                  </span>
                </label>
              </div>
              <div className="p-3 rounded-lg bg-surface-container-low text-on-surface-variant text-xs flex items-start gap-2">
                <span className="material-symbols-outlined text-primary text-[18px] shrink-0">info</span>
                <span>Setelah dikirim, status tagihan akan berubah menjadi <strong>Menunggu Verifikasi</strong> sampai Bendahara mencocokkan mutasi kas.</span>
              </div>
              <div className="flex items-center justify-end gap-3 pt-1">
                <button className="h-11 px-4 rounded-lg text-on-surface-variant text-sm hover:bg-surface-container-low" type="button" onClick={tutupUpload}>Batal</button>
                <button
                  className="h-11 px-5 rounded-lg bg-primary text-on-primary text-sm font-bold hover:bg-primary-container shadow transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                  type="submit"
                  disabled={uploadSedang || !fileBukti}
                >
                  {uploadSedang ? "Mengirim…" : "Kirim Bukti Pembayaran"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Bayar Tunai */}
      {showTunai && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-on-background/60 backdrop-blur-sm">
          <div className="bg-surface-container-lowest rounded-2xl shadow-xl max-w-md w-full mx-4 sm:mx-auto p-6 relative space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-secondary text-[24px]">payments</span>
                <h3 className="text-base font-bold text-on-surface">Bayar Tunai ke Bendahara RT</h3>
              </div>
              <button className="p-1 rounded-full text-on-surface-variant hover:bg-surface-container-low" onClick={() => setShowTunai(false)}>
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>
            <div className="p-4 rounded-xl bg-secondary-container/20 border border-secondary-container/30 space-y-2">
              <div className="flex items-center gap-2 text-sm text-on-surface">
                <span className="material-symbols-outlined text-[18px] text-secondary">info</span>
                <span className="font-semibold">Cara Pembayaran Tunai</span>
              </div>
              <ol className="text-xs text-on-surface-variant space-y-1.5 ml-7 list-decimal">
                <li>Hubungi Bendahara {tenant.rtFull}: <strong>{namaBendahara}</strong></li>
                <li>Waktu pelayanan: <strong>Pukul 08.00 - 20.00 WIB</strong></li>
                <li>Bayar sesuai nominal tagihan &amp; minta paraf kartu iuran</li>
                <li>Status akan diperbarui setelah Bendahara mengkonfirmasi</li>
              </ol>
            </div>
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-sm font-semibold text-on-surface">Nominal yang Dibayarkan</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-sm font-bold">Rp</span>
                  <input
                    className="w-full h-11 pl-10 pr-3 rounded-lg bg-surface-container-low text-on-surface font-bold text-lg focus:outline-none focus:ring-2 focus:ring-primary"
                    type="tel"
                    inputMode="numeric"
                    value={tunaiNominal}
                    onChange={(e) => setTunaiNominal(e.target.value.replace(/\D/g, ""))}
                    required
                  />
                </div>
              </div>
              <div className="p-3 rounded-lg bg-surface-container-low text-on-surface-variant text-xs flex items-start gap-2">
                <span className="material-symbols-outlined text-secondary text-[18px] shrink-0">shield</span>
                <span>Pembayaran tunai akan diverifikasi oleh Bendahara {tenant.rtFull}. Anda akan menerima konfirmasi melalui WhatsApp setelah verifikasi selesai.</span>
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 pt-1">
              <button className="h-11 px-4 rounded-lg text-on-surface-variant text-sm hover:bg-surface-container-low" onClick={() => setShowTunai(false)}>Batal</button>
              <button
                className="h-11 px-5 rounded-lg bg-secondary text-on-secondary text-sm font-bold hover:bg-secondary-container shadow transition-all"
                onClick={() => {
                  setShowTunai(false);
                  ajukanPembayaran("Tunai", "payments", Number(tunaiNominal.replace(/\D/g, "")) || 0, tunaiPeriode || paket.label);
                }}
              >
                Konfirmasi Pembayaran Tunai
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
