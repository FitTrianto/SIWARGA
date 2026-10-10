import { tenant } from "../../lib/tenant";
import { RtAgregat, rtAgregatDefault, formatRupiah, downloadText } from "../../lib/shared";
import { EmptyState } from "../../components/EmptyState";
import { useFlash } from "../../lib/useFlash";

interface IuranRWProps {
  onNavigate?: (page: string) => void;
  /**
   * Batch 20 · baris agregat per RT dari `GET /rw/agregat/*`; `null` =
   * OFFLINE/mode demo (baris contoh + banner), `[]` = daring. Sesi daring
   * TANPA rekap iuran server (Batch 21) → tabel/KPI contoh disembunyikan dan
   * diganti EmptyState jujur, bukan angka karangan.
   */
  rtAgregat?: RtAgregat[] | null;
}

/**
 * §7.2 — Rekap Kepatuhan Iuran per RT.
 * HANYA data agregat per RT. Tidak ada nama warga, status, nominal, atau
 * kategori iuran individu — keputusan desain eksplisit (§6.4.10, §4.3).
 */
export function IuranRW({ onNavigate, rtAgregat = null }: IuranRWProps) {
  const { flash, toast } = useFlash();


  const rows: RtAgregat[] = rtAgregat === null ? rtAgregatDefault : rtAgregat;
  // Batch 20 · baris server belum membawa rekap iuran (Batch 21) → jangan
  // menampilkan 0% / Rp 0 yang menyamar sebagai data riil.
  const iuranTersedia = rows.some((r) => r.iuranTersedia !== false);

  // Turunan agregat — bukan data individu.
  // Batch 21 · baris server membawa jumlah tagihan/lunas RIIL; baris demo
  // memakai rumah terisi × kepatuhan (estimasi contoh). `pakaiTagihan`
  // menentukan label kolom: "Tagihan Wajib Bayar" (data riil) vs "Rumah
  // Wajib Bayar" (estimasi contoh) — supaya angka tidak pernah berpura-pura.
  const lunasOf = (r: RtAgregat) => r.jumlahLunas ?? Math.round((r.hunian * r.kepatuhan) / 100);
  const wajibBayarOf = (r: RtAgregat) => r.jumlahTagihan ?? r.hunian;
  const pakaiTagihan = rows.some((r) => r.jumlahTagihan !== undefined);
  const rataKepatuhan = rows.length > 0 ? rows.reduce((sum, r) => sum + r.kepatuhan, 0) / rows.length : 0;
  const totalTerkumpul = rows.reduce((sum, r) => sum + r.terkumpul, 0);
  const totalSubsidiNominal = rows.reduce((sum, r) => sum + r.subsidiNominal, 0);
  const totalSubsidiRumah = rows.reduce((sum, r) => sum + r.subsidiJumlah, 0);
  const totalTunggakan = rows.reduce((sum, r) => sum + r.tunggakan, 0);
  const totalHunian = rows.reduce((sum, r) => sum + wajibBayarOf(r), 0);
  const totalLunas = rows.reduce((sum, r) => sum + lunasOf(r), 0);
  const totalSubsidiJumlah = totalSubsidiRumah;

  const tertinggi = rows.reduce((a, b) => (b.kepatuhan > a.kepatuhan ? b : a), rows[0]);
  const terendah = rows.reduce((a, b) => (b.kepatuhan < a.kepatuhan ? b : a), rows[0]);

  const kpiData = [
    {
      label: "Rata-rata Kepatuhan",
      value: `${rataKepatuhan.toFixed(1)}%`,
      sub: `Mean kepatuhan ${rows.length} RT`,
      icon: "verified",
      color: "bg-primary-container text-on-primary-container",
      valueClass: "text-on-surface",
    },
    {
      label: "Total Terkumpul",
      value: formatRupiah(totalTerkumpul),
      sub: "Agregat seluruh RT",
      icon: "paid",
      color: "bg-secondary-container text-on-secondary-container",
      valueClass: "text-secondary",
    },
    {
      label: "Total Subsidi / Keringanan",
      value: formatRupiah(totalSubsidiNominal),
      sub: `${totalSubsidiRumah} rumah menerima keringanan`,
      icon: "volunteer_activism",
      color: "bg-tertiary-container text-on-tertiary-container",
      valueClass: "text-tertiary",
    },
    {
      label: "Total Tunggakan",
      value: formatRupiah(totalTunggakan),
      sub: "Agregat seluruh RT",
      icon: "warning",
      color: "bg-error-container/40 text-on-error-container",
      valueClass: "text-error",
    },
  ];

  function handleUnduhCsv() {
    const lines: string[] = [];
    lines.push(`Rekap Kepatuhan Iuran per RT — ${tenant.rwFull} ${tenant.perumahan}`);
    lines.push(`Kel. ${tenant.kelurahan}, Kec. ${tenant.kecamatan}, ${tenant.kota}`);
    lines.push("Data bersifat agregat per RT — tanpa data individu warga (§6.4.10).");
    lines.push("");
    lines.push(
      `RT,${pakaiTagihan ? "Tagihan" : "Rumah"} Wajib Bayar,Lunas,Kepatuhan (%),Terkumpul (Rp),Subsidi (Rumah),Subsidi (Rp),Tunggakan (Rp)`
    );
    rows.forEach((r) => {
      lines.push(
        `${r.rt},${wajibBayarOf(r)},${lunasOf(r)},${r.kepatuhan},${r.terkumpul},${r.subsidiJumlah},${r.subsidiNominal},${r.tunggakan}`
      );
    });
    lines.push(
      `TOTAL,${totalHunian},${totalLunas},${rataKepatuhan.toFixed(1)},${totalTerkumpul},${totalSubsidiJumlah},${totalSubsidiNominal},${totalTunggakan}`
    );
    downloadText(`rekap-iuran-rw-${tenant.rw}.csv`, lines.join("\n"));
    flash("Rekap iuran per RT berhasil diunduh (CSV agregat)");
  }

  return (
    <div className="max-w-7xl mx-auto w-full space-y-6">
      {toast}

      <div className="flex items-center gap-1.5 text-sm text-on-surface-variant">
        <button type="button" className="hover:text-primary transition-colors flex items-center gap-1" onClick={() => onNavigate?.("dashboard-rw")}><span className="material-symbols-outlined text-[16px]">home</span>
          Portal RW
        </button>
        <span className="material-symbols-outlined text-[14px]">chevron_right</span>
        <span className="font-bold text-on-surface">Rekap Kepatuhan Iuran per RT</span>
      </div>

      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div className="max-w-3xl space-y-1.5">
          <div className="inline-flex items-center gap-1.5 text-primary text-sm font-bold uppercase tracking-wider">
            <span className="material-symbols-outlined text-[16px]">request_quote</span>
            Iuran Lintas-RT (Agregat)
          </div>
          <h1 className="text-2xl lg:text-[32px] text-on-surface tracking-tight font-extrabold">
            Rekap Kepatuhan Iuran per RT
          </h1>
          <p className="text-sm text-on-surface-variant leading-relaxed">
            Rekapitulasi kepatuhan, penerimaan, subsidi, dan tunggakan iuran pada seluruh RT di {tenant.rwFull} dalam bentuk agregat.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 shrink-0">
          {iuranTersedia && (
            <button
              className="h-11 px-5 rounded-xl bg-primary text-on-primary text-sm shadow-md hover:bg-primary-container active:scale-[0.98] transition-all flex items-center gap-2"
              onClick={handleUnduhCsv}
            >
              <span className="material-symbols-outlined text-[20px]">download</span>
              Unduh Rekap CSV
            </button>
          )}
        </div>
      </div>

      {/* Banner privasi MENONJOL — keputusan desain eksplisit, bukan keterbatasan. */}
      <div className="relative overflow-hidden rounded-xl border-l-4 border-tertiary bg-tertiary-container/40 p-5 shadow-sm">
        <div className="flex items-start gap-4">
          <div className="w-11 h-11 rounded-xl bg-tertiary flex items-center justify-center text-on-tertiary shrink-0">
            <span className="material-symbols-outlined text-[24px]">lock</span>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-extrabold text-on-surface uppercase tracking-wider">Prinsip Privasi — Hanya Data Agregat</h2>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-tertiary text-on-tertiary text-[10px] font-bold uppercase tracking-wider">
                §6.4.10
              </span>
            </div>
            <p className="text-sm text-on-surface leading-relaxed">
              Data iuran bersifat agregat per RT. RW tidak melihat status, nominal, atau kategori iuran individu warga — ini
              keputusan desain eksplisit (§6.4.10), bukan keterbatasan sementara, sejalan dengan prinsip privasi §4.3.
            </p>
          </div>
        </div>
      </div>

      {!iuranTersedia ? (
        <div className="bg-surface-container-lowest rounded-xl shadow-sm">
          <EmptyState
            icon="request_quote"
            judul="Rekap iuran per RT belum tersedia"
            pesan="Rekap kepatuhan, penerimaan, subsidi, dan tunggakan iuran lintas-RT belum tersedia pada sistem — modul ini dihidupkan setelah rekap iuran agregat per RT tersedia di server. Mode demo tetap menampilkan data contoh dengan tanda MODE DEMO."
          />
        </div>
      ) : (
        <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpiData.map((kpi) => (
          <div key={kpi.label} className="bg-surface-container-lowest rounded-xl p-5 shadow-sm flex flex-col justify-between">
            <div className="flex items-start justify-between">
              <span className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">{kpi.label}</span>
              <div className={`w-10 h-10 rounded-full ${kpi.color} flex items-center justify-center`}>
                <span className="material-symbols-outlined text-[22px]">{kpi.icon}</span>
              </div>
            </div>
            <div className="mt-4">
              <div className={`text-2xl font-extrabold font-mono ${kpi.valueClass}`}>{kpi.value}</div>
              <div className="text-[11px] text-on-surface-variant mt-1">{kpi.sub}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-surface-container-lowest rounded-xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-surface-container-high flex items-center gap-3">
          <span className="material-symbols-outlined text-primary text-[22px]">table_chart</span>
          <div>
            <h2 className="text-base font-bold text-on-surface">Tabel Kepatuhan Iuran per RT</h2>
            <p className="text-xs text-on-surface-variant mt-0.5">Seluruh angka adalah agregat per RT — tanpa rincian individu warga.</p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-on-surface">
            <thead className="bg-surface-container-low text-xs text-on-surface-variant uppercase tracking-wider">
              <tr>
                <th className="py-3 px-4">RT</th>
                <th className="py-3 px-4 text-right">{pakaiTagihan ? "Tagihan" : "Rumah"} Wajib Bayar</th>
                <th className="py-3 px-4 text-right">Lunas</th>
                <th className="py-3 px-4">Kepatuhan %</th>
                <th className="py-3 px-4 text-right">Terkumpul</th>
                <th className="py-3 px-4 text-right">Subsidi</th>
                <th className="py-3 px-4 text-right">Tunggakan</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-container-high">
              {rows.map((r) => {
                const peringatan = r.kepatuhan < 90;
                return (
                  <tr key={r.rt} className="hover:bg-surface-container-low/50 transition-colors">
                    <td className="py-4 px-4">
                      <div className="flex items-center gap-2">
                        <span
                          className={`w-2.5 h-2.5 rounded-full shrink-0 ${peringatan ? "bg-tertiary" : "bg-secondary"}`}
                          title={peringatan ? "Kepatuhan di bawah 90%" : "Kepatuhan ≥ 90%"}
                        />
                        <span className="text-sm font-bold text-on-surface">{r.rt}</span>
                      </div>
                    </td>
                    <td className="py-4 px-4 text-right">
                      <span className="text-sm font-mono text-on-surface">{wajibBayarOf(r)}</span>
                    </td>
                    <td className="py-4 px-4 text-right">
                      <span className="text-sm font-mono text-on-surface">{lunasOf(r)}</span>
                    </td>
                    <td className="py-4 px-4">
                      <div className="flex items-center gap-2 min-w-[140px]">
                        <div className="flex-1 bg-surface-container-high h-2 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${r.kepatuhan >= 90 ? "bg-secondary" : "bg-tertiary"}`}
                            style={{ width: `${r.kepatuhan}%` }}
                          />
                        </div>
                        <span className={`w-14 text-right text-xs font-bold font-mono ${r.kepatuhan >= 90 ? "text-secondary" : "text-tertiary"}`}>
                          {r.kepatuhan}%
                        </span>
                      </div>
                    </td>
                    <td className="py-4 px-4 text-right">
                      <span className="text-sm font-bold font-mono text-on-surface">{formatRupiah(r.terkumpul)}</span>
                    </td>
                    <td className="py-4 px-4 text-right">
                      <span className="text-sm font-mono text-tertiary block">{r.subsidiJumlah} rumah</span>
                      <span className="text-xs font-mono text-on-surface-variant">{formatRupiah(r.subsidiNominal)}</span>
                    </td>
                    <td className="py-4 px-4 text-right">
                      <span className="text-sm font-mono text-error">{formatRupiah(r.tunggakan)}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="bg-surface-container-low">
              <tr>
                <td className="py-3 px-4 font-bold text-sm">TOTAL</td>
                <td className="py-3 px-4 text-right font-bold font-mono text-sm">{totalHunian}</td>
                <td className="py-3 px-4 text-right font-bold font-mono text-sm">{totalLunas}</td>
                <td className="py-3 px-4 font-bold font-mono text-sm">{rataKepatuhan.toFixed(1)}%</td>
                <td className="py-3 px-4 text-right font-bold font-mono text-sm text-secondary">{formatRupiah(totalTerkumpul)}</td>
                <td className="py-3 px-4 text-right">
                  <span className="text-sm font-bold font-mono text-tertiary block">{totalSubsidiRumah} rumah</span>
                  <span className="text-xs font-mono text-on-surface-variant">{formatRupiah(totalSubsidiNominal)}</span>
                </td>
                <td className="py-3 px-4 text-right font-bold font-mono text-sm text-error">{formatRupiah(totalTunggakan)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="px-6 py-3 border-t border-surface-container-high flex flex-wrap items-center justify-between gap-2 text-xs text-on-surface-variant">
          <span>Menampilkan {rows.length} RT — seluruh data agregat</span>
          <span className="flex items-center gap-3">
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-secondary" /> Kepatuhan &ge; 90%</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-tertiary" /> Peringatan &lt; 90%</span>
          </span>
        </div>
      </div>

      <div className="bg-surface-container-lowest rounded-xl p-6 shadow-sm">
        <div className="flex items-center justify-between pb-4 mb-4 border-b border-surface-container-high">
          <div>
            <h2 className="text-lg font-bold text-on-surface">Perbandingan Antar-RT</h2>
            <p className="text-xs text-on-surface-variant mt-0.5">Persentase kepatuhan iuran agregat per RT</p>
          </div>
          <span className="material-symbols-outlined text-tertiary text-[24px]">bar_chart</span>
        </div>
        <div className="space-y-4">
          {rows.map((r) => {
            const isMax = r.rt === tertinggi.rt;
            const isMin = r.rt === terendah.rt;
            return (
              <div key={r.rt} className="flex items-center gap-4">
                <span className="w-16 text-sm font-semibold text-on-surface shrink-0">{r.rt}</span>
                <div className="flex-1 bg-surface-container-high h-5 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      isMax ? "bg-secondary" : isMin ? "bg-tertiary" : "bg-primary"
                    }`}
                    style={{ width: `${r.kepatuhan}%` }}
                  />
                </div>
                <span
                  className={`w-32 text-right text-sm font-bold font-mono shrink-0 ${
                    isMax ? "text-secondary" : isMin ? "text-tertiary" : "text-on-surface"
                  }`}
                >
                  {r.kepatuhan}%
                  {isMax && <span className="ml-1 text-[10px] font-bold uppercase not-italic">(tertinggi)</span>}
                  {isMin && <span className="ml-1 text-[10px] font-bold uppercase not-italic">(terendah)</span>}
                </span>
              </div>
            );
          })}
        </div>
        <div className="mt-6 pt-4 border-t border-surface-container-high flex flex-wrap items-center gap-4 text-xs text-on-surface-variant">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-secondary" />
            Tertinggi: {tertinggi.rt} ({tertinggi.kepatuhan}%)
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-tertiary" />
            Terendah: {terendah.rt} ({terendah.kepatuhan}%)
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-primary" />
            RT lainnya
          </div>
        </div>
      </div>
        </>
      )}

      <div className="flex items-start gap-3 p-4 rounded-xl bg-surface-container-lowest shadow-sm">
        <span className="material-symbols-outlined text-on-surface-variant text-[20px] shrink-0">info</span>
        <p className="text-xs text-on-surface-variant leading-relaxed">
          Halaman ini tidak menyediakan drill-down individu. Rincian status, nominal, dan kategori iuran per warga hanya
          dapat dikelola dan dilihat oleh Pengurus RT terkait di Portal RT.
        </p>
      </div>
    </div>
  );
}
