/**
 * Empty state terkomposisi (Batch C / P2-4) — ikon + judul + ajakan aksi,
 * pengganti teks polos "Belum ada …" / "Tidak ada data …".
 *
 * Aturan pakai: `aksi` hanya diisi bila tombolnya benar-benar ada dan
 * berfungsi — jangan menciptakan tombol mati baru.
 */

interface EmptyStateProps {
  /** Ikon Material Symbols (mis. "inbox", "search_off", "receipt_long"). */
  icon: string;
  /** Apa yang kosong — satu kalimat pendek. */
  judul: string;
  /** Konteks tambahan: kenapa kosong / apa yang bisa dilakukan. */
  pesan?: string;
  /** Ajakan aksi nyata (opsional). */
  aksi?: { label: string; onClick: () => void };
  /** Override padding/ukuran bila dipakai di dalam sel tabel sempit. */
  className?: string;
}

export function EmptyState({ icon, judul, pesan, aksi, className }: EmptyStateProps) {
  return (
    <div
      role="status"
      className={`flex flex-col items-center justify-center gap-2 text-center ${
        className ?? "py-10 px-6"
      }`}
    >
      <span aria-hidden="true" className="material-symbols-outlined text-[28px] text-on-surface-variant/50">
        {icon}
      </span>
      <p className="text-sm font-bold text-on-surface">{judul}</p>
      {pesan && <p className="text-xs text-on-surface-variant max-w-sm">{pesan}</p>}
      {aksi && (
        <button
          type="button"
          className="mt-1.5 inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-on-primary transition-all hover:bg-primary-container active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          onClick={aksi.onClick}
        >
          {aksi.label}
        </button>
      )}
    </div>
  );
}
