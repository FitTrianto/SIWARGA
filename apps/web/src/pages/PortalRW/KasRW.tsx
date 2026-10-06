import { useState } from "react";
import { tenant } from "../../lib/tenant";
import { KasRw, downloadText, formatRupiah, hariIni, kasRwKategori } from "../../lib/shared";
import { useFlash } from "../../lib/useFlash";

interface KasRWProps {
  onNavigate?: (page: string) => void;
  kasRw: KasRw[];
  onTambah: (t: Omit<KasRw, "id" | "saldo">) => void;
}

type TipeFilter = "all" | KasRw["tipe"];

const tipeBadge: Record<KasRw["tipe"], string> = {
  Pemasukan: "bg-secondary-container text-on-secondary-container",
  Pengeluaran: "bg-error-container/40 text-on-error-container",
};

function escapeCsv(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function KasRW({ onNavigate, kasRw, onTambah }: KasRWProps) {
  const [filterKategori, setFilterKategori] = useState("all");
  const [filterTipe, setFilterTipe] = useState<TipeFilter>("all");
  const [showFormModal, setShowFormModal] = useState(false);
  const [detailRow, setDetailRow] = useState<KasRw | null>(null);
  const { flash, toast } = useFlash();

  const emptyForm = {
    tipe: "Pemasukan" as KasRw["tipe"],
    tanggal: hariIni(),
    kategori: kasRwKategori[0],
    keterangan: "",
    nominal: "",
  };
  const [form, setForm] = useState(emptyForm);


  // — Prinsip APPEND-ONLY (§7.3): hanya menambah, tanpa edit/hapus baris —
  function handleSimpan(e: React.FormEvent) {
    e.preventDefault();
    const nominal = Number(form.nominal);
    if (!form.tanggal.trim()) return flash("Tanggal transaksi wajib diisi.");
    if (!form.keterangan.trim()) return flash("Keterangan transaksi wajib diisi.");
    if (!nominal || nominal <= 0) return flash("Nominal transaksi harus lebih dari 0.");
    onTambah({
      tanggal: form.tanggal.trim(),
      keterangan: form.keterangan.trim(),
      kategori: form.kategori,
      tipe: form.tipe,
      nominal,
    });
    flash(
      `${form.tipe} "${form.keterangan.trim()}" sebesar ${formatRupiah(nominal)} dicatat di sesi ini — Buku Kas RW belum tersimpan di server (Portal RW belum punya backend).`
    );
    setShowFormModal(false);
    setForm({ ...emptyForm, tanggal: hariIni() });
  }

  function bukaModal() {
    setForm({ ...emptyForm, tanggal: hariIni() });
    setShowFormModal(true);
  }

  function unduhCsv() {
    const header = "Tanggal,Keterangan,Kategori,Tipe,Nominal,Saldo";
    const isi = [
      header,
      ...kasRw.map((row) =>
        [
          row.tanggal,
          row.keterangan,
          row.kategori,
          row.tipe,
          `${row.tipe === "Pemasukan" ? "+" : "-"}${row.nominal}`,
          row.saldo,
        ]
          .map((v) => escapeCsv(String(v)))
          .join(",")
      ),
    ].join("\n");
    downloadText(`kas-rw-${tenant.rw}.csv`, isi);
    flash(`${kasRw.length} transaksi Buku Kas RW berhasil diunduh (CSV).`);
  }

  const filtered = kasRw.filter((row) => {
    const matchKategori = filterKategori === "all" || row.kategori === filterKategori;
    const matchTipe = filterTipe === "all" || row.tipe === filterTipe;
    return matchKategori && matchTipe;
  });

  const saldoAkhir = kasRw[kasRw.length - 1]?.saldo ?? 0;
  const totalPemasukan = kasRw
    .filter((r) => r.tipe === "Pemasukan")
    .reduce((sum, r) => sum + r.nominal, 0);
  const totalPengeluaran = kasRw
    .filter((r) => r.tipe === "Pengeluaran")
    .reduce((sum, r) => sum + r.nominal, 0);

  const kpiData = [
    { label: "Saldo Akhir", value: formatRupiah(saldoAkhir), icon: "account_balance_wallet", color: "bg-primary-container text-on-primary-container" },
    { label: "Total Pemasukan", value: formatRupiah(totalPemasukan), icon: "trending_up", color: "bg-secondary-container text-on-secondary-container" },
    { label: "Total Pengeluaran", value: formatRupiah(totalPengeluaran), icon: "trending_down", color: "bg-error-container/40 text-on-error-container" },
    { label: "Jumlah Transaksi", value: String(kasRw.length), icon: "receipt_long", color: "bg-tertiary-container text-on-tertiary-container" },
  ];

  return (
    <div className="max-w-7xl mx-auto w-full space-y-6">
      {toast}

      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-sm text-on-surface-variant">
        <button type="button" className="hover:text-primary transition-colors flex items-center gap-1" onClick={() => onNavigate?.("dashboard-rw")}><span className="material-symbols-outlined text-[16px]">home</span>
          Portal RW
        </button>
        <span className="material-symbols-outlined text-[14px]">chevron_right</span>
        <span className="font-bold text-on-surface">Buku Kas RW</span>
      </div>

      {/* Judul & aksi utama */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div className="max-w-3xl space-y-1.5">
          <div className="inline-flex items-center gap-1.5 text-primary text-sm font-bold uppercase tracking-wider">
            <span className="material-symbols-outlined text-[16px]">account_balance</span>
            Manajemen Keuangan RW
          </div>
          <h1 className="text-2xl lg:text-[32px] text-on-surface tracking-tight font-extrabold">
            Buku Kas RW
          </h1>
          <p className="text-sm text-on-surface-variant leading-relaxed">
            Buku kas {tenant.rwFull} yang tercatat terpisah dari Kas RT — pantau pemasukan dan
            pengeluaran tingkat RW secara transparan dan permanen.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <button
            className="h-11 px-5 rounded-xl bg-primary text-on-primary text-sm font-bold shadow-md hover:bg-primary-container active:scale-[0.98] transition-all flex items-center gap-2"
            onClick={bukaModal}
          >
            <span className="material-symbols-outlined text-[20px]">add</span>
            + Catat Transaksi
          </button>
        </div>
      </div>

      {/* Banner prinsip append-only (§7.3) */}
      <div className="p-4 rounded-xl bg-tertiary-container/30 border border-tertiary-container flex items-start gap-3">
        <span className="material-symbols-outlined text-tertiary text-[22px] shrink-0 mt-0.5">lock</span>
        <div className="flex-1 space-y-1">
          <p className="text-sm text-on-surface leading-relaxed font-semibold">
            Buku kas bersifat append-only — transaksi yang sudah dicatat tidak dapat diubah atau
            dihapus. Koreksi dilakukan dengan transaksi koreksi baru.
          </p>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-container-lowest text-on-surface-variant text-[11px] font-bold uppercase tracking-wider">
            <span className="material-symbols-outlined text-[14px]">history</span>
            Append-Only &bull; Terpisah dari Kas RT
          </span>
        </div>
      </div>

      {/* KPI */}
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
              <div className="text-2xl font-extrabold text-on-surface font-mono break-words">{kpi.value}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Filter & export */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 p-4 rounded-xl bg-surface-container-lowest shadow-sm">
        <select
          className="h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all"
          value={filterKategori}
          onChange={(e) => setFilterKategori(e.target.value)}
          aria-label="Filter kategori"
        >
          <option value="all">Semua Kategori</option>
          {kasRwKategori.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <select
          className="h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all"
          value={filterTipe}
          onChange={(e) => setFilterTipe(e.target.value as TipeFilter)}
          aria-label="Filter tipe"
        >
          <option value="all">Semua Tipe</option>
          <option value="Pemasukan">Pemasukan</option>
          <option value="Pengeluaran">Pengeluaran</option>
        </select>
        {(filterKategori !== "all" || filterTipe !== "all") && (
          <button
            className="h-11 px-4 rounded-xl text-sm text-on-surface-variant hover:bg-surface-container-high transition-colors flex items-center gap-1.5"
            onClick={() => {
              setFilterKategori("all");
              setFilterTipe("all");
            }}
          >
            <span className="material-symbols-outlined text-[18px]">filter_alt_off</span>
            Reset Filter
          </button>
        )}
        <div className="flex-1" />
        <button
          className="h-11 px-5 rounded-xl bg-surface-container-lowest text-on-surface text-sm shadow-sm border border-outline-variant hover:shadow-md hover:bg-surface-container-low transition-all flex items-center gap-2"
          onClick={unduhCsv}
        >
          <span className="material-symbols-outlined text-primary text-[20px]">download</span>
          Unduh CSV
        </button>
      </div>

      {/* Tabel transaksi — tanpa edit/hapus (append-only) */}
      <div className="bg-surface-container-lowest rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-on-surface">
            <thead className="bg-surface-container-low text-xs text-on-surface-variant uppercase tracking-wider">
              <tr>
                <th className="py-3 px-4">Tanggal</th>
                <th className="py-3 px-4">Keterangan</th>
                <th className="py-3 px-4">Kategori</th>
                <th className="py-3 px-4">Tipe</th>
                <th className="py-3 px-4 text-right">Nominal</th>
                <th className="py-3 px-4 text-right">Saldo</th>
                <th className="py-3 px-4 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-container-high">
              {filtered.map((row) => (
                <tr key={row.id} className="hover:bg-surface-container-low/50 transition-colors">
                  <td className="py-4 px-4">
                    <span className="text-xs text-on-surface-variant whitespace-nowrap">{row.tanggal}</span>
                  </td>
                  <td className="py-4 px-4">
                    <span className="text-sm font-semibold text-on-surface">{row.keterangan}</span>
                  </td>
                  <td className="py-4 px-4">
                    <span className="text-xs text-on-surface-variant">{row.kategori}</span>
                  </td>
                  <td className="py-4 px-4">
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${tipeBadge[row.tipe]}`}>
                      <span className="w-2 h-2 rounded-full bg-current opacity-60" />
                      {row.tipe}
                    </span>
                  </td>
                  <td className="py-4 px-4 text-right">
                    <span className={`text-sm font-extrabold font-mono ${row.tipe === "Pemasukan" ? "text-secondary" : "text-error"}`}>
                      {row.tipe === "Pemasukan" ? "+" : "-"}
                      {formatRupiah(row.nominal)}
                    </span>
                  </td>
                  <td className="py-4 px-4 text-right">
                    <span className="text-sm font-bold text-on-surface font-mono">{formatRupiah(row.saldo)}</span>
                  </td>
                  <td className="py-4 px-4 text-right">
                    <button
                      className="h-8 px-3 rounded-lg bg-surface-container-low text-on-surface-variant hover:text-primary hover:bg-surface-container text-xs font-semibold inline-flex items-center gap-1 transition-colors"
                      onClick={() => setDetailRow(row)}
                    >
                      <span className="material-symbols-outlined text-[14px]">visibility</span>
                      Detail
                    </button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-on-surface-variant text-sm">
                    Tidak ada transaksi kas RW yang cocok dengan filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="px-6 py-3 border-t border-surface-container-high flex items-center justify-between text-xs text-on-surface-variant">
          <span>
            Menampilkan {filtered.length} dari {kasRw.length} transaksi
          </span>
          <span className="font-semibold">Buku append-only</span>
        </div>
      </div>

      {/* Catatan: terpisah dari Kas RT */}
      <div className="p-4 rounded-xl bg-surface-container-lowest shadow-sm flex items-start gap-3 border-l-4 border-primary">
        <span className="material-symbols-outlined text-primary text-[20px] shrink-0 mt-0.5">apartment</span>
        <p className="text-sm text-on-surface-variant leading-relaxed">
          <span className="font-bold text-on-surface">Catatan:</span> buku kas ini terpisah dari Kas
          RT. Kas RT dikelola mandiri oleh masing-masing Pengurus RT dan tidak digabungkan ke dalam
          Buku Kas RW.
        </p>
      </div>

      {/* Modal: catat transaksi */}
      {showFormModal && (
        <div className="fixed inset-0 z-50 bg-on-background/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg mx-4 sm:mx-auto rounded-2xl bg-surface-container-lowest shadow-2xl p-6 flex flex-col gap-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary-container flex items-center justify-center text-on-primary-container">
                  <span className="material-symbols-outlined text-[22px]">add_circle</span>
                </div>
                <div>
                  <h3 className="text-base font-bold text-on-surface">Catat Transaksi</h3>
                  <p className="text-xs text-on-surface-variant">Buku Kas {tenant.rwFull} — append-only</p>
                </div>
              </div>
              <button
                className="w-8 h-8 rounded-lg bg-surface-container flex items-center justify-center text-on-surface-variant hover:text-on-surface"
                onClick={() => setShowFormModal(false)}
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <form onSubmit={handleSimpan} className="flex flex-col gap-4">
              {/* Segmented tipe transaksi */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[16px] text-on-surface-variant">swap_horiz</span>
                  Tipe Transaksi
                </label>
                <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-surface-container-low">
                  {(["Pemasukan", "Pengeluaran"] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setForm({ ...form, tipe: t })}
                      className={`h-10 rounded-lg text-sm font-bold transition-all flex items-center justify-center gap-1.5 ${
                        form.tipe === t
                          ? t === "Pemasukan"
                            ? "bg-secondary-container text-on-secondary-container shadow-sm"
                            : "bg-error-container/40 text-on-error-container shadow-sm"
                          : "text-on-surface-variant hover:bg-surface-container-lowest"
                      }`}
                    >
                      <span className="material-symbols-outlined text-[18px]">
                        {t === "Pemasukan" ? "trending_up" : "trending_down"}
                      </span>
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-on-surface flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[16px] text-on-surface-variant">calendar_month</span>
                    Tanggal
                  </label>
                  <input
                    className="w-full h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all"
                    type="text"
                    placeholder="cth: 24 Sep 2026"
                    value={form.tanggal}
                    onChange={(e) => setForm({ ...form, tanggal: e.target.value })}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-on-surface flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[16px] text-on-surface-variant">category</span>
                    Kategori
                  </label>
                  <select
                    className="w-full h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all"
                    value={form.kategori}
                    onChange={(e) => setForm({ ...form, kategori: e.target.value })}
                  >
                    {kasRwKategori.map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[16px] text-on-surface-variant">description</span>
                  Keterangan
                </label>
                <input
                  className="w-full h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all"
                  type="text"
                  placeholder="cth: Retribusi Lapak Pasar RW"
                  value={form.keterangan}
                  onChange={(e) => setForm({ ...form, keterangan: e.target.value })}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[16px] text-on-surface-variant">paid</span>
                  Nominal (Rp)
                </label>
                <input
                  className="w-full h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface font-mono focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all"
                  type="number"
                  min={1}
                  placeholder="0"
                  value={form.nominal}
                  onChange={(e) => setForm({ ...form, nominal: e.target.value })}
                />
              </div>

              <div className="p-3 rounded-xl bg-tertiary-container/20 flex items-start gap-2">
                <span className="material-symbols-outlined text-tertiary text-[16px] shrink-0 mt-0.5">lock</span>
                <p className="text-xs text-on-surface leading-relaxed">
                  Transaksi yang disimpan bersifat permanen (append-only) dan tidak dapat diubah atau
                  dihapus. Untuk koreksi, catat transaksi baru dengan kategori <b>Koreksi</b>.
                </p>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2 border-t border-surface-container-high">
                <button
                  type="button"
                  className="h-11 px-4 rounded-xl text-on-surface-variant text-sm hover:bg-surface-container-high transition-colors"
                  onClick={() => setShowFormModal(false)}
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="h-11 px-6 rounded-xl bg-primary text-on-primary text-sm font-bold shadow-md hover:bg-primary-container active:scale-[0.98] transition-all flex items-center gap-2"
                >
                  <span className="material-symbols-outlined text-[18px]">save</span>
                  Simpan Transaksi
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal detail read-only (tanpa edit/hapus) */}
      {detailRow && (
        <div className="fixed inset-0 z-50 bg-on-background/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg mx-4 sm:mx-auto rounded-2xl bg-surface-container-lowest shadow-2xl p-6 flex flex-col gap-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary-container flex items-center justify-center text-on-primary-container">
                  <span className="material-symbols-outlined text-[22px]">receipt_long</span>
                </div>
                <div>
                  <h3 className="text-base font-bold text-on-surface">Detail Transaksi</h3>
                  <p className="text-xs text-on-surface-variant">Buku Kas {tenant.rwFull} — hanya baca</p>
                </div>
              </div>
              <button
                className="w-8 h-8 rounded-lg bg-surface-container flex items-center justify-center text-on-surface-variant hover:text-on-surface"
                onClick={() => setDetailRow(null)}
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-xl bg-surface-container-low">
                <div className="text-[11px] text-on-surface-variant uppercase tracking-wider font-semibold">ID Transaksi</div>
                <div className="text-sm font-semibold text-on-surface font-mono mt-0.5">{detailRow.id}</div>
              </div>
              <div className="p-3 rounded-xl bg-surface-container-low">
                <div className="text-[11px] text-on-surface-variant uppercase tracking-wider font-semibold">Tanggal</div>
                <div className="text-sm font-semibold text-on-surface mt-0.5">{detailRow.tanggal}</div>
              </div>
              <div className="p-3 rounded-xl bg-surface-container-low">
                <div className="text-[11px] text-on-surface-variant uppercase tracking-wider font-semibold">Kategori</div>
                <div className="text-sm font-semibold text-on-surface mt-0.5">{detailRow.kategori}</div>
              </div>
              <div className="p-3 rounded-xl bg-surface-container-low">
                <div className="text-[11px] text-on-surface-variant uppercase tracking-wider font-semibold">Tipe</div>
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold mt-1 ${tipeBadge[detailRow.tipe]}`}>
                  <span className="w-2 h-2 rounded-full bg-current opacity-60" />
                  {detailRow.tipe}
                </span>
              </div>
              <div className="p-3 rounded-xl bg-surface-container-low col-span-2">
                <div className="text-[11px] text-on-surface-variant uppercase tracking-wider font-semibold">Keterangan</div>
                <div className="text-sm font-semibold text-on-surface mt-0.5">{detailRow.keterangan}</div>
              </div>
              <div className={`p-3 rounded-xl ${detailRow.tipe === "Pemasukan" ? "bg-secondary-container/30" : "bg-error-container/20"}`}>
                <div className="text-[11px] text-on-surface-variant uppercase tracking-wider font-semibold">Nominal</div>
                <div className={`text-sm font-extrabold font-mono mt-0.5 ${detailRow.tipe === "Pemasukan" ? "text-secondary" : "text-error"}`}>
                  {detailRow.tipe === "Pemasukan" ? "+" : "-"}
                  {formatRupiah(detailRow.nominal)}
                </div>
              </div>
              <div className="p-3 rounded-xl bg-primary-container/30">
                <div className="text-[11px] text-on-surface-variant uppercase tracking-wider font-semibold">Saldo Setelah</div>
                <div className="text-sm font-extrabold font-mono text-on-surface mt-0.5">{formatRupiah(detailRow.saldo)}</div>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-tertiary-container/20 flex items-start gap-2">
              <span className="material-symbols-outlined text-tertiary text-[16px] shrink-0 mt-0.5">lock</span>
              <p className="text-xs text-on-surface leading-relaxed">
                Entri ini bersifat append-only: tanpa tombol ubah/hapus. Koreksi dilakukan dengan
                mencatat transaksi koreksi baru.
              </p>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2 border-t border-surface-container-high">
              <button
                type="button"
                className="h-11 px-6 rounded-xl bg-primary text-on-primary text-sm font-bold shadow-md hover:bg-primary-container active:scale-[0.98] transition-all flex items-center gap-2"
                onClick={() => setDetailRow(null)}
              >
                <span className="material-symbols-outlined text-[18px]">check</span>
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
