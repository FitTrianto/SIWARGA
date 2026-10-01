import { useState } from "react";
import { tenant } from "../../lib/tenant";
import { Surat, suratBadge } from "../../lib/shared";
import { EmptyState } from "../../components/EmptyState";
import { useFlash } from "../../lib/useFlash";

interface VerifikasiSuratRWProps {
  onNavigate?: (page: string) => void;
  surat: Surat[];
  onVerifikasi: (id: string, status: "Disetujui" | "Ditolak", catatanRw?: string) => void;
}

interface ModalVerifikasi {
  id: string;
  noSurat: string;
  jenis: string;
  pemohon: string;
  keputusan: "Disetujui" | "Ditolak";
}

export function VerifikasiSuratRW({ onNavigate, surat, onVerifikasi }: VerifikasiSuratRWProps) {
  const [modal, setModal] = useState<ModalVerifikasi | null>(null);
  const [catatan, setCatatan] = useState("");
  const { flash, toast } = useFlash();


  const antrian = surat.filter((s) => s.status === "Menunggu RW");
  const riwayat = surat.filter(
    (s) =>
      s.perluRw &&
      s.status !== "Menunggu RW" &&
      (s.status === "Disetujui" || s.status === "Ditolak")
  );

  const menungguRw = surat.filter((s) => s.perluRw && s.status === "Menunggu RW").length;
  const disetujui = surat.filter((s) => s.perluRw && s.status === "Disetujui").length;
  const ditolak = surat.filter((s) => s.perluRw && s.status === "Ditolak").length;
  const totalDiproses = menungguRw + disetujui + ditolak;

  function bukaModal(row: Surat, keputusan: "Disetujui" | "Ditolak") {
    setCatatan("");
    setModal({ id: row.id, noSurat: row.noSurat, jenis: row.jenis, pemohon: row.pemohon, keputusan });
  }

  function handleKonfirmasi(e: React.FormEvent) {
    e.preventDefault();
    if (!modal) return;
    const isSetujui = modal.keputusan === "Disetujui";
    onVerifikasi(modal.id, modal.keputusan, catatan.trim() || undefined);
    flash(
      isSetujui
        ? `Surat ${modal.noSurat || modal.jenis} disetujui. Status tersinkron ke Portal RT & Warga.`
        : `Surat ${modal.noSurat || modal.jenis} ditolak. Status tersinkron ke Portal RT & Warga.`
    );
    setModal(null);
    setCatatan("");
  }

  return (
    <div className="max-w-7xl mx-auto w-full space-y-6">
      {toast}

      <div className="flex items-center gap-1.5 text-sm text-on-surface-variant">
        <button type="button" className="hover:text-primary transition-colors flex items-center gap-1" onClick={() => onNavigate?.("dashboard-rw")}><span className="material-symbols-outlined text-[16px]">home</span>
          Portal RW
        </button>
        <span className="material-symbols-outlined text-[14px]">chevron_right</span>
        <span className="font-bold text-on-surface">Verifikasi Surat RW</span>
      </div>

      <div className="max-w-3xl space-y-1.5">
        <div className="inline-flex items-center gap-1.5 text-primary text-sm font-bold uppercase tracking-wider">
          <span className="material-symbols-outlined text-[16px]">how_to_reg</span>
          Persetujuan Tingkat RW
        </div>
        <h1 className="text-2xl lg:text-[32px] text-on-surface tracking-tight font-extrabold">
          Verifikasi Surat Tingkat RW
        </h1>
        <p className="text-sm text-on-surface-variant leading-relaxed">
          Antrian persetujuan surat yang membutuhkan verifikasi tingkat {tenant.rwFull} sebelum terbit final.
        </p>
      </div>

      <div className="p-4 rounded-xl bg-secondary-container/20 border border-secondary-container/40 flex items-start gap-3">
        <span className="material-symbols-outlined text-secondary text-[20px] shrink-0 mt-0.5">sync</span>
        <p className="text-sm text-on-surface leading-relaxed">
          Status surat <span className="font-bold">tersinkron otomatis</span> ke <span className="font-semibold">Portal RT</span> dan <span className="font-semibold">Portal Warga</span> setiap kali verifikasi dilakukan — tanpa perlu input ulang di sisi lain.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-surface-container-lowest rounded-xl p-5 shadow-sm flex flex-col justify-between">
          <div className="flex items-start justify-between">
            <span className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">Menunggu RW</span>
            <div className="w-10 h-10 rounded-full bg-secondary-fixed flex items-center justify-center text-on-secondary-fixed">
              <span className="material-symbols-outlined text-[22px]">pending</span>
            </div>
          </div>
          <div className="mt-4">
            <div className="text-2xl font-extrabold text-on-surface font-mono">{menungguRw}</div>
            <div className="text-[11px] text-tertiary font-semibold mt-1">Perlu Ditinjau</div>
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
            <div className="text-[11px] text-secondary font-semibold mt-1">Selesai Verifikasi</div>
          </div>
        </div>
        <div className="bg-surface-container-lowest rounded-xl p-5 shadow-sm flex flex-col justify-between">
          <div className="flex items-start justify-between">
            <span className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">Ditolak</span>
            <div className="w-10 h-10 rounded-full bg-error-container/40 flex items-center justify-center text-on-error-container">
              <span className="material-symbols-outlined text-[22px]">cancel</span>
            </div>
          </div>
          <div className="mt-4">
            <div className="text-2xl font-extrabold text-error font-mono">{ditolak}</div>
            <div className="text-[11px] text-on-surface-variant mt-1">Perlu Ditindaklanjuti</div>
          </div>
        </div>
        <div className="bg-surface-container-lowest rounded-xl p-5 shadow-sm flex flex-col justify-between">
          <div className="flex items-start justify-between">
            <span className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">Total Diproses</span>
            <div className="w-10 h-10 rounded-full bg-primary-container flex items-center justify-center text-on-primary-container">
              <span className="material-symbols-outlined text-[22px]">fact_check</span>
            </div>
          </div>
          <div className="mt-4">
            <div className="text-2xl font-extrabold text-primary font-mono">{totalDiproses}</div>
            <div className="text-[11px] text-on-surface-variant mt-1">Surat Perlu RW</div>
          </div>
        </div>
      </div>

      {/* Antrian persetujuan */}
      <section className="bg-surface-container-lowest rounded-xl shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-container-high">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-secondary-fixed flex items-center justify-center text-on-secondary-fixed">
              <span className="material-symbols-outlined text-[22px]">inbox</span>
            </div>
            <div>
              <h2 className="text-lg font-bold text-on-surface">Antrian Persetujuan</h2>
              <p className="text-xs text-on-surface-variant mt-0.5">Surat berstatus "Menunggu RW" — {antrian.length} surat</p>
            </div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-on-surface">
            <thead className="bg-surface-container-low text-xs text-on-surface-variant uppercase tracking-wider">
              <tr>
                <th className="py-3 px-4">No. Surat</th>
                <th className="py-3 px-4">Jenis</th>
                <th className="py-3 px-4">Pemohon</th>
                <th className="py-3 px-4">Keperluan</th>
                <th className="py-3 px-4">Tanggal</th>
                <th className="py-3 px-4 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-container-high">
              {antrian.map((row) => (
                <tr key={row.id} className="hover:bg-surface-container-low/50 transition-colors">
                  <td className="py-4 px-4">
                    <span className="text-xs font-bold text-primary font-mono">{row.noSurat || "—"}</span>
                  </td>
                  <td className="py-4 px-4">
                    <span className="text-sm font-semibold text-on-surface">{row.jenis}</span>
                  </td>
                  <td className="py-4 px-4">
                    <span className="text-sm text-on-surface">{row.pemohon}</span>
                  </td>
                  <td className="py-4 px-4">
                    <span className="text-xs text-on-surface-variant">{row.keperluan}</span>
                  </td>
                  <td className="py-4 px-4">
                    <span className="text-xs text-on-surface-variant whitespace-nowrap">{row.tanggal}</span>
                  </td>
                  <td className="py-4 px-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        className="h-8 px-3 rounded-lg bg-secondary-container text-on-secondary-container hover:opacity-80 text-xs font-semibold inline-flex items-center gap-1 transition-colors"
                        onClick={() => bukaModal(row, "Disetujui")}
                      >
                        <span className="material-symbols-outlined text-[14px]">check</span>
                        Setujui
                      </button>
                      <button
                        className="h-8 px-3 rounded-lg bg-error-container/20 text-on-error-container hover:bg-error-container/40 text-xs font-semibold inline-flex items-center gap-1 transition-colors"
                        onClick={() => bukaModal(row, "Ditolak")}
                      >
                        <span className="material-symbols-outlined text-[14px]">close</span>
                        Tolak
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {antrian.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-on-surface-variant text-sm">
                    <span className="material-symbols-outlined text-secondary text-[40px] block mb-2">check_circle</span>
                    Tidak ada surat menunggu verifikasi RW. Semua antrian sudah diproses.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Riwayat verifikasi */}
      <section className="bg-surface-container-lowest rounded-xl shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-container-high">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary-container flex items-center justify-center text-on-primary-container">
              <span className="material-symbols-outlined text-[22px]">history</span>
            </div>
            <div>
              <h2 className="text-lg font-bold text-on-surface">Riwayat Verifikasi</h2>
              <p className="text-xs text-on-surface-variant mt-0.5">Surat perlu RW yang telah diputuskan — {riwayat.length} surat</p>
            </div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-on-surface">
            <thead className="bg-surface-container-low text-xs text-on-surface-variant uppercase tracking-wider">
              <tr>
                <th className="py-3 px-4">No. Surat</th>
                <th className="py-3 px-4">Jenis</th>
                <th className="py-3 px-4">Pemohon</th>
                <th className="py-3 px-4">Tanggal</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Catatan RW</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-container-high">
              {riwayat.map((row) => (
                <tr key={row.id} className="hover:bg-surface-container-low/50 transition-colors">
                  <td className="py-4 px-4">
                    <span className="text-xs font-bold text-primary font-mono">{row.noSurat || "—"}</span>
                  </td>
                  <td className="py-4 px-4">
                    <span className="text-sm font-semibold text-on-surface">{row.jenis}</span>
                  </td>
                  <td className="py-4 px-4">
                    <span className="text-sm text-on-surface">{row.pemohon}</span>
                  </td>
                  <td className="py-4 px-4">
                    <span className="text-xs text-on-surface-variant whitespace-nowrap">{row.tanggal}</span>
                  </td>
                  <td className="py-4 px-4">
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${suratBadge[row.status]}`}>
                      <span className="w-2 h-2 rounded-full bg-current opacity-60" />
                      {row.status}
                    </span>
                  </td>
                  <td className="py-4 px-4">
                    <span className="text-xs text-on-surface-variant">{row.catatanRw ?? "—"}</span>
                  </td>
                </tr>
              ))}
              {riwayat.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-4">
                    <EmptyState
                      icon="how_to_reg"
                      judul="Belum ada riwayat verifikasi"
                      pesan="Surat yang diverifikasi pada tingkat RW akan tercatat di sini."
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="px-6 py-3 border-t border-surface-container-high flex items-center justify-between text-xs text-on-surface-variant">
          <span>Menampilkan {riwayat.length} surat terverifikasi</span>
          <span className="font-semibold">Halaman 1 dari 1</span>
        </div>
      </section>

      {/* Modal konfirmasi verifikasi */}
      {modal && (
        <div className="fixed inset-0 z-50 bg-on-background/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg mx-4 sm:mx-auto rounded-2xl bg-surface-container-lowest shadow-2xl p-6 flex flex-col gap-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div
                  className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                    modal.keputusan === "Disetujui"
                      ? "bg-secondary-container text-on-secondary-container"
                      : "bg-error-container/40 text-on-error-container"
                  }`}
                >
                  <span className="material-symbols-outlined text-[22px]">
                    {modal.keputusan === "Disetujui" ? "check_circle" : "cancel"}
                  </span>
                </div>
                <div>
                  <h3 className="text-base font-bold text-on-surface">
                    {modal.keputusan === "Disetujui" ? "Setujui Surat?" : "Tolak Surat?"}
                  </h3>
                  <p className="text-xs text-on-surface-variant font-mono">{modal.noSurat || "Belum bernomor"}</p>
                </div>
              </div>
              <button
                className="w-8 h-8 rounded-lg bg-surface-container flex items-center justify-center text-on-surface-variant hover:text-on-surface"
                onClick={() => setModal(null)}
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <div className="p-3 rounded-xl bg-surface-container-low grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 text-sm">
              <span className="text-on-surface-variant text-xs">Jenis</span>
              <span className="font-semibold text-xs">{modal.jenis}</span>
              <span className="text-on-surface-variant text-xs">Pemohon</span>
              <span className="font-semibold text-xs">{modal.pemohon}</span>
            </div>

            <form onSubmit={handleKonfirmasi} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[16px] text-on-surface-variant">note</span>
                  Catatan RW (opsional)
                </label>
                <textarea
                  className="w-full px-4 py-3 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all resize-none"
                  rows={3}
                  placeholder={
                    modal.keputusan === "Disetujui"
                      ? "Catatan persetujuan (opsional)..."
                      : "Alasan penolakan (opsional)..."
                  }
                  value={catatan}
                  onChange={(e) => setCatatan(e.target.value)}
                />
              </div>

              <div className="p-3 rounded-xl bg-secondary-container/20 border border-secondary-container/40 flex items-start gap-2">
                <span className="material-symbols-outlined text-secondary text-[16px] shrink-0 mt-0.5">sync</span>
                <p className="text-xs text-on-surface leading-relaxed">
                  Keputusan akan langsung tersinkron ke Portal RT dan Portal Warga.
                </p>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2 border-t border-surface-container-high">
                <button
                  type="button"
                  className="h-11 px-4 rounded-xl text-on-surface-variant text-sm hover:bg-surface-container-high transition-colors"
                  onClick={() => setModal(null)}
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className={`h-11 px-6 rounded-xl text-sm font-bold shadow-md active:scale-[0.98] transition-all flex items-center gap-2 ${
                    modal.keputusan === "Disetujui"
                      ? "bg-secondary text-on-secondary hover:opacity-90"
                      : "bg-error text-on-error hover:opacity-90"
                  }`}
                >
                  <span className="material-symbols-outlined text-[18px]">
                    {modal.keputusan === "Disetujui" ? "check" : "close"}
                  </span>
                  {modal.keputusan === "Disetujui" ? "Setujui Surat" : "Tolak Surat"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
