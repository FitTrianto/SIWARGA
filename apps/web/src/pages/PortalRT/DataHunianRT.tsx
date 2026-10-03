import { useState } from "react";
import { tenant } from "../../lib/tenant";
import {
  GalatApi,
  hunianServerKeHunian,
  statusHuniDariForm,
  type HunianServer,
  type TambahHunianRtPayload,
} from "../../lib/api";
import { KkData, HunianRumah } from "../../lib/shared";
import { EmptyState } from "../../components/EmptyState";
import { useFlash } from "../../lib/useFlash";

interface DataHunianRTProps {
  onNavigate?: (page: string) => void;
  kkList: KkData[];
  hunian: HunianRumah[];
  onHunianChange: (next: HunianRumah[]) => void;
  /**
   * §5.4 · API-first (`POST /rt/hunian`): sukses → baris server (id UUID,
   * turunan jumlah KK); OFFLINE → `null` (halaman lanjut jalur demo lokal
   * dengan pesan jujur); galat non-OFFLINE DILEMPAR agar pesan server
   * (mis. 409 blok/alamat kembar) tampil — tidak pernah "sukses" palsu.
   */
  onTambahHunian?: (payload: TambahHunianRtPayload) => Promise<HunianServer | null>;
}

type HunianType = "all" | "pemilik" | "sewa" | "multi-kk" | "kosong";

/** Cocokkan alamat berdasarkan bagian sebelum koma ("Blok B4 No. 12"). */
function normAlamat(a: string): string {
  return a.split(",")[0].trim().toLowerCase().replace(/\s+/g, " ");
}

/** KK dari kkList (Portal Warga) yang alamatnya cocok dengan unit hunian ini. */
function kkCocok(r: HunianRumah, kkList: KkData[]): KkData[] {
  const target = normAlamat(r.alamat);
  return kkList.filter((k) => normAlamat(k.alamat) === target);
}

/** Jumlah KK nyata: antara jumlah manual dan jumlah KK dari kkList (yang terbesar menang). */
function jumlahKK(r: HunianRumah, kkList: KkData[]): number {
  return Math.max(r.kkTerdaftar, kkCocok(r, kkList).length);
}

function badgeFor(status: string): string {
  if (status === "Multi-KK") return "bg-tertiary-container text-on-tertiary-container";
  if (status === "Sewa/Kontrak" || status === "Kos") return "bg-primary-container text-on-primary-container";
  if (status === "Kosong") return "bg-surface-container-high text-on-surface-variant";
  return "bg-secondary-container text-on-secondary-container";
}

function filterKeyFor(status: string): HunianType {
  if (status === "Multi-KK") return "multi-kk";
  if (status === "Sewa/Kontrak" || status === "Kos") return "sewa";
  if (status === "Kosong") return "kosong";
  return "pemilik";
}

/**
 * Unit yang tidak dimiliki penghuninya: sewa/kontrak — termasuk turunan
 * status "Kos" (rumah kos, enum `status_huni` dari server) dan jenis "Rumah Sewa".
 */
function sewaAsli(r: HunianRumah): boolean {
  return r.status === "Sewa/Kontrak" || r.status === "Kos" || r.jenis.includes("Sewa");
}

export function DataHunianRT({ onNavigate, kkList, hunian, onHunianChange, onTambahHunian }: DataHunianRTProps) {
  const rumahList = hunian;
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<HunianType>("all");
  const [showAddHunianModal, setShowAddHunianModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState<HunianRumah | null>(null);
  const { flash, toast } = useFlash();
  const [formHunian, setFormHunian] = useState({
    blok: "",
    alamat: "",
    jenis: "Rumah Tinggal",
    status: "Dihuni Pemilik",
  });
  const [simpanSedang, setSimpanSedang] = useState(false);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});


  /** Alamat yang diketik sudah terdaftar? (alamat kembar = tolak, §5.4) */
  const alamatMatch = formHunian.alamat.trim()
    ? rumahList.find((r) => normAlamat(r.alamat) === normAlamat(formHunian.alamat))
    : undefined;

  async function handleAddHunian(e: React.FormEvent) {
    e.preventDefault();
    if (simpanSedang) return;
    const errors: Record<string, string> = {};
    const blokBaru = formHunian.blok.trim();
    const alamatBaru = formHunian.alamat.trim();
    if (!blokBaru) errors.blok = "Blok wajib diisi";
    if (!alamatBaru) errors.alamat = "Alamat wajib diisi";
    if (blokBaru && rumahList.some((r) => r.blok.toLowerCase() === blokBaru.toLowerCase())) {
      errors.blok = "Blok sudah terdaftar";
    }
    if (alamatMatch) {
      // Server menolak alamat kembar (unique `alamat_pendek` per RT): satu
      // alamat = satu baris unit. Multi-KK = banyak KK pada alamat yang SAMA,
      // didaftarkan lewat menu Data Warga — bukan unit hunian baru.
      errors.alamat = `Alamat sudah terdaftar sebagai unit Hunian ${alamatMatch.blok} — daftarkan KK baru lewat menu Data Warga.`;
    }
    setFormErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setSimpanSedang(true);
    try {
      // §5.4 · API-first: server membuat unit & menautkan balik KK pada alamat
      // ini (memulihkan "proses terputus"). Sukses → baris server; OFFLINE →
      // `null` → jalur demo lokal di bawah; galat lain → flash pesan server.
      if (onTambahHunian) {
        const hasil = await onTambahHunian({
          kodeRumah: blokBaru,
          alamat: alamatBaru,
          statusHuni: statusHuniDariForm(formHunian.jenis, formHunian.status),
        });
        if (hasil) {
          const baris = hunianServerKeHunian(hasil);
          onHunianChange([...rumahList, baris]);
          flash(`Hunian ${baris.blok} — ${baris.alamat} berhasil ditambahkan (tersimpan di server).`);
          resetForm();
          return;
        }
      }

      // Jalur demo (OFFLINE / tanpa handler) — tambah ke daftar lokal dengan
      // pesan JUJUR: tidak tersimpan di server (bukan klaim "berhasil" palsu).
      const newRumah: HunianRumah = {
        id: `r-${Date.now()}`,
        blok: blokBaru,
        alamat: alamatBaru,
        jenis: formHunian.jenis,
        status: formHunian.status,
        kkTerdaftar: formHunian.status === "Kosong" ? 0 : 1,
        penghuni: [],
      };
      onHunianChange([...rumahList, newRumah]);
      flash(
        `Mode demo (server tidak terjangkau) — hunian ${newRumah.blok} hanya tampil di daftar lokal, TIDAK tersimpan di server.`,
      );
      resetForm();
    } catch (err) {
      flash(err instanceof GalatApi ? err.message : "Gagal menambah hunian — coba lagi.");
    } finally {
      setSimpanSedang(false);
    }
  }

  function resetForm() {
    setShowAddHunianModal(false);
    setFormHunian({ blok: "", alamat: "", jenis: "Rumah Tinggal", status: "Dihuni Pemilik" });
    setFormErrors({});
  }

  const filtered = rumahList.filter((r) => {
    const q = search.toLowerCase();
    const kkNames = [
      ...r.penghuni,
      ...kkCocok(r, kkList).map((k) => k.kepala),
    ].join(" ").toLowerCase();
    const matchSearch =
      search === "" ||
      r.blok.toLowerCase().includes(q) ||
      r.alamat.toLowerCase().includes(q) ||
      kkNames.includes(q);
    const count = jumlahKK(r, kkList);
    const matchFilter =
      filterType === "all" ||
      (filterType === "pemilik" && r.status === "Dihuni Pemilik") ||
      (filterType === "sewa" && sewaAsli(r)) ||
      (filterType === "multi-kk" && count > 1) ||
      (filterType === "kosong" && r.status === "Kosong");
    return matchSearch && matchFilter;
  });

  const kpiData = [
    { label: "Total Rumah", value: String(rumahList.length), icon: "home", color: "bg-primary-container text-on-primary-container" },
    { label: "Rumah Tetap", value: String(rumahList.filter((r) => r.status === "Dihuni Pemilik").length), icon: "house", color: "bg-secondary-container text-on-secondary-container" },
    { label: "Sewa/Kontrak", value: String(rumahList.filter(sewaAsli).length), icon: "key", color: "bg-tertiary-container text-on-tertiary-container" },
    { label: "Multi-KK", value: String(rumahList.filter((r) => jumlahKK(r, kkList) > 1).length), icon: "groups", color: "bg-error-container/40 text-on-error-container" },
  ];

  function penghuniList(r: HunianRumah): string[] {
    // Baris server sudah membawa kepala KK ter-link (`r.penghuni`); cocokkan
    // dengan kkList Portal Warga lalu buang duplikat agar nama tak tampil dua
    // kali pada detail (KK yang sama terdeteksi dari dua sumber).
    const nama = [...kkCocok(r, kkList).map((k) => k.kepala), ...r.penghuni]
      .map((n) => n.trim())
      .filter(Boolean);
    return Array.from(new Set(nama));
  }

  return (
    <div className="max-w-7xl mx-auto w-full space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-sm text-on-surface-variant">
        <button type="button" className="hover:text-primary transition-colors flex items-center gap-1" onClick={() => onNavigate?.("dashboard-rt")}><span className="material-symbols-outlined text-[16px]">home</span>
          Portal RT
        </button>
        <span className="material-symbols-outlined text-[14px]">chevron_right</span>
        <span className="font-bold text-on-surface">Data Hunian</span>
      </div>

      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div className="max-w-3xl space-y-1.5">
          <div className="inline-flex items-center gap-1.5 text-primary text-sm font-bold uppercase tracking-wider">
            <span className="material-symbols-outlined text-[16px]">home_work</span>
            Administrasi Hunian Warga
          </div>
          <h1 className="text-2xl lg:text-[32px] text-on-surface tracking-tight font-extrabold">
            Data Hunian {tenant.label}
          </h1>
          <p className="text-sm text-on-surface-variant leading-relaxed">
            Daftar seluruh unit hunian di wilayah {tenant.rtFull} {tenant.rwFull}, termasuk status kepemilikan, jumlah KK terdaftar, dan data kontak pemilik/penyewa. Satu alamat dapat menampung lebih dari satu KK (Multi-KK).
          </p>
        </div>
        <button
          className="h-11 px-5 rounded-xl bg-primary text-on-primary text-sm shadow-md hover:bg-primary-container active:scale-[0.98] transition-all flex items-center gap-2 shrink-0"
          onClick={() => setShowAddHunianModal(true)}
        >
          <span className="material-symbols-outlined text-[20px]">add</span>
          + Tambah Hunian
        </button>
      </div>

      {/* KPI Cards */}
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

      {/* Search & Filter Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 p-4 rounded-xl bg-surface-container-lowest shadow-sm">
        <div className="relative flex-1">
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 material-symbols-outlined text-on-surface-variant text-[20px]">search</span>
          <input
            className="w-full h-11 pl-11 pr-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all"
            placeholder="Cari berdasarkan blok, alamat, atau nama penghuni..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {([
            { key: "all", label: "Semua" },
            { key: "pemilik", label: "Pemilik" },
            { key: "sewa", label: "Sewa/Kontrak" },
            { key: "multi-kk", label: "Multi-KK" },
            { key: "kosong", label: "Kosong" },
          ] as const).map((f) => (
            <button
              key={f.key}
              className={`px-3 py-1.5 rounded-lg text-xs transition-all ${
                filterType === f.key
                  ? "bg-primary text-on-primary font-semibold shadow-sm"
                  : "bg-surface-container-high text-on-surface-variant hover:bg-surface-container"
              }`}
              onClick={() => setFilterType(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-surface-container-lowest rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-on-surface">
            <thead className="bg-surface-container-low text-xs text-on-surface-variant uppercase tracking-wider">
              <tr>
                <th className="py-3 px-6">Blok</th>
                <th className="py-3 px-4">Alamat</th>
                <th className="py-3 px-4">Jenis Hunian</th>
                <th className="py-3 px-4 text-center">KK Terdaftar</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-6 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-container-high">
              {filtered.map((rumah) => {
                const count = jumlahKK(rumah, kkList);
                const effStatus = count > 1 ? "Multi-KK" : rumah.status;
                return (
                  <tr key={rumah.id} className="hover:bg-surface-container-low/50 transition-colors">
                    <td className="py-4 px-6">
                      <span className="text-sm font-bold text-primary">{rumah.blok}</span>
                    </td>
                    <td className="py-4 px-4">
                      <span className="text-sm font-semibold text-on-surface">{rumah.alamat}</span>
                      <span className="block text-xs text-on-surface-variant">Kel. {tenant.kelurahan}, {tenant.label}</span>
                    </td>
                    <td className="py-4 px-4">
                      <span className="text-sm text-on-surface">{rumah.jenis}</span>
                    </td>
                    <td className="py-4 px-4 text-center">
                      <button
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold transition-all ${
                          count > 1
                            ? "bg-tertiary-container text-on-tertiary-container hover:shadow-sm"
                            : "bg-surface-container-low text-on-surface hover:bg-surface-container-high"
                        }`}
                        title={count > 1 ? `${count} KK di alamat ini (Multi-KK) — klik untuk detail` : "Klik untuk detail KK"}
                        onClick={() => setShowDetailModal(rumah)}
                      >
                        {count > 1 && <span className="material-symbols-outlined text-[14px]">groups</span>}
                        {count} KK
                      </button>
                    </td>
                    <td className="py-4 px-4">
                      <button
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold transition-all hover:shadow-sm ${badgeFor(effStatus)}`}
                        title="Klik untuk memfilter status ini"
                        onClick={() => setFilterType(filterKeyFor(effStatus))}
                      >
                        <span className="w-2 h-2 rounded-full bg-current opacity-60" />
                        {effStatus}
                      </button>
                    </td>
                    <td className="py-4 px-6 text-right">
                      <button
                        className="h-9 px-3 rounded-lg bg-surface-container-low text-on-surface-variant hover:text-primary hover:bg-surface-container text-sm font-semibold inline-flex items-center gap-1 transition-colors"
                        onClick={() => setShowDetailModal(rumah)}
                      >
                        <span className="material-symbols-outlined text-[16px]">visibility</span>
                        Detail
                      </button>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-4">
                    <EmptyState
                      icon="home_work"
                      judul="Data hunian tidak ditemukan"
                      pesan="Ubah kata kunci pencarian untuk melihat data hunian lain."
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="px-6 py-3 border-t border-surface-container-high flex items-center justify-between text-xs text-on-surface-variant">
          <span>Menampilkan {filtered.length} dari {rumahList.length} unit hunian</span>
          <span className="font-semibold">Halaman 1 dari 1</span>
        </div>
      </div>

      {/* Footer Info */}
      <div className="rounded-xl bg-surface-container-low p-4 flex items-start gap-3">
        <span className="material-symbols-outlined text-primary text-[20px] shrink-0 mt-0.5">info</span>
        <div className="text-xs text-on-surface-variant leading-relaxed">
          <span className="font-bold text-on-surface">Catatan:</span> Data hunian ini bersumber dari hasil input manual oleh Pengurus {tenant.rtFull} dan diverifikasi berdasarkan surat keterangan domisili resmi. Jumlah KK per alamat ikut menyesuaikan data Kartu Keluarga dari Portal Warga (Data Keluarga). Perubahan data hunian harus disetujui oleh Ketua {tenant.rtFull}.
        </div>
      </div>

      {/* Toast */}
      {toast}

      {/* Modal: Tambah Hunian */}
      {showAddHunianModal && (
        <div className="fixed inset-0 z-50 bg-on-background/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg mx-4 sm:mx-auto rounded-2xl bg-surface-container-lowest shadow-2xl p-6 flex flex-col gap-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary-container flex items-center justify-center text-on-primary-container">
                  <span className="material-symbols-outlined text-[22px]">home_work</span>
                </div>
                <div>
                  <h3 className="text-base font-bold text-on-surface">Tambah Hunian Baru</h3>
                  <p className="text-xs text-on-surface-variant">Tambah unit hunian di {tenant.rtFull}</p>
                </div>
              </div>
              <button className="w-8 h-8 rounded-lg bg-surface-container flex items-center justify-center text-on-surface-variant hover:text-on-surface" onClick={resetForm}>
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>
            <form onSubmit={handleAddHunian} className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-on-surface flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[16px] text-on-surface-variant">tag</span>
                    Blok / No. Rumah
                  </label>
                  <input
                    className={`w-full h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all ${formErrors.blok ? "ring-2 ring-error" : ""}`}
                    placeholder="Contoh: A1"
                    maxLength={20}
                    value={formHunian.blok}
                    onChange={(e) => setFormHunian({ ...formHunian, blok: e.target.value })}
                  />
                  {formErrors.blok && <span className="text-xs text-error font-semibold">{formErrors.blok}</span>}
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-on-surface flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[16px] text-on-surface-variant">category</span>
                    Jenis Hunian
                  </label>
                  <select
                    className="w-full h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all"
                    value={formHunian.jenis}
                    onChange={(e) => setFormHunian({ ...formHunian, jenis: e.target.value })}
                  >
                    <option value="Rumah Tinggal">Rumah Tinggal</option>
                    <option value="Rumah Sewa">Rumah Sewa</option>
                    <option value="Rumah Kos">Rumah Kos</option>
                    <option value="Ruko">Ruko</option>
                  </select>
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[16px] text-on-surface-variant">home</span>
                  Alamat Lengkap
                </label>
                <input
                  className={`w-full h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all ${formErrors.alamat ? "ring-2 ring-error" : ""}`}
                  placeholder="Blok XX No. YY"
                  maxLength={160}
                  value={formHunian.alamat}
                  onChange={(e) => setFormHunian({ ...formHunian, alamat: e.target.value })}
                />
                {formErrors.alamat && <span className="text-xs text-error font-semibold">{formErrors.alamat}</span>}
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[16px] text-on-surface-variant">verified</span>
                  Status Hunian
                </label>
                <select
                  className="w-full h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all"
                  value={formHunian.status}
                  onChange={(e) => setFormHunian({ ...formHunian, status: e.target.value })}
                >
                  <option value="Dihuni Pemilik">Dihuni Pemilik</option>
                  <option value="Sewa/Kontrak">Sewa/Kontrak</option>
                  <option value="Kosong">Kosong</option>
                </select>
              </div>
              <div className="p-3 rounded-xl bg-secondary-container/20 flex items-start gap-2">
                <span className="material-symbols-outlined text-secondary text-[16px] mt-0.5">person</span>
                <p className="text-xs text-on-surface-variant leading-relaxed">
                  Penghuni unit ini diturunkan otomatis dari Kartu Keluarga yang terdaftar pada alamat ini. Untuk menambah/mengubah penghuni, gunakan menu <strong className="text-on-surface">Data Warga</strong> — data hunian hanya mencatat unit, status huni, dan alamatnya.
                </p>
              </div>

              {/* Alamat kembar: hanya informasi — satu alamat = satu baris unit;
                  Multi-KK dikelola lewat Data Warga, bukan unit baru. */}
              {alamatMatch && (
                <div className="p-3 rounded-xl bg-tertiary-container/20 flex items-start gap-2">
                  <span className="material-symbols-outlined text-tertiary text-[16px] mt-0.5">groups</span>
                  <p className="text-xs text-on-surface-variant leading-relaxed">
                    Alamat ini sudah terdaftar sebagai <strong className="text-on-surface">Blok {alamatMatch.blok}</strong> ({alamatMatch.alamat}) dengan {jumlahKK(alamatMatch, kkList)} KK. Tambahkan KK baru lewat menu <strong className="text-on-surface">Data Warga</strong> — bukan sebagai unit hunian baru.
                  </p>
                </div>
              )}

              <div className="p-3 rounded-xl bg-secondary-container/20 flex items-start gap-2">
                <span className="material-symbols-outlined text-secondary text-[16px] mt-0.5">info</span>
                <p className="text-xs text-on-surface-variant leading-relaxed">
                  Satu alamat dapat menampung lebih dari satu KK — jumlah KK mengikuti data Kartu Keluarga dari menu Data Warga. Isi alamat yang belum terdaftar untuk membuat unit hunian baru.
                </p>
              </div>
              <div className="flex items-center justify-end gap-3 pt-2 border-t border-surface-container-high">
                <button type="button" className="h-11 px-4 rounded-xl text-on-surface-variant text-sm hover:bg-surface-container-high transition-colors" onClick={resetForm}>Batal</button>
                <button
                  type="submit"
                  disabled={simpanSedang}
                  className="h-11 px-6 rounded-xl bg-primary text-on-primary text-sm font-bold shadow-md hover:bg-primary-container active:scale-[0.98] transition-all flex items-center gap-2 disabled:opacity-60 disabled:cursor-wait disabled:active:scale-100"
                >
                  <span className="material-symbols-outlined text-[18px]">save</span>
                  {simpanSedang ? "Menyimpan..." : "Simpan Hunian"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Detail Hunian */}
      {showDetailModal && (() => {
        const rumah = showDetailModal;
        const count = jumlahKK(rumah, kkList);
        const effStatus = count > 1 ? "Multi-KK" : rumah.status;
        const penghuni = penghuniList(rumah);
        return (
          <div className="fixed inset-0 z-50 bg-on-background/40 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="w-full max-w-md mx-4 sm:mx-auto rounded-2xl bg-surface-container-lowest shadow-2xl p-6 flex flex-col gap-5 max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-primary-container flex items-center justify-center text-on-primary-container">
                    <span className="material-symbols-outlined text-[22px]">home_work</span>
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-on-surface">Detail Hunian {rumah.blok}</h3>
                    <p className="text-xs text-on-surface-variant">{rumah.alamat}, {tenant.label}</p>
                  </div>
                </div>
                <button className="w-8 h-8 rounded-lg bg-surface-container flex items-center justify-center text-on-surface-variant hover:text-on-surface" onClick={() => setShowDetailModal(null)}>
                  <span className="material-symbols-outlined text-[18px]">close</span>
                </button>
              </div>
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 rounded-lg bg-surface-container-low">
                  <span className="text-sm text-on-surface-variant">Jenis Hunian</span>
                  <span className="text-sm font-bold text-on-surface">{rumah.jenis}</span>
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg bg-surface-container-low">
                  <span className="text-sm text-on-surface-variant">KK Terdaftar</span>
                  <span className="text-sm font-bold text-on-surface">{count} KK</span>
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg bg-surface-container-low">
                  <span className="text-sm text-on-surface-variant">Status</span>
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${badgeFor(effStatus)}`}>
                    <span className="w-2 h-2 rounded-full bg-current opacity-60" />
                    {effStatus}
                  </span>
                </div>
                <div className="p-3 rounded-lg bg-surface-container-low flex flex-col gap-1.5">
                  <span className="text-sm text-on-surface-variant">Kepala KK / Penghuni</span>
                  {penghuni.length > 0 ? (
                    <ul className="flex flex-col gap-1">
                      {penghuni.map((n, i) => (
                        <li key={`${n}-${i}`} className="text-sm font-semibold text-on-surface flex items-center gap-1.5">
                          <span className="material-symbols-outlined text-[15px] text-primary">person</span>
                          {n}
                          <span className="text-[11px] font-normal text-on-surface-variant">(KK {i + 1})</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-xs text-on-surface-variant">Belum ada nama penghuni tercatat di alamat ini.</span>
                  )}
                </div>
                {count > 1 && (
                  <div className="p-3 rounded-xl bg-tertiary-container/20 flex items-start gap-2">
                    <span className="material-symbols-outlined text-tertiary text-[16px] mt-0.5">groups</span>
                    <p className="text-xs text-on-surface-variant leading-relaxed">
                      Alamat ini memiliki {count} KK terdaftar (Multi-KK). Silakan kelola data warga per KK melalui menu Data Warga.
                    </p>
                  </div>
                )}
              </div>
              <div className="flex items-center justify-end gap-3 pt-2 border-t border-surface-container-high">
                <button className="h-11 px-4 rounded-xl text-on-surface-variant text-sm hover:bg-surface-container-high transition-colors" onClick={() => setShowDetailModal(null)}>Tutup</button>
                <button
                  className="h-11 px-6 rounded-xl bg-primary text-on-primary text-sm font-bold shadow-md hover:bg-primary-container active:scale-[0.98] transition-all flex items-center gap-2"
                  onClick={() => { setShowDetailModal(null); onNavigate?.("data-warga-rt"); }}
                >
                  <span className="material-symbols-outlined text-[18px]">group</span>
                  Lihat Warga di Alamat Ini
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
