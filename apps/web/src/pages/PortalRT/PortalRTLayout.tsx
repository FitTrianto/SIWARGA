import { ReactNode, useState, useRef, useEffect } from "react";
import { tenant } from "../../lib/tenant";
import { useFlash } from "../../lib/useFlash";

interface PortalRTLayoutProps {
  currentPage: string;
  onNavigate?: (page: string) => void;
  onLogout?: () => void;
  children: ReactNode;
}

const navItems = [
  { key: "dashboard-rt", label: "Dashboard", icon: "space_dashboard" },
  { key: "data-hunian-rt", label: "Data Hunian", icon: "home_work" },
  { key: "data-warga-rt", label: "Data Warga", icon: "group" },
  { key: "iuran-rt", label: "Iuran", icon: "payments" },
  { key: "kas-rt", label: "Kas RT", icon: "account_balance_wallet" },
  { key: "surat-pengantar-rt", label: "Surat Pengantar", icon: "mark_email_read" },
  { key: "laporan-bulanan-rt", label: "Laporan Bulanan", icon: "summarize" },
  { key: "audit-log-pdp", label: "Audit Log PDP", icon: "security" },
  { key: "pengaturan-rt", label: "Pengaturan", icon: "settings" },
];

export function PortalRTLayout({ currentPage, onNavigate, onLogout, children }: PortalRTLayoutProps) {
  const [showProfile, setShowProfile] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showGantiPassword, setShowGantiPassword] = useState(false);
  const [formPassword, setFormPassword] = useState({ baru: "", konfirmasi: "" });
  const { flash, toast } = useFlash();
  const profileRef = useRef<HTMLDivElement>(null);


  function handleGantiPassword(e: React.FormEvent) {
    e.preventDefault();
    if (formPassword.baru.length < 8) {
      flash("Password baru minimal 8 karakter.");
      return;
    }
    if (formPassword.baru !== formPassword.konfirmasi) {
      flash("Konfirmasi password tidak sama dengan password baru.");
      return;
    }
    flash("Password berhasil diperbarui");
    setShowGantiPassword(false);
    setFormPassword({ baru: "", konfirmasi: "" });
  }

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setShowProfile(false);
      }
    }
    if (showProfile) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showProfile]);

  useEffect(() => {
    if (sidebarOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [sidebarOpen]);

  const sidebarNavClick = (key: string) => {
    setSidebarOpen(false);
    onNavigate?.(key);
  };

  return (
    <div className="min-h-dvh bg-background font-body-md text-on-surface antialiased">
      <a
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-70 focus:bg-primary focus:text-on-primary focus:px-4 focus:py-2.5 focus:rounded-xl focus:text-sm focus:font-bold focus:shadow-lg"
        href="#konten-utama"
      >
        Lewati ke konten utama
      </a>
      {/* Mobile Sidebar Backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed top-0 left-0 bottom-0 w-72 z-50 bg-surface-container-lowest border-r border-surface-container-high flex flex-col
          transform transition-transform duration-300 ease-in-out
          lg:translate-x-0
          ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}
      >
        {/* Logo */}
        <div className="px-5 py-5 border-b border-surface-container-high">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-on-primary text-[22px]">assured_workload</span>
            </div>
            <div className="flex flex-col">
              <span className="font-extrabold text-lg text-primary tracking-tight leading-none">SIWARGA</span>
              <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider mt-0.5">Civic Govtech</span>
            </div>
          </div>
        </div>

        {/* RT Selector Badge */}
        <div className="px-4 py-3">
          <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-primary-container/50 border border-primary-container">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-on-primary text-[16px]">location_on</span>
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-sm font-bold text-on-primary-container leading-tight">{tenant.label}</span>
              <span className="text-[11px] text-on-primary-container/70 truncate">{tenant.perumahan}</span>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-2 space-y-0.5">
          {navItems.map((item) => {
            const isActive = currentPage === item.key;
            return (
              <button type="button"
                key={item.key}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all ${
                  isActive
                    ? "bg-primary-container text-on-primary font-semibold shadow-[0_2px_8px_-2px_rgba(15,81,50,0.16)]"
                    : "text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
                }`}
                onClick={() => {sidebarNavClick(item.key)}}>
                <span className={`material-symbols-outlined text-[20px] ${isActive ? "text-on-primary" : ""}`}>
                  {item.icon}
                </span>
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* Compliance Badge */}
        <div className="px-4 py-3 border-t border-surface-container-high">
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary-container/30">
            <span className="relative flex h-2.5 w-2.5 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-secondary opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-secondary" />
            </span>
            <span className="text-[11px] font-semibold text-on-secondary-container">Portal Kepatuhan Terverifikasi</span>
          </div>
        </div>
      </aside>

      {/* Header */}
      <header className="fixed top-0 left-0 right-0 lg:left-72 z-40 h-16 bg-surface-container-lowest/95 backdrop-blur-xl border-b border-surface-container-high flex items-center justify-between px-4 lg:px-6">
        {/* Left: Hamburger (mobile) + Wilayah Badge */}
        <div className="flex items-center gap-3">
          <button
            className="lg:hidden p-2 -ml-2 rounded-lg hover:bg-surface-container-high transition-colors cursor-pointer"
            onClick={() => setSidebarOpen(!sidebarOpen)}
          >
            <span className="material-symbols-outlined text-on-surface text-[24px]">menu</span>
          </button>
          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface-container-low text-on-surface-variant text-xs font-semibold">
            <span className="material-symbols-outlined text-primary text-[16px]">location_city</span>
            Wilayah Mandiri {tenant.rtFull} {tenant.rwFull}
          </div>
          <div className="flex sm:hidden items-center gap-1.5 text-on-surface-variant text-sm font-bold">
            <span className="text-primary">SIWARGA</span>
          </div>
        </div>

        {/* Right: Notification + User */}
        <div className="flex items-center gap-2 lg:gap-4">
          {/* Notification Bell */}
          <button className="relative p-2 rounded-full hover:bg-surface-container-high transition-colors cursor-pointer">
            <span className="material-symbols-outlined text-on-surface-variant text-[22px]">notifications</span>
            <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-error" />
          </button>

          {/* User Info */}
          <div className="relative" ref={profileRef}>
            <button
              className="flex items-center gap-2.5 pl-1 pr-1 py-1 rounded-xl hover:bg-surface-container-high transition-colors cursor-pointer"
              onClick={() => setShowProfile(!showProfile)}
            >
              <div className="hidden sm:flex flex-col text-right">
                <span className="text-sm font-semibold text-on-surface leading-tight">Bpk. Joko Santoso</span>
                <span className="text-[11px] font-bold text-on-primary bg-primary/90 px-2 py-0.5 rounded-full inline-block mt-0.5 self-end">
                  Ketua RT • Aktif Bertugas
                </span>
              </div>
              <div className="w-9 h-9 rounded-full bg-primary flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-on-primary text-[18px]">person</span>
              </div>
              <span className="material-symbols-outlined text-on-surface-variant text-[18px] hidden sm:block">expand_more</span>
            </button>

            {showProfile && (
              <div className="absolute right-0 top-full mt-2 w-64 bg-surface-container-lowest rounded-xl shadow-[0_8px_30px_rgba(0,0,0,0.12)] border border-surface-container-high py-1 z-50">
                <div className="px-4 py-3 border-b border-surface-container-high">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center shrink-0">
                      <span className="material-symbols-outlined text-on-primary text-[20px]">person</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-sm font-bold text-on-surface">Bpk. Joko Santoso</span>
                      <span className="text-[11px] text-on-surface-variant">Ketua {tenant.rtFull}</span>
                    </div>
                  </div>
                </div>
                <div className="py-1">
                  <button
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-on-surface hover:bg-surface-container-low transition-colors"
                    onClick={() => {
                      setShowProfile(false);
                      onNavigate?.("pengaturan-rt");
                    }}
                  >
                    <span className="material-symbols-outlined text-[20px] text-on-surface-variant">settings</span>
                    Pengaturan
                  </button>
                  <button
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-on-surface hover:bg-surface-container-low transition-colors"
                    onClick={() => {
                      setShowProfile(false);
                      setShowGantiPassword(true);
                    }}
                  >
                    <span className="material-symbols-outlined text-[20px] text-on-surface-variant">password</span>
                    Ganti Password
                  </button>
                  <button
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-error hover:bg-error-container/30 transition-colors"
                    onClick={() => {
                      setShowProfile(false);
                      onLogout?.();
                    }}
                  >
                    <span className="material-symbols-outlined text-[20px]">logout</span>
                    Keluar
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main id="konten-utama" tabIndex={-1} className="pl-0 lg:pl-72 pt-16 min-h-dvh bg-background">
        <div className="p-4 lg:p-6">{children}</div>

        {/* Footer */}
        <footer className="w-full border-t border-surface-container-high bg-surface-container-lowest mt-10">
          <div className="px-4 lg:px-6 py-5 flex flex-col items-center md:flex-row md:justify-between gap-4 text-xs text-on-surface-variant text-center md:text-left">
            <div className="flex flex-col sm:flex-row items-center gap-2">
              <div className="flex items-center gap-2">
                <span className="text-sm text-primary font-bold">SIWARGA</span>
                <span className="font-semibold">RT Enterprise v4.0</span>
              </div>
              <div className="hidden sm:block mx-1 text-surface-container-high">•</div>
              <span>Mematuhi UU No. 27 Tahun 2022 tentang Pelindungan Data Pribadi</span>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-4">
              <button
                type="button"
                className="hover:text-primary transition-colors font-medium"
                onClick={() => onNavigate?.("kebijakan-privasi")}
              >
                Kebijakan Privasi
              </button>
              <button
                type="button"
                className="hover:text-primary transition-colors font-medium"
                onClick={() => onNavigate?.("syarat-ketentuan")}
              >
                Syarat Layanan
              </button>
              <span
                aria-disabled="true"
                className="font-medium cursor-not-allowed select-none opacity-60"
                title="Belum tersedia"
              >
                Pusat Bantuan
              </span>
              <span
                aria-disabled="true"
                className="font-medium cursor-not-allowed select-none opacity-60"
                title="Belum tersedia"
              >
                Kontak Pengurus
              </span>
            </div>
          </div>
        </footer>
      </main>

      {toast}

      {showGantiPassword && (
        <div className="fixed inset-0 z-60 bg-on-background/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md mx-4 sm:mx-auto rounded-2xl bg-surface-container-lowest shadow-2xl p-6 flex flex-col gap-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary-container flex items-center justify-center text-on-primary-container">
                  <span className="material-symbols-outlined text-[22px]">password</span>
                </div>
                <div>
                  <h3 className="text-base font-bold text-on-surface">Ganti Password</h3>
                  <p className="text-xs text-on-surface-variant">Perbarui password akun Ketua RT</p>
                </div>
              </div>
              <button
                className="w-8 h-8 rounded-lg bg-surface-container flex items-center justify-center text-on-surface-variant hover:text-on-surface"
                onClick={() => setShowGantiPassword(false)}
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <form onSubmit={handleGantiPassword} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[16px] text-on-surface-variant">lock</span>
                  Password Baru
                </label>
                <input
                  className="w-full h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all"
                  type="password"
                  placeholder="Minimal 8 karakter"
                  value={formPassword.baru}
                  onChange={(e) => setFormPassword({ ...formPassword, baru: e.target.value })}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[16px] text-on-surface-variant">verified</span>
                  Konfirmasi Password Baru
                </label>
                <input
                  className="w-full h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all"
                  type="password"
                  placeholder="Ulangi password baru"
                  value={formPassword.konfirmasi}
                  onChange={(e) => setFormPassword({ ...formPassword, konfirmasi: e.target.value })}
                />
              </div>

              <p className="text-[11px] text-on-surface-variant">
                Password baru dan konfirmasi wajib minimal 8 karakter dan harus sama.
              </p>

              <div className="flex items-center justify-end gap-3 pt-2 border-t border-surface-container-high">
                <button
                  type="button"
                  className="h-11 px-4 rounded-xl text-on-surface-variant text-sm hover:bg-surface-container-high transition-colors"
                  onClick={() => setShowGantiPassword(false)}
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="h-11 px-6 rounded-xl bg-primary text-on-primary text-sm font-bold shadow-md hover:bg-primary-container active:scale-[0.98] transition-all flex items-center gap-2"
                >
                  <span className="material-symbols-outlined text-[18px]">save</span>
                  Simpan Password
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
