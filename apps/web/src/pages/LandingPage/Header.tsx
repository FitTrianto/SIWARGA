const SIWARGA_LOGO = "/siwarga-logo.png";

interface HeaderProps {
  onNavigate?: (page: "landing" | "login") => void;
}

export function Header({ onNavigate }: HeaderProps) {
  const navLinks = [
    { label: "Solusi & Fitur", href: "#solusi-fitur" },
    { label: "Masalah & Solusi Persona", href: "#persona" },
    { label: "Harga & Paket", href: "#harga-paket" },
    { label: "Kalkulator Iuran", href: "#kalkulator" },
    { label: "Hubungi Kami", href: "#faq" },
  ];

  return (
    <header className="fixed top-0 w-full z-50 bg-white/80 backdrop-blur-xl border-b border-emerald-900/5 shadow-[0_4px_24px_rgba(0,0,0,0.02)] transition-all duration-300">
      <div className="h-20 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-4">
        <button
          type="button"
          aria-label="Kembali ke atas halaman"
          className="flex items-center gap-3 group focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-xl"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        >
          <img
            alt="SIWARGA Civic Tech"
            className="h-9 w-auto object-contain transition-transform duration-300 group-hover:scale-105"
            src={SIWARGA_LOGO}
          />
        </button>

        <nav className="hidden xl:flex items-center gap-1 bg-slate-50/70 p-1.5 rounded-full border border-emerald-900/5 text-sm font-medium text-slate-600">
          {navLinks.map((link) => (
            <a
              key={link.href}
              className="px-4 py-2 rounded-full transition-all duration-200 hover:text-emerald-800 hover:bg-white hover:shadow-sm"
              href={link.href}
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <button
            type="button"
            className="inline-flex items-center font-semibold text-sm text-slate-700 hover:text-emerald-800 px-4 py-2.5 rounded-xl hover:bg-emerald-50/60 transition-all duration-200"
            onClick={() => onNavigate?.("login")}
          >
            Masuk Portal
          </button>
          <a
            className="inline-flex items-center justify-center gap-1.5 font-semibold text-sm bg-gradient-to-r from-[#005b34] to-[#137547] text-white px-5 py-2.5 rounded-xl shadow-[0_4px_14px_rgba(0,91,52,0.25)] hover:shadow-[0_6px_20px_rgba(0,91,52,0.35)] hover:scale-[1.02] active:scale-[0.98] transition-all duration-200"
            href="#daftar-sekarang"
          >
            <span>Daftar Gratis</span>
            <span className="material-symbols-outlined text-[18px]">
              arrow_forward
            </span>
          </a>
          <div className="w-9 h-9 rounded-xl bg-emerald-50 border border-emerald-200/60 flex items-center justify-center text-emerald-800 shadow-sm cursor-pointer hover:bg-emerald-100 transition-colors">
            <span className="material-symbols-outlined text-[20px]">
              person
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}
