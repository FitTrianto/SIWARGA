import { useState } from "react";
import type { FormEvent } from "react";
import { tenant } from "../../lib/tenant";

const PHONE_MIN = 10;
const PHONE_MAX = 13;
/** Kode RT/RW maksimal 3 digit — selaras kolom `kode_rt`/`kode_rw` VarChar(3). */
const KODE_WILAYAH_MAKS = 3;
/** Batas nama kecamatan/kelurahan — selaras kolom `nama` VarChar(120). */
const NAMA_WILAYAH_MAKS = 120;
/** Batas nama kota — selaras kolom `kota` VarChar(80). */
const NAMA_KOTA_MAKS = 80;

function onlyDigits(v: string): string {
  return v.replace(/\D/g, "");
}

interface RegistrationFormProps {
  onNavigate?: (page: string) => void;
}

export function RegistrationForm({ onNavigate }: RegistrationFormProps) {
  const [submitted, setSubmitted] = useState(false);
  const [whatsapp, setWhatsapp] = useState("");
  const [error, setError] = useState("");
  // Kolom wilayah per level — input terpisah agar format baku & minim salah ketik.
  const [rt, setRt] = useState("");
  const [rw, setRw] = useState("");
  const [errorRt, setErrorRt] = useState("");
  const [errorRw, setErrorRw] = useState("");

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!whatsapp) {
      setError("Nomor WhatsApp wajib diisi");
      return;
    }
    if (!/^\d+$/.test(whatsapp)) {
      setError("Nomor WhatsApp hanya boleh berisi angka");
      return;
    }
    if (whatsapp.length < PHONE_MIN || whatsapp.length > PHONE_MAX) {
      setError(`Nomor WhatsApp harus ${PHONE_MIN}-${PHONE_MAX} digit (saat ini ${whatsapp.length} digit)`);
      return;
    }
    setError("");

    // Kode wilayah per kolom wajib terisi (saat mengetik sudah dibatasi onlyDigits).
    let wilayahValid = true;
    if (!rt) {
      setErrorRt("Nomor RT wajib diisi (angka saja).");
      wilayahValid = false;
    }
    if (!rw) {
      setErrorRw("Nomor RW wajib diisi (angka saja).");
      wilayahValid = false;
    }
    if (!wilayahValid) return;
    setErrorRt("");
    setErrorRw("");
    setSubmitted(true);
  }

  return (
    <section className="w-full py-20 bg-white" id="daftar-sekarang">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-gradient-to-br from-white to-slate-50 border border-slate-200/90 rounded-3xl shadow-xl p-8 sm:p-12 relative overflow-hidden">
          <div className="text-center max-w-2xl mx-auto mb-10">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-[#005b34] to-[#137547] text-white flex items-center justify-center mx-auto mb-4 shadow-md">
              <span className="material-symbols-outlined text-[28px]">
                app_registration
              </span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
              Daftarkan RT Anda Secara Mandiri
            </h2>
            <p className="text-slate-600 text-sm sm:text-base mt-2 leading-relaxed">
              Kolom wilayah dipisah per level — RT, RW, Kecamatan, Kelurahan,
              dan Kota — agar data terformat baku dan minim salah ketik.
              Pendaftaran otomatis sedang disiapkan; data belum dikirim hingga
              fitur onboarding self-service diluncurkan.
            </p>
          </div>

          <form
            className="space-y-6"
            onSubmit={handleSubmit}
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="space-y-2">
                <label className="text-xs sm:text-sm font-bold text-slate-800 block">
                  Nama Lengkap Ketua / Admin RT *
                </label>
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-3.5 top-3 text-slate-400 text-[20px]">
                    badge
                  </span>
                  <input
                    className="w-full pl-11 pr-4 py-3 bg-white border border-slate-200 rounded-xl text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:border-transparent transition-all shadow-xs"
                    placeholder="Contoh: Budi Prasetyo"
                    required
                    type="text"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-xs sm:text-sm font-bold text-slate-800 block">
                  Nomor WhatsApp Aktif *
                </label>
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-3.5 top-3 text-slate-400 text-[20px]">
                    phone
                  </span>
                  <input
                    className="w-full pl-11 pr-4 py-3 bg-white border border-slate-200 rounded-xl text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:border-transparent transition-all shadow-xs"
                    placeholder="Contoh: 081234567890"
                    required
                    type="tel"
                    inputMode="numeric"
                    maxLength={PHONE_MAX}
                    value={whatsapp}
                    onChange={(e) => { setWhatsapp(onlyDigits(e.target.value)); setError(""); }}
                  />
                  {error && (
                    <span className="text-[11px] text-red-600 font-medium block mt-1">{error}</span>
                  )}
                </div>
                <span className="text-[11px] text-slate-500 block">
                  Nomor ini akan dipakai untuk tautan aktivasi saat fitur
                  pendaftaran diluncurkan
                </span>
              </div>
            </div>

            {/* Wilayah: kolom terpisah per level — RT, RW, Kecamatan, Kelurahan, Kota.
                Mencegah input gabungan yang tak baku ("Pulo Gadung, Jakarta Timur", dsb). */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="space-y-2">
                <label className="text-xs sm:text-sm font-bold text-slate-800 block" htmlFor="daftar-rt">
                  Nomor RT *
                </label>
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-3.5 top-3 text-slate-400 text-[20px]">
                    home
                  </span>
                  <input
                    className="w-full pl-11 pr-4 py-3 bg-white border border-slate-200 rounded-xl text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:border-transparent transition-all shadow-xs"
                    id="daftar-rt"
                    inputMode="numeric"
                    maxLength={KODE_WILAYAH_MAKS}
                    placeholder={`Contoh: ${tenant.rt}`}
                    required
                    type="text"
                    value={rt}
                    onChange={(e) => { setRt(onlyDigits(e.target.value)); setErrorRt(""); }}
                  />
                  {errorRt && (
                    <span className="text-[11px] text-red-600 font-medium block mt-1">{errorRt}</span>
                  )}
                </div>
                <span className="text-[11px] text-slate-500 block">
                  Angka saja, maks. {KODE_WILAYAH_MAKS} digit
                </span>
              </div>
              <div className="space-y-2">
                <label className="text-xs sm:text-sm font-bold text-slate-800 block" htmlFor="daftar-rw">
                  Nomor RW *
                </label>
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-3.5 top-3 text-slate-400 text-[20px]">
                    groups
                  </span>
                  <input
                    className="w-full pl-11 pr-4 py-3 bg-white border border-slate-200 rounded-xl text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:border-transparent transition-all shadow-xs"
                    id="daftar-rw"
                    inputMode="numeric"
                    maxLength={KODE_WILAYAH_MAKS}
                    placeholder={`Contoh: ${tenant.rw}`}
                    required
                    type="text"
                    value={rw}
                    onChange={(e) => { setRw(onlyDigits(e.target.value)); setErrorRw(""); }}
                  />
                  {errorRw && (
                    <span className="text-[11px] text-red-600 font-medium block mt-1">{errorRw}</span>
                  )}
                </div>
                <span className="text-[11px] text-slate-500 block">
                  Angka saja, maks. {KODE_WILAYAH_MAKS} digit
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              <div className="space-y-2">
                <label className="text-xs sm:text-sm font-bold text-slate-800 block" htmlFor="daftar-kecamatan">
                  Kecamatan *
                </label>
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-3.5 top-3 text-slate-400 text-[20px]">
                    location_city
                  </span>
                  <input
                    className="w-full pl-11 pr-4 py-3 bg-white border border-slate-200 rounded-xl text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:border-transparent transition-all shadow-xs"
                    id="daftar-kecamatan"
                    maxLength={NAMA_WILAYAH_MAKS}
                    placeholder={`Contoh: ${tenant.kecamatan}`}
                    required
                    type="text"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-xs sm:text-sm font-bold text-slate-800 block" htmlFor="daftar-kelurahan">
                  Kelurahan / Desa *
                </label>
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-3.5 top-3 text-slate-400 text-[20px]">
                    map
                  </span>
                  <input
                    className="w-full pl-11 pr-4 py-3 bg-white border border-slate-200 rounded-xl text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:border-transparent transition-all shadow-xs"
                    id="daftar-kelurahan"
                    maxLength={NAMA_WILAYAH_MAKS}
                    placeholder={`Contoh: ${tenant.kelurahan}`}
                    required
                    type="text"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-xs sm:text-sm font-bold text-slate-800 block" htmlFor="daftar-kota">
                  Kota *
                </label>
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-3.5 top-3 text-slate-400 text-[20px]">
                    apartment
                  </span>
                  <input
                    className="w-full pl-11 pr-4 py-3 bg-white border border-slate-200 rounded-xl text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:border-transparent transition-all shadow-xs"
                    id="daftar-kota"
                    maxLength={NAMA_KOTA_MAKS}
                    placeholder={`Contoh: ${tenant.kota}`}
                    required
                    type="text"
                  />
                </div>
              </div>
            </div>

            {/* Package Selection */}
            <div className="space-y-2.5 pt-2">
              <label className="text-xs sm:text-sm font-bold text-slate-800 block">
                Pilih Paket Awal
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="flex items-start gap-3 p-4 rounded-2xl bg-white border-2 border-emerald-600 cursor-pointer shadow-xs hover:bg-emerald-50/40 transition-colors">
                  <input
                    className="accent-emerald-700 w-4 h-4 mt-1"
                    defaultChecked
                    name="planChoice"
                    type="radio"
                    value="pro_trial"
                  />
                  <div>
                    <div className="text-sm font-bold text-slate-900">
                      Paket Pro (Trial Gratis 30 Hari)
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                      Akses semua fitur tanpa batasan &amp; kuota WhatsApp
                    </div>
                  </div>
                </label>
                <label className="flex items-start gap-3 p-4 rounded-2xl bg-white border border-slate-200 cursor-pointer shadow-xs hover:bg-slate-50 transition-colors">
                  <input
                    className="accent-emerald-700 w-4 h-4 mt-1"
                    name="planChoice"
                    type="radio"
                    value="free"
                  />
                  <div>
                    <div className="text-sm font-bold text-slate-900">
                      Paket Free (Rp 0 Selamanya)
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                      Maksimal 50 KK dengan fitur kas &amp; surat dasar
                    </div>
                  </div>
                </label>
              </div>
            </div>

            {/* ToS Checkbox */}
            <div className="pt-2">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  className="accent-emerald-700 mt-1 w-4 h-4 rounded"
                  required
                  type="checkbox"
                />
                <span className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                  Saya menyetujui{" "}
                  <button
                    type="button"
                    className="text-emerald-800 font-semibold underline hover:text-emerald-950"
                    onClick={() => onNavigate?.("syarat-ketentuan")}
                  >
                    Ketentuan Layanan
                  </button>{" "}
                  dan kepatuhan terhadap regulasi{" "}
                  <button
                    type="button"
                    className="text-emerald-800 font-semibold underline hover:text-emerald-950"
                    onClick={() => onNavigate?.("kebijakan-privasi")}
                  >
                    UU Perlindungan Data Pribadi (UU PDP No. 27/2022)
                  </button>{" "}
                  dalam pengelolaan data warga.
                </span>
              </label>
            </div>

            <div className="pt-3">
              <button
                className="w-full bg-gradient-to-r from-[#005b34] to-[#137547] text-white font-bold text-base py-4 rounded-xl shadow-[0_6px_20px_rgba(0,91,52,0.28)] hover:shadow-[0_10px_28px_rgba(0,91,52,0.38)] hover:scale-[1.01] active:scale-[0.99] flex items-center justify-center gap-2 transition-all duration-200"
                type="submit"
              >
                <span>Daftarkan RT Saya Sekarang</span>
                <span className="material-symbols-outlined text-[20px]">
                  rocket_launch
                </span>
              </button>
              <p className="text-xs text-center text-slate-500 mt-3">
                Tanpa kartu kredit. Isi sesuai format baku agar data wilayah
                mudah diverifikasi saat fitur pendaftaran diluncurkan.
              </p>
            </div>
          </form>

          {/* Status jujur: belum ada endpoint pendaftaran (Fase 5 PRD) — data
              TIDAK pernah diklaim terkirim/tersimpan. */}
          {submitted && (
            <div className="mt-6 p-5 rounded-2xl bg-amber-50 border border-amber-200 text-amber-950 shadow-md">
              <div className="flex items-center gap-3.5">
                <div className="w-10 h-10 rounded-xl bg-amber-500 text-white flex items-center justify-center flex-shrink-0">
                  <span className="material-symbols-outlined text-[24px]">
                    info
                  </span>
                </div>
                <div>
                  <h4 className="text-base font-bold text-amber-950">
                    Data Terisi Lengkap — Belum Terkirim
                  </h4>
                  <p className="text-xs sm:text-sm text-amber-800 mt-0.5">
                    Formulir ini belum terhubung ke sistem pendaftaran, sehingga
                    data yang Anda isi belum dikirim maupun tersimpan di server.
                    Pendaftaran mandiri otomatis masih disiapkan — silakan
                    gunakan kembali formulir ini setelah fitur tersebut
                    diluncurkan.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
