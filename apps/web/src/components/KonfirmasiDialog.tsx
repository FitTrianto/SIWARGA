import { useEffect, type ReactNode } from "react";

/**
 * Dialog konfirmasi bersama (B3 · sesi & keamanan).
 *
 * Pengganti `window.confirm()` / `window.alert()` — keduanya tidak pernah
 * dipakai di aplikasi ini. Satu komponen dipakai di dua tempat:
 *   1. Konfirmasi **keluar** dari akun — dibuka App.tsx lewat `logout()`,
 *      sehingga keempat layout (Portal Warga, Portal RT, Portal RW, Admin)
 *      ikut tanpa perlu duplikasi state di tiap layout.
 *   2. Konfirmasi aksi berisiko Data Warga RT (kirim ulang / cabut undangan,
 *      nonaktifkan / aktifkan akses).
 *
 * Esc dan klik latar belakang membatalkan — kecuali selama `sedang` (permintaan
 * API sedang berjalan) supaya aksi tidak terputus di tengah jalan.
 */
interface KonfirmasiDialogProps {
  judul: string;
  pesan: string;
  /** Isi opsional di atas baris tombol (mis. kartu warga yang jadi sasaran). */
  detail?: ReactNode;
  labelYa: string;
  labelBatal?: string;
  ikon?: string;
  /** Aksen tombol utama — `error` untuk aksi merusak, `primary` untuk netral. */
  aksen?: "error" | "primary" | "tertiary";
  /** true → tombol terkunci & dialog tak bisa ditutup (menunggu API). */
  sedang?: boolean;
  onBatal: () => void;
  onYa: () => void;
}

const AKSEN: Record<"error" | "primary" | "tertiary", { kotak: string; tombol: string }> = {
  error: {
    kotak: "bg-error-container/40 text-error",
    tombol: "bg-error text-on-error hover:opacity-90",
  },
  primary: {
    kotak: "bg-primary-container text-on-primary-container",
    tombol: "bg-primary text-on-primary hover:bg-primary-container",
  },
  tertiary: {
    kotak: "bg-tertiary-container text-on-tertiary-container",
    tombol: "bg-tertiary-container text-on-tertiary-container hover:opacity-90",
  },
};

export function KonfirmasiDialog({
  judul,
  pesan,
  detail,
  labelYa,
  labelBatal = "Batal",
  ikon = "help",
  aksen = "primary",
  sedang = false,
  onBatal,
  onYa,
}: KonfirmasiDialogProps) {
  // Esc = batal, selama permintaan API tidak sedang berjalan.
  useEffect(() => {
    if (sedang) return;
    const onTuts = (e: KeyboardEvent) => {
      if (e.key === "Escape") onBatal();
    };
    window.addEventListener("keydown", onTuts);
    return () => window.removeEventListener("keydown", onTuts);
  }, [sedang, onBatal]);

  const warna = AKSEN[aksen];

  return (
    <div
      className="fixed inset-0 z-50 bg-on-background/40 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={() => {
        if (!sedang) onBatal();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="judul-konfirmasi"
        className="w-full max-w-md rounded-2xl bg-surface-container-lowest shadow-2xl p-6 flex flex-col gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${warna.kotak}`}>
            <span className="material-symbols-outlined text-[22px]">{ikon}</span>
          </div>
          <div>
            <h3 id="judul-konfirmasi" className="text-base font-bold text-on-surface">
              {judul}
            </h3>
            <p className="text-xs text-on-surface-variant leading-relaxed">{pesan}</p>
          </div>
        </div>

        {detail}

        <div className="flex items-center justify-end gap-3 pt-2 border-t border-surface-container-high">
          <button
            className="h-11 px-4 rounded-xl text-on-surface-variant text-sm hover:bg-surface-container-high transition-colors disabled:opacity-60"
            onClick={onBatal}
            disabled={sedang}
          >
            {labelBatal}
          </button>
          <button
            className={`h-11 px-6 rounded-xl text-sm font-bold shadow-md active:scale-[0.98] transition-all flex items-center gap-2 disabled:opacity-60 ${warna.tombol}`}
            onClick={onYa}
            disabled={sedang}
          >
            {sedang ? (
              <span className="material-symbols-outlined text-[18px] animate-spin">progress_activity</span>
            ) : null}
            {labelYa}
          </button>
        </div>
      </div>
    </div>
  );
}
