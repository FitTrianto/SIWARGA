import { Fragment, useEffect, useRef, useState } from "react";
import type { ClipboardEvent, FormEvent, KeyboardEvent } from "react";
import { GalatApi, aktivasiUndangan, detailUndangan } from "../../lib/api";
import type { DetailUndangan } from "../../lib/api";
import { badgeUndangan, maskWaAkhir, tanggalPendek } from "../../lib/undangan";
import type { StatusUndangan, Undangan } from "../../lib/undangan";
import { tenant } from "../../lib/tenant";

// ===========================================================================
// UNDANGAN PORTAL WARGA — halaman publik full-screen (dibuka via link/QR
// /undangan/<token>). Berdiri sendiri tanpa layout portal.
//
// Dua mode (fallback otomatis):
//  • PRODUKSI — backend menyala: GET detail undangan dari API lalu warga
//    MEMBUAT KATA SANDI (kebijakan Fase 3, NIST SP 800-63B). Galat API
//    (NOT_FOUND / TOKEN_EXPIRED / TOKEN_INVALID) diterjemahkan ke view
//    "tidak-berlaku" dengan pesan server.
//  • DEMO — backend mati (`OFFLINE`): token dicocokkan ke daftar lokal
//    `undanganList` lalu konfirmasi 4 digit terakhir no. HP seperti rancangan
//    awal; token tak dikenal → view "tidak-berlaku".
// ===========================================================================

type View = "memuat" | "konfirmasi" | "aktivasi" | "sukses" | "tidak-berlaku";
type Alasan = "tidak-ditemukan" | "kedaluwarsa" | "sudah-dipakai";
type Hasil = "ok" | "salah" | "tidak-ditemukan" | "kedaluwarsa";

/** Jumlah kotak OTP (mode demo — 4 digit terakhir no. HP). */
const KOTAK = 4;

const langkahDemo = ["Terima Undangan", "Konfirmasi Nomor", "Masuk Portal"];
const langkahApi = ["Terima Undangan", "Buat Kata Sandi", "Masuk Portal"];

const manfaat = [
  { icon: "groups", teks: "Perbarui data keluarga & KK" },
  { icon: "receipt_long", teks: "Pantau iuran dan tagihan RT" },
  { icon: "account_balance", teks: "Lihat laporan keuangan RT transparan" },
  { icon: "description", teks: "Ajukan surat pengantar digital" },
];

const chipDasar = [
  { icon: "gavel", label: "UU PDP No. 27/2022" },
  { icon: "cloud", label: "Data Terenkripsi" },
];

/** Tampilan undangan seragam — sumbernya API (mode produksi) atau daftar lokal (demo). */
interface InfoUndangan {
  nama: string;
  alamat: string;
  dikirimOleh: string;
  berlakuSampai: string;
  status: StatusUndangan;
}

export function UndanganPage(props: {
  token: string;
  undangan: Undangan[];
  onKonfirmasi: (token: string, empatDigit: string) => Hasil;
  /** Berhasil aktivasi — mode produksi mengirim identitas warga agar App dapat menyinkronkan status demo. */
  onMasukPortal: (aktif?: { nama: string; alamat: string }) => void;
  onKembali: () => void;
}): JSX.Element {
  const { token, undangan, onKonfirmasi, onMasukPortal, onKembali } = props;

  const [view, setView] = useState<View>("memuat");
  const [alasan, setAlasan] = useState<Alasan>("tidak-ditemukan");
  /** Pesan penolakan dari server (ditampilkan apa adanya di view tidak berlaku). */
  const [pesanGalat, setPesanGalat] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailUndangan | null>(null);
  /** true = backend mati & token cocok di daftar lokal (alur konfirmasi 4 digit). */
  const [modeDemo, setModeDemo] = useState(false);
  const [awalDipakai, setAwalDipakai] = useState(false);

  // — Form aktivasi (mode produksi) —
  const [kataSandi, setKataSandi] = useState("");
  const [ulangiSandi, setUlangiSandi] = useState("");
  const [consent, setConsent] = useState(false);
  const [lihatSandi, setLihatSandi] = useState(false);
  const [kirimAktivasi, setKirimAktivasi] = useState(false);
  const [galatForm, setGalatForm] = useState<string | null>(null);

  // — OTP 4 digit (mode demo) —
  const [kode, setKode] = useState<string[]>(() => Array.from({ length: KOTAK }, () => ""));
  const [checking, setChecking] = useState(false);
  const [salah, setSalah] = useState(false);
  /** Naik tiap kesalahan → remount baris OTP agar shake berulang. */
  const [errorKey, setErrorKey] = useState(0);

  const kotakRef = useRef<Array<HTMLInputElement | null>>([]);

  // Ambil detail dari API sekali saat halaman dibuka; fallback demo bila OFFLINE.
  useEffect(() => {
    let batal = false;
    void (async () => {
      try {
        const d = await detailUndangan(token);
        if (batal) return;
        setDetail(d);
        setView("aktivasi");
      } catch (err) {
        if (batal) return;
        const galat = err instanceof GalatApi ? err : null;
        if (galat?.code === "OFFLINE") {
          const u = undangan.find((x) => x.token === token);
          if (u && u.status !== "Kedaluwarsa") {
            setModeDemo(true);
            if (u.status === "Dipakai") {
              setAwalDipakai(true);
              setView("sukses");
            } else {
              setView("konfirmasi");
            }
            return;
          }
          setAlasan("tidak-ditemukan");
          setView("tidak-berlaku");
          return;
        }
        if (galat) {
          setAlasan(
            galat.code === "TOKEN_EXPIRED"
              ? "kedaluwarsa"
              : galat.code === "TOKEN_INVALID"
                ? "sudah-dipakai"
                : "tidak-ditemukan",
          );
          setPesanGalat(galat.message);
        } else {
          setAlasan("tidak-ditemukan");
        }
        setView("tidak-berlaku");
      }
    })();
    return () => {
      batal = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const uDemo = modeDemo ? undangan.find((x) => x.token === token) : undefined;
  const info: InfoUndangan | null = modeDemo
    ? uDemo
      ? {
          nama: uDemo.nama,
          alamat: uDemo.alamat,
          dikirimOleh: uDemo.dikirimOleh,
          berlakuSampai: uDemo.berlakuSampai,
          status: uDemo.status,
        }
      : null
    : detail
      ? {
          nama: detail.nama,
          alamat: detail.alamat,
          dikirimOleh: detail.dikirimOleh,
          berlakuSampai: tanggalPendek(detail.berlakuSampai),
          status: "Terkirim" as const,
        }
      : null;

  const langkah = modeDemo ? langkahDemo : langkahApi;
  const semuaSelesai = view === "sukses";
  const indeksAktif = semuaSelesai
    ? langkah.length
    : view === "konfirmasi" || view === "aktivasi"
      ? 1
      : 0;

  const pesanWa = encodeURIComponent(
    `Halo Pengurus RT, saya minta kirim ulang undangan Portal Warga terbaru. ` +
      `Alamat: ${info?.alamat ?? "-"} — Token: ${token || "-"} — ` +
      `${
        alasan === "kedaluwarsa"
          ? "undangan sudah kedaluwarsa"
          : alasan === "sudah-dipakai"
            ? "undangan sudah pernah dipakai/dicabut"
            : "link tidak ditemukan/sudah dicabut"
      }. Terima kasih.`
  );
  const urlWa = `https://wa.me/6281234567890?text=${pesanWa}`;

  // Auto-focus kotak OTP pertama saat masuk mode konfirmasi / setelah remount error.
  useEffect(() => {
    if (view === "konfirmasi") kotakRef.current[0]?.focus();
  }, [view, errorKey]);

  function kosongkan(): string[] {
    return Array.from({ length: KOTAK }, () => "");
  }

  function ubahDigit(i: number, raw: string) {
    const digit = raw.replace(/\D/g, "").slice(0, 1);
    if (salah) setSalah(false);
    setKode((prev) => {
      const next = [...prev];
      next[i] = digit;
      return next;
    });
    if (digit && i < KOTAK - 1) kotakRef.current[i + 1]?.focus();
  }

  function tekanOtp(i: number, e: KeyboardEvent<HTMLInputElement>) {
    // Backspace di kotak kosong → mundur ke kotak sebelumnya (dan pilih isinya).
    if (e.key === "Backspace" && kode[i] === "" && i > 0) {
      e.preventDefault();
      const sebelumnya = kotakRef.current[i - 1];
      sebelumnya?.focus();
      sebelumnya?.select();
    }
  }

  function tempelOtp(e: ClipboardEvent<HTMLInputElement>) {
    e.preventDefault();
    const bersih = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, KOTAK);
    if (!bersih) return;
    if (salah) setSalah(false);
    const next = kosongkan();
    bersih.split("").forEach((d, idx) => {
      next[idx] = d;
    });
    setKode(next);
    kotakRef.current[Math.min(bersih.length, KOTAK - 1)]?.focus();
  }

  /** Mode demo — verifikasi 4 digit terakhir no. HP terhadap daftar lokal. */
  function konfirmasi() {
    if (checking || kode.some((d) => d === "")) return;
    const isi = kode.join("");
    setChecking(true);
    setSalah(false);
    setTimeout(() => {
      const hasil: Hasil = onKonfirmasi(token, isi);
      setChecking(false);
      if (hasil === "ok") {
        setView("sukses");
        return;
      }
      if (hasil === "salah") {
        setKode(kosongkan());
        setSalah(true);
        setErrorKey((k) => k + 1);
        return;
      }
      // "tidak-ditemukan" / "kedaluwarsa" → langsung ke view tidak berlaku.
      setAlasan(hasil);
      setView("tidak-berlaku");
    }, 500);
  }

  /** Mode produksi — buat kata sandi lalu aktivasi via API. */
  function kirimFormAktivasi(e?: FormEvent) {
    e?.preventDefault();
    if (kirimAktivasi) return;
    setGalatForm(null);
    if (kataSandi.length < 8) {
      setGalatForm("Kata sandi minimal 8 karakter.");
      return;
    }
    if (kataSandi !== ulangiSandi) {
      setGalatForm("Ulangi kata sandi tidak sama.");
      return;
    }
    if (!consent) {
      setGalatForm("Persetujuan Syarat & Ketentuan dan Kebijakan Privasi wajib dicentang.");
      return;
    }
    setKirimAktivasi(true);
    void (async () => {
      try {
        await aktivasiUndangan(token, {
          password: kataSandi,
          konfirmasiPassword: ulangiSandi,
          consent: true,
        });
        setKataSandi("");
        setUlangiSandi("");
        setView("sukses");
      } catch (err) {
        const galat = err instanceof GalatApi ? err : null;
        if (
          galat &&
          (galat.code === "TOKEN_EXPIRED" ||
            galat.code === "TOKEN_INVALID" ||
            galat.code === "NOT_FOUND")
        ) {
          setAlasan(
            galat.code === "TOKEN_EXPIRED"
              ? "kedaluwarsa"
              : galat.code === "TOKEN_INVALID"
                ? "sudah-dipakai"
                : "tidak-ditemukan",
          );
          setPesanGalat(galat.message);
          setView("tidak-berlaku");
          return;
        }
        setGalatForm(galat ? galat.message : "Aktivasi gagal — silakan coba lagi.");
      } finally {
        setKirimAktivasi(false);
      }
    })();
  }

  /** Sapaan, info undangan, dan steps — hanya untuk undangan yang valid. */
  function kontenValid() {
    if (!info) return null;
    return (
      <>
        {/* 2. Sapaan */}
        <div className="anim-undangan-in text-center" style={{ animationDelay: "80ms" }}>
          <p className="text-[11px] uppercase tracking-[0.2em] text-emerald-700 font-bold text-center">
            Kepada Yth.
          </p>
          <p className="text-2xl font-extrabold text-slate-900 text-center mt-1.5">{info.nama}</p>
          <p className="text-sm text-slate-500 text-center mt-1">
            {info.alamat} • {tenant.label}
          </p>
        </div>

        {/* 3. Info pengirim & masa berlaku */}
        <div
          className="anim-undangan-in grid grid-cols-2 gap-2.5"
          style={{ animationDelay: "160ms" }}
        >
          <div className="bg-slate-50 border border-slate-100 rounded-xl px-3 py-2 min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Dikirim oleh
            </div>
            <div className="text-xs font-semibold text-slate-700 mt-0.5 truncate">
              {info.dikirimOleh}
            </div>
          </div>
          <div className="bg-slate-50 border border-slate-100 rounded-xl px-3 py-2 min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Berlaku s/d
            </div>
            <div className="font-mono text-xs font-semibold text-slate-700 mt-0.5">
              {info.berlakuSampai}
            </div>
          </div>
          <div className="col-span-2 bg-slate-50 border border-slate-100 rounded-xl px-3 py-2 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Token
              </div>
              <div className="font-mono text-xs font-semibold text-slate-700 break-all">
                {token}
              </div>
            </div>
            <span
              className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold ${badgeUndangan(info.status)}`}
            >
              {info.status}
            </span>
          </div>
        </div>

        {/* 4. Steps indicator */}
        <div className="anim-undangan-in pt-1" style={{ animationDelay: "240ms" }}>
          <div className="flex items-start">
            {langkah.map((label, i) => {
              const status =
                i < indeksAktif ? "selesai" : i === indeksAktif ? "aktif" : "pending";
              return (
                <Fragment key={label}>
                  {i > 0 && (
                    <div
                      className={`mt-[13px] h-0.5 flex-1 rounded-full ${
                        i <= indeksAktif ? "bg-emerald-500" : "bg-slate-200"
                      }`}
                    />
                  )}
                  <div className="flex flex-col items-center gap-1.5 shrink-0 w-[76px] sm:w-24">
                    <div
                      className={`w-7 h-7 rounded-full grid place-items-center text-[12px] font-bold ${
                        status === "selesai"
                          ? "bg-emerald-500 text-white"
                          : status === "aktif"
                            ? "bg-emerald-600 text-white ring-4 ring-emerald-100"
                            : "bg-slate-200 text-slate-500"
                      }`}
                    >
                      {status === "selesai" ? (
                        <span className="material-symbols-outlined text-[15px]">check</span>
                      ) : (
                        i + 1
                      )}
                    </div>
                    <span
                      className={`text-[10px] leading-tight text-center ${
                        status === "pending"
                          ? "text-slate-400"
                          : status === "aktif"
                            ? "text-emerald-700 font-bold"
                            : "font-semibold text-slate-700"
                      }`}
                    >
                      {label}
                    </span>
                  </div>
                </Fragment>
              );
            })}
          </div>
        </div>
      </>
    );
  }

  /** 5a. View memuat — menunggu respons GET detail undangan. */
  function kontenMemuat() {
    return (
      <div className="flex flex-col items-center gap-3 py-10">
        <span className="material-symbols-outlined text-[30px] text-emerald-600 animate-spin">
          progress_activity
        </span>
        <p className="text-sm font-medium text-slate-500">Memeriksa undangan…</p>
      </div>
    );
  }

  /** 5b. Form aktivasi (mode produksi) — buat kata sandi + persetujuan. */
  function kontenAktivasi() {
    if (!detail) return null;
    return (
      <form
        onSubmit={kirimFormAktivasi}
        className="anim-undangan-in space-y-3"
        style={{ animationDelay: "320ms" }}
      >
        <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-1.5">
          <span className="material-symbols-outlined text-[17px] text-emerald-700">password</span>
          Buat Kata Sandi Portal
        </h3>

        <p className="text-xs text-slate-600 leading-relaxed">
          Buat kata sandi untuk masuk Portal Warga — minimal{" "}
          <strong className="font-bold text-slate-900">8 karakter</strong>. Anda akan langsung
          masuk setelah kata sandi dibuat.
        </p>

        <div>
          <label
            htmlFor="aktivasi-sandi"
            className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1"
          >
            Kata Sandi
          </label>
          <input
            id="aktivasi-sandi"
            type={lihatSandi ? "text" : "password"}
            className="w-full h-12 rounded-xl border-2 border-slate-200 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100 outline-none bg-slate-50 px-3 text-sm font-semibold"
            value={kataSandi}
            onChange={(e) => {
              setKataSandi(e.target.value);
              if (galatForm) setGalatForm(null);
            }}
            autoComplete="new-password"
            maxLength={200}
          />
        </div>

        <div>
          <label
            htmlFor="aktivasi-ulangi"
            className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1"
          >
            Ulangi Kata Sandi
          </label>
          <input
            id="aktivasi-ulangi"
            type={lihatSandi ? "text" : "password"}
            className="w-full h-12 rounded-xl border-2 border-slate-200 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100 outline-none bg-slate-50 px-3 text-sm font-semibold"
            value={ulangiSandi}
            onChange={(e) => {
              setUlangiSandi(e.target.value);
              if (galatForm) setGalatForm(null);
            }}
            autoComplete="new-password"
            maxLength={200}
          />
        </div>

        <button
          type="button"
          onClick={() => setLihatSandi((v) => !v)}
          className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500 hover:text-emerald-700 transition-colors"
        >
          <span className="material-symbols-outlined text-[15px]">
            {lihatSandi ? "visibility_off" : "visibility"}
          </span>
          {lihatSandi ? "Sembunyikan kata sandi" : "Tampilkan kata sandi"}
        </button>

        {/* B14 — persetujuan eksplisit; teks tebal, tanpa tautan navigasi
            (agar fokus aktivasi tidak terpecah). */}
        <label className="flex items-start gap-2.5 bg-slate-50 border border-slate-100 rounded-xl px-3 py-2.5 cursor-pointer">
          <input
            type="checkbox"
            className="mt-0.5 w-4 h-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
            checked={consent}
            onChange={(e) => {
              setConsent(e.target.checked);
              if (galatForm) setGalatForm(null);
            }}
          />
          <span className="text-[11px] text-slate-600 leading-relaxed">
            Saya menyetujui <strong className="font-bold text-slate-900">Syarat &amp; Ketentuan</strong>{" "}
            dan <strong className="font-bold text-slate-900">Kebijakan Privasi</strong> SIWARGA
            serta memproses data saya sesuai UU PDP No. 27/2022.
          </span>
        </label>

        {galatForm && (
          <p
            role="alert"
            className="flex items-start gap-1.5 text-xs text-red-600 font-medium text-left"
          >
            <span className="material-symbols-outlined text-[16px] mt-px">error</span>
            <span>{galatForm}</span>
          </p>
        )}

        <button
          type="submit"
          disabled={kirimAktivasi || !kataSandi || !ulangiSandi || !consent}
          className={`w-full h-12 rounded-xl bg-gradient-to-r from-[#005b34] to-[#137547] text-white font-bold flex items-center justify-center gap-2 shadow-lg transition-all ${
            kirimAktivasi || !kataSandi || !ulangiSandi || !consent
              ? "opacity-40 cursor-not-allowed"
              : "hover:opacity-95 active:scale-[0.99]"
          }`}
        >
          {kirimAktivasi ? (
            <>
              <span className="material-symbols-outlined text-[20px] animate-spin">
                progress_activity
              </span>
              <span>Mengaktifkan…</span>
            </>
          ) : (
            <>
              <span>Aktifkan &amp; Masuk</span>
              <span className="material-symbols-outlined text-[20px]">arrow_forward</span>
            </>
          )}
        </button>

        <p className="text-[11px] text-slate-400 text-center leading-relaxed">
          Kata sandi di-hash argon2id — tidak dapat dilihat kembali • Data Anda diproses sesuai UU
          PDP No. 27/2022
        </p>
      </form>
    );
  }

  /** 5c. Konfirmasi 4 digit (mode demo — backend mati). */
  function kontenKonfirmasi() {
    if (!uDemo) return null;
    return (
      <div className="anim-undangan-in space-y-3" style={{ animationDelay: "320ms" }}>
        <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-1.5">
          <span className="material-symbols-outlined text-[17px] text-emerald-700">lock</span>
          Konfirmasi Keamanan
        </h3>

        <div>
          <p className="text-xs text-slate-600 leading-relaxed">
            Masukkan <strong className="font-bold text-slate-900">4 digit terakhir</strong> nomor
            HP Anda yang terdaftar:
          </p>
          <p className="font-mono text-xs text-slate-500 mt-1">
            Nomor terdaftar: {maskWaAkhir(uDemo.noWa)}
          </p>
        </div>

        {/* Baris OTP — key errorKey agar shake berulang tiap kesalahan. */}
        <div key={errorKey} className={salah ? "anim-undangan-shake" : ""}>
          <div className="flex gap-2 justify-center">
            {kode.map((digit, i) => (
              <input
                key={i}
                ref={(el) => {
                  kotakRef.current[i] = el;
                }}
                className={`w-11 h-[52px] sm:w-12 sm:h-14 text-center text-2xl font-bold font-mono rounded-xl border-2 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100 outline-none transition-all bg-slate-50 ${
                  salah ? "border-red-400" : "border-slate-200"
                }`}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                maxLength={1}
                aria-label={`Digit ${i + 1} dari 4`}
                aria-invalid={salah}
                value={digit}
                onChange={(e) => ubahDigit(i, e.target.value)}
                onKeyDown={(e) => tekanOtp(i, e)}
                onPaste={tempelOtp}
              />
            ))}
          </div>
          {salah && (
            <p
              role="alert"
              className="mt-2.5 flex items-start gap-1.5 text-xs text-red-600 font-medium text-left"
            >
              <span className="material-symbols-outlined text-[16px] mt-px">error</span>
              <span>
                4 digit tidak sesuai dengan nomor terdaftar. Periksa kembali ponsel Anda.
              </span>
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={konfirmasi}
          disabled={kode.some((d) => d === "") || checking}
          className={`w-full h-12 rounded-xl bg-gradient-to-r from-[#005b34] to-[#137547] text-white font-bold flex items-center justify-center gap-2 shadow-lg transition-all ${
            kode.some((d) => d === "") || checking
              ? "opacity-40 cursor-not-allowed"
              : "hover:opacity-95 active:scale-[0.99]"
          }`}
        >
          {checking ? (
            <>
              <span className="material-symbols-outlined text-[20px] animate-spin">
                progress_activity
              </span>
              <span>Memeriksa…</span>
            </>
          ) : (
            <>
              <span>Konfirmasi &amp; Aktifkan</span>
              <span className="material-symbols-outlined text-[20px]">arrow_forward</span>
            </>
          )}
        </button>

        <p className="text-[11px] text-slate-400 text-center leading-relaxed">
          Dilindungi konfirmasi 4 digit • Data Anda diproses sesuai UU PDP No. 27/2022
        </p>
      </div>
    );
  }

  /** 6. View sukses — aktivasi API berhasil, atau demo sudah "Dipakai"/konfirmasi benar. */
  function kontenSukses() {
    if (!info) return null;
    return (
      <div className="anim-undangan-in text-center space-y-4" style={{ animationDelay: "320ms" }}>
        <div className="mx-auto w-20 h-20 rounded-full bg-emerald-100 text-emerald-600 grid place-items-center text-5xl anim-undangan-pop">
          <span className="material-symbols-outlined">check_circle</span>
        </div>

        <div className="space-y-1.5">
          <h3 className="text-lg font-extrabold text-slate-900">
            {modeDemo ? "Konfirmasi Berhasil" : "Aktivasi Berhasil"}
          </h3>
          <p className="text-sm text-slate-600 leading-relaxed">
            {modeDemo ? (
              <>
                Undangan atas nama <strong className="font-bold text-slate-900">{info.nama}</strong>{" "}
                ({info.alamat}) telah terverifikasi.
              </>
            ) : (
              <>
                Portal atas nama <strong className="font-bold text-slate-900">{info.nama}</strong>{" "}
                ({info.alamat}) telah aktif. Kata sandi Anda sudah dibuat — gunakan No. HP dan kata
                sandi tersebut untuk masuk berikutnya.
              </>
            )}
          </p>
        </div>

        {awalDipakai && (
          <div className="flex items-start gap-2 text-left bg-sky-50 border border-sky-200 rounded-xl px-3 py-2.5">
            <span className="material-symbols-outlined text-[16px] text-sky-600 mt-px">info</span>
            <span className="text-xs text-sky-800 font-medium">
              Undangan ini sudah pernah dikonfirmasi sebelumnya — Anda tetap dapat masuk.
            </span>
          </div>
        )}

        <ul className="text-left bg-slate-50 border border-slate-100 rounded-2xl p-3 space-y-2">
          {manfaat.map((m) => (
            <li key={m.teks} className="flex items-center gap-2.5">
              <span className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-700 grid place-items-center shrink-0">
                <span className="material-symbols-outlined text-[16px]">{m.icon}</span>
              </span>
              <span className="text-xs font-semibold text-slate-700">{m.teks}</span>
            </li>
          ))}
        </ul>

        <div className="space-y-2">
          <button
            type="button"
            onClick={() =>
              onMasukPortal(
                modeDemo || !detail ? undefined : { nama: detail.nama, alamat: detail.alamat },
              )
            }
            className="w-full h-12 rounded-xl bg-gradient-to-r from-[#005b34] to-[#137547] text-white font-bold flex items-center justify-center gap-2 shadow-lg hover:opacity-95 active:scale-[0.99] transition-all"
          >
            <span>Masuk ke Portal Warga</span>
            <span className="material-symbols-outlined text-[19px]">login</span>
          </button>
          <button
            type="button"
            onClick={onKembali}
            className="w-full h-11 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-100 transition-colors"
          >
            Kembali ke Data Warga
          </button>
        </div>
      </div>
    );
  }

  /** 7. View tidak berlaku — token tak ditemukan, kedaluwarsa, atau sudah dipakai/dicabut. */
  function kontenTidakBerlaku() {
    const kedaluwarsa = alasan === "kedaluwarsa";
    const sudahDipakai = alasan === "sudah-dipakai";
    const judul = kedaluwarsa
      ? "Undangan Kedaluwarsa"
      : sudahDipakai
        ? "Undangan Tidak Dapat Dipakai"
        : "Undangan Tidak Ditemukan";
    const jatuh = kedaluwarsa
      ? "Masa berlaku undangan ini sudah berakhir. Minta pengurus RT mengirim undangan baru."
      : sudahDipakai
        ? "Undangan ini sudah pernah dipakai atau telah dicabut. Bila portal Anda belum aktif, minta undangan baru dari pengurus RT."
        : "Link yang dibuka tidak ditemukan atau sudah dicabut. Pastikan Anda membuka link/QR terbaru dari pengurus RT.";
    return (
      <div className="anim-undangan-in text-center space-y-4 py-2" style={{ animationDelay: "120ms" }}>
        <div className="mx-auto w-20 h-20 rounded-full bg-slate-100 text-slate-500 grid place-items-center">
          <span className="material-symbols-outlined text-4xl">
            {kedaluwarsa ? "schedule" : sudahDipakai ? "block" : "link_off"}
          </span>
        </div>

        <div className="space-y-1.5">
          <h3 className="text-lg font-extrabold text-slate-900">{judul}</h3>
          <p className="text-sm text-slate-600 leading-relaxed">{pesanGalat ?? jatuh}</p>
          <p className="font-mono text-[11px] text-slate-400">Token: {token || "—"}</p>
        </div>

        <div className="space-y-2">
          <a
            href={urlWa}
            target="_blank"
            rel="noreferrer"
            className="w-full h-12 rounded-xl bg-gradient-to-r from-[#005b34] to-[#137547] text-white font-bold flex items-center justify-center gap-2 shadow-lg hover:opacity-95 active:scale-[0.99] transition-all"
          >
            <span className="material-symbols-outlined text-[19px]">chat</span>
            <span>Hubungi Pengurus RT</span>
          </a>
          <button
            type="button"
            onClick={onKembali}
            className="w-full h-11 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-100 transition-colors"
          >
            Kembali ke Data Warga
          </button>
        </div>
      </div>
    );
  }

  const tidakBerlaku = view === "tidak-berlaku";
  const chips = [
    chipDasar[0],
    {
      icon: modeDemo ? "pin" : "password",
      label: modeDemo ? "Konfirmasi 4 Digit" : "Kata Sandi Argon2id",
    },
    chipDasar[1],
  ];

  return (
    <div className="min-h-dvh mesh-gradient relative overflow-hidden flex items-center justify-center px-4 py-10">
      {/* Blob dekoratif */}
      <div className="hero-glow-1 -top-24 -left-24" />
      <div className="hero-glow-2 -bottom-32 -right-20" />

      {/* Floating QR badge — sentuhan playful, hidden di mobile */}
      <div className="anim-undangan-float hidden md:flex absolute top-14 right-6 xl:right-24 z-20 items-center gap-2 bg-white/95 backdrop-blur-md border border-emerald-100/80 shadow-[0_12px_28px_rgba(0,0,0,0.08)] pl-3 pr-4 py-2 rounded-full">
        <span className="material-symbols-outlined text-[20px] text-emerald-600">qr_code_2</span>
        <span className="text-xs font-bold text-slate-700">Link &amp; QR</span>
      </div>

      <div className="relative z-10 w-full max-w-md">
        {/* Kartu utama */}
        <div className="relative w-full max-w-md bg-white/90 backdrop-blur-xl rounded-3xl shadow-2xl border border-white/60 overflow-hidden anim-undangan-in">
          {/* 1. Header */}
          <div className="bg-gradient-to-br from-emerald-600 via-teal-600 to-cyan-700 text-white p-6 relative text-center">
            <div className="absolute -top-8 -right-8 w-32 h-32 bg-white/10 rounded-full blur-2xl" />
            <div className="absolute -bottom-12 -left-8 w-32 h-32 bg-white/10 rounded-full blur-2xl" />
            <div className="relative">
              <div className="w-11 h-11 rounded-2xl bg-white/20 backdrop-blur grid place-items-center mx-auto">
                <span className="material-symbols-outlined text-[24px]">apartment</span>
              </div>
              <div className="mt-2.5 text-xl font-extrabold tracking-wide">SIWARGA</div>
              <span className="bg-white/20 px-3 py-1 rounded-full text-[11px] font-bold tracking-widest mt-3 inline-block">
                UNDANGAN RESMI
              </span>
              <p className="mt-2.5 text-[11px] text-white/80">
                Portal Warga • {tenant.perumahan} • {tenant.label}
              </p>
            </div>
          </div>

          {/* Body */}
          <div className="p-6 space-y-5">
            {view === "memuat" ? (
              kontenMemuat()
            ) : tidakBerlaku ? (
              kontenTidakBerlaku()
            ) : (
              <>
                {kontenValid()}
                {view === "sukses"
                  ? kontenSukses()
                  : view === "aktivasi"
                    ? kontenAktivasi()
                    : kontenKonfirmasi()}
              </>
            )}
          </div>
        </div>

        {/* Footer (di luar kartu) */}
        <footer className="mt-5 flex flex-col items-center gap-2.5">
          <div className="flex flex-wrap items-center justify-center gap-2">
            {chips.map((c) => (
              <span
                key={c.label}
                className="inline-flex items-center gap-1.5 bg-white/80 backdrop-blur-sm border border-slate-200/70 px-3 py-1.5 rounded-full text-[11px] text-slate-500"
              >
                <span className="material-symbols-outlined text-[14px] text-emerald-700">
                  {c.icon}
                </span>
                {c.label}
              </span>
            ))}
          </div>
          <p className="text-[11px] text-slate-500 text-center">© 2026 SIWARGA • {tenant.label}</p>
        </footer>
      </div>
    </div>
  );
}
