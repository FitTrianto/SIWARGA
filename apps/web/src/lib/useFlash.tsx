import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Toast inline bersama — pengganti `window.alert()` dan pengganti definisi
 * `function flash()` yang dulu diduplikasi di 26 file (Batch C / P1-6).
 *
 * Pakai:
 *   const { flash, toast } = useFlash();
 *   ...
 *   return <div>…{toast}</div>;
 *
 * Perilaku identik dengan implementasi lama: pesan tampil 3 detik, tombol silang
 * bisa menutup lebih awal. Posisi `z-60` mengikuti skala z-index preset —
 * toast selalu berada di atas modal halaman (z-50).
 */
export function useFlash(): { flash: (pesan: string) => void; toast: ReactNode } {
  const [pesan, setPesan] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const flash = (msg: string) => {
    setPesan(msg);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setPesan(null), 3000);
  };

  const tutup = () => {
    window.clearTimeout(timer.current);
    setPesan(null);
  };

  // Bersihkan timer saat komponen dilepas (jangan set state setelah unmount).
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const toast: ReactNode = pesan ? (
    <div
      role="alert"
      className="fixed bottom-6 right-6 z-60 flex items-center gap-3 px-5 py-3.5 rounded-xl bg-on-background text-surface shadow-2xl transition-all duration-300"
    >
      <span className="material-symbols-outlined text-secondary-container text-[20px]">check_circle</span>
      <span className="text-sm font-semibold">{pesan}</span>
      <button
        aria-label="Tutup notifikasi"
        className="ml-2 text-surface/70 hover:text-surface"
        onClick={tutup}
      >
        <span className="material-symbols-outlined text-[18px]">close</span>
      </button>
    </div>
  ) : null;

  return { flash, toast };
}
