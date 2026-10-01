export function AnnouncementBar() {
  return (
    <div className="w-full bg-gradient-to-r from-emerald-50 via-teal-50/80 to-emerald-50 py-2.5 px-4 border-b border-emerald-100 text-center relative z-20">
      <div className="max-w-7xl mx-auto flex items-center justify-center gap-2.5 text-xs sm:text-sm font-medium text-emerald-950">
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-600 text-white font-bold text-[10px] tracking-wider uppercase shadow-sm">
          <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
          Terbaru
        </span>
        <span className="text-slate-700">
          Integrasi Tanda Tangan Elektronik (TTE) &amp; Masking NIK Otomatis
          Sesuai Regulasi UU PDP No. 27/2022
        </span>
      </div>
    </div>
  );
}
