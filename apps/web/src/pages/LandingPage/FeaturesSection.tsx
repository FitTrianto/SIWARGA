interface Feature {
  icon: string;
  iconBg: string;
  iconBorder: string;
  iconColor: string;
  title: string;
  description: string;
  tag: string;
  tagLabel: string;
  tagColor: string;
}

import { KontenLanding } from "../../lib/adminData";

const features: Feature[] = [
  {
    icon: "account_balance_wallet",
    iconBg: "bg-emerald-50",
    iconBorder: "border-emerald-100",
    iconColor: "text-emerald-700",
    title: "Buku Kas Append-Only & Alokasi FIFO",
    description:
      "Pencatatan kas anti-manipulasi dengan riwayat append-only. Iuran bulanan warga teralokasi otomatis dengan metode First-In First-Out sehingga tidak ada tunggakan terlewat.",
    tag: "Immutable Log",
    tagLabel: "Auditable",
    tagColor: "text-emerald-800",
  },
  {
    icon: "mark_chat_read",
    iconBg: "bg-teal-50",
    iconBorder: "border-teal-100",
    iconColor: "text-teal-700",
    title: "Pengingat WhatsApp Otomatis",
    description:
      "Kirim invoice dan kuitansi iuran langsung ke nomor WhatsApp warga tanpa perlu simpan nomor kontak satu per satu. Dilengkapi tombol bayar dan cek mutasi langsung.",
    tag: "Magic-Link Login",
    tagLabel: "Tanpa Password",
    tagColor: "text-emerald-800",
  },
  {
    icon: "policy",
    iconBg: "bg-sky-50",
    iconBorder: "border-sky-100",
    iconColor: "text-sky-700",
    title: "Masking NIK & Kepatuhan UU PDP",
    description:
      'Melindungi data sensitif warga. NIK 16 digit otomatis tersensor (3171••••0004). Unmasking hanya untuk pengurus berwenang dan tercatat di audit trail.',
    tag: "UU PDP Ready",
    tagLabel: "Aman Hukum",
    tagColor: "text-sky-800",
  },
  {
    icon: "verified",
    iconBg: "bg-emerald-50",
    iconBorder: "border-emerald-100",
    iconColor: "text-emerald-700",
    title: "Surat Pengantar Digital & QR TTE",
    description:
      "Pembuatan Surat Pengantar KTP, Nikah, Domisili, dan Kematian mandiri via web. Ditandatangani digital oleh Ketua RT dan tervalidasi publik via scan QR code.",
    tag: "PDF Export + QR",
    tagLabel: "Bebas Palsu",
    tagColor: "text-emerald-800",
  },
  {
    icon: "bar_chart",
    iconBg: "bg-teal-50",
    iconBorder: "border-teal-100",
    iconColor: "text-teal-700",
    title: "Laporan Keuangan Transparan Warga",
    description:
      "Tingkatkan rasa saling percaya. Setiap pengeluaran kas RT dilengkapi foto bukti kuitansi nota yang dapat dilihat warga secara akuntabel dan transparan.",
    tag: "Transparansi Penuh",
    tagLabel: "Bebas Fitnah",
    tagColor: "text-teal-800",
  },
  {
    icon: "database",
    iconBg: "bg-amber-50",
    iconBorder: "border-amber-100",
    iconColor: "text-amber-700",
    title: "Sensus & Rekapitulasi KK Instan",
    description:
      "Rekam status rumah (milik/sewa/kontrak), lansia, balita, hingga penerima bansos. Ekspor ke Excel & PDF resmi format Kemendagri dalam satu klik.",
    tag: "XLSX / PDF Export",
    tagLabel: "Siap Kelurahan",
    tagColor: "text-amber-800",
  },
];

export function FeaturesSection({ konten }: { konten?: KontenLanding }) {
  // Konten admin meng-override judul/deskripsi per index — ikon & tag tetap lokal.
  const items = features.map((f, i) => ({
    ...f,
    title: konten?.fitur[i]?.judul ?? f.title,
    description: konten?.fitur[i]?.deskripsi ?? f.description,
  }));
  return (
    <section
      className="w-full py-20 bg-slate-50/70 border-t border-b border-slate-200/60"
      id="solusi-fitur"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col md:flex-row md:items-end justify-between mb-14 gap-6">
          <div>
            <span className="text-xs uppercase tracking-widest font-bold text-emerald-800 bg-emerald-100/70 px-3 py-1 rounded-full">
              Kapabilitas Platform SIWARGA
            </span>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900 mt-3 tracking-tight">
              Fitur Kelas Enterprise, Semudah Mengirim Pesan Singkat
            </h2>
          </div>
          <p className="text-slate-600 text-sm sm:text-base max-w-md leading-relaxed">
            Dirancang sesuai standar tata kelola hukum administrasi Indonesia,
            mengutamakan kemudahan operasional pengurus dan privasi warga.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {items.map((feature) => (
            <div
              key={feature.title}
              className="bg-white p-7 rounded-3xl border border-slate-200/80 shadow-sm hover:shadow-xl hover:border-emerald-300 hover:translate-y-[-3px] transition-all duration-300 flex flex-col justify-between"
            >
              <div>
                <div
                  className={`w-12 h-12 rounded-2xl ${feature.iconBg} ${feature.iconBorder} border ${feature.iconColor} flex items-center justify-center mb-5 shadow-xs`}
                >
                  <span className="material-symbols-outlined text-[24px]">
                    {feature.icon}
                  </span>
                </div>
                <h3 className="text-lg font-bold text-slate-900">
                  {feature.title}
                </h3>
                <p className="text-sm text-slate-600 mt-2.5 leading-relaxed">
                  {feature.description}
                </p>
              </div>
              <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between">
                <span className="font-mono text-xs bg-slate-100 text-slate-700 px-2.5 py-1 rounded-md font-medium">
                  {feature.tag}
                </span>
                <span
                  className={`text-xs font-bold ${feature.tagColor}`}
                >
                  {feature.tagLabel}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
