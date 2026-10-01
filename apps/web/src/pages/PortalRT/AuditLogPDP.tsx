import { useState } from "react";
import { tenant } from "../../lib/tenant";
import { AuditEntry, PermintaanAkses, downloadText, labelPortal } from "../../lib/shared";
import { EmptyState } from "../../components/EmptyState";
import { useFlash } from "../../lib/useFlash";

interface AuditLogPDPProps {
  onNavigate?: (page: string) => void;
  entries: AuditEntry[];
  aksesList: PermintaanAkses[];
  onPutusAkses: (id: string, status: "Disetujui" | "Ditolak", catatan?: string) => void;
}

/** Filter berbasis kategori entri (data bersama memakai kategori, bukan aksi tetap). */
type KategoriFilter = "all" | "data" | "akses" | "surat" | "kas";

const kategoriLabel: Record<KategoriFilter, string> = {
  all: "Semua",
  data: "Data Warga",
  akses: "Akses",
  surat: "Surat",
  kas: "Kas",
};

const statusAksesBadge: Record<string, string> = {
  Menunggu: "bg-primary-container text-on-primary-container",
  Disetujui: "bg-secondary-container text-on-secondary-container",
  Ditolak: "bg-error-container/40 text-on-error-container",
  "Diakses Direct": "bg-tertiary/20 text-tertiary",
};

const BULAN_KE_ISO: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", Mei: "05", Jun: "06",
  Jul: "07", Agu: "08", Sep: "09", Okt: "10", Nov: "11", Des: "12",
};

/** "14 Sep 2026, 09:15" → "2026-09-14" (untuk filter rentang tanggal). */
function waktuKeISO(waktu: string): string {
  const m = waktu.match(/^(\d{2}) (\w{3}) (\d{4})/);
  if (!m) return "";
  const bulan = BULAN_KE_ISO[m[2]] ?? "01";
  return `${m[3]}-${bulan}-${m[1]}`;
}

const ITEMS_PER_PAGE = 10;

export function AuditLogPDP({ onNavigate, entries, aksesList, onPutusAkses }: AuditLogPDPProps) {
  const [search, setSearch] = useState("");
  const [filterKategori, setFilterKategori] = useState<KategoriFilter>("all");
  const [filterUser, setFilterUser] = useState("all");
  const [filterTanggalAwal, setFilterTanggalAwal] = useState("");
  const [filterTanggalAkhir, setFilterTanggalAkhir] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [detailRow, setDetailRow] = useState<AuditEntry | null>(null);
  const [tolakAkses, setTolakAkses] = useState<PermintaanAkses | null>(null);
  const [catatanAkses, setCatatanAkses] = useState("");
  const { flash, toast } = useFlash();


  function escapeCsv(v: string): string {
    return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  }

  function unduhLog() {
    const header = "Waktu,User,Jenis Aksi,Data yang Diakses,Detail,IP Address,Portal";
    const isi = [
      header,
      ...filtered.map((row) =>
        [row.waktu, row.user, row.aksi, row.dataDiakses, row.detail, row.ipAddress, row.portal.toUpperCase()].map(escapeCsv).join(",")
      ),
    ].join("\n");
    downloadText("audit-log-pdp.csv", isi);
    flash(`${filtered.length} entri audit log tersaring berhasil diunduh (CSV).`);
  }

  // Opsi user diambil dinamis dari entri (termasuk Pengurus RW).
  const userOptions = Array.from(new Set(entries.map((e) => e.user)));

  const filtered = entries.filter((row) => {
    const matchSearch =
      search === "" ||
      row.user.toLowerCase().includes(search.toLowerCase()) ||
      row.dataDiakses.toLowerCase().includes(search.toLowerCase()) ||
      row.detail.toLowerCase().includes(search.toLowerCase());
    const matchKategori = filterKategori === "all" || row.kategori === filterKategori;
    const matchUser = filterUser === "all" || row.user === filterUser;
    const rowISO = waktuKeISO(row.waktu);
    const matchAwal = filterTanggalAwal === "" || rowISO >= filterTanggalAwal;
    const matchAkhir = filterTanggalAkhir === "" || rowISO <= filterTanggalAkhir;
    return matchSearch && matchKategori && matchUser && matchAwal && matchAkhir;
  });

  const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE);
  const paginatedData = filtered.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  function setujuiAkses(a: PermintaanAkses) {
    onPutusAkses(a.id, "Disetujui");
    flash(`Permintaan akses ${a.rtTujuan} (${a.lingkup}) disetujui.`);
  }

  function bukaTolakAkses(a: PermintaanAkses) {
    setCatatanAkses("");
    setTolakAkses(a);
  }

  function konfirmasiTolakAkses() {
    if (!tolakAkses) return;
    if (!catatanAkses.trim()) {
      flash("Catatan wajib diisi untuk menolak permintaan akses.");
      return;
    }
    onPutusAkses(tolakAkses.id, "Ditolak", catatanAkses.trim());
    flash(`Permintaan akses ${tolakAkses.rtTujuan} ditolak dan tercatat di audit log.`);
    setTolakAkses(null);
    setCatatanAkses("");
  }

  return (
    <div className="max-w-7xl mx-auto w-full space-y-6">
      {toast}

      <div className="flex items-center gap-1.5 text-sm text-on-surface-variant">
        <button type="button" className="hover:text-primary transition-colors flex items-center gap-1" onClick={() => onNavigate?.("dashboard-rt")}><span className="material-symbols-outlined text-[16px]">home</span>
          Portal RT
        </button>
        <span className="material-symbols-outlined text-[14px]">chevron_right</span>
        <span className="font-bold text-on-surface">Audit Log PDP</span>
      </div>

      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div className="max-w-3xl space-y-1.5">
          <div className="inline-flex items-center gap-1.5 text-primary text-sm font-bold uppercase tracking-wider">
            <span className="material-symbols-outlined text-[16px]">shield</span>
            Kepatuhan Regulasi
          </div>
          <h1 className="text-2xl lg:text-[32px] text-on-surface tracking-tight font-extrabold">
            Audit Log & Kepatuhan UU PDP {tenant.label}
          </h1>
          <div className="flex items-center gap-2 mt-1">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-secondary-container text-on-secondary-container text-xs font-bold">
              <span className="material-symbols-outlined text-[14px]" style={{ fontVariationSettings: "'FILL' 1" }}>verified_user</span>
              UU No. 27/2022
            </span>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-tertiary/20 text-tertiary text-xs font-bold">
              <span className="material-symbols-outlined text-[14px]">hub</span>
              Termasuk akses Portal RW
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <button
            className="h-11 px-5 rounded-xl bg-surface-container-lowest text-on-surface text-sm shadow-sm hover:shadow-md hover:bg-surface-container transition-all flex items-center gap-2"
            onClick={unduhLog}
          >
            <span className="material-symbols-outlined text-primary text-[20px]">download</span>
            Unduh Log
          </button>
        </div>
      </div>

      <div className="p-4 rounded-xl bg-secondary-container/20 border border-secondary-container/40 flex items-start gap-3">
        <span className="material-symbols-outlined text-secondary text-[20px] shrink-0 mt-0.5">info</span>
        <p className="text-sm text-on-surface leading-relaxed">
          Seluruh akses data kependudukan {tenant.rtFull} tercatat dalam audit log — termasuk akses pengurus <strong>Portal RW</strong> (approval maupun direct, ditandai portal <span className="font-mono text-xs">rw</span>). Data ditampilkan dengan enkripsi parsial (masking otomatis) untuk melindungi informasi sensitif sesuai ketentuan UU Pelindungan Data Pribadi.
        </p>
      </div>

      {/* Permintaan Akses dari RW — state bersama, keputusan RT_ADMIN */}
      <div className="bg-surface-container-lowest rounded-xl shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-surface-container-high flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-[20px]">shield_lock</span>
            <h2 className="text-sm font-extrabold text-on-surface uppercase tracking-wider">Permintaan Akses dari RW</h2>
          </div>
          <span className="text-xs text-on-surface-variant">
            Seluruh keputusan akses tercatat di audit log (§7.5).
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-on-surface">
            <thead className="bg-surface-container-low text-xs text-on-surface-variant uppercase tracking-wider">
              <tr>
                <th className="py-3 px-4">Tanggal</th>
                <th className="py-3 px-4">RT Tujuan</th>
                <th className="py-3 px-4">Lingkup</th>
                <th className="py-3 px-4">Mode</th>
                <th className="py-3 px-4">Alasan</th>
                <th className="py-3 px-4">Justifikasi</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-container-high">
              {aksesList.map((a) => (
                <tr key={a.id} className="hover:bg-surface-container-low/50 transition-colors">
                  <td className="py-4 px-4">
                    <span className="text-xs text-on-surface-variant whitespace-nowrap">{a.tanggal}</span>
                  </td>
                  <td className="py-4 px-4">
                    <span className="text-sm font-semibold text-on-surface">{a.rtTujuan}</span>
                    <span className="block text-[11px] text-on-surface-variant">{a.pengaju}</span>
                  </td>
                  <td className="py-4 px-4">
                    <span className="text-xs text-on-surface-variant">{a.lingkup}</span>
                  </td>
                  <td className="py-4 px-4">
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${a.mode === "direct" ? "bg-tertiary/20 text-tertiary" : "bg-primary-container text-on-primary-container"}`}>
                      <span className="material-symbols-outlined text-[13px]">{a.mode === "direct" ? "bolt" : "how_to_reg"}</span>
                      {a.mode === "direct" ? "Direct" : "Approval"}
                    </span>
                  </td>
                  <td className="py-4 px-4">
                    <span className="text-xs text-on-surface-variant">{a.alasan}</span>
                  </td>
                  <td className="py-4 px-4">
                    {a.mode === "direct" && a.justifikasi ? (
                      <span className="text-xs text-on-surface italic max-w-[220px] block">{a.justifikasi}</span>
                    ) : (
                      <span className="text-xs text-on-surface-variant">—</span>
                    )}
                  </td>
                  <td className="py-4 px-4">
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${statusAksesBadge[a.status] ?? "bg-surface-container-high text-on-surface-variant"}`}>
                      <span className="w-2 h-2 rounded-full bg-current opacity-60" />
                      {a.status}
                    </span>
                    {a.status === "Disetujui" && a.disetujuiOleh && (
                      <span className="block mt-1 text-[10px] text-on-surface-variant">Oleh {a.disetujuiOleh}{a.masaBerlaku ? ` • s/d ${a.masaBerlaku}` : ""}</span>
                    )}
                    {a.catatan && (
                      <span className="block mt-1 text-[10px] text-on-surface-variant italic max-w-[220px]">{a.catatan}</span>
                    )}
                  </td>
                  <td className="py-4 px-4 text-right">
                    {a.status === "Menunggu" ? (
                      <div className="flex items-center justify-end gap-2">
                        <button
                          className="h-8 px-3 rounded-lg bg-secondary-container text-on-secondary-container hover:bg-secondary-container/70 text-xs font-semibold inline-flex items-center gap-1 transition-colors"
                          onClick={() => setujuiAkses(a)}
                        >
                          <span className="material-symbols-outlined text-[14px]">check</span>
                          Setujui
                        </button>
                        <button
                          className="h-8 px-3 rounded-lg bg-error-container/40 text-on-error-container hover:bg-error-container/60 text-xs font-semibold inline-flex items-center gap-1 transition-colors"
                          onClick={() => bukaTolakAkses(a)}
                        >
                          <span className="material-symbols-outlined text-[14px]">close</span>
                          Tolak
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-on-surface-variant">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {aksesList.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-4">
                    <EmptyState
                      icon="lock_open"
                      judul="Belum ada permintaan akses"
                      pesan="Permintaan akses data terperinci dari Pengurus RW akan tampil di sini untuk Anda setujui."
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Filter audit log */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 p-4 rounded-xl bg-surface-container-lowest shadow-sm">
        <input
          className="h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all"
          type="date"
          value={filterTanggalAwal}
          onChange={(e) => { setFilterTanggalAwal(e.target.value); setCurrentPage(1); }}
        />
        <span className="text-on-surface-variant text-xs font-semibold self-center">s/d</span>
        <input
          className="h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all"
          type="date"
          value={filterTanggalAkhir}
          onChange={(e) => { setFilterTanggalAkhir(e.target.value); setCurrentPage(1); }}
        />
        <select
          className="h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all"
          value={filterKategori}
          onChange={(e) => { setFilterKategori(e.target.value as KategoriFilter); setCurrentPage(1); }}
        >
          {(Object.keys(kategoriLabel) as KategoriFilter[]).map((k) => (
            <option key={k} value={k}>{k === "all" ? "Semua Aksi" : `Kategori: ${kategoriLabel[k]}`}</option>
          ))}
        </select>
        <select
          className="h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all"
          value={filterUser}
          onChange={(e) => { setFilterUser(e.target.value); setCurrentPage(1); }}
        >
          <option value="all">Semua User</option>
          {userOptions.map((u) => (
            <option key={u} value={u}>{u}</option>
          ))}
        </select>
        <div className="relative flex-1">
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 material-symbols-outlined text-on-surface-variant text-[20px]">search</span>
          <input
            className="w-full h-11 pl-11 pr-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all"
            placeholder="Cari user, data, atau detail aksi..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setCurrentPage(1); }}
          />
        </div>
      </div>

      <div className="bg-surface-container-lowest rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-on-surface">
            <thead className="bg-surface-container-low text-xs text-on-surface-variant uppercase tracking-wider">
              <tr>
                <th className="py-3 px-4">Waktu</th>
                <th className="py-3 px-4">User</th>
                <th className="py-3 px-4">Jenis Aksi</th>
                <th className="py-3 px-4">Data yang Diakses</th>
                <th className="py-3 px-4">Detail</th>
                <th className="py-3 px-4">IP Address</th>
                <th className="py-3 px-4 text-right">Tindakan</th>
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
                    <span className={`ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${row.portal === "rw" ? "bg-tertiary/20 text-tertiary" : row.portal === "warga" ? "bg-primary-container text-on-primary" : "bg-surface-container-high text-on-surface-variant"}`}>
                      {labelPortal(row.portal)}
                    </span>
                  </td>
                  <td className="py-4 px-4">
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${row.aksiBadge}`}>
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
                  <td className="py-4 px-4 text-right">
                    <button
                      className="h-8 px-3 rounded-lg bg-surface-container-low text-on-surface-variant hover:text-primary hover:bg-surface-container text-xs font-semibold inline-flex items-center gap-1 transition-colors"
                      onClick={() => setDetailRow(row)}
                    >
                      <span className="material-symbols-outlined text-[14px]">visibility</span>
                      Lihat Detail
                    </button>
                  </td>
                </tr>
              ))}
              {paginatedData.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-4">
                    <EmptyState
                      icon="manage_search"
                      judul="Log audit tidak ditemukan"
                      pesan="Ubah filter tanggal, pengguna, atau kata kunci."
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="px-6 py-3 border-t border-surface-container-high flex items-center justify-between text-xs text-on-surface-variant">
          <span>
            {filtered.length > 0
              ? `Menampilkan ${(currentPage - 1) * ITEMS_PER_PAGE + 1}-${Math.min(currentPage * ITEMS_PER_PAGE, filtered.length)} dari ${filtered.length} entri`
              : "0 entri"}
            {" "}• mencakup portal RT & RW
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
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            >
              Berikutnya
              <span className="material-symbols-outlined text-[14px]">chevron_right</span>
            </button>
          </div>
        </div>
      </div>

      {/* Modal catatan penolakan akses */}
      {tolakAkses && (
        <div className="fixed inset-0 z-50 bg-on-background/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md mx-4 sm:mx-auto rounded-2xl bg-surface-container-lowest shadow-2xl p-6 flex flex-col gap-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-error-container/40 text-on-error-container flex items-center justify-center">
                  <span className="material-symbols-outlined text-[22px]">block</span>
                </div>
                <div>
                  <h3 className="text-base font-bold text-on-surface">Tolak Permintaan Akses</h3>
                  <p className="text-xs text-on-surface-variant">{tolakAkses.rtTujuan} — {tolakAkses.lingkup}</p>
                </div>
              </div>
              <button className="w-8 h-8 rounded-lg bg-surface-container flex items-center justify-center text-on-surface-variant hover:text-on-surface" onClick={() => setTolakAkses(null)}>
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold text-on-surface">Catatan Penolakan *</label>
              <textarea
                className="w-full px-4 py-3 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all resize-none"
                rows={3}
                placeholder="Alasan penolakan yang akan tercatat di audit log..."
                value={catatanAkses}
                onChange={(e) => setCatatanAkses(e.target.value)}
              />
              <span className="text-[11px] text-on-surface-variant">Wajib terisi. Keputusan ini tercatat di audit log (§7.5).</span>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2 border-t border-surface-container-high">
              <button
                type="button"
                className="h-11 px-4 rounded-xl text-on-surface-variant text-sm hover:bg-surface-container-high transition-colors"
                onClick={() => setTolakAkses(null)}
              >
                Batal
              </button>
              <button
                type="button"
                className="h-11 px-6 rounded-xl bg-error text-on-error text-sm font-bold shadow-md active:scale-[0.98] transition-all flex items-center gap-2"
                onClick={konfirmasiTolakAkses}
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
                Tolak Akses
              </button>
            </div>
          </div>
        </div>
      )}

      {detailRow && (
        <div className="fixed inset-0 z-50 bg-on-background/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg mx-4 sm:mx-auto rounded-2xl bg-surface-container-lowest shadow-2xl p-6 flex flex-col gap-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary-container flex items-center justify-center text-on-primary-container">
                  <span className="material-symbols-outlined text-[22px]">manage_search</span>
                </div>
                <div>
                  <h3 className="text-base font-bold text-on-surface">Detail Audit Log</h3>
                  <p className="text-xs text-on-surface-variant">Kepatuhan UU No. 27/2022 • {tenant.label}</p>
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
              <div className="p-3 rounded-xl bg-surface-container-low col-span-2">
                <div className="text-[11px] text-on-surface-variant uppercase tracking-wider font-semibold">Waktu Akses</div>
                <div className="text-sm font-semibold text-on-surface font-mono mt-0.5">{detailRow.waktu}</div>
              </div>
              <div className="p-3 rounded-xl bg-surface-container-low">
                <div className="text-[11px] text-on-surface-variant uppercase tracking-wider font-semibold">User</div>
                <div className="text-sm font-semibold text-on-surface mt-0.5">{detailRow.user}</div>
              </div>
              <div className="p-3 rounded-xl bg-surface-container-low">
                <div className="text-[11px] text-on-surface-variant uppercase tracking-wider font-semibold">Portal</div>
                <div className="text-sm font-semibold text-on-surface mt-0.5">
                  {labelPortal(detailRow.portal)}
                </div>
              </div>
              <div className="p-3 rounded-xl bg-surface-container-low">
                <div className="text-[11px] text-on-surface-variant uppercase tracking-wider font-semibold">Jenis Aksi</div>
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold mt-1 ${detailRow.aksiBadge}`}>
                  <span className="w-2 h-2 rounded-full bg-current opacity-60" />
                  {detailRow.aksi}
                </span>
              </div>
              <div className="p-3 rounded-xl bg-surface-container-low">
                <div className="text-[11px] text-on-surface-variant uppercase tracking-wider font-semibold">Kategori</div>
                <div className="text-sm font-semibold text-on-surface mt-0.5 capitalize">{kategoriLabel[detailRow.kategori as KategoriFilter] ?? detailRow.kategori}</div>
              </div>
              <div className="p-3 rounded-xl bg-surface-container-low">
                <div className="text-[11px] text-on-surface-variant uppercase tracking-wider font-semibold">Data yang Diakses</div>
                <div className="text-sm font-semibold text-on-surface mt-0.5">{detailRow.dataDiakses}</div>
              </div>
              <div className="p-3 rounded-xl bg-surface-container-low">
                <div className="text-[11px] text-on-surface-variant uppercase tracking-wider font-semibold">IP Address</div>
                <div className="text-sm font-semibold text-on-surface font-mono mt-0.5">{detailRow.ipAddress}</div>
              </div>
              <div className="p-3 rounded-xl bg-surface-container-low col-span-2">
                <div className="text-[11px] text-on-surface-variant uppercase tracking-wider font-semibold">Detail Aksi</div>
                <div className="text-sm text-on-surface mt-0.5">{detailRow.detail}</div>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-secondary-container/20 border border-secondary-container/40 flex items-start gap-2">
              <span className="material-symbols-outlined text-secondary text-[16px] shrink-0 mt-0.5">verified_user</span>
              <p className="text-xs text-on-surface leading-relaxed">
                Entri ini disimpan sebagai bagian dari audit trail {tenant.rtFull} dengan masking data pribadi sesuai UU Pelindungan Data Pribadi.
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
