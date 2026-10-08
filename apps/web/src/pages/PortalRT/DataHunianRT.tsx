import { useState } from "react";
import { tenant } from "../../lib/tenant";
import {
  GalatApi,
  hunianServerKeHunian,
  statusHuniDariForm,
  type HasilHapusHunian,
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
  /**
   * Okt 2026 · Edit SATU hunian (`PATCH /rt/hunian/:id`, "Edit hanya per
   * hunian") — pola API-first sama: sukses → `{hunian}`; OFFLINE → `null`
   * (jalur demo lokal + pesan jujur); galat lain DILEMPAR (409 alamat/blok
   * kembar, 404) supaya pesan server tampil.
   */
  onUbahHunian?: (
    id: string,
    patch: Partial<TambahHunianRtPayload>,
  ) => Promise<{ hunian: HunianServer; kkTertaut?: number } | null>;
  /** `DELETE /rt/hunian/:id` — hapus SATU unit. OFFLINE → `null`; unit berpenghuni → 409 DILEMPAR. */
  onHapusHunian?: (id: string) => Promise<boolean | null>;
  /**
   * `DELETE /rt/hunian` massal `{ids}` — "hapus >1 data hunian dengan selected
   * data". Hasil PARSIAL `{terhapus, tertolak}` (unit terisi tetap ditolak
   * server per baris); OFFLINE → `null` (jalur demo lokal + pesan jujur).
   */
  onHapusBanyak?: (ids: string[]) => Promise<HasilHapusHunian | null>;
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

/** Label FE dari enum `status_huni` — padanan `LABEL_STATUS_HUNI` (api.ts) untuk jalur demo lokal. */
const LABEL_FORM: Record<string, string> = {
  milik: "Dihuni Pemilik",
  sewa: "Sewa/Kontrak",
  kontrak: "Sewa/Kontrak",
  kos: "Kos",
};

/**
 * Unit yang tidak dimiliki penghuninya: sewa/kontrak — termasuk turunan
 * status "Kos" (rumah kos, enum `status_huni` dari server) dan jenis "Rumah Sewa".
 */
function sewaAsli(r: HunianRumah): boolean {
  return r.status === "Sewa/Kontrak" || r.status === "Kos" || r.jenis.includes("Sewa");
}

export function DataHunianRT({ onNavigate, kkList, hunian, onHunianChange, onTambahHunian, onUbahHunian, onHapusHunian, onHapusBanyak }: DataHunianRTProps) {
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
    // Batch 15 · unit kendaraan roda 4 (0–99) — string agar konsisten dengan
    // field form lain; hanya digit yang diterima saat diketik.
    kendaraanR4: "1",
  });
  const [simpanSedang, setSimpanSedang] = useState(false);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  // Okt 2026 · "Edit hanya per hunian" + "hapus >1 data hunian dengan selected
  // data": `editTarget` = baris yang diedit (form disalin dari barisnya);
  // `modeHapus` = mode centang baris (hanya unit KOSONG yang bisa dicentang —
  // server menolak unit berpenghuni per baris); `konfirmasiHapus` = dialog
  // konfirmasi berisi target + label barisnya (satuan maupun massal).
  const [editTarget, setEditTarget] = useState<HunianRumah | null>(null);
  const [modeHapus, setModeHapus] = useState(false);
  const [terpilih, setTerpilih] = useState<string[]>([]);
  const [konfirmasiHapus, setKonfirmasiHapus] = useState<{ ids: string[]; label: string } | null>(null);
  const [hapusSedang, setHapusSedang] = useState(false);


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
    if (!/^\d{1,2}$/.test(formHunian.kendaraanR4)) {
      errors.kendaraanR4 = "Isi jumlah kendaraan roda 4 (angka 0–99)";
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
          unitKendaraanR4: Number(formHunian.kendaraanR4),
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
        unitKendaraanR4: Number(formHunian.kendaraanR4),
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
    setFormHunian({ blok: "", alamat: "", jenis: "Rumah Tinggal", status: "Dihuni Pemilik", kendaraanR4: "1" });
    setFormErrors({});
  }

  /* ---------- Edit SATU hunian (Okt 2026 — "Edit hanya per hunian") ---------- */
  function bukaEdit(r: HunianRumah) {
    setShowDetailModal(null);
    setShowAddHunianModal(false);
    setFormErrors({});
    // Salin nilai baris ke form (status boleh berupa turunan "Multi-KK"/"Kos" —
    // opsi select selalu menyertakan nilai saat ini agar tak pernah kosong).
    setFormHunian({
      blok: r.blok,
      alamat: r.alamat,
      jenis: r.jenis,
      status: r.status,
      kendaraanR4: String(r.unitKendaraanR4 ?? 1),
    });
    setEditTarget(r);
  }

  /** Select status hanya bila efeknya TERLIHAT: unit dengan tepat 1 KK & jenis non-sewa/kos. */
  function statusTerkunci(r: HunianRumah, jenis: string): "kosong" | "multi" | "jenis" | null {
    const count = jumlahKK(r, kkList);
    if (count === 0) return "kosong";
    if (count > 1) return "multi";
    if (jenis === "Rumah Sewa" || jenis === "Rumah Kos") return "jenis";
    return null;
  }

  async function handleSimpanEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editTarget || simpanSedang) return;
    const errors: Record<string, string> = {};
    const blokBaru = formHunian.blok.trim();
    const alamatBaru = formHunian.alamat.trim();
    const count = jumlahKK(editTarget, kkList);
    if (!blokBaru) errors.blok = "Blok wajib diisi";
    if (!alamatBaru) errors.alamat = "Alamat wajib diisi";
    if (
      blokBaru &&
      rumahList.some((r) => r.id !== editTarget.id && r.blok.toLowerCase() === blokBaru.toLowerCase())
    ) {
      errors.blok = "Blok sudah terdaftar di unit lain";
    }
    const kembar = alamatBaru
      ? rumahList.find((r) => r.id !== editTarget.id && normAlamat(r.alamat) === normAlamat(alamatBaru))
      : undefined;
    if (kembar) {
      errors.alamat = `Alamat sudah terdaftar sebagai unit Hunian ${kembar.blok} — satu alamat = satu unit (tambah KK lewat Data Warga).`;
    }
    // Guard enum: "Kosong" tidak ada di `status_huni` (tampil diturunkan dari
    // jumlah KK = 0) — pilihan yang tak bisa disimpan DITOLAK, bukan diabaikan.
    if (formHunian.status === "Kosong" && count > 0) {
      errors.status = `Unit masih menampung ${count} KK — kosongkan dulu lewat Data Warga sebelum status diubah menjadi Kosong.`;
    }
    if (formHunian.status !== "Kosong" && count === 0) {
      errors.status = `Unit ini belum punya KK — status tampil "Kosong" sampai ada KK terdaftar (Data Warga).`;
    }
    if (!/^\d{1,2}$/.test(formHunian.kendaraanR4)) {
      errors.kendaraanR4 = "Isi jumlah kendaraan roda 4 (angka 0–99)";
    }
    setFormErrors(errors);
    if (Object.keys(errors).length > 0) return;

    // PATCH hanya field yang berubah; `statusHuni` hanya bila enum hasil
    // perhitungan BEDA dari baris sekarang — nilai tersimpan tak pernah hilang
    // karena pilihan display (baris Multi-KK / enum lama `kontrak` tetap utuh).
    const patch: Partial<TambahHunianRtPayload> = {};
    if (blokBaru !== editTarget.blok) patch.kodeRumah = blokBaru;
    if (alamatBaru !== editTarget.alamat) patch.alamat = alamatBaru;
    const enumLama = statusHuniDariForm(editTarget.jenis, editTarget.status);
    const enumBaru = statusHuniDariForm(formHunian.jenis, formHunian.status);
    if (enumBaru !== enumLama) patch.statusHuni = enumBaru;
    if (Number(formHunian.kendaraanR4) !== (editTarget.unitKendaraanR4 ?? 1)) {
      patch.unitKendaraanR4 = Number(formHunian.kendaraanR4);
    }
    if (Object.keys(patch).length === 0) {
      setEditTarget(null);
      flash("Tidak ada perubahan untuk disimpan.");
      return;
    }

    setSimpanSedang(true);
    try {
      if (onUbahHunian) {
        const hasil = await onUbahHunian(editTarget.id, patch);
        if (hasil) {
          const baris = hunianServerKeHunian(hasil.hunian);
          onHunianChange(rumahList.map((r) => (r.id === editTarget.id ? baris : r)));
          setEditTarget(null);
          flash(
            hasil.kkTertaut
              ? `Hunian ${baris.blok} diperbarui — ${hasil.kkTertaut} KK lama tertaut kembali ke alamat baru (tersimpan di server).`
              : `Hunian ${baris.blok} — ${baris.alamat} diperbarui (tersimpan di server).`,
          );
          return;
        }
      }

      // OFFLINE / tanpa handler — perubahan lokal + pesan JUJUR (bukan "berhasil").
      const barisLokal: HunianRumah = {
        ...editTarget,
        blok: blokBaru,
        alamat: alamatBaru,
        jenis: formHunian.jenis,
        status:
          count === 0
            ? "Kosong"
            : count > 1
              ? "Multi-KK"
              : (LABEL_FORM[enumBaru] ?? formHunian.status),
        unitKendaraanR4: Number(formHunian.kendaraanR4),
      };
      onHunianChange(rumahList.map((r) => (r.id === editTarget.id ? barisLokal : r)));
      setEditTarget(null);
      flash(
        `Mode demo (server tidak terjangkau) — perubahan hunian ${blokBaru} hanya tampil di daftar lokal, TIDAK tersimpan di server.`,
      );
    } catch (err) {
      flash(err instanceof GalatApi ? err.message : "Gagal menyimpan perubahan — coba lagi.");
    } finally {
      setSimpanSedang(false);
    }
  }

  /* ---------- Hapus (satuan & massal — konfirmasi satu dialog) ---------- */
  function batalModeHapus() {
    setModeHapus(false);
    setTerpilih([]);
  }

  /**
   * Jalankan hapus dari dialog konfirmasi. Satuan → `DELETE /:id`; massal →
   * `DELETE /rt/hunian` (hasil parsial). OFFLINE → `null` → jalur demo lokal
   * dengan pesan jujur; galat (409 berpenghuni dsb.) → pesan server.
   */
  async function jalankanHapus() {
    const target = konfirmasiHapus;
    if (!target || hapusSedang) return;
    const tutup = () => {
      setKonfirmasiHapus(null);
      batalModeHapus();
    };
    setHapusSedang(true);
    try {
      if (target.ids.length === 1) {
        const id = target.ids[0];
        if (onHapusHunian) {
          const ok = await onHapusHunian(id);
          if (ok !== null) {
            onHunianChange(rumahList.filter((r) => r.id !== id));
            tutup();
            flash(`Hunian ${target.label} dihapus (tersimpan di server).`);
            return;
          }
        }
        onHunianChange(rumahList.filter((r) => r.id !== id));
        tutup();
        flash(
          `Mode demo (server tidak terjangkau) — hunian ${target.label} dihapus dari daftar lokal saja, TIDAK dihapus di server.`,
        );
        return;
      }

      if (onHapusBanyak) {
        const hasil = await onHapusBanyak(target.ids);
        if (hasil) {
          const setHapus = new Set(hasil.terhapus);
          onHunianChange(rumahList.filter((r) => !setHapus.has(r.id)));
          tutup();
          flash(
            hasil.tertolak.length > 0
              ? `${hasil.terhapus.length} unit dihapus; ${hasil.tertolak.length} DITOLAK server: ${hasil.tertolak
                  .map((t) => `${t.alamat} (${t.alasan})`)
                  .join("; ")}.`
              : `${hasil.terhapus.length} unit dihapus (tersimpan di server).`,
          );
          return;
        }
      }
      onHunianChange(rumahList.filter((r) => !target.ids.includes(r.id)));
      tutup();
      flash(
        `Mode demo (server tidak terjangkau) — ${target.ids.length} unit dihapus dari daftar lokal saja, TIDAK dihapus di server.`,
      );
    } catch (err) {
      flash(err instanceof GalatApi ? err.message : "Gagal menghapus hunian — coba lagi.");
    } finally {
      setHapusSedang(false);
    }
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

  // Okt 2026 · hapus multi-select: hanya unit KOSONG (jumlah KK = 0) yang bisa
  // dicentang — server menolak unit terisi per baris (409), jadi pencegahan
  // dimulai dari pilihan baris.
  const bisaPilih = (r: HunianRumah) => jumlahKK(r, kkList) === 0;
  const kosongTerlihat = filtered.filter(bisaPilih);
  const semuaTerpilih =
    kosongTerlihat.length > 0 && kosongTerlihat.every((r) => terpilih.includes(r.id));

  function togglePilih(id: string) {
    setTerpilih((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function toggleSemua() {
    if (semuaTerpilih) {
      const setKosong = new Set(kosongTerlihat.map((r) => r.id));
      setTerpilih((prev) => prev.filter((id) => !setKosong.has(id)));
    } else {
      setTerpilih((prev) => Array.from(new Set([...prev, ...kosongTerlihat.map((r) => r.id)])));
    }
  }

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
        <div className="flex items-center gap-2 shrink-0">
          {/* Okt 2026 · mode hapus multi-pilih (hanya unit kosong yang bisa dicentang). */}
          <button
            className={`h-11 px-5 rounded-xl text-sm shadow-md active:scale-[0.98] transition-all flex items-center gap-2 ${
              modeHapus
                ? "bg-surface-container-high text-on-surface-variant hover:bg-surface-container"
                : "bg-error-container/40 text-on-error-container hover:bg-error-container hover:text-on-error-container"
            }`}
            onClick={() => (modeHapus ? batalModeHapus() : setModeHapus(true))}
          >
            <span className="material-symbols-outlined text-[20px]">
              {modeHapus ? "close" : "delete_sweep"}
            </span>
            {modeHapus ? "Batal Hapus" : "Hapus Data Hunian"}
          </button>
          <button
            className="h-11 px-5 rounded-xl bg-primary text-on-primary text-sm shadow-md hover:bg-primary-container active:scale-[0.98] transition-all flex items-center gap-2"
            onClick={() => setShowAddHunianModal(true)}
          >
            <span className="material-symbols-outlined text-[20px]">add</span>
            + Tambah Hunian
          </button>
        </div>
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

      {/* Strip baris terpilih (mode hapus) — jumlah + aksi batch. */}
      {modeHapus && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 rounded-xl bg-error-container/20 border border-error/40">
          <div className="flex items-center gap-2 text-sm font-bold text-on-surface flex-1">
            <span className="material-symbols-outlined text-error">delete_sweep</span>
            <span>
              {terpilih.length} unit dipilih
              <span className="font-normal text-on-surface-variant">
                {" "}— hanya unit kosong yang dapat dipilih & dihapus
              </span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="h-9 px-4 rounded-lg text-xs font-semibold text-on-surface-variant hover:bg-surface-container-high transition-colors"
              onClick={batalModeHapus}
            >
              Batal
            </button>
            <button
              className="h-9 px-4 rounded-lg bg-error text-on-error text-xs font-bold shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]"
              disabled={terpilih.length === 0}
              onClick={() =>
                setKonfirmasiHapus({
                  ids: terpilih,
                  label: `${terpilih.length} unit terpilih`,
                })
              }
            >
              Hapus {terpilih.length} Terpilih
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-surface-container-lowest rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-on-surface">
            <thead className="bg-surface-container-low text-xs text-on-surface-variant uppercase tracking-wider">
              <tr>
                {modeHapus && (
                  <th className="py-3 px-4 w-10">
                    <input
                      type="checkbox"
                      className="w-4 h-4 accent-error cursor-pointer"
                      aria-label="Pilih semua unit kosong yang tampil"
                      checked={semuaTerpilih}
                      disabled={kosongTerlihat.length === 0}
                      onChange={toggleSemua}
                    />
                  </th>
                )}
                <th className="py-3 px-6">Blok</th>
                <th className="py-3 px-4">Alamat</th>
                <th className="py-3 px-4">Jenis Hunian</th>
                <th className="py-3 px-4 text-center">KK Terdaftar</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-center">Kendaraan R4</th>
                <th className="py-3 px-6 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-container-high">
              {filtered.map((rumah) => {
                const count = jumlahKK(rumah, kkList);
                const effStatus = count > 1 ? "Multi-KK" : rumah.status;
                return (
                  <tr key={rumah.id} className="hover:bg-surface-container-low/50 transition-colors">
                    {modeHapus && (
                      <td className="py-4 px-4">
                        <input
                          type="checkbox"
                          className="w-4 h-4 accent-error cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                          checked={terpilih.includes(rumah.id)}
                          disabled={!bisaPilih(rumah)}
                          title={
                            bisaPilih(rumah)
                              ? "Pilih unit ini untuk dihapus"
                              : `Unit menampung ${count} KK — hanya unit kosong yang dapat dihapus`
                          }
                          onChange={() => togglePilih(rumah.id)}
                        />
                      </td>
                    )}
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
                    <td className="py-4 px-4 text-center">
                      <span
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-surface-container-low text-on-surface hover:bg-surface-container-high transition-colors"
                        title="Jumlah kendaraan roda 4 unit ini — dasar iuran kendaraan bila diaktifkan (perhitungan tagihan belum memakai nilai ini)"
                      >
                        <span className="material-symbols-outlined text-[14px]">directions_car</span>
                        {rumah.unitKendaraanR4 ?? 1} unit
                      </span>
                    </td>
                    <td className="py-4 px-6 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {/* Edit per baris (Okt 2026 — disembunyikan di mode hapus agar fokus pilih). */}
                        {!modeHapus && (
                          <button
                            className="h-9 px-3 rounded-lg bg-surface-container-low text-on-surface-variant hover:text-primary hover:bg-surface-container text-sm font-semibold inline-flex items-center gap-1 transition-colors"
                            title="Edit hunian ini"
                            onClick={() => bukaEdit(rumah)}
                          >
                            <span className="material-symbols-outlined text-[16px]">edit</span>
                            Edit
                          </button>
                        )}
                        <button
                          className="h-9 w-9 rounded-lg bg-surface-container-low text-on-surface-variant hover:text-error hover:bg-error-container/30 inline-flex items-center justify-center transition-colors"
                          title={
                            count > 0
                              ? `Unit menampung ${count} KK — server dapat menolak (409)`
                              : "Hapus hunian ini"
                          }
                          onClick={() =>
                            setKonfirmasiHapus({
                              ids: [rumah.id],
                              label: `${rumah.blok} — ${rumah.alamat}`,
                            })
                          }
                        >
                          <span className="material-symbols-outlined text-[16px]">delete</span>
                        </button>
                        <button
                          className="h-9 px-3 rounded-lg bg-surface-container-low text-on-surface-variant hover:text-primary hover:bg-surface-container text-sm font-semibold inline-flex items-center gap-1 transition-colors"
                          onClick={() => setShowDetailModal(rumah)}
                        >
                          <span className="material-symbols-outlined text-[16px]">visibility</span>
                          Detail
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={modeHapus ? 8 : 7} className="py-4">
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
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[16px] text-on-surface-variant">directions_car</span>
                  Jumlah Kendaraan Roda 4
                </label>
                <input
                  className={`w-full h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all ${formErrors.kendaraanR4 ? "ring-2 ring-error" : ""}`}
                  placeholder="Contoh: 2"
                  inputMode="numeric"
                  maxLength={2}
                  value={formHunian.kendaraanR4}
                  onChange={(e) => setFormHunian({ ...formHunian, kendaraanR4: e.target.value.replace(/\D/g, "") })}
                />
                {formErrors.kendaraanR4 && <span className="text-xs text-error font-semibold">{formErrors.kendaraanR4}</span>}
                <span className="text-[11px] text-on-surface-variant leading-snug">
                  0–99 unit — dicatat untuk keperluan iuran kendaraan bila diaktifkan; perhitungan tagihan iuran belum memakai nilai ini.
                </span>
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

      {/* Modal: Edit Hunian — satu per baris (Okt 2026: "Edit hanya per hunian") */}
      {editTarget && (() => {
        const kunci = statusTerkunci(editTarget, formHunian.jenis);
        const opsiJenis = [
          formHunian.jenis,
          "Rumah Tinggal",
          "Rumah Sewa",
          "Rumah Kos",
          "Ruko",
        ].filter((v, i, a) => a.indexOf(v) === i);
        // Nilai saat ini SELALU ikut (bisa berupa turunan "Multi-KK"/"Kos" yang
        // tak ada di form tambah) agar select tidak pernah kehilangan nilai.
        const opsiStatus = [
          formHunian.status,
          "Dihuni Pemilik",
          "Sewa/Kontrak",
          "Kosong",
        ].filter((v, i, a) => a.indexOf(v) === i);
        return (
          <div className="fixed inset-0 z-50 bg-on-background/40 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="w-full max-w-lg mx-4 sm:mx-auto rounded-2xl bg-surface-container-lowest shadow-2xl p-6 flex flex-col gap-5 max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-primary-container flex items-center justify-center text-on-primary-container">
                    <span className="material-symbols-outlined text-[22px]">edit</span>
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-on-surface">Edit Hunian {editTarget.blok}</h3>
                    <p className="text-xs text-on-surface-variant">{editTarget.alamat}, {tenant.label}</p>
                  </div>
                </div>
                <button
                  className="w-8 h-8 rounded-lg bg-surface-container flex items-center justify-center text-on-surface-variant hover:text-on-surface"
                  onClick={() => setEditTarget(null)}
                >
                  <span className="material-symbols-outlined text-[18px]">close</span>
                </button>
              </div>
              <form onSubmit={handleSimpanEdit} className="flex flex-col gap-4">
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
                      {opsiJenis.map((o) => (
                        <option key={o} value={o}>{o}</option>
                      ))}
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
                    className="w-full h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                    value={formHunian.status}
                    disabled={kunci !== null}
                    onChange={(e) => setFormHunian({ ...formHunian, status: e.target.value })}
                  >
                    {opsiStatus.map((o) => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </select>
                  {formErrors.status && <span className="text-xs text-error font-semibold">{formErrors.status}</span>}
                  {kunci && !formErrors.status && (
                    <span className="text-[11px] text-on-surface-variant leading-snug">
                      {kunci === "kosong"
                        ? 'Unit tanpa KK — status selalu tampil "Kosong" sampai ada KK terdaftar lewat Data Warga.'
                        : kunci === "multi"
                          ? "Unit Multi-KK — tampilan status mengikuti jumlah KK; status tersimpan tidak terlihat di tabel."
                          : "Status mengikuti jenis hunian (Rumah Sewa / Rumah Kos) — ubah jenis bila perlu."}
                    </span>
                  )}
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-on-surface flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[16px] text-on-surface-variant">directions_car</span>
                    Jumlah Kendaraan Roda 4
                  </label>
                  <input
                    className={`w-full h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all ${formErrors.kendaraanR4 ? "ring-2 ring-error" : ""}`}
                    placeholder="Contoh: 2"
                    inputMode="numeric"
                    maxLength={2}
                    value={formHunian.kendaraanR4}
                    onChange={(e) => setFormHunian({ ...formHunian, kendaraanR4: e.target.value.replace(/\D/g, "") })}
                  />
                  {formErrors.kendaraanR4 && <span className="text-xs text-error font-semibold">{formErrors.kendaraanR4}</span>}
                  <span className="text-[11px] text-on-surface-variant leading-snug">
                    0–99 unit — warga Portal Warga juga dapat memperbarui nilai ini untuk huniannya; perhitungan tagihan iuran belum memakai nilai ini.
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-secondary-container/20 flex items-start gap-2">
                  <span className="material-symbols-outlined text-secondary text-[16px] mt-0.5">info</span>
                  <p className="text-xs text-on-surface-variant leading-relaxed">
                    Penghuni tetap diturunkan dari Kartu Keluarga pada alamat ini. Perubahan unit disimpan lewat server (PATCH /rt/hunian) — bila server tidak terjangkau, perubahan hanya tampil lokal dengan pesan jujur.
                  </p>
                </div>
                <div className="flex items-center justify-end gap-3 pt-2 border-t border-surface-container-high">
                  <button
                    type="button"
                    className="h-11 px-4 rounded-xl text-on-surface-variant text-sm hover:bg-surface-container-high transition-colors"
                    onClick={() => setEditTarget(null)}
                  >
                    Batal
                  </button>
                  <button
                    type="submit"
                    disabled={simpanSedang}
                    className="h-11 px-6 rounded-xl bg-primary text-on-primary text-sm font-bold shadow-md hover:bg-primary-container active:scale-[0.98] transition-all flex items-center gap-2 disabled:opacity-60 disabled:cursor-wait disabled:active:scale-100"
                  >
                    <span className="material-symbols-outlined text-[18px]">save</span>
                    {simpanSedang ? "Menyimpan..." : "Simpan Perubahan"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        );
      })()}

      {/* Modal: Konfirmasi Hapus — satuan maupun batch (hasil dilaporkan per unit) */}
      {konfirmasiHapus && (() => {
        const rows = konfirmasiHapus.ids
          .map((id) => rumahList.find((r) => r.id === id))
          .filter((r): r is HunianRumah => !!r);
        const terisi = rows.filter((r) => jumlahKK(r, kkList) > 0);
        const totalKkTerisi = terisi.reduce((n, r) => n + jumlahKK(r, kkList), 0);
        const massal = konfirmasiHapus.ids.length > 1;
        return (
          <div className="fixed inset-0 z-50 bg-on-background/40 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="w-full max-w-md mx-4 sm:mx-auto rounded-2xl bg-surface-container-lowest shadow-2xl p-6 flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-error-container/40 flex items-center justify-center text-error shrink-0">
                  <span className="material-symbols-outlined text-[22px]">delete_sweep</span>
                </div>
                <div>
                  <h3 className="text-base font-bold text-on-surface">
                    {massal
                      ? `Hapus ${konfirmasiHapus.ids.length} Unit Hunian?`
                      : "Hapus Hunian Ini?"}
                  </h3>
                  <p className="text-xs text-on-surface-variant">
                    {massal ? "Daftar unit yang akan dihapus:" : konfirmasiHapus.label}
                  </p>
                </div>
              </div>

              {massal && (
                <ul className="max-h-40 overflow-y-auto flex flex-col gap-1 rounded-xl bg-surface-container-low p-3">
                  {rows.map((r) => (
                    <li key={r.id} className="text-xs text-on-surface flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-[14px] text-on-surface-variant">home</span>
                      <span className="font-bold">{r.blok}</span>
                      <span className="text-on-surface-variant">— {r.alamat}</span>
                    </li>
                  ))}
                  {rows.length < konfirmasiHapus.ids.length && (
                    <li className="text-xs text-on-surface-variant italic">
                      ({konfirmasiHapus.ids.length - rows.length} baris tidak lagi ada di daftar)
                    </li>
                  )}
                </ul>
              )}

              {terisi.length > 0 && (
                <div className="p-3 rounded-xl bg-error-container/30 flex items-start gap-2">
                  <span className="material-symbols-outlined text-error text-[16px] mt-0.5">warning</span>
                  <p className="text-xs text-on-surface-variant leading-relaxed">
                    <strong className="text-on-surface">{terisi.length} unit masih menampung {totalKkTerisi} KK</strong> —
                    server MENOLAK unit terisi (409). Kosongkan lewat menu Data Warga terlebih dulu.
                  </p>
                </div>
              )}

              <div className="p-3 rounded-xl bg-secondary-container/20 flex items-start gap-2">
                <span className="material-symbols-outlined text-secondary text-[16px] mt-0.5">info</span>
                <p className="text-xs text-on-surface-variant leading-relaxed">
                  Yang dihapus hanya <strong className="text-on-surface">baris unit hunian</strong> — data warga
                  (Kartu Keluarga, NIK, iuran, kas) TIDAK ikut terhapus.
                </p>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2 border-t border-surface-container-high">
                <button
                  className="h-11 px-4 rounded-xl text-on-surface-variant text-sm hover:bg-surface-container-high transition-colors"
                  onClick={() => setKonfirmasiHapus(null)}
                  disabled={hapusSedang}
                >
                  Batal
                </button>
                <button
                  className="h-11 px-6 rounded-xl bg-error text-on-error text-sm font-bold shadow-md active:scale-[0.98] transition-all flex items-center gap-2 disabled:opacity-60 disabled:cursor-wait disabled:active:scale-100"
                  onClick={() => void jalankanHapus()}
                  disabled={hapusSedang}
                >
                  <span className="material-symbols-outlined text-[18px]">delete</span>
                  {hapusSedang
                    ? "Menghapus..."
                    : massal
                      ? `Ya, Hapus ${konfirmasiHapus.ids.length} Unit`
                      : "Ya, Hapus"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

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
                <div className="flex items-center justify-between p-3 rounded-lg bg-surface-container-low">
                  <span className="text-sm text-on-surface-variant">Kendaraan Roda 4</span>
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-surface-container text-on-surface">
                    <span className="material-symbols-outlined text-[14px]">directions_car</span>
                    {rumah.unitKendaraanR4 ?? 1} unit
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
