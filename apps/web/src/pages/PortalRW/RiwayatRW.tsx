import { useState } from "react";
import { tenant } from "../../lib/tenant";
import {
  AuditEntry,
  KasRw,
  PermintaanAkses,
  downloadText,
  formatRupiah,
} from "../../lib/shared";
import { EmptyState } from "../../components/EmptyState";
import { useFlash } from "../../lib/useFlash";

interface RiwayatRWProps {
  onNavigate?: (page: string) => void;
  entries: AuditEntry[];
  akses: PermintaanAkses[];
  kasRw: KasRw[];
}

type FilterKategori = "all" | AuditEntry["kategori"];

const statusBadge: Record<PermintaanAkses["status"], string> = {
  Menunggu: "bg-primary-container text-on-primary-container",
  Disetujui: "bg-secondary-container text-on-secondary-container",
  Ditolak: "bg-error-container/40 text-on-error-container",
  "Diakses Direct": "bg-tertiary/20 text-tertiary",
};

const ITEMS_PER_PAGE = 10;

function escapeCsv(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function RiwayatRW({ onNavigate, entries, akses, kasRw }: RiwayatRWProps) {
  const [filterKategori, setFilterKategori] = useState<FilterKategori>("all");
  const [search, setSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const { flash, toast } = useFlash();


  // — Basis §7.6: hanya aktivitas portal RW —
  const basis = entries.filter((e) => e.portal === "rw");

  const jumlahAkses = basis.filter((e) => e.kategori === "akses").length;
  const jumlahSurat = basis.filter((e) => e.kategori === "surat").length;
  const jumlahKas = basis.filter((e) => e.kategori === "kas").length;

  const kpiData = [
    { label: "Total Log RW", value: basis.length, icon: "history", color: "bg-primary-container text-on-primary-container" },
    { label: "Permintaan Akses", value: jumlahAkses, icon: "key", color: "bg-tertiary-container text-on-tertiary-container" },
    { label: "Verifikasi Surat", value: jumlahSurat, icon: "draft", color: "bg-secondary-container text-on-secondary-container" },
    { label: "Transaksi Kas RW", value: jumlahKas, icon: "account_balance", color: "bg-error-container/40 text-on-error-container" },
  ];

  const chips: { id: FilterKategori; label: string; count: number }[] = [
    { id: "all", label: "Semua", count: basis.length },
    { id: "akses", label: "Permintaan Akses", count: jumlahAkses },
    { id: "surat", label: "Verifikasi Surat", count: jumlahSurat },
    { id: "kas", label: "Kas RW", count: jumlahKas },
  ];

  const filtered = basis.filter((row) => {
    const matchKategori = filterKategori === "all" || row.kategori === filterKategori;
    const q = search.trim().toLowerCase();
    const matchSearch =
      q === "" ||
      row.aksi.toLowerCase().includes(q) ||
      row.dataDiakses.toLowerCase().includes(q) ||
      row.detail.toLowerCase().includes(q);
    return matchKategori && matchSearch;
  });

  const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE);
  const paginatedData = filtered.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  function unduhLog() {
    const header = "Waktu,Pengguna,Aksi,Data Diakses,Detail,IP Address";
    const isi = [
      header,
      ...filtered.map((row) =>
        [row.waktu, row.user, row.aksi, row.dataDiakses, row.detail, row.ipAddress]
          .map(escapeCsv)
          .join(",")
      ),
    ].join("\n");
    downloadText("riwayat-aktivitas-rw.csv", isi);
    flash(`${filtered.length} entri log yang sedang tampil berhasil diunduh (CSV).`);
  }

  const kasTerakhir = kasRw.slice(-3).reverse();

  return (
    <div className="max-w-7xl mx-auto w-full space-y-6">
      {toast}

      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-sm text-on-surface-variant">
        <button type="button" className="hover:text-primary transition-colors flex items-center gap-1" onClick={() => onNavigate?.("dashboard-rw")}><span className="material-symbols-outlined text-[16px]">home</span>
          Portal RW
        </button>
        <span className="material-symbols-outlined text-[14px]">chevron_right</span>
        <span className="font-bold text-on-surface">Riwayat Aktivitas RW</span>
      </div>

      {/* Judul & aksi */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div className="max-w-3xl space-y-1.5">
          <div className="inline-flex items-center gap-1.5 text-primary text-sm font-bold uppercase tracking-wider">
            <span className="material-symbols-outlined text-[16px]">manage_search</span>
            Jejak Aktivitas &amp; Akuntabilitas
          </div>
          <h1 className="text-2xl lg:text-[32px] text-on-surface tracking-tight font-extrabold">
            Riwayat Aktivitas RW
          </h1>
          <p className="text-sm text-on-surface-variant leading-relaxed">
            Rekam jejak tingkat {tenant.rwFull}: permintaan akses data RT, verifikasi surat, dan
            transaksi Buku Kas RW dalam satu log permanen.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <button
            className="h-11 px-5 rounded-xl bg-surface-container-lowest text-on-surface text-sm shadow-sm border border-outline-variant hover:shadow-md hover:bg-surface-container-low transition-all flex items-center gap-2"
            onClick={unduhLog}
          >
            <span className="material-symbols-outlined text-primary text-[20px]">download</span>
            Unduh Log CSV
          </button>
        </div>
      </div>

      {/* Keterangan: permanen / append-only */}
      <div className="p-4 rounded-xl bg-tertiary-container/30 border border-tertiary-container flex items-start gap-3">
        <span className="material-symbols-outlined text-tertiary text-[20px] shrink-0 mt-0.5">lock</span>
        <p className="text-sm text-on-surface leading-relaxed">
          Log bersifat <b>permanen dan append-only</b> — seluruh aktivitas portal RW tercatat
          otomatis dan tidak dapat diubah atau dihapus.
        </p>
      </div>

      {/* KPI per kategori (dari basis portal RW) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpiData.map((kpi) => (
          <div
            key={kpi.label}
            className="bg-surface-container-lowest rounded-xl p-5 shadow-sm flex flex-col justify-between"
          >
            <div className="flex items-start justify-between">
              <span className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">
                {kpi.label}
              </span>
              <div className={`w-10 h-10 rounded-full ${kpi.color} flex items-center justify-center`}>
                <span className="material-symbols-outlined text-[22px]">{kpi.icon}</span>
              </div>
            </div>
            <div className="mt-4">
              <div className="text-2xl font-extrabold text-on-surface font-mono">{kpi.value}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Filter chips + search */}
      <div className="flex flex-col lg:flex-row items-stretch lg:items-center gap-3 p-4 rounded-xl bg-surface-container-lowest shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          {chips.map((chip) => {
            const active = filterKategori === chip.id;
            return (
              <button
                key={chip.id}
                className={`h-9 px-4 rounded-full text-xs font-bold transition-all inline-flex items-center gap-1.5 ${
                  active
                    ? "bg-primary-container text-on-primary-container shadow-sm"
                    : "bg-surface-container-low text-on-surface-variant hover:bg-surface-container"
                }`}
                onClick={() => {
                  setFilterKategori(chip.id);
                  setCurrentPage(1);
                }}
              >
                {chip.label}
                <span
                  className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                    active ? "bg-surface-container-lowest text-on-primary-container" : "bg-surface-container-high text-on-surface-variant"
                  }`}
                >
                  {chip.count}
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex-1" />
        <div className="relative lg:w-72">
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 material-symbols-outlined text-on-surface-variant text-[20px]">
            search
          </span>
          <input
            className="w-full h-11 pl-11 pr-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all"
            placeholder="Cari aksi, data, atau detail..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setCurrentPage(1);
            }}
          />
        </div>
      </div>

      {/* Tabel log */}
      <div className="bg-surface-container-lowest rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-on-surface">
            <thead className="bg-surface-container-low text-xs text-on-surface-variant uppercase tracking-wider">
              <tr>
                <th className="py-3 px-4">Waktu</th>
                <th className="py-3 px-4">Pengguna</th>
                <th className="py-3 px-4">Aksi</th>
                <th className="py-3 px-4">Data Diakses</th>
                <th className="py-3 px-4">Detail</th>
                <th className="py-3 px-4">IP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-container-high">
              {paginatedData.map((row) => (
                <tr key={row.id} className="hover:bg-surface-container-low/50 transition-colors">
                  <td className="py-4 px-4">
                    <span className="text-xs text-on-surface-variant whitespace-nowrap">{row.waktu}</span>
                  </td>
                  <td className="py-4 px-4">
                    <span className="text-sm font-semibold text-on-surface">{row.user}</span>
                  </td>
                  <td className="py-4 px-4">
                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${row.aksiBadge}`}
                    >
                      <span className="w-2 h-2 rounded-full bg-current opacity-60" />
                      {row.aksi}
                    </span>
                  </td>
                  <td className="py-4 px-4">
                    <span className="text-sm text-on-surface">{row.dataDiakses}</span>
                  </td>
                  <td className="py-4 px-4">
                    <span className="text-xs text-on-surface-variant">{row.detail}</span>
                  </td>
                  <td className="py-4 px-4">
                    <span className="text-xs font-mono text-on-surface-variant">{row.ipAddress}</span>
                  </td>
                </tr>
              ))}
              {paginatedData.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-on-surface-variant text-sm">
                    Tidak ada log aktivitas yang cocok dengan filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="px-6 py-3 border-t border-surface-container-high flex items-center justify-between text-xs text-on-surface-variant">
          <span>
            Menampilkan {paginatedData.length > 0 ? (currentPage - 1) * ITEMS_PER_PAGE + 1 : 0}-
            {Math.min(currentPage * ITEMS_PER_PAGE, filtered.length)} dari {filtered.length} entri
          </span>
          <div className="flex items-center gap-2">
            <button
              className="h-8 px-3 rounded-lg bg-surface-container-low text-on-surface-variant hover:bg-surface-container disabled:opacity-40 disabled:cursor-not-allowed text-xs font-semibold inline-flex items-center gap-1 transition-colors"
              disabled={currentPage === 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            >
              <span className="material-symbols-outlined text-[14px]">chevron_left</span>
              Sebelumnya
            </button>
            <span className="font-semibold">Halaman {currentPage} dari {totalPages || 1}</span>
            <button
              className="h-8 px-3 rounded-lg bg-surface-container-low text-on-surface-variant hover:bg-surface-container disabled:opacity-40 disabled:cursor-not-allowed text-xs font-semibold inline-flex items-center gap-1 transition-colors"
              disabled={currentPage >= totalPages}
              onClick={() => setCurrentPage((p) => Math.min(totalPages || 1, p + 1))}
            >
              Berikutnya
              <span className="material-symbols-outlined text-[14px]">chevron_right</span>
            </button>
          </div>
        </div>
      </div>

      {/* Ringkasan sekunder: permintaan akses + kas RW terakhir */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Permintaan akses terakhir */}
        <div className="bg-surface-container-lowest rounded-xl shadow-sm p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-primary text-[20px]">key</span>
              <h3 className="text-sm font-bold text-on-surface uppercase tracking-wider">
                Permintaan Akses Terakhir
              </h3>
            </div>
            <span className="text-xs font-bold text-on-surface-variant font-mono">{akses.length}</span>
          </div>

          {akses.length === 0 && (
            <EmptyState
              icon="manage_accounts"
              judul="Belum ada permintaan akses"
              pesan="Permintaan akses data terperinci dari Pengurus RT akan tampil di sini."
            />
          )}

          {akses.map((a) => (
            <div
              key={a.id}
              className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl bg-surface-container-low"
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm font-bold text-on-surface">
                  {a.rtTujuan}
                  <span className="text-xs font-normal text-on-surface-variant"> &bull; {a.tanggal}</span>
                </div>
                <div className="text-xs text-on-surface-variant truncate">{a.lingkup}</div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold border ${
                    a.mode === "direct"
                      ? "border-tertiary/50 text-tertiary"
                      : "border-outline-variant text-on-surface-variant"
                  }`}
                >
                  <span className="material-symbols-outlined text-[12px]">
                    {a.mode === "direct" ? "bolt" : "how_to_reg"}
                  </span>
                  {a.mode === "direct" ? "Direct" : "Approval"}
                </span>
                <span
                  className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold ${statusBadge[a.status]}`}
                >
                  {a.status}
                </span>
              </div>
            </div>
          ))}

          <p className="text-[11px] text-on-surface-variant pt-1">
            Mode <b>Direct</b> wajib berjustifikasi minimal 20 karakter dan tercatat pada log di
            atas (§7.5).
          </p>
        </div>

        {/* Transaksi Kas RW terakhir */}
        <div className="bg-surface-container-lowest rounded-xl shadow-sm p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-primary text-[20px]">account_balance</span>
              <h3 className="text-sm font-bold text-on-surface uppercase tracking-wider">
                Transaksi Kas RW Terakhir
              </h3>
            </div>
            <span className="text-xs font-bold text-on-surface-variant font-mono">
              {kasRw.length}
            </span>
          </div>

          {kasTerakhir.length === 0 && (
            <EmptyState
              icon="receipt_long"
              judul="Belum ada transaksi kas RW"
              pesan="Pemasukan dan pengeluaran kas RW pada periode ini belum tercatat."
            />
          )}

          {kasTerakhir.map((k) => (
            <div
              key={k.id}
              className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl bg-surface-container-low"
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-on-surface truncate">{k.keterangan}</div>
                <div className="text-[11px] text-on-surface-variant">
                  {k.tanggal} &bull; {k.kategori} &bull; {k.tipe}
                </div>
              </div>
              <span
                className={`text-sm font-extrabold font-mono shrink-0 ${
                  k.tipe === "Pemasukan" ? "text-secondary" : "text-error"
                }`}
              >
                {k.tipe === "Pemasukan" ? "+" : "-"}
                {formatRupiah(k.nominal)}
              </span>
            </div>
          ))}

          <div className="flex items-center justify-between p-3 rounded-xl bg-primary-container/30">
            <span className="text-xs font-bold text-on-surface uppercase tracking-wider">
              Saldo Akhir
            </span>
            <span className="text-sm font-extrabold font-mono text-on-surface">
              {formatRupiah(kasRw[kasRw.length - 1]?.saldo ?? 0)}
            </span>
          </div>

          <p className="text-[11px] text-on-surface-variant pt-1">
            Buku Kas RW bersifat append-only dan terpisah dari Kas RT (§7.3).
          </p>
        </div>
      </div>
    </div>
  );
}
