import { useState } from "react";
import type { FormEvent } from "react";
import { GalatApi, aktivasiAkunRt } from "../lib/api";
import type { HasilAktivasiRt, ProfilLogin } from "../lib/api";
import { tenant } from "../lib/tenant";

// ===========================================================================
// AKTIVASI AKUN PENGURUS RT (halaman PUBLIK) — dibuka lewat path
// `/aktivasi-rt/<token>` dari tautan hasil pendaftaran mandiri (Batch 17).
//
// Alur jujur (instruksi tanpa data palsu):
//   • pendaftaran SUDAH tersimpan di server (baris antrean) — halaman ini
//     menukar tautan `<id>.<kode>` jadi akun pengurus + provisioning tenant;
//   • OFFLINE → kartu "belum diproses, data tidak berubah" + tombol coba lagi
//     (TIDAK PERNAH mengklaim aktivasi berhasil tanpa balasan server);
//   • sukses HANYA dari balasan `POST /publik/aktivasi` — kartu sukses membawa
//     nama/email hasil login server, lalu tombol masuk memakai sesi yang sudah
//     terpasang (auto-login, pola sama aktivasi warga Fase 3).
// ===========================================================================

interface Props {
  token: string;
  onKembali: () => void;
  /** Akun aktif + sesi terpasang di server → portlet memanggil ini untuk masuk. */
  onLogin: (profil: ProfilLogin) => void;
}

export function AktivasiRtPage({ token, onKembali, onLogin }: Props): JSX.Element {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [konfirmasi, setKonfirmasi] = useState("");
  const [kirim, setKirim] = useState(false);
  /** Pesan galat server / validasi — ditampilkan apa adanya. */
  const [galat, setGalat] = useState("");
  const [hasil, setHasil] = useState<HasilAktivasiRt | null>(null);

  const tanpaToken = !token.trim();

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setGalat("");

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setGalat("Format email tidak valid — email menjadi ID login Anda.");
      return;
    }
    if (password.length < 8) {
      setGalat("Kata sandi minimal 8 karakter.");
      return;
    }
    if (password !== konfirmasi) {
      setGalat("Ulangi kata sandi tidak sama.");
      return;
    }

    setKirim(true);
    try {
      const h = await aktivasiAkunRt({
        token,
        email: email.trim(),
        password,
        konfirmasiPassword: konfirmasi,
      });
      setHasil(h);
    } catch (err) {
      if (err instanceof GalatApi && err.code === "OFFLINE") {
        setGalat(
          "Server SIWARGA tidak terjangkau — aktivasi BELUM diproses dan data Anda tidak berubah. Periksa koneksi lalu coba lagi.",
        );
      } else {
        setGalat(
          err instanceof GalatApi
            ? err.message
            : "Aktivasi gagal dijalankan — coba lagi beberapa saat.",
        );
      }
    } finally {
      setKirim(false);
    }
  }

  const tokenPendek =
    token.length > 44 ? `${token.slice(0, 20)}…${token.slice(-14)}` : token;

  return (
    <div className="min-h-dvh bg-background font-body-md text-on-surface antialiased">
      {/* Header publik — identik gaya halaman verifikasi surat (branding SIWARGA). */}
      <header className="border-b border-outline-variant/30 bg-surface-container-lowest">
        <div className="max-w-3xl mx-auto px-4 md:px-6 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-on-primary text-[20px]">app_registration</span>
            </div>
            <div className="leading-tight">
              <div className="text-sm font-extrabold tracking-tight">SIWARGA</div>
              <div className="text-[11px] text-on-surface-variant">
                Aktivasi Akun Pengurus RT
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
            <span className="material-symbols-outlined text-[16px]">key</span>
            Langkah Terakhir Pendaftaran
          </div>
          <h1 className="text-2xl lg:text-[30px] tracking-tight font-extrabold">
            Aktivasi Akun Pengurus RT
          </h1>
          <p className="text-sm text-on-surface-variant leading-relaxed">
            Pendaftaran RT Anda sudah diterima. Buat kata sandi akun Pengurus RT
            di bawah ini — setelah aktif, RT dan akun Anda langsung tersedia dan
            Anda masuk ke portal.
          </p>
        </div>

        {/* — Tautan tidak terbawa (bukan lewat link pendaftaran) — */}
        {tanpaToken && (
          <section className="rounded-2xl bg-error-container/25 border border-error/40 p-6 space-y-3">
            <div className="flex items-start gap-3">
              <div className="w-11 h-11 rounded-full bg-error text-on-error flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-[24px]">link_off</span>
              </div>
              <div className="space-y-1">
                <h2 className="text-base font-extrabold">Tautan Aktivasi Tidak Valid</h2>
                <p className="text-sm text-on-surface-variant leading-relaxed">
                  Halaman ini harus dibuka lewat tautan aktivasi yang diberikan
                  setelah pendaftaran. Kembali ke beranda lalu isi formulir
                  pendaftaran untuk mendapat tautan baru.
                </p>
              </div>
            </div>
            <button
              type="button"
              className="h-11 px-6 rounded-xl bg-primary text-on-primary text-sm font-bold shadow-md hover:bg-primary-container active:scale-[0.98] transition-all"
              onClick={onKembali}
            >
              Kembali ke Beranda
            </button>
          </section>
        )}

        {/* — Aktivasi sukses (hanya dari balasan server) — */}
        {!tanpaToken && hasil && (
          <section className="rounded-2xl bg-secondary-container/30 border border-secondary/40 shadow-sm p-6 space-y-4">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-full bg-secondary text-on-secondary flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-[26px]">verified</span>
              </div>
              <div className="space-y-1">
                <h2 className="text-lg font-extrabold">Akun Aktif — Selamat Datang</h2>
                <p className="text-sm text-on-surface-variant leading-relaxed">
                  Akun Pengurus RT atas nama{" "}
                  <span className="font-bold text-on-surface">{hasil.nama}</span>{" "}
                  (<span className="font-mono">{hasil.email}</span>) sudah aktif
                  beserta data RT-nya. Tekan tombol di bawah untuk masuk ke
                  Portal RT — sesi Anda sudah terpasang.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                className="h-11 px-6 rounded-xl bg-primary text-on-primary text-sm font-bold shadow-md hover:bg-primary-container active:scale-[0.98] transition-all inline-flex items-center gap-2"
                onClick={() =>
                  onLogin({ peran: "rt_admin", nama: hasil.nama, email: hasil.email })
                }
              >
                <span className="material-symbols-outlined text-[18px]">dashboard</span>
                Masuk ke Portal RT
              </button>
            </div>
          </section>
        )}

        {/* — Formulir kata sandi — */}
        {!tanpaToken && !hasil && (
          <section className="rounded-2xl bg-surface-container-lowest shadow-sm border border-outline-variant/30 p-6">
            <form className="space-y-4" onSubmit={handleSubmit}>
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-on-surface-variant block" htmlFor="aktivasi-email">
                  Email (ID Login)
                </label>
                <input
                  autoComplete="email"
                  className="w-full px-4 py-3 bg-background border border-outline-variant/60 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                  id="aktivasi-email"
                  placeholder="contoh: rtanda@desa.id"
                  required
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <p className="text-[11px] text-on-surface-variant">
                  Email ini dipakai untuk masuk ke Portal RT (bisa diganti nanti
                  oleh pengurus).
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase tracking-wider text-on-surface-variant block" htmlFor="aktivasi-sandi">
                    Kata Sandi
                  </label>
                  <input
                    autoComplete="new-password"
                    className="w-full px-4 py-3 bg-background border border-outline-variant/60 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                    id="aktivasi-sandi"
                    minLength={8}
                    placeholder="Min. 8 karakter"
                    required
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase tracking-wider text-on-surface-variant block" htmlFor="aktivasi-ulang">
                    Ulangi Kata Sandi
                  </label>
                  <input
                    autoComplete="new-password"
                    className="w-full px-4 py-3 bg-background border border-outline-variant/60 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                    id="aktivasi-ulang"
                    minLength={8}
                    placeholder="Ketik ulang kata sandi"
                    required
                    type="password"
                    value={konfirmasi}
                    onChange={(e) => setKonfirmasi(e.target.value)}
                  />
                </div>
              </div>
              <p className="text-[11px] text-on-surface-variant">
                Minimal 8 karakter dan bukan kata sandi yang sangat umum.
              </p>

              {galat && (
                <div
                  className="rounded-xl bg-error-container/30 border border-error/40 px-4 py-3 text-sm text-on-surface flex items-start gap-2"
                  role="alert"
                >
                  <span className="material-symbols-outlined text-[18px] text-error mt-0.5">error</span>
                  <span>{galat}</span>
                </div>
              )}

              <button
                className="w-full h-12 rounded-xl bg-primary text-on-primary text-sm font-bold shadow-md hover:bg-primary-container active:scale-[0.99] transition-all inline-flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
                disabled={kirim}
                type="submit"
              >
                <span className="material-symbols-outlined text-[18px]">
                  {kirim ? "progress_activity" : "lock"}
                </span>
                {kirim ? "Mengaktifkan…" : "Aktifkan Akun & Buka Portal"}
              </button>
            </form>
          </section>
        )}

        <p className="text-[11px] text-on-surface-variant leading-relaxed break-all">
          Tautan: <span className="font-mono">{tokenPendek || "—"}</span> —
          berlaku 24 jam sejak pendaftaran dan hanya dapat dipakai sekali.
          Pendaftaran ulang RT yang sama menerbitkan tautan baru.
        </p>
        <p className="text-[11px] text-on-surface-variant leading-relaxed">
          Data pendaftaran mengikuti Ketentuan Layanan &amp; UU PDP No. 27/2022
          yang Anda setujui pada formulir pendaftaran {tenant.label}.
        </p>
      </main>
    </div>
  );
}
