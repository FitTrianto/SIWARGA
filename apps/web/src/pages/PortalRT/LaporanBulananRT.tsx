import { tenant, getMonthName } from "../../lib/tenant";
import {
  KkData,
  WargaRt,
  HunianRumah,
  KasRt,
  KategoriIuran,
  Pembayaran,
  Pengurus,
  Surat,
  StatusSurat,
  kategoriIuranDefault,
  kategoriTagihan,
  gabungDaftarWarga,
  hitungPopulasi,
  hitungHunian,
  hitungTagihanRows,
  rekapIuran,
  rekapKasRt,
  suratBadge,
  shortAlamat,
  downloadText,
  PERIODE_AKTIF,
} from "../../lib/shared";
import { useFlash } from "../../lib/useFlash";

interface LaporanBulananRTProps {
  onNavigate?: (page: string) => void;
  kkList: KkData[];
  wargaRt: WargaRt[];
  hunian: HunianRumah[];
  kasRt: KasRt[];
  kategoriIuran: KategoriIuran[];
  pembayaran: Pembayaran[];
  surat: Surat[];
  pengurus: Pengurus[];
}

export function LaporanBulananRT({
  onNavigate,
  kkList,
  wargaRt,
  hunian,
  kasRt,
  kategoriIuran,
  pembayaran,
  surat,
  pengurus,
}: LaporanBulananRTProps) {
  const periode = PERIODE_AKTIF;
  const { flash, toast } = useFlash();


  // — Nilai turunan dari data bersama (periode berjalan) —
  const alamatWarga = shortAlamat(kkList[0]?.alamat ?? "");
  const tagihanRows = hitungTagihanRows(kategoriIuran, pembayaran, { alamatWarga });
  const rekap = rekapIuran(tagihanRows, pembayaran);
  const kas = rekapKasRt(kasRt);
  const populasi = hitungPopulasi(kkList, wargaRt);
  const rekapHunian = hitungHunian(hunian);
  const wargaAktif = gabungDaftarWarga(kkList, wargaRt).filter((r) => r.statusPortal === "Aktif").length;

  const lunasRows = tagihanRows.filter((r) => r.status === "Lunas");
  // Hanya kategori yang ditagihkan yang punya target pendapatan (nonaktif,
  // insidental, dan opsional-non-unit tidak diikutkan agar angka tetap jujur).
  const kategori = kategoriTagihan(
    kategoriIuran.length > 0 ? kategoriIuran : kategoriIuranDefault
  );

  // Pendapatan per kategori: target = nominal × seluruh baris; terealisasi = nominal × baris lunas.
  const pendapatanData = kategori.map((k) => {
    const target =
      k.tipe === "per_unit"
        ? tagihanRows.reduce((s, r) => s + r.unitR4, 0) * k.nominal
        : tagihanRows.length * k.nominal;
    const terealisasi =
      k.tipe === "per_unit"
        ? lunasRows.reduce((s, r) => s + r.unitR4, 0) * k.nominal
        : lunasRows.length * k.nominal;
    const persentase = target ? Math.round((terealisasi / target) * 1000) / 10 : 0;
    return { kategori: k.nama, target, terealisasi, persentase };
  });

  // Pengeluaran dikelompokkan per kategori kas dari buku kas RT.
  const pengeluaranKas = kasRt.filter((k) => k.tipe === "Pengeluaran");
  const pengeluaranMap = new Map<string, { kategori: string; transaksi: number; realisasi: number }>();
  for (const k of pengeluaranKas) {
    const e = pengeluaranMap.get(k.kategori) ?? { kategori: k.kategori, transaksi: 0, realisasi: 0 };
    e.transaksi += 1;
    e.realisasi += Math.abs(k.nominal);
    pengeluaranMap.set(k.kategori, e);
  }
  const pengeluaranData = Array.from(pengeluaranMap.values())
    .map((e) => ({
      ...e,
      porsi: kas.pengeluaran ? Math.round((e.realisasi / kas.pengeluaran) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.realisasi - a.realisasi);

  const kepatuhanData = pendapatanData.map((p) => ({ kategori: p.kategori, persentase: p.persentase }));

  const totalTarget = pendapatanData.reduce((acc, d) => acc + d.target, 0);
  const totalPendapatan = pendapatanData.reduce((acc, d) => acc + d.terealisasi, 0);
  const totalPengeluaran = kas.pengeluaran;
  const totalTransaksi = pengeluaranData.reduce((acc, d) => acc + d.transaksi, 0);
  const surplus = rekap.terkumpul - totalPengeluaran;
  const kepatuhan = rekap.kepatuhan;
  const rataPendapatan = pendapatanData.length
    ? Math.round(pendapatanData.reduce((acc, d) => acc + d.persentase, 0) / pendapatanData.length)
    : 0;

  const urutanStatus: StatusSurat[] = ["Menunggu RT", "Menunggu RW", "Disetujui", "Ditolak", "Perlu Perbaikan", "Draft"];
  const persuratan = urutanStatus.map((s) => ({
    status: s,
    jumlah: surat.filter((x) => x.status === s).length,
  }));

  function exportExcel() {
    const slug = periode.toLowerCase().replace(/\s+/g, "-");
    const lines: string[] = [];
    lines.push(`Laporan Bulanan ${tenant.label} — Periode ${periode}`);
    lines.push("");
    lines.push("Rekapitulasi Pendapatan");
    lines.push("Kategori,Target (Rp),Terealisasi (Rp),Persentase (%)");
    pendapatanData.forEach((d) => lines.push(`${d.kategori},${d.target},${d.terealisasi},${d.persentase}`));
    lines.push(`Total,${totalTarget},${totalPendapatan},${rataPendapatan}`);
    lines.push("");
    lines.push("Rekapitulasi Pengeluaran");
    lines.push("Kategori,Transaksi,Realisasi (Rp),Porsi (%)");
    pengeluaranData.forEach((d) => lines.push(`${d.kategori},${d.transaksi},${d.realisasi},${d.porsi}`));
    lines.push(`Total,${totalTransaksi},${totalPengeluaran},${totalPengeluaran ? 100 : 0}`);
    lines.push("");
    lines.push("Rekap Iuran");
    lines.push("Terkumpul (Rp),Target (Rp),Kepatuhan (%),Tunggakan (Rp),Lunas,Belum Lunas");
    lines.push(
      `${rekap.terkumpul},${totalTarget},${rekap.kepatuhan.toFixed(1)},${rekap.tunggakan},${rekap.lunasCount},${rekap.belumCount}`
    );
    lines.push("");
    lines.push("Ringkasan Kependudukan");
    lines.push("Total KK,Total Jiwa,Rumah Terisi,Multi-KK,Portal Aktif");
    lines.push(`${populasi.kk},${populasi.jiwa},${rekapHunian.terisi},${rekapHunian.multi},${wargaAktif}`);
    lines.push("");
    lines.push("Ringkasan Persuratan");
    lines.push("Status,Jumlah");
    persuratan.forEach((p) => lines.push(`${p.status},${p.jumlah}`));
    downloadText(`laporan-bulanan-${slug}.csv`, lines.join("\n"));
    flash(`Laporan periode ${periode} berhasil diunduh (CSV siap dibuka di Excel).`);
  }

  async function unduhPdf() {
    flash("Menyiapkan laporan PDF…");
    try {
      // Dynamic import: jsPDF hanya dimuat saat tombol diklik (code-split).
      const { buatPdfLaporanRt } = await import("../../lib/pdfLaporan");
      const [namaBulan, tahunStr] = periode.split(" ");
      const bulan = Array.from({ length: 12 }, (_, i) => getMonthName(i + 1)).indexOf(namaBulan) + 1;
      const tahun = Number(tahunStr) || new Date().getFullYear();

      const doc = buatPdfLaporanRt({
        periode,
        bulan,
        tahun,
        ketuaRt:
          pengurus.find((p) => p.jabatan === "Ketua RT")?.nama ??
          pengurus[0]?.nama ??
          "-",
        pendapatan: pendapatanData,
        pengeluaran: pengeluaranData,
        totalTarget,
        totalPendapatan,
        rataPendapatan,
        totalPengeluaran,
        totalTransaksi,
        surplus,
        kepatuhan,
        rekap: {
          terkumpul: rekap.terkumpul,
          tunggakan: rekap.tunggakan,
          lunasCount: rekap.lunasCount,
          belumCount: rekap.belumCount,
        },
        populasi,
        hunian: rekapHunian,
        wargaAktif,
        persuratan,
        totalSurat: surat.length,
      });

      const slug = periode.toLowerCase().replace(/\s+/g, "-");
      doc.save(`Laporan-Bulanan-${tenant.shortLabel}-${slug}.pdf`);
      flash(
        `Laporan PDF diunduh (${doc.getNumberOfPages()} halaman) — memuat daftar isi, grafik, tabel, dan tanda tangan pengurus RT/RW.`
      );
    } catch (err) {
      console.error("Gagal membuat PDF:", err);
      flash("Gagal membuat PDF. Silakan coba lagi.");
    }
  }

  return (
    <div className="max-w-7xl mx-auto w-full space-y-6">
      {toast}

      <div className="flex items-center gap-1.5 text-sm text-on-surface-variant">
        <button type="button" className="hover:text-primary transition-colors flex items-center gap-1" onClick={() => onNavigate?.("dashboard-rt")}><span className="material-symbols-outlined text-[16px]">home</span>
          Portal RT
        </button>
        <span className="material-symbols-outlined text-[14px]">chevron_right</span>
        <span className="font-bold text-on-surface">Laporan Bulanan</span>
      </div>

      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div className="max-w-3xl space-y-1.5">
          <div className="inline-flex items-center gap-1.5 text-primary text-sm font-bold uppercase tracking-wider">
            <span className="material-symbols-outlined text-[16px]">analytics</span>
            Laporan Keuangan & Kependudukan
          </div>
          <h1 className="text-2xl lg:text-[32px] text-on-surface tracking-tight font-extrabold">
            Laporan Bulanan {tenant.label}
          </h1>
          <p className="text-sm text-on-surface-variant leading-relaxed">
            Rekapitulasi keuangan dan kependudukan {tenant.rtFull} untuk periode bulanan.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <span className="inline-flex items-center gap-2 h-11 px-4 rounded-xl bg-surface-container-low text-on-surface text-sm font-semibold">
            <span className="material-symbols-outlined text-primary text-[18px]">calendar_month</span>
            {periode}
          </span>
          <button
            className="h-11 px-5 rounded-xl bg-surface-container-lowest text-on-surface text-sm shadow-sm hover:shadow-md hover:bg-surface-container-low transition-all flex items-center gap-2"
            onClick={exportExcel}
          >
            <span className="material-symbols-outlined text-secondary text-[20px]">table_chart</span>
            Export Excel
          </button>
          <button
            className="h-11 px-5 rounded-xl bg-surface-container-lowest text-on-surface text-sm shadow-sm hover:shadow-md hover:bg-surface-container-low transition-all flex items-center gap-2"
            onClick={unduhPdf}
          >
            <span className="material-symbols-outlined text-error text-[20px]">picture_as_pdf</span>
            Unduh Laporan PDF
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-surface-container-lowest rounded-xl p-5 shadow-sm flex flex-col justify-between">
          <div className="flex items-start justify-between">
            <span className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">Total Pendapatan</span>
            <div className="w-10 h-10 rounded-full bg-secondary-container flex items-center justify-center text-on-secondary-container">
              <span className="material-symbols-outlined text-[22px]">trending_up</span>
            </div>
          </div>
          <div className="mt-4">
            <div className="text-2xl font-extrabold text-secondary font-mono">Rp {rekap.terkumpul.toLocaleString("id-ID")}</div>
            <div className="text-[11px] text-secondary font-semibold mt-1">Target: Rp {totalTarget.toLocaleString("id-ID")}</div>
          </div>
        </div>
        <div className="bg-surface-container-lowest rounded-xl p-5 shadow-sm flex flex-col justify-between">
          <div className="flex items-start justify-between">
            <span className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">Total Pengeluaran</span>
            <div className="w-10 h-10 rounded-full bg-error-container/40 flex items-center justify-center text-on-error-container">
              <span className="material-symbols-outlined text-[22px]">trending_down</span>
            </div>
          </div>
          <div className="mt-4">
            <div className="text-2xl font-extrabold text-error font-mono">Rp {totalPengeluaran.toLocaleString("id-ID")}</div>
            <div className="text-[11px] text-on-surface-variant mt-1">{totalTransaksi} Transaksi &bull; {pengeluaranData.length} Kategori</div>
          </div>
        </div>
        <div className="bg-surface-container-lowest rounded-xl p-5 shadow-sm flex flex-col justify-between">
          <div className="flex items-start justify-between">
            <span className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">Surplus / Defisit</span>
            <div className="w-10 h-10 rounded-full bg-primary-container flex items-center justify-center text-on-primary-container">
              <span className="material-symbols-outlined text-[22px]">savings</span>
            </div>
          </div>
          <div className="mt-4">
            <div className={`text-2xl font-extrabold font-mono ${surplus >= 0 ? "text-secondary" : "text-error"}`}>
              {surplus >= 0 ? "+" : ""}Rp {surplus.toLocaleString("id-ID")}
            </div>
            <div className="text-[11px] text-secondary font-semibold mt-1">{surplus >= 0 ? "Surplus" : "Defisit"} Operasional</div>
          </div>
        </div>
        <div className="bg-surface-container-lowest rounded-xl p-5 shadow-sm flex flex-col justify-between">
          <div className="flex items-start justify-between">
            <span className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">Kepatuhan Iuran</span>
            <div className="w-10 h-10 rounded-full bg-tertiary-container flex items-center justify-center text-on-tertiary-container">
              <span className="material-symbols-outlined text-[22px]">verified</span>
            </div>
          </div>
          <div className="mt-4">
            <div className="text-2xl font-extrabold text-on-surface">{kepatuhan.toFixed(1)}%</div>
            <div className="w-full bg-surface-container-high h-2 rounded-full overflow-hidden mt-2">
              <div className="bg-primary h-full rounded-full" style={{ width: `${kepatuhan}%` }} />
            </div>
            <div className="text-[11px] text-on-surface-variant mt-1">{pendapatanData.length} Kategori &bull; {rekap.lunasCount} Rumah Lunas</div>
          </div>
        </div>
      </div>

      <section className="bg-surface-container-lowest rounded-xl p-6 shadow-sm">
        <div className="flex items-center justify-between pb-4 mb-4 border-b border-surface-container-high">
          <div>
            <h2 className="text-lg font-bold text-on-surface">Rekapitulasi Pendapatan</h2>
            <p className="text-xs text-on-surface-variant mt-0.5">Realisasi pemasukan per kategori iuran — {periode}</p>
          </div>
          <span className="material-symbols-outlined text-secondary text-[24px]">receipt_long</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-on-surface">
            <thead className="bg-surface-container-low text-xs text-on-surface-variant uppercase tracking-wider">
              <tr>
                <th className="py-3 px-4">Kategori</th>
                <th className="py-3 px-4 text-right">Target (Rp)</th>
                <th className="py-3 px-4 text-right">Terealisasi (Rp)</th>
                <th className="py-3 px-4 text-right">Persentase</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-container-high">
              {pendapatanData.map((row) => (
                <tr key={row.kategori} className="hover:bg-surface-container-low/50 transition-colors">
                  <td className="py-4 px-4">
                    <span className="text-sm font-semibold text-on-surface">{row.kategori}</span>
                  </td>
                  <td className="py-4 px-4 text-right">
                    <span className="text-sm font-mono text-on-surface-variant">Rp {row.target.toLocaleString("id-ID")}</span>
                  </td>
                  <td className="py-4 px-4 text-right">
                    <span className="text-sm font-bold font-mono text-secondary">Rp {row.terealisasi.toLocaleString("id-ID")}</span>
                  </td>
                  <td className="py-4 px-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-16 bg-surface-container-high h-2 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${row.persentase >= 90 ? "bg-secondary" : row.persentase >= 80 ? "bg-tertiary" : "bg-error"}`}
                          style={{ width: `${row.persentase}%` }}
                        />
                      </div>
                      <span className={`text-xs font-bold ${row.persentase >= 90 ? "text-secondary" : row.persentase >= 80 ? "text-tertiary" : "text-error"}`}>
                        {row.persentase}%
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-surface-container-low">
              <tr>
                <td className="py-3 px-4 font-bold text-sm">Total</td>
                <td className="py-3 px-4 text-right font-bold font-mono text-sm">Rp {pendapatanData.reduce((a, d) => a + d.target, 0).toLocaleString("id-ID")}</td>
                <td className="py-3 px-4 text-right font-bold font-mono text-sm text-secondary">Rp {totalPendapatan.toLocaleString("id-ID")}</td>
                <td className="py-3 px-4 text-right font-bold text-sm">{rataPendapatan}%</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <section className="bg-surface-container-lowest rounded-xl p-6 shadow-sm">
        <div className="flex items-center justify-between pb-4 mb-4 border-b border-surface-container-high">
          <div>
            <h2 className="text-lg font-bold text-on-surface">Rekapitulasi Pengeluaran</h2>
            <p className="text-xs text-on-surface-variant mt-0.5">Realisasi pengeluaran per kategori anggaran — {periode}</p>
          </div>
          <span className="material-symbols-outlined text-error text-[24px]">account_balance_wallet</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-on-surface">
            <thead className="bg-surface-container-low text-xs text-on-surface-variant uppercase tracking-wider">
              <tr>
                <th className="py-3 px-4">Kategori</th>
                <th className="py-3 px-4 text-right">Transaksi</th>
                <th className="py-3 px-4 text-right">Realisasi (Rp)</th>
                <th className="py-3 px-4 text-right">Porsi (%)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-container-high">
              {pengeluaranData.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-sm text-on-surface-variant">
                    Belum ada pengeluaran kas tercatat pada periode ini.
                  </td>
                </tr>
              )}
              {pengeluaranData.map((row) => (
                <tr key={row.kategori} className="hover:bg-surface-container-low/50 transition-colors">
                  <td className="py-4 px-4">
                    <span className="text-sm font-semibold text-on-surface">{row.kategori}</span>
                  </td>
                  <td className="py-4 px-4 text-right">
                    <span className="text-sm font-mono text-on-surface-variant">{row.transaksi}</span>
                  </td>
                  <td className="py-4 px-4 text-right">
                    <span className="text-sm font-bold font-mono text-error">Rp {row.realisasi.toLocaleString("id-ID")}</span>
                  </td>
                  <td className="py-4 px-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-16 bg-surface-container-high h-2 rounded-full overflow-hidden">
                        <div className="h-full rounded-full bg-error" style={{ width: `${Math.min(row.porsi, 100)}%` }} />
                      </div>
                      <span className="text-xs font-bold text-on-surface">{row.porsi}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-surface-container-low">
              <tr>
                <td className="py-3 px-4 font-bold text-sm">Total</td>
                <td className="py-3 px-4 text-right font-bold font-mono text-sm">{totalTransaksi}</td>
                <td className="py-3 px-4 text-right font-bold font-mono text-sm text-error">Rp {totalPengeluaran.toLocaleString("id-ID")}</td>
                <td className="py-3 px-4 text-right font-bold text-sm">{totalPengeluaran ? 100 : 0}%</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <section className="bg-surface-container-lowest rounded-xl p-6 shadow-sm">
        <div className="flex items-center justify-between pb-4 mb-4 border-b border-surface-container-high">
          <div>
            <h2 className="text-lg font-bold text-on-surface">Ringkasan Kependudukan</h2>
            <p className="text-xs text-on-surface-variant mt-0.5">Data kependudukan {tenant.rtFull} per akhir {periode}</p>
          </div>
          <span className="material-symbols-outlined text-primary text-[24px]">groups</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          <div className="p-4 rounded-xl bg-surface-container-low text-center">
            <div className="text-2xl font-extrabold text-on-surface">{populasi.kk}</div>
            <div className="text-xs font-semibold text-on-surface-variant mt-1">Total KK</div>
          </div>
          <div className="p-4 rounded-xl bg-surface-container-low text-center">
            <div className="text-2xl font-extrabold text-on-surface">{populasi.jiwa}</div>
            <div className="text-xs font-semibold text-on-surface-variant mt-1">Total Jiwa</div>
          </div>
          <div className="p-4 rounded-xl bg-secondary-container/30 text-center">
            <div className="text-2xl font-extrabold text-secondary">{rekapHunian.terisi}</div>
            <div className="text-xs font-semibold text-on-surface-variant mt-1">Rumah Terisi</div>
          </div>
          <div className="p-4 rounded-xl bg-tertiary-container/30 text-center">
            <div className="text-2xl font-extrabold text-tertiary">{rekapHunian.multi}</div>
            <div className="text-xs font-semibold text-on-surface-variant mt-1">Multi-KK</div>
          </div>
          <div className="p-4 rounded-xl bg-primary-container/30 text-center">
            <div className="text-2xl font-extrabold text-primary">{wargaAktif}</div>
            <div className="text-xs font-semibold text-on-surface-variant mt-1">Portal Aktif</div>
          </div>
        </div>
      </section>

      <section className="bg-surface-container-lowest rounded-xl p-6 shadow-sm">
        <div className="flex items-center justify-between pb-4 mb-4 border-b border-surface-container-high">
          <div>
            <h2 className="text-lg font-bold text-on-surface">Ringkasan Persuratan</h2>
            <p className="text-xs text-on-surface-variant mt-0.5">Jumlah dokumen surat per status — {periode}</p>
          </div>
          <span className="material-symbols-outlined text-primary text-[24px]">mark_email_read</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          {persuratan.map((p) => (
            <div key={p.status} className="p-4 rounded-xl bg-surface-container-low text-center">
              <div className="text-2xl font-extrabold text-on-surface">{p.jumlah}</div>
              <div
                className={`mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold ${suratBadge[p.status]}`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-current opacity-60" />
                {p.status}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 pt-4 border-t border-surface-container-high text-xs text-on-surface-variant">
          Total <span className="font-bold text-on-surface">{surat.length}</span> dokumen surat tercatat &bull;{" "}
          <span className="font-bold text-on-surface">{persuratan.find((p) => p.status === "Menunggu RT")?.jumlah ?? 0}</span>{" "}
          menunggu persetujuan RT.
        </div>
      </section>

      <section className="bg-surface-container-lowest rounded-xl p-6 shadow-sm">
        <div className="flex items-center justify-between pb-4 mb-4 border-b border-surface-container-high">
          <div>
            <h2 className="text-lg font-bold text-on-surface">Grafik Kepatuhan Iuran</h2>
            <p className="text-xs text-on-surface-variant mt-0.5">Persentase ketercapaian per kategori — {periode}</p>
          </div>
          <span className="material-symbols-outlined text-tertiary text-[24px]">bar_chart</span>
        </div>
        <div className="space-y-4">
          {kepatuhanData.map((item) => (
            <div key={item.kategori} className="flex items-center gap-4">
              <span className="w-32 text-sm font-semibold text-on-surface shrink-0">{item.kategori}</span>
              <div className="flex-1 bg-surface-container-high h-4 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${item.persentase >= 90 ? "bg-secondary" : item.persentase >= 80 ? "bg-tertiary" : "bg-error"}`}
                  style={{ width: `${item.persentase}%` }}
                />
              </div>
              <span className={`w-14 text-right text-sm font-bold ${item.persentase >= 90 ? "text-secondary" : item.persentase >= 80 ? "text-tertiary" : "text-error"}`}>
                {item.persentase}%
              </span>
            </div>
          ))}
        </div>
        <div className="mt-6 pt-4 border-t border-surface-container-high flex items-center gap-4 text-xs text-on-surface-variant">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-secondary" />
            Baik (&ge;90%)
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-tertiary" />
            Cukup (&ge;80%)
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-error" />
            Kurang (&lt;80%)
          </div>
        </div>
      </section>
    </div>
  );
}
