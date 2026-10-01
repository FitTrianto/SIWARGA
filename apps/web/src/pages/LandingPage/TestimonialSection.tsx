import { useState } from "react";
import { tenant } from "../../lib/tenant";

const testimonials = [
  {
    text: '"Sebelum ada SIWARGA, kami bendahara RT sering dicurigai warga perihal pembukuan dana renovasi gapura. Sejak pakai sistem append-only dan laporan transparan SIWARGA, warga bisa lihat bukti kuitansi sendiri di HP. Kepatuhan iuran naik dari 60% jadi 92%."',
    initials: "BS",
    bg: "bg-emerald-800",
    name: "Bambang S.",
    role: `Ketua ${tenant.rtFull}, Kelurahan ${tenant.kelurahan}`,
  },
  {
    text: '"Fitur surat digital dengan TTE dan QR code sangat menyelamatkan warga pekerja. Warga tidak perlu izin pulang kantor siang-siang cuma untuk ambil selembar surat pengantar KTP. Kelurahan juga senang karena QR bisa divalidasi langsung di meja pelayanan."',
    initials: "HS",
    bg: "bg-teal-800",
    name: "H. Subaidi",
    role: `Ketua ${tenant.rwFull} ${tenant.perumahanSingkat}, ${tenant.kota}`,
  },
];

const faqs = [
  {
    q: "Apakah warga yang sudah lanjut usia (gaptek) tetap bisa menggunakan?",
    a: "Tentu. Warga tidak diwajibkan mengunduh aplikasi di Play Store atau App Store. Semua notifikasi kuitansi dan tagihan dikirimkan langsung melalui pesan WhatsApp biasa. Selain itu, pengurus tetap bisa mencetak kuitansi fisik atau kartu iuran kertas bagi warga lansia yang menghendaki cara konvensional.",
  },
  {
    q: "Bagaimana keamanan data NIK dan KTP warga sesuai UU PDP?",
    a: "SIWARGA dirancang mematuhi regulasi UU Perlindungan Data Pribadi No. 27/2022. Semua NIK disamarkan secara otomatis di tampilan publik. Penyimpanan data dienkripsi dengan standar AES 256-bit di server lokal (data center Indonesia). Setiap tindakan pembukaan sensor data NIK dicatat dalam audit trail yang tidak dapat dihapus.",
  },
  {
    q: "Apakah laporan keuangan dan kas bisa dicetak dalam format PDF/Excel fisik?",
    a: "Ya, sistem menyediakan fitur ekspor satu kali klik ke format Excel (.xlsx) dan dokumen cetak PDF resmi lengkap dengan kop RT, tanda tangan ketua & bendahara, untuk ditempel di papan pengumuman balai warga atau dibawa saat rapat bulanan.",
  },
  {
    q: "Bagaimana jika kami ingin berhenti berlangganan paket Pro?",
    a: "Anda bebas berpindah ke paket Free kapan saja tanpa denda. Semua data warga, mutasi kas, dan riwayat surat tetap tersimpan aman dan dapat Anda unduh secara penuh sebelum perubahan paket berlaku.",
  },
];

export function TestimonialSection() {
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  return (
    <section
      className="w-full py-20 bg-slate-50/70 border-t border-slate-200/60"
      id="faq"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Testimonials */}
        <div className="mb-20">
          <div className="text-center max-w-2xl mx-auto mb-14">
            <span className="text-xs uppercase tracking-widest font-bold text-emerald-800 bg-emerald-100/70 px-3 py-1 rounded-full">
              Kisah Sukses Pengurus
            </span>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900 mt-3 tracking-tight">
              Kata Mereka yang Telah Menggunakan SIWARGA
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {testimonials.map((t) => (
              <div
                key={t.name}
                className="bg-white p-8 rounded-3xl border border-slate-200/80 shadow-sm hover:shadow-xl transition-all duration-300 space-y-4"
              >
                <div className="flex items-center gap-1 text-amber-500">
                  {[...Array(5)].map((_, i) => (
                    <span
                      key={i}
                      className="material-symbols-outlined text-[20px]"
                    >
                      star
                    </span>
                  ))}
                </div>
                <p className="text-sm sm:text-base text-slate-700 italic leading-relaxed">
                  {t.text}
                </p>
                <div className="flex items-center gap-3.5 pt-3 border-t border-slate-100">
                  <div
                    className={`w-11 h-11 rounded-2xl ${t.bg} text-white flex items-center justify-center font-bold text-sm shadow-xs`}
                  >
                    {t.initials}
                  </div>
                  <div>
                    <span className="text-sm sm:text-base font-bold text-slate-900 block leading-tight">
                      {t.name}
                    </span>
                    <span className="text-xs text-slate-500">{t.role}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* FAQ */}
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-10">
            <span className="text-xs uppercase tracking-widest font-bold text-emerald-800 bg-emerald-100/70 px-3 py-1 rounded-full">
              Pertanyaan yang Sering Diajukan
            </span>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900 mt-3 tracking-tight">
              FAQ Seputar SIWARGA
            </h2>
          </div>

          <div className="space-y-3.5">
            {faqs.map((faq, i) => (
              <div
                key={i}
                className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden transition-all"
              >
                <button
                  className="w-full p-5 text-left flex items-center justify-between text-sm sm:text-base text-slate-900 font-bold hover:bg-slate-50 transition-colors"
                  type="button"
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                >
                  <span>{faq.q}</span>
                  <span
                    className={`material-symbols-outlined text-emerald-700 transition-transform duration-200 ${
                      openFaq === i ? "rotate-180" : ""
                    }`}
                  >
                    expand_more
                  </span>
                </button>
                {openFaq === i && (
                  <div className="px-5 pb-5 text-sm text-slate-600 leading-relaxed border-t border-slate-100 pt-3">
                    {faq.a}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
