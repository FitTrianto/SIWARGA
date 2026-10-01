import { tenant } from "../../lib/tenant";
import { KontenLanding } from "../../lib/adminData";

const trustBadges = [
  { icon: "gavel", label: "UU PDP 27/2022" },
  { icon: "security", label: "Enkripsi 256-Bit" },
  { icon: "cloud_done", label: "Cloud Domestik" },
  { icon: "qr_code_2", label: "TTE Digital QR" },
];

export function HeroSection({ konten }: { konten?: KontenLanding }) {
  // Konten default sama dengan seed admin — tampilan identik tanpa editan.
  const hero = konten?.hero;
  return (
    <section className="relative w-full py-16 lg:py-24 overflow-hidden mesh-gradient">
      <div className="hero-glow-1 -top-24 left-1/4" />
      <div className="hero-glow-2 top-1/3 right-10" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-8 items-center">
          {/* Left Hero Content */}
          <div className="lg:col-span-7 flex flex-col items-start gap-5">
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/90 border border-emerald-200/80 shadow-[0_2px_8px_rgba(0,0,0,0.04)] backdrop-blur-md">
              <span className="material-symbols-outlined text-emerald-700 text-[18px]">
                verified
              </span>
              <span className="text-xs sm:text-sm font-semibold text-emerald-900 tracking-tight">
                {hero?.badge ?? "Pelayanan Rukun Tetangga & Rukun Warga"}
              </span>
            </div>

            <h1 className="text-4xl sm:text-5xl lg:text-[54px] font-extrabold text-slate-900 leading-[1.15] tracking-tight text-balance">
              {hero?.judulAwal ?? "Administrasi RT & RW Jadi Mudah, Cepat, dan"}{" "}
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-emerald-700 to-teal-600">
                {hero?.judulAksen ?? "Transparan."}
              </span>
            </h1>

            <p className="text-base sm:text-lg text-slate-600 leading-relaxed max-w-2xl font-normal">
              {hero?.sub ??
                "Platform digital terpadu untuk warga, pengurus RT/RW, hingga kelurahan. Kelola pembukuan kas otomatis, iuran warga tanpa ribet, surat digital ber-QR code, dan transparansi lingkungan dalam satu genggaman."}
            </p>

            {/* Trust Badges */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 w-full pt-1">
              {trustBadges.map((badge) => (
                <div
                  key={badge.label}
                  className="flex items-center gap-2 bg-white/80 backdrop-blur-sm border border-slate-200/70 px-3 py-2.5 rounded-xl shadow-[0_2px_6px_rgba(0,0,0,0.02)] transition-all hover:border-emerald-300"
                >
                  <div className="w-6 h-6 rounded-lg bg-emerald-50 flex items-center justify-center text-emerald-700 flex-shrink-0">
                    <span className="material-symbols-outlined text-[16px]">
                      {badge.icon}
                    </span>
                  </div>
                  <span className="text-xs font-semibold text-slate-700 truncate">
                    {badge.label}
                  </span>
                </div>
              ))}
            </div>

            {/* CTA Actions */}
            <div className="flex flex-wrap items-center gap-3.5 pt-2 w-full sm:w-auto">
              <a
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2.5 bg-gradient-to-r from-[#005b34] to-[#137547] text-white font-semibold text-base px-7 py-4 rounded-xl shadow-[0_8px_20px_rgba(0,91,52,0.28)] hover:shadow-[0_12px_28px_rgba(0,91,52,0.36)] hover:translate-y-[-2px] active:translate-y-0 transition-all duration-200"
                href="#daftar-sekarang"
              >
                <span>Daftar RT Anda Gratis Sekarang</span>
                <span className="material-symbols-outlined text-[20px]">
                  arrow_forward
                </span>
              </a>
              <a
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2.5 bg-white/90 backdrop-blur-md text-slate-800 font-semibold text-base px-6 py-4 rounded-xl border border-slate-200 shadow-sm hover:bg-slate-50 hover:border-slate-300 hover:translate-y-[-2px] transition-all duration-200"
                href="#kalkulator"
              >
                <span className="material-symbols-outlined text-emerald-700 text-[20px]">
                  calculate
                </span>
                <span>Coba Simulasi Iuran</span>
              </a>
            </div>

            {/* Social Proof */}
            <div className="flex items-center gap-3 pt-3">
              <div className="flex -space-x-2.5 overflow-hidden">
                <div className="inline-block h-8 w-8 rounded-full ring-2 ring-white bg-gradient-to-br from-emerald-600 to-emerald-800 text-white flex items-center justify-center text-[11px] font-bold shadow-sm">
                  RT
                </div>
                <div className="inline-block h-8 w-8 rounded-full ring-2 ring-white bg-gradient-to-br from-teal-500 to-teal-700 text-white flex items-center justify-center text-[11px] font-bold shadow-sm">
                  RW
                </div>
                <div className="inline-block h-8 w-8 rounded-full ring-2 ring-white bg-gradient-to-br from-cyan-600 to-blue-700 text-white flex items-center justify-center text-[11px] font-bold shadow-sm">
                  KL
                </div>
              </div>
              <p className="text-xs sm:text-sm text-slate-600">
                Dipercaya oleh{" "}
                <strong className="text-slate-900 font-bold">
                  1.487+ RT &amp; RW
                </strong>{" "}
                di 34 Provinsi di Indonesia
              </p>
            </div>
          </div>

          {/* Right Hero Mockup */}
          <div className="lg:col-span-5 relative">
            <div className="absolute inset-0 bg-gradient-to-tr from-emerald-400/20 via-teal-300/20 to-sky-300/20 rounded-3xl filter blur-2xl -z-10 transform rotate-1 scale-95" />

            {/* Floating WhatsApp Card */}
            <div className="absolute -top-6 -right-3 sm:-right-6 z-20 bg-white/95 backdrop-blur-md border border-emerald-100 shadow-[0_12px_28px_rgba(0,0,0,0.08)] p-3 rounded-2xl flex items-center gap-3 max-w-[260px] animate-bounce duration-1000 hidden sm:flex">
              <div className="w-9 h-9 rounded-xl bg-emerald-500 text-white flex items-center justify-center flex-shrink-0 shadow-sm">
                <span className="material-symbols-outlined text-[20px]">
                  mark_chat_read
                </span>
              </div>
              <div className="text-left">
                <div className="text-[11px] font-bold text-slate-800 flex items-center gap-1">
                  WhatsApp Gateway
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                </div>
                <div className="text-[10px] text-slate-500 leading-tight">
                  Bukti bayar kas RT terkirim otomatis ke Warga
                </div>
              </div>
            </div>

            {/* Main Mockup Window */}
            <div className="w-full bg-white/95 backdrop-blur-xl rounded-3xl border border-slate-200/80 shadow-[0_20px_50px_rgba(15,23,42,0.08)] p-6 space-y-4 relative">
              {/* Mockup Header */}
              <div className="flex items-center justify-between pb-3.5 border-b border-slate-100">
                <div className="flex items-center gap-3">
                  <div className="w-3.5 h-3.5 rounded-full bg-emerald-500 ring-4 ring-emerald-100" />
                  <div>
                    <span className="text-sm font-bold text-slate-900 block leading-tight">
                      {tenant.label} {tenant.perumahanSingkat}
                    </span>
                    <span className="text-xs text-slate-500">
                      Kel. {tenant.kelurahan}, Kec. {tenant.kecamatan}
                    </span>
                  </div>
                </div>
                <span className="px-2.5 py-1 bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] rounded-full font-bold shadow-xs">
                  Aktif &amp; Terverifikasi
                </span>
              </div>

              {/* Ledger Metrics */}
              <div className="grid grid-cols-2 gap-3.5">
                <div className="bg-gradient-to-br from-emerald-50/60 to-slate-50 p-4 rounded-2xl border border-emerald-100/70 flex flex-col justify-between">
                  <span className="text-xs text-slate-600 font-semibold flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[16px] text-emerald-700">
                      account_balance_wallet
                    </span>
                    Saldo Kas Berjalan
                  </span>
                  <span className="text-xl sm:text-2xl text-slate-900 font-extrabold tracking-tight mt-2">
                    Rp 15.450.000
                  </span>
                  <span className="font-mono text-[11px] text-emerald-700 font-semibold mt-1">
                    ↑ +Rp 2.150.000 bulan ini
                  </span>
                </div>
                <div className="bg-gradient-to-br from-slate-50 to-teal-50/50 p-4 rounded-2xl border border-slate-200/60 flex flex-col justify-between">
                  <span className="text-xs text-slate-600 font-semibold flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[16px] text-teal-700">
                      groups
                    </span>
                    Kepatuhan Warga
                  </span>
                  <span className="text-xl sm:text-2xl text-slate-900 font-extrabold tracking-tight mt-2">
                    82.7%
                  </span>
                  <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden mt-2">
                    <div
                      className="bg-gradient-to-r from-emerald-500 to-teal-500 h-full rounded-full"
                      style={{ width: "82.7%" }}
                    />
                  </div>
                </div>
              </div>

              {/* Transaction Stream */}
              <div className="bg-slate-50/80 p-3.5 rounded-2xl border border-slate-100 space-y-2.5">
                <div className="flex items-center justify-between text-slate-700 px-1">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Mutasi Terakhir Warga
                  </span>
                  <span className="font-mono text-[11px] text-slate-400 bg-white px-2 py-0.5 rounded border border-slate-200">
                    Audit-Log #9182
                  </span>
                </div>
                <div className="bg-white p-3 rounded-xl border border-slate-200/70 shadow-sm flex items-center justify-between transition-all hover:border-emerald-300">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-800 flex items-center justify-center font-bold">
                      <span className="material-symbols-outlined text-[18px]">
                        check
                      </span>
                    </div>
                    <div>
                      <div className="text-xs sm:text-sm font-bold text-slate-800">
                        Bambang Supriyanto (Blok B4)
                      </div>
                      <div className="flex items-center gap-1 font-mono text-[11px] text-slate-500">
                        <span>NIK: 3171••••••••0004</span>
                        <span className="material-symbols-outlined text-[13px] text-slate-400">
                          lock
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-xs sm:text-sm font-bold text-emerald-700">
                      +Rp 150.000
                    </span>
                    <span className="text-[10px] block px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full font-semibold mt-0.5">
                      Lunas Q1
                    </span>
                  </div>
                </div>
                <div className="bg-white p-3 rounded-xl border border-slate-200/70 shadow-sm flex items-center justify-between transition-all hover:border-emerald-300">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-teal-100 text-teal-800 flex items-center justify-center">
                      <span className="material-symbols-outlined text-[18px]">
                        description
                      </span>
                    </div>
                    <div>
                      <div className="text-xs sm:text-sm font-bold text-slate-800">
                        Surat Pengantar Domisili
                      </div>
                      <div className="text-[11px] text-slate-500">
                        Siti Rahma (Blok A-04)
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-50 text-emerald-800 border border-emerald-200 font-semibold text-[10px] rounded-full">
                      <span className="material-symbols-outlined text-[13px]">
                        qr_code
                      </span>{" "}
                      TTE Valid
                    </span>
                  </div>
                </div>
              </div>

              {/* WhatsApp Toast */}
              <div className="p-3 rounded-xl bg-gradient-to-r from-[#005b34] to-[#137547] text-white flex items-center justify-between shadow-md">
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-lg bg-white/20 flex items-center justify-center">
                    <span className="material-symbols-outlined text-[18px]">
                      forward_to_inbox
                    </span>
                  </div>
                  <span className="text-xs sm:text-sm font-medium">
                    Pengingat WhatsApp Otomatis: 12 KK
                  </span>
                </div>
                <span className="text-xs bg-emerald-400 text-emerald-950 px-2.5 py-1 rounded-lg font-bold shadow-xs">
                  Terkirim
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
