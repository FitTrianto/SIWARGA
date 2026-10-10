import { useState } from "react";
import { tenant } from "../../lib/tenant";
import {
  KategoriIuran,
  KasRt,
  KkData,
  Pembayaran,
  Pengurus,
  PERIODE_AKTIF,
  StatusSurat,
  Surat,
  TagihanTambahan,
  deskripsiIuran,
  formatRupiah,
  hitungIuranBulanan,
  kategoriTagihan,
  maskedNoKk,
  rekapKasRt,
  saldoKasRt,
  shortAlamat,
} from "../../lib/shared";
import { EmptyState } from "../../components/EmptyState";
import { useFlash } from "../../lib/useFlash";

interface PortalWargaProps {
  onNavigate?: (page: string) => void;
  kkList: KkData[];
  kategoriIuran: KategoriIuran[];
  kendaraanR4Count: number;
  kasRt: KasRt[];
  surat: Surat[];
  tagihanTambahan: TagihanTambahan[];
  pembayaran: Pembayaran[];
  /** Batch 19 · pengurus RT tercatat (sesi daring dari /rt/profil; kosong = belum ada). */
  pengurus?: Pengurus[];
  onBayarTagihanTambahan: (t: TagihanTambahan) => Promise<boolean> | boolean;
}

const kategoriIconById: Record<string, string> = {
  keamanan: "shield",
  kebersihan: "delete_sweep",
  sosial: "volunteer_activism",
  r4: "directions_car",
};

const statusIuranBadge: Record<string, { label: string; cls: string; icon: string }> = {
  Lunas: { label: "LUNAS", cls: "bg-secondary-container text-on-secondary-container", icon: "check_circle" },
  "Menunggu Verifikasi": { label: "MENUNGGU VERIFIKASI", cls: "bg-tertiary-container text-on-tertiary-container", icon: "schedule" },
  "Belum Bayar": { label: "BELUM DIBAYAR", cls: "bg-error-container text-on-error-container", icon: "error" },
};

/** Badge status surat versi warga (label lebih sopan dari bahasa internal). */
const suratBadgeWarga: Record<StatusSurat, { label: string; cls: string; icon: string }> = {
  Draft: { label: "Draft", cls: "bg-surface-container-highest text-on-surface text-[11px] font-semibold", icon: "edit_note" },
  "Menunggu RT": { label: "Menunggu TTD Ketua RT", cls: "bg-surface-container-highest text-on-surface text-[11px] font-semibold", icon: "hourglass_top" },
  "Menunggu RW": { label: "Menunggu Persetujuan RW", cls: "bg-secondary-fixed text-on-secondary-fixed text-[11px] font-bold", icon: "forward_to_inbox" },
  Disetujui: { label: "Selesai & Terbit", cls: "bg-secondary-fixed text-on-secondary-fixed text-[11px] font-bold", icon: "check" },
  Ditolak: { label: "Ditolak", cls: "bg-error-container text-on-error-container text-[11px] font-bold", icon: "cancel" },
  "Perlu Perbaikan": { label: "Perlu Perbaikan", cls: "bg-tertiary-container text-on-tertiary-container text-[11px] font-bold", icon: "build" },
};

export function PortalWarga({
  onNavigate,
  kkList = [],
  kategoriIuran = [],
  kendaraanR4Count = 1,
  kasRt = [],
  surat = [],
  tagihanTambahan = [],
  pembayaran = [],
  pengurus = [],
  onBayarTagihanTambahan,
}: PortalWargaProps) {
  const [showQrisModal, setShowQrisModal] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);

  const { flash, toast } = useFlash();

  // Konteks wilayah & hunian selalu derive dari tenant + KK warga (bukan seed lokal).
  const alamatWilayah = `${tenant.label} Kel. ${tenant.kelurahan}, Kec. ${tenant.kecamatan}, ${tenant.kota}`;
  const alamatHunian = kkList[0]?.alamat ?? "";
  const alamatPendek = shortAlamat(alamatHunian);
  const noKkWarga = kkList[0]?.noKk ?? "";
  const namaWarga = kkList[0]?.kepala ?? "Warga";
  const kepalaKk =
    kkList[0]?.anggota.find((m) => m.filter === "kepala") ?? kkList[0]?.anggota[0];
  // Batch 19 · NIK hanya dari baris KK milik sendiri — tanpa KK, chip NIK
  // disembunyikan (sebelumnya memalsukan "3171-xxxx-xxxx-0004").
  const nikMasked = kepalaKk?.nik ?? null;
  // Batch 19 · bendahara dari pengurus tercatat RT (bukan nama contoh) —
  // tanpa baris, label umum "RT" dipakai pada teks bantuan.
  const ketuaRt = pengurus.find((p) => p.jabatan === "Ketua RT" || p.jabatan.startsWith("Ketua"));
  const bendahara = pengurus.find((p) => p.jabatan === "Bendahara");
  const namaBendahara = bendahara?.nama ?? "RT";
  const inisialBendahara = bendahara?.initials ?? "RT";

  // Sumber kebenaran angka iuran & kas = shared (sama dengan Portal RT).
  // Batch 19 · TANPA fallback kategori contoh — tenant baru tampil rincian
  // kosong (jujur), bukan "Iuran RT Rp 25.000 / Kasbon RW" karangan.
  const rincianKategori = kategoriTagihan(kategoriIuran);
  const totalBulanan = hitungIuranBulanan(rincianKategori, kendaraanR4Count);
  const saldoKas = saldoKasRt(kasRt);
  const rekap = rekapKasRt(kasRt);

  const pembayaranSaya = pembayaran.filter((p) => shortAlamat(p.alamat) === alamatPendek);
  const bayarPeriodeIni = pembayaranSaya.filter(
    (p) => p.periode === PERIODE_AKTIF && p.status !== "Ditolak"
  );
  const terbayar = bayarPeriodeIni.reduce((sum, p) => sum + p.jumlah, 0);
  const adaLunas = bayarPeriodeIni.some((p) => p.status === "Lunas");
  const adaMenunggu = bayarPeriodeIni.some((p) => p.status === "Menunggu Verifikasi");
  const sisaTagihan = Math.max(totalBulanan - terbayar, 0);
  const statusIuran = adaLunas ? "Lunas" : adaMenunggu ? "Menunggu Verifikasi" : "Belum Bayar";
  const persenTerbayar =
    totalBulanan > 0 ? Math.min(Math.round((terbayar / totalBulanan) * 1000) / 10, 100) : 0;

  const daftarSurat = noKkWarga ? surat.filter((s) => s.noKk === noKkWarga) : [];
  const suratDisetujui = daftarSurat.filter((s) => s.status === "Disetujui");

  const tagihanWarga = tagihanTambahan.filter(
    (t) => !t.target || t.target === "semua" || t.target === alamatPendek
  );

  return (
    <>
    <div className="max-w-7xl mx-auto w-full px-4 lg:px-12 py-6 pt-8">
      {/* Welcome Banner */}
          <div className="relative overflow-hidden bg-surface-container-lowest rounded-xl shadow-sm p-6 lg:p-8 mb-6">
            <div className="absolute -right-16 -top-16 w-64 h-64 bg-primary-fixed/25 rounded-full blur-3xl pointer-events-none" />
            <div className="absolute right-32 bottom-0 w-48 h-48 bg-secondary-container/20 rounded-full blur-2xl pointer-events-none" />
            <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-secondary-container text-on-secondary-container text-xs font-semibold">
                    <span className="material-symbols-outlined text-[16px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                      verified
                    </span>
                    Warga Aktif Terverifikasi
                  </span>
                  {/* Batch 19 · chip NIK hanya bila baris KK milik sendiri ada —
                      tanpa data, tidak ada NIK palsu yang ditampilkan. */}
                  {nikMasked && (
                    <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-surface-container-low text-on-surface-variant text-[11px]">
                      <span className="material-symbols-outlined text-outline text-[14px]">lock</span>
                      NIK Terenkripsi:{" "}
                      <span className="font-mono font-semibold text-on-surface">
                        {nikMasked}
                      </span>
                    </span>
                  )}
                </div>
                <h1 className="text-2xl lg:text-[32px] font-extrabold text-on-surface tracking-tight leading-tight">
                  Selamat Pagi, {namaWarga}!
                </h1>
                <p className="text-sm text-on-surface-variant flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary text-[18px]">home</span>
                  {alamatPendek ? `Rumah ${alamatPendek} • ${alamatWilayah}` : alamatWilayah}
                </p>
              </div>
              <div className="flex items-center gap-2 self-start lg:self-center">
                <div className="bg-surface-container-low p-3 rounded-lg flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center text-on-primary">
                    <span className="material-symbols-outlined text-[22px]">calendar_month</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[11px] font-bold text-on-surface-variant uppercase tracking-wider">
                      Iuran Bulanan
                    </span>
                    <span className="text-sm font-bold text-on-surface">
                      {deskripsiIuran(rincianKategori, kendaraanR4Count, " • ")}
                    </span>
                    <span className="text-[11px] text-on-surface-variant font-semibold">
                      Periode {PERIODE_AKTIF}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Notification Banner */}
            <div className="mt-6 p-4 rounded-lg bg-surface-container-low flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
              <div className="flex items-start md:items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-secondary text-on-secondary flex items-center justify-center shrink-0">
                  <span className="material-symbols-outlined text-[20px]">notifications_active</span>
                </div>
                <div>
                  <h2 className="text-sm font-bold text-on-surface">Pengingat Tagihan Iuran Bulanan</h2>
                  <p className="text-xs text-on-surface-variant">
                    Jatuh tempo iuran bulan Oktober adalah tanggal{" "}
                    <strong>20 Oktober 2026</strong>. Tersisa{" "}
                    <strong className="text-primary font-bold font-mono">{formatRupiah(sisaTagihan)}</strong> lagi
                    untuk pelunasan penuh.
                  </p>
                </div>
              </div>
              <button
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 min-h-[44px] rounded-lg bg-primary hover:bg-primary-container text-on-primary text-sm font-bold transition-all shadow-sm w-full md:w-auto shrink-0"
                onClick={() => setShowQrisModal(true)}
              >
                <span className="material-symbols-outlined text-[18px]">payment</span>
                Bayar Sekarang
              </button>
            </div>
          </div>

          {/* 4 KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {/* KPI 1: Status Iuran */}
            <div className="bg-surface-container-lowest rounded-xl p-4 shadow-sm relative overflow-hidden flex flex-col justify-between">
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">
                    Status Iuran
                  </span>
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold ${statusIuranBadge[statusIuran].cls}`}>
                      <span className="material-symbols-outlined text-[14px]">{statusIuranBadge[statusIuran].icon}</span>
                      {statusIuranBadge[statusIuran].label}
                    </span>
                  </div>
                </div>
                <div className="w-10 h-10 rounded-full bg-surface-container flex items-center justify-center text-primary">
                  <span className="material-symbols-outlined text-[22px]">account_balance_wallet</span>
                </div>
              </div>
              <div className="mt-4">
                <div className="flex items-baseline gap-1">
                  <span className="text-xl font-bold text-on-surface font-mono">{formatRupiah(terbayar)}</span>
                  <span className="text-xs text-on-surface-variant font-mono">/ {formatRupiah(totalBulanan)}</span>
                </div>
                <div className="w-full bg-surface-container-high h-2 rounded-full overflow-hidden mt-2">
                  <div className="bg-primary h-full rounded-full" style={{ width: `${persenTerbayar}%` }} />
                </div>
                <div className="mt-2 flex items-center justify-between text-[11px] text-on-surface-variant">
                  <span>Sisa Tagihan:</span>
                  <span className="font-semibold text-primary font-mono">{formatRupiah(sisaTagihan)}</span>
                </div>
              </div>
            </div>

            {/* KPI 2: Surat Pengantar */}
            <div className="bg-surface-container-lowest rounded-xl p-4 shadow-sm relative overflow-hidden flex flex-col justify-between">
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">
                    Surat Pengantar
                  </span>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-primary-fixed text-on-primary-fixed text-xs font-bold">
                      <span className="material-symbols-outlined text-[14px]">{suratDisetujui.length > 0 ? "check_circle" : "schedule"}</span>
                      {suratDisetujui.length} Siap Unduh
                    </span>
                  </div>
                </div>
                <div className="w-10 h-10 rounded-full bg-surface-container flex items-center justify-center text-primary">
                  <span className="material-symbols-outlined text-[22px]">draft</span>
                </div>
              </div>
              <div className="mt-4">
                <div className="text-xl font-bold text-on-surface">{daftarSurat.length} Dokumen</div>
                <p className="text-xs text-on-surface-variant mt-1 line-clamp-1">
                  {daftarSurat[0]?.jenis ?? "Belum ada pengajuan surat"}
                  {suratDisetujui.length > 0 ? " (TTE RT Resmi)" : ""}
                </p>
                <div className="mt-3">
                  <a className="text-xs font-bold text-primary inline-flex items-center gap-1 hover:underline" href="#surat-kilat">
                    Buka berkas digital
                    <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
                  </a>
                </div>
              </div>
            </div>

            {/* KPI 3: Anggota Keluarga */}
            <div className="bg-surface-container-lowest rounded-xl p-4 shadow-sm relative overflow-hidden flex flex-col justify-between">
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">
                    Keluarga Terdaftar
                  </span>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-surface-container text-on-surface-variant text-xs font-bold">
                      <span className="material-symbols-outlined text-[14px]">family_restroom</span>
                      {kkList.length} KK Aktif
                    </span>
                  </div>
                </div>
                <div className="w-10 h-10 rounded-full bg-surface-container flex items-center justify-center text-primary">
                  <span className="material-symbols-outlined text-[22px]">group</span>
                </div>
              </div>
              <div className="mt-4">
                <div className="text-xl font-bold text-on-surface">{kkList.reduce((sum, kk) => sum + kk.anggota.length, 0)} Jiwa</div>
                <p className="text-xs text-on-surface-variant mt-1">
                  {kkList.map((kk) => kk.kepala).join(", ")}
                </p>
                <div className="mt-3">
                  <a className="text-xs font-bold text-primary inline-flex items-center gap-1 hover:underline" href="#data-keluarga" onClick={(e) => { e.preventDefault(); onNavigate?.("data-keluarga"); }}>
                    Lihat rincian data KK
                    <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
                  </a>
                </div>
              </div>
            </div>

            {/* KPI 4: Kas RT */}
            <div className="bg-surface-container-lowest rounded-xl p-4 shadow-sm relative overflow-hidden flex flex-col justify-between">
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">
                    Transparansi Kas RT
                  </span>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-secondary-fixed-dim/30 text-secondary text-xs font-bold">
                      <span className="material-symbols-outlined text-[14px]">health_and_safety</span>
                      Kondisi Sehat
                    </span>
                  </div>
                </div>
                <div className="w-10 h-10 rounded-full bg-surface-container flex items-center justify-center text-primary">
                  <span className="material-symbols-outlined text-[22px]">savings</span>
                </div>
              </div>
              <div className="mt-4">
                <div className="text-xl font-bold text-primary font-mono">{formatRupiah(saldoKas)}</div>
                <p className="text-xs text-on-surface-variant mt-1">
                  Kas umum warga {tenant.label}
                </p>
                <div className="mt-2 flex items-center justify-between text-[11px] text-on-surface-variant">
                  <span>Total Pemasukan</span>
                  <span className="font-mono font-semibold text-secondary">{formatRupiah(rekap.pemasukan)}</span>
                </div>
                <div className="flex items-center justify-between text-[11px] text-on-surface-variant">
                  <span>Total Pengeluaran</span>
                  <span className="font-mono font-semibold text-error">{formatRupiah(rekap.pengeluaran)}</span>
                </div>
                <div className="mt-2 flex items-center gap-2 text-[11px] text-on-surface-variant">
                  <span className="material-symbols-outlined text-[14px] text-secondary">update</span>
                  Update oleh Bendahara kemarin
                </div>
              </div>
            </div>
          </div>

          {/* Two-Column Layout */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left Column */}
            <div className="lg:col-span-8 flex flex-col gap-6">
              {/* Iuran & Tagihan */}
              <section className="bg-surface-container-lowest rounded-xl p-6 shadow-sm" id="area-iuran">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 mb-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-lg font-bold text-on-surface">Rincian Iuran Warga</h2>
                      <span className="px-2.5 py-0.5 rounded-full bg-surface-container text-[11px] font-bold text-on-surface-variant">
                        {deskripsiIuran(rincianKategori, kendaraanR4Count, " • ")}
                      </span>
                    </div>
                    <p className="text-xs text-on-surface-variant mt-1">
                      Kewajiban retribusi keamanan, kebersihan taman, dan kontribusi sosial
                      lingkungan {tenant.rtFull}.
                    </p>
                  </div>
                  <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-primary-fixed/30 text-on-primary-fixed-variant text-xs">
                    <span className="material-symbols-outlined text-[18px]">verified</span>
                    Total Iuran Bulanan:{" "}
                    <span className="font-mono font-bold">{formatRupiah(totalBulanan)}</span>
                  </div>
                </div>

                {/* Iuran Table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="bg-surface-container-low text-on-surface-variant text-xs">
                        <th className="py-3 px-4 rounded-l-lg">Kategori Tagihan</th>
                        <th className="py-3 px-4">Nominal Standar</th>
                        <th className="py-3 px-4">Penyesuaian</th>
                        <th className="py-3 px-4">Harus Dibayar</th>
                        <th className="py-3 px-4 rounded-r-lg text-right">Status Pelunasan</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y-0 text-sm">
                      {rincianKategori.map((k) => {
                        const nilai =
                          k.tipe === "per_unit"
                            ? k.nominal * Math.max(kendaraanR4Count, 0)
                            : k.nominal;
                        const badge = statusIuranBadge[statusIuran];
                        return (
                          <tr
                            key={k.id}
                            className={
                              statusIuran === "Lunas"
                                ? "hover:bg-surface-container-lowest transition-colors"
                                : "bg-error-container/10 transition-colors"
                            }
                          >
                            <td className="py-3.5 px-4">
                              <div className="font-bold flex items-center gap-2">
                                <span className="material-symbols-outlined text-primary text-[20px]">
                                  {kategoriIconById[k.id] ?? (k.tipe === "per_unit" ? "directions_car" : "receipt")}
                                </span>
                                {k.nama}
                              </div>
                              <div className="text-xs text-on-surface-variant">
                                {k.tipe === "per_unit"
                                  ? `${kendaraanR4Count} unit terdaftar`
                                  : "Iuran pokok bulanan"}
                              </div>
                            </td>
                            <td className="py-3.5 px-4 font-mono">{formatRupiah(k.nominal)}</td>
                            <td className="py-3.5 px-4 text-on-surface-variant font-mono">
                              {k.tipe === "per_unit" ? `× ${kendaraanR4Count} unit` : "-"}
                            </td>
                            <td className="py-3.5 px-4 font-mono font-bold">{formatRupiah(nilai)}</td>
                            <td className="py-3.5 px-4 text-right">
                              <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold ${badge.cls}`}>
                                <span className="material-symbols-outlined text-[14px]">{badge.icon}</span>
                                {badge.label}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Summary & Actions */}
                <div className="mt-4 p-4 bg-surface-container-low rounded-xl flex flex-col md:flex-row items-center justify-between gap-4">
                  <div className="w-full md:w-auto">
                    <span className="text-xs text-on-surface-variant block">
                      Total Tagihan Yang Harus Diselesaikan:
                    </span>
                    <div className="flex items-baseline gap-2">
                      <span className="text-xl font-extrabold text-on-surface font-mono">{formatRupiah(sisaTagihan)}</span>
                      {terbayar > 0 && (
                        <span className="text-xs text-primary font-semibold font-mono">
                          ({formatRupiah(terbayar)} tercatat)
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
                    <button
                      className="flex-1 md:flex-initial inline-flex items-center justify-center gap-2 px-5 py-3 min-h-[48px] rounded-lg bg-surface-container-lowest hover:bg-surface-container-high text-on-surface text-sm font-bold shadow-sm transition-all"
                      onClick={() => setShowUploadModal(true)}
                    >
                      <span className="material-symbols-outlined text-[20px]">upload_file</span>
                      Unggah Bukti Transfer
                    </button>
                    <button
                      className="flex-1 md:flex-initial inline-flex items-center justify-center gap-2 px-6 py-3 min-h-[48px] rounded-lg bg-primary hover:bg-primary-container text-on-primary text-sm font-bold shadow-md transition-all"
                      onClick={() => setShowQrisModal(true)}
                    >
                      <span className="material-symbols-outlined text-[20px]">qr_code_scanner</span>
                      Bayar Iuran (QRIS / Otomatis)
                    </button>
                  </div>
                </div>

                {/* Tagihan Tambahan dari Pengurus RT */}
                {tagihanWarga.length > 0 && (
                  <div className="mt-4 p-4 rounded-xl bg-surface-container-low border border-outline-variant/20">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-xs font-bold text-on-surface uppercase tracking-wider">
                        Tagihan Tambahan dari Pengurus RT
                      </span>
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-tertiary-container text-on-tertiary-container text-[10px] font-bold">
                        {tagihanWarga.filter((t) => t.status === "Belum").length} Belum Dibayar
                      </span>
                    </div>
                    <div className="space-y-2">
                      {tagihanWarga.map((t) => (
                        <div key={t.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-lg bg-surface-container-lowest">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-9 h-9 rounded-lg bg-tertiary-container text-on-tertiary-container flex items-center justify-center shrink-0">
                              <span className="material-symbols-outlined text-[18px]">{t.icon}</span>
                            </div>
                            <div className="min-w-0">
                              <div className="text-sm font-bold text-on-surface truncate">{t.nama}</div>
                              <div className="text-[11px] text-on-surface-variant">
                                REF: <span className="font-mono">{t.ref}</span> • Tempo: {t.tenggat}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-3 shrink-0">
                            <span className="text-sm font-extrabold text-on-surface font-mono">
                              {formatRupiah(t.sisa !== undefined && t.sisa > 0 ? t.sisa : t.nominal)}
                            </span>
                            {t.status === "Lunas" ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-secondary-container text-on-secondary-container text-[11px] font-bold">
                                <span className="material-symbols-outlined text-[14px]">check_circle</span>
                                LUNAS
                              </span>
                            ) : (
                              <button
                                className="h-9 px-4 rounded-lg bg-primary text-on-primary text-xs font-bold hover:bg-primary-container transition-all"
                                onClick={async () => {
                                  try {
                                    const dariServer = await onBayarTagihanTambahan(t);
                                    flash(
                                      dariServer
                                        ? `Pembayaran ${t.nama} diajukan — menunggu verifikasi pengurus RT.`
                                        : `Mode demo (server mati): pembayaran ${t.nama} dicatat lokal — status tetap "Menunggu Verifikasi".`,
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
                  </div>
                )}
              </section>

              {/* Layanan Surat */}
              <section className="bg-surface-container-lowest rounded-xl p-6 shadow-sm" id="surat-kilat">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 mb-4">
                  <div>
                    <h2 className="text-lg font-bold text-on-surface">Layanan Surat Pengantar Mandiri</h2>
                    <p className="text-xs text-on-surface-variant mt-1">
                      Pengurusan administrasi kependudukan cepat dengan Tanda Tangan Elektronik (TTE)
                      sah Ketua RT &amp; RW.
                    </p>
                  </div>
                  <button
                    className="inline-flex items-center justify-center gap-2 px-5 py-2.5 min-h-[44px] rounded-lg bg-primary-fixed text-on-primary-fixed hover:bg-primary-fixed-dim text-sm font-bold transition-all shadow-sm"
                    onClick={() => onNavigate?.("pengajuan-surat")}
                  >
                    <span className="material-symbols-outlined text-[20px]">add_circle</span>
                    + Ajukan Surat Baru
                  </button>
                </div>

                <div className="space-y-3">
                  {daftarSurat.map((s) => {
                    const badge = suratBadgeWarga[s.status];
                    const selesai = s.status === "Disetujui";
                    return (
                      <div key={s.id} className="p-4 rounded-xl bg-surface-container-low flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                        <div className="flex items-start gap-3">
                          <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${selesai ? "bg-secondary-container text-on-secondary-container" : "bg-surface-container text-on-surface-variant"}`}>
                            <span className="material-symbols-outlined text-[28px]">{selesai ? "description" : "pending_actions"}</span>
                          </div>
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="text-sm font-bold text-on-surface">{s.jenis}</h3>
                              <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full ${badge.cls}`}>
                                <span className="material-symbols-outlined text-[14px]">{badge.icon}</span>
                                {badge.label}
                              </span>
                            </div>
                            <div className="text-xs text-on-surface-variant mt-1 flex flex-wrap items-center gap-3">
                              <span className="font-mono text-on-surface font-semibold">
                                No: {s.noSurat || `REQ-${s.id.toUpperCase()}`}
                              </span>
                              <span>•</span>
                              <span>Diajukan: {s.tanggal}</span>
                              <span>•</span>
                              {selesai ? (
                                <span className="text-secondary font-semibold flex items-center gap-1">
                                  <span className="material-symbols-outlined text-[16px]">qr_code_2</span>
                                  TTE Valid
                                </span>
                              ) : (
                                <span className="text-primary font-semibold">{s.keperluan}</span>
                              )}
                            </div>
                          </div>
                        </div>
                        {selesai ? (
                          <button className="inline-flex items-center justify-center gap-2 px-4 py-2.5 min-h-[44px] rounded-lg bg-surface-container-lowest hover:bg-surface-container text-primary text-sm font-bold shadow-sm transition-all w-full md:w-auto shrink-0">
                            <span className="material-symbols-outlined text-[20px]">download</span>
                            Unduh PDF Resmi
                          </button>
                        ) : (
                          <button
                            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 min-h-[44px] rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface-variant text-sm font-medium transition-all w-full md:w-auto shrink-0"
                            onClick={() => onNavigate?.("pengajuan-surat")}
                          >
                            <span className="material-symbols-outlined text-[18px]">info</span>
                            Lacak Status
                          </button>
                        )}
                      </div>
                    );
                  })}
                  {daftarSurat.length === 0 && (
                    <div className="p-4 rounded-xl bg-surface-container-low">
                      <EmptyState
                        icon="note_add"
                        judul="Belum ada pengajuan surat"
                        pesan="Ajukan surat pengantar pertama untuk keperluan domisili, SKTM, atau keperluan lain."
                        aksi={{ label: "+ Ajukan Surat Baru", onClick: () => onNavigate?.("pengajuan-surat") }}
                        className="py-6 px-4"
                      />
                    </div>
                  )}
                </div>
              </section>
            </div>

            {/* Right Column */}
            <div className="lg:col-span-4 flex flex-col gap-6">
              {/* Kartu Keluarga */}
              <section className="bg-surface-container-lowest rounded-xl p-4 shadow-sm" id="data-keluarga">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-base font-bold text-on-surface">Kartu Keluarga (KK)</h2>
                  <span className="material-symbols-outlined text-primary text-[24px]">badge</span>
                </div>

                {kkList.map((kk) => (
                  <div key={kk.id} className="mb-3 last:mb-0">
                    <div className="bg-surface-container-low p-3 rounded-lg mb-3 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-outline text-[18px]">shield</span>
                        <span className="text-xs text-on-surface-variant">No. KK:</span>
                        <span className="font-mono font-bold text-on-surface text-sm">
                          {maskedNoKk(kk.noKk)}
                        </span>
                      </div>
                      <span className="text-[11px] text-primary font-bold">Resmi</span>
                    </div>

                    <div className="space-y-2 mb-4">
                      {kk.anggota.slice(0, 4).map((m) => (
                        <div key={m.name} className="p-2.5 rounded-lg bg-surface flex items-center justify-between">
                          <div className="flex items-center gap-2.5">
                            <div className={`w-8 h-8 rounded-full ${m.filter === "kepala" ? "bg-primary text-on-primary" : m.filter === "istri" ? "bg-secondary-container text-on-secondary-container" : "bg-surface-container-high text-on-surface"} flex items-center justify-center font-bold text-xs`}>
                              {m.initials}
                            </div>
                            <div>
                              <div className="text-sm font-bold text-on-surface">{m.name}</div>
                              <div className="text-[11px] text-on-surface-variant">{m.role} ({m.age} Thn)</div>
                            </div>
                          </div>
                          <span className="px-2 py-0.5 rounded bg-surface-container text-[11px] text-on-surface-variant font-semibold">
                            {m.filter === "kepala" ? "KK" : m.filter === "istri" ? "Istri" : "Anak"}
                          </span>
                        </div>
                      ))}
                      {kk.anggota.length > 4 && (
                        <div className="text-center text-[11px] text-on-surface-variant py-1">
                          +{kk.anggota.length - 4} anggota lainnya
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                <div className="grid grid-cols-1 gap-2">
                  <button
                    className="w-full inline-flex items-center justify-center gap-2 px-3 py-2.5 min-h-[44px] rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface text-xs font-bold transition-all"
                    onClick={() => onNavigate?.("data-keluarga")}
                  >
                    <span className="material-symbols-outlined text-[18px]">manage_accounts</span>
                    Perbarui Kontak / Foto Anggota
                  </button>
                  <button
                    className="w-full inline-flex items-center justify-center gap-2 px-3 py-2.5 min-h-[44px] rounded-lg bg-surface hover:bg-surface-container-low text-primary text-xs font-semibold transition-all"
                    onClick={() => onNavigate?.("data-keluarga")}
                  >
                    <span className="material-symbols-outlined text-[18px]">add_circle</span>
                    Tambah KK Baru
                  </button>
                </div>
              </section>

              {/* Pengurus RT — Batch 19: nama dari pengurus tercatat; tanpa baris
                  → catatan kosong (jujur). Tombol WA dihilangkan sementara:
                  sistem belum menyimpan nomor WA pengurus (tidak ada field `wa`),
                  sehingga tautan wa.me sebelumnya SELALU memakai nomor karangan. */}
              <section className="bg-surface-container-lowest rounded-xl p-4 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-base font-bold text-on-surface">Pengurus {tenant.rtFull} Siaga</h2>
                  <span className="inline-flex items-center gap-1 text-[11px] text-secondary font-bold">
                    <span className="w-2 h-2 rounded-full bg-secondary animate-pulse" />
                    Aktif
                  </span>
                </div>
                <p className="text-xs text-on-surface-variant mb-3">
                  Butuh bantuan mendesak atau konsultasi lingkungan? Hubungi pengurus RT
                  tercatat di bawah ini.
                </p>
                {pengurus.length === 0 ? (
                  <p className="text-xs text-on-surface-variant p-2 rounded-lg bg-surface">
                    Belum ada data pengurus RT — hubungi pengurus melalui grup WhatsApp
                    lingkungan Anda.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {ketuaRt && (
                      <div className="p-2 rounded-lg bg-surface flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-primary-fixed flex items-center justify-center text-primary font-bold text-xs">
                            {ketuaRt.initials}
                          </div>
                          <div>
                            <div className="text-sm font-bold text-on-surface">{ketuaRt.nama}</div>
                            <div className="text-[11px] text-on-surface-variant">Ketua {tenant.rtFull}</div>
                          </div>
                        </div>
                      </div>
                    )}
                    {bendahara && (
                      <div className="p-2 rounded-lg bg-surface flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-surface-container flex items-center justify-center text-on-surface font-bold text-xs">
                            {inisialBendahara}
                          </div>
                          <div>
                            <div className="text-sm font-bold text-on-surface">
                              {namaBendahara}
                            </div>
                            <div className="text-[11px] text-on-surface-variant">
                              Bendahara {tenant.rtFull}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                    {ketuaRt && !bendahara && (
                      <p className="text-[11px] text-on-surface-variant px-2">
                        Bendahara belum tercatat — konfirmasi iuran melalui Ketua RT.
                      </p>
                    )}
                  </div>
                )}
              </section>

              {/* Aktivitas Terakhir */}
              <section className="bg-surface-container-lowest rounded-xl p-4 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-base font-bold text-on-surface">Aktivitas Terakhir</h2>
                  <button type="button" className="text-xs text-primary font-bold hover:underline" onClick={() => onNavigate?.("riwayat-aktivitas")}>
                    Semua
                  </button>
                </div>
                <div className="relative pl-6 space-y-4 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-surface-container">
                  <div className="relative">
                    <div className="absolute -left-6 top-1 w-3.5 h-3.5 rounded-full bg-primary border-2 border-surface-container-lowest" />
                    <div className="text-xs font-bold text-on-surface">Surat Domisili Disahkan</div>
                    <p className="text-xs text-on-surface-variant">
                      Telah ditandatangani secara digital oleh Ketua {tenant.rtFull}.
                    </p>
                    <span className="text-[11px] text-outline mt-0.5 block">
                      10 Oktober 2026, 14:15 WIB
                    </span>
                  </div>
                  <div className="relative">
                    <div className="absolute -left-6 top-1 w-3.5 h-3.5 rounded-full bg-secondary border-2 border-surface-container-lowest" />
                    <div className="text-xs font-bold text-on-surface">
                      Iuran Keamanan Terverifikasi
                    </div>
                    <p className="text-xs text-on-surface-variant">
                      {pembayaranSaya[0]
                        ? `Pembayaran ${formatRupiah(pembayaranSaya[0].jumlah)} ${
                            pembayaranSaya[0].status === "Lunas" ? "sukses" : "diajukan"
                          } via ${pembayaranSaya[0].metode} (${pembayaranSaya[0].status}).`
                        : `Total iuran bulanan ${formatRupiah(totalBulanan)} menunggu konfirmasi Bendahara RT.`}
                    </p>
                    <span className="text-[11px] text-outline mt-0.5 block">
                      05 Oktober 2026, 09:20 WIB
                    </span>
                  </div>
                  <div className="relative">
                    <div className="absolute -left-6 top-1 w-3.5 h-3.5 rounded-full bg-surface-container-highest border-2 border-surface-container-lowest" />
                    <div className="text-xs font-bold text-on-surface">
                      Pembaruan Kontak Keluarga
                    </div>
                    <p className="text-xs text-on-surface-variant">
                      Nomor telepon WhatsApp Ibu Siti Rahmawati berhasil diperbarui.
                    </p>
                    <span className="text-[11px] text-outline mt-0.5 block">
                      28 September 2026, 19:40 WIB
                    </span>
                  </div>
                </div>
              </section>
            </div>
          </div>
        </div>

      {/* Modal: QRIS */}
      {showQrisModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-inverse-surface/40 backdrop-blur-sm p-4">
          <div className="bg-surface-container-lowest rounded-xl max-w-md w-full p-6 shadow-xl relative">
            <div className="flex items-center justify-between pb-3 mb-3">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[24px]">qr_code_scanner</span>
                <h3 className="text-base font-bold text-on-surface">Pembayaran Instan QRIS</h3>
              </div>
              <button className="p-1 rounded-full text-on-surface-variant hover:bg-surface-container" onClick={() => setShowQrisModal(false)}>
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="text-center space-y-2">
              <p className="text-xs text-on-surface-variant">
                Pindai kode QRIS menggunakan GoPay, OVO, Dana, BCA, Mandiri, atau aplikasi perbankan
                Anda.
              </p>
              <div className="p-4 bg-surface-container rounded-xl inline-block mx-auto my-2">
                <svg className="w-48 h-48 mx-auto text-primary" fill="currentColor" viewBox="0 0 100 100">
                  <path d="M0,0 h30 v30 h-30 z M5,5 v20 h20 v-20 z M10,10 h10 v10 h-10 z" />
                  <path d="M70,0 h30 v30 h-30 z M75,5 v20 h20 v-20 z M80,10 h10 v10 h-10 z" />
                  <path d="M0,70 h30 v30 h-30 z M5,75 v20 h20 v-20 z M10,80 h10 v10 h-10 z" />
                  <rect height="8" width="8" x="35" y="5" />
                  <rect height="6" width="12" x="50" y="5" />
                  <rect height="6" width="22" x="38" y="18" />
                  <rect height="16" width="16" x="42" y="36" />
                  <rect height="8" width="12" x="5" y="38" />
                  <rect height="18" width="10" x="22" y="42" />
                  <rect height="6" width="24" x="70" y="38" />
                  <rect height="14" width="14" x="78" y="52" />
                  <rect height="24" width="12" x="40" y="68" />
                  <rect height="8" width="34" x="58" y="70" />
                  <rect height="8" width="24" x="68" y="86" />
                </svg>
                <div className="text-[11px] font-bold text-primary tracking-wider mt-2">
                  NMID: ID1020240988771
                </div>
              </div>
              <div className="bg-surface-container-low p-3 rounded-lg text-left">
                <div className="flex justify-between text-xs">
                  <span className="text-on-surface-variant">Total Tagihan:</span>
                  <span className="font-bold text-on-surface font-mono">{formatRupiah(sisaTagihan)}</span>
                </div>
                <div className="flex justify-between text-[11px] text-on-surface-variant mt-1">
                  <span>Penerima:</span>
                  <span className="font-semibold text-primary">KAS {tenant.rtFull} {tenant.perumahanSingkat}</span>
                </div>
              </div>
              <button
                className="w-full py-3 rounded-lg bg-primary hover:bg-primary-container text-on-primary text-sm font-bold min-h-[44px]"
                onClick={() => {
                  flash("Simulasi: Bukti pembayaran berhasil diperiksa dan diverifikasi secara otomatis");
                  setShowQrisModal(false);
                }}
              >
                Saya Sudah Membayar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Upload Transfer */}
      {showUploadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-inverse-surface/40 backdrop-blur-sm p-4">
          <div className="bg-surface-container-lowest rounded-xl max-w-lg w-full p-6 shadow-xl relative">
            <div className="flex items-center justify-between pb-3 mb-3">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[24px]">receipt_long</span>
                <h3 className="text-base font-bold text-on-surface">Unggah Bukti Transfer</h3>
              </div>
              <button className="p-1 rounded-full text-on-surface-variant hover:bg-surface-container" onClick={() => setShowUploadModal(false)}>
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); flash(`Simulasi: bukti transfer TIDAK dikirim — gunakan menu Iuran Tagihan untuk unggah bukti asli ke Bendahara ${namaBendahara}.`); setShowUploadModal(false); }}>
              <div>
                <label className="block text-xs font-semibold text-on-surface mb-1">Rekening Tujuan RT</label>
                <div className="p-3 bg-surface-container-low rounded-lg flex items-center justify-between">
                  <div>
                    <div className="text-sm font-bold text-on-surface">Bank BCA: 8830-192-441</div>
                    <div className="text-xs text-on-surface-variant">
                      a.n {namaBendahara} (Bendahara {tenant.rtFull})
                    </div>
                  </div>
                  <button className="text-primary text-xs font-bold px-2.5 py-1 bg-surface-container-lowest rounded hover:bg-surface-container" type="button">
                    Salin
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-on-surface mb-1">
                  Nominal Yang Ditransfer
                </label>
                <input
                  className="w-full px-4 py-2.5 rounded-lg bg-surface border-0 text-on-surface font-mono font-bold focus:outline-none focus:bg-surface-container-lowest"
                  readOnly
                  type="text"
                  value={formatRupiah(sisaTagihan)}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-on-surface mb-1">
                  Pilih File Foto Struk / Screenshot
                </label>
                <div className="p-6 bg-surface-container-low rounded-xl text-center cursor-pointer hover:bg-surface-container transition-colors">
                  <span className="material-symbols-outlined text-primary text-[36px]">cloud_upload</span>
                  <p className="text-xs font-bold text-on-surface mt-1">
                    Ketuk untuk memilih foto atau seret ke sini
                  </p>
                  <p className="text-xs text-on-surface-variant mt-0.5">
                    Format JPG, PNG, atau PDF (Maks. 5MB)
                  </p>
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  className="flex-1 py-2.5 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface text-sm font-semibold min-h-[44px]"
                  type="button"
                  onClick={() => setShowUploadModal(false)}
                >
                  Batal
                </button>
                <button className="flex-1 py-2.5 rounded-lg bg-primary hover:bg-primary-container text-on-primary text-sm font-bold min-h-[44px]" type="submit">
                  Kirim Bukti
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Toast sukses — pengganti alert() agar tidak memblokir alur warga. */}
      {toast}
    </>
  );
}
