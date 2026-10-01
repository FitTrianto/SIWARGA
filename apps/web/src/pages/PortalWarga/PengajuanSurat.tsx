import { useState } from "react";
import { tenant } from "../../lib/tenant";
import {
  Surat,
  StatusSurat,
  suratPerluRw,
  downloadText,
  jenisSuratOptions,
  noSuratOtomatis,
  Pengurus,
  KopSurat,
} from "../../lib/shared";
import { GalatApi } from "../../lib/api";
import { EmptyState } from "../../components/EmptyState";
import { useFlash } from "../../lib/useFlash";

interface PengajuanSuratProps {
  onNavigate?: (page: string) => void;
  surat: Surat[];
  /** No. KK & nama pemilik akun warga yang login (dari App). */
  noKk: string;
  pemohon: string;
  /**
   * B12 — `POST /warga/surat` (tanpa CSRF §5.6); nomor surat dihasilkan server.
   * OFFLINE → baris lokal (mode demo); galat lain MELEMPAR (sesi habis ditangani
   * App) — dialog ajukan tetap terbuka agar pesan server terlihat.
   */
  onAjukan: (s: Omit<Surat, "id">) => Promise<void>;
  /** Perbaiki pengajuan milik warga (sebelum diverifikasi Pengurus RT). */
  onEdit: (id: string, patch: Partial<Surat>) => void;
  /** Hapus pengajuan milik warga (sebelum diverifikasi Pengurus RT). */
  onHapus: (id: string) => void;
  /**
   * B12 — `GET /warga/surat` → kop surat RT untuk PDF; `null` = OFFLINE
   * (PDF memakai kop bawaan). MELEMPAR galat non-OFFLINE.
   */
  onMuatKopSurat: () => Promise<KopSurat | null>;
  /** B12 — penandatangan blok TTD pada PDF surat terbit. */
  ketuaRt?: Pengurus;
}

/** Badge ramah warga berbasis StatusSurat (label lebih sopan dari bahasa internal). */
const badgeWarga: Record<StatusSurat, { label: string; cls: string; icon: string }> = {
  Draft: { label: "Draft", cls: "bg-surface-container-high text-on-surface-variant", icon: "edit_note" },
  "Menunggu RT": { label: "Menunggu Verifikasi RT", cls: "bg-primary-container text-on-primary-container", icon: "pending" },
  "Menunggu RW": { label: "Menunggu Persetujuan RW", cls: "bg-secondary-fixed text-on-secondary-fixed", icon: "forward_to_inbox" },
  Disetujui: { label: "Disetujui & Terbit", cls: "bg-secondary-container/40 text-secondary", icon: "check_circle" },
  Ditolak: { label: "Ditolak", cls: "bg-error-container/40 text-error", icon: "cancel" },
  "Perlu Perbaikan": { label: "Perlu Perbaikan", cls: "bg-tertiary-container text-on-tertiary-container", icon: "build" },
};

function StatusBadge({ status }: { status: StatusSurat }) {
  const s = badgeWarga[status];
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold ${s.cls}`}>
      <span className="material-symbols-outlined text-[14px]">{s.icon}</span>
      {s.label}
    </span>
  );
}

type Langkah = { label: string; state: "done" | "active" | "pending" };

/** Alur progres surat: Diajukan → Verifikasi RT → (bila perluRw) Persetujuan RW → Terbit. */
function langkahSurat(s: Surat): Langkah[] {
  const labels = ["Diajukan", "Verifikasi RT", ...(s.perluRw ? ["Persetujuan RW"] : []), "Terbit"];
  const last = labels.length - 1;
  let current: number;
  switch (s.status) {
    case "Draft":
      current = 0;
      break;
    case "Menunggu RT":
      current = 1;
      break;
    case "Menunggu RW":
      current = s.perluRw ? 2 : last;
      break;
    case "Disetujui":
      current = last;
      break;
    default:
      // Ditolak & Perlu Perbaikan berhenti di tahap verifikasi RT.
      current = 1;
  }
  const semuaSelesai = s.status === "Disetujui";
  return labels.map((label, i) => ({
    label,
    state: semuaSelesai || i < current ? "done" : i === current ? "active" : "pending",
  }));
}

function langkahActiveCls(status: StatusSurat): string {
  if (status === "Ditolak") return "bg-error-container text-on-error-container";
  if (status === "Perlu Perbaikan") return "bg-tertiary-container text-on-tertiary-container";
  return "bg-primary text-on-primary";
}

export function PengajuanSurat({
  onNavigate,
  surat,
  noKk,
  pemohon,
  onAjukan,
  onEdit,
  onHapus,
  onMuatKopSurat,
  ketuaRt,
}: PengajuanSuratProps) {
  const daftar = noKk ? surat.filter((s) => s.noKk === noKk) : [];

  const [showForm, setShowForm] = useState(false);
  const [formJenis, setFormJenis] = useState(jenisSuratOptions[0]);
  const [formKeperluan, setFormKeperluan] = useState("");
  const [detailSurat, setDetailSurat] = useState<Surat | null>(null);
  // Edit & Hapus hanya untuk pengajuan yang belum diverifikasi Pengurus RT.
  const [editingSurat, setEditingSurat] = useState<Surat | null>(null);
  const [hapusSurat, setHapusSurat] = useState<Surat | null>(null);
  const { flash, toast } = useFlash();

  /** Pengajuan boleh diperbaiki/dihapus warga selama statusnya Draft/Menunggu RT. */
  function bisaDiperbaiki(s: Surat): boolean {
    return s.status === "Draft" || s.status === "Menunggu RT";
  }


  // KPI dihitung dari daftar tersaring (milik warga yang login).
  const totalPengajuan = daftar.length;
  const dalamProses = daftar.filter((s) => s.status === "Menunggu RT" || s.status === "Menunggu RW").length;
  const jumlahDisetujui = daftar.filter((s) => s.status === "Disetujui").length;
  const jumlahDitolak = daftar.filter((s) => s.status === "Ditolak").length;

  const kpiList = [
    { label: "Total Pengajuan", value: totalPengajuan, icon: "description", color: "text-primary" },
    { label: "Dalam Proses", value: dalamProses, icon: "pending", color: "text-primary" },
    { label: "Disetujui", value: jumlahDisetujui, icon: "check_circle", color: "text-secondary" },
    { label: "Ditolak", value: jumlahDitolak, icon: "cancel", color: "text-error" },
  ];

  function bukaForm() {
    setFormJenis(jenisSuratOptions[0]);
    setFormKeperluan("");
    setEditingSurat(null);
    setShowForm(true);
  }

  function ajukanUlang(s: Surat) {
    flash(`Perbaiki data, lalu ajukan ulang surat ${s.jenis}.`);
    bukaForm();
  }

  /** Buka form Edit untuk pengajuan yang belum diverifikasi Pengurus RT. */
  function ubahPengajuan(s: Surat) {
    // B12 — baris yang sudah tercatat di server tidak punya endpoint edit milik
    // warga (kontrak §5.3); menampilkan form yang hasilnya tidak pernah tersimpan
    // = menipu, jadi dijelaskan apa adanya.
    if (s.serverId) {
      flash("Pengajuan sudah tercatat di server — hubungi Pengurus RT bila datanya perlu diperbaiki.");
      return;
    }
    setFormJenis(s.jenis);
    setFormKeperluan(s.keperluan);
    setEditingSurat(s);
    setShowForm(true);
  }

  function unduhKuitansi(s: Surat) {
    const isi = [
      "KUITANSI PENYERAHAN SURAT PENGANTAR",
      "====================================",
      `No. Surat  : ${s.noSurat || "-"}`,
      `Jenis Surat: ${s.jenis}`,
      `Pemohon    : ${s.pemohon}`,
      `Keperluan  : ${s.keperluan}`,
      `Tanggal    : ${s.tanggal}`,
      `Status     : ${s.status}`,
      "",
      `Diterbitkan oleh ${tenant.rtFull} ${tenant.rwFull}, Kel. ${tenant.kelurahan}`,
    ].join("\n");
    downloadText(`kuitansi-${(s.noSurat || s.id).replace(/[^\w-]+/g, "-")}.txt`, isi, "text/plain;charset=utf-8");
    flash(`Kuitansi surat ${s.noSurat || s.jenis} berhasil diunduh.`);
  }

  // --- B12 · kop surat & PDF resmi (§6.6) ------------------------------------
  // Kop dimuat sekali saat pertama kali dibutuhkan (`null` = OFFLINE → PDF
  // memakai kop bawaan yang isinya sama dengan kop default server).
  const [kopSurat, setKopSurat] = useState<KopSurat | null>(null);
  const [kopDimuat, setKopDimuat] = useState(false);

  /**
   * B12 — unduh PDF surat terbit: kop tersimpan RT + blok TTD Ketua RT + QR
   * verifikasi `/q/<token>`. Modul PDF dimuat dinamis agar halaman ringan;
   * kegagalan QR di dalamnya tidak membatalkan unduhan (lihat lib/pdfSurat.ts).
   */
  async function unduhPdf(s: Surat) {
    let kop: KopSurat | null = kopSurat;
    if (!kopDimuat) {
      try {
        kop = await onMuatKopSurat();
        setKopSurat(kop);
      } catch (err) {
        // OFFLINE → senyap memakai kop bawaan; galat lain (sesi habis,
        // validasi) ditampilkan — tetap lanjut agar unduhan tidak hilang.
        if (!(err instanceof GalatApi && err.code === "OFFLINE")) {
          flash(err instanceof GalatApi ? err.message : "Kop surat gagal dimuat.");
        }
        kop = null;
      }
      setKopDimuat(true);
    }
    try {
      const { buatPdfSurat, namaBerkasSurat } = await import("../../lib/pdfSurat");
      const doc = await buatPdfSurat({
        kop,
        idBaris: s.serverId ?? s.id,
        noSurat: s.noSurat,
        jenis: s.jenis,
        pemohon: s.pemohon,
        keperluan: s.keperluan,
        tanggal: s.tanggal,
        status: s.status,
        perluRw: s.perluRw,
        ...(s.qrToken ? { qrToken: s.qrToken } : {}),
        ketua: {
          nama: ketuaRt?.nama ?? "Ketua RT",
          jabatan: ketuaRt?.jabatan ?? "Ketua RT",
          ttd: ketuaRt?.ttd ?? null,
        },
      });
      doc.save(namaBerkasSurat(s.noSurat, s.jenis));
      flash(`PDF surat ${s.noSurat || s.jenis} berhasil diunduh.`);
    } catch (err) {
      flash(err instanceof GalatApi ? err.message : "PDF gagal dibuat — coba lagi.");
    }
  }

  async function handleSubmitAjukan(e: React.FormEvent) {
    e.preventDefault();
    if (!formKeperluan.trim()) {
      flash("Keperluan surat wajib diisi sebelum dikirim.");
      return;
    }
    const jenis = formJenis;
    const keperluan = formKeperluan.trim();

    // Mode Edit: perbaiki pengajuan yang belum diverifikasi RT (no. surat & status tetap).
    if (editingSurat) {
      if (editingSurat.serverId) {
        // Baris server tidak punya endpoint edit milik warga (§5.3) — jangan
        // mengaku tersimpan padahal hanya berubah di sesi ini.
        flash("Pengajuan sudah tercatat di server — hubungi Pengurus RT bila datanya perlu diperbaiki.");
        return;
      }
      onEdit(editingSurat.id, { jenis, keperluan, perluRw: suratPerluRw(jenis) });
      setEditingSurat(null);
      setFormJenis(jenisSuratOptions[0]);
      setFormKeperluan("");
      setShowForm(false);
      flash("Pengajuan surat diperbarui — masih menunggu verifikasi Pengurus RT.");
      return;
    }

    try {
      await onAjukan({
        // No. Surat wajib ada sejak pengajuan dikirim (mode demo/OFFLINE);
        // saat daring server yang menghasilkan nomor antrean terakhir.
        noSurat: noSuratOtomatis(surat),
        jenis,
        pemohon,
        keperluan,
        tanggal: new Date().toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" }),
        status: "Menunggu RT",
        perluRw: suratPerluRw(jenis),
        noKk,
      });
    } catch (err) {
      // Galat server (validasi, sesi habis) → dialog tetap terbuka + pesan asli.
      flash(err instanceof GalatApi ? err.message : "Pengajuan surat gagal dikirim — coba lagi.");
      return;
    }
    setFormJenis(jenisSuratOptions[0]);
    setFormKeperluan("");
    flash(`Pengajuan surat berhasil dikirim ke Pengurus ${tenant.rtFull}!`);
    setShowForm(false);
  }

  const detailLangkah = detailSurat ? langkahSurat(detailSurat) : [];

  return (
    <div className="min-h-dvh bg-background font-body-md text-on-surface antialiased">
      {toast}

      <div className="max-w-7xl mx-auto px-4 md:px-6 lg:px-8 py-6 flex flex-col gap-6">
        {/* Breadcrumbs & Header */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 text-on-surface-variant text-xs">
            <button type="button" className="hover:text-primary transition-colors flex items-center gap-1" onClick={() => onNavigate?.("portal-warga")}><span className="material-symbols-outlined text-[16px]">home</span>
              Portal Warga
            </button>
            <span className="material-symbols-outlined text-[14px]">chevron_right</span>
            <span className="text-primary font-bold">Pengajuan Surat</span>
          </div>
          <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 pt-1">
            <div className="max-w-3xl flex flex-col gap-1.5">
              <h1 className="text-2xl lg:text-[32px] text-on-surface tracking-tight font-extrabold">
                Pengajuan Surat
              </h1>
              <p className="text-sm text-on-surface-variant leading-relaxed">
                Ajukan surat pengantar resmi dari {tenant.label} secara digital. Pantau status verifikasi dan unduh salinan digital surat yang telah ditandatangani.
              </p>
            </div>
            <button
              className="h-12 px-5 rounded-xl bg-primary text-on-primary text-sm shadow-md hover:bg-primary-container active:scale-[0.98] transition-all flex items-center gap-2 self-start"
              onClick={bukaForm}
            >
              <span className="material-symbols-outlined text-primary-fixed text-[20px]">add_circle</span>
              + Ajukan Surat Baru
            </button>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {kpiList.map((kpi) => (
            <div key={kpi.label} className="rounded-2xl bg-surface-container-lowest shadow-sm p-4 flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span className={`material-symbols-outlined text-[20px] ${kpi.color}`}>{kpi.icon}</span>
                <span className="text-[11px] text-on-surface-variant font-bold">{kpi.label}</span>
              </div>
              <span className="text-2xl font-extrabold text-on-surface">{kpi.value}</span>
            </div>
          ))}
        </div>

        {/* Table */}
        <div className="rounded-2xl bg-surface-container-lowest shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-outline-variant/20">
                  <th className="text-left px-5 py-3.5 text-[11px] font-bold text-on-surface-variant uppercase tracking-wider">No. Surat</th>
                  <th className="text-left px-5 py-3.5 text-[11px] font-bold text-on-surface-variant uppercase tracking-wider">Jenis</th>
                  <th className="text-left px-5 py-3.5 text-[11px] font-bold text-on-surface-variant uppercase tracking-wider">Pemohon</th>
                  <th className="text-left px-5 py-3.5 text-[11px] font-bold text-on-surface-variant uppercase tracking-wider">Keperluan</th>
                  <th className="text-left px-5 py-3.5 text-[11px] font-bold text-on-surface-variant uppercase tracking-wider">Tanggal</th>
                  <th className="text-left px-5 py-3.5 text-[11px] font-bold text-on-surface-variant uppercase tracking-wider">Status</th>
                  <th className="text-left px-5 py-3.5 text-[11px] font-bold text-on-surface-variant uppercase tracking-wider">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {daftar.map((s, idx) => (
                  <tr key={s.id} className={`border-b border-outline-variant/10 ${idx % 2 === 0 ? "" : "bg-surface-container-low/40"}`}>
                    <td className="px-5 py-4">
                      {s.noSurat ? (
                        <span className="font-mono text-xs font-bold text-primary">{s.noSurat}</span>
                      ) : (
                        <span className="text-xs text-on-surface-variant">—</span>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <span className="text-sm font-bold text-on-surface">{s.jenis}</span>
                    </td>
                    <td className="px-5 py-4">
                      <span className="text-xs text-on-surface-variant">{s.pemohon}</span>
                    </td>
                    <td className="px-5 py-4">
                      <span className="text-xs text-on-surface-variant">{s.keperluan}</span>
                      {s.catatan && <span className="block text-[11px] text-on-surface-variant mt-0.5 italic">{s.catatan}</span>}
                    </td>
                    <td className="px-5 py-4">
                      <span className="text-xs text-on-surface-variant">{s.tanggal}</span>
                    </td>
                    <td className="px-5 py-4">
                      <StatusBadge status={s.status} />
                    </td>
                    <td className="px-5 py-4">
                      {s.status === "Disetujui" ? (
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <button
                            className="h-9 px-3 rounded-xl bg-secondary-container/40 text-secondary text-xs font-bold flex items-center gap-1.5 hover:bg-secondary-container transition-colors"
                            onClick={() => void unduhPdf(s)}
                          >
                            <span className="material-symbols-outlined text-[16px]">download</span>
                            Unduh PDF
                          </button>
                          <button
                            className="h-9 px-3 rounded-xl bg-surface-container-high text-on-surface-variant text-xs flex items-center gap-1.5"
                            onClick={() => unduhKuitansi(s)}
                          >
                            <span className="material-symbols-outlined text-[16px]">receipt_long</span>
                            Kuitansi
                          </button>
                        </div>
                      ) : s.status === "Ditolak" || s.status === "Perlu Perbaikan" ? (
                        <button
                          className="h-9 px-3 rounded-xl bg-surface-container-high text-on-surface-variant text-xs flex items-center gap-1.5"
                          onClick={() => ajukanUlang(s)}
                        >
                          <span className="material-symbols-outlined text-[16px]">refresh</span>
                          Ajukan Ulang
                        </button>
                      ) : (
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <button
                            className="h-9 px-3 rounded-xl bg-surface-container-high text-on-surface-variant text-xs flex items-center gap-1.5"
                            onClick={() => setDetailSurat(s)}
                          >
                            <span className="material-symbols-outlined text-[16px]">visibility</span>
                            Detail
                          </button>
                          {/* Edit & Hapus aktif selama belum diverifikasi Pengurus RT. */}
                          {bisaDiperbaiki(s) && (
                            <>
                              <button
                                className="h-9 px-3 rounded-xl bg-primary-container/50 text-primary text-xs font-bold flex items-center gap-1.5 hover:bg-primary-container transition-colors"
                                onClick={() => ubahPengajuan(s)}
                              >
                                <span className="material-symbols-outlined text-[16px]">edit</span>
                                Edit
                              </button>
                              <button
                                className="h-9 px-3 rounded-xl bg-error-container/30 text-error text-xs font-bold flex items-center gap-1.5 hover:bg-error-container hover:text-on-error-container transition-colors"
                                onClick={() => setHapusSurat(s)}
                              >
                                <span className="material-symbols-outlined text-[16px]">delete</span>
                                Hapus
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
                {daftar.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-5 py-4">
                      <EmptyState
                        icon="note_add"
                        judul="Belum ada pengajuan surat"
                        pesan="Ajukan surat pengantar pertama Anda untuk keperluan domisili, SKTM, atau keperluan lain."
                        aksi={{ label: "+ Ajukan Surat Baru", onClick: bukaForm }}
                      />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Detail Surat Modal (read-only + alur progres) */}
      {detailSurat && (
        <div className="fixed inset-0 z-50 bg-on-background/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-xl mx-4 sm:mx-auto rounded-2xl bg-surface-container-lowest shadow-2xl p-6 flex flex-col gap-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary-fixed/50 text-primary flex items-center justify-center">
                  <span className="material-symbols-outlined text-[22px]">description</span>
                </div>
                <div>
                  <h3 className="text-base font-bold text-on-surface">Detail Pengajuan Surat</h3>
                  <p className="text-xs text-on-surface-variant">Status terkini dari pengajuan Anda</p>
                </div>
              </div>
              <button className="w-8 h-8 rounded-lg bg-surface-container flex items-center justify-center text-on-surface-variant" onClick={() => setDetailSurat(null)}>
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <div className="flex items-center gap-2">
              <StatusBadge status={detailSurat.status} />
              {detailSurat.perluRw && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-secondary-fixed text-on-secondary-fixed">
                  <span className="material-symbols-outlined text-[12px]">account_balance</span>
                  Butuh persetujuan RW
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-xl bg-surface-container-low col-span-2">
                <div className="text-[11px] text-on-surface-variant uppercase tracking-wider font-semibold">No. Surat</div>
                <div className="text-sm font-semibold text-on-surface font-mono mt-0.5">{detailSurat.noSurat || "—"}</div>
              </div>
              <div className="p-3 rounded-xl bg-surface-container-low">
                <div className="text-[11px] text-on-surface-variant uppercase tracking-wider font-semibold">Jenis Surat</div>
                <div className="text-sm font-semibold text-on-surface mt-0.5">{detailSurat.jenis}</div>
              </div>
              <div className="p-3 rounded-xl bg-surface-container-low">
                <div className="text-[11px] text-on-surface-variant uppercase tracking-wider font-semibold">Pemohon</div>
                <div className="text-sm font-semibold text-on-surface mt-0.5">{detailSurat.pemohon}</div>
              </div>
              <div className="p-3 rounded-xl bg-surface-container-low">
                <div className="text-[11px] text-on-surface-variant uppercase tracking-wider font-semibold">Tanggal Pengajuan</div>
                <div className="text-sm font-semibold text-on-surface mt-0.5">{detailSurat.tanggal}</div>
              </div>
              <div className="p-3 rounded-xl bg-surface-container-low">
                <div className="text-[11px] text-on-surface-variant uppercase tracking-wider font-semibold">Keperluan</div>
                <div className="text-sm font-semibold text-on-surface mt-0.5">{detailSurat.keperluan}</div>
              </div>
              {(detailSurat.catatan || detailSurat.catatanRw) && (
                <div className="p-3 rounded-xl bg-surface-container-low col-span-2">
                  <div className="text-[11px] text-on-surface-variant uppercase tracking-wider font-semibold">Catatan Pengurus</div>
                  <div className="text-sm text-on-surface mt-0.5 italic">
                    {detailSurat.catatan || detailSurat.catatanRw}
                  </div>
                </div>
              )}
            </div>

            {/* Alur progres */}
            <div className="p-4 rounded-xl bg-surface-container-low/60 border border-outline-variant/20">
              <div className="text-[11px] text-on-surface-variant uppercase tracking-wider font-semibold mb-3">Alur Pengajuan</div>
              <ol className="flex flex-col gap-3">
                {detailLangkah.map((step) => (
                  <li key={step.label} className="flex items-center gap-3">
                    <span
                      className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                        step.state === "done"
                          ? "bg-secondary-container text-on-secondary-container"
                          : step.state === "active"
                          ? langkahActiveCls(detailSurat.status)
                          : "bg-surface-container-high text-on-surface-variant"
                      }`}
                    >
                      <span className="material-symbols-outlined text-[15px]">
                        {step.state === "done" ? "check" : step.state === "active" ? "radio" : "circle"}
                      </span>
                    </span>
                    <span className={`text-sm ${step.state === "pending" ? "text-on-surface-variant" : "font-semibold text-on-surface"}`}>
                      {step.label}
                    </span>
                    <span className="ml-auto text-[11px] text-on-surface-variant">
                      {step.state === "done" ? "Selesai" : step.state === "active" ? "Sedang berjalan" : "Menunggu"}
                    </span>
                  </li>
                ))}
              </ol>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2 border-t border-surface-container-high">
              <button
                className="flex-1 h-11 rounded-xl bg-primary text-on-primary text-sm font-bold shadow-md"
                type="button"
                onClick={() => setDetailSurat(null)}
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Ajukan Surat Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 bg-on-background/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-xl mx-4 sm:mx-auto rounded-2xl bg-surface-container-lowest shadow-2xl p-6 flex flex-col gap-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary-fixed/50 text-primary flex items-center justify-center">
                  <span className="material-symbols-outlined text-[22px]">edit_note</span>
                </div>
                <div>
                  <h3 className="text-base font-bold text-on-surface">
                    {editingSurat ? "Perbaiki Pengajuan Surat" : "Ajukan Surat Pengantar Baru"}
                  </h3>
                  <p className="text-xs text-on-surface-variant">
                    {editingSurat
                      ? `No. Surat ${editingSurat.noSurat} — verifikasi oleh Pengurus ${tenant.rtFull}`
                      : `Verifikasi oleh Pengurus ${tenant.rtFull}`}
                  </p>
                </div>
              </div>
              <button
                className="w-8 h-8 rounded-lg bg-surface-container flex items-center justify-center text-on-surface-variant"
                onClick={() => { setShowForm(false); setEditingSurat(null); }}
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>
            <form className="flex flex-col gap-4" onSubmit={handleSubmitAjukan}>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface">Jenis Surat *</label>
                <select
                  className="w-full h-11 px-3 rounded-xl bg-surface-container-low text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary"
                  value={formJenis}
                  onChange={(e) => setFormJenis(e.target.value)}
                >
                  {jenisSuratOptions.map((j) => <option key={j} value={j}>{j}</option>)}
                </select>
                {suratPerluRw(formJenis) && (
                  <span className="text-[11px] text-on-surface-variant flex items-center gap-1">
                    <span className="material-symbols-outlined text-[13px]">info</span>
                    Jenis ini memerlukan persetujuan RW sebelum terbit.
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface">Keperluan / Uraian Singkat *</label>
                <textarea
                  className="w-full p-3 rounded-xl bg-surface-container-low text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                  placeholder="Contoh: Pengajuan KPR Bank Mandiri..."
                  rows={3}
                  value={formKeperluan}
                  onChange={(e) => setFormKeperluan(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface">Lampiran Berkas Pendukung</label>
                <div className="p-5 rounded-xl border border-dashed border-outline/30 bg-surface-container-low/50 flex flex-col items-center gap-2 cursor-pointer hover:bg-surface-container-low transition-colors">
                  <span className="material-symbols-outlined text-[32px] text-primary">upload_file</span>
                  <span className="text-xs font-bold text-on-surface">Klik atau seret file ke sini</span>
                  <span className="text-[11px] text-on-surface-variant">KTP, KK, Akta, dll. Maks 5 MB per file</span>
                </div>
              </div>
              <div className="flex items-center gap-3 pt-1">
                <button
                  className="flex-1 h-11 rounded-xl bg-surface-container-high text-on-surface text-sm"
                  type="button"
                  onClick={() => { setShowForm(false); setEditingSurat(null); }}
                >
                  Batal
                </button>
                <button className="flex-1 h-11 rounded-xl bg-primary text-on-primary text-sm font-bold shadow-md" type="submit">
                  {editingSurat ? "Simpan Perubahan" : "Ajukan Surat"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Modal: Konfirmasi Hapus Pengajuan (belum diverifikasi RT) */}
      {hapusSurat && (
        <div className="fixed inset-0 z-50 bg-on-background/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-surface-container-lowest shadow-2xl p-6 flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-error-container/40 flex items-center justify-center text-error shrink-0">
                <span className="material-symbols-outlined text-[22px]">delete</span>
              </div>
              <div>
                <h3 className="text-base font-bold text-on-surface">Hapus Pengajuan Surat?</h3>
                <p className="text-xs text-on-surface-variant">Berlaku untuk pengajuan yang belum diverifikasi {tenant.rtFull}.</p>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-surface-container-low flex flex-col gap-1.5">
              <span className="text-sm font-bold text-on-surface">{hapusSurat.jenis}</span>
              <span className="text-xs font-mono text-primary font-bold break-all">{hapusSurat.noSurat || "Tanpa nomor"}</span>
              <span className="text-xs text-on-surface-variant">{hapusSurat.keperluan}</span>
            </div>

            <p className="text-xs text-on-surface-variant leading-relaxed">
              Pengajuan akan dihapus dari daftar dan dari Portal RT. Riwayat surat yang sudah
              diterbitkan tidak terpengaruh.
            </p>

            <div className="flex items-center justify-end gap-3 pt-2 border-t border-surface-container-high">
              <button
                className="h-11 px-4 rounded-xl text-on-surface-variant text-sm hover:bg-surface-container-high transition-colors"
                onClick={() => setHapusSurat(null)}
              >
                Batal
              </button>
              <button
                className="h-11 px-6 rounded-xl bg-error text-on-error text-sm font-bold shadow-md hover:opacity-90 active:scale-[0.98] transition-all flex items-center gap-2"
                onClick={() => {
                  if (hapusSurat.serverId) {
                    // Baris tercatat di server — tidak ada endpoint hapus milik
                    // warga (§5.3), jadi dijelaskan alih-alih menghapus palsu.
                    flash("Pengajuan sudah tercatat di server — hubungi Pengurus RT untuk menghapusnya.");
                    setHapusSurat(null);
                    return;
                  }
                  onHapus(hapusSurat.id);
                  setHapusSurat(null);
                  flash(`Pengajuan ${hapusSurat.jenis} berhasil dihapus.`);
                }}
              >
                <span className="material-symbols-outlined text-[18px]">delete</span>
                Ya, Hapus
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
