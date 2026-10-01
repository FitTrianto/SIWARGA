import { useCallback, useEffect, useState } from "react";
import { GalatApi, verifikasiSuratPublik } from "../lib/api";
import type { HasilVerifikasiSurat } from "../lib/api";
import { tenant } from "../lib/tenant";

// ===========================================================================
// VERIFIKASI SURAT (halaman PUBLIK) — dibuka lewat path `/q/<token>` hasil
// pemindaian QR pada surat terbit, mengikuti pola halaman `/undangan/<token>`
// (berdiri sendiri, tanpa layout portal & tanpa sesi).
//
// Kontrak §5.7: `GET /publik/verifikasi-surat/:qrToken` SELALU menjawab 200
// dengan `{ valid }` (anti-enumerasi). Halaman ini tidak pernah menyimpulkan
// keaslian sendiri — yang tampil adalah jawaban server apa adanya:
//   • `valid: true`  → kartu hijau + data minimum surat dari server;
//   • `valid: false` → kartu merah + `alasan` dari server;
//   • OFFLINE        → kartu abu "tidak dapat diverifikasi" + tombol coba lagi
//                      (TIDAK PERNAH mengklaim sah/tidak sah tanpa server).
// ===========================================================================

type View = "memuat" | "hasil" | "offline";

/** Baris data ditampilkan hanya saat server menyatakan `valid: true`. */
const LABEL: Array<{
  key: "noSurat" | "jenis" | "pemohon" | "terbitPada";
  label: string;
}> = [
  { key: "noSurat", label: "Nomor Surat" },
  { key: "jenis", label: "Jenis Surat" },
  { key: "pemohon", label: "Nama Pemohon" },
  { key: "terbitPada", label: "Tanggal Terbit" },
];

/** ISO → "01 September 2026" (tanpa geser zona — sama dengan `tanggalPanjang` FE). */
const BULAN = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];
function tanggalPanjang(iso: string | null): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]} ${BULAN[Number(m[2]) - 1]} ${m[1]}` : iso;
}

export function VerifikasiSuratPage(props: { token: string; onKembali: () => void }): JSX.Element {
  const { token, onKembali } = props;
  const [view, setView] = useState<View>("memuat");
  const [hasil, setHasil] = useState<HasilVerifikasiSurat | null>(null);
  /** Pesan galat non-OFFLINE (jaringan lain) — ditampilkan apa adanya. */
  const [pesanGalat, setPesanGalat] = useState<string | null>(null);

  const muat = useCallback(async (): Promise<void> => {
    setView("memuat");
    setPesanGalat(null);
    try {
      const h = await verifikasiSuratPublik(token);
      setHasil(h);
      setView("hasil");
    } catch (err) {
      if (err instanceof GalatApi && err.code === "OFFLINE") {
        setHasil(null);
        setView("offline");
        return;
      }
      setPesanGalat(err instanceof GalatApi ? err.message : "Verifikasi gagal dijalankan.");
      setHasil(null);
      setView("offline");
    }
  }, [token]);

  useEffect(() => {
    void muat();
  }, [muat]);

  const valid = hasil?.valid === true;
  const surat = hasil?.surat;

  return (
    <div className="min-h-dvh bg-background font-body-md text-on-surface antialiased">
      {/* Header publik — identik gaya halaman undangan (branding SIWARGA). */}
      <header className="border-b border-outline-variant/30 bg-surface-container-lowest">
        <div className="max-w-3xl mx-auto px-4 md:px-6 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-on-primary text-[20px]">verified_user</span>
            </div>
            <div className="leading-tight">
              <div className="text-sm font-extrabold tracking-tight">SIWARGA</div>
              <div className="text-[11px] text-on-surface-variant">
                Verifikasi Surat {tenant.label}
              </div>
            </div>
          </div>
          <button
            type="button"
            className="h-9 px-3 rounded-xl text-xs font-bold text-on-surface-variant hover:bg-surface-container-high transition-colors inline-flex items-center gap-1"
            onClick={onKembali}
          >
            <span className="material-symbols-outlined text-[16px]">arrow_back</span>
            Beranda
          </button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 md:px-6 py-8 flex flex-col gap-5">
        <div className="space-y-1.5">
          <div className="inline-flex items-center gap-1.5 text-primary text-sm font-bold uppercase tracking-wider">
            <span className="material-symbols-outlined text-[16px]">qr_code_scanner</span>
            Pemeriksaan QR
          </div>
          <h1 className="text-2xl lg:text-[30px] tracking-tight font-extrabold">
            Verifikasi Keaslian Surat
          </h1>
          <p className="text-sm text-on-surface-variant leading-relaxed">
            Halaman ini memeriksa token QR yang tertera pada surat terbit terhadap catatan resmi
            Platform SIWARGA. Hasil pemeriksaan disajikan sepenuhnya sesuai jawaban server.
          </p>
        </div>

        {/* — Memuat — */}
        {view === "memuat" && (
          <section className="rounded-2xl bg-surface-container-lowest shadow-sm p-8 flex flex-col items-center gap-3">
            <span className="material-symbols-outlined text-[36px] text-primary animate-spin">
              progress_activity
            </span>
            <p className="text-sm font-semibold">Memeriksa token terhadap catatan surat…</p>
            <p className="text-xs text-on-surface-variant font-mono break-all text-center">
              {token}
            </p>
          </section>
        )}

        {/* — Hasil pemeriksaan — */}
        {view === "hasil" && hasil && (
          <section
            className={`rounded-2xl shadow-sm overflow-hidden border ${
              valid
                ? "bg-secondary-container/30 border-secondary/40"
                : "bg-error-container/25 border-error/40"
            }`}
          >
            <div className="p-6 flex items-start gap-4">
              <div
                className={`w-12 h-12 rounded-full flex items-center justify-center shrink-0 ${
                  valid ? "bg-secondary text-on-secondary" : "bg-error text-on-error"
                }`}
              >
                <span className="material-symbols-outlined text-[26px]">
                  {valid ? "verified" : "gpp_bad"}
                </span>
              </div>
              <div className="space-y-1">
                <h2 className="text-lg font-extrabold">
                  {valid ? "Surat Terverifikasi" : "Surat Tidak Terbukti Sah"}
                </h2>
                <p className="text-sm text-on-surface-variant leading-relaxed">
                  {valid
                    ? "Token ini tercatat pada sistem SIWARGA dan suratnya berstatus terbit."
                    : hasil.alasan ??
                      "Token ini tidak ditemukan pada catatan surat sistem SIWARGA."}
                </p>
              </div>
            </div>

            {valid && surat && (
              <div className="bg-surface-container-lowest border-t border-outline-variant/30 p-6 space-y-3">
                <div className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
                  Data Surat
                </div>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
                  {LABEL.map(({ key, label }) => {
                    const nilai = surat[key];
                    const teks =
                      key === "terbitPada"
                        ? tanggalPanjang(nilai as string | null)
                        : String(nilai ?? "—");
                    return (
                      <div key={key} className="flex flex-col">
                        <dt className="text-[11px] text-on-surface-variant uppercase tracking-wider">
                          {label}
                        </dt>
                        <dd className="text-sm font-semibold break-words">{teks}</dd>
                      </div>
                    );
                  })}
                  <div className="flex flex-col sm:col-span-2">
                    <dt className="text-[11px] text-on-surface-variant uppercase tracking-wider">
                      Terbit di
                    </dt>
                    <dd className="text-sm font-semibold">
                      RT {surat.rt.kodeRt} / RW {surat.rt.kodeRw} — Kel. {surat.rt.kelurahan}
                      {surat.rt.perumahan ? ` (${surat.rt.perumahan})` : ""}
                    </dd>
                  </div>
                </dl>
                <p className="text-[11px] text-on-surface-variant leading-relaxed pt-1 border-t border-outline-variant/30">
                  Pemeriksaan ini hanya membandingkan token dengan catatan server; tidak ada data
                  pribadi pemohon (NIK, No. KK, keperluan) yang ditampilkan.
                </p>
              </div>
            )}
          </section>
        )}

        {/* — Tidak dapat diperiksa (backend mati / galat jaringan) — */}
        {view === "offline" && (
          <section className="rounded-2xl bg-surface-container-lowest shadow-sm border border-outline-variant/30 p-6 space-y-3">
            <div className="flex items-start gap-3">
              <div className="w-11 h-11 rounded-full bg-surface-container-high flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-[24px] text-on-surface-variant">
                  cloud_off
                </span>
              </div>
              <div className="space-y-1">
                <h2 className="text-base font-extrabold">Belum Dapat Diverifikasi</h2>
                <p className="text-sm text-on-surface-variant leading-relaxed">
                  {pesanGalat ??
                    "Server SIWARGA tidak terjangkau dari jaringan Anda. Keaslian surat ini BELUM bisa dipastikan — coba lagi beberapa saat lagi."}
                </p>
              </div>
            </div>
            <p className="text-xs text-on-surface-variant font-mono break-all">{token}</p>
            <div className="flex flex-wrap gap-3 pt-1">
              <button
                type="button"
                className="h-11 px-6 rounded-xl bg-primary text-on-primary text-sm font-bold shadow-md hover:bg-primary-container active:scale-[0.98] transition-all inline-flex items-center gap-2"
                onClick={() => void muat()}
              >
                <span className="material-symbols-outlined text-[18px]">refresh</span>
                Coba Lagi
              </button>
              <button
                type="button"
                className="h-11 px-5 rounded-xl text-sm text-on-surface-variant hover:bg-surface-container-high transition-colors"
                onClick={onKembali}
              >
                Kembali ke Beranda
              </button>
            </div>
          </section>
        )}

        <p className="text-[11px] text-on-surface-variant leading-relaxed">
          Token bersifat publik dan hanya mengarah ke pemeriksaan status surat. Laporkan ketidakcocokan
          dokumen fisik dengan hasil pemeriksaan ini kepada Pengurus {tenant.rtFull} {tenant.rwFull}.
        </p>
      </main>
    </div>
  );
}
