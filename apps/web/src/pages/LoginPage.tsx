import { useState } from "react";
import type { FormEvent } from "react";
import { GalatApi, loginPengurus, loginWarga, type ProfilLogin } from "../lib/api";
import { KONSOL_ADMIN_AKTIF } from "../lib/deploy";

const PHONE_MIN = 10;
const PHONE_MAX = 13;

function onlyDigits(v: string): string {
  return v.replace(/\D/g, "");
}

type PortalRole = "warga" | "rt" | "rw";

/**
 * Peran sesi dari server → portal yang BERHAK dibuka. Tab pilihan pengguna
 * hanya menentukan bentuk isian (no. HP vs surel) — portal yang dimasuki
 * mengikuti peran akun, bukan tab, supaya sesi RW/admin tak mendarat di
 * Portal RT (dan sebaliknya) yang ujungnya ditolak guard `/rt/**`.
 * `super_admin` → `null`: konsol admin dibuka lewat path /admin (§8).
 */
function portalDariPeran(peran: ProfilLogin["peran"]): PortalRole | null {
  if (peran === "warga") return "warga";
  if (peran === "rt_admin") return "rt";
  if (peran === "rw_admin") return "rw";
  return null;
}

const portals: Record<
  PortalRole,
  { title: string; description: string; buttonText: string; icon: string; subtitle: string }
> = {
  warga: {
    title: "Masuk ke Portal Warga",
    description:
      "Akses mandiri tagihan iuran bulanan, pengurusan surat pengantar, dan keterbukaan kas lingkungan Anda.",
    buttonText: "Masuk ke Portal Warga",
    icon: "person",
    subtitle: "Akses Mandiri",
  },
  rt: {
    title: "Masuk ke Dasbor Pengurus RT",
    description:
      "Dasbor operasional Ketua, Sekretaris, dan Bendahara RT: catat iuran warga, verifikasi pengantar surat, & pengumuman.",
    buttonText: "Masuk ke Portal RT",
    icon: "home_work",
    subtitle: "Kelola Warga",
  },
  rw: {
    title: "Masuk ke Portal Pengawas RW",
    description:
      "Monitoring agregat lintas RT se-kelurahan, rekapitulasi kepatuhan kas iuran, dan tata kelola kependudukan terpadu.",
    buttonText: "Masuk ke Portal RW",
    icon: "location_city",
    subtitle: "Agregat Wilayah",
  },
};

const featureHighlights = [
  {
    icon: "account_balance_wallet",
    title: "Transparansi Kas Real-Time",
    badge: "Otomatis",
    desc: "Arus kas iuran bulanan dan kebersihan tercatat transparan dan dapat dipantau oleh setiap KK.",
  },
  {
    icon: "qr_code_2",
    title: "Surat Pengantar Kilat & QR Valid",
    badge: "< 5 Menit",
    desc: "Pengajuan surat domisili & SKTM langsung ditandatangani digital oleh Ketua RT ber-QR code anti-pemalsuan.",
  },
  {
    icon: "shield",
    title: "Masking NIK & Privasi Terjamin",
    badge: "UU PDP 2022",
    desc: "Data Kartu Keluarga dan kontak nomor WhatsApp dienkripsi berlapis untuk perlindungan privasi warga.",
  },
];

interface LoginPageProps {
  onBack?: () => void;
  onLogin?: (role: PortalRole) => void;
  /** Navigasi ke halaman dokumen hukum (Kebijakan Privasi di footer). */
  onNavigate?: (page: string) => void;
  /** Keterangan sesi (mis. "Sesi berakhir…") yang tampil sekali saat dibuka. */
  pesanAwal?: string | null;
}

export function LoginPage({ onBack, onLogin, onNavigate, pesanAwal }: LoginPageProps) {
  const [role, setRole] = useState<PortalRole>("rw");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [galat, setGalat] = useState<string | null>(pesanAwal ?? null);

  const config = portals[role];
  const passwordValid = password.length >= 8;
  // Warga masuk dengan no. HP; pengurus (RT/RW) masuk dengan surel.
  const identifierValid =
    role === "warga" ? phone.length >= PHONE_MIN : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  function handlePasswordHint() {
    if (!password) return { icon: "info", text: "Minimal 8 karakter", style: "" };
    if (passwordValid)
      return {
        icon: "check_circle",
        text: "Sandi memenuhi syarat minimal (≥ 8 karakter)",
        style: "bg-secondary-container/50 text-on-secondary-container font-semibold",
      };
    return {
      icon: "error",
      text: `Masih kurang ${8 - password.length} karakter lagi`,
      style: "bg-error-container text-on-error-container font-medium",
    };
  }

  const hint = handlePasswordHint();

  /** Seberjaya navigasi — dipakai sukses API maupun fallback mode demo. */
  function masuk(target: PortalRole) {
    setSubmitted(true);
    setTimeout(() => {
      setSubmitted(false);
      onLogin?.(target);
    }, 700);
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!identifierValid || !passwordValid) return;
    setSubmitting(true);
    setGalat(null);
    try {
      const profil =
        role === "warga" ? await loginWarga(phone, password) : await loginPengurus(email, password);
      setSubmitting(false);
      // Portal yang dimasuki mengikuti PERAN SESI server — tab hanya menentukan
      // bentuk isian. Ini menutup lubang: sesi rw_admin/super_admin/warga yang
      // lolos login di tab "Pengurus RT" lalu ditolak guard `/rt/**` saat menyimpan.
      const portalHasil = portalDariPeran(profil.peran);
      if (!portalHasil) {
        // Akun platform (§8) — konsol admin hanya lewat path /admin. Pada build
        // publik (GitHub Pages) konsol dinonaktifkan sehingga pesannya jujur.
        setGalat(
          KONSOL_ADMIN_AKTIF
            ? "Akun platform — konsol admin dibuka lewat path /admin, bukan halaman ini."
            : "Konsol sysadmin tidak tersedia pada versi publik.",
        );
        return;
      }
      masuk(portalHasil);
    } catch (err) {
      setSubmitting(false);
      if (err instanceof GalatApi && err.code === "OFFLINE") {
        // Backend tidak sedang menyala → portal dibuka mode demo (data seed di
        // memori). Keputusan sengaja transparan di konsol, bukan menyamar sukses.
        console.info("[SIWARGA] backend OFFLINE — masuk mode demo");
        masuk(role);
        return;
      }
      setGalat(
        err instanceof GalatApi
          ? err.message
          : "Gagal masuk. Periksa data Anda lalu coba lagi.",
      );
    }
  }

  return (
    <div className="min-h-dvh flex flex-col bg-background font-body-md text-on-surface antialiased selection:bg-secondary-container selection:text-on-secondary-container">
      {/* Header */}
      <header className="w-full border-b border-surface-container/80 bg-surface-container-lowest/80 backdrop-blur-md sticky top-0 z-40 transition-all">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-18 py-3.5 flex items-center justify-between">
          <button
            type="button"
            aria-label="Kembali ke beranda"
            className="flex items-center gap-3 group focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-xl transition-transform active:scale-95"
            onClick={() => onBack?.()}
          >
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-primary to-secondary flex items-center justify-center text-on-primary shadow-md shadow-primary/20 group-hover:scale-105 transition-transform">
              <span className="material-symbols-outlined text-[22px]">
                apartment
              </span>
            </div>
            <div className="flex flex-col text-left">
              <span className="font-bold text-lg text-primary tracking-tight leading-none">
                SIWARGA
              </span>
              <span className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider mt-0.5">
                Civic Platform
              </span>
            </div>
          </button>
          <div className="flex items-center gap-3 sm:gap-4">
            <span
              aria-disabled="true"
              className="hidden sm:inline-flex items-center gap-1.5 text-xs font-semibold text-on-surface-variant/70 py-1.5 px-3 rounded-full cursor-not-allowed select-none opacity-75"
              title="Belum tersedia"
            >
              <span className="material-symbols-outlined text-[16px] text-secondary/70">
                help_outline
              </span>
              Butuh Bantuan?
            </span>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-on-surface-variant hover:text-primary transition-all py-2 px-3.5 rounded-xl hover:bg-surface-container-low active:scale-95 group"
              onClick={onBack}
            >
              <span className="material-symbols-outlined text-[18px] transition-transform group-hover:-translate-x-1">
                arrow_back
              </span>
              Kembali ke Beranda
            </button>
          </div>
        </div>
      </header>

      {/* Main Split-Screen */}
      <main className="w-full flex-1 flex flex-col lg:flex-row relative">
        {/* LEFT PANEL: Hero */}
        <section className="lg:w-[46%] xl:w-[48%] bg-gradient-to-br from-[#003d22] via-[#005b34] to-[#0f4628] text-white relative p-8 sm:p-12 lg:p-14 flex flex-col justify-between overflow-hidden shrink-0">
          <div className="absolute -top-32 -left-32 w-96 h-96 bg-primary-fixed/20 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute bottom-0 right-0 w-[480px] h-[480px] bg-secondary-container/15 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute inset-0 bg-[radial-gradient(#9cf6bc_1px,transparent_1px)] [background-size:24px_24px] opacity-10 pointer-events-none" />

          <div className="relative z-10">
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/10 backdrop-blur-md border border-white/15 text-xs font-medium text-primary-fixed mb-6 shadow-sm">
              <span className="w-2 h-2 rounded-full bg-secondary-fixed animate-pulse" />
              Sistem Tata Kelola RT &amp; RW Digital Nasional
            </div>
            <h2 className="text-3xl sm:text-4xl lg:text-[40px] font-extrabold tracking-tight leading-[1.18] text-white">
              Satu Akses Digital untuk Rukun Warga yang{" "}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary-fixed to-secondary-fixed">
                Berdaya &amp; Transparan
              </span>
            </h2>
            <p className="mt-4 text-emerald-100/85 text-sm sm:text-base leading-relaxed max-w-lg">
              Transformasi tata kelola pemukiman modern: keterbukaan kas rukun
              warga, pengurusan administrasi warga kilat, serta kepatuhan
              perlindungan data yang terstandarisasi.
            </p>
          </div>

          <div className="relative z-10 my-8 sm:my-10 space-y-3.5 max-w-lg">
            {featureHighlights.map((f) => (
              <div
                key={f.title}
                className="p-3.5 sm:p-4 rounded-2xl bg-white/10 backdrop-blur-md border border-white/15 hover:bg-white/[0.14] transition-all duration-300 flex items-start gap-3.5 group"
              >
                <div className="w-10 h-10 rounded-xl bg-primary-fixed/20 border border-primary-fixed/30 text-primary-fixed flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                  <span className="material-symbols-outlined text-[22px]">
                    {f.icon}
                  </span>
                </div>
                <div className="min-w-0">
                  <h3 className="font-bold text-sm text-white flex items-center gap-2">
                    {f.title}
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-secondary-container/20 text-secondary-fixed font-semibold">
                      {f.badge}
                    </span>
                  </h3>
                  <p className="text-xs text-emerald-100/75 mt-0.5 leading-relaxed">
                    {f.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>

          <div className="relative z-10 pt-4 border-t border-white/15 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex -space-x-2">
                <div className="w-8 h-8 rounded-full border-2 border-[#005b34] bg-emerald-100 text-[#005b34] font-bold text-[11px] flex items-center justify-center">
                  RT
                </div>
                <div className="w-8 h-8 rounded-full border-2 border-[#005b34] bg-emerald-200 text-[#005b34] font-bold text-[11px] flex items-center justify-center">
                  RW
                </div>
                <div className="w-8 h-8 rounded-full border-2 border-[#005b34] bg-primary-fixed text-[#002110] font-bold text-[11px] flex items-center justify-center">
                  +
                </div>
              </div>
              <div>
                <div className="text-xs font-bold text-white">
                  1.487+ Lingkungan Aktif
                </div>
                <div className="text-[11px] text-emerald-200/70">
                  Tersebar di 118 Kota &amp; Kabupaten
                </div>
              </div>
            </div>
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 text-[11px] font-semibold text-emerald-100 border border-white/15">
              <span className="material-symbols-outlined text-[14px] text-secondary-fixed">
                verified
              </span>
              96,4% Iuran Tepat Waktu
            </div>
          </div>
        </section>

        {/* RIGHT PANEL: Auth Form */}
        <section className="lg:w-[54%] xl:w-[52%] flex-1 flex flex-col justify-center items-center p-6 sm:p-10 lg:p-12 relative bg-surface">
          <div className="absolute top-10 right-10 w-72 h-72 bg-secondary-container/20 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute bottom-10 left-10 w-80 h-80 bg-primary-fixed/15 rounded-full blur-3xl pointer-events-none" />

          <div className="w-full max-w-lg relative z-10">
            {/* Header */}
            <div className="mb-6">
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-surface-container-low rounded-full border border-surface-container">
                  <span className="w-2 h-2 rounded-full bg-secondary animate-pulse" />
                  <span className="text-[11px] font-bold text-on-surface-variant tracking-wider uppercase">
                    Gerbang Masuk Terpadu
                  </span>
                </div>
                <span className="text-[11px] font-semibold text-on-surface-variant flex items-center gap-1 bg-surface-container-low px-2.5 py-1 rounded-full">
                  <span className="material-symbols-outlined text-[13px] text-secondary">
                    lock
                  </span>
                  256-bit TLS Enkripsi
                </span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-on-surface tracking-tight">
                {config.title}
              </h1>
              <p className="text-xs sm:text-sm text-on-surface-variant mt-1.5 leading-normal">
                {config.description}
              </p>
            </div>

            {/* Role Switcher */}
            <div className="mb-6">
              <label className="block text-xs font-bold text-on-surface mb-2">
                Pilih Peran / Akses Portal:
              </label>
              <div
                className="grid grid-cols-3 gap-2.5 p-1.5 bg-surface-container-low rounded-2xl border border-surface-container"
                role="tablist"
              >
                {(
                  [
                    { key: "warga" as PortalRole, label: "Warga", sub: "Akses Mandiri" },
                    { key: "rt" as PortalRole, label: "Pengurus RT", sub: "Kelola Warga" },
                    { key: "rw" as PortalRole, label: "Pengurus RW", sub: "Agregat Wilayah" },
                  ] as const
                ).map((tab) => {
                  const active = role === tab.key;
                  return (
                    <button
                      key={tab.key}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      className={`flex flex-col items-center justify-center text-center p-2.5 rounded-xl transition-all duration-200 font-medium group border ${
                        active
                          ? "bg-surface-container-lowest text-primary shadow-sm border-primary/20"
                          : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container/60 border-transparent"
                      }`}
                      onClick={() => setRole(tab.key)}
                    >
                      <div
                        className={`w-8 h-8 rounded-lg flex items-center justify-center mb-1 transition-colors ${
                          active
                            ? "bg-primary-fixed/30 text-primary"
                            : "bg-surface-container text-on-surface-variant"
                        }`}
                      >
                        <span className="material-symbols-outlined text-[18px]">
                          {portals[tab.key].icon}
                        </span>
                      </div>
                      <div
                        className={`font-bold text-[12px] leading-tight ${
                          active ? "text-primary" : "text-on-surface-variant"
                        }`}
                      >
                        {tab.label}
                      </div>
                      <div className="text-[10px] text-on-surface-variant font-normal mt-0.5">
                        {tab.sub}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Form Card */}
            <div className="bg-surface-container-lowest rounded-3xl p-6 sm:p-7 shadow-[0_15px_40px_-15px_rgba(11,28,48,0.07)] border border-surface-container/80">
              <form className="space-y-4" onSubmit={handleSubmit}>
                {/* Identifier: no. HP (warga) / surel (pengurus) */}
                {role === "warga" ? (
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label
                        className="text-xs font-bold text-on-surface"
                        htmlFor="input-phone"
                      >
                        Nomor WhatsApp Terdaftar
                      </label>
                      <span className="text-[11px] text-on-surface-variant font-medium">
                        Terhubung dengan KK / SK RT
                      </span>
                    </div>
                    <div className="relative flex items-center bg-surface-container-low rounded-xl border border-surface-container focus-within:border-primary focus-within:bg-surface-container-lowest focus-within:ring-2 focus-within:ring-primary/20 transition-all">
                      <div className="flex items-center pl-3.5 pr-2.5 py-3 pointer-events-none select-none text-on-surface-variant">
                        <span className="text-xs font-bold text-on-surface mr-1.5">
                          +62
                        </span>
                        <span className="w-px h-5 bg-outline-variant/60" />
                      </div>
                      <input
                        autoComplete="tel"
                        className="w-full py-3 pr-10 bg-transparent text-sm text-on-surface placeholder:text-outline/70 focus:outline-none font-medium"
                        id="input-phone"
                        name="phone"
                        placeholder="81234567890"
                        required
                        type="tel"
                        inputMode="numeric"
                        maxLength={PHONE_MAX}
                        value={phone}
                        onChange={(e) => setPhone(onlyDigits(e.target.value))}
                      />
                      <div className="pr-3 flex items-center text-on-surface-variant pointer-events-none">
                        <span className="material-symbols-outlined text-[20px] text-secondary">
                          chat
                        </span>
                      </div>
                    </div>
                    <p className="text-[11px] text-on-surface-variant mt-1">
                      Gunakan nomor ponsel aktif yang telah diverifikasi oleh
                      Ketua RT.
                    </p>
                  </div>
                ) : (
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label
                        className="text-xs font-bold text-on-surface"
                        htmlFor="input-email"
                      >
                        Surel Pengurus
                      </label>
                      <span className="text-[11px] text-on-surface-variant font-medium">
                        Diberikan Ketua RW
                      </span>
                    </div>
                    <div className="relative flex items-center bg-surface-container-low rounded-xl border border-surface-container focus-within:border-primary focus-within:bg-surface-container-lowest focus-within:ring-2 focus-within:ring-primary/20 transition-all">
                      <div className="pl-3.5 pr-2 pointer-events-none text-outline flex items-center">
                        <span className="material-symbols-outlined text-[20px]">
                          mail
                        </span>
                      </div>
                      <input
                        autoComplete="username"
                        className="w-full py-3 pr-10 bg-transparent text-sm text-on-surface placeholder:text-outline/70 focus:outline-none font-medium"
                        id="input-email"
                        name="email"
                        placeholder="nama@siwarga.id"
                        required
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                      />
                    </div>
                    <p className="text-[11px] text-on-surface-variant mt-1">
                      Akun pengurus RT/RW memakai surel, bukan nomor ponsel.
                    </p>
                  </div>
                )}

                {/* Password Input */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label
                      className="text-xs font-bold text-on-surface"
                      htmlFor="input-password"
                    >
                      Kata Sandi
                    </label>
                    <span
                      aria-disabled="true"
                      className="text-xs font-bold text-on-surface-variant/70 flex items-center gap-0.5 cursor-not-allowed select-none"
                      title="Belum tersedia"
                    >
                      Lupa kata sandi?
                    </span>
                  </div>
                  <div className="relative flex items-center bg-surface-container-low rounded-xl border border-surface-container focus-within:border-primary focus-within:bg-surface-container-lowest focus-within:ring-2 focus-within:ring-primary/20 transition-all">
                    <div className="pl-3.5 pr-2 pointer-events-none text-outline flex items-center">
                      <span className="material-symbols-outlined text-[20px]">
                        key
                      </span>
                    </div>
                    <input
                      autoComplete="current-password"
                      className="w-full py-3 pr-10 bg-transparent text-sm text-on-surface placeholder:text-outline/70 focus:outline-none font-medium"
                      id="input-password"
                      name="password"
                      placeholder="Masukkan kata sandi akun Anda"
                      required
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                    <button
                      aria-label="Tampilkan atau sembunyikan kata sandi"
                      className="absolute right-3 p-1 text-outline hover:text-on-surface rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                    >
                      <span className="material-symbols-outlined text-[20px]">
                        {showPassword ? "visibility_off" : "visibility"}
                      </span>
                    </button>
                  </div>
                  <div className="mt-1.5 flex items-center justify-between">
                    <div
                      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-surface-container text-[11px] text-on-surface-variant transition-colors ${
                        hint.style || ""
                      }`}
                    >
                      <span className="material-symbols-outlined text-[13px]">
                        {hint.icon}
                      </span>
                      <span>{hint.text}</span>
                    </div>
                  </div>
                </div>

                {/* Remember Me */}
                <div className="flex items-center justify-between pt-1">
                  <label className="flex items-center gap-2.5 cursor-pointer group select-none">
                    <input
                      className="w-4 h-4 rounded text-primary focus:ring-primary/30 border-outline-variant transition-colors"
                      id="remember-me"
                      name="remember_me"
                      type="checkbox"
                      checked={remember}
                      onChange={(e) => setRemember(e.target.checked)}
                    />
                    <span className="text-xs font-medium text-on-surface group-hover:text-primary transition-colors">
                      Ingat saya di perangkat ini
                    </span>
                  </label>
                </div>

                {/* Galat login (inline — bukan window.alert) */}
                {galat && (
                  <div
                    role="alert"
                    className="flex items-start gap-2 p-3 rounded-xl bg-error-container text-on-error-container text-xs font-semibold leading-relaxed"
                  >
                    <span className="material-symbols-outlined text-[16px] shrink-0 mt-px">
                      error
                    </span>
                    <span>{galat}</span>
                  </div>
                )}

                {/* Submit Button */}
                <button
                  className="w-full mt-2 py-3.5 px-6 rounded-xl bg-gradient-to-r from-[#005b34] to-[#137547] text-on-primary font-bold text-sm flex items-center justify-center gap-2 hover:opacity-95 active:scale-[0.99] transition-all shadow-[0_6px_20px_rgba(0,91,52,0.28)] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary group disabled:opacity-70 disabled:pointer-events-none"
                  type="submit"
                  disabled={submitting}
                >
                  <span>
                    {submitting
                      ? "Memverifikasi Kredensial..."
                      : submitted
                        ? "Otorisasi Berhasil"
                        : config.buttonText}
                  </span>
                  <span className="material-symbols-outlined text-[19px] transition-transform group-hover:translate-x-1">
                    arrow_forward
                  </span>
                </button>
              </form>
            </div>

            {/* Compliance Card */}
            <div className="mt-5 space-y-3">
              <div className="p-3.5 rounded-2xl bg-surface-container-low border border-surface-container flex items-start gap-3">
                <div className="w-7 h-7 rounded-full bg-surface-container-highest text-secondary flex items-center justify-center shrink-0 mt-0.5">
                  <span className="material-symbols-outlined text-[16px]">
                    verified
                  </span>
                </div>
                <div className="flex-1">
                  <p className="text-xs font-bold text-on-surface">
                    Kepatuhan UU Perlindungan Data Pribadi (UU PDP No. 27/2022)
                  </p>
                  <p className="text-[11px] text-on-surface-variant mt-0.5">
                    Setiap sesi diaudit dengan Enkripsi End-to-End &amp; hash
                    kriptografis SHA-256 tanpa penyimpanan teks terbuka.
                  </p>
                </div>
              </div>

              <div className="p-3 rounded-2xl bg-surface-container-lowest border border-surface-container/70 flex flex-col sm:flex-row items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-on-surface-variant text-xs">
                  <span className="material-symbols-outlined text-[16px] text-primary">
                    info
                  </span>
                  Belum memiliki akun warga?
                </div>
                <span
                  aria-disabled="true"
                  className="text-xs font-bold text-on-surface-variant/70 transition-colors inline-flex items-center gap-1 group cursor-not-allowed select-none"
                  title="Belum tersedia"
                >
                  Panduan Aktivasi RT
                  <span className="material-symbols-outlined text-[14px]">
                    chevron_right
                  </span>
                </span>
              </div>

              <div className="text-center pt-1">
                <p className="text-xs text-on-surface-variant">
                  Ingin menerapkan SIWARGA di Rukun Tetangga Anda?
                  <span
                    aria-disabled="true"
                    className="font-bold text-on-surface-variant/70 ml-1 inline-flex items-center gap-0.5 cursor-not-allowed select-none"
                    title="Belum tersedia"
                  >
                    Daftarkan Tenant RT Mandiri
                    <span className="material-symbols-outlined text-[14px]">
                      arrow_forward
                    </span>
                  </span>
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="w-full py-4 border-t border-surface-container bg-surface-container-lowest text-xs text-on-surface-variant">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div />
          <nav className="flex items-center flex-wrap gap-4 sm:gap-6 font-medium">
            <span
              aria-disabled="true"
              className="inline-flex items-center gap-1 cursor-not-allowed select-none opacity-70"
              title="Belum tersedia"
            >
              <span className="material-symbols-outlined text-[14px]">
                lock
              </span>
              Keamanan Enkripsi
            </span>
            <span
              aria-disabled="true"
              className="inline-flex items-center gap-1 cursor-not-allowed select-none opacity-70"
              title="Belum tersedia"
            >
              <span className="material-symbols-outlined text-[14px]">
                contact_support
              </span>
              Pusat Bantuan
            </span>
            <button
              type="button"
              className="hover:text-primary transition-colors inline-flex items-center gap-1"
              onClick={() => onNavigate?.("kebijakan-privasi")}
            >
              <span className="material-symbols-outlined text-[14px]">
                policy
              </span>
              Kebijakan Privasi
            </button>
          </nav>
        </div>
      </footer>
    </div>
  );
}
