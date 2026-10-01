interface PricingTier {
  name: string;
  badge?: string;
  badgeStyle?: string;
  description: string;
  price: string;
  priceSub?: string;
  trial?: string;
  features: { text: string; included: boolean; strong?: boolean }[];
  cta: string;
  ctaStyle: string;
  featured?: boolean;
}

import { KontenLanding } from "../../lib/adminData";

const tiers: PricingTier[] = [
  {
    name: "Paket Free",
    badge: "Gratis Selamanya",
    badgeStyle: "bg-slate-100 text-slate-600",
    description:
      "Untuk RT yang baru mulai melangkah ke digitalisasi administrasi lingkungan.",
    price: "Rp 0",
    priceSub: " / bulan / RT",
    features: [
      { text: 'Hingga 50 KK / Warga terdaftar', included: true, strong: true },
      { text: "Portal Warga Mobile (Akses Mandiri)", included: true },
      { text: "Login Aman Magic-link WhatsApp", included: true },
      { text: "Buku Kas & Iuran Dasar (1 Mode Alokasi)", included: true },
      { text: "Template Surat Standar Pengantar RT", included: true },
      { text: "Tanpa Dasbor Agregat RW", included: false },
      { text: "Dukungan Komunitas via Forum", included: false },
    ],
    cta: "Mulai Gratis Sekarang",
    ctaStyle:
      "bg-slate-100 hover:bg-slate-200 text-slate-800",
  },
  {
    name: "Paket Pro",
    badge: "Rekomendasi RT Aktif",
    badgeStyle: "bg-emerald-100 text-emerald-800",
    description:
      "Untuk RT & RW aktif dengan operasional penuh, pengingat WhatsApp, dan surat TTE.",
    price: "Rp 99.000",
    priceSub: " / bulan / RT",
    trial: "Trial 30 hari gratis • Batal kapan saja",
    features: [
      { text: "Warga & KK Tanpa Batas", included: true, strong: true },
      { text: "Portal Warga Penuh + OTP WhatsApp", included: true, strong: true },
      { text: "Kas Lanjutan: Multi-kategori, Approval & FIFO", included: true, strong: true },
      { text: "Kop Surat & Template Surat Kustom RT", included: true, strong: true },
      { text: "Dasbor Agregat RW Terintegrasi", included: true, strong: true },
      { text: "Ekspor Format Excel / PDF Resmi Kemendagri", included: true, strong: true },
      { text: "Dukungan Prioritas CS WhatsApp 1x24 Jam", included: true, strong: true },
    ],
    cta: "Coba Gratis 30 Hari",
    ctaStyle:
      "bg-gradient-to-r from-[#005b34] to-[#137547] text-white shadow-[0_4px_16px_rgba(0,91,52,0.3)] hover:shadow-[0_8px_24px_rgba(0,91,52,0.4)] hover:scale-[1.02]",
    featured: true,
  },
  {
    name: "Paket Max",
    badge: "RW & Kelurahan",
    badgeStyle: "bg-sky-50 text-sky-800",
    description:
      "Untuk RW besar, kawasan perumahan mandiri, atau kemitraan tingkat Kelurahan / Desa.",
    price: "Kustom",
    priceSub: " / paket wilayah",
    features: [
      { text: "Multi-RW & Konsolidasi Satu Kelurahan", included: true },
      { text: "Kuota OTP WhatsApp Terintegrasi", included: true },
      { text: "Multi-kas, perizinan berjenjang (Maker-Checker)", included: true },
      { text: "Alur verifikasi surat 2-tier (RT ke RW)", included: true },
      { text: "Backup Harian Otomatis & Retensi Data Penuh", included: true },
      { text: "Dedicated Account Manager & Onboarding Offline", included: true },
    ],
    cta: "Konsultasi Kebutuhan RW/Kelurahan",
    ctaStyle:
      "bg-slate-100 hover:bg-slate-200 text-slate-800",
  },
];

export function PricingSection({ konten }: { konten?: KontenLanding }) {
  // Override nama/harga/satuan/deskripsi per tier dari konten admin —
  // daftar fitur & gaya tombol tetap lokal.
  const items = tiers.map((tier, i) => ({
    ...tier,
    name: konten?.harga[i]?.nama ?? tier.name,
    price: konten?.harga[i]?.harga ?? tier.price,
    priceSub: konten?.harga[i]?.satuan ?? tier.priceSub,
    description: konten?.harga[i]?.deskripsi ?? tier.description,
  }));
  return (
    <section
      className="w-full py-20 bg-slate-50/60 border-t border-slate-200/60"
      id="harga-paket"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <span className="text-xs uppercase tracking-widest font-bold text-emerald-800 bg-emerald-100/70 px-3 py-1 rounded-full">
            Transparan Tanpa Biaya Tersembunyi
          </span>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900 mt-3 tracking-tight">
            Pilihan Paket Sesuai Kesiapan Lingkungan Anda
          </h2>
          <p className="text-slate-600 text-sm sm:text-base mt-2 leading-relaxed">
            Mulai secara gratis untuk RT rintisan, atau upgrade ke Pro untuk
            operasional tanpa batas dan otomasi pengingat WhatsApp.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-stretch pt-4">
          {items.map((tier) => (
            <div
              key={tier.name}
              className={`bg-gradient-to-b from-white via-white to-emerald-50/40 rounded-3xl p-8 border shadow-sm hover:shadow-xl transition-all duration-300 flex flex-col justify-between relative ${
                tier.featured
                  ? "border-2 border-emerald-600 shadow-[0_12px_40px_rgba(0,91,52,0.14)] lg:-translate-y-2"
                  : "border-slate-200 hover:border-slate-300"
              }`}
            >
              {tier.featured && (
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-gradient-to-r from-emerald-600 to-teal-600 text-white px-5 py-1 rounded-full text-xs font-extrabold shadow-md tracking-wider uppercase flex items-center gap-1">
                  <span className="material-symbols-outlined text-[14px]">
                    local_fire_department
                  </span>
                  Paling Populer
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-xl font-bold text-slate-900">
                    {tier.name}
                  </span>
                  <span
                    className={`px-3 py-1 text-xs rounded-full font-bold ${tier.badgeStyle}`}
                  >
                    {tier.badge}
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-2 leading-relaxed">
                  {tier.description}
                </p>
                <div
                  className={`mt-6 pb-6 p-5 rounded-2xl ${
                    tier.featured
                      ? "bg-emerald-50/70 border border-emerald-200/80"
                      : "bg-slate-50 border border-slate-100"
                  }`}
                >
                  <span
                    className={`text-3xl sm:text-4xl font-extrabold ${
                      tier.featured ? "text-emerald-800" : "text-slate-900"
                    }`}
                  >
                    {tier.price}
                  </span>
                  <span className="text-xs text-slate-500 font-medium">
                    {tier.priceSub}
                  </span>
                  {tier.trial && (
                    <span className="block font-mono text-[11px] text-emerald-700 font-semibold mt-1">
                      {tier.trial}
                    </span>
                  )}
                </div>

                <ul className="mt-6 space-y-3.5 text-sm text-slate-700">
                  {tier.features.map((f) => (
                    <li
                      key={f.text}
                      className={`flex items-start gap-2.5 ${
                        !f.included ? "text-slate-400" : ""
                      } ${f.strong ? "font-medium" : ""}`}
                    >
                      <span
                        className={`material-symbols-outlined text-[18px] mt-0.5 ${
                          f.included ? "text-emerald-600" : "text-slate-400"
                        }`}
                      >
                        {f.included ? "check_circle" : "remove"}
                      </span>
                      <span
                        dangerouslySetInnerHTML={{ __html: f.text }}
                      />
                    </li>
                  ))}
                </ul>
              </div>

              <div className="mt-8 pt-4">
                <a
                  className={`w-full inline-flex items-center justify-center font-bold text-sm py-3.5 rounded-xl transition-all ${tier.ctaStyle}`}
                  href="#daftar-sekarang"
                >
                  {tier.cta}
                </a>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
