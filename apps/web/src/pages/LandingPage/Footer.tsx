const SIWARGA_LOGO = "/siwarga-logo.png";

/**
 * href → tautan internal landing (berlabuh pada section yang benar-benar ada);
 * page → navigasi state ke halaman dokumen hukum; tanpa href/page → label nonaktif
 * (diberi aria-disabled, bukan link mati).
 */
type FooterLink = { label: string; href?: string; page?: string };

const footerLinks: Record<"peruntukan" | "pengembang" | "kepatuhan", FooterLink[]> = {
  peruntukan: [
    { label: "Warga", href: "#persona" },
    { label: "Pengurus RT/RW", href: "#persona" },
    { label: "Instansi Kelurahan", href: "#persona" },
  ],
  pengembang: [
    { label: "Dokumentasi API" },
    { label: "Keamanan Sistem" },
    { label: "Status Layanan" },
  ],
  kepatuhan: [
    { label: "Syarat & Ketentuan", page: "syarat-ketentuan" },
    { label: "Kebijakan Privasi", page: "kebijakan-privasi" },
    { label: "Pedoman Tata Kelola" },
  ],
};

interface FooterProps {
  onNavigate?: (page: string) => void;
}

export function Footer({ onNavigate }: FooterProps) {
  const renderLink = (link: FooterLink) => {
    const kelas = "text-sm transition-colors";
    const page = link.page;
    if (page) {
      return (
        <button
          key={link.label}
          type="button"
          className={`${kelas} text-slate-400 hover:text-white text-left`}
          onClick={() => onNavigate?.(page)}
        >
          {link.label}
        </button>
      );
    }
    if (link.href) {
      return (
        <a key={link.label} className={`${kelas} text-slate-400 hover:text-white`} href={link.href}>
          {link.label}
        </a>
      );
    }
    return (
      <span
        key={link.label}
        aria-disabled="true"
        className={`${kelas} text-slate-500/70 cursor-not-allowed select-none`}
        title="Belum tersedia"
      >
        {link.label}
      </span>
    );
  };

  return (
    <footer className="w-full bg-slate-900 text-slate-300">
      {/* Compliance Strip */}
      <div className="w-full bg-slate-950/80 py-4 border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-wrap items-center justify-center lg:justify-between gap-4 text-xs font-medium text-slate-400">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-emerald-400 text-[18px]">
              verified_user
            </span>
            <span>Sesuai UU Perlindungan Data Pribadi No. 27/2022</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-emerald-400 text-[18px]">
              lock
            </span>
            <span>Enkripsi AES 256-bit Standar Perbankan</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-emerald-400 text-[18px]">
              cloud_done
            </span>
            <span>Server Data Center Domestik Indonesia</span>
          </div>
        </div>
      </div>

      {/* Main Footer */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-10">
          <div className="lg:col-span-2 flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <div className="bg-white p-1 rounded-xl">
                <img
                  alt="Brand logo"
                  className="h-8 w-auto object-contain"
                  src={SIWARGA_LOGO}
                />
              </div>
            </div>
            <p className="text-sm text-slate-400 max-w-sm leading-relaxed">
              Platform civic-tech modern untuk akuntabilitas kas, tata kelola
              kependudukan, dan layanan administrasi RT/RW yang transparan dan
              terpercaya.
            </p>
          </div>

          <div className="flex flex-col gap-3">
            <div className="text-xs uppercase tracking-wider text-slate-200 font-bold">
              Peruntukan
            </div>
            {footerLinks.peruntukan.map(renderLink)}
          </div>

          <div className="flex flex-col gap-3">
            <div className="text-xs uppercase tracking-wider text-slate-200 font-bold">
              Pengembang &amp; Integrasi
            </div>
            {footerLinks.pengembang.map(renderLink)}
          </div>

          <div className="flex flex-col gap-3">
            <div className="text-xs uppercase tracking-wider text-slate-200 font-bold">
              Kepatuhan &amp; Legalitas
            </div>
            {footerLinks.kepatuhan.map(renderLink)}
          </div>
        </div>

        <div className="mt-12 pt-8 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <span>
            &copy; 2026 SIWARGA Civic Tech Indonesia. Seluruh hak cipta
            dilindungi undang-undang.
          </span>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
            <span className="font-mono text-slate-400">v2.4-civic-audit</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
