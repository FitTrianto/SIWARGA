import type { ReactNode } from "react";

const SIWARGA_LOGO = "/siwarga-logo.png";

interface LegalShellProps {
  /** Dokumen yang sedang dibuka — menentukan pil nav aktif. */
  aktif: "syarat" | "privasi";
  judul: string;
  /** Kalimat berlaku sejak + versi. */
  meta: string;
  /** Kembali ke halaman asal (landing atau portal tempat tautan diklik). */
  onBack: () => void;
  onNavigate: (page: string) => void;
  children: ReactNode;
}

const pilBase =
  "px-4 py-2 rounded-full transition-all duration-200 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-primary";

/**
 * Cangkang halaman dokumen hukum publik (Syarat & Ketentuan / Kebijakan
 * Privasi). Mengikuti estetika landing (putih, aksen emerald, header fixed
 * h-20) dan hanya berisi tautan yang benar-benar punya tujuan: pil nav antar
 * dokumen, logo → beranda, dan "Kembali" → halaman asal.
 */
export function LegalShell({ aktif, judul, meta, onBack, onNavigate, children }: LegalShellProps) {
  return (
    <div className="min-h-dvh bg-[#fafcfa] text-[#0f172a] font-body-md antialiased selection:bg-emerald-100 selection:text-emerald-900">
      <a
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-70 focus:bg-primary focus:text-on-primary focus:px-4 focus:py-2.5 focus:rounded-xl focus:text-sm focus:font-bold focus:shadow-lg"
        href="#konten-utama"
      >
        Lewati ke konten utama
      </a>

      <header className="fixed top-0 w-full z-50 bg-white/80 backdrop-blur-xl border-b border-emerald-900/5 shadow-[0_4px_24px_rgba(0,0,0,0.02)]">
        <div className="h-20 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-4">
          <button
            type="button"
            className="flex items-center gap-3 group focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-xl"
            onClick={() => onNavigate("landing")}
          >
            <img
              alt="SIWARGA Civic Tech"
              className="h-9 w-auto object-contain transition-transform duration-300 group-hover:scale-105"
              src={SIWARGA_LOGO}
            />
          </button>

          <nav
            aria-label="Dokumen hukum"
            className="hidden sm:flex items-center gap-1 bg-slate-50/70 p-1.5 rounded-full border border-emerald-900/5 text-sm"
          >
            <button
              type="button"
              className={`${pilBase} ${
                aktif === "syarat"
                  ? "bg-white text-emerald-900 shadow-sm font-semibold"
                  : "text-slate-600 hover:text-emerald-800 hover:bg-white"
              }`}
              onClick={() => onNavigate("syarat-ketentuan")}
            >
              Syarat &amp; Ketentuan
            </button>
            <button
              type="button"
              className={`${pilBase} ${
                aktif === "privasi"
                  ? "bg-white text-emerald-900 shadow-sm font-semibold"
                  : "text-slate-600 hover:text-emerald-800 hover:bg-white"
              }`}
              onClick={() => onNavigate("kebijakan-privasi")}
            >
              Kebijakan Privasi
            </button>
          </nav>

          <button
            type="button"
            className="inline-flex items-center gap-1.5 font-semibold text-sm text-slate-700 hover:text-emerald-900 hover:bg-white border border-emerald-900/10 px-4 py-2 rounded-full transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            onClick={onBack}
          >
            <span className="material-symbols-outlined text-[18px]">arrow_back</span>
            Kembali
          </button>
        </div>
      </header>

      <main id="konten-utama" tabIndex={-1} className="pt-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-14">
          <p className="text-xs font-bold uppercase tracking-widest text-emerald-700 mb-3">
            Dokumen Hukum SIWARGA
          </p>
          <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight text-balance">
            {judul}
          </h1>
          <p className="mt-3 text-sm text-slate-500 font-medium">{meta}</p>

          <article className="mt-8 rounded-2xl bg-white border border-emerald-900/5 shadow-[0_4px_24px_rgba(0,0,0,0.03)] p-5 sm:p-9 space-y-8">
            {children}
          </article>
        </div>
      </main>

      <footer className="w-full bg-slate-900 text-slate-400">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-7 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs">
          <span>&copy; 2026 SIWARGA Civic Tech Indonesia. Seluruh hak cipta dilindungi undang-undang.</span>
          <div className="flex items-center gap-4 font-medium">
            <button
              type="button"
              className={`transition-colors hover:text-white ${aktif === "syarat" ? "text-white" : ""}`}
              onClick={() => onNavigate("syarat-ketentuan")}
            >
              Syarat &amp; Ketentuan
            </button>
            <button
              type="button"
              className={`transition-colors hover:text-white ${aktif === "privasi" ? "text-white" : ""}`}
              onClick={() => onNavigate("kebijakan-privasi")}
            >
              Kebijakan Privasi
            </button>
            <button type="button" className="transition-colors hover:text-white" onClick={() => onNavigate("landing")}>
              Beranda
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
