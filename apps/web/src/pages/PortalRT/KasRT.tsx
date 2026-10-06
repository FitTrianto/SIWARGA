import { useState } from "react";
import { tenant } from "../../lib/tenant";
import {
  KasRt,
  badgeKasTipe,
  downloadText,
  formatRupiah,
  rekapKasRt,
  saldoKasRt,
} from "../../lib/shared";
import { EmptyState } from "../../components/EmptyState";
import { KonfirmasiDialog } from "../../components/KonfirmasiDialog";
import { useFlash } from "../../lib/useFlash";

interface KasRTProps {
  onNavigate?: (page: string) => void;
  kasRt: KasRt[];
  /** API-first (boleh `Promise`): MELEMPAR galat non-OFFLINE — pemanggil wajib try/catch. */
  onTambahKas: (t: Omit<KasRt, "id" | "saldo">) => void | Promise<void>;
  /**
   * B8 — koreksi satu entri lewat jurnal pembalik (append-only, tak pernah
   * mengubah baris asal). MELEMPAR galat non-OFFLINE seperti `onTambahKas`.
   */
  onKoreksiKas: (id: string, alasan: string) => Promise<boolean>;
}

type TipeFilter = "all" | "pemasukan" | "pengeluaran";

const BULAN_ID = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

/** "2026-10-01" → "01 Oktober 2026" */
function isoKeTanggal(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${String(d).padStart(2, "0")} ${BULAN_ID[m - 1]} ${y}`;
}

/** "01 Oktober 2026" → "2026-10-01" (untuk filter rentang tanggal). */
function tanggalKeISO(tanggal: string): string {
  const parts = tanggal.split(" ");
  if (parts.length !== 3) return "";
  const idx = BULAN_ID.indexOf(parts[1]);
  if (idx < 0) return "";
  return `${parts[2]}-${String(idx + 1).padStart(2, "0")}-${parts[0].padStart(2, "0")}`;
}

export function KasRT({ onNavigate, kasRt, onTambahKas, onKoreksiKas }: KasRTProps) {
  const rows = kasRt;
  const [search, setSearch] = useState("");
  // Penjaga klik ganda: buku kas APPEND-ONLY — satu klik = satu baris permanen.
  const [kirimKas, setKirimKas] = useState(false);
  // B8 · dialog koreksi (jurnal pembalik) + penjaga klik ganda serupa.
  const [koreksiRow, setKoreksiRow] = useState<KasRt | null>(null);
  const [alasanKoreksi, setAlasanKoreksi] = useState("");
  const [kirimKoreksi, setKirimKoreksi] = useState(false);
  const [filterTipe, setFilterTipe] = useState<TipeFilter>("all");
  const [filterTanggalAwal, setFilterTanggalAwal] = useState("");
  const [filterTanggalAkhir, setFilterTanggalAkhir] = useState("");
  const [showPemasukanModal, setShowPemasukanModal] = useState(false);
  const [showPengeluaranModal, setShowPengeluaranModal] = useState(false);
  const [bukuDitutup, setBukuDitutup] = useState(false);
  const [detailRow, setDetailRow] = useState<KasRt | null>(null);
  const { flash, toast } = useFlash();

  const [formPemasukan, setFormPemasukan] = useState({
    tanggal: "",
    sumber: "Iuran Warga",
    nominal: "",
    keterangan: "",
    bukti: null as File | null,
  });

  const [formPengeluaran, setFormPengeluaran] = useState({
    tanggal: "",
    kategori: "Operasional",
    nominal: "",
    keterangan: "",
    metodeBayar: "Tunai",
    bukti: null as File | null,
  });


  function unduhBukti(row: KasRt) {
    if (!row.bukti) {
      flash("Bukti belum tersedia untuk transaksi ini.");
      return;
    }
    const isi = [
      "BUKTI TRANSAKSI KAS RT",
      tenant.alamatLengkap,
      "========================================",
      `No. Bukti      : ${row.id.toUpperCase()}`,
      `Tanggal        : ${row.tanggal}`,
      `Keterangan     : ${row.keterangan}`,
      `Kategori       : ${row.kategori}`,
      `Tipe           : ${row.tipe}`,
      `Nominal        : ${row.tipe === "Pemasukan" ? "+" : "-"}Rp ${Math.abs(row.nominal).toLocaleString("id-ID")}`,
      `Saldo Setelah  : Rp ${row.saldo.toLocaleString("id-ID")}`,
      "----------------------------------------",
      `Dicetak        : ${new Date().toLocaleString("id-ID")}`,
      `Penerbit       : ${tenant.label} — SIWARGA`,
    ].join("\n");
    downloadText(`bukti-kas-${row.id}.txt`, isi, "text/plain;charset=utf-8");
    flash(`Bukti transaksi "${row.keterangan}" berhasil diunduh.`);
  }

  const filtered = rows.filter((row) => {
    const matchSearch = search === "" || row.keterangan.toLowerCase().includes(search.toLowerCase()) || row.kategori.toLowerCase().includes(search.toLowerCase());
    const matchTipe =
      filterTipe === "all" ||
      (filterTipe === "pemasukan" && row.tipe === "Pemasukan") ||
      (filterTipe === "pengeluaran" && row.tipe === "Pengeluaran");
    const rowISO = tanggalKeISO(row.tanggal);
    const matchAwal = filterTanggalAwal === "" || rowISO >= filterTanggalAwal;
    const matchAkhir = filterTanggalAkhir === "" || rowISO <= filterTanggalAkhir;
    return matchSearch && matchTipe && matchAwal && matchAkhir;
  });

  const saldoAkhir = saldoKasRt(kasRt);
  const { pemasukan: totalPemasukan, pengeluaran: totalPengeluaran } = rekapKasRt(kasRt);
  const surplusBulan = totalPemasukan - totalPengeluaran;

  const kpiData = [
    { label: "Saldo Saat Ini", value: formatRupiah(saldoAkhir), icon: "account_balance_wallet", color: "bg-primary-container text-on-primary-container" },
    { label: "Pemasukan Bulan Ini", value: formatRupiah(totalPemasukan), icon: "trending_up", color: "bg-secondary-container text-on-secondary-container" },
    { label: "Pengeluaran Bulan Ini", value: formatRupiah(totalPengeluaran), icon: "trending_down", color: "bg-error-container/40 text-on-error-container" },
    { label: "Surplus", value: formatRupiah(surplusBulan), icon: "savings", color: "bg-tertiary-container text-on-tertiary-container" },
  ];

  async function handleSubmitPemasukan(e: React.FormEvent) {
    e.preventDefault();
    const nominal = Number(formPemasukan.nominal);
    if (!formPemasukan.tanggal) return flash("Tanggal transaksi wajib diisi.");
    if (!formPemasukan.keterangan.trim()) return flash("Keterangan transaksi wajib diisi.");
    if (!nominal || nominal <= 0) return flash("Nominal transaksi harus lebih dari 0.");
    if (bukuDitutup) return flash("Buku kas sudah ditutup. Buka kembali buku kas untuk mencatat transaksi.");
    if (kirimKas) return flash("Permintaan masih diproses — tunggu sebentar.");
    const baru: Omit<KasRt, "id" | "saldo"> = {
      tanggal: isoKeTanggal(formPemasukan.tanggal),
      keterangan: formPemasukan.keterangan.trim(),
      kategori: formPemasukan.sumber,
      tipe: "Pemasukan",
      nominal,
      bukti: Boolean(formPemasukan.bukti),
    };
    setKirimKas(true);
    try {
      await onTambahKas(baru);
    } catch (err) {
      setKirimKas(false);
      return flash(`Pencatatan pemasukan gagal: ${err instanceof Error ? err.message : "server tidak terjangkau."}`);
    }
    setKirimKas(false);
    flash(`Pemasukan "${baru.keterangan}" sebesar ${formatRupiah(nominal)} berhasil dicatat`);
    setShowPemasukanModal(false);
    setFormPemasukan({ tanggal: "", sumber: "Iuran Warga", nominal: "", keterangan: "", bukti: null });
  }

  async function handleSubmitPengeluaran(e: React.FormEvent) {
    e.preventDefault();
    const nominal = Number(formPengeluaran.nominal);
    if (!formPengeluaran.tanggal) return flash("Tanggal transaksi wajib diisi.");
    if (!formPengeluaran.keterangan.trim()) return flash("Keterangan transaksi wajib diisi.");
    if (!nominal || nominal <= 0) return flash("Nominal transaksi harus lebih dari 0.");
    if (bukuDitutup) return flash("Buku kas sudah ditutup. Buka kembali buku kas untuk mencatat transaksi.");
    if (kirimKas) return flash("Permintaan masih diproses — tunggu sebentar.");
    const baru: Omit<KasRt, "id" | "saldo"> = {
      tanggal: isoKeTanggal(formPengeluaran.tanggal),
      keterangan: formPengeluaran.keterangan.trim(),
      kategori: formPengeluaran.kategori,
      tipe: "Pengeluaran",
      nominal: -nominal,
      bukti: Boolean(formPengeluaran.bukti),
    };
    setKirimKas(true);
    try {
      await onTambahKas(baru);
    } catch (err) {
      setKirimKas(false);
      return flash(`Pencatatan pengeluaran gagal: ${err instanceof Error ? err.message : "server tidak terjangkau."}`);
    }
    setKirimKas(false);
    flash(`Pengeluaran "${baru.keterangan}" sebesar ${formatRupiah(nominal)} berhasil dicatat`);
    setShowPengeluaranModal(false);
    setFormPengeluaran({ tanggal: "", kategori: "Operasional", nominal: "", keterangan: "", metodeBayar: "Tunai", bukti: null });
  }

  // B8 · aturan siapa yang boleh dikoreksi: hanya entri MANUAL. Entri hasil
  // alokasi (`iuran_alokasi`) dan jurnal pembalik (`pembalik`) tidak boleh
  // dikoreksi — koreksi atas koreksi = rantai yang tidak terkontrol. Baris yang
  // SUDAH punya pembalik juga dikunci (sekali koreksi per entri).
  const sudahDikoreksi = new Set(rows.map((r) => r.reversalOfId).filter(Boolean));
  function bisaDikoreksi(row: KasRt): boolean {
    if (row.sumber === "pembalik" || row.sumber === "iuran_alokasi") return false;
    return !sudahDikoreksi.has(row.id);
  }

  function bukaDialogKoreksi(row: KasRt) {
    setAlasanKoreksi("");
    setKoreksiRow(row);
  }

  async function handleSubmitKoreksi() {
    if (!koreksiRow) return;
    const alasan = alasanKoreksi.trim();
    // Validasi FE disamakan dengan zod server (`min 3`, `max 200`).
    if (alasan.length < 3) return flash("Alasan koreksi minimal 3 karakter.");
    if (alasan.length > 200) return flash("Alasan koreksi maksimal 200 karakter.");
    if (kirimKoreksi) return flash("Permintaan masih diproses — tunggu sebentar.");
    setKirimKoreksi(true);
    let dariServer = false;
    try {
      dariServer = await onKoreksiKas(koreksiRow.id, alasan);
    } catch (err) {
      setKirimKoreksi(false);
      return flash(`Koreksi gagal: ${err instanceof Error ? err.message : "server tidak terjangkau."}`);
    }
    setKirimKoreksi(false);
    flash(
      dariServer
        ? `Koreksi "${koreksiRow.keterangan}" dicatat lewat baris pembalik — baris asal tetap utuh (append-only).`
        : `Server tidak terjangkau — koreksi "${koreksiRow.keterangan}" hanya dicatat di sesi ini (baris pembalik lokal), TIDAK tersimpan di server.`,
    );
    setKoreksiRow(null);
    setAlasanKoreksi("");
  }

  return (
    <div className="max-w-7xl mx-auto w-full space-y-6">
      {toast}

      <div className="flex items-center gap-1.5 text-sm text-on-surface-variant">
        <button type="button" className="hover:text-primary transition-colors flex items-center gap-1" onClick={() => onNavigate?.("dashboard-rt")}><span className="material-symbols-outlined text-[16px]">home</span>
          Portal RT
        </button>
        <span className="material-symbols-outlined text-[14px]">chevron_right</span>
        <span className="font-bold text-on-surface">Kas RT</span>
      </div>

      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div className="max-w-3xl space-y-1.5">
          <div className="inline-flex items-center gap-1.5 text-primary text-sm font-bold uppercase tracking-wider">
            <span className="material-symbols-outlined text-[16px]">account_balance</span>
            Manajemen Keuangan RT
          </div>
          <h1 className="text-2xl lg:text-[32px] text-on-surface tracking-tight font-extrabold">
            Kas {tenant.label}
          </h1>
          <p className="text-sm text-on-surface-variant leading-relaxed">
            Catat dan lacak seluruh transaksi keuangan {tenant.rtFull} {tenant.rwFull}, termasuk pemasukan iuran dan pengeluaran operasional.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <button
            className="h-11 px-5 rounded-xl bg-surface-container-lowest text-on-surface text-sm shadow-sm hover:shadow-md hover:bg-surface-container-low transition-all flex items-center gap-2"
            onClick={() =>
              flash(
                `Rekonsiliasi selesai: ${rows.length} transaksi tercatat, saldo buku kas ${formatRupiah(saldoAkhir)} sesuai dengan mutasi terakhir.`
              )
            }
          >
            <span className="material-symbols-outlined text-primary text-[20px]">fact_check</span>
            Rekonsiliasi
          </button>
          <button
            className={`h-11 px-5 rounded-xl text-sm shadow-sm transition-all flex items-center gap-2 ${
              bukuDitutup
                ? "bg-tertiary-container text-on-tertiary hover:brightness-95"
                : "bg-surface-container-lowest text-on-surface hover:shadow-md hover:bg-surface-container-low"
            }`}
            onClick={() => {
              const next = !bukuDitutup;
              setBukuDitutup(next);
              flash(
                next
                  ? `Buku kas ditutup. Saldo akhir ${formatRupiah(saldoAkhir)} dari ${rows.length} transaksi.`
                  : "Buku kas dibuka kembali. Transaksi baru dapat dicatat."
              );
            }}
          >
            <span className={`material-symbols-outlined text-[20px] ${bukuDitutup ? "text-on-tertiary" : "text-tertiary"}`}>
              {bukuDitutup ? "lock_open" : "lock"}
            </span>
            {bukuDitutup ? "Buka Buku Kas" : "Tutup Buku Kas"}
          </button>
          <button
            className="h-11 px-5 rounded-xl bg-surface-container-lowest text-on-surface text-sm shadow-sm hover:shadow-md hover:bg-surface-container-low transition-all flex items-center gap-2"
            onClick={() =>
              bukuDitutup
                ? flash("Buku kas sudah ditutup. Buka kembali buku kas untuk mencatat transaksi.")
                : setShowPengeluaranModal(true)
            }
          >
            <span className="material-symbols-outlined text-error text-[20px]">remove_circle</span>
            + Catat Pengeluaran
          </button>
          <button
            className="h-11 px-5 rounded-xl bg-primary text-on-primary text-sm shadow-md hover:bg-primary-container active:scale-[0.98] transition-all flex items-center gap-2"
            onClick={() =>
              bukuDitutup
                ? flash("Buku kas sudah ditutup. Buka kembali buku kas untuk mencatat transaksi.")
                : setShowPemasukanModal(true)
            }
          >
            <span className="material-symbols-outlined text-[20px]">add</span>
            + Catat Pemasukan
          </button>
        </div>
      </div>

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
              <div className="text-2xl font-extrabold text-on-surface">{kpi.value}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 p-4 rounded-xl bg-surface-container-lowest shadow-sm">
        <input
          className="h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all"
          type="date"
          value={filterTanggalAwal}
          onChange={(e) => setFilterTanggalAwal(e.target.value)}
        />
        <span className="text-on-surface-variant text-xs font-semibold self-center">s/d</span>
        <input
          className="h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all"
          type="date"
          value={filterTanggalAkhir}
          onChange={(e) => setFilterTanggalAkhir(e.target.value)}
        />
        <select
          className="h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all"
          value={filterTipe}
          onChange={(e) => setFilterTipe(e.target.value as TipeFilter)}
        >
          <option value="all">Semua Tipe</option>
          <option value="pemasukan">Pemasukan</option>
          <option value="pengeluaran">Pengeluaran</option>
        </select>
        <div className="relative flex-1">
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 material-symbols-outlined text-on-surface-variant text-[20px]">search</span>
          <input
            className="w-full h-11 pl-11 pr-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all"
            placeholder="Cari berdasarkan keterangan atau kategori..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

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
                <th className="py-3 px-4 text-center">Bukti</th>
                <th className="py-3 px-4 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-container-high">
              {filtered.map((row) => (
                <tr key={row.id} className="hover:bg-surface-container-low/50 transition-colors">
                  <td className="py-4 px-4">
                    <span className="text-xs text-on-surface-variant">{row.tanggal}</span>
                  </td>
                  <td className="py-4 px-4">
                    <span className="text-sm font-semibold text-on-surface">{row.keterangan}</span>
                    {/* B8 · jejak audit koreksi: baris pembalik & baris yang sudah dikoreksi */}
                    {row.reversalOfId && (
                      <span className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-tertiary-container/60 text-on-tertiary text-[10px] font-bold uppercase tracking-wider align-middle">
                        <span className="material-symbols-outlined text-[12px]">undo</span>
                        Hasil Koreksi
                      </span>
                    )}
                    {sudahDikoreksi.has(row.id) && (
                      <span className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-error-container/40 text-on-error-container text-[10px] font-bold uppercase tracking-wider align-middle">
                        <span className="material-symbols-outlined text-[12px]">rule</span>
                        Sudah Dikoreksi
                      </span>
                    )}
                  </td>
                  <td className="py-4 px-4">
                    <span className="text-xs text-on-surface-variant">{row.kategori}</span>
                  </td>
                  <td className="py-4 px-4">
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${badgeKasTipe(row.tipe)}`}>
                      <span className="w-2 h-2 rounded-full bg-current opacity-60" />
                      {row.tipe}
                    </span>
                  </td>
                  <td className="py-4 px-4 text-right">
                    <span className={`text-sm font-extrabold font-mono ${row.tipe === "Pemasukan" ? "text-secondary" : "text-error"}`}>
                      {row.tipe === "Pemasukan" ? "+" : ""}Rp {Math.abs(row.nominal).toLocaleString("id-ID")}
                    </span>
                  </td>
                  <td className="py-4 px-4 text-right">
                    <span className="text-sm font-bold text-on-surface font-mono">Rp {row.saldo.toLocaleString("id-ID")}</span>
                  </td>
                  <td className="py-4 px-4 text-center">
                    {row.bukti ? (
                      <span className="material-symbols-outlined text-secondary text-[20px]">check_circle</span>
                    ) : (
                      <span className="material-symbols-outlined text-on-surface-variant/40 text-[20px]">cancel</span>
                    )}
                  </td>
                  <td className="py-4 px-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        className="h-8 px-3 rounded-lg bg-surface-container-low text-on-surface-variant hover:text-primary hover:bg-surface-container text-xs font-semibold inline-flex items-center gap-1 transition-colors"
                        onClick={() => setDetailRow(row)}
                      >
                        <span className="material-symbols-outlined text-[14px]">visibility</span>
                        Detail
                      </button>
                      <button
                        className={`h-8 px-3 rounded-lg text-xs font-semibold inline-flex items-center gap-1 transition-colors ${
                          row.bukti
                            ? "bg-primary-container/40 text-on-primary-container hover:bg-primary-container"
                            : "bg-surface-container-high text-on-surface-variant/50 cursor-not-allowed"
                        }`}
                        disabled={!row.bukti}
                        title={row.bukti ? "Unduh bukti transaksi" : "Bukti belum tersedia"}
                        onClick={() => unduhBukti(row)}
                      >
                        <span className="material-symbols-outlined text-[14px]">download</span>
                        Unduh Bukti
                      </button>
                      {bisaDikoreksi(row) && (
                        <button
                          className="h-8 px-3 rounded-lg bg-error-container/30 text-error hover:bg-error-container text-xs font-semibold inline-flex items-center gap-1 transition-colors"
                          title="Koreksi lewat jurnal pembalik — baris asal tidak diubah"
                          onClick={() => bukaDialogKoreksi(row)}
                        >
                          <span className="material-symbols-outlined text-[14px]">undo</span>
                          Koreksi
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-4">
                    <EmptyState
                      icon="search_off"
                      judul="Transaksi kas tidak ditemukan"
                      pesan="Ubah filter periode atau kata kunci transaksi."
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="px-6 py-3 border-t border-surface-container-high flex items-center justify-between text-xs text-on-surface-variant">
          <span>Menampilkan {filtered.length} dari {rows.length} transaksi</span>
          <span className="font-semibold">Halaman 1 dari 1</span>
        </div>
      </div>

      {showPemasukanModal && (
        <div className="fixed inset-0 z-50 bg-on-background/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg mx-4 sm:mx-auto rounded-2xl bg-surface-container-lowest shadow-2xl p-6 flex flex-col gap-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-secondary-container/40 flex items-center justify-center text-on-secondary-container">
                  <span className="material-symbols-outlined text-[22px]">add_circle</span>
                </div>
                <div>
                  <h3 className="text-base font-bold text-on-surface">Catat Pemasukan</h3>
                  <p className="text-xs text-on-surface-variant">Rekam pemasukan kas {tenant.rtFull}</p>
                </div>
              </div>
              <button className="w-8 h-8 rounded-lg bg-surface-container flex items-center justify-center text-on-surface-variant hover:text-on-surface" onClick={() => setShowPemasukanModal(false)}>
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <form onSubmit={handleSubmitPemasukan} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[16px] text-on-surface-variant">calendar_month</span>
                  Tanggal
                </label>
                <input
                  className="w-full h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all"
                  type="date"
                  value={formPemasukan.tanggal}
                  onChange={(e) => setFormPemasukan({ ...formPemasukan, tanggal: e.target.value })}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[16px] text-on-surface-variant">source</span>
                  Sumber
                </label>
                <select
                  className="w-full h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all"
                  value={formPemasukan.sumber}
                  onChange={(e) => setFormPemasukan({ ...formPemasukan, sumber: e.target.value })}
                >
                  <option value="Iuran Warga">Iuran Warga</option>
                  <option value="Setoran Lain-lain">Setoran Lain-lain</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-on-surface flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[16px] text-on-surface-variant">paid</span>
                    Nominal (Rp)
                  </label>
                  <input
                    className="w-full h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface font-mono focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all"
                    type="number"
                    placeholder="0"
                    value={formPemasukan.nominal}
                    onChange={(e) => setFormPemasukan({ ...formPemasukan, nominal: e.target.value })}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-on-surface flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[16px] text-on-surface-variant">description</span>
                    Keterangan
                  </label>
                  <input
                    className="w-full h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all"
                    type="text"
                    placeholder="Contoh: Iuran Warga Blok A"
                    value={formPemasukan.keterangan}
                    onChange={(e) => setFormPemasukan({ ...formPemasukan, keterangan: e.target.value })}
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[16px] text-on-surface-variant">attach_file</span>
                  Upload Bukti
                </label>
                <label className="border-2 border-dashed border-outline-variant hover:border-primary rounded-xl p-6 text-center bg-surface-container-low/50 cursor-pointer transition-colors block">
                  <input
                    type="file"
                    accept="image/*,.pdf"
                    className="hidden"
                    onChange={(e) => setFormPemasukan({ ...formPemasukan, bukti: e.target.files?.[0] ?? null })}
                  />
                  <span className="material-symbols-outlined text-primary text-[36px] block">cloud_upload</span>
                  {formPemasukan.bukti ? (
                    <span className="text-xs text-on-surface font-semibold block mt-1 break-all">{formPemasukan.bukti.name}</span>
                  ) : (
                    <>
                      <span className="text-xs text-on-surface-variant block mt-1">Klik untuk memilih file bukti</span>
                      <span className="text-[11px] text-on-surface-variant/60 block mt-0.5">Format: JPG, PNG, PDF (Maks. 5MB)</span>
                    </>
                  )}
                </label>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2 border-t border-surface-container-high">
                <button
                  type="button"
                  className="h-11 px-4 rounded-xl text-on-surface-variant text-sm hover:bg-surface-container-high transition-colors"
                  onClick={() => setShowPemasukanModal(false)}
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={kirimKas}
                  className="h-11 px-6 rounded-xl bg-primary text-on-primary text-sm font-bold shadow-md hover:bg-primary-container active:scale-[0.98] transition-all flex items-center gap-2 disabled:opacity-60"
                >
                  <span className="material-symbols-outlined text-[18px]">save</span>
                  Simpan Pemasukan
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showPengeluaranModal && (
        <div className="fixed inset-0 z-50 bg-on-background/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg mx-4 sm:mx-auto rounded-2xl bg-surface-container-lowest shadow-2xl p-6 flex flex-col gap-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-error-container/30 flex items-center justify-center text-error">
                  <span className="material-symbols-outlined text-[22px]">remove_circle</span>
                </div>
                <div>
                  <h3 className="text-base font-bold text-on-surface">Catat Pengeluaran</h3>
                  <p className="text-xs text-on-surface-variant">Rekam pengeluaran kas {tenant.rtFull}</p>
                </div>
              </div>
              <button className="w-8 h-8 rounded-lg bg-surface-container flex items-center justify-center text-on-surface-variant hover:text-on-surface" onClick={() => setShowPengeluaranModal(false)}>
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <form onSubmit={handleSubmitPengeluaran} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[16px] text-on-surface-variant">calendar_month</span>
                  Tanggal
                </label>
                <input
                  className="w-full h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all"
                  type="date"
                  value={formPengeluaran.tanggal}
                  onChange={(e) => setFormPengeluaran({ ...formPengeluaran, tanggal: e.target.value })}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[16px] text-on-surface-variant">category</span>
                  Kategori
                </label>
                <select
                  className="w-full h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all"
                  value={formPengeluaran.kategori}
                  onChange={(e) => setFormPengeluaran({ ...formPengeluaran, kategori: e.target.value })}
                >
                  <option value="Honor">Honor</option>
                  <option value="Operasional">Operasional</option>
                  <option value="Sarana">Sarana</option>
                  <option value="Lain-lain">Lain-lain</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-on-surface flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[16px] text-on-surface-variant">paid</span>
                    Nominal (Rp)
                  </label>
                  <input
                    className="w-full h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface font-mono focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all"
                    type="number"
                    placeholder="0"
                    value={formPengeluaran.nominal}
                    onChange={(e) => setFormPengeluaran({ ...formPengeluaran, nominal: e.target.value })}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-on-surface flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[16px] text-on-surface-variant">description</span>
                    Keterangan
                  </label>
                  <input
                    className="w-full h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all"
                    type="text"
                    placeholder="Contoh: Honor Satpam"
                    value={formPengeluaran.keterangan}
                    onChange={(e) => setFormPengeluaran({ ...formPengeluaran, keterangan: e.target.value })}
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[16px] text-on-surface-variant">payments</span>
                  Metode Bayar
                </label>
                <div className="flex gap-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="metodeBayar"
                      value="Tunai"
                      checked={formPengeluaran.metodeBayar === "Tunai"}
                      onChange={() => setFormPengeluaran({ ...formPengeluaran, metodeBayar: "Tunai" })}
                      className="text-primary focus:ring-primary"
                    />
                    <span className="text-sm text-on-surface">Tunai</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="metodeBayar"
                      value="Transfer"
                      checked={formPengeluaran.metodeBayar === "Transfer"}
                      onChange={() => setFormPengeluaran({ ...formPengeluaran, metodeBayar: "Transfer" })}
                      className="text-primary focus:ring-primary"
                    />
                    <span className="text-sm text-on-surface">Transfer</span>
                  </label>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[16px] text-on-surface-variant">attach_file</span>
                  Upload Bukti
                </label>
                <label className="border-2 border-dashed border-outline-variant hover:border-primary rounded-xl p-6 text-center bg-surface-container-low/50 cursor-pointer transition-colors block">
                  <input
                    type="file"
                    accept="image/*,.pdf"
                    className="hidden"
                    onChange={(e) => setFormPengeluaran({ ...formPengeluaran, bukti: e.target.files?.[0] ?? null })}
                  />
                  <span className="material-symbols-outlined text-primary text-[36px] block">cloud_upload</span>
                  {formPengeluaran.bukti ? (
                    <span className="text-xs text-on-surface font-semibold block mt-1 break-all">{formPengeluaran.bukti.name}</span>
                  ) : (
                    <>
                      <span className="text-xs text-on-surface-variant block mt-1">Klik untuk memilih file bukti</span>
                      <span className="text-[11px] text-on-surface-variant/60 block mt-0.5">Format: JPG, PNG, PDF (Maks. 5MB)</span>
                    </>
                  )}
                </label>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2 border-t border-surface-container-high">
                <button
                  type="button"
                  className="h-11 px-4 rounded-xl text-on-surface-variant text-sm hover:bg-surface-container-high transition-colors"
                  onClick={() => setShowPengeluaranModal(false)}
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="h-11 px-6 rounded-xl bg-primary text-on-primary text-sm font-bold shadow-md hover:bg-primary-container active:scale-[0.98] transition-all flex items-center gap-2 disabled:opacity-60"
                  disabled={kirimKas}
                >
                  <span className="material-symbols-outlined text-[18px]">save</span>
                  Simpan Pengeluaran
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

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
                  <p className="text-xs text-on-surface-variant">Rincian kas {tenant.label}</p>
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
                <div className="text-[11px] text-on-surface-variant uppercase tracking-wider font-semibold">Tanggal</div>
                <div className="text-sm font-semibold text-on-surface mt-0.5">{detailRow.tanggal}</div>
              </div>
              <div className="p-3 rounded-xl bg-surface-container-low">
                <div className="text-[11px] text-on-surface-variant uppercase tracking-wider font-semibold">Kategori</div>
                <div className="text-sm font-semibold text-on-surface mt-0.5">{detailRow.kategori}</div>
              </div>
              <div className="p-3 rounded-xl bg-surface-container-low">
                <div className="text-[11px] text-on-surface-variant uppercase tracking-wider font-semibold">Tipe</div>
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold mt-1 ${badgeKasTipe(detailRow.tipe)}`}>
                  <span className="w-2 h-2 rounded-full bg-current opacity-60" />
                  {detailRow.tipe}
                </span>
              </div>
              <div className="p-3 rounded-xl bg-surface-container-low">
                <div className="text-[11px] text-on-surface-variant uppercase tracking-wider font-semibold">Status Bukti</div>
                <div className={`text-sm font-semibold mt-0.5 ${detailRow.bukti ? "text-secondary" : "text-on-surface-variant"}`}>
                  {detailRow.bukti ? "Tersedia" : "Belum ada"}
                </div>
              </div>
              <div className="p-3 rounded-xl bg-surface-container-low col-span-2">
                <div className="text-[11px] text-on-surface-variant uppercase tracking-wider font-semibold">Keterangan</div>
                <div className="text-sm font-semibold text-on-surface mt-0.5">{detailRow.keterangan}</div>
              </div>
              <div className="p-3 rounded-xl bg-secondary-container/30">
                <div className="text-[11px] text-on-surface-variant uppercase tracking-wider font-semibold">Nominal</div>
                <div className={`text-sm font-extrabold font-mono mt-0.5 ${detailRow.tipe === "Pemasukan" ? "text-secondary" : "text-error"}`}>
                  {detailRow.tipe === "Pemasukan" ? "+" : ""}Rp {Math.abs(detailRow.nominal).toLocaleString("id-ID")}
                </div>
              </div>
              <div className="p-3 rounded-xl bg-primary-container/30">
                <div className="text-[11px] text-on-surface-variant uppercase tracking-wider font-semibold">Saldo Setelah</div>
                <div className="text-sm font-extrabold font-mono text-on-surface mt-0.5">Rp {detailRow.saldo.toLocaleString("id-ID")}</div>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-3 pt-2 border-t border-surface-container-high">
              <button
                type="button"
                className="h-11 px-4 rounded-xl text-on-surface-variant text-sm hover:bg-surface-container-high transition-colors"
                onClick={() => setDetailRow(null)}
              >
                Tutup
              </button>
              <button
                type="button"
                disabled={!detailRow.bukti}
                title={detailRow.bukti ? "Unduh bukti transaksi" : "Bukti belum tersedia"}
                onClick={() => detailRow && unduhBukti(detailRow)}
                className={`h-11 px-6 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 ${
                  detailRow.bukti
                    ? "bg-primary text-on-primary shadow-md hover:bg-primary-container active:scale-[0.98]"
                    : "bg-surface-container-high text-on-surface-variant/50 cursor-not-allowed"
                }`}
              >
                <span className="material-symbols-outlined text-[18px]">download</span>
                Unduh Bukti
              </button>
              {!detailRow.bukti && (
                <span className="text-xs text-on-surface-variant sm:self-center text-center">Bukti belum tersedia</span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* B8 · konfirmasi koreksi — kas APPEND-ONLY: baris asal TIDAK diubah,
          server menulis satu baris pembalik bernilai berlawanan. `alasan`
          wajib 3–200 karakter (disamakan dengan validasi zod server). */}
      {koreksiRow && (
        <KonfirmasiDialog
          judul="Koreksi Transaksi Kas"
          pesan={
            "Buku kas bersifat append-only — transaksi asal tidak dihapus atau diubah. " +
            "Koreksi dicatat sebagai satu baris pembalik bernilai berlawanan."
          }
          ikon="undo"
          aksen="error"
          labelYa="Catat Koreksi"
          sedang={kirimKoreksi}
          onBatal={() => {
            if (kirimKoreksi) return;
            setKoreksiRow(null);
            setAlasanKoreksi("");
          }}
          onYa={() => void handleSubmitKoreksi()}
          detail={
            <div className="space-y-3">
              <div className="p-3 rounded-xl bg-surface-container-low space-y-1.5">
                <div className="text-[11px] text-on-surface-variant uppercase tracking-wider font-semibold">
                  Transaksi yang dikoreksi
                </div>
                <div className="text-sm font-bold text-on-surface">{koreksiRow.keterangan}</div>
                <div className="text-xs text-on-surface-variant">
                  {koreksiRow.tanggal} · {koreksiRow.kategori} ·{" "}
                  <span className="font-mono font-semibold">
                    {koreksiRow.tipe === "Pemasukan" ? "+" : "-"}
                    Rp {Math.abs(koreksiRow.nominal).toLocaleString("id-ID")}
                  </span>
                </div>
              </div>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-bold text-on-surface">
                  Alasan koreksi <span className="text-error">*</span>
                </span>
                <textarea
                  className="w-full min-h-[88px] px-3 py-2 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all resize-y"
                  maxLength={200}
                  placeholder="mis. Salah input nominal — seharusnya Rp 150.000"
                  value={alasanKoreksi}
                  onChange={(e) => setAlasanKoreksi(e.target.value)}
                  disabled={kirimKoreksi}
                />
                <span className="text-[11px] text-on-surface-variant text-right font-mono">
                  {alasanKoreksi.trim().length}/200
                </span>
              </label>
            </div>
          }
        />
      )}
    </div>
  );
}
