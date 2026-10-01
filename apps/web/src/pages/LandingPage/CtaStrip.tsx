export function CtaStrip() {
  return (
    <section className="w-full py-16 bg-gradient-to-r from-[#00450d] via-[#005b34] to-[#137547] text-white relative overflow-hidden">
      <div className="absolute -right-20 -bottom-20 w-80 h-80 rounded-full bg-emerald-400/10 filter blur-2xl" />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row items-center justify-between gap-8 text-center md:text-left relative z-10">
        <div>
          <h3 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold tracking-tight">
            Mulai Transformasi Digital RT Anda Hari Ini
          </h3>
          <p className="text-emerald-100 text-sm sm:text-base mt-2 max-w-xl">
            Bergabunglah bersama ribuan pengurus rukun tetangga cerdas,
            transparan, dan dicintai warganya.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <a
            className="bg-emerald-400 text-emerald-950 font-bold text-sm sm:text-base px-8 py-4 rounded-xl shadow-lg hover:bg-emerald-300 hover:scale-105 active:scale-95 transition-all duration-200"
            href="#daftar-sekarang"
          >
            Daftar RT Gratis Sekarang
          </a>
        </div>
      </div>
    </section>
  );
}
