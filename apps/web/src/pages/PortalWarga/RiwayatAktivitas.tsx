import { useEffect, useState } from "react";
import { tenant } from "../../lib/tenant";
import {
  Pembayaran,
  Surat,
  TagihanTambahan,
  formatRupiah,
  hariIni,
  shortAlamat,
} from "../../lib/shared";
import { GalatApi, type EntriRiwayatLogin } from "../../lib/api";
import { useFlash } from "../../lib/useFlash";

interface RiwayatAktivitasProps {
  onNavigate?: (page: string) => void;
  pembayaran: Pembayaran[];
  surat: Surat[];
  tagihanTambahan: TagihanTambahan[];
  alamat: string;
  noKk: string;
  /**
   * B3 · riwayat login sendiri — API-first `GET /auth/warga/riwayat-login`:
   * OFFLINE → `null` (halaman memakai entri demo); galat lain DILEMPAR agar
   * pesannya tampil lewat `flash`, bukan disembunyikan.
   */
  onRiwayatLogin?: () => Promise<EntriRiwayatLogin[] | null>;
}

interface Activity {
  id: string;
  icon: string;
  iconColor: string;
  iconBg: string;
  title: string;
  description: string;
  date: string;
  time: string;
  category: string;
}

/** Arsip statis untuk aktivitas yang tidak berasal dari props (profil & data keluarga). */
const activitiesArsip: Activity[] = [
  { id: "a1", icon: "edit_note", iconColor: "text-primary", iconBg: "bg-primary-container/40", title: "Pembaruan Kontak WhatsApp", description: "Nomor WhatsApp keluarga berhasil diperbarui dan diverifikasi Pengurus RT", date: "17 Sep 2026", time: "09:15 WIB", category: "Profil" },
  { id: "a2", icon: "verified", iconColor: "text-secondary", iconBg: "bg-secondary-container/40", title: "Verifikasi NIK Anggota Keluarga", description: "Data NIK anggota keluarga berhasil diperbarui dan tervalidasi oleh Pengurus RT", date: "03 Sep 2026", time: "16:45 WIB", category: "Data Keluarga" },
  { id: "a3", icon: "photo_camera", iconColor: "text-primary", iconBg: "bg-primary-container/40", title: "Pembaruan Foto Profil", description: "Foto profil pemilik akun berhasil diperbarui", date: "25 Agu 2026", time: "13:20 WIB", category: "Profil" },
];

/** Entri Login mode demo — dipakai bila backend mati (OFFLINE) atau riwayat gagal dimuat. */
const loginDemo: Activity[] = [
  { id: "l1", icon: "login", iconColor: "text-secondary", iconBg: "bg-secondary-container/40", title: "Login Portal Warga", description: "Chrome (Windows) • IP 182.253.10.4 • sesi sedang berjalan di perangkat ini", date: "17 Sep 2026", time: "08:42 WIB", category: "Login" },
  { id: "l2", icon: "smartphone", iconColor: "text-primary", iconBg: "bg-primary-container/40", title: "Login dari Jakarta Selatan", description: "Safari (iPhone) • IP 114.124.20.9 • sesi sudah dicabut", date: "09 Sep 2026", time: "19:10 WIB", category: "Login" },
];

const categoryColors: Record<string, string> = {
  Profil: "bg-primary-container/20 text-primary",
  Iuran: "bg-secondary-container/40 text-secondary",
  Surat: "bg-surface-container-high text-on-surface-variant",
  "Data Keluarga": "bg-primary-container/20 text-primary",
  Tagihan: "bg-tertiary-container/40 text-tertiary",
  Login: "bg-secondary-container/40 text-secondary",
};

/** Baris riwayat login server → satu entri timeline kategori "Login" (B3). */
function loginKeAktivitas(s: EntriRiwayatLogin, i: number): Activity {
  const d = new Date(s.waktu);
  const sah = !Number.isNaN(d.getTime());
  const tanggal = sah
    ? d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })
    : "-";
  const jam = sah ? d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) : "";
  const rincian = [
    s.perangkat ?? "Perangkat tidak dikenal",
    s.ip ? `IP ${s.ip}` : null,
    s.dicabut
      ? "sesi sudah dicabut"
      : s.sesiIni
        ? "sesi sedang berjalan di perangkat ini"
        : "sesi sudah berakhir",
  ]
    .filter((x): x is string => !!x)
    .join(" • ");
  return {
    id: `login-${i}-${s.masukPada}`,
    icon: s.sesiIni ? "login" : "smartphone",
    iconColor: s.sesiIni ? "text-secondary" : "text-primary",
    iconBg: s.sesiIni ? "bg-secondary-container/40" : "bg-primary-container/40",
    title: s.sesiIni
      ? "Login — sesi ini"
      : s.kota
        ? `Login dari ${s.kota}`
        : "Login Portal Warga",
    description: rincian,
    date: tanggal,
    time: jam ? `${jam} WIB` : "",
    category: "Login",
  };
}

/** Parse tanggal Indonesia ("05 Sep 2026" / "01 September 2026") → angka untuk sortir. */
const NAMA_BULAN: Record<string, number> = {
  jan: 0, januari: 0, feb: 1, februari: 1, mar: 2, maret: 2, apr: 3, april: 3,
  mei: 4, jun: 5, juni: 5, jul: 6, juli: 6, agu: 7, agustus: 7, sep: 8, september: 8,
  okt: 9, oktober: 9, nov: 10, november: 10, des: 11, desember: 11,
};

function urutTanggal(date: string, time: string): number {
  const [d, m, y] = date.trim().split(/\s+/);
  const bulan = NAMA_BULAN[(m ?? "").toLowerCase()] ?? 0;
  const jam = time.match(/(\d{2}):(\d{2})/);
  const t = new Date(Number(y) || 0, bulan, Number(d) || 1, Number(jam?.[1] ?? 0), Number(jam?.[2] ?? 0));
  return t.getTime();
}

export function RiwayatAktivitas({ onNavigate, pembayaran, surat, tagihanTambahan, alamat, noKk, onRiwayatLogin }: RiwayatAktivitasProps) {
  const [filter, setFilter] = useState<string>("Semua");
  // B3 · `null` = belum dimuat / OFFLINE → entri Login mode demo dipakai.
  const [riwayatLogin, setRiwayatLogin] = useState<EntriRiwayatLogin[] | null>(null);
  const { flash, toast } = useFlash();

  // B3 · API-first: sekali per kunjungan halaman. OFFLINE → senyap (entri demo);
  // galat lain → flash + entri demo tetap tampil. Handler App tidak dimemoisasi
  // → dependensi `[]` + eslint-disable agar tidak memuat ulang tiap render.
  useEffect(() => {
    if (!onRiwayatLogin) return;
    onRiwayatLogin()
      .then((d) => {
        if (d) setRiwayatLogin(d);
      })
      .catch((e) => flash(e instanceof GalatApi ? e.message : "Gagal memuat riwayat login."))
      .finally(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Aktivitas derive dari props (bukan seed lokal).
  const pembayaranWarga = pembayaran.filter((p) => shortAlamat(p.alamat) === shortAlamat(alamat));
  const suratWarga = noKk ? surat.filter((s) => s.noKk === noKk) : [];
  const tagihanLunas = tagihanTambahan.filter((t) => t.status === "Lunas");

  const activities: Activity[] = [
    ...pembayaranWarga.map((p) => ({
      id: `pay-${p.id}`,
      icon: p.metodeIcon,
      iconColor: p.status === "Lunas" ? "text-secondary" : "text-primary",
      iconBg: p.status === "Lunas" ? "bg-secondary-container/40" : "bg-primary-container/40",
      title: `Pembayaran Iuran ${p.periode}`,
      description: `Pembayaran ${formatRupiah(p.jumlah)} via ${p.metode}${p.paket ? ` (paket ${p.paket})` : ""} — status ${p.status}`,
      date: p.tanggal,
      time: "",
      category: "Iuran",
    })),
    ...suratWarga.map((s) => ({
      id: `surat-${s.id}`,
      icon: "description",
      iconColor: "text-primary",
      iconBg: "bg-primary-container/40",
      title: `${s.jenis} ${s.status === "Disetujui" ? "Disetujui" : "Diajukan"}`,
      description: `${s.keperluan} — ${s.status}${s.noSurat ? ` (${s.noSurat})` : ""} di ${tenant.rtFull}`,
      date: s.tanggal,
      time: "",
      category: "Surat",
    })),
    ...tagihanLunas.map((t) => ({
      id: `tagihan-${t.id}`,
      icon: "receipt_long",
      iconColor: "text-tertiary",
      iconBg: "bg-tertiary-container/40",
      title: `${t.nama} Lunas`,
      description: `Tagihan tambahan ${formatRupiah(t.nominal)} (${t.ref}) telah dibayar`,
      date: hariIni(),
      time: "",
      category: "Tagihan",
    })),
    // B3 · riwayat login: server jadi sumber kebenaran; OFFLINE/gagal → demo.
    ...(riwayatLogin ? riwayatLogin.map(loginKeAktivitas) : loginDemo),
    ...activitiesArsip,
  ].sort((a, b) => urutTanggal(b.date, b.time) - urutTanggal(a.date, a.time));

  const categories = ["Semua", "Profil", "Iuran", "Surat", "Tagihan", "Data Keluarga", "Login"];
  const filtered = filter === "Semua" ? activities : activities.filter((a) => a.category === filter);

  return (
    <div className="min-h-dvh bg-background font-body-md text-on-surface antialiased">
      {/* Toast (galat API riwayat login dsb.) */}
      {toast}
      <div className="max-w-7xl mx-auto px-4 md:px-6 lg:px-8 py-6 flex flex-col gap-6">
        {/* Breadcrumbs & Header */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 text-on-surface-variant text-xs">
            <button type="button" className="hover:text-primary transition-colors flex items-center gap-1" onClick={() => onNavigate?.("portal-warga")}><span className="material-symbols-outlined text-[16px]">home</span>
              Portal Warga
            </button>
            <span className="material-symbols-outlined text-[14px]">chevron_right</span>
            <span className="text-primary font-bold">Riwayat Aktivitas</span>
          </div>
          <div className="pt-1">
            <h1 className="text-2xl lg:text-[32px] text-on-surface tracking-tight font-extrabold">
              Riwayat Aktivitas
            </h1>
            <p className="text-sm text-on-surface-variant leading-relaxed mt-1">
              Semua aktivitas Anda di Portal Warga tercatat otomatis untuk keperluan audit dan transparansi.
            </p>
          </div>
        </div>

        {/* Filter */}
        <div className="flex flex-wrap items-center gap-1.5">
          {categories.map((c) => (
            <button
              key={c}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                filter === c ? "bg-primary text-on-primary shadow-sm" : "bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container-high"
              }`}
              onClick={() => setFilter(c)}
            >
              {c}
            </button>
          ))}
        </div>

        {/* Timeline */}
        <div className="relative">
          <div className="absolute left-[19px] top-0 bottom-0 w-px bg-outline-variant/20" />
          <div className="flex flex-col gap-1">
            {filtered.map((a) => (
              <div key={a.id} className="relative flex items-start gap-4 pl-0 py-3">
                <div className={`relative z-10 w-10 h-10 rounded-xl ${a.iconBg} ${a.iconColor} flex items-center justify-center shrink-0 shadow-sm`}>
                  <span className="material-symbols-outlined text-[20px]">{a.icon}</span>
                </div>
                <div className="flex-1 rounded-2xl bg-surface-container-lowest shadow-sm p-4 flex flex-col gap-2">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <span className="text-sm font-bold text-on-surface">{a.title}</span>
                    <div className="flex items-center gap-2">
                      <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${categoryColors[a.category] || "bg-surface-container-high text-on-surface-variant"}`}>
                        {a.category}
                      </span>
                      <span className="text-[11px] text-on-surface-variant">{a.time ? `${a.date} • ${a.time}` : a.date}</span>
                    </div>
                  </div>
                  <p className="text-xs text-on-surface-variant leading-relaxed">{a.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {filtered.length === 0 && (
          <div className="rounded-2xl bg-surface-container-lowest shadow-sm p-10 flex flex-col items-center gap-3 text-center">
            <span className="material-symbols-outlined text-[48px] text-on-surface-variant/30">history</span>
            <span className="text-sm font-bold text-on-surface-variant">Tidak ada aktivitas ditemukan</span>
            <span className="text-xs text-on-surface-variant">Coba ubah filter kategori</span>
          </div>
        )}
      </div>
    </div>
  );
}
