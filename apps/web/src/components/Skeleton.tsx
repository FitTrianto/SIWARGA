/**
 * Primitif skeleton loader (Batch C / P2-3).
 *
 * Data frontend kini masih seed sinkron — belum ada aspek yang dimuat dari
 * backend, jadi skeleton sengaja TIDAK dipasang di halaman mana pun agar
 * tidak menampilkan loading palsu. Komponen ini disiapkan agar saat backend
 * F-2 masuk, cukup dipakai:
 *
 *   {memuat ? <SkeletonRows rows={5} /> : <Tabel data={data} />}
 *
 * Menghormati `prefers-reduced-motion` (lihat index.css): animasi pulse
 * dinonaktifkan otomatis untuk pengguna sensitif gerak.
 */

interface SkeletonProps {
  className?: string;
}

/** Batang tunggal — lebar mengikuti konteks (tulis `className` untuk ukuran). */
export function Skeleton({ className = "" }: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      className={`block animate-pulse rounded-lg bg-surface-container-high ${className}`}
    />
  );
}

interface SkeletonRowsProps {
  /** Jumlah baris — samakan dengan jumlah baris yang biasanya tampil. */
  rows?: number;
  /** true → render sebagai baris tabel (td) alih-alih blok daftar. */
  dalamTabel?: boolean;
}

/** Deret skeleton baris untuk tabel atau daftar yang sedang dimuat. */
export function SkeletonRows({ rows = 3, dalamTabel = false }: SkeletonRowsProps) {
  const batang = (
    <>
      <Skeleton className="h-4 w-2/5" />
      <Skeleton className="h-4 w-1/4" />
      <Skeleton className="h-4 w-1/5" />
    </>
  );

  if (dalamTabel) {
    return (
      <>
        {Array.from({ length: rows }, (_, i) => (
          <tr key={i} aria-hidden="true" className="border-b border-surface-container-highest">
            <td className="px-4 py-3.5">
              <Skeleton className="h-4 w-2/5" />
            </td>
            <td className="px-4 py-3.5">
              <Skeleton className="h-4 w-1/3" />
            </td>
            <td className="px-4 py-3.5">
              <Skeleton className="h-4 w-20" />
            </td>
            <td className="px-4 py-3.5">
              <Skeleton className="h-4 w-16" />
            </td>
          </tr>
        ))}
      </>
    );
  }

  return (
    <div role="status" aria-label="Memuat data" className="space-y-3">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3" aria-hidden="true">
          <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2">{batang}</div>
        </div>
      ))}
    </div>
  );
}
