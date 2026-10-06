import { useEffect, useState } from "react";
import { tenant } from "../../lib/tenant";
import {
  Pengurus,
  Surat,
  StatusSurat,
  suratBadge,
  suratPerluRw,
  downloadText,
  jenisSuratOptions,
  noSuratOtomatis,
  ukuranBerkas,
  KopSurat,
  kopSuratDefault,
} from "../../lib/shared";
import { GalatApi, tautanLampiranSurat, type AksiSuratRt, type PengaturanSuratRt } from "../../lib/api";
import { EmptyState } from "../../components/EmptyState";
import { useFlash } from "../../lib/useFlash";

interface SuratPengantarRTProps {
  onNavigate?: (page: string) => void;
  pengurus: Pengurus[];
  surat: Surat[];
  /**
   * B12 — jalankan aksi persuratan (terbitkan/setujui/tolak/minta-perbaikan);
   * baris tanpa `serverId` dibuat dulu ke server oleh App (deviasi §5.4).
   * OFFLINE → patch lokal; galat lain MELEMPAR (sesi habis ditangani App).
   * Mengembalikan baris FE hasil aksi (untuk pesan sukses).
   */
  onProsesSurat: (
    row: Surat,
    aksi: AksiSuratRt,
    catatan?: string,
  ) => Promise<{ surat: Surat; dariServer: boolean }>;
  /** B12 — `GET /rt/pengaturan` → kop surat tersimpan; `null` = OFFLINE. */
  onMuatPengaturanSurat: () => Promise<PengaturanSuratRt | null>;
}

type StatusFilter = "all" | "menunggu-rt" | "menunggu-rw" | "disetujui" | "ditolak" | "draft" | "perbaikan";

/** Mapping status shared → chip filter. "diproses" lama menjadi "menunggu-rt". */
const statusFilterMap: Record<StatusSurat, StatusFilter> = {
  Draft: "draft",
  "Menunggu RT": "menunggu-rt",
  "Menunggu RW": "menunggu-rw",
  Disetujui: "disetujui",
  Ditolak: "ditolak",
  "Perlu Perbaikan": "perbaikan",
};

// Daftar jenis surat kini bersama (lib/shared.ts) agar pengajuan di Portal Warga
// dan Portal RT selalu memakai jenis yang sama.

export function SuratPengantarRT({
  onNavigate,
  pengurus,
  surat,
  onProsesSurat,
  onMuatPengaturanSurat,
}: SuratPengantarRTProps) {
  const [search, setSearch] = useState("");
  const [filterJenis, setFilterJenis] = useState("all");
  const [filterStatus, setFilterStatus] = useState<StatusFilter>("all");
  const [filterPeriode, setFilterPeriode] = useState("Semua");
  const [previewSurat, setPreviewSurat] = useState<Surat | null>(null);
  const [aksiCatatan, setAksiCatatan] = useState<{ row: Surat; aksi: "tolak" | "perbaikan" } | null>(null);
  const [catatanInput, setCatatanInput] = useState("");
  const { flash, toast } = useFlash();

  // --- B12 · kop surat resmi (§6.6) ------------------------------------------
  // `null` (OFFLINE / belum pernah disimpan) → preview & PDF memakai kop
  // bawaan, yang isinya persis sama dengan kop lama sehingga tampilan tidak
  // berubah. Dimuat sekali saat halaman terbuka (penjaga `batal` seperti B7).
  const [kopSurat, setKopSurat] = useState<KopSurat | null>(null);
  /** Kop untuk preview/PDF: tersimpan bila ada, kalau tidak memakai kop bawaan. */
  const kopPreview = kopSurat ?? kopSuratDefault();
  useEffect(() => {
    let batal = false;
    onMuatPengaturanSurat()
      .then((h) => {
        if (!batal && h) setKopSurat(h.kop);
      })
      .catch(() => {
        // Sesi habis sudah ditangani App; preview tetap memakai kop bawaan.
      });
    return () => {
      batal = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ketuaRT =
    pengurus.find((p) => p.jabatan.toLowerCase().includes("ketua")) ?? pengurus[0];


  const filtered = surat.filter((row) => {
    const matchSearch = search === "" || row.pemohon.toLowerCase().includes(search.toLowerCase()) || row.noSurat.toLowerCase().includes(search.toLowerCase()) || row.keperluan.toLowerCase().includes(search.toLowerCase());
    const matchJenis = filterJenis === "all" || row.jenis === filterJenis;
    const matchStatus = filterStatus === "all" || statusFilterMap[row.status] === filterStatus;
    const matchPeriode = filterPeriode === "Semua" || row.tanggal.includes(filterPeriode);
    return matchSearch && matchJenis && matchStatus && matchPeriode;
  });

  // KPI dari state bersama.
  const totalSurat = surat.length;
  const menungguRt = surat.filter((s) => s.status === "Menunggu RT").length;
  const menungguRw = surat.filter((s) => s.status === "Menunggu RW").length;
  const disetujui = surat.filter((s) => s.status === "Disetujui").length;

  /**
   * B12 — aksi terbitkan: server yang memutus hasilnya (`jenis_surat.perlu_rw`
   * → "Menunggu RW", selain itu langsung "Disetujui"). Baris tanpa `serverId`
   * dibuat dulu ke server oleh App (deviasi §5.4). OFFLINE → patch lokal.
   */
  async function terbitkanSurat(row: Surat) {
    try {
      const { surat: hasil, dariServer } = await onProsesSurat(row, "terbitkan");
      const label = hasil.noSurat || row.noSurat || noSuratOtomatis(surat);
      flash(
        !dariServer
          ? `Server tidak terjangkau — status surat ${label} diubah di sesi ini saja, TIDAK tersimpan di server.`
          : hasil.status === "Menunggu RW"
            ? `Surat ${label} (${hasil.pemohon}) disetujui RT — menunggu persetujuan Portal RW.`
            : `Surat ${label} (${hasil.pemohon}) berhasil diterbitkan.`,
      );
    } catch (err) {
      flash(err instanceof GalatApi ? err.message : "Surat gagal diterbitkan — coba lagi.");
    }
  }

  function bukaCatatan(row: Surat, aksi: "tolak" | "perbaikan") {
    setCatatanInput("");
    setAksiCatatan({ row, aksi });
  }

  /** B12 — tolak / minta perbaikan: galat server ditampilkan, dialog DIBUKA. */
  async function konfirmasiCatatan() {
    if (!aksiCatatan) return;
    const { row, aksi } = aksiCatatan;
    const catatan = catatanInput.trim();
    // Penolakan wajib beralasan (server zod min. 3) — divalidasi di sini dulu
    // agar pengguna tidak menunggu round-trip untuk kesalahan yang jelas.
    if (aksi === "tolak" && catatan.length < 3) {
      flash("Alasan penolakan wajib diisi (minimal 3 karakter).");
      return;
    }
    try {
      const { surat: hasil, dariServer } = await onProsesSurat(row, aksi === "tolak" ? "tolak" : "minta-perbaikan", catatan || undefined);
      const label = hasil.noSurat || hasil.jenis;
      flash(
        !dariServer
          ? `Server tidak terjangkau — keputusan surat ${label} hanya di sesi ini, TIDAK tersimpan di server.`
          : aksi === "tolak"
            ? `Surat ${label} (${hasil.pemohon}) ditolak.`
            : `Surat ${label} (${hasil.pemohon}) ditandai "Perlu Perbaikan".`,
      );
    } catch (err) {
      flash(err instanceof GalatApi ? err.message : "Aksi gagal diproses — coba lagi.");
      return;
    }
    setAksiCatatan(null);
    setCatatanInput("");
  }

  /**
   * B12 — unduh PDF surat pengantar (kop tersimpan RT + QR verifikasi).
   * Modul PDF dimuat dinamis agar halaman ringan; kegagalan QR di dalam
   * `buatPdfSurat` tidak membatalkan unduhan (lihat lib/pdfSurat.ts).
   */
  async function unduhPdfSurat(row: Surat) {
    try {
      const { buatPdfSurat, namaBerkasSurat } = await import("../../lib/pdfSurat");
      const doc = await buatPdfSurat({
        kop: kopSurat,
        idBaris: row.serverId ?? row.id,
        noSurat: row.noSurat,
        jenis: row.jenis,
        pemohon: row.pemohon,
        keperluan: row.keperluan,
        tanggal: row.tanggal,
        status: row.status,
        perluRw: row.perluRw,
        ...(row.qrToken ? { qrToken: row.qrToken } : {}),
        ketua: {
          nama: ketuaRT?.nama ?? "Ketua RT",
          jabatan: ketuaRT?.jabatan ?? "Ketua RT",
          ttd: ketuaRT?.ttd ?? null,
        },
      });
      doc.save(namaBerkasSurat(row.noSurat, row.jenis));
      flash(`PDF surat ${row.noSurat || row.jenis} berhasil diunduh.`);
    } catch (err) {
      flash(err instanceof GalatApi ? err.message : "PDF gagal dibuat — coba lagi.");
    }
  }

  function unduhArsip() {
    const header = "No. Surat,Jenis,Pemohon,Keperluan,Tanggal,Status";
    const isi = [
      header,
      ...surat.map((r) =>
        [r.noSurat, r.jenis, r.pemohon, r.keperluan, r.tanggal, r.status].map(escapeCsv).join(",")
      ),
    ].join("\n");
    downloadText("arsip-surat-pengantar.csv", isi);
    flash(`Arsip ${surat.length} surat berhasil diunduh (CSV).`);
  }

  function escapeCsv(v: string): string {
    return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  }

  return (
    <div className="max-w-7xl mx-auto w-full space-y-6">
      {toast}

      <div className="flex items-center gap-1.5 text-sm text-on-surface-variant">
        <button type="button" className="hover:text-primary transition-colors flex items-center gap-1" onClick={() => onNavigate?.("dashboard-rt")}><span className="material-symbols-outlined text-[16px]">home</span>
          Portal RT
        </button>
        <span className="material-symbols-outlined text-[14px]">chevron_right</span>
        <span className="font-bold text-on-surface">Surat Pengantar</span>
      </div>

      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div className="max-w-3xl space-y-1.5">
          <div className="inline-flex items-center gap-1.5 text-primary text-sm font-bold uppercase tracking-wider">
            <span className="material-symbols-outlined text-[16px]">edit_note</span>
            Manajemen Persuratan
          </div>
          <h1 className="text-2xl lg:text-[32px] text-on-surface tracking-tight font-extrabold">
            Surat Pengantar {tenant.label}
          </h1>
          <p className="text-sm text-on-surface-variant leading-relaxed">
            Kelola dan terbitkan surat pengantar resmi {tenant.rtFull} untuk keperluan administrasi warga. Pengajuan dari Portal Warga masuk otomatis ke antrian ini.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <button
            className="h-11 px-5 rounded-xl bg-surface-container-lowest text-on-surface text-sm shadow-sm hover:shadow-md hover:bg-surface-container transition-all flex items-center gap-2"
            onClick={unduhArsip}
          >
            <span className="material-symbols-outlined text-primary text-[20px]">folder_open</span>
            Unduh Arsip
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-surface-container-lowest rounded-xl p-5 shadow-sm flex flex-col justify-between">
          <div className="flex items-start justify-between">
            <span className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">Total Surat</span>
            <div className="w-10 h-10 rounded-full bg-primary-container flex items-center justify-center text-on-primary-container">
              <span className="material-symbols-outlined text-[22px]">description</span>
            </div>
          </div>
          <div className="mt-4">
            <div className="text-2xl font-extrabold text-on-surface">{totalSurat}</div>
            <div className="text-[11px] text-on-surface-variant mt-1">Semua antrian & arsip</div>
          </div>
        </div>
        <div className="bg-surface-container-lowest rounded-xl p-5 shadow-sm flex flex-col justify-between">
          <div className="flex items-start justify-between">
            <span className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">Menunggu RT</span>
            <div className="w-10 h-10 rounded-full bg-tertiary-container flex items-center justify-center text-on-tertiary-container">
              <span className="material-symbols-outlined text-[22px]">pending</span>
            </div>
          </div>
          <div className="mt-4">
            <div className="text-2xl font-extrabold text-tertiary">{menungguRt}</div>
            <div className="text-[11px] text-tertiary font-semibold mt-1">Perlu Verifikasi RT</div>
          </div>
        </div>
        <div className="bg-surface-container-lowest rounded-xl p-5 shadow-sm flex flex-col justify-between">
          <div className="flex items-start justify-between">
            <span className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">Menunggu RW</span>
            <div className="w-10 h-10 rounded-full bg-secondary-fixed flex items-center justify-center text-on-secondary-fixed">
              <span className="material-symbols-outlined text-[22px]">forward_to_inbox</span>
            </div>
          </div>
          <div className="mt-4">
            <div className="text-2xl font-extrabold text-on-surface">{menungguRw}</div>
            <div className="text-[11px] text-on-surface-variant mt-1">Menunggu persetujuan Portal RW</div>
          </div>
        </div>
        <div className="bg-surface-container-lowest rounded-xl p-5 shadow-sm flex flex-col justify-between">
          <div className="flex items-start justify-between">
            <span className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">Disetujui</span>
            <div className="w-10 h-10 rounded-full bg-secondary-container flex items-center justify-center text-on-secondary-container">
              <span className="material-symbols-outlined text-[22px]">check_circle</span>
            </div>
          </div>
          <div className="mt-4">
            <div className="text-2xl font-extrabold text-secondary">{disetujui}</div>
            <div className="text-[11px] text-secondary font-semibold mt-1">Surat Terbit</div>
          </div>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 p-4 rounded-xl bg-surface-container-lowest shadow-sm">
        <select
          className="h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all"
          value={filterJenis}
          onChange={(e) => setFilterJenis(e.target.value)}
        >
          <option value="all">Semua Jenis Surat</option>
          {jenisSuratOptions.map((j) => (
            <option key={j} value={j}>{j}</option>
          ))}
        </select>
        <select
          className="h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all"
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value as StatusFilter)}
        >
          <option value="all">Semua Status</option>
          <option value="menunggu-rt">Menunggu RT</option>
          <option value="menunggu-rw">Menunggu RW</option>
          <option value="disetujui">Disetujui</option>
          <option value="ditolak">Ditolak</option>
          <option value="draft">Draft</option>
          <option value="perbaikan">Perlu Perbaikan</option>
        </select>
        <select
          className="h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all"
          value={filterPeriode}
          onChange={(e) => setFilterPeriode(e.target.value)}
        >
          <option value="Semua">Semua Periode</option>
          <option value="September 2026">September 2026</option>
          <option value="Agustus 2026">Agustus 2026</option>
          <option value="Juli 2026">Juli 2026</option>
        </select>
        <div className="relative flex-1">
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 material-symbols-outlined text-on-surface-variant text-[20px]">search</span>
          <input
            className="w-full h-11 pl-11 pr-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all"
            placeholder="Cari nama pemohon atau nomor surat..."
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
                <th className="py-3 px-4">No. Surat</th>
                <th className="py-3 px-4">Jenis</th>
                <th className="py-3 px-4">Pemohon</th>
                <th className="py-3 px-4">Keperluan</th>
                <th className="py-3 px-4">Tanggal</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-container-high">
              {filtered.map((row) => (
                <tr key={row.id} className="hover:bg-surface-container-low/50 transition-colors">
                  <td className="py-4 px-4">
                    {row.noSurat ? (
                      <span className="text-xs font-bold text-primary font-mono">{row.noSurat}</span>
                    ) : (
                      <span className="text-xs text-on-surface-variant">—</span>
                    )}
                  </td>
                  <td className="py-4 px-4">
                    <span className="text-sm font-semibold text-on-surface">{row.jenis}</span>
                    {suratPerluRw(row.jenis) && (
                      <span className="block text-[10px] text-on-surface-variant mt-0.5">Butuh persetujuan RW</span>
                    )}
                  </td>
                  <td className="py-4 px-4">
                    <span className="text-sm text-on-surface">{row.pemohon}</span>
                  </td>
                  <td className="py-4 px-4">
                    <span className="text-xs text-on-surface-variant">{row.keperluan}</span>
                    {row.catatan && <span className="block text-[11px] text-on-surface-variant mt-0.5 italic">{row.catatan}</span>}
                    {/* Batch 9 — jumlah lampiran pengajuan warga (buka Preview
                        untuk mengunduhnya; baris demo/offline selalu 0). */}
                    {(row.lampiran?.length ?? 0) > 0 && (
                      <span className="mt-1 inline-flex items-center gap-1 text-[10px] font-bold text-primary">
                        <span className="material-symbols-outlined text-[12px]">attach_file</span>
                        {row.lampiran!.length} lampiran
                      </span>
                    )}
                  </td>
                  <td className="py-4 px-4">
                    <span className="text-xs text-on-surface-variant">{row.tanggal}</span>
                  </td>
                  <td className="py-4 px-4">
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${suratBadge[row.status]}`}>
                      <span className="w-2 h-2 rounded-full bg-current opacity-60" />
                      {row.status}
                    </span>
                    {row.status === "Menunggu RW" && (
                      <span className="block mt-1 text-[10px] text-on-surface-variant">Menunggu persetujuan Portal RW</span>
                    )}
                  </td>
                  <td className="py-4 px-4 text-right">
                    <div className="flex items-center justify-end gap-2 flex-wrap">
                      <button
                        className="h-8 px-3 rounded-lg bg-primary-container/40 text-on-primary-container hover:bg-primary-container text-xs font-semibold inline-flex items-center gap-1 transition-colors"
                        onClick={() => setPreviewSurat(row)}
                      >
                        <span className="material-symbols-outlined text-[14px]">visibility</span>
                        Preview
                      </button>
                      {(row.status === "Draft" || row.status === "Menunggu RT" || row.status === "Perlu Perbaikan") && (
                        <button
                          className="h-8 px-3 rounded-lg bg-secondary-container/60 text-on-secondary-container hover:bg-secondary-container text-xs font-semibold inline-flex items-center gap-1 transition-colors"
                          onClick={() => void terbitkanSurat(row)}
                        >
                          <span className="material-symbols-outlined text-[14px]">how_to_reg</span>
                          Terbitkan
                        </button>
                      )}
                      {row.status !== "Ditolak" && row.status !== "Perlu Perbaikan" && (
                        <button
                          className="h-8 px-3 rounded-lg bg-tertiary-container/40 text-on-tertiary hover:bg-tertiary-container text-xs font-semibold inline-flex items-center gap-1 transition-colors"
                          onClick={() => bukaCatatan(row, "perbaikan")}
                        >
                          <span className="material-symbols-outlined text-[14px]">build</span>
                          Ajukan Perbaikan
                        </button>
                      )}
                      {row.status !== "Ditolak" && (
                        <button
                          className="h-8 px-3 rounded-lg bg-error-container/20 text-on-error-container hover:bg-error-container/40 text-xs font-semibold inline-flex items-center gap-1 transition-colors"
                          onClick={() => bukaCatatan(row, "tolak")}
                        >
                          <span className="material-symbols-outlined text-[14px]">close</span>
                          Tolak
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-4">
                    <EmptyState
                      icon="description"
                      judul="Surat tidak ditemukan"
                      pesan="Ubah filter status atau kata kunci surat."
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="px-6 py-3 border-t border-surface-container-high flex items-center justify-between text-xs text-on-surface-variant">
          <span>Menampilkan {filtered.length} dari {surat.length} surat</span>
          <span className="font-semibold">Halaman 1 dari 1</span>
        </div>
      </div>

      {/* Modal catatan tolak / perbaikan */}
      {aksiCatatan && (
        <div className="fixed inset-0 z-50 bg-on-background/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md mx-4 sm:mx-auto rounded-2xl bg-surface-container-lowest shadow-2xl p-6 flex flex-col gap-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${aksiCatatan.aksi === "tolak" ? "bg-error-container/40 text-on-error-container" : "bg-tertiary-container text-on-tertiary-container"}`}>
                  <span className="material-symbols-outlined text-[22px]">{aksiCatatan.aksi === "tolak" ? "cancel" : "build"}</span>
                </div>
                <div>
                  <h3 className="text-base font-bold text-on-surface">
                    {aksiCatatan.aksi === "tolak" ? "Tolak Surat" : "Minta Perbaikan Surat"}
                  </h3>
                  <p className="text-xs text-on-surface-variant">
                    {aksiCatatan.row.jenis} — {aksiCatatan.row.pemohon}
                  </p>
                </div>
              </div>
              <button className="w-8 h-8 rounded-lg bg-surface-container flex items-center justify-center text-on-surface-variant hover:text-on-surface" onClick={() => setAksiCatatan(null)}>
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold text-on-surface">
                {aksiCatatan.aksi === "tolak"
                  ? "Alasan penolakan (wajib, minimal 3 karakter)"
                  : "Catatan untuk pemohon (opsional)"}
              </label>
              <textarea
                className="w-full px-4 py-3 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all resize-none"
                rows={3}
                placeholder={
                  aksiCatatan.aksi === "tolak"
                    ? "Contoh: Data pendapatan tidak sesuai dengan laporan..."
                    : "Contoh: Lampiran surat domisili belum dilampirkan..."
                }
                value={catatanInput}
                onChange={(e) => setCatatanInput(e.target.value)}
              />
              <span className="text-[11px] text-on-surface-variant">
                {aksiCatatan.aksi === "tolak"
                  ? "Wajib diisi — pesan ini menjadi alasan penolakan pada portal warga."
                  : "Catatan ditampilkan di halaman warga bersama status surat."}
              </span>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2 border-t border-surface-container-high">
              <button
                type="button"
                className="h-11 px-4 rounded-xl text-on-surface-variant text-sm hover:bg-surface-container-high transition-colors"
                onClick={() => setAksiCatatan(null)}
              >
                Batal
              </button>
              <button
                type="button"
                className={`h-11 px-6 rounded-xl text-sm font-bold shadow-md active:scale-[0.98] transition-all flex items-center gap-2 ${aksiCatatan.aksi === "tolak" ? "bg-error text-on-error" : "bg-primary text-on-primary"}`}
                onClick={konfirmasiCatatan}
              >
                <span className="material-symbols-outlined text-[18px]">{aksiCatatan.aksi === "tolak" ? "close" : "build"}</span>
                {aksiCatatan.aksi === "tolak" ? "Konfirmasi Tolak" : "Konfirmasi Perbaikan"}
              </button>
            </div>
          </div>
        </div>
      )}

      {previewSurat && (
        <div className="fixed inset-0 z-50 bg-on-background/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-2xl mx-4 sm:mx-auto rounded-2xl bg-surface-container-lowest shadow-2xl p-6 flex flex-col gap-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between print:hidden">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary-container flex items-center justify-center text-on-primary-container">
                  <span className="material-symbols-outlined text-[22px]">draft</span>
                </div>
                <div>
                  <h3 className="text-base font-bold text-on-surface">Preview Surat Pengantar</h3>
                  <p className="text-xs text-on-surface-variant font-mono">{previewSurat.noSurat || "Belum diterbitkan"}</p>
                </div>
              </div>
              <button
                className="w-8 h-8 rounded-lg bg-surface-container flex items-center justify-center text-on-surface-variant hover:text-on-surface"
                onClick={() => setPreviewSurat(null)}
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            {/* Kop Surat */}
            <div className="rounded-xl border-2 border-on-surface/60 p-5 text-center">
              <div className="flex items-center justify-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-primary flex items-center justify-center shrink-0">
                  <span className="material-symbols-outlined text-on-primary text-[26px]">assured_workload</span>
                </div>
                <div className="text-left">
                  <div className="text-sm font-extrabold tracking-wide text-on-surface">{kopPreview.baris1}</div>
                  <div className="text-xs font-semibold text-on-surface">{kopPreview.baris2}</div>
                  <div className="text-sm font-bold text-on-surface">{kopPreview.baris3}</div>
                </div>
              </div>
              <div className="mt-3 pt-3 border-t-2 border-on-surface">
                <h4 className="text-lg font-extrabold tracking-widest text-on-surface underline">SURAT PENGANTAR</h4>
                <div className="text-xs font-mono text-on-surface-variant mt-1">Nomor: {previewSurat.noSurat || "—"}</div>
              </div>
            </div>

            {/* Isi Surat */}
            <div className="text-sm text-on-surface leading-relaxed space-y-3">
              <p>
                Yang bertanda tangan di bawah ini, Ketua {tenant.rtFull} {tenant.rwFull} Kel. {tenant.kelurahan},
                Kec. {tenant.kecamatan}, {tenant.kota}, dengan ini menerangkan bahwa:
              </p>
              <div className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 px-2">
                <span className="text-on-surface-variant">Nama</span>
                <span className="font-semibold">: {previewSurat.pemohon}</span>
                <span className="text-on-surface-variant">Jenis Surat</span>
                <span className="font-semibold">: {previewSurat.jenis}</span>
                <span className="text-on-surface-variant">Keperluan</span>
                <span className="font-semibold">: {previewSurat.keperluan}</span>
                <span className="text-on-surface-variant">Tanggal</span>
                <span className="font-semibold">: {previewSurat.tanggal}</span>
                <span className="text-on-surface-variant">Status</span>
                <span className="font-semibold">
                  : {previewSurat.status}
                  {previewSurat.status === "Menunggu RW" && " (menunggu persetujuan Portal RW)"}
                </span>
              </div>

              {/* Batch 9 — lampiran pengajuan warga: tautan unduh lewat sesi
                  pengurus (`GET /rt/surat/:id/lampiran/:idx`, RLS scope RT). */}
              {(previewSurat.lampiran?.length ?? 0) > 0 && (
                <div>
                  <div className="text-xs font-bold text-on-surface mb-1.5">Lampiran Pengajuan</div>
                  <ul className="flex flex-col gap-1.5">
                    {previewSurat.lampiran!.map((l) => {
                      const tautan = tautanLampiranSurat(previewSurat.serverId, l.idx, "rt");
                      const isi = (
                        <>
                          <span className="material-symbols-outlined text-[15px] text-primary shrink-0">attach_file</span>
                          <span className="text-xs truncate">{l.nama}</span>
                          <span className="text-[11px] text-on-surface-variant ml-auto shrink-0">{ukuranBerkas(l.ukuran)}</span>
                        </>
                      );
                      return (
                        <li key={`${l.nama}-${l.idx}`}>
                          {tautan ? (
                            <a
                              href={tautan}
                              target="_blank"
                              rel="noreferrer"
                              className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-surface-container-low border border-outline-variant/30 hover:border-primary/50 transition-colors"
                            >
                              {isi}
                            </a>
                          ) : (
                            <div className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-surface-container-low border border-outline-variant/30">
                              {isi}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
              <p>
                Demikian surat pengantar ini dibuat dengan sebenarnya untuk dapat dipergunakan sebagaimana mestinya.
              </p>
            </div>

            {/* Tanda tangan Ketua RT */}
            <div className="flex justify-end print:justify-end">
              <div className="text-center text-sm text-on-surface">
                <div>{tenant.kelurahan}, {previewSurat.tanggal}</div>
                <div className="mt-1">Ketua {tenant.rtFull} {tenant.rwFull}</div>
                {ketuaRT?.ttd ? (
                  <img src={ketuaRT.ttd} alt={`Tanda tangan ${ketuaRT.nama}`} className="mx-auto h-16 my-2 object-contain" />
                ) : (
                  <div className="h-16 flex flex-col items-center justify-center my-2">
                    <span className="text-lg italic text-on-surface-variant">{ketuaRT?.nama ?? "Ketua RT"}</span>
                    <span className="text-[11px] text-on-surface-variant/80">Unggah TTD di Pengaturan</span>
                  </div>
                )}
                <div className="font-bold underline">{ketuaRT?.nama ?? "Ketua RT"}</div>
                <div className="text-xs text-on-surface-variant">{ketuaRT?.jabatan ?? "Ketua RT"}</div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2 border-t border-surface-container-high print:hidden">
              <button
                type="button"
                className="h-11 px-4 rounded-xl text-on-surface-variant text-sm hover:bg-surface-container-high transition-colors"
                onClick={() => setPreviewSurat(null)}
              >
                Tutup
              </button>
              <button
                type="button"
                className="h-11 px-5 rounded-xl bg-secondary-container/60 text-on-secondary-container text-sm font-bold shadow-md hover:bg-secondary-container active:scale-[0.98] transition-all flex items-center gap-2"
                onClick={() => void unduhPdfSurat(previewSurat)}
              >
                <span className="material-symbols-outlined text-[18px]">download</span>
                Unduh PDF Surat
              </button>
              <button
                type="button"
                className="h-11 px-6 rounded-xl bg-primary text-on-primary text-sm font-bold shadow-md hover:bg-primary-container active:scale-[0.98] transition-all flex items-center gap-2"
                onClick={() => window.print()}
              >
                <span className="material-symbols-outlined text-[18px]">print</span>
                Cetak / Simpan PDF
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
