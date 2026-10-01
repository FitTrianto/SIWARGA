import { useState } from "react";
import { tenant } from "../../lib/tenant";
import {
  KasRw,
  RtAgregat,
  rtAgregatDefault,
  formatRupiah,
  downloadText,
} from "../../lib/shared";
import { EmptyState } from "../../components/EmptyState";
import { useFlash } from "../../lib/useFlash";

interface LaporanRWProps {
  onNavigate?: (page: string) => void;
  kasRw: KasRw[];
}

const BULAN = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

const TAHUN = ["2025", "2026", "2027"];

/**
 * §7.7 — Laporan agregat lintas-RT untuk pelaporan Kelurahan/Kecamatan.
 * Seluruh data disajikan dalam bentuk agregat per RT (§6.4.10, §4.3).
 */
export function LaporanRW({ onNavigate, kasRw }: LaporanRWProps) {
  const [bulan, setBulan] = useState("September");
  const [tahun, setTahun] = useState("2026");
  const { flash, toast } = useFlash();


  const periode = `${bulan} ${tahun}`;
  const rows: RtAgregat[] = rtAgregatDefault;

  // — Section A: Kependudukan —
  const totalKk = rows.reduce((s, r) => s + r.kk, 0);
  const totalWarga = rows.reduce((s, r) => s + r.warga, 0);
  const totalRumah = rows.reduce((s, r) => s + r.totalRumah, 0);
  const totalHunian = rows.reduce((s, r) => s + r.hunian, 0);

  // — Section B: Iuran (agregat) —
  const rataKepatuhan = rows.reduce((s, r) => s + r.kepatuhan, 0) / rows.length;
  const totalTerkumpul = rows.reduce((s, r) => s + r.terkumpul, 0);
  const totalSubsidiJumlah = rows.reduce((s, r) => s + r.subsidiJumlah, 0);
  const totalSubsidiNominal = rows.reduce((s, r) => s + r.subsidiNominal, 0);
  const totalTunggakan = rows.reduce((s, r) => s + r.tunggakan, 0);

  // — Section C: Kas RW —
  const totalPemasukan = kasRw
    .filter((k) => k.tipe === "Pemasukan")
    .reduce((s, k) => s + k.nominal, 0);
  const totalPengeluaran = kasRw
    .filter((k) => k.tipe === "Pengeluaran")
    .reduce((s, k) => s + k.nominal, 0);
  const saldoAkhir = kasRw.length > 0 ? kasRw[kasRw.length - 1].saldo : 0;
  const jumlahTransaksi = kasRw.length;

  function handleUnduhCsv() {
    const lines: string[] = [];
    lines.push(`LAPORAN AGREGAT LINTAS-RT — ${tenant.rwFull} ${tenant.perumahan.toUpperCase()}`);
    lines.push(`Kel. ${tenant.kelurahan}, Kec. ${tenant.kecamatan}, ${tenant.kota}`);
    lines.push(`Periode: ${periode}`);
    lines.push("Format siap dikirim ke Kelurahan/Kecamatan.");
    lines.push("");
    lines.push("BAGIAN A — KEPENDUDUKAN (AGREGAT PER RT)");
    lines.push("RT,KK,Warga,Rumah,Hunian");
    rows.forEach((r) => lines.push(`${r.rt},${r.kk},${r.warga},${r.totalRumah},${r.hunian}`));
    lines.push(`TOTAL,${totalKk},${totalWarga},${totalRumah},${totalHunian}`);
    lines.push("");
    lines.push("BAGIAN B — IURAN (AGREGAT PER RT)");
    lines.push("RT,Kepatuhan (%),Terkumpul (Rp),Subsidi (Rumah),Subsidi (Rp),Tunggakan (Rp)");
    rows.forEach((r) =>
      lines.push(`${r.rt},${r.kepatuhan},${r.terkumpul},${r.subsidiJumlah},${r.subsidiNominal},${r.tunggakan}`)
    );
    lines.push(
      `TOTAL,${rataKepatuhan.toFixed(1)},${totalTerkumpul},${totalSubsidiJumlah},${totalSubsidiNominal},${totalTunggakan}`
    );
    lines.push("Catatan: subsidi/keringanan disajikan dalam bentuk agregat per RT.");
    lines.push("");
    lines.push("BAGIAN C — KAS RW");
    lines.push("Indikator,Nilai (Rp/Jumlah)");
    lines.push(`Saldo Akhir,${saldoAkhir}`);
    lines.push(`Total Pemasukan,${totalPemasukan}`);
    lines.push(`Total Pengeluaran,${totalPengeluaran}`);
    lines.push(`Jumlah Transaksi,${jumlahTransaksi}`);
    downloadText(`laporan-agregat-rw-${tenant.rw}-${bulan.toLowerCase()}-${tahun}.csv`, lines.join("\n"));
    flash(`Laporan agregat ${periode} berhasil diunduh (CSV multi-bagian)`);
  }

  async function handleCetak() {
    flash("Menyiapkan laporan PDF…");
    try {
      // Dynamic import: jsPDF hanya dimuat saat tombol diklik (code-split).
      const { buatPdfLaporanRw } = await import("../../lib/pdfLaporan");
      const doc = buatPdfLaporanRw({
        periode,
        bulan: BULAN.indexOf(bulan) + 1,
        tahun: Number(tahun),
        rows,
        totalKk,
        totalWarga,
        totalRumah,
        totalHunian,
        rataKepatuhan,
        totalTerkumpul,
        totalSubsidiJumlah,
        totalSubsidiNominal,
        totalTunggakan,
        totalPemasukan,
        totalPengeluaran,
        saldoAkhir,
        jumlahTransaksi,
      });
      const namaFile = `Laporan-Agregat-${tenant.rwFull.replace(/\s+/g, "-")}-${bulan.toLowerCase()}-${tahun}.pdf`;
      doc.save(namaFile);
      flash(
        `Laporan PDF diunduh (${doc.getNumberOfPages()} halaman) — memuat daftar isi, banner RW, grafik, tabel, dan tanda tangan pengurus.`
      );
    } catch (err) {
      console.error("Gagal membuat PDF:", err);
      flash("Gagal membuat PDF. Silakan coba lagi.");
    }
  }

  const kpiKas = [
    {
      label: "Saldo Akhir",
      value: formatRupiah(saldoAkhir),
      icon: "savings",
      color: "bg-primary-container text-on-primary-container",
      valueClass: "text-on-surface",
    },
    {
      label: "Total Pemasukan",
      value: formatRupiah(totalPemasukan),
      icon: "trending_up",
      color: "bg-secondary-container text-on-secondary-container",
      valueClass: "text-secondary",
    },
    {
      label: "Total Pengeluaran",
      value: formatRupiah(totalPengeluaran),
      icon: "trending_down",
      color: "bg-error-container/40 text-on-error-container",
      valueClass: "text-error",
    },
    {
      label: "Jumlah Transaksi",
      value: String(jumlahTransaksi),
      icon: "receipt_long",
      color: "bg-tertiary-container text-on-tertiary-container",
      valueClass: "text-tertiary",
    },
  ];

  return (
    <div className="max-w-7xl mx-auto w-full space-y-6">
      {toast}

      <div className="flex items-center gap-1.5 text-sm text-on-surface-variant">
        <button type="button" className="hover:text-primary transition-colors flex items-center gap-1" onClick={() => onNavigate?.("dashboard-rw")}><span className="material-symbols-outlined text-[16px]">home</span>
          Portal RW
        </button>
        <span className="material-symbols-outlined text-[14px]">chevron_right</span>
        <span className="font-bold text-on-surface">Laporan Agregat Lintas-RT</span>
      </div>

      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div className="max-w-3xl space-y-1.5">
          <div className="inline-flex items-center gap-1.5 text-primary text-sm font-bold uppercase tracking-wider">
            <span className="material-symbols-outlined text-[16px]">assignment</span>
            Pelaporan Lintas-RT
          </div>
          <h1 className="text-2xl lg:text-[32px] text-on-surface tracking-tight font-extrabold">
            Laporan Agregat Lintas-RT
          </h1>
          <p className="text-sm text-on-surface-variant leading-relaxed">
            Laporan agregat kependudukan, iuran, dan kas {tenant.rwFull} untuk periode {periode} — siap dikirim ke Kelurahan/Kecamatan.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <div className="flex items-center gap-2">
            <select
              className="h-11 px-4 rounded-xl bg-surface-container-lowest text-on-surface text-sm shadow-sm focus:ring-2 focus:ring-primary focus:outline-none transition-all"
              value={bulan}
              onChange={(e) => setBulan(e.target.value)}
              aria-label="Pilih bulan"
            >
              {BULAN.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
            <select
              className="h-11 px-4 rounded-xl bg-surface-container-lowest text-on-surface text-sm shadow-sm focus:ring-2 focus:ring-primary focus:outline-none transition-all font-mono"
              value={tahun}
              onChange={(e) => setTahun(e.target.value)}
              aria-label="Pilih tahun"
            >
              {TAHUN.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <button
            className="h-11 px-5 rounded-xl bg-surface-container-lowest text-on-surface text-sm shadow-sm hover:shadow-md hover:bg-surface-container-low transition-all flex items-center gap-2"
            onClick={handleUnduhCsv}
          >
            <span className="material-symbols-outlined text-secondary text-[20px]">download</span>
            Unduh CSV
          </button>
          <button
            className="h-11 px-5 rounded-xl bg-primary text-on-primary text-sm shadow-md hover:bg-primary-container active:scale-[0.98] transition-all flex items-center gap-2"
            onClick={handleCetak}
          >
            <span className="material-symbols-outlined text-[20px]">picture_as_pdf</span>
            Unduh PDF
          </button>
        </div>
      </div>

      {/* Kop laporan — tampil di layar & saat dicetak. */}
      <div className="bg-surface-container-lowest rounded-xl p-6 shadow-sm text-center border-b-4 border-primary print:border-on-surface">
        <div className="flex items-center justify-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-full bg-primary-container flex items-center justify-center text-on-primary-container">
            <span className="material-symbols-outlined text-[22px]">location_city</span>
          </div>
        </div>
        <h2 className="text-lg font-extrabold text-on-surface uppercase tracking-wide">
          {tenant.rwFull} {tenant.perumahan}
        </h2>
        <p className="text-sm text-on-surface-variant">
          Kel. {tenant.kelurahan}, Kec. {tenant.kecamatan}, {tenant.kota}
        </p>
        <p className="text-sm font-bold text-on-surface mt-1 font-mono">Periode: {periode}</p>
        <p className="text-xs text-on-surface-variant mt-1">Laporan Agregat Lintas-RT (§7.7)</p>
      </div>

      {/* Bagian A — Kependudukan */}
      <section className="bg-surface-container-lowest rounded-xl p-6 shadow-sm">
        <div className="flex items-center justify-between pb-4 mb-4 border-b border-surface-container-high">
          <div>
            <div className="inline-flex items-center gap-1.5 text-xs font-bold text-primary uppercase tracking-wider mb-1">
              <span className="material-symbols-outlined text-[14px]">looks_one</span>
              Bagian A
            </div>
            <h2 className="text-lg font-bold text-on-surface">Kependudukan</h2>
            <p className="text-xs text-on-surface-variant mt-0.5">Data agregat per RT — {periode}</p>
          </div>
          <span className="material-symbols-outlined text-primary text-[24px]">groups</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-on-surface">
            <thead className="bg-surface-container-low text-xs text-on-surface-variant uppercase tracking-wider">
              <tr>
                <th className="py-3 px-4">RT</th>
                <th className="py-3 px-4 text-right">KK</th>
                <th className="py-3 px-4 text-right">Warga</th>
                <th className="py-3 px-4 text-right">Rumah</th>
                <th className="py-3 px-4 text-right">Hunian</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-container-high">
              {rows.map((r) => (
                <tr key={r.rt} className="hover:bg-surface-container-low/50 transition-colors">
                  <td className="py-3 px-4">
                    <span className="text-sm font-bold text-on-surface">{r.rt}</span>
                  </td>
                  <td className="py-3 px-4 text-right">
                    <span className="text-sm font-mono text-on-surface">{r.kk}</span>
                  </td>
                  <td className="py-3 px-4 text-right">
                    <span className="text-sm font-mono text-on-surface">{r.warga}</span>
                  </td>
                  <td className="py-3 px-4 text-right">
                    <span className="text-sm font-mono text-on-surface">{r.totalRumah}</span>
                  </td>
                  <td className="py-3 px-4 text-right">
                    <span className="text-sm font-mono text-on-surface">{r.hunian}</span>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-surface-container-low">
              <tr>
                <td className="py-3 px-4 font-bold text-sm">TOTAL</td>
                <td className="py-3 px-4 text-right font-bold font-mono text-sm">{totalKk}</td>
                <td className="py-3 px-4 text-right font-bold font-mono text-sm">{totalWarga}</td>
                <td className="py-3 px-4 text-right font-bold font-mono text-sm">{totalRumah}</td>
                <td className="py-3 px-4 text-right font-bold font-mono text-sm">{totalHunian}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      {/* Bagian B — Iuran (agregat) */}
      <section className="bg-surface-container-lowest rounded-xl p-6 shadow-sm">
        <div className="flex items-center justify-between pb-4 mb-4 border-b border-surface-container-high">
          <div>
            <div className="inline-flex items-center gap-1.5 text-xs font-bold text-primary uppercase tracking-wider mb-1">
              <span className="material-symbols-outlined text-[14px]">looks_two</span>
              Bagian B
            </div>
            <h2 className="text-lg font-bold text-on-surface">Iuran (Agregat)</h2>
            <p className="text-xs text-on-surface-variant mt-0.5">Kepatuhan, penerimaan, subsidi, dan tunggakan per RT — {periode}</p>
          </div>
          <span className="material-symbols-outlined text-secondary text-[24px]">request_quote</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-on-surface">
            <thead className="bg-surface-container-low text-xs text-on-surface-variant uppercase tracking-wider">
              <tr>
                <th className="py-3 px-4">RT</th>
                <th className="py-3 px-4 text-right">Kepatuhan %</th>
                <th className="py-3 px-4 text-right">Terkumpul</th>
                <th className="py-3 px-4 text-right">Subsidi (Agregat)</th>
                <th className="py-3 px-4 text-right">Tunggakan</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-container-high">
              {rows.map((r) => (
                <tr key={r.rt} className="hover:bg-surface-container-low/50 transition-colors">
                  <td className="py-3 px-4">
                    <span className="text-sm font-bold text-on-surface">{r.rt}</span>
                  </td>
                  <td className="py-3 px-4 text-right">
                    <span className={`text-sm font-bold font-mono ${r.kepatuhan >= 90 ? "text-secondary" : "text-tertiary"}`}>
                      {r.kepatuhan}%
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right">
                    <span className="text-sm font-bold font-mono text-on-surface">{formatRupiah(r.terkumpul)}</span>
                  </td>
                  <td className="py-3 px-4 text-right">
                    <span className="text-sm font-mono text-tertiary block">{r.subsidiJumlah} rumah</span>
                    <span className="text-xs font-mono text-on-surface-variant">{formatRupiah(r.subsidiNominal)}</span>
                  </td>
                  <td className="py-3 px-4 text-right">
                    <span className="text-sm font-mono text-error">{formatRupiah(r.tunggakan)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-surface-container-low">
              <tr>
                <td className="py-3 px-4 font-bold text-sm">TOTAL</td>
                <td className="py-3 px-4 text-right font-bold font-mono text-sm">{rataKepatuhan.toFixed(1)}%</td>
                <td className="py-3 px-4 text-right font-bold font-mono text-sm text-secondary">{formatRupiah(totalTerkumpul)}</td>
                <td className="py-3 px-4 text-right">
                  <span className="text-sm font-bold font-mono text-tertiary block">{totalSubsidiJumlah} rumah</span>
                  <span className="text-xs font-mono text-on-surface-variant">{formatRupiah(totalSubsidiNominal)}</span>
                </td>
                <td className="py-3 px-4 text-right font-bold font-mono text-sm text-error">{formatRupiah(totalTunggakan)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="mt-4 flex items-start gap-2 p-3 rounded-xl bg-primary-container/40">
          <span className="material-symbols-outlined text-[16px] text-primary shrink-0 mt-0.5">info</span>
          <span className="text-xs text-on-surface leading-relaxed">
            Catatan: subsidi/keringanan iuran disajikan dalam bentuk agregat per RT (jumlah rumah &amp; total nominal), tanpa
            rincian warga penerima — sesuai prinsip privasi §4.3 dan §6.4.10.
          </span>
        </div>
      </section>

      {/* Bagian C — Kas RW */}
      <section className="bg-surface-container-lowest rounded-xl p-6 shadow-sm">
        <div className="flex items-center justify-between pb-4 mb-4 border-b border-surface-container-high">
          <div>
            <div className="inline-flex items-center gap-1.5 text-xs font-bold text-primary uppercase tracking-wider mb-1">
              <span className="material-symbols-outlined text-[14px]">looks_3</span>
              Bagian C
            </div>
            <h2 className="text-lg font-bold text-on-surface">Kas RW</h2>
            <p className="text-xs text-on-surface-variant mt-0.5">Ringkasan buku kas RW — {periode}</p>
          </div>
          <span className="material-symbols-outlined text-tertiary text-[24px]">account_balance</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {kpiKas.map((kpi) => (
            <div key={kpi.label} className="bg-surface-container-low rounded-xl p-5 flex flex-col justify-between">
              <div className="flex items-start justify-between">
                <span className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">{kpi.label}</span>
                <div className={`w-10 h-10 rounded-full ${kpi.color} flex items-center justify-center`}>
                  <span className="material-symbols-outlined text-[22px]">{kpi.icon}</span>
                </div>
              </div>
              <div className={`mt-4 text-2xl font-extrabold font-mono ${kpi.valueClass}`}>{kpi.value}</div>
            </div>
          ))}
        </div>
        {kasRw.length === 0 && (
          <div className="mt-4 rounded-xl bg-surface-container-low">
            <EmptyState
              icon="receipt_long"
              judul="Belum ada transaksi kas RW"
              pesan="Ubah periode laporan atau pastikan kas RW sudah dicatat untuk periode ini."
            />
          </div>
        )}
      </section>

      <div className="bg-surface-container-lowest rounded-xl p-5 shadow-sm flex items-start gap-3">
        <span className="material-symbols-outlined text-secondary text-[20px] shrink-0">task_alt</span>
        <p className="text-xs text-on-surface-variant leading-relaxed">
          <span className="font-bold text-on-surface">Catatan:</span> Laporan ini disusun dalam format siap dikirim ke
          Kelurahan/Kecamatan. Seluruh angka merupakan data agregat lintas-RT — tidak memuat data individu warga.
        </p>
      </div>
    </div>
  );
}
