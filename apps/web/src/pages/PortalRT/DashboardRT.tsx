import { tenant } from "../../lib/tenant";
import {
  KkData,
  WargaRt,
  HunianRumah,
  KasRt,
  KategoriIuran,
  Pembayaran,
  Surat,
  TagihanTambahan,
  hitungPopulasi,
  hitungHunian,
  saldoKasRt,
  rekapKasRt,
  hitungTagihanRows,
  rekapIuran,
  formatRupiah,
  PERIODE_AKTIF,
} from "../../lib/shared";
import { EmptyState } from "../../components/EmptyState";
import { useFlash } from "../../lib/useFlash";

interface DashboardRTProps {
  onNavigate?: (page: string) => void;
  kkList: KkData[];
  wargaRt: WargaRt[];
  hunian: HunianRumah[];
  kasRt: KasRt[];
  kategoriIuran: KategoriIuran[];
  pembayaran: Pembayaran[];
  surat: Surat[];
  tagihanTambahan: TagihanTambahan[];
}

export function DashboardRT({
  onNavigate,
  kkList,
  wargaRt,
  hunian,
  kasRt,
  kategoriIuran,
  pembayaran,
  surat,
}: DashboardRTProps) {
  const { flash, toast } = useFlash();


  const today = new Date();
  const dayNames = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
  const monthNames = [
    "Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember",
  ];
  const dayName = dayNames[today.getDay()];
  const dateStr = `${today.getDate()} ${monthNames[today.getMonth()]} ${today.getFullYear()}`;

  // — Nilai turunan dari data bersama (satu sumber dengan halaman lain) —
  const populasi = hitungPopulasi(kkList, wargaRt);
  const rekapHunian = hitungHunian(hunian);
  const pemilik = hunian.filter((h) => h.status === "Dihuni Pemilik").length;
  const sewa = hunian.filter((h) => h.status === "Sewa/Kontrak" || h.jenis.includes("Sewa")).length;
  const multi = rekapHunian.multi;
  const persen = (n: number) => (rekapHunian.total ? (n / rekapHunian.total) * 100 : 0);

  const saldo = saldoKasRt(kasRt);
  const kas = rekapKasRt(kasRt);
  const surplus = kas.pemasukan - kas.pengeluaran;
  const mutasi = kas.pemasukan + kas.pengeluaran;
  const porsi = (n: number) => (mutasi ? (n / mutasi) * 100 : 0);

  const tagihanRows = hitungTagihanRows(kategoriIuran, pembayaran);
  const rekap = rekapIuran(tagihanRows, pembayaran);

  const suratMenungguRt = surat.filter((s) => s.status === "Menunggu RT");
  const suratUtama = suratMenungguRt[0];

  const pendingPembayaran = pembayaran.filter((p) => p.status === "Menunggu Verifikasi");
  const pendingTotal = pendingPembayaran.reduce((sum, p) => sum + p.jumlah, 0);

  const tunggakanRow = tagihanRows.find(
    (r) => r.status === "Belum Bayar" || r.status === "Sebagian" || r.status === "Denda"
  );

  const arusKas = kasRt.slice(-3).reverse();

  // Riwayat 5 bulan sebelumnya + mutasi berjalan periode berjalan (dari buku kas).
  const chartData = [
    { label: "Mei", pemasukan: 4200000, pengeluaran: 3800000 },
    { label: "Jun", pemasukan: 4500000, pengeluaran: 3950000 },
    { label: "Jul", pemasukan: 4100000, pengeluaran: 4200000 },
    { label: "Ags", pemasukan: 4600000, pengeluaran: 3700000 },
    { label: "Sep", pemasukan: 4800000, pengeluaran: 4100000 },
    { label: "Okt", pemasukan: kas.pemasukan, pengeluaran: kas.pengeluaran },
  ];

  const maxVal = Math.max(...chartData.map((d) => Math.max(d.pemasukan, d.pengeluaran)));
  const barWidth = 28;
  const gap = 16;
  const chartH = 140;
  const chartW = chartData.length * (barWidth * 2 + gap + 8);

  return (
    <div className="max-w-7xl mx-auto w-full space-y-6">
      {/* Toast */}
      {toast}

      {/* 1. Breadcrumb & Status */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <nav className="flex items-center gap-1.5 text-sm text-on-surface-variant">
          <span className="font-semibold">Portal RT</span>
          <span className="material-symbols-outlined text-[16px]">chevron_right</span>
          <span className="font-bold text-on-surface">Dasbor Utama {tenant.rtFull}</span>
        </nav>
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-secondary-container/40 text-on-secondary-container text-xs font-semibold">
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-secondary opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-secondary" />
          </span>
          Sinkronisasi Master {tenant.rwFull}: Aktif &bull; 08:42 WIB
        </div>
      </div>

      {/* 2. Welcome Hero */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary-container via-primary to-on-primary-fixed-variant p-8 text-on-primary">
        <div className="absolute -right-20 -top-20 w-72 h-72 bg-white/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute left-1/2 bottom-0 w-96 h-48 bg-white/5 rounded-full blur-2xl pointer-events-none" />
        <div className="relative z-10 space-y-4">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/15 backdrop-blur-sm text-sm font-semibold">
            <span className="material-symbols-outlined text-[16px]" style={{ fontVariationSettings: "'FILL' 1" }}>
              verified
            </span>
            Wilayah Hukum {tenant.perumahan}
          </span>
          <h1 className="text-2xl lg:text-3xl font-extrabold tracking-tight leading-tight">
            Selamat Bertugas, Bpk. Joko Santoso
          </h1>
          <p className="text-sm text-on-primary/80 max-w-2xl">
            Hari ini {dayName}, {dateStr}. Seluruh rekapitulasi kependudukan, buku kas {tenant.rtFull}, dan layanan
            administrasi persuratan warga siap diverifikasi.
          </p>
          <div className="flex flex-wrap gap-2 pt-2">
            <button
              className="inline-flex items-center justify-center gap-2 px-5 py-3 min-h-[48px] rounded-xl bg-white/15 backdrop-blur-sm hover:bg-white/25 text-sm font-bold transition-all"
              onClick={() => onNavigate?.("kas-rt")}
            >
              <span className="material-symbols-outlined text-[20px]">add</span>
              Catat Kas
            </button>
            <button
              className="inline-flex items-center justify-center gap-2 px-5 py-3 min-h-[48px] rounded-xl bg-white/15 backdrop-blur-sm hover:bg-white/25 text-sm font-bold transition-all"
              onClick={() => onNavigate?.("data-warga-rt")}
            >
              <span className="material-symbols-outlined text-[20px]">person_add</span>
              Warga Baru
            </button>
            <button
              className="inline-flex items-center justify-center gap-2 px-5 py-3 min-h-[48px] rounded-xl bg-white/15 backdrop-blur-sm hover:bg-white/25 text-sm font-bold transition-all"
              onClick={() => onNavigate?.("iuran-rt")}
            >
              <span className="material-symbols-outlined text-[20px]">request_quote</span>
              Tagihan Iuran
            </button>
            <button
              className="inline-flex items-center justify-center gap-2 px-5 py-3 min-h-[48px] rounded-xl bg-white/15 backdrop-blur-sm hover:bg-white/25 text-sm font-bold transition-all"
              onClick={() => onNavigate?.("surat-pengantar-rt")}
            >
              <span className="material-symbols-outlined text-[20px]">edit_note</span>
              Terbitkan Surat
            </button>
          </div>
        </div>
      </div>

      {/* 2b. Info Wilayah Lengkap */}
      <div className="bg-surface-container-lowest rounded-xl p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-[20px]">location_city</span>
            <span className="text-sm font-bold text-on-surface">Informasi Wilayah</span>
          </div>
          <span className="text-[11px] text-on-surface-variant">Sumber: konfigurasi wilayah {tenant.label}</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="p-3 rounded-lg bg-surface-container-low">
            <div className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider">RT</div>
            <div className="text-sm font-bold text-on-surface mt-0.5">{tenant.rtFull}</div>
          </div>
          <div className="p-3 rounded-lg bg-surface-container-low">
            <div className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider">RW</div>
            <div className="text-sm font-bold text-on-surface mt-0.5">{tenant.rwFull}</div>
          </div>
          <div className="p-3 rounded-lg bg-surface-container-low">
            <div className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider">Kelurahan</div>
            <div className="text-sm font-bold text-on-surface mt-0.5">{tenant.kelurahan}</div>
          </div>
          <div className="p-3 rounded-lg bg-surface-container-low">
            <div className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider">Kecamatan</div>
            <div className="text-sm font-bold text-on-surface mt-0.5">{tenant.kecamatan}</div>
          </div>
          <div className="p-3 rounded-lg bg-surface-container-low">
            <div className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider">Kota / Kab.</div>
            <div className="text-sm font-bold text-on-surface mt-0.5">{tenant.kota}</div>
          </div>
          <div className="p-3 rounded-lg bg-surface-container-low">
            <div className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider">Provinsi</div>
            <div className="text-sm font-bold text-on-surface mt-0.5">{tenant.provinsi}</div>
          </div>
          <div className="col-span-2 sm:col-span-3 lg:col-span-6 p-3 rounded-lg bg-primary-container/25 border border-primary/15 flex items-start gap-2.5">
            <span className="material-symbols-outlined text-primary text-[18px] mt-0.5 shrink-0">location_on</span>
            <div className="min-w-0">
              <div className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider">Alamat Lengkap</div>
              <div className="text-sm font-bold text-on-surface mt-0.5 leading-snug break-words">
                {tenant.alamatLengkap}, Prov. {tenant.provinsi}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 3. KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* KPI 1: Total Populasi */}
        <div className="bg-surface-container-lowest rounded-xl p-5 shadow-sm flex flex-col justify-between">
          <div className="flex items-start justify-between">
            <span className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">Total Populasi {tenant.rtFull}</span>
            <div className="w-10 h-10 rounded-full bg-primary-container flex items-center justify-center text-on-primary-container">
              <span className="material-symbols-outlined text-[22px]">groups</span>
            </div>
          </div>
          <div className="mt-4">
            <div className="text-2xl font-extrabold text-on-surface">{populasi.jiwa} Jiwa</div>
            <div className="text-[11px] text-on-surface-variant mt-1">{populasi.kk} KK &bull; {rekapHunian.total} Rumah</div>
          </div>
        </div>

        {/* KPI 2: Kas RT Aktif */}
        <div className="bg-surface-container-lowest rounded-xl p-5 shadow-sm flex flex-col justify-between">
          <div className="flex items-start justify-between">
            <span className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">Kas {tenant.rtFull} Aktif</span>
            <div className="w-10 h-10 rounded-full bg-primary-container flex items-center justify-center text-on-primary-container">
              <span className="material-symbols-outlined text-[22px]">account_balance_wallet</span>
            </div>
          </div>
          <div className="mt-4">
            <div className="text-2xl font-extrabold text-primary">{formatRupiah(saldo)}</div>
            <div className="inline-flex items-center gap-1 mt-2 px-2.5 py-0.5 rounded-full bg-secondary-container text-on-secondary-container text-[11px] font-bold">
              <span className="material-symbols-outlined text-[14px]">check_circle</span>
              Rekonsiliasi OK
            </div>
          </div>
        </div>

        {/* KPI 3: Iuran periode berjalan */}
        <div className="bg-surface-container-lowest rounded-xl p-5 shadow-sm flex flex-col justify-between">
          <div className="flex items-start justify-between">
            <span className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">Iuran {PERIODE_AKTIF}</span>
            <div className="w-10 h-10 rounded-full bg-primary-container flex items-center justify-center text-on-primary-container">
              <span className="material-symbols-outlined text-[22px]">paid</span>
            </div>
          </div>
          <div className="mt-4">
            <div className="text-2xl font-extrabold text-on-surface">{rekap.kepatuhan.toFixed(1)}% <span className="text-base font-bold text-secondary">Terkumpul</span></div>
            <div className="w-full bg-surface-container-high h-2 rounded-full overflow-hidden mt-3">
              <div className="bg-primary h-full rounded-full" style={{ width: `${rekap.kepatuhan}%` }} />
            </div>
            <div className="text-[11px] text-on-surface-variant mt-2">{rekap.lunasCount}/{tagihanRows.length} KK Lunas</div>
          </div>
        </div>

        {/* KPI 4: Permohonan Surat */}
        <div className="bg-surface-container-lowest rounded-xl p-5 shadow-sm flex flex-col justify-between">
          <div className="flex items-start justify-between">
            <span className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">Permohonan Surat</span>
            <div className="w-10 h-10 rounded-full bg-primary-container flex items-center justify-center text-on-primary-container">
              <span className="material-symbols-outlined text-[22px]">mark_email_read</span>
            </div>
          </div>
          <div className="mt-4">
            <div className="text-2xl font-extrabold text-on-surface">
              {suratMenungguRt.length}{" "}
              <span className={`text-base font-bold ${suratMenungguRt.length > 0 ? "text-error" : "text-secondary"}`}>
                {suratMenungguRt.length > 0 ? "Butuh Verifikasi" : "Semua Beres"}
              </span>
            </div>
            <div
              className={`inline-flex items-center gap-1 mt-2 px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                suratMenungguRt.length > 0
                  ? "bg-error-container/40 text-on-error-container"
                  : "bg-secondary-container text-on-secondary-container"
              }`}
            >
              <span className="material-symbols-outlined text-[14px]">{suratMenungguRt.length > 0 ? "timer" : "check_circle"}</span>
              {suratMenungguRt.length > 0 ? "SLA < 24 Jam" : "Tidak ada antrean"}
            </div>
          </div>
        </div>
      </div>

      {/* 4. Main Grid 7:5 */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column (7) */}
        <div className="lg:col-span-7 flex flex-col gap-6">
          {/* Tindakan Mendesak */}
          <section className="bg-surface-container-lowest rounded-xl p-6 shadow-sm">
            <div className="flex items-center justify-between pb-4 mb-4 border-b border-surface-container-high">
              <div>
                <h2 className="text-lg font-bold text-on-surface">Tindakan Mendesak</h2>
                <p className="text-xs text-on-surface-variant mt-0.5">Item yang memerlukan tindakan segera dari Ketua {tenant.rtFull}</p>
              </div>
              <span className="material-symbols-outlined text-error text-[24px]">priority_high</span>
            </div>
            <div className="space-y-3">
              {/* Item 1: Surat menunggu TTD RT */}
              {suratUtama ? (
                <div className="p-4 rounded-xl bg-surface-container-low flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-lg bg-error-container/30 flex items-center justify-center shrink-0">
                      <span className="material-symbols-outlined text-error text-[22px]">draw</span>
                    </div>
                    <div>
                      <div className="text-sm font-bold text-on-surface">{suratUtama.pemohon}</div>
                      <div className="text-xs text-on-surface-variant">{suratUtama.jenis} &bull; Butuh TTD Digital</div>
                    </div>
                  </div>
                  <button
                    className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 min-h-[44px] rounded-lg bg-primary hover:bg-primary-container text-on-primary text-sm font-bold transition-all shrink-0"
                    onClick={() => onNavigate?.("surat-pengantar-rt")}
                  >
                    <span className="material-symbols-outlined text-[18px]">stylus_note</span>
                    Tanda Tangani
                  </button>
                </div>
              ) : (
                <div className="p-4 rounded-xl bg-surface-container-low flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-secondary-container/40 flex items-center justify-center shrink-0">
                    <span className="material-symbols-outlined text-secondary text-[22px]">task_alt</span>
                  </div>
                  <div className="text-sm font-semibold text-on-surface">Tidak ada surat menunggu persetujuan RT.</div>
                </div>
              )}

              {/* Item 2: Pembayaran menunggu verifikasi */}
              {pendingPembayaran.length > 0 ? (
                <div className="p-4 rounded-xl bg-surface-container-low flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-lg bg-secondary-container/40 flex items-center justify-center shrink-0">
                      <span className="material-symbols-outlined text-secondary text-[22px]">receipt_long</span>
                    </div>
                    <div>
                      <div className="text-sm font-bold text-on-surface">{pendingPembayaran[0].nama}</div>
                      <div className="text-xs text-on-surface-variant">
                        {pendingPembayaran.length} Bukti Transfer &bull; Nominal {formatRupiah(pendingTotal)}
                      </div>
                    </div>
                  </div>
                  <button
                    className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 min-h-[44px] rounded-lg bg-secondary hover:bg-secondary-container hover:text-on-secondary-container text-on-secondary text-sm font-bold transition-all shrink-0"
                    onClick={() => onNavigate?.("iuran-rt")}
                  >
                    <span className="material-symbols-outlined text-[18px]">check_circle</span>
                    Verifikasi Iuran
                  </button>
                </div>
              ) : (
                <div className="p-4 rounded-xl bg-surface-container-low flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-secondary-container/40 flex items-center justify-center shrink-0">
                    <span className="material-symbols-outlined text-secondary text-[22px]">task_alt</span>
                  </div>
                  <div className="text-sm font-semibold text-on-surface">Semua pembayaran sudah diverifikasi.</div>
                </div>
              )}

              {/* Item 3: Rumah tunggakan iuran */}
              {tunggakanRow ? (
                <div className="p-4 rounded-xl bg-surface-container-low flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-lg bg-tertiary-container/40 flex items-center justify-center shrink-0">
                      <span className="material-symbols-outlined text-tertiary text-[22px]">family_restroom</span>
                    </div>
                    <div>
                      <div className="text-sm font-bold text-on-surface">{tunggakanRow.kepalaKk}</div>
                      <div className="text-xs text-on-surface-variant">
                        Tunggakan Iuran &bull; {tunggakanRow.alamat} &bull; {tunggakanRow.status} &bull; {formatRupiah(tunggakanRow.jumlah)}
                      </div>
                    </div>
                  </div>
                  <button
                    className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 min-h-[44px] rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface text-sm font-bold transition-all shrink-0"
                    onClick={() => onNavigate?.("iuran-rt")}
                  >
                    <span className="material-symbols-outlined text-[18px]">request_quote</span>
                    Tinjau Iuran
                  </button>
                </div>
              ) : (
                <div className="p-4 rounded-xl bg-surface-container-low flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-secondary-container/40 flex items-center justify-center shrink-0">
                    <span className="material-symbols-outlined text-secondary text-[22px]">task_alt</span>
                  </div>
                  <div className="text-sm font-semibold text-on-surface">Tidak ada tunggakan iuran periode ini.</div>
                </div>
              )}
            </div>
          </section>

          {/* Transparansi Keuangan */}
          <section className="bg-surface-container-lowest rounded-xl p-6 shadow-sm">
            <div className="flex items-center justify-between pb-4 mb-4 border-b border-surface-container-high">
              <div>
                <h2 className="text-lg font-bold text-on-surface">Transparansi Keuangan</h2>
                <p className="text-xs text-on-surface-variant mt-0.5">6 Bulan Terakhir &bull; Pemasukan vs Pengeluaran</p>
              </div>
              <button
                className="text-xs font-bold text-primary hover:underline"
                onClick={() => onNavigate?.("kas-rt")}
              >
                Lihat Rincian
              </button>
            </div>

            <div className="overflow-x-auto">
              <svg viewBox={`0 0 ${chartW} ${chartH + 40}`} className="w-full h-auto" style={{ minWidth: 300 }}>
                {chartData.map((d, i) => {
                  const x = i * (barWidth * 2 + gap + 8) + 10;
                  const pH = (d.pemasukan / maxVal) * chartH;
                  const eH = (d.pengeluaran / maxVal) * chartH;
                  return (
                    <g key={d.label}>
                      <rect x={x} y={chartH - pH + 10} width={barWidth} height={pH} rx={4} fill="#0F5132" />
                      <rect x={x + barWidth + 4} y={chartH - eH + 10} width={barWidth} height={eH} rx={4} fill="#8B5CF6" />
                      <text x={x + barWidth + 2} y={chartH + 30} textAnchor="middle" className="fill-on-surface-variant" fontSize="11" fontWeight="600">
                        {d.label}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>

            <div className="flex flex-wrap items-center gap-4 mt-3">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-sm bg-primary" />
                <span className="text-xs font-semibold text-on-surface-variant">Pemasukan</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-sm bg-tertiary" />
                <span className="text-xs font-semibold text-on-surface-variant">Pengeluaran</span>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t border-surface-container-high">
              <div>
                <div className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider">Pemasukan</div>
                <div className="text-sm font-bold text-on-surface mt-0.5">{formatRupiah(kas.pemasukan)}</div>
                <div className="text-[11px] text-secondary font-semibold">{porsi(kas.pemasukan).toFixed(1)}% Mutasi Kas</div>
              </div>
              <div>
                <div className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider">Pengeluaran</div>
                <div className="text-sm font-bold text-on-surface mt-0.5">{formatRupiah(kas.pengeluaran)}</div>
                <div className="text-[11px] text-on-surface-variant">{porsi(kas.pengeluaran).toFixed(1)}% Mutasi Kas</div>
              </div>
              <div>
                <div className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider">Surplus</div>
                <div className={`text-sm font-bold mt-0.5 ${surplus >= 0 ? "text-on-surface" : "text-error"}`}>
                  {formatRupiah(surplus)}
                </div>
                <div className="text-[11px] text-on-surface-variant">Pemasukan − Pengeluaran</div>
              </div>
            </div>
          </section>

          {/* Rekapitulasi Hunian Fisik */}
          <section className="bg-surface-container-lowest rounded-xl p-6 shadow-sm">
            <div className="flex items-center justify-between pb-4 mb-4 border-b border-surface-container-high">
              <div>
                <h2 className="text-lg font-bold text-on-surface">Rekapitulasi Hunian Fisik</h2>
                <p className="text-xs text-on-surface-variant mt-0.5">Status kepemilikan &amp; hunian rumah di {tenant.rtFull} &bull; klik untuk membuka Data Hunian</p>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <button
                type="button"
                className="p-4 rounded-xl bg-surface-container-low text-center hover:bg-surface-container-high hover:shadow-sm transition-all w-full"
                onClick={() => onNavigate?.("data-hunian-rt")}
              >
                <div className="w-12 h-12 rounded-full bg-primary-container mx-auto flex items-center justify-center text-on-primary-container">
                  <span className="material-symbols-outlined text-[28px]">home</span>
                </div>
                <div className="text-xl font-extrabold text-on-surface mt-3">{pemilik}</div>
                <div className="text-xs font-semibold text-on-surface-variant">Rumah Tetap</div>
                <div className="text-[11px] text-secondary font-bold mt-1">{persen(pemilik).toFixed(1)}%</div>
              </button>
              <button
                type="button"
                className="p-4 rounded-xl bg-surface-container-low text-center hover:bg-surface-container-high hover:shadow-sm transition-all w-full"
                onClick={() => onNavigate?.("data-hunian-rt")}
              >
                <div className="w-12 h-12 rounded-full bg-secondary-container mx-auto flex items-center justify-center text-on-secondary-container">
                  <span className="material-symbols-outlined text-[28px]">key</span>
                </div>
                <div className="text-xl font-extrabold text-on-surface mt-3">{sewa}</div>
                <div className="text-xs font-semibold text-on-surface-variant">Rumah Sewa</div>
                <div className="text-[11px] text-tertiary font-bold mt-1">{persen(sewa).toFixed(1)}%</div>
              </button>
              <button
                type="button"
                className="p-4 rounded-xl bg-surface-container-low text-center hover:bg-surface-container-high hover:shadow-sm transition-all w-full"
                onClick={() => onNavigate?.("data-hunian-rt")}
              >
                <div className="w-12 h-12 rounded-full bg-tertiary-container mx-auto flex items-center justify-center text-on-tertiary-container">
                  <span className="material-symbols-outlined text-[28px]">groups</span>
                </div>
                <div className="text-xl font-extrabold text-on-surface mt-3">{multi}</div>
                <div className="text-xs font-semibold text-on-surface-variant">Multi-KK</div>
                <div className="text-[11px] text-error font-bold mt-1">{persen(multi).toFixed(1)}%</div>
              </button>
            </div>
          </section>
        </div>

        {/* Right Column (5) */}
        <div className="lg:col-span-5 flex flex-col gap-6">
          {/* Verifikasi Surat Pengantar */}
          <section className="bg-surface-container-lowest rounded-xl p-5 shadow-sm">
            <div className="flex items-center justify-between pb-4 mb-4 border-b border-surface-container-high">
              <h2 className="text-base font-bold text-on-surface">Verifikasi Surat Pengantar</h2>
              <span className="material-symbols-outlined text-primary text-[22px]">mark_email_unread</span>
            </div>
            <div className="p-4 rounded-xl bg-surface-container-low">
              {suratUtama ? (
                <>
                  <div className="flex items-start gap-3 mb-4">
                    <div className="w-10 h-10 rounded-lg bg-primary-container flex items-center justify-center text-on-primary-container shrink-0">
                      <span className="material-symbols-outlined text-[22px]">description</span>
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-on-surface">{suratUtama.jenis}</div>
                      <div className="text-xs text-on-surface-variant mt-0.5">Pemohon: {suratUtama.pemohon}</div>
                      <div className="text-[11px] text-on-surface-variant mt-0.5">Diajukan: {suratUtama.tanggal}</div>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2">
                    <button
                      className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 min-h-[44px] rounded-lg bg-primary hover:bg-primary-container text-on-primary text-sm font-bold transition-all"
                      onClick={() => onNavigate?.("surat-pengantar-rt")}
                    >
                      <span className="material-symbols-outlined text-[18px]">check_circle</span>
                      Tinjau &amp; Setujui
                    </button>
                    <button
                      className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 min-h-[44px] rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface text-sm font-bold transition-all"
                      onClick={() => onNavigate?.("surat-pengantar-rt")}
                    >
                      <span className="material-symbols-outlined text-[18px]">forward_to_inbox</span>
                      Teruskan ke {tenant.rwFull}
                    </button>
                  </div>
                </>
              ) : (
                <div className="py-8 text-center">
                  <span className="material-symbols-outlined text-[32px] text-on-surface-variant block mb-2">task_alt</span>
                  <p className="text-sm text-on-surface-variant">
                    Tidak ada surat pengantar yang menunggu verifikasi RT.
                  </p>
                </div>
              )}
            </div>
          </section>

          {/* Arus Kas Terkini */}
          <section className="bg-surface-container-lowest rounded-xl p-5 shadow-sm">
            <div className="flex items-center justify-between pb-4 mb-4 border-b border-surface-container-high">
              <h2 className="text-base font-bold text-on-surface">Arus Kas Terkini</h2>
              <button
                className="text-xs font-bold text-primary hover:underline"
                onClick={() => onNavigate?.("kas-rt")}
              >
                Semua
              </button>
            </div>
            <div className="space-y-3">
              {arusKas.length === 0 && (
                <div className="py-4 rounded-lg bg-surface-container-low">
                  <EmptyState
                    icon="payments"
                    judul="Belum ada transaksi kas"
                    pesan="Arus kas RT akan tampil setelah ada pencatatan pemasukan atau pengeluaran."
                  />
                </div>
              )}
              {arusKas.map((k) => {
                const masuk = k.tipe === "Pemasukan";
                return (
                  <div key={k.id} className="p-3 rounded-lg bg-surface-container-low flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-9 h-9 rounded-full flex items-center justify-center ${
                          masuk ? "bg-secondary-container text-on-secondary-container" : "bg-error-container/30 text-error"
                        }`}
                      >
                        <span className="material-symbols-outlined text-[20px]">{masuk ? "add_circle" : "remove_circle"}</span>
                      </div>
                      <div>
                        <div className="text-sm font-bold text-on-surface">{k.keterangan}</div>
                        <div className="text-[11px] text-on-surface-variant">{k.tanggal} &bull; {k.kategori}</div>
                      </div>
                    </div>
                    <span className={`text-sm font-extrabold font-mono ${masuk ? "text-secondary" : "text-error"}`}>
                      {masuk ? "+" : "-"}
                      {formatRupiah(Math.abs(k.nominal))}
                    </span>
                  </div>
                );
              })}
            </div>
            <div
              className={`mt-4 p-3 rounded-lg flex items-center gap-2 ${
                surplus >= 0 ? "bg-secondary-container/30" : "bg-error-container/30"
              }`}
            >
              <span className={`material-symbols-outlined text-[18px] ${surplus >= 0 ? "text-secondary" : "text-error"}`}>
                {surplus >= 0 ? "trending_up" : "trending_down"}
              </span>
              <span
                className={`text-xs font-bold ${
                  surplus >= 0 ? "text-on-secondary-container" : "text-on-error-container"
                }`}
              >
                {surplus >= 0
                  ? `Surplus Operasional Sehat (${formatRupiah(surplus)})`
                  : `Defisit Operasional (${formatRupiah(surplus)})`}
              </span>
            </div>
          </section>

          {/* Jajaran Koordinasi Wilayah */}
          <section className="bg-surface-container-lowest rounded-xl p-5 shadow-sm">
            <div className="flex items-center justify-between pb-4 mb-4 border-b border-surface-container-high">
              <h2 className="text-base font-bold text-on-surface">Jajaran Koordinasi Wilayah</h2>
              <span className="material-symbols-outlined text-primary text-[22px]">diversity_3</span>
            </div>
            <div className="space-y-3">
              <div className="p-3 rounded-lg bg-surface-container-low flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-secondary-container flex items-center justify-center text-on-secondary-container font-bold text-xs">
                    RH
                  </div>
                  <div>
                    <div className="text-sm font-bold text-on-surface">Rahmat Hidayat</div>
                    <div className="text-[11px] text-on-surface-variant">Sekretaris {tenant.rtFull}</div>
                  </div>
                </div>
                <button
                  className="inline-flex items-center gap-1 px-3 py-2 min-h-[44px] rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface text-[11px] font-bold transition-all"
                  onClick={() => flash("Membuka chat WhatsApp dengan Rahmat Hidayat (Sekretaris " + tenant.rtFull + ")...")}
                >
                  <span className="material-symbols-outlined text-[16px]">chat</span>
                  Chat
                </button>
              </div>
              <div className="p-3 rounded-lg bg-surface-container-low flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary-container flex items-center justify-center text-on-primary-container font-bold text-xs">
                    SR
                  </div>
                  <div>
                    <div className="text-sm font-bold text-on-surface">Hj. Siti Rahmawati</div>
                    <div className="text-[11px] text-on-surface-variant">Bendahara {tenant.rtFull}</div>
                  </div>
                </div>
                <button
                  className="inline-flex items-center gap-1 px-3 py-2 min-h-[44px] rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface text-[11px] font-bold transition-all"
                  onClick={() => flash("Membuka chat WhatsApp dengan Hj. Siti Rahmawati (Bendahara " + tenant.rtFull + ")...")}
                >
                  <span className="material-symbols-outlined text-[16px]">chat</span>
                  Chat
                </button>
              </div>
              <div className="p-3 rounded-lg bg-surface-container-low flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-tertiary-container flex items-center justify-center text-on-tertiary-container font-bold text-xs">
                    HS
                  </div>
                  <div>
                    <div className="text-sm font-bold text-on-surface">Bpk. H. Subaidi</div>
                    <div className="text-[11px] text-on-surface-variant">Ketua {tenant.rwFull}</div>
                  </div>
                </div>
                <button
                  className="inline-flex items-center gap-1 px-3 py-2 min-h-[44px] rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface text-[11px] font-bold transition-all"
                  onClick={() => flash("Membuka chat WhatsApp dengan Bpk. H. Subaidi (Ketua " + tenant.rwFull + ")...")}
                >
                  <span className="material-symbols-outlined text-[16px]">chat</span>
                  Chat
                </button>
              </div>
            </div>
          </section>

          {/* Kepatuhan UU PDP */}
          <section className="bg-secondary-container/30 rounded-xl p-5 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center text-on-secondary shrink-0">
                <span className="material-symbols-outlined text-[22px]">shield</span>
              </div>
              <div>
                <div className="text-sm font-bold text-on-surface">Kepatuhan UU PDP</div>
                <p className="text-xs text-on-surface-variant mt-1">
                  Seluruh data penduduk terenkripsi &amp; diolah sesuai UU No. 27 Tahun 2022 tentang
                  Pelindungan Data Pribadi. Audit keamanan dilakukan secara berkala.
                </p>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
