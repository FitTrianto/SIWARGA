import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { tenant } from "../../lib/tenant";
import { Undangan, badgeUndangan, linkUndangan, pesanWaUndangan } from "../../lib/undangan";

// ===========================================================================
// KARTU UNDANGAN PORTAL WARGA — komponen tampilan kartu (QR + link) yang
// dipakai di Data Warga (Portal RT). Kirim undangan hanya bisa untuk warga
// terdaftar di Data Warga; token dihasilkan sistem (lib/undangan.ts).
// ===========================================================================

export function KartuUndangan({ u }: { u: Undangan }): JSX.Element {
  const [copied, setCopied] = useState(false);
  const [gagalSalin, setGagalSalin] = useState(false);
  const link = linkUndangan(u.token);

  async function salin() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setGagalSalin(false);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      setGagalSalin(true);
      setTimeout(() => setGagalSalin(false), 3200);
    }
  }

  return (
    // `shrink-0` WAJIB: kartu adalah anak flex-column dalam badan modal yang
    // ber-`overflow-hidden`/`max-h`. Tanpa ini kartu mengkerut (765→615px) dan
    // footer berisi Token/Berlaku s/d TERPOTONG tak terscroll — persis laporan
    // "tampilan terpotong, tidak ada link & info expired".
    <div className="shrink-0 rounded-3xl overflow-hidden shadow-xl border border-surface-container-high bg-white">
      {/* Header gradient — padding lebih ringkas di layar kecil agar kartu
          sepadan (link + masa berlaku ikut terlihat tanpa scroll). */}
      <div className="bg-gradient-to-br from-emerald-600 via-teal-600 to-cyan-700 text-white p-5 sm:p-6 relative overflow-hidden">
        <span className="pointer-events-none absolute -top-12 -right-10 w-44 h-44 rounded-full bg-white/10 blur-2xl" />
        <span className="pointer-events-none absolute -bottom-16 -left-12 w-52 h-52 rounded-full bg-white/10 blur-2xl" />
        <div className="relative">
          <span className="inline-flex items-center gap-1.5 bg-white/20 backdrop-blur px-3 py-1 rounded-full text-xs font-bold tracking-widest">
            <span className="material-symbols-outlined text-[14px]">verified</span>
            UNDANGAN RESMI
          </span>
          <h2 className="mt-3 sm:mt-4 text-xl sm:text-2xl font-extrabold tracking-tight">
            Undangan Portal Warga
          </h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-white/85 text-sm">
            <span className="font-semibold">{tenant.perumahan}</span>
            <span className="w-1 h-1 rounded-full bg-white/60" />
            <span>{tenant.label}</span>
          </div>
        </div>
      </div>

      {/* Body putih */}
      <div className="bg-white p-4 sm:p-6 text-center">
        <p className="text-[11px] font-bold uppercase tracking-widest text-on-surface-variant">Kepada Yth.</p>
        <p className="mt-1 text-xl sm:text-2xl font-extrabold text-on-surface">{u.nama}</p>
        <p className="text-sm text-on-surface-variant">
          {u.alamat} &bull; {tenant.perumahan}
        </p>

        <div className="mt-4 sm:mt-5 inline-block rounded-2xl border-2 border-dashed border-emerald-200 p-3 sm:p-4 bg-white">
          <QRCodeSVG value={link} size={168} bgColor="#ffffff" fgColor="#0b1220" level="M" />
        </div>
        <p className="mt-2 text-xs text-on-surface-variant">
          Pindai dengan kamera ponsel atau buka link di bawah
        </p>

        {/* Baris link + Salin */}
        <div className="mt-4 flex items-center gap-2 p-2 pl-3 rounded-xl bg-surface-container-low border border-surface-container-high text-left">
          <span className="material-symbols-outlined text-[16px] text-on-surface-variant shrink-0">link</span>
          {/* URL utuh (wrap, bukan ellipsis) — pengguna harus bisa MENYALIN
              link tanpa bergantung pada tombol (klipboard bisa ditolak). */}
          <span className="flex-1 min-w-0 break-all font-mono text-xs text-on-surface">{link}</span>
          <button
            type="button"
            className={`shrink-0 h-8 px-3 rounded-lg text-xs font-semibold inline-flex items-center gap-1 transition-colors ${
              copied
                ? "bg-emerald-100 text-emerald-700"
                : "bg-surface-container-high text-on-surface hover:bg-surface-container"
            }`}
            onClick={salin}
          >
            <span className="material-symbols-outlined text-[14px]">{copied ? "check" : "content_copy"}</span>
            {copied ? "Tersalin" : "Salin"}
          </button>
        </div>
        {gagalSalin && (
          <p className="mt-1.5 text-[11px] text-on-error text-left">
            Gagal menyalin otomatis — salin manual dari kolom link di atas.
          </p>
        )}

        {/* Masa berlaku + status di BADAN kartu (bukan footer): informasi
            expired wajib terlihat tanpa scroll di layar kecil/mobile. */}
        <div className="mt-2.5 sm:mt-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 text-[11px] text-on-surface-variant">
          <span className="inline-flex items-center gap-1">
            <span className="material-symbols-outlined text-[13px]">event_available</span>
            Berlaku s/d <b className="font-semibold text-on-surface">{u.berlakuSampai}</b>
          </span>
          <span className="w-1 h-1 rounded-full bg-on-surface-variant/50" />
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold ${badgeUndangan(u.status)}`}>
            <span className="w-1.5 h-1.5 rounded-full bg-current opacity-60" />
            {u.status}
          </span>
        </div>

        {/* Tombol WhatsApp */}
        <a
          href={pesanWaUndangan(u).url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 w-full h-11 rounded-xl bg-gradient-to-r from-[#005b34] to-[#137547] text-white text-sm font-bold shadow-md hover:opacity-95 active:scale-[0.98] transition-all inline-flex items-center justify-center gap-2"
        >
          <span className="material-symbols-outlined text-[18px]">chat</span>
          Kirim via WhatsApp
        </a>
      </div>

      {/* Footer strip info — Token & riwayat kirim (masa berlaku sudah di badan) */}
      <div className="bg-surface-container-low border-t border-surface-container-high px-4 py-3 sm:px-6 sm:py-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs text-on-surface-variant">
        <span className="min-w-0 break-all">
          Token: <span className="font-mono font-bold text-on-surface">{u.token}</span>
        </span>
        <span>
          Dikirim <span className="font-semibold text-on-surface">{u.dibuat}</span>
        </span>
      </div>
    </div>
  );
}
