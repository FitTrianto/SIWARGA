import { ReactNode, useState, useRef, useEffect } from "react";
import { tenant } from "../../lib/tenant";
import { type ProfilLogin } from "../../lib/api";

interface PortalWargaLayoutProps {
  children: ReactNode;
  currentPage: string;
  onNavigate?: (page: string) => void;
  onLogout?: () => void;
  /** Profil login sesi (Okt 2026) — nama di header = nama akun yang login, bukan hardcode. */
  profil?: ProfilLogin | null;
}

const navItems = [
  { key: "portal-warga", label: "Beranda" },
  { key: "data-keluarga", label: "Data Keluarga" },
  { key: "iuran-tagihan", label: "Iuran & Tagihan" },
  { key: "pengajuan-surat", label: "Pengajuan Surat" },
  { key: "riwayat-aktivitas", label: "Riwayat Aktivitas" },
];

export function PortalWargaLayout({ children, currentPage, onNavigate, onLogout, profil }: PortalWargaLayoutProps) {
  const [showProfile, setShowProfile] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [pwError, setPwError] = useState("");
  const [pwSuccess, setPwSuccess] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);

  // Nama dari DATA LOGIN (respons login warga selalu membawa `nama`) — nama
  // hardcode "Bambang Supriyanto" dihapus: dua nomor login salah nama (Okt 2026).
  const namaSesi = profil?.nama?.trim() || profil?.email?.trim() || "Akun Warga";
  const adaProfil = !!profil?.nama?.trim();

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setShowProfile(false);
      }
    }
    if (showProfile) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handlePwClose);
  }, [showProfile]);

  function handlePwClose() {
    setShowPasswordModal(false);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setPwError("");
    setPwSuccess(false);
  }

  function handlePwSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPwError("");
    if (!currentPassword) { setPwError("Sandi lama wajib diisi"); return; }
    if (currentPassword.length < 8) { setPwError("Sandi lama minimal 8 karakter"); return; }
    if (!newPassword) { setPwError("Sandi baru wajib diisi"); return; }
    if (newPassword.length < 8) { setPwError("Sandi baru minimal 8 karakter"); return; }
    if (newPassword === currentPassword) { setPwError("Sandi baru tidak boleh sama dengan sandi lama"); return; }
    if (newPassword !== confirmPassword) { setPwError("Konfirmasi sandi baru tidak cocok"); return; }
    setPwSuccess(true);
    setTimeout(() => { handlePwClose(); }, 1500);
  }

  return (
    <div className="min-h-dvh bg-background font-body-md text-on-surface antialiased">
      <a
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-70 focus:bg-primary focus:text-on-primary focus:px-4 focus:py-2.5 focus:rounded-xl focus:text-sm focus:font-bold focus:shadow-lg"
        href="#konten-utama"
      >
        Lewati ke konten utama
      </a>
      {/* Header */}
      <header className="fixed top-0 left-0 w-full z-50 bg-surface-container-lowest/95 backdrop-blur-xl shadow-[0_1px_8px_rgba(15,81,50,0.04)]">
        <div className="h-20 max-w-7xl mx-auto px-4 lg:px-12 flex items-center justify-between gap-6">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <div className="flex flex-col">
                <button onClick={onLogout} className="cursor-pointer">
                  <span className="font-extrabold text-lg text-primary tracking-tight leading-none">SIWARGA</span>
                </button>
                <span className="text-[11px] font-bold text-on-surface-variant uppercase tracking-wider mt-1">Portal Warga Digital</span>
              </div>
            </div>
            <div className="hidden xl:flex items-center gap-2 px-2 py-1 rounded-full bg-surface-container-low text-on-surface-variant text-xs">
              <span className="material-symbols-outlined text-primary text-[16px]">location_city</span>
              {tenant.perumahan}
            </div>
          </div>

          <nav className="hidden lg:flex items-center gap-1 text-sm font-semibold">
            {navItems.map((item) => (
              <button type="button"
                key={item.key}
                className={`px-4 py-2 rounded-lg transition-all ${
                  currentPage === item.key
                    ? "bg-primary-container text-on-primary font-semibold"
                    : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low"
                }`}
                onClick={() => {onNavigate?.(item.key)}}>
                {item.label}
              </button>
            ))}
          </nav>

          {/* Profile Dropdown */}
          <div className="relative" ref={profileRef}>
            <button
              className="flex items-center gap-2 pl-2 pr-1 py-1 rounded-xl hover:bg-surface-container-low transition-colors cursor-pointer"
              onClick={() => setShowProfile(!showProfile)}
            >
              <div className="hidden sm:flex flex-col text-right">
                <span className="text-sm font-semibold text-on-surface leading-tight">{namaSesi}</span>
                <span className="text-[11px] font-bold text-on-primary-fixed-variant bg-primary-fixed px-2 py-0.5 rounded-full inline-block mt-0.5 self-end">{adaProfil ? `Warga ${tenant.rtFull}` : "Kepala Keluarga"}</span>
              </div>
              <div className="w-9 h-9 rounded-full bg-primary flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-on-primary text-[18px]">person</span>
              </div>
              <span className="material-symbols-outlined text-on-surface-variant text-[18px] hidden sm:block">expand_more</span>
            </button>

            {showProfile && (
              <div className="absolute right-0 top-full mt-2 w-72 bg-surface-container-lowest rounded-xl shadow-[0_8px_30px_rgba(0,0,0,0.12)] border border-surface-container-high py-1 z-50">
                {/* User Info */}
                <div className="px-4 py-3 border-b border-surface-container-high">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center shrink-0">
                      <span className="material-symbols-outlined text-on-primary text-[20px]">person</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-sm font-bold text-on-surface">{namaSesi}</span>
                      <span className="text-[11px] text-on-surface-variant">{adaProfil ? "Akun Portal Warga" : "Kepala Keluarga • Blok B4 No. 12"}</span>
                    </div>
                  </div>
                  {/* Detail KK (blok/NIK/aktif-sejak) adalah data demo per-orang —
                      disembunyikan bila ada profil login, karena angkanya tidak
                      dijamin cocok dengan akun yang masuk (kejujuran tampilan). */}
                  {!adaProfil && (
                    <div className="mt-3 flex items-center gap-2 text-xs text-on-surface-variant">
                      <span className="material-symbols-outlined text-[14px] text-secondary">check_circle</span>
                      <span>Aktif sejak <strong className="text-on-surface font-semibold">1 Januari 2024</strong></span>
                    </div>
                  )}
                  {!adaProfil && (
                    <div className="mt-1 flex items-center gap-2 text-xs text-on-surface-variant">
                      <span className="material-symbols-outlined text-[14px] text-secondary">shield_person</span>
                      <span>NIK: <strong className="text-on-surface font-mono font-semibold">3171-xxxx-xxxx-0004</strong></span>
                    </div>
                  )}
                </div>

                {/* Menu Items */}
                <div className="py-1">
                  <button
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-on-surface hover:bg-surface-container-low transition-colors"
                    onClick={() => { setShowProfile(false); setShowPasswordModal(true); }}
                  >
                    <span className="material-symbols-outlined text-[20px] text-on-surface-variant">lock_reset</span>
                    Ubah Kata Sandi
                  </button>
                  <button
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-on-surface hover:bg-surface-container-low transition-colors"
                    onClick={() => { setShowProfile(false); onNavigate?.("riwayat-aktivitas"); }}
                  >
                    <span className="material-symbols-outlined text-[20px] text-on-surface-variant">history</span>
                    Riwayat Aktivitas
                  </button>
                  <button
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-error hover:bg-error-container/30 transition-colors"
                    onClick={() => { setShowProfile(false); onLogout?.(); }}
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

      {/* Modal Ubah Kata Sandi */}
      {showPasswordModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-inverse-surface/40 backdrop-blur-sm p-4">
          <div className="bg-surface-container-lowest rounded-2xl max-w-md w-full p-6 shadow-xl">
            <div className="flex items-center justify-between pb-3 mb-3">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[24px]">lock_reset</span>
                <h3 className="text-base font-bold text-on-surface">Ubah Kata Sandi</h3>
              </div>
              <button className="p-1 rounded-full text-on-surface-variant hover:bg-surface-container" onClick={handlePwClose}>
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            {pwSuccess ? (
              <div className="flex flex-col items-center py-6 gap-3">
                <div className="w-14 h-14 rounded-full bg-secondary-container flex items-center justify-center">
                  <span className="material-symbols-outlined text-[32px] text-on-secondary-container">check_circle</span>
                </div>
                <p className="text-sm font-semibold text-on-surface">Kata sandi berhasil diperbarui</p>
                <p className="text-xs text-on-surface-variant text-center">Gunakan sandi baru Anda untuk login berikutnya</p>
              </div>
            ) : (
              <form className="flex flex-col gap-4" onSubmit={handlePwSubmit}>
                {/* Sandi Lama */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-on-surface">Kata Sandi Lama *</label>
                  <div className="relative">
                    <input
                      className="w-full h-11 px-4 pr-10 rounded-xl bg-surface-container-low text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary"
                      type={showCurrentPw ? "text" : "password"}
                      placeholder="Masukkan sandi lama"
                      value={currentPassword}
                      onChange={(e) => { setCurrentPassword(e.target.value); setPwError(""); }}
                    />
                    <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant" onClick={() => setShowCurrentPw(!showCurrentPw)}>
                      <span className="material-symbols-outlined text-[20px]">{showCurrentPw ? "visibility_off" : "visibility"}</span>
                    </button>
                  </div>
                </div>

                {/* Sandi Baru */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-on-surface">Kata Sandi Baru *</label>
                  <div className="relative">
                    <input
                      className="w-full h-11 px-4 pr-10 rounded-xl bg-surface-container-low text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary"
                      type={showNewPw ? "text" : "password"}
                      placeholder="Minimal 8 karakter"
                      value={newPassword}
                      onChange={(e) => { setNewPassword(e.target.value); setPwError(""); }}
                    />
                    <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant" onClick={() => setShowNewPw(!showNewPw)}>
                      <span className="material-symbols-outlined text-[20px]">{showNewPw ? "visibility_off" : "visibility"}</span>
                    </button>
                  </div>
                  {newPassword && (
                    <div className="flex items-center gap-2 mt-0.5">
                      <div className={`h-1 flex-1 rounded-full ${newPassword.length >= 8 ? "bg-secondary" : "bg-error"}`} />
                      <span className={`text-[11px] ${newPassword.length >= 8 ? "text-secondary" : "text-error"}`}>
                        {newPassword.length < 8 ? `Kurang ${8 - newPassword.length} karakter` : "Memenuhi syarat"}
                      </span>
                    </div>
                  )}
                </div>

                {/* Konfirmasi Sandi Baru */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-on-surface">Konfirmasi Kata Sandi Baru *</label>
                  <input
                    className="w-full h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary"
                    type="password"
                    placeholder="Ulangi sandi baru"
                    value={confirmPassword}
                    onChange={(e) => { setConfirmPassword(e.target.value); setPwError(""); }}
                  />
                  {confirmPassword && confirmPassword !== newPassword && (
                    <span className="text-[11px] text-error">Konfirmasi tidak cocok</span>
                  )}
                </div>

                {pwError && (
                  <div className="flex items-center gap-2 p-3 rounded-xl bg-error-container text-on-error-container text-xs font-medium">
                    <span className="material-symbols-outlined text-[16px]">error</span>
                    {pwError}
                  </div>
                )}

                <div className="flex gap-3 pt-2">
                  <button className="flex-1 h-11 rounded-xl bg-surface-container-high text-on-surface text-sm font-semibold hover:bg-surface-container transition-colors" type="button" onClick={handlePwClose}>
                    Batal
                  </button>
                  <button className="flex-1 h-11 rounded-xl bg-primary text-on-primary text-sm font-bold shadow-md hover:bg-primary-container transition-colors" type="submit">
                    Simpan Sandi Baru
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      <main id="konten-utama" tabIndex={-1} className="w-full pt-28 bg-background min-h-dvh">
        {children}
      </main>

      <footer className="w-full bg-surface-container-lowest mt-10">
        <div className="max-w-7xl mx-auto px-4 lg:px-12 py-6 flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-on-surface-variant">
          <div className="flex items-center gap-2">
            <span className="text-base text-primary font-bold">SIWARGA</span>
            <span>&copy; 2024 Sekretariat {tenant.rwFull} {tenant.perumahanSingkat}. Seluruh hak cipta dilindungi undang-undang.</span>
          </div>
          <div className="flex items-center gap-4">
            <span
              aria-disabled="true"
              className="cursor-not-allowed select-none opacity-60"
              title="Belum tersedia"
            >
              Pusat Bantuan RT
            </span>
            <span
              aria-disabled="true"
              className="cursor-not-allowed select-none opacity-60"
              title="Belum tersedia"
            >
              Kontak Pengurus
            </span>
            <button
              type="button"
              className="hover:text-primary transition-colors"
              onClick={() => onNavigate?.("kebijakan-privasi")}
            >
              Kebijakan Privasi
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
