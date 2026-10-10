import { tenant } from "../../lib/tenant";
import {
  Surat,
  PermintaanAkses,
  KasRw,
  RtAgregat,
  rtAgregatDefault,
  trenPenduduk,
  formatRupiah,
} from "../../lib/shared";
import { EmptyState } from "../../components/EmptyState";
import { useFlash } from "../../lib/useFlash";

interface DashboardRWProps {
  onNavigate?: (page: string) => void;
  surat: Surat[];
  akses: PermintaanAkses[];
  kasRw: KasRw[];
  /**
   * Batch 20 · baris agregat per RT dari `GET /rw/agregat/*`; `null` =
   * OFFLINE/mode demo (baris contoh + banner), `[]` = daring kosong.
   */
  rtAgregat?: RtAgregat[] | null;
  /** Muat ulang agregat dari server (tombol "Perbarui Data"). */
  onMuatData?: () => void;
}

export function DashboardRW({ onNavigate, surat, akses, kasRw, rtAgregat = null, onMuatData }: DashboardRWProps) {
  const { flash, toast } = useFlash();


  // — Agregat lintas-RT (§7.1): hanya data agregat, tanpa detail individu warga —
  // Batch 20 · baris SERVER bila termuat; OFFLINE (null) → baris contoh.
  const rows = rtAgregat === null ? rtAgregatDefault : rtAgregat;
  const totalWarga = rows.reduce((sum, r) => sum + r.warga, 0);
  const totalKk = rows.reduce((sum, r) => sum + r.kk, 0);
  const totalRumah = rows.reduce((sum, r) => sum + r.totalRumah, 0);
  const hunianTerisi = rows.reduce((sum, r) => sum + r.hunian, 0);
  const jumlahRt = rows.length;
  const persenHunian = totalRumah > 0 ? Math.round((hunianTerisi / totalRumah) * 1000) / 10 : 0;
  // Batch 20 · baris server belum membawa rekap iuran (Batch 21) → kolom
  // kepatuhan tampil "—" (bukan 0% yang menyamar sebagai data riil).
  const iuranTersedia = rows.some((r) => r.iuranTersedia !== false);

  const suratMenungguRw = surat.filter((s) => s.perluRw && s.status === "Menunggu RW").length;
  const aksesMenunggu = akses.filter((a) => a.status === "Menunggu").length;
  const saldoRw = kasRw[kasRw.length - 1]?.saldo ?? 0;

  // — Tren pertumbuhan warga: delta persen Apr → Sep —
  const trenAwal = trenPenduduk[0]?.warga ?? 0;
  const trenAkhir = trenPenduduk[trenPenduduk.length - 1]?.warga ?? 0;
  const deltaPersen = trenAwal > 0 ? ((trenAkhir - trenAwal) / trenAwal) * 100 : 0;
  const maxTren = Math.max(...trenPenduduk.map((t) => t.warga));
  const minTren = Math.min(...trenPenduduk.map((t) => t.warga));
  const rentangTren = Math.max(maxTren - minTren, 1);

  return (
    <div className="max-w-7xl mx-auto w-full space-y-6">
      {/* Toast */}
      {toast}

      {/* 1. Breadcrumb & Judul */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <nav className="flex items-center gap-1.5 text-sm text-on-surface-variant">
          <button
            className="p-1 rounded-lg hover:bg-surface-container-high transition-colors"
            aria-label="Beranda"
            onClick={() => onNavigate?.("dashboard-rw")}
          >
            <span className="material-symbols-outlined text-[18px]">home</span>
          </button>
          <span className="material-symbols-outlined text-[16px]">chevron_right</span>
          <span className="font-bold text-on-surface">Dashboard RW</span>
        </nav>
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-secondary-container/40 text-on-secondary-container text-xs font-semibold">
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-secondary opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-secondary" />
          </span>
          Agregat {jumlahRt} RT &bull; {tenant.rwFull} &bull; Sinkron Aktif
        </div>
      </div>

      {/* 2. Header Judul */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl lg:text-3xl font-extrabold tracking-tight text-on-surface">Dashboard RW</h1>
          <p className="text-sm text-on-surface-variant mt-1 max-w-2xl">
            Ringkasan agregat warga &amp; hunian lintas-RT di {tenant.rwFull}, Kelurahan {tenant.kelurahan} —
            ditampilkan dalam bentuk rekapitulasi per RT tanpa detail individu.
          </p>
        </div>
        <button
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 min-h-[44px] rounded-xl bg-surface-container-lowest border border-surface-container-high text-on-surface text-sm font-bold shadow-sm hover:bg-surface-container-high transition-all shrink-0"
          onClick={() => {
            onMuatData?.();
            flash(
              rtAgregat === null
                ? "Mode demo — data agregat dimuat ulang dari server bila tersedia."
                : "Memuat ulang agregat kependudukan & hunian dari server…",
            );
          }}
        >
          <span className="material-symbols-outlined text-[18px]">sync</span>
          Perbarui Data
        </button>
      </div>

      {/* 3. Banner Catatan Privasi */}
      <div className="flex items-start gap-3 p-4 rounded-xl bg-primary-container/30 border border-primary/15">
        <div className="w-10 h-10 rounded-lg bg-primary flex items-center justify-center shrink-0">
          <span className="material-symbols-outlined text-on-primary text-[22px]">lock</span>
        </div>
        <div className="min-w-0">
          <div className="text-sm font-bold text-on-surface">Tampilan Agregat Saja</div>
          <p className="text-xs text-on-surface-variant mt-1 leading-relaxed">
            Dashboard ini hanya menampilkan data agregat kependudukan &amp; hunian per RT. Detail individu warga
            (nama, NIK, kontak) tidak ditampilkan di tingkat RW — akses detail memerlukan persetujuan RT melalui
            alur Akses Detail Warga dan seluruh akses tercatat pada audit log (UU No. 27 Tahun 2022 PDP).
          </p>
        </div>
      </div>

      {/* 4. KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* KPI 1: Total Warga */}
        <div className="bg-surface-container-lowest rounded-xl p-5 shadow-sm flex flex-col justify-between">
          <div className="flex items-start justify-between">
            <span className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">Total Warga</span>
            <div className="w-10 h-10 rounded-full bg-primary-container flex items-center justify-center text-on-primary-container">
              <span className="material-symbols-outlined text-[22px]">groups</span>
            </div>
          </div>
          <div className="mt-4">
            <div className="text-2xl font-extrabold text-on-surface font-mono">{totalWarga.toLocaleString("id-ID")}</div>
            <div className="text-xs text-on-surface-variant mt-1">Jiwa &bull; lintas {jumlahRt} RT</div>
          </div>
        </div>

        {/* KPI 2: Total KK */}
        <div className="bg-surface-container-lowest rounded-xl p-5 shadow-sm flex flex-col justify-between">
          <div className="flex items-start justify-between">
            <span className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">Total KK</span>
            <div className="w-10 h-10 rounded-full bg-primary-container flex items-center justify-center text-on-primary-container">
              <span className="material-symbols-outlined text-[22px]">home</span>
            </div>
          </div>
          <div className="mt-4">
            <div className="text-2xl font-extrabold text-on-surface font-mono">{totalKk.toLocaleString("id-ID")}</div>
            <div className="text-xs text-on-surface-variant mt-1">Kepala keluarga terdaftar</div>
          </div>
        </div>

        {/* KPI 3: Hunian Terisi */}
        <div className="bg-surface-container-lowest rounded-xl p-5 shadow-sm flex flex-col justify-between">
          <div className="flex items-start justify-between">
            <span className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">Hunian Terisi</span>
            <div className="w-10 h-10 rounded-full bg-primary-container flex items-center justify-center text-on-primary-container">
              <span className="material-symbols-outlined text-[22px]">apartment</span>
            </div>
          </div>
          <div className="mt-4">
            <div className="text-2xl font-extrabold text-on-surface font-mono">
              {hunianTerisi.toLocaleString("id-ID")} <span className="text-base font-bold text-on-surface-variant">/ {totalRumah.toLocaleString("id-ID")}</span>
            </div>
            <div className="w-full bg-surface-container-high h-2 rounded-full overflow-hidden mt-3">
              <div className="bg-primary h-full rounded-full" style={{ width: `${persenHunian}%` }} />
            </div>
            <div className="text-[11px] text-on-surface-variant mt-2 font-mono">{persenHunian}% unit rumah terisi</div>
          </div>
        </div>

        {/* KPI 4: RT Terdaftar */}
        <div className="bg-surface-container-lowest rounded-xl p-5 shadow-sm flex flex-col justify-between">
          <div className="flex items-start justify-between">
            <span className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">RT Terdaftar</span>
            <div className="w-10 h-10 rounded-full bg-primary-container flex items-center justify-center text-on-primary-container">
              <span className="material-symbols-outlined text-[22px]">location_city</span>
            </div>
          </div>
          <div className="mt-4">
            <div className="text-2xl font-extrabold text-on-surface font-mono">{jumlahRt}</div>
            <div className="inline-flex items-center gap-1 mt-2 px-2.5 py-0.5 rounded-full bg-secondary-container text-on-secondary-container text-[11px] font-bold">
              <span className="material-symbols-outlined text-[14px]">check_circle</span>
              Semua Aktif &bull; {tenant.rwFull}
            </div>
          </div>
        </div>
      </div>

      {/* 5. KPI tambahan: Antrian Surat Menunggu RW */}
      <div className="bg-surface-container-lowest rounded-xl p-5 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-secondary-container flex items-center justify-center text-on-secondary-container shrink-0">
            <span className="material-symbols-outlined text-[26px]">mark_email_read</span>
          </div>
          <div>
            <div className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">Antrian Surat Menunggu RW</div>
            <div className="mt-1">
              <span className="text-2xl font-extrabold text-on-surface font-mono">{suratMenungguRw}</span>
              <span className="text-sm font-bold text-on-surface-variant ml-2">surat menunggu persetujuan tingkat RW</span>
            </div>
          </div>
        </div>
        <button
          className="inline-flex items-center justify-center gap-2 px-5 py-2.5 min-h-[44px] rounded-xl bg-primary hover:bg-primary-container text-on-primary text-sm font-bold transition-all shrink-0"
          onClick={() => onNavigate?.("surat-rw")}
        >
          <span className="material-symbols-outlined text-[18px]">verified</span>
          Proses Sekarang
        </button>
      </div>

      {/* 6. Baris Antrian / Action */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Surat menunggu RW */}
        <button
          type="button"
          className="group flex items-center justify-between gap-4 p-5 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high hover:border-primary hover:shadow-md transition-all text-left w-full"
          onClick={() => onNavigate?.("surat-rw")}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-lg bg-secondary-container flex items-center justify-center text-on-secondary-container shrink-0">
              <span className="material-symbols-outlined text-[22px]">pending_actions</span>
            </div>
            <div className="min-w-0">
              <div className="text-sm font-bold text-on-surface">Surat menunggu RW</div>
              <div className="text-xs text-on-surface-variant">
                <span className="font-mono font-extrabold text-on-surface">{suratMenungguRw}</span> berkas perlu verifikasi
              </div>
            </div>
          </div>
          <span className="material-symbols-outlined text-on-surface-variant group-hover:text-primary group-hover:translate-x-0.5 transition-all">
            arrow_forward
          </span>
        </button>

        {/* Permintaan akses menunggu */}
        <button
          type="button"
          className="group flex items-center justify-between gap-4 p-5 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high hover:border-primary hover:shadow-md transition-all text-left w-full"
          onClick={() => onNavigate?.("akses-rw")}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-lg bg-tertiary-container flex items-center justify-center text-on-tertiary-container shrink-0">
              <span className="material-symbols-outlined text-[22px]">key</span>
            </div>
            <div className="min-w-0">
              <div className="text-sm font-bold text-on-surface">Permintaan akses menunggu</div>
              <div className="text-xs text-on-surface-variant">
                <span className="font-mono font-extrabold text-on-surface">{aksesMenunggu}</span> permohonan akses detail warga
              </div>
            </div>
          </div>
          <span className="material-symbols-outlined text-on-surface-variant group-hover:text-primary group-hover:translate-x-0.5 transition-all">
            arrow_forward
          </span>
        </button>

        {/* Saldo Kas RW */}
        <button
          type="button"
          className="group flex items-center justify-between gap-4 p-5 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high hover:border-primary hover:shadow-md transition-all text-left w-full sm:col-span-2 lg:col-span-1"
          onClick={() => onNavigate?.("kas-rw")}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-lg bg-primary-container flex items-center justify-center text-on-primary-container shrink-0">
              <span className="material-symbols-outlined text-[22px]">account_balance_wallet</span>
            </div>
            <div className="min-w-0">
              <div className="text-sm font-bold text-on-surface">Saldo Kas RW</div>
              <div className="text-xs text-secondary font-extrabold font-mono">{formatRupiah(saldoRw)}</div>
            </div>
          </div>
          <span className="material-symbols-outlined text-on-surface-variant group-hover:text-primary group-hover:translate-x-0.5 transition-all">
            arrow_forward
          </span>
        </button>
      </div>

      {/* 7. Grid: Tabel Rekap + Chart Tren */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Tabel Rekapitulasi per RT */}
        <section className="lg:col-span-7 bg-surface-container-lowest rounded-xl p-6 shadow-sm">
          <div className="flex items-center justify-between pb-4 mb-4 border-b border-surface-container-high">
            <div>
              <h2 className="text-lg font-bold text-on-surface">Rekapitulasi per RT</h2>
              <p className="text-xs text-on-surface-variant mt-0.5">
                Data agregat kependudukan, hunian &amp; kepatuhan iuran — tanpa kolom nama/NIK individu
              </p>
            </div>
            <span className="material-symbols-outlined text-primary text-[24px]">table_chart</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-on-surface-variant border-b border-surface-container-high">
                  <th className="py-2.5 pr-3 font-bold">RT</th>
                  <th className="py-2.5 px-3 font-bold text-right">KK</th>
                  <th className="py-2.5 px-3 font-bold text-right">Warga</th>
                  <th className="py-2.5 px-3 font-bold text-right">Rumah</th>
                  <th className="py-2.5 px-3 font-bold text-right">Hunian</th>
                  <th className="py-2.5 pl-3 font-bold w-44">Kepatuhan Iuran</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.rt} className="border-b border-surface-container-high last:border-0 hover:bg-surface-container-low transition-colors">
                    <td className="py-3 pr-3 font-bold text-on-surface">{r.rt}</td>
                    <td className="py-3 px-3 text-right font-mono text-on-surface">{r.kk.toLocaleString("id-ID")}</td>
                    <td className="py-3 px-3 text-right font-mono text-on-surface">{r.warga.toLocaleString("id-ID")}</td>
                    <td className="py-3 px-3 text-right font-mono text-on-surface">{r.totalRumah.toLocaleString("id-ID")}</td>
                    <td className="py-3 px-3 text-right font-mono text-on-surface">
                      {r.hunian.toLocaleString("id-ID")}
                      <span className="text-[11px] text-on-surface-variant">/{r.totalRumah.toLocaleString("id-ID")}</span>
                    </td>
                    <td className="py-3 pl-3">
                      {r.iuranTersedia === false ? (
                        <span className="text-xs text-on-surface-variant">— rekap menyusul</span>
                      ) : (
                        <div className="flex items-center gap-2">
                          <div className="flex-1 bg-surface-container-high h-2 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${r.kepatuhan >= 90 ? "bg-primary" : r.kepatuhan >= 85 ? "bg-tertiary" : "bg-error"}`}
                              style={{ width: `${r.kepatuhan}%` }}
                            />
                          </div>
                          <span className="text-xs font-extrabold font-mono text-on-surface w-12 text-right">{r.kepatuhan.toFixed(1)}%</span>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-surface-container-high font-bold text-on-surface">
                  <td className="py-3 pr-3 text-xs uppercase tracking-wider">Total</td>
                  <td className="py-3 px-3 text-right font-mono">{totalKk.toLocaleString("id-ID")}</td>
                  <td className="py-3 px-3 text-right font-mono">{totalWarga.toLocaleString("id-ID")}</td>
                  <td className="py-3 px-3 text-right font-mono">{totalRumah.toLocaleString("id-ID")}</td>
                  <td className="py-3 px-3 text-right font-mono">
                    {hunianTerisi.toLocaleString("id-ID")}
                    <span className="text-[11px] text-on-surface-variant">/{totalRumah.toLocaleString("id-ID")}</span>
                  </td>
                  <td className="py-3 pl-3 text-xs text-on-surface-variant">{iuranTersedia ? "Rata-rata per RT" : "Rekap iuran menyusul"}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          {rows.length === 0 && (
            <EmptyState
              icon="location_city"
              judul="Belum ada RT terdaftar"
              pesan="Agregat kependudukan tampil setelah ada RT terdaftar di bawah RW Anda."
            />
          )}
        </section>

        {/* Chart Tren Pertumbuhan Warga */}
        <section className="lg:col-span-5 bg-surface-container-lowest rounded-xl p-6 shadow-sm">
          <div className="flex items-center justify-between pb-4 mb-4 border-b border-surface-container-high">
            <div>
              <h2 className="text-lg font-bold text-on-surface">Tren Pertumbuhan Warga</h2>
              <p className="text-xs text-on-surface-variant mt-0.5">
                {rtAgregat !== null ? "Rekap berkala per bulan" : "6 bulan terakhir"} &bull; agregat seluruh RT
              </p>
            </div>
            <span className="material-symbols-outlined text-primary text-[24px]">monitoring</span>
          </div>

          {rtAgregat !== null ? (
            <EmptyState
              icon="monitoring"
              judul="Riwayat kependudukan belum tersedia"
              pesan="Grafik tren memerlukan rekap kependudukan berkala per bulan — belum tersedia pada sistem. Rekapitulasi terkini per RT tetap tampil pada tabel di samping."
            />
          ) : (
            <>
              <div className="overflow-x-auto">
                <div className="flex items-end gap-3 h-40 min-w-[280px]">
                  {trenPenduduk.map((t) => {
                    // Skala 0–100% berdasarkan rentang data agar perubahan terlihat.
                    const heightPct = 35 + ((t.warga - minTren) / rentangTren) * 65;
                    const isLast = t.bulan === trenPenduduk[trenPenduduk.length - 1].bulan;
                    return (
                      <div key={t.bulan} className="flex-1 flex flex-col items-center justify-end h-full gap-1.5">
                        <span className={`text-[11px] font-bold font-mono ${isLast ? "text-primary" : "text-on-surface-variant"}`}>
                          {t.warga.toLocaleString("id-ID")}
                        </span>
                        <div
                          className={`w-full rounded-t-lg ${isLast ? "bg-primary" : "bg-primary/45"}`}
                          style={{ height: `${heightPct}%` }}
                        />
                        <span className="text-[11px] font-semibold text-on-surface-variant">{t.bulan}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="mt-4 pt-4 border-t border-surface-container-high flex items-center justify-between gap-4">
                <div>
                  <div className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider">Delta Apr → Sep</div>
                  <div className="text-lg font-extrabold text-secondary font-mono mt-0.5">
                    +{deltaPersen.toFixed(1)}%
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider">Pertambahan</div>
                  <div className="text-lg font-extrabold text-on-surface font-mono mt-0.5">
                    +{(trenAkhir - trenAwal).toLocaleString("id-ID")} jiwa
                  </div>
                </div>
              </div>
              <p className="text-[11px] text-on-surface-variant mt-3">
                Sumber: rekapitulasi agregat {trenPenduduk[0].bulan}–{trenPenduduk[trenPenduduk.length - 1].bulan} dari seluruh RT di {tenant.rwFull}.
              </p>
            </>
          )}
        </section>
      </div>

      {/* 8. Quick Actions */}
      <section className="bg-surface-container-lowest rounded-xl p-6 shadow-sm">
        <div className="flex items-center justify-between pb-4 mb-4 border-b border-surface-container-high">
          <div>
            <h2 className="text-lg font-bold text-on-surface">Akses Cepat</h2>
            <p className="text-xs text-on-surface-variant mt-0.5">Menu utama Pengurus {tenant.rwFull}</p>
          </div>
          <span className="material-symbols-outlined text-primary text-[24px]">bolt</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <button
            type="button"
            className="group flex items-center gap-3 p-4 rounded-xl bg-surface-container-low hover:bg-primary-container hover:text-on-primary-container transition-all text-left w-full"
            onClick={() => onNavigate?.("iuran-rw")}
          >
            <div className="w-10 h-10 rounded-lg bg-primary-container group-hover:bg-primary group-hover:text-on-primary flex items-center justify-center text-on-primary-container shrink-0">
              <span className="material-symbols-outlined text-[22px]">payments</span>
            </div>
            <div className="min-w-0">
              <div className="text-sm font-bold text-on-surface group-hover:text-on-primary-container">Rekap Iuran</div>
              <div className="text-[11px] text-on-surface-variant group-hover:text-on-primary-container/80">Rekapitulasi lintas-RT</div>
            </div>
          </button>

          <button
            type="button"
            className="group flex items-center gap-3 p-4 rounded-xl bg-surface-container-low hover:bg-primary-container hover:text-on-primary-container transition-all text-left w-full"
            onClick={() => onNavigate?.("kas-rw")}
          >
            <div className="w-10 h-10 rounded-lg bg-primary-container group-hover:bg-primary group-hover:text-on-primary flex items-center justify-center text-on-primary-container shrink-0">
              <span className="material-symbols-outlined text-[22px]">account_balance_wallet</span>
            </div>
            <div className="min-w-0">
              <div className="text-sm font-bold text-on-surface group-hover:text-on-primary-container">Kas RW</div>
              <div className="text-[11px] text-on-surface-variant group-hover:text-on-primary-container/80 font-mono">{formatRupiah(saldoRw)}</div>
            </div>
          </button>

          <button
            type="button"
            className="group flex items-center gap-3 p-4 rounded-xl bg-surface-container-low hover:bg-primary-container hover:text-on-primary-container transition-all text-left w-full"
            onClick={() => onNavigate?.("surat-rw")}
          >
            <div className="w-10 h-10 rounded-lg bg-primary-container group-hover:bg-primary group-hover:text-on-primary flex items-center justify-center text-on-primary-container shrink-0">
              <span className="material-symbols-outlined text-[22px]">mark_email_read</span>
            </div>
            <div className="min-w-0">
              <div className="text-sm font-bold text-on-surface group-hover:text-on-primary-container">Verifikasi Surat</div>
              <div className="text-[11px] text-on-surface-variant group-hover:text-on-primary-container/80">
                <span className="font-mono font-bold">{suratMenungguRw}</span> menunggu RW
              </div>
            </div>
          </button>

          <button
            type="button"
            className="group flex items-center gap-3 p-4 rounded-xl bg-surface-container-low hover:bg-primary-container hover:text-on-primary-container transition-all text-left w-full"
            onClick={() => onNavigate?.("laporan-rw")}
          >
            <div className="w-10 h-10 rounded-lg bg-primary-container group-hover:bg-primary group-hover:text-on-primary flex items-center justify-center text-on-primary-container shrink-0">
              <span className="material-symbols-outlined text-[22px]">summarize</span>
            </div>
            <div className="min-w-0">
              <div className="text-sm font-bold text-on-surface group-hover:text-on-primary-container">Laporan</div>
              <div className="text-[11px] text-on-surface-variant group-hover:text-on-primary-container/80">Ekspor ringkasan RW</div>
            </div>
          </button>
        </div>
      </section>
    </div>
  );
}
