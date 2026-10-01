import { useState, useCallback } from "react";

export function CalculatorSection() {
  const [kk, setKk] = useState(75);
  const [iuran, setIuran] = useState(50000);

  const updateKk = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => setKk(Number(e.target.value)),
    []
  );
  const updateIuran = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setIuran(Number(e.target.value)),
    []
  );

  const totalKas = kk * iuran;
  const costPerKK = Math.round(99000 / kk);
  const hoursSaved = Math.round(kk * 0.18);

  return (
    <section className="w-full py-20 bg-white" id="kalkulator">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-gradient-to-br from-white via-slate-50 to-emerald-50/40 rounded-3xl border border-slate-200/90 shadow-xl p-6 sm:p-10 lg:p-12">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-center">
            {/* Left: Sliders */}
            <div className="lg:col-span-6 space-y-7">
              <div>
                <span className="text-xs uppercase tracking-widest font-bold text-emerald-800 bg-emerald-100/80 px-3 py-1 rounded-full">
                  Simulasi Interaktif Pengurus
                </span>
                <h2 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold text-slate-900 mt-3 tracking-tight">
                  Kalkulator Iuran &amp; Efisiensi Waktu Pengurus
                </h2>
                <p className="text-slate-600 text-sm sm:text-base mt-2 leading-relaxed">
                  Hitung seberapa terjangkau SIWARGA untuk lingkungan RT Anda
                  dan berapa banyak jam kerja pengurus yang dapat dihemat setiap
                  bulannya.
                </p>
              </div>

              {/* Slider KK */}
              <div className="space-y-3 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                <div className="flex items-center justify-between">
                  <label className="text-sm sm:text-base font-bold text-slate-800">
                    Jumlah Kepala Keluarga (KK) di RT Anda
                  </label>
                  <span className="text-base font-extrabold text-emerald-800 bg-emerald-50 border border-emerald-200 px-3 py-1 rounded-xl shadow-xs">
                    {kk} KK
                  </span>
                </div>
                <input
                  className="w-full accent-emerald-700 h-2.5 bg-slate-200 rounded-lg cursor-pointer"
                  max={250}
                  min={20}
                  step={5}
                  type="range"
                  value={kk}
                  onChange={updateKk}
                />
                <div className="flex justify-between text-xs font-mono text-slate-500">
                  <span>20 KK (Cluster)</span>
                  <span>120 KK (RT Rata-rata)</span>
                  <span>250 KK (RT Padat)</span>
                </div>
              </div>

              {/* Slider Iuran */}
              <div className="space-y-3 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                <div className="flex items-center justify-between">
                  <label className="text-sm sm:text-base font-bold text-slate-800">
                    Nominal Iuran Bulanan per KK
                  </label>
                  <span className="text-base font-extrabold text-emerald-800 bg-emerald-50 border border-emerald-200 px-3 py-1 rounded-xl shadow-xs">
                    Rp {iuran.toLocaleString("id-ID")}
                  </span>
                </div>
                <input
                  className="w-full accent-emerald-700 h-2.5 bg-slate-200 rounded-lg cursor-pointer"
                  max={250000}
                  min={10000}
                  step={5000}
                  type="range"
                  value={iuran}
                  onChange={updateIuran}
                />
                <div className="flex justify-between text-xs font-mono text-slate-500">
                  <span>Rp 10.000</span>
                  <span>Rp 50.000</span>
                  <span>Rp 250.000 (Kompleks/Estate)</span>
                </div>
              </div>
            </div>

            {/* Right: Results */}
            <div className="lg:col-span-6 bg-white border border-emerald-200/80 p-6 sm:p-8 rounded-3xl shadow-[0_12px_36px_rgba(0,91,52,0.06)] space-y-6">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <span className="text-xs sm:text-sm font-bold uppercase tracking-wider text-slate-700">
                  Proyeksi Pengelolaan Kas
                </span>
                <span className="text-xs px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 font-bold">
                  Otomatis Terhitung
                </span>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="bg-slate-50/90 p-4 sm:p-5 rounded-2xl border border-slate-200/70">
                  <span className="text-xs text-slate-500 font-medium block">
                    Total Kas Terkumpul / Bulan
                  </span>
                  <span className="text-xl sm:text-2xl font-extrabold text-slate-900 mt-1 block">
                    Rp {totalKas.toLocaleString("id-ID")}
                  </span>
                  <span className="text-[11px] text-emerald-700 font-semibold block mt-1">
                    Asumsi semua warga bayar
                  </span>
                </div>
                <div className="bg-emerald-50/60 p-4 sm:p-5 rounded-2xl border border-emerald-100">
                  <span className="text-xs text-slate-500 font-medium block">
                    Investasi SIWARGA Pro
                  </span>
                  <span className="text-xl sm:text-2xl font-extrabold text-emerald-800 mt-1 block">
                    Rp 99.000
                  </span>
                  <span className="text-[11px] text-slate-500 block mt-1">
                    Hanya / RT / bulan flat
                  </span>
                </div>
              </div>

              <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200 space-y-3">
                <div className="flex items-center justify-between text-sm sm:text-base">
                  <span className="text-slate-600">
                    Biaya SIWARGA Pro per Kepala Keluarga (KK):
                  </span>
                  <span className="font-extrabold text-emerald-800">
                    Rp {costPerKK.toLocaleString("id-ID")} / KK / bln
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm sm:text-base">
                  <span className="text-slate-600">
                    Estimasi Waktu Pengurus Dihemat:
                  </span>
                  <span className="font-extrabold text-teal-700">
                    ~{hoursSaved} Jam / bulan
                  </span>
                </div>
                <p className="text-xs text-slate-500 pt-2 border-t border-slate-200 leading-relaxed">
                  *Lebih murah dari selembar fotokopi surat manual. Waktu
                  pengurus tidak lagi tersita untuk rekap buku tulis dan
                  penagihan manual dari rumah ke rumah.
                </p>
              </div>

              <a
                className="inline-flex items-center justify-center gap-2 w-full bg-gradient-to-r from-[#005b34] to-[#137547] text-white font-semibold text-base py-4 rounded-xl shadow-[0_4px_16px_rgba(0,91,52,0.25)] hover:shadow-[0_8px_24px_rgba(0,91,52,0.35)] hover:scale-[1.01] active:scale-[0.99] transition-all duration-200"
                href="#daftar-sekarang"
              >
                <span>Daftarkan RT Anda dengan Simulasi Ini</span>
                <span className="material-symbols-outlined text-[18px]">
                  arrow_forward
                </span>
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
