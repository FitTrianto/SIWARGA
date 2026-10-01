interface Persona {
  icon: string;
  iconBg: string;
  iconColor: string;
  title: string;
  problem: string;
  solution: string;
  footer: string;
}

import { KontenLanding } from "../../lib/adminData";

const personas: Persona[] = [
  {
    icon: "person",
    iconBg: "bg-emerald-100",
    iconColor: "text-emerald-800",
    title: "Warga & Penghuni",
    problem:
      '"Bingung iuran sudah dicatat atau tercecer, canggung menagih kuitansi, dan antre minta surat ke rumah Pak RT waktu jam kerja."',
    solution:
      "Akses portal warga tanpa instal aplikasi. Cek buku iuran mandiri 24 jam, bayar via QRIS/Transfer, dan unduh Surat Pengantar PDF ber-QR code instan.",
    footer: "Portal Mobile Warga Mandiri",
  },
  {
    icon: "home_work",
    iconBg: "bg-teal-100",
    iconColor: "text-teal-800",
    title: "Pengurus RT",
    problem:
      '"Pembukuan buku kas manual rentan selisih, sungkan nagih door-to-door, dan waktu istirahat terganggu ketukan pintu pemohon surat."',
    solution:
      "Sistem pembukuan kas otomatis sistem FIFO, pengingat iuran ramah via WhatsApp, serta persetujuan surat hanya dengan satu ketukan tombol di HP.",
    footer: "Otomasi Buku Kas & WhatsApp",
  },
  {
    icon: "apartment",
    iconBg: "bg-sky-100",
    iconColor: "text-sky-800",
    title: "Pengurus RW",
    problem:
      '"Format laporan tiap RT berbeda-beda, sulit memantau RT yang tertib vs menunggak, serta tidak ada rekapan kependudukan real-time."',
    solution:
      "Dasbor agregat terpusat menyajikan metrik kepatuhan semua RT binaan, data agregat KK/warga terpadu, dan standarisasi penomoran surat resmi.",
    footer: "Dasbor Konsolidasi Multi-RT",
  },
  {
    icon: "account_balance",
    iconBg: "bg-indigo-100",
    iconColor: "text-indigo-800",
    title: "Kelurahan & Desa",
    problem:
      '"Lambatnya kompilasi profil data warga saat bansos, validasi manual surat pengantar rentan dipalsukan atau tidak sinkron."',
    solution:
      "Arsip digital interoperable, verifikasi QR surat pengantar terhubung ke database kelurahan, dan statistik demografi akurat untuk kebijakan publik.",
    footer: "Ekspor Agregat & Validasi Instan",
  },
];

export function PersonaSection({ konten }: { konten?: KontenLanding }) {
  // Override judul/masalah/solusi/footer per persona dari konten admin.
  const items = personas.map((p, i) => ({
    ...p,
    title: konten?.persona[i]?.judul ?? p.title,
    problem: konten?.persona[i]?.masalah ?? p.problem,
    solution: konten?.persona[i]?.solusi ?? p.solution,
    footer: konten?.persona[i]?.footer ?? p.footer,
  }));
  return (
    <section className="w-full py-20 bg-white" id="persona">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <span className="text-xs uppercase tracking-widest font-bold text-emerald-800 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-200">
            Solusi Dirancang Untuk Semua Pihak
          </span>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900 mt-4 tracking-tight">
            Menjawab Kerumitan Tata Kelola Lingkungan Dari Akar Rumput
          </h2>
          <p className="text-slate-600 text-base sm:text-lg mt-3 leading-relaxed">
            Setiap peran dalam ekosistem rukun tetangga memiliki tantangan unik.
            SIWARGA merajut alur kerja yang serasi dan minim gesekan sosial.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {items.map((persona) => (
            <div
              key={persona.title}
              className="bg-slate-50/70 border border-slate-200/80 rounded-3xl p-6 shadow-sm hover:shadow-xl hover:border-emerald-300 hover:translate-y-[-4px] transition-all duration-300 flex flex-col justify-between group"            >
              <div>
                <div
                  className={`w-12 h-12 rounded-2xl ${persona.iconBg} ${persona.iconColor} flex items-center justify-center mb-5 shadow-sm group-hover:scale-110 transition-transform`}
                >
                  <span className="material-symbols-outlined text-[28px]">
                    {persona.icon}
                  </span>
                </div>
                <div className="text-xl font-bold text-slate-900">
                  {persona.title}
                </div>
                <div className="mt-4 p-3.5 rounded-2xl bg-rose-50/70 border border-rose-100">
                  <div className="flex items-center gap-1.5 text-xs text-rose-700 font-bold uppercase tracking-wider mb-1.5">
                    <span className="material-symbols-outlined text-[15px]">
                      error
                    </span>{" "}
                    Masalah Lapangan
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    {persona.problem}
                  </p>
                </div>
                <div className="mt-3 p-3.5 rounded-2xl bg-emerald-50/80 border border-emerald-100">
                  <div className="flex items-center gap-1.5 text-xs text-emerald-800 font-bold uppercase tracking-wider mb-1.5">
                    <span className="material-symbols-outlined text-[15px]">
                      check_circle
                    </span>{" "}
                    Solusi SIWARGA
                  </div>
                  <p className="text-xs text-slate-700 leading-relaxed font-medium">
                    {persona.solution}
                  </p>
                </div>
              </div>
              <div className="mt-5 pt-4 border-t border-slate-200/60 flex items-center justify-between text-xs font-bold text-emerald-800">
                <span>{persona.footer}</span>
                <span className="material-symbols-outlined text-[18px] group-hover:translate-x-1 transition-transform">
                  arrow_forward
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
