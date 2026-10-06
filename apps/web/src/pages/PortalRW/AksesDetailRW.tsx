import { useState } from "react";
import { tenant } from "../../lib/tenant";
import {
  PermintaanAkses,
  StatusAkses,
  MIN_JUSTIFIKASI,
  lingkupAksesOptions,
  downloadText,
  hariIni,
} from "../../lib/shared";
import { useFlash } from "../../lib/useFlash";

interface AksesDetailRWProps {
  onNavigate?: (page: string) => void;
  akses: PermintaanAkses[];
  onAjukan: (req: {
    rtTujuan: string;
    lingkup: string;
    alasan: string;
    mode: "approval" | "direct";
    justifikasi?: string;
  }) => void;
}

type FilterStatus = "semua" | "Menunggu" | "Disetujui" | "Ditolak" | "Diakses Direct";

const rtOptions = ["RT 01", "RT 02", "RT 03", "RT 04", "RT 05", "RT 06", "RT 07", "RT 08"];

const statusBadge: Record<StatusAkses, string> = {
  Menunggu: "bg-primary-container text-on-primary-container",
  Disetujui: "bg-secondary-container text-on-secondary-container",
  Ditolak: "bg-error-container/40 text-on-error-container",
  "Diakses Direct": "bg-tertiary/20 text-tertiary",
};

function escapeCsv(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function AksesDetailRW({ onNavigate, akses, onAjukan }: AksesDetailRWProps) {
  const [filter, setFilter] = useState<FilterStatus>("semua");
  const { flash, toast } = useFlash();

  // Form "Ajukan Akses"
  const [rtTujuan, setRtTujuan] = useState("RT 01");
  const [lingkup, setLingkup] = useState(lingkupAksesOptions[0]);
  const [alasan, setAlasan] = useState("");
  const [mode, setMode] = useState<"approval" | "direct">("approval");
  const [justifikasi, setJustifikasi] = useState("");


  const total = akses.length;
  const menunggu = akses.filter((a) => a.status === "Menunggu").length;
  const disetujui = akses.filter((a) => a.status === "Disetujui").length;
  const direct = akses.filter((a) => a.mode === "direct" || a.status === "Diakses Direct").length;

  const filtered =
    filter === "semua" ? akses : akses.filter((a) => a.status === filter);

  const justifikasiValid = justifikasi.trim().length >= MIN_JUSTIFIKASI;
  const canSubmit = alasan.trim().length > 0 && (mode === "approval" || justifikasiValid);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!alasan.trim()) {
      flash("Alasan akses wajib diisi.");
      return;
    }
    if (mode === "direct" && !justifikasiValid) {
      flash(`Justifikasi akses direct wajib minimal ${MIN_JUSTIFIKASI} karakter.`);
      return;
    }
    const isDirect = mode === "direct";
    onAjukan({
      rtTujuan,
      lingkup,
      alasan: alasan.trim(),
      mode,
      justifikasi: isDirect ? justifikasi.trim() : undefined,
    });
    // Portal RW belum punya backend (§5.3): pengajuan hanya mengubah state
    // sesi ini — tidak ada permintaan yang benar-benar dikirim ke RT.
    flash(
      isDirect
        ? "Akses direct dicatat di sesi ini (audit log Portal RW belum tersimpan di server)."
        : "Permintaan akses dicatat di sesi ini — Portal RW belum punya backend, TIDAK terkirim ke RT."
    );
    setAlasan("");
    setJustifikasi("");
    setMode("approval");
    setRtTujuan("RT 01");
    setLingkup(lingkupAksesOptions[0]);
  }

  function unduhCsv() {
    const header = "Tanggal,RT Tujuan,Lingkup,Mode,Alasan,Justifikasi,Status,Disetujui Oleh,Masa Berlaku,Catatan";
    const isi = [
      header,
      ...filtered.map((row) =>
        [
          row.tanggal,
          row.rtTujuan,
          row.lingkup,
          row.mode === "direct" ? "Direct" : "Approval",
          row.alasan,
          row.justifikasi ?? "",
          row.status,
          row.disetujuiOleh ?? "",
          row.masaBerlaku ?? "",
          row.catatan ?? "",
        ]
          .map(escapeCsv)
          .join(",")
      ),
    ].join("\n");
    downloadText("riwayat-akses-detail-warga.csv", isi);
    flash(`${filtered.length} baris riwayat akses berhasil diunduh (CSV).`);
  }

  const chips: { key: FilterStatus; label: string }[] = [
    { key: "semua", label: "Semua" },
    { key: "Menunggu", label: "Menunggu" },
    { key: "Disetujui", label: "Disetujui" },
    { key: "Ditolak", label: "Ditolak" },
    { key: "Diakses Direct", label: "Direct" },
  ];

  return (
    <div className="max-w-7xl mx-auto w-full space-y-6">
      {toast}

      <div className="flex items-center gap-1.5 text-sm text-on-surface-variant">
        <button type="button" className="hover:text-primary transition-colors flex items-center gap-1" onClick={() => onNavigate?.("dashboard-rw")}><span className="material-symbols-outlined text-[16px]">home</span>
          Portal RW
        </button>
        <span className="material-symbols-outlined text-[14px]">chevron_right</span>
        <span className="font-bold text-on-surface">Akses Detail Warga</span>
      </div>

      <div className="max-w-3xl space-y-1.5">
        <div className="inline-flex items-center gap-1.5 text-primary text-sm font-bold uppercase tracking-wider">
          <span className="material-symbols-outlined text-[16px]">admin_panel_settings</span>
          Approval Workflow RW → RT_ADMIN
        </div>
        <h1 className="text-2xl lg:text-[32px] text-on-surface tracking-tight font-extrabold">
          Akses Detail Warga
        </h1>
        <p className="text-sm text-on-surface-variant leading-relaxed">
          Ajukan akses data detail warga lintas-RT di {tenant.rwFull} — melalui persetujuan RT atau mode direct dengan justifikasi.
        </p>
      </div>

      {/* Banner privasi */}
      <div className="p-4 rounded-xl bg-error-container/20 border border-error-container/40 flex items-start gap-3">
        <span className="material-symbols-outlined text-error text-[20px] shrink-0 mt-0.5">lock</span>
        <div className="text-sm text-on-surface leading-relaxed space-y-1.5">
          <p>
            Akses ini hanya berlaku untuk data <span className="font-semibold">kependudukan, domisili, dan kontak</span>.
            <span className="font-bold text-error"> Data iuran individu tertutup permanen bagi RW</span> meskipun Anda memiliki akses detail (§7.2).
          </p>
          <p>
            Seluruh akses — <span className="font-semibold">approval maupun direct</span> — tercatat di audit log (§7.5).
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-surface-container-lowest rounded-xl p-5 shadow-sm flex flex-col justify-between">
          <div className="flex items-start justify-between">
            <span className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">Total Permintaan</span>
            <div className="w-10 h-10 rounded-full bg-primary-container flex items-center justify-center text-on-primary-container">
              <span className="material-symbols-outlined text-[22px]">manage_search</span>
            </div>
          </div>
          <div className="mt-4">
            <div className="text-2xl font-extrabold text-on-surface font-mono">{total}</div>
            <div className="text-[11px] text-on-surface-variant mt-1">Semua Waktu</div>
          </div>
        </div>
        <div className="bg-surface-container-lowest rounded-xl p-5 shadow-sm flex flex-col justify-between">
          <div className="flex items-start justify-between">
            <span className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">Menunggu</span>
            <div className="w-10 h-10 rounded-full bg-tertiary-container flex items-center justify-center text-on-tertiary-container">
              <span className="material-symbols-outlined text-[22px]">pending</span>
            </div>
          </div>
          <div className="mt-4">
            <div className="text-2xl font-extrabold text-tertiary font-mono">{menunggu}</div>
            <div className="text-[11px] text-tertiary font-semibold mt-1">Keputusan RT_ADMIN</div>
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
            <div className="text-2xl font-extrabold text-secondary font-mono">{disetujui}</div>
            <div className="text-[11px] text-secondary font-semibold mt-1">Akses Aktif</div>
          </div>
        </div>
        <div className="bg-surface-container-lowest rounded-xl p-5 shadow-sm flex flex-col justify-between">
          <div className="flex items-start justify-between">
            <span className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">Akses Direct</span>
            <div className="w-10 h-10 rounded-full bg-tertiary/20 flex items-center justify-center text-tertiary">
              <span className="material-symbols-outlined text-[22px]">bolt</span>
            </div>
          </div>
          <div className="mt-4">
            <div className="text-2xl font-extrabold text-tertiary font-mono">{direct}</div>
            <div className="text-[11px] text-on-surface-variant mt-1">Bypass + Tercatat</div>
          </div>
        </div>
      </div>

      {/* Form Ajukan Akses */}
      <section className="bg-surface-container-lowest rounded-xl p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 mb-4 border-b border-surface-container-high">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary-container flex items-center justify-center text-on-primary-container">
              <span className="material-symbols-outlined text-[22px]">add_task</span>
            </div>
            <div>
              <h2 className="text-lg font-bold text-on-surface">Ajukan Akses</h2>
              <p className="text-xs text-on-surface-variant mt-0.5">Pilih RT tujuan, lingkup data, dan mode akses</p>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold text-on-surface flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[16px] text-on-surface-variant">home</span>
                RT Tujuan
              </label>
              <select
                className="w-full h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all"
                value={rtTujuan}
                onChange={(e) => setRtTujuan(e.target.value)}
              >
                {rtOptions.map((rt) => (
                  <option key={rt} value={rt}>{rt}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold text-on-surface flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[16px] text-on-surface-variant">category</span>
                Lingkup Data
              </label>
              <select
                className="w-full h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all"
                value={lingkup}
                onChange={(e) => setLingkup(e.target.value)}
              >
                {lingkupAksesOptions.map((l) => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-on-surface flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px] text-on-surface-variant">note</span>
              Alasan <span className="text-error">*</span>
            </label>
            <textarea
              className="w-full px-4 py-3 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all resize-none"
              rows={3}
              placeholder="Jelaskan alasan kebutuhan akses data detail warga..."
              value={alasan}
              onChange={(e) => setAlasan(e.target.value)}
            />
          </div>

          {/* Pemilihan mode */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-on-surface flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px] text-on-surface-variant">toggle_on</span>
              Mode Akses <span className="text-error">*</span>
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setMode("approval")}
                className={`p-4 rounded-xl border-2 text-left transition-all ${
                  mode === "approval"
                    ? "border-primary bg-primary-container/30 shadow-sm"
                    : "border-surface-container-high bg-surface-container-low hover:border-outline-variant"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center ${
                      mode === "approval" ? "border-primary" : "border-outline-variant"
                    }`}
                  >
                    {mode === "approval" && <span className="w-2 h-2 rounded-full bg-primary" />}
                  </span>
                  <span className="material-symbols-outlined text-[18px] text-primary">how_to_reg</span>
                  <span className="text-sm font-bold text-on-surface">Approval</span>
                </div>
                <p className="text-xs text-on-surface-variant mt-1.5 pl-6">
                  Ikuti persetujuan RT_ADMIN. Keputusan diambil di sisi Portal RT.
                </p>
              </button>

              <button
                type="button"
                onClick={() => setMode("direct")}
                className={`p-4 rounded-xl border-2 text-left transition-all ${
                  mode === "direct"
                    ? "border-tertiary bg-tertiary/10 shadow-sm"
                    : "border-surface-container-high bg-surface-container-low hover:border-outline-variant"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center ${
                      mode === "direct" ? "border-tertiary" : "border-outline-variant"
                    }`}
                  >
                    {mode === "direct" && <span className="w-2 h-2 rounded-full bg-tertiary" />}
                  </span>
                  <span className="material-symbols-outlined text-[18px] text-tertiary">bolt</span>
                  <span className="text-sm font-bold text-on-surface">Direct</span>
                </div>
                <p className="text-xs text-on-surface-variant mt-1.5 pl-6">
                  Bypass approval, akses langsung aktif — tetap tercatat di audit log.
                </p>
              </button>
            </div>
          </div>

          {/* Justifikasi khusus mode direct */}
          {mode === "direct" && (
            <div className="flex flex-col gap-1.5 p-4 rounded-xl bg-tertiary/5 border border-tertiary/30">
              <label className="text-xs font-bold text-on-surface flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[16px] text-tertiary">gpp_maybe</span>
                Justifikasi Akses Direct <span className="text-error">*</span>
              </label>
              <textarea
                className="w-full px-4 py-3 rounded-xl bg-surface-container-lowest text-sm text-on-surface focus:ring-2 focus:ring-tertiary focus:outline-none transition-all resize-none"
                rows={3}
                placeholder="Jelaskan urgensi yang mengharuskan akses langsung tanpa persetujuan RT..."
                value={justifikasi}
                onChange={(e) => setJustifikasi(e.target.value)}
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] text-on-surface-variant">
                  Wajib minimal {MIN_JUSTIFIKASI} karakter sesuai syarat audit §7.5.
                </p>
                <span
                  className={`text-xs font-bold font-mono ${
                    justifikasiValid ? "text-secondary" : "text-error"
                  }`}
                >
                  {justifikasi.trim().length}/{MIN_JUSTIFIKASI} karakter
                </span>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-end gap-3 pt-2 border-t border-surface-container-high">
            <span className="mr-auto text-[11px] text-on-surface-variant">
              Tanggal pengajuan: <span className="font-mono font-semibold">{hariIni()}</span>
            </span>
            <button
              type="submit"
              disabled={!canSubmit}
              className="h-11 px-6 rounded-xl bg-primary text-on-primary text-sm font-bold shadow-md hover:bg-primary-container active:scale-[0.98] transition-all flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-primary"
            >
              <span className="material-symbols-outlined text-[18px]">send</span>
              Ajukan Akses
            </button>
          </div>
        </form>
      </section>

      {/* Catatan alur */}
      <div className="p-4 rounded-xl bg-primary-container/20 border border-primary-container/40 flex items-start gap-3">
        <span className="material-symbols-outlined text-primary text-[20px] shrink-0 mt-0.5">info</span>
        <p className="text-sm text-on-surface leading-relaxed">
          Mode <span className="font-semibold">Approval</span> diputuskan oleh RT_ADMIN di sisi Portal RT. Mode <span className="font-semibold">Direct</span> langsung aktif tetapi tetap tercatat di audit log — kepatuhan UU PDP.
        </p>
      </div>

      {/* Filter + Unduh */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-4 rounded-xl bg-surface-container-lowest shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          {chips.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => setFilter(c.key)}
              className={`h-9 px-4 rounded-full text-xs font-bold transition-colors ${
                filter === c.key
                  ? "bg-primary text-on-primary shadow-sm"
                  : "bg-surface-container-low text-on-surface-variant hover:bg-surface-container-high"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
        <button
          className="h-10 px-4 rounded-xl bg-surface-container-lowest text-on-surface text-xs shadow-sm border border-surface-container-high hover:shadow-md hover:bg-surface-container-low transition-all flex items-center justify-center gap-2"
          onClick={unduhCsv}
        >
          <span className="material-symbols-outlined text-primary text-[18px]">download</span>
          Unduh CSV
        </button>
      </div>

      {/* Tabel riwayat */}
      <section className="bg-surface-container-lowest rounded-xl shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-container-high">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-tertiary-container flex items-center justify-center text-on-tertiary-container">
              <span className="material-symbols-outlined text-[22px]">history</span>
            </div>
            <div>
              <h2 className="text-lg font-bold text-on-surface">Riwayat Permintaan</h2>
              <p className="text-xs text-on-surface-variant mt-0.5">Menampilkan {filtered.length} dari {total} permintaan</p>
            </div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-on-surface">
            <thead className="bg-surface-container-low text-xs text-on-surface-variant uppercase tracking-wider">
              <tr>
                <th className="py-3 px-4">Tanggal</th>
                <th className="py-3 px-4">RT Tujuan</th>
                <th className="py-3 px-4">Lingkup</th>
                <th className="py-3 px-4">Mode</th>
                <th className="py-3 px-4">Alasan / Justifikasi</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Disetujui Oleh / Masa Berlaku</th>
                <th className="py-3 px-4">Catatan</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-container-high">
              {filtered.map((row) => (
                <tr key={row.id} className="hover:bg-surface-container-low/50 transition-colors align-top">
                  <td className="py-4 px-4">
                    <span className="text-xs text-on-surface-variant whitespace-nowrap font-mono">{row.tanggal}</span>
                  </td>
                  <td className="py-4 px-4">
                    <span className="text-sm font-semibold text-on-surface">{row.rtTujuan}</span>
                  </td>
                  <td className="py-4 px-4">
                    <span className="text-xs text-on-surface-variant">{row.lingkup}</span>
                  </td>
                  <td className="py-4 px-4">
                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${
                        row.mode === "direct"
                          ? "bg-tertiary/20 text-tertiary"
                          : "bg-primary-container text-on-primary-container"
                      }`}
                    >
                      <span className="material-symbols-outlined text-[13px]">
                        {row.mode === "direct" ? "bolt" : "how_to_reg"}
                      </span>
                      {row.mode === "direct" ? "Direct" : "Approval"}
                    </span>
                  </td>
                  <td className="py-4 px-4 max-w-[260px]">
                    <span className="block text-xs text-on-surface-variant line-clamp-2" title={row.alasan}>
                      {row.alasan}
                    </span>
                    {row.mode === "direct" && row.justifikasi && (
                      <span className="block mt-1 text-[11px] text-tertiary font-semibold line-clamp-2" title={row.justifikasi}>
                        Justifikasi: {row.justifikasi}
                      </span>
                    )}
                  </td>
                  <td className="py-4 px-4">
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold whitespace-nowrap ${statusBadge[row.status]}`}>
                      <span className="w-2 h-2 rounded-full bg-current opacity-60" />
                      {row.status}
                    </span>
                  </td>
                  <td className="py-4 px-4">
                    {row.disetujuiOleh || row.masaBerlaku ? (
                      <>
                        <span className="block text-xs text-on-surface">{row.disetujuiOleh ?? "—"}</span>
                        {row.masaBerlaku && (
                          <span className="block text-[11px] text-on-surface-variant font-mono">s/d {row.masaBerlaku}</span>
                        )}
                      </>
                    ) : (
                      <span className="text-xs text-on-surface-variant">—</span>
                    )}
                  </td>
                  <td className="py-4 px-4">
                    <span className="text-xs text-on-surface-variant">{row.catatan ?? "—"}</span>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-on-surface-variant text-sm">
                    Tidak ada permintaan akses yang cocok dengan filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="px-6 py-3 border-t border-surface-container-high flex items-center justify-between text-xs text-on-surface-variant">
          <span>Menampilkan {filtered.length} dari {total} permintaan</span>
          <span className="font-semibold">Halaman 1 dari 1</span>
        </div>
      </section>
    </div>
  );
}
