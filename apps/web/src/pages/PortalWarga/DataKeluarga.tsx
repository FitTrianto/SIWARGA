import { useState, useEffect, type FormEvent } from "react";
import { tenant } from "../../lib/tenant";
import {
  FamilyMember, KkData, MemberFilter, formatRupiah, kategoriIuranDefault, maskedNoKk, memberWaValue, shortAlamat, waDigitsFromMember,
  ajuanPerubahanDefault, LABEL_JENIS_AJUAN, LABEL_STATUS_AJUAN, KIRI_AJUAN,
  type AjuanPerubahan, type JenisAjuan,
} from "../../lib/shared";
import { GalatApi, type PatchKontakKeluarga } from "../../lib/api";
import { useFlash } from "../../lib/useFlash";

// Tipe KK/keluarga berada di lib/shared.ts (sumber kebenaran tunggal).
export type { FamilyMember, KkData, MemberFilter };

export const NIK_LENGTH = 16;
export const KK_LENGTH = 16;
export const PHONE_MIN = 10;
export const PHONE_MAX = 13;

export function onlyDigits(v: string): string {
  return v.replace(/\D/g, "");
}

interface DataKeluargaProps {
  onNavigate?: (page: string) => void;
  kkList?: KkData[];
  onKkAdded?: (kk: KkData) => void;
  onKkUpdated?: (kkId: string, patch: Partial<KkData>) => void;
  /**
   * F-6 · simpan kontak anggota via API (`POST /warga/keluarga/:id/kontak`).
   * Induk (App) menangani API-first + fallback OFFLINE; galat lain DITERUSKAN →
   * halaman menampilkan gagal. Anggota tanpa `idWarga` (demo/ketik lokal) tidak
   * memakai jalur ini.
   */
  onSimpanKontak?: (idWarga: string, patch: PatchKontakKeluarga) => Promise<void>;
  /**
   * F-5 · B11/B20: daftar status pengajuan (server lewat `GET /warga/keluarga`).
   * Induk (App) mengelola state; nilai default = data demo bila dipakai lepas
   * dari App. Daftar kosong → tampil status kosong (bukan riwayat palsu).
   */
  ajuan?: AjuanPerubahan[];
  /**
   * F-5 · B11: kirim ajuan baru (`POST /warga/keluarga/ajuan`). Induk menangani
   * API-first + fallback OFFLINE; galat lain (409 antrean penuh, sesi habis)
   * DITERUSKAN → modal menampilkan gagal.
   *
   * Mengembalikan `true` bila ajuan benar-benar tercatat di server, `false`
   * bila hanya baris lokal (mode demo / server tidak terjangkau) — pemanggil
   * wajib membedakan agar pesan sukses tidak pernah palsu.
   */
  onAjukan?: (payload: {
    targetWargaId: string | null;
    jenis: JenisAjuan;
    namaAnggota: string;
    keterangan: string;
  }) => Promise<boolean>;
  kendaraanR4Count?: number;
  /**
   * Batch 15 · simpan unit kendaraan roda 4 hunian milik sendiri via API
   * (`PATCH /warga/hunian`). Induk (App) menangani API-first + fallback
   * OFFLINE; mengembalikan `true` bila TERSIMPAN di server dan `false` bila
   * hanya lokal (server tidak terjangkau) — pemanggil wajib membedakan agar
   * pesan sukses tidak pernah palsu. Galat lain (validasi, 409 belum tertaut,
   * sesi habis) DITERUSKAN → tombol menampilkan gagal.
   */
  onKendaraanR4Change?: (v: number) => Promise<boolean>;
}

const defaultKkList: KkData[] = [
  {
    id: "kk1",
    noKk: "3171-xxxx-xxxx-0988",
    kepala: "Bambang Supriyanto",
    alamat: `Blok B4 No. 12, ${tenant.label}`,
    anggota: [
      {
        name: "Bambang Supriyanto",
        initials: "BS",
        role: "Kepala Keluarga",
        filter: "kepala",
        gender: "Laki-laki",
        age: 52,
        birthDate: "14 Mei 1972",
        nik: "3171-xxxx-xxxx-0004",
        nikFull: "3171051405720004",
        relation: "Kepala Keluarga",
        job: "Karyawan Swasta",
        wa: "+62 812-3456-7890",
        email: "bambang.supriyanto@gmail.com",
        blood: "O (Rhesus +)",
        agama: "Islam",
        statusPernikahan: "Menikah",
        statusNote: "Terdaftar Aktif di DKB Ditjen Dukcapil",
        statusIcon: "verified",
        statusColor: "text-secondary",
        avatar: "https://lh3.googleusercontent.com/aida-public/AB6AXuCTUZo61na-G0petq_ViSUWDM11glUb9JnNFCYcMwmq3TcgnaKiAHbHeq8sAx6Y_cq1QODcOAxGIRrS6x35NHAZMZ3S2K3UU4u2z1eTs30B4dKOTnrSbXMkuIh5zJ5V2nDwCOF9rNgAh7-bHgVYcRreDVxttbS-OHBoFfHwI9oMioqELpwqEO7eQ0j_loRz8Yn_sQv1RCrcRchse3wx5cPhhJPs9djqSyHijlAXjXN63zze-lx7OW3d",
        ringColor: "ring-primary-fixed",
      },
      {
        name: "Siti Rahmawati",
        initials: "SR",
        role: "Istri",
        filter: "istri",
        gender: "Perempuan",
        age: 48,
        birthDate: "22 Agustus 1976",
        nik: "3171-xxxx-xxxx-1120",
        nikFull: "3171052208761120",
        relation: "Istri",
        job: "Wirausaha / Mandiri",
        wa: "+62 813-9876-5432",
        email: "siti.rahmawati@gmail.com",
        blood: "B (Rhesus +)",
        agama: "Islam",
        statusPernikahan: "Menikah",
        statusNote: "Kontak Darurat Utama Keluarga",
        statusIcon: "check_circle",
        statusColor: "text-secondary",
        avatar: "https://lh3.googleusercontent.com/aida-public/AB6AXuCS5u9Uv4U9RD4qSqRNZHv1msUO-at3KOjRTH9p60L1D_zU3eba_LHUscQiY3ztVZ4tlRcBmgEnnf99nC8LdTzIOzbrpy7tzBqrwmdK-rBEBpHA2-qhgPcR6O3h-VC7VwzOmvntmc6bBnldPr-VMbdn-7uLvTAHc-PtVIBkukk5G5jYkSCKW2L4WQoifjpsxLAIMU9ZWpCm9aq703HO114XsmYkJc1vLrgy7g-DKzAO-XXaBasqIJPA",
        ringColor: "ring-secondary-container",
      },
      {
        name: "Dimas Supriyanto",
        initials: "DS",
        role: "Anak Kandung",
        filter: "anak",
        gender: "Laki-laki",
        age: 21,
        birthDate: "10 Januari 2003",
        nik: "3171-xxxx-xxxx-3341",
        nikFull: "3171051001033341",
        relation: "Anak ke-1",
        job: "Mahasiswa / Magang",
        wa: "+62 857-1122-3344",
        email: "dimas.supriyanto@gmail.com",
        blood: "O (Rhesus +)",
        agama: "Islam",
        statusPernikahan: "Belum Menikah",
        statusNote: "Pemegang e-KTP Aktif Mandiri",
        statusIcon: "school",
        statusColor: "text-primary",
        avatar: "https://lh3.googleusercontent.com/aida-public/AB6AXuCPI6Jd0ozgqcAqB7dviFeyJFAzyQwpVN2jsjGpXR8S3_nky2z3jTdU5Vum3LVhar7OS0aKnIvo87M199fZE2CLxa_lyb7mqD-ecbFgTew6CzewMkbtpuDezYxIBrGrQWvcNsRiPHdObGUOjw6FzJFMcyuLf4h42nz5O6uaufJ9fl6HFc9328metuo_aIct2c_eV0B6JfzfvkV5K7TmtP6NZURuMtpd-rsgH28w6qSrYcQ1CAQcPbo3",
        ringColor: "ring-surface-variant",
      },
      {
        name: "Anisa Supriyanto",
        initials: "AS",
        role: "Anak Kandung",
        filter: "anak",
        gender: "Perempuan",
        age: 17,
        birthDate: "05 Maret 2007",
        nik: "3171-xxxx-xxxx-7822",
        nikFull: "3171050503077822",
        relation: "Anak ke-2",
        job: "Pelajar SMA / Sederajat",
        wa: "+62 856-9988-7711",
        email: "anisa.supriyanto@gmail.com",
        blood: "A (Rhesus +)",
        agama: "Islam",
        statusPernikahan: "Belum Menikah",
        statusNote: "NIK Baru Diperbarui & Disetujui RT (Sep 2026)",
        statusIcon: "task_alt",
        statusColor: "text-secondary",
        avatar: "https://lh3.googleusercontent.com/aida-public/AB6AXuCwhHKOe87oaucdauUbIp_eMPt2nYXU-FWW35Vb48EZJqDjKp7UaryTk1GH5EzqiPRN9rumUjsyfpmfUY1bAIHAiM26uYVyd3fy4jxqRwYl40XLRCcDTfHVNSfEmEJBmfc6ByGD0j452Kp9_CbQ7MLZt5CihrkLPRnrLPmuJSUfxHQOnIUnVelVjOEQS2YvLDSe-NeKQr4u-Ehn3_9Im_7zOq2RWs0hdVVKpKeZd0DEwosClttd3q-O",
        ringColor: "ring-surface-variant",
      },
    ],
  },
];

const agamaList = ["Islam", "Kristen Protestan", "Kristen Katolik", "Hindu", "Buddha", "Konghucu", "Lainnya"];
const statusPernikahanList = ["Belum Menikah", "Menikah", "Cerai Hidup", "Cerai Mati"];

function MemberCard({
  m,
  onViewNik,
  onEditContact,
  onKoreksiData,
}: {
  m: FamilyMember;
  onViewNik: (m: FamilyMember) => void;
  onEditContact: (m: FamilyMember) => void;
  onKoreksiData: (m: FamilyMember) => void;
}) {
  return (
    <div className="member-card rounded-2xl bg-surface-container-lowest shadow-sm hover:shadow-md transition-shadow p-4 md:p-5 flex flex-col gap-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="relative">
            {m.avatar ? (
              <img
                className="w-16 h-16 rounded-full object-cover shadow-inner ring-2"
                style={{ borderColor: "var(--tw-ring-color, #9cf6bc)" }}
                src={m.avatar}
                alt={m.name}
              />
            ) : (
              // Data API umumnya tanpa foto (`foto_url` NULL) → inisial, bukan
              // gambar rusak (alt-tekstetap utuh untuk pembaca layar).
              <div
                className="w-16 h-16 rounded-full bg-primary-container text-on-primary flex items-center justify-center text-lg font-bold shadow-inner ring-2"
                style={{ borderColor: "var(--tw-ring-color, #9cf6bc)" }}
                role="img"
                aria-label={m.name}
              >
                {m.initials}
              </div>
            )}
            <span className="absolute bottom-0 right-0 w-4 h-4 rounded-full bg-secondary ring-2 ring-surface-container-lowest" />
          </div>
          <div className="flex flex-col">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-base font-bold text-on-surface">{m.name}</span>
              <span className="px-2.5 py-0.5 rounded-full bg-primary-container text-on-primary text-[11px] font-bold">
                {m.role}
              </span>
            </div>
            <span className="text-xs text-on-surface-variant">
              {m.gender} • {m.age} Tahun ({m.birthDate})
            </span>
          </div>
        </div>
        <div className="flex flex-col sm:items-end">
          <span className="text-[11px] text-on-surface-variant">Nomor Induk Kependudukan (NIK)</span>
          <div className="inline-flex items-center gap-1.5 font-mono font-bold text-on-surface bg-surface-container-low px-3 py-1 rounded-md text-sm">
            <span className="material-symbols-outlined text-[14px] text-primary">lock</span>
            {m.nik}
            <button
              className="ml-1 text-primary hover:text-tertiary transition-colors"
              onClick={() => onViewNik(m)}
              title="Lihat NIK Lengkap"
            >
              <span className="material-symbols-outlined text-[16px]">visibility</span>
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 p-3.5 rounded-xl bg-surface-container-low/60">
        <div className="flex flex-col">
          <span className="text-[11px] text-on-surface-variant">Hubungan</span>
          <span className="text-xs font-bold text-on-surface">{m.relation}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-[11px] text-on-surface-variant">Pekerjaan</span>
          <span className="text-xs font-semibold text-on-surface truncate">{m.job}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-[11px] text-on-surface-variant">Agama</span>
          <span className="text-xs font-semibold text-on-surface">{m.agama}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-[11px] text-on-surface-variant">Status Nikah</span>
          <span className="text-xs font-semibold text-on-surface">{m.statusPernikahan}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-[11px] text-on-surface-variant">Gol. Darah</span>
          <span className="text-xs font-bold text-on-surface">{m.blood}</span>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <span className={`text-[11px] flex items-center gap-1 ${m.statusColor}`}>
          <span className="material-symbols-outlined text-[16px]">{m.statusIcon}</span>
          {m.statusNote}
        </span>
        <div className="flex items-center gap-2">
          <button
            className="h-10 px-4 rounded-xl bg-secondary-container/40 text-on-secondary-fixed-variant text-xs font-bold hover:bg-secondary-container transition-colors flex items-center gap-1.5"
            onClick={() => onEditContact(m)}
          >
            <span className="material-symbols-outlined text-[18px]">edit_note</span>
            {m.filter === "kepala" ? "Perbarui Kontak & Foto" : "Perbarui Kontak"}
          </button>
          <button
            className="h-10 px-3.5 rounded-xl bg-surface-container-high text-on-surface-variant text-xs hover:bg-surface-container hover:text-on-surface transition-colors flex items-center gap-1.5"
            onClick={() => onKoreksiData(m)}
          >
            <span className="material-symbols-outlined text-[18px]">
              {m.filter === "anak" ? "move_up" : "shield_person"}
            </span>
            {m.filter === "anak" ? "Ajukan Pindah/Mutasi" : "Koreksi Data Resmi"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function DataKeluarga({ onNavigate, kkList, onKkAdded, onKkUpdated, onSimpanKontak, ajuan = ajuanPerubahanDefault, onAjukan, kendaraanR4Count = 1, onKendaraanR4Change }: DataKeluargaProps) {
  const [allKk, setAllKk] = useState<KkData[]>(kkList?.length ? kkList : defaultKkList);
  const [selectedKk, setSelectedKk] = useState<string>(allKk[0]?.id || "");
  const [filter, setFilter] = useState<MemberFilter>("all");
  const [showOfficialModal, setShowOfficialModal] = useState(false);
  const [showDetailRumah, setShowDetailRumah] = useState(false);
  const [showNikModal, setShowNikModal] = useState(false);
  const [nikModalData, setNikModalData] = useState<FamilyMember | null>(null);
  const [editingMember, setEditingMember] = useState<FamilyMember | null>(null);
  const [showTambahKk, setShowTambahKk] = useState(false);
  const [showTambahAnggota, setShowTambahAnggota] = useState(false);
  /** Sedang mengirim simpan kontak ke API — tombol Simpan dinonaktifkan. */
  const [kirimSedang, setKirimSedang] = useState(false);
  /** Form "Ajukan Perubahan Resmi KK" — dikirim ke `POST /warga/keluarga/ajuan`. */
  const [formAjuan, setFormAjuan] = useState<{ jenis: JenisAjuan; namaAnggota: string; keterangan: string }>({
    jenis: "tambah_anggota",
    namaAnggota: "",
    keterangan: "",
  });
  /** Sedang mengirim ajuan — tombol Kirim dinonaktifkan (anti klik ganda). */
  const [kirimAjuanSedang, setKirimAjuanSedang] = useState(false);
  const [kendaraanR4, setKendaraanR4] = useState(String(kendaraanR4Count));
  const [kendaraanR4Custom, setKendaraanR4Custom] = useState("");
  /** Batch 15 · kunci tombol simpan unit R4 saat PATCH /warga/hunian berjalan. */
  const [r4Sedang, setR4Sedang] = useState(false);
  const { flash, toast } = useFlash();

  useEffect(() => {
    if (kendaraanR4Count <= 3) {
      setKendaraanR4(String(kendaraanR4Count));
      setKendaraanR4Custom("");
    } else {
      setKendaraanR4("Lainnya");
      setKendaraanR4Custom(String(kendaraanR4Count));
    }
  }, [kendaraanR4Count]);

  const currentKk = allKk.find((k) => k.id === selectedKk) || allKk[0];
  const members = currentKk?.anggota || [];

  // Prefill form: anggota yang diedit bila ada, kalau tidak anggota pertama
  // (pratinjau). `??` — BUKAN `||` — dipilih karena "" (WA/surel kosong) harus
  // dipertahankan; pola `||` lama menjatuhkan "" ke anggota pertama dan
  // membocorkan WA/surel orang lain ke form (dibuktikan E2E langkah B).
  const anggotaForm = editingMember ?? members[0];

  // Sinkron bila induk (App) mengganti daftar KK.
  useEffect(() => {
    if (kkList?.length) setAllKk(kkList);
  }, [kkList]);

  // Kode hunian & estimasi iuran selalu derive dari tenant + kategori iuran.
  const alamatHunian = currentKk?.alamat ?? "";
  const pendekHunian = shortAlamat(alamatHunian);
  const blokMatch = pendekHunian.match(/Blok\s*(\w+)[,\s]*No\.?\s*(\w+)/i);
  const kodeBlok = blokMatch ? `${blokMatch[1]}${blokMatch[2]}` : "";
  const kodeHunian = `RT${tenant.rt}-${kodeBlok}`;
  const kodeBlokLengkap = `RT${tenant.rt}/RW${tenant.rw}-${kodeBlok}`;
  const nominalR4 = kategoriIuranDefault.find((k) => k.id === "r4")?.nominal ?? 25000;

  const kontakDarurat = (() => {
    const target = editingMember ?? members[0];
    const istri = members.find((m) => m.filter === "istri");
    const orang = istri || target;
    return orang ? `${orang.name} (${orang.role}) - ${orang.wa}` : "";
  })();

  const filtered = filter === "all" ? members : members.filter((m) => m.filter === filter);
  const counts = {
    all: members.length,
    kepala: members.filter((m) => m.filter === "kepala").length,
    istri: members.filter((m) => m.filter === "istri").length,
    anak: members.filter((m) => m.filter === "anak").length,
    // Hubungan `lainnya` (enum `HubunganKk`) — chip hanya tampil bila terisi.
    lainnya: members.filter((m) => m.filter === "lainnya").length,
  };


  function handleViewNik(m: FamilyMember) {
    setNikModalData(m);
    setShowNikModal(true);
  }

  function handleEditContact(m: FamilyMember) {
    setEditingMember(m);
    setTimeout(() => {
      document.getElementById("quick-edit-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);
  }

  function handleKoreksiData(m: FamilyMember) {
    setNikModalData(m);
    setFormAjuan({ jenis: "tambah_anggota", namaAnggota: m.name, keterangan: "" });
    setShowOfficialModal(true);
  }

  /** Tombol panel "Ajukan Perubahan Resmi KK" — tanpa anggota konteks (kepala KK). */
  function bukaAjukanBaru() {
    setNikModalData(null);
    setFormAjuan({
      jenis: "tambah_anggota",
      namaAnggota: currentKk?.kepala || members[0]?.name || "",
      keterangan: "",
    });
    setShowOfficialModal(true);
  }

  /** ISO server → `"12 Sep 2026"`; null/invalid → `"-"`. */
  function tanggalPanjang(iso: string | null): string {
    if (!iso) return "-";
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
      ? "-"
      : d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
  }

  // F-5 · B11: submit ajuan — minimal 10 karakter (kontrak server); galat API
  // (409 antrean sejenis penuh, sesi habis) tampil jujur dan modal TIDAK ditutup.
  const kirimAjuanKeRt = async (e: FormEvent) => {
    e.preventDefault();
    if (kirimAjuanSedang) return;
    const keterangan = formAjuan.keterangan.trim();
    const namaAnggota = formAjuan.namaAnggota.trim();
    if (namaAnggota === "") {
      flash("Nama anggota yang bersangkutan wajib diisi.");
      return;
    }
    if (keterangan.length < 10) {
      flash("Keterangan minimal 10 karakter — jelaskan berkas yang diajukan.");
      return;
    }
    setKirimAjuanSedang(true);
    try {
      const terkirim = (await onAjukan?.({
        // Konteks anggota yang dipilih di kartu; tanpa kartu → anggota pertama.
        // Data demo tanpa `idWarga` → induk membuat baris lokal (mode OFFLINE).
        targetWargaId: nikModalData?.idWarga ?? members[0]?.idWarga ?? null,
        jenis: formAjuan.jenis,
        namaAnggota,
        keterangan,
      })) === true;
      setShowOfficialModal(false);
      // Pesan mengikuti KENYATAAN: `true` = baris dari server; `false` = baris
      // lokal (demo/OFFLINE) — jangan pernah mengaku "terkirim" untuk yang kedua.
      flash(
        terkirim
          ? `Pengajuan verifikasi berhasil dikirim ke Pengurus ${tenant.rtFull}.`
          : `Pengajuan hanya dicatat di sesi ini — TIDAK terkirim ke Pengurus ${tenant.rtFull} (mode demo / server tidak terjangkau).`,
      );
    } catch (err) {
      flash(
        `Gagal mengirim pengajuan: ${err instanceof GalatApi ? err.message : "periksa koneksi"} — pengajuan TIDAK terkirim.`,
      );
    } finally {
      setKirimAjuanSedang(false);
    }
  };

  function handleTambahKk(newKk: KkData) {
    const updated = [...allKk, newKk];
    setAllKk(updated);
    setSelectedKk(newKk.id);
    onKkAdded?.(newKk);
    // Jujur: Portal Warga TIDAK punya endpoint pembuatan KK (kontrak §5.4 hanya
    // `GET /warga/keluarga` + `POST /warga/keluarga/ajuan`) — baris ini hanya
    // hidup di sesi browser ini dan hilang saat muat ulang.
    flash(
      `KK baru dengan ${newKk.anggota.length} anggota ditambahkan di sesi ini — TIDAK tersimpan di server. ` +
        `Ajukan perubahan resmi KK lewat "Ajukan Perubahan" agar Pengurus RT memproses.`,
    );
  }

  return (
    <div className="min-h-dvh bg-background font-body-md text-on-surface antialiased">
      {/* Toast */}
      {toast}

      <div className="max-w-7xl mx-auto px-4 md:px-6 lg:px-8 py-6 flex flex-col gap-6">
        {/* Breadcrumbs & Header */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 text-on-surface-variant text-xs">
            <button type="button" className="hover:text-primary transition-colors flex items-center gap-1" onClick={() => onNavigate?.("portal-warga")}><span className="material-symbols-outlined text-[16px]">home</span>
              Portal Warga
            </button>
            <span className="material-symbols-outlined text-[14px]">chevron_right</span>
            <span className="text-primary font-bold">Data Keluarga &amp; KK</span>
          </div>
          <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 pt-1">
            <div className="max-w-3xl flex flex-col gap-1.5">
              <div className="inline-flex items-center gap-2 self-start px-2.5 py-1 rounded-full bg-surface-container-high text-on-surface-variant text-[11px]">
                <span className="material-symbols-outlined text-[16px] text-primary">groups_3</span>
                Administrasi Kependudukan Terpadu
              </div>
              <h1 className="text-2xl lg:text-[32px] text-on-surface tracking-tight font-extrabold">
                Data Keluarga &amp; Kartu Keluarga (KK)
              </h1>
              <p className="text-sm text-on-surface-variant leading-relaxed">
                Kelola informasi identitas keluarga, perbarui kontak &amp; foto anggota secara mandiri, serta ajukan perubahan data resmi dengan verifikasi aman Pengurus RT.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button className="h-12 px-5 rounded-xl bg-surface-container-lowest text-on-surface text-sm shadow-sm hover:shadow-md hover:bg-surface-container-low transition-all flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[20px]">file_download</span>
                Unduh Salinan Digital KK (PDF)
              </button>
              <button
                className="h-12 px-5 rounded-xl bg-primary text-on-primary text-sm shadow-md hover:bg-primary-container active:scale-[0.98] transition-all flex items-center gap-2"
                onClick={() => setShowTambahKk(true)}
              >
                <span className="material-symbols-outlined text-primary-fixed text-[20px]">add_circle</span>
                + Tambah KK Baru
              </button>
            </div>
          </div>
        </div>

        {/* KK Selector */}
        {allKk.length > 1 && (
          <div className="flex flex-wrap items-center gap-2 p-4 rounded-2xl bg-surface-container-lowest shadow-sm">
            <span className="text-xs font-bold text-on-surface-variant mr-2">Pilih KK:</span>
            {allKk.map((kk) => (
              <button
                key={kk.id}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                  selectedKk === kk.id
                    ? "bg-primary text-on-primary shadow-sm"
                    : "bg-surface-container-high text-on-surface-variant hover:bg-surface-container"
                }`}
                onClick={() => setSelectedKk(kk.id)}
              >
                {maskedNoKk(kk.noKk)} — {kk.kepala}
              </button>
            ))}
          </div>
        )}

        {/* Official KK Card */}
        <div className="relative overflow-hidden rounded-2xl bg-surface-container-lowest shadow-md p-4 md:p-6">
          <div className="absolute top-0 right-0 w-96 h-96 bg-gradient-to-bl from-primary-fixed/30 via-secondary-container/10 to-transparent rounded-full blur-3xl pointer-events-none" />
          <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="w-16 h-16 rounded-2xl bg-primary-fixed/40 flex items-center justify-center text-primary shrink-0 shadow-sm">
                <span className="material-symbols-outlined text-[34px]">badge</span>
              </div>
              <div className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] uppercase tracking-wider text-on-surface-variant font-bold">Nomor Kartu Keluarga (KK)</span>
                  <span className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full bg-secondary-container/40 text-on-secondary-fixed-variant text-[11px] font-bold">
                    <span className="w-2 h-2 rounded-full bg-secondary animate-pulse" />
                    Aktif &amp; Terverifikasi {tenant.rtFull}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xl text-on-surface font-mono tracking-wide font-extrabold">{maskedNoKk(currentKk?.noKk ?? "")}</span>
                  <button
                    aria-label="Salin nomor KK"
                    className="h-8 w-8 rounded-lg bg-surface-container-high hover:bg-surface-container flex items-center justify-center text-primary transition-colors"
                    onClick={() => {
                      const nilai = maskedNoKk(currentKk?.noKk ?? "");
                      if (navigator.clipboard?.writeText) {
                        navigator.clipboard.writeText(nilai).then(
                          () => flash("Nomor KK (ter-mask) berhasil disalin ke clipboard"),
                          () => flash("Gagal menyalin nomor KK — salin manual dari layar.")
                        );
                      } else {
                        flash("Penyalinan clipboard tidak didukung peramban ini.");
                      }
                    }}
                  >
                    <span className="material-symbols-outlined text-[18px]">content_copy</span>
                  </button>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 lg:gap-8 pt-4 lg:pt-0">
              <div className="flex flex-col">
                <span className="text-[11px] text-on-surface-variant">Kepala Keluarga</span>
                <span className="text-sm font-bold text-on-surface">{currentKk?.kepala}</span>
                <span className="text-xs text-on-surface-variant">Warga Asli (KTP Setempat)</span>
              </div>
              <div className="flex flex-col">
                <span className="text-[11px] text-on-surface-variant">Alamat Kependudukan</span>
                <span className="text-sm font-semibold text-on-surface leading-tight">{currentKk?.alamat}</span>
                <span className="text-xs text-on-surface-variant">{tenant.alamatLengkap}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Update Flow Banner */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 rounded-2xl bg-surface-container-low p-4 md:p-6 shadow-sm">
          <div className="flex items-start gap-4 p-4 rounded-xl bg-surface-container-lowest shadow-sm">
            <div className="w-12 h-12 rounded-xl bg-secondary-container/50 text-secondary flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-[26px]">bolt</span>
            </div>
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-on-surface">Pembaruan Langsung (Instan)</h3>
                <span className="px-2 py-0.5 rounded-full bg-secondary-container text-on-secondary-fixed-variant text-[11px] font-bold">Tanpa Verifikasi RT</span>
              </div>
              <p className="text-xs text-on-surface-variant leading-relaxed">
                Perubahan <strong>Nomor WhatsApp</strong>, <strong>Alamat Email</strong>, serta <strong>Foto Anggota</strong> tersimpan seketika tanpa memerlukan persetujuan Pengurus RT.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-4 p-4 rounded-xl bg-surface-container-lowest shadow-sm">
            <div className="w-12 h-12 rounded-xl bg-surface-variant text-primary flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-[26px]">verified_user</span>
            </div>
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-on-surface">Pembaruan Dokumen Resmi (Verifikasi RT)</h3>
                <span className="px-2 py-0.5 rounded-full bg-surface-container-high text-on-surface-variant text-[11px] font-bold">Butuh Lampiran</span>
              </div>
              <p className="text-xs text-on-surface-variant leading-relaxed">
                Penambahan bayi/anak, mutasi pindah anggota, atau koreksi NIK/Nama resmi memerlukan unggah dokumen &amp; validasi Ketua RT sesuai amanat <strong>UU PDP No. 27/2022</strong>.
              </p>
            </div>
          </div>
        </div>

        {/* Two-Column Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column: Members */}
          <div className="lg:col-span-8 flex flex-col gap-6">
            {/* Filter */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="text-base font-bold text-on-surface">Daftar Anggota Keluarga</span>
                <span className="px-2.5 py-0.5 rounded-full bg-primary-fixed text-on-primary-fixed text-xs font-bold">{counts.all} Jiwa Terdaftar</span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {([
                  { key: "all", label: `Semua (${counts.all})` },
                  { key: "kepala", label: `Kepala Keluarga (${counts.kepala})` },
                  { key: "istri", label: `Istri (${counts.istri})` },
                  { key: "anak", label: `Anak (${counts.anak})` },
                  { key: "lainnya", label: `Lainnya (${counts.lainnya})` },
                ] as const)
                  // Chip "Lainnya" hanya bila ada anggota ber-hubungan lain —
                  // tanpa anggota, pilihan filter kosong hanya membingungkan.
                  .filter((f) => f.key !== "lainnya" || counts.lainnya > 0)
                  .map((f) => (
                  <button
                    key={f.key}
                    className={`px-3 py-1.5 rounded-lg text-xs transition-all ${
                      filter === f.key
                        ? "bg-primary text-on-primary font-semibold shadow-sm"
                        : "bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container-high"
                    }`}
                    onClick={() => setFilter(f.key)}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              <button
                className="h-9 px-3 rounded-xl bg-primary-container text-on-primary text-xs font-bold hover:bg-primary hover:text-on-primary transition-colors flex items-center gap-1"
                onClick={() => setShowTambahAnggota(true)}
              >
                <span className="material-symbols-outlined text-[16px]">person_add</span>
                Tambah Anggota
              </button>
            </div>

            {/* Member Cards */}
            {filtered.map((m) => (
              <MemberCard
                key={m.idWarga || m.name}
                m={m}
                onViewNik={handleViewNik}
                onEditContact={handleEditContact}
                onKoreksiData={handleKoreksiData}
              />
            ))}

            {/* Quick Edit Form */}
            {/* key: form ini memakai input tak-terkendali (defaultValue) — React
                tidak menerapkan ulang defaultValue setelah mount, sehingga tanpa
                remount per-anggota, field selalu menampilkan data saat mount
                (anggota pertama) dan nilai ketikan lama bocor antar-anggota.
                ganti anggota/kk → subtree dibuat ulang → defaultValue terbaca segar. */}
            <div
              id="quick-edit-section"
              key={`${currentKk?.id ?? ""}-${editingMember ? editingMember.nik || editingMember.name : "tanpa-anggota"}`}
              className="scroll-mt-24 rounded-2xl bg-surface-container-lowest shadow-md p-4 md:p-6 flex flex-col gap-5"
            >
              <div className="flex items-start justify-between gap-4 pb-3">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-xl bg-secondary-container/50 text-secondary flex items-center justify-center shrink-0">
                    <span className="material-symbols-outlined text-[24px]">contact_phone</span>
                  </div>
                  <div className="flex flex-col">
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-bold text-on-surface">Pembaruan Kontak &amp; Foto Mandiri</h3>
                      <span className="px-2 py-0.5 rounded-full bg-secondary-container text-on-secondary-fixed-variant text-[11px] font-bold">Simpan Langsung</span>
                    </div>
                    <p className="text-xs text-on-surface-variant">
                      Sedang memperbarui profil: <span className="font-bold text-primary">{editingMember ? `${editingMember.name} (${editingMember.role})` : "Pilih anggota dari kartu di atas"}</span>
                    </p>
                  </div>
                </div>
                <button
                  className="text-on-surface-variant hover:text-on-surface text-xs flex items-center gap-1"
                  onClick={() => setEditingMember(null)}
                >
                  <span className="material-symbols-outlined text-[18px]">restart_alt</span> Reset
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
                <div className="md:col-span-4 flex flex-col items-center justify-center p-4 rounded-xl bg-surface-container-low text-center gap-3">
                  <div className="relative group">
                    {anggotaForm?.avatar ? (
                      <img
                        className="w-24 h-24 rounded-full object-cover shadow-md ring-4 ring-surface-container-lowest"
                        src={anggotaForm.avatar}
                        alt="Avatar"
                      />
                    ) : (
                      // Tanpa foto → inisial besar (konsisten dengan kartu anggota).
                      <div
                        className="w-24 h-24 rounded-full bg-primary-container text-on-primary flex items-center justify-center text-3xl font-bold shadow-md ring-4 ring-surface-container-lowest"
                        role="img"
                        aria-label={anggotaForm?.name || "Foto"}
                      >
                        {anggotaForm?.initials || ""}
                      </div>
                    )}
                    <label className="absolute inset-0 bg-on-background/50 rounded-full flex flex-col items-center justify-center text-surface opacity-0 group-hover:opacity-100 cursor-pointer transition-opacity" htmlFor="avatar-file">
                      <span className="material-symbols-outlined text-[22px]">photo_camera</span>
                      <span className="text-[11px]">Ganti</span>
                    </label>
                    <input accept="image/*" className="hidden" id="avatar-file" type="file" />
                  </div>
                  <div className="flex flex-col">
                    <label className="text-xs text-primary font-bold cursor-pointer hover:underline" htmlFor="avatar-file">Unggah Foto Baru</label>
                    <span className="text-[11px] text-on-surface-variant">Format JPG/PNG, Maksimal 2.0 MB</span>
                  </div>
                </div>

                <div className="md:col-span-8 flex flex-col gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-on-surface flex items-center justify-between">
                      <span>Nomor WhatsApp Aktif (Notifikasi RT)</span>
                      <span className="text-secondary font-normal flex items-center gap-0.5">
                        <span className="material-symbols-outlined text-[14px]">check_circle</span> Terhubung Gateway RT
                      </span>
                    </label>
                    <div className="relative flex items-center">
                      <span className="absolute left-3.5 text-on-surface-variant material-symbols-outlined text-[20px]">chat</span>
                      <input id="member-wa" className="w-full h-11 pl-11 pr-4 rounded-xl bg-surface-container-low text-sm text-on-surface font-mono focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all" type="tel" inputMode="numeric" maxLength={PHONE_MAX} placeholder="08xxxxxxxxxx" defaultValue={waDigitsFromMember(anggotaForm?.wa ?? "")} onChange={(e) => { e.target.value = onlyDigits(e.target.value); }} />
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-on-surface">Email Penerima Tagihan Iuran &amp; Surat Pengantar</label>
                    <div className="relative flex items-center">
                      <span className="absolute left-3.5 text-on-surface-variant material-symbols-outlined text-[20px]">mail</span>
                      <input id="member-email" className="w-full h-11 pl-11 pr-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all" type="email" defaultValue={anggotaForm?.email ?? ""} />
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-on-surface">Kontak Darurat Keluarga Terpilih</label>
                    <div className="relative flex items-center">
                      <span className="absolute left-3.5 text-on-surface-variant material-symbols-outlined text-[20px]">emergency</span>
                      <input id="member-darurat" className="w-full h-11 pl-11 pr-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all" type="text" defaultValue={kontakDarurat} />
                    </div>
                  </div>
                </div>
              </div>

              {/* Data Pribadi */}
              <div className="flex flex-col gap-1.5 pt-2 border-t border-surface-container-high">
                <span className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">Data Pribadi</span>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-on-surface flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-[16px] text-on-surface-variant">work</span>
                      Pekerjaan
                    </label>
                    <input id="member-job" className="w-full h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all" type="text" defaultValue={anggotaForm?.job ?? ""} placeholder="Contoh: Karyawan Swasta" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-on-surface flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-[16px] text-on-surface-variant">water_drop</span>
                      Golongan Darah
                    </label>
                    <select id="member-blood" className="w-full h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all" defaultValue={anggotaForm?.blood ?? ""}>
                      <option value="">Pilih golongan darah</option>
                      <option>A (Rhesus +)</option>
                      <option>A (Rhesus -)</option>
                      <option>B (Rhesus +)</option>
                      <option>B (Rhesus -)</option>
                      <option>AB (Rhesus +)</option>
                      <option>AB (Rhesus -)</option>
                      <option>O (Rhesus +)</option>
                      <option>O (Rhesus -)</option>
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-on-surface flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-[16px] text-on-surface-variant">church</span>
                      Agama
                    </label>
                    <select id="member-agama" className="w-full h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all" defaultValue={anggotaForm?.agama ?? ""}>
                      <option value="">Pilih agama</option>
                      {agamaList.map((ag) => <option key={ag}>{ag}</option>)}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-on-surface flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-[16px] text-on-surface-variant">favorite</span>
                      Status Perkawinan
                    </label>
                    <select id="member-status" className="w-full h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all" defaultValue={anggotaForm?.statusPernikahan ?? ""}>
                      <option value="">Pilih status</option>
                      {statusPernikahanList.map((sp) => <option key={sp}>{sp}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <span className="text-xs text-on-surface-variant flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-secondary text-[18px]">verified_user</span>
                  Perubahan langsung aktif tanpa jeda persetujuan RT.
                </span>
                <div className="flex items-center gap-2">
                  <button
                    className="h-11 px-5 rounded-xl bg-surface-container-high text-on-surface text-sm hover:bg-surface-container"
                    onClick={() => {
                      setEditingMember(null);
                      flash("Formulir telah direset");
                    }}
                  >
                    Batal
                  </button>
                  <button
                    className="h-11 px-6 rounded-xl bg-primary text-on-primary text-sm shadow-sm hover:bg-primary-container active:scale-[0.98] transition-all flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                    disabled={kirimSedang}
                    onClick={async () => {
                      // Simpan kontak: anggota API (punya `idWarga`) → lewat server
                      // (API-first, induk menangani OFFLINE); demo/ketik lokal →
                      // baris lokal saja. Galat DITERUSKAN → flash gagal di bawah.
                      const target = editingMember || members[0];
                      if (!target || !currentKk) return;
                      const waDigits = onlyDigits((document.getElementById("member-wa") as HTMLInputElement | null)?.value || "");
                      const email = (document.getElementById("member-email") as HTMLInputElement | null)?.value || "";
                      const job = (document.getElementById("member-job") as HTMLInputElement | null)?.value || "";
                      const blood = (document.getElementById("member-blood") as HTMLSelectElement | null)?.value || "";
                      const agama = (document.getElementById("member-agama") as HTMLSelectElement | null)?.value || "";
                      const status = (document.getElementById("member-status") as HTMLSelectElement | null)?.value || "";
                      // Label gol. darah form ("O (Rhesus ±)") → huruf enum DB;
                      // nilai kosong/bukan-enum → tidak dikirim (nilai lama aman).
                      const golMatch = /^(AB|A|B|O)/i.exec(blood.trim());
                      const golKeServer = golMatch
                        ? (golMatch[1].toUpperCase() as PatchKontakKeluarga["golDarah"])
                        : undefined;
                      // Status kawin hanya boleh dikirim bila persis nilai enum DB
                      // (daftar FE == CHECK DB) — selain itu biarkan server mempertahankan.
                      const statusKawin = statusPernikahanList.includes(status)
                        ? (status as PatchKontakKeluarga["statusKawin"])
                        : undefined;
                      setKirimSedang(true);
                      try {
                        if (target.idWarga && onSimpanKontak) {
                          await onSimpanKontak(target.idWarga, {
                            // WA kosong → tidak dikirim: nomor lama dipertahankan
                            // (konsisten dengan jalur lokal di bawah).
                            ...(waDigits ? { noHp: waDigits } : {}),
                            email,
                            pekerjaan: job,
                            agama,
                            ...(golKeServer ? { golDarah: golKeServer } : {}),
                            ...(statusKawin ? { statusKawin } : {}),
                          });
                        } else {
                          const idx = currentKk.anggota.indexOf(target);
                          const anggota = currentKk.anggota.map((m, i) =>
                            // Pilih baris yang diedit: referensi objek dulu (tak ambigu);
                            // fallback nama+NIK bila referensi basi. Nama saja tidak cukup —
                            // dua anggota boleh bernama sama dalam satu KK.
                            (idx >= 0 ? i === idx : m.name === target.name && m.nik === target.nik)
                              ? {
                                  ...m,
                                  wa: waDigits ? memberWaValue(waDigits) : m.wa,
                                  email,
                                  job,
                                  blood,
                                  agama,
                                  statusPernikahan: status,
                                }
                              : m
                          );
                          setAllKk((prev) => prev.map((k) => (k.id === currentKk.id ? { ...k, anggota } : k)));
                          onKkUpdated?.(currentKk.id, { anggota });
                        }
                        flash("Data kontak berhasil diperbarui langsung");
                        setTimeout(() => {
                          setEditingMember(null);
                          onNavigate?.("portal-warga");
                        }, 1500);
                      } catch (e) {
                        // OFFLINE sudah diubah induk jadi sukses lokal; yang sampai
                        // sini = sesi habis / validasi / bentrok no. HP → tampil jujur.
                        flash(`Gagal menyimpan perubahan: ${e instanceof Error ? e.message : "periksa koneksi"} — perubahan TIDAK tersimpan.`);
                      } finally {
                        setKirimSedang(false);
                      }
                    }}
                  >
                    <span className="material-symbols-outlined text-[18px]">save</span>
                    {kirimSedang ? "Menyimpan…" : "Simpan Perubahan Kontak"}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column */}
          <div className="lg:col-span-4 flex flex-col gap-6">
            {/* Status Pengajuan */}
            <div className="rounded-2xl bg-surface-container-lowest shadow-sm p-4 flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-surface-variant text-primary flex items-center justify-center">
                    <span className="material-symbols-outlined text-[20px]">history_edu</span>
                  </div>
                  <h3 className="text-base font-bold text-on-surface">Status Pengajuan ke RT</h3>
                </div>
                <span className="px-2 py-0.5 rounded-full bg-secondary-container/40 text-on-secondary-fixed-variant text-[11px] font-bold">{ajuan.length} Riwayat</span>
              </div>
              <p className="text-xs text-on-surface-variant leading-relaxed">
                Pantau status verifikasi berkas resmi KK yang diajukan ke Pengurus {tenant.rtFull}.
              </p>
              <div className="flex flex-col gap-3">
                {ajuan.length === 0 && (
                  <p className="text-xs text-on-surface-variant bg-surface-container-low rounded-xl p-4 text-center leading-relaxed">
                    Belum ada pengajuan. Ajukan perubahan resmi KK untuk memulai verifikasi Ketua {tenant.rtFull}.
                  </p>
                )}
                {ajuan.map((a) => {
                  const chip = KIRI_AJUAN[a.status];
                  return (
                    <div key={a.id} className="p-3.5 rounded-xl bg-surface-container-low flex flex-col gap-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex flex-col">
                          <span className="text-xs font-bold text-on-surface">{LABEL_JENIS_AJUAN[a.jenis]}</span>
                          <span className="text-[11px] text-on-surface-variant">{a.namaAnggota || "Anggota keluarga"}</span>
                        </div>
                        <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full ${chip.kelas} text-[11px] font-bold shrink-0`}>
                          <span className="material-symbols-outlined text-[14px]">{chip.icon}</span>
                          {LABEL_STATUS_AJUAN[a.status]}
                        </span>
                      </div>
                      {a.keterangan && (
                        <div className="text-xs text-on-surface-variant bg-surface-container-lowest p-2.5 rounded-lg">
                          <div className="text-[11px] font-bold text-on-surface">Keterangan Pengajuan:</div>
                          <p className="text-[12px] leading-snug">{a.keterangan}</p>
                        </div>
                      )}
                      {a.catatanVerifikasi && (
                        <div className="text-xs text-on-surface-variant bg-surface-container-lowest p-2.5 rounded-lg">
                          <div className="text-[11px] font-bold text-on-surface">Catatan Pengurus {tenant.rtFull}:</div>
                          <p className="text-[12px] leading-snug">{a.catatanVerifikasi}</p>
                        </div>
                      )}
                      <div className="flex items-center justify-between pt-1">
                        <span className="text-[11px] text-on-surface-variant">
                          {a.status === "menunggu"
                            ? `Diajukan: ${tanggalPanjang(a.diajukanPada)}`
                            : `Selesai: ${tanggalPanjang(a.diprosesPada ?? a.diajukanPada)}`}
                        </span>
                        {a.status === "disetujui" && (
                          <span className="text-secondary text-[11px] font-bold flex items-center gap-0.5">
                            <span className="material-symbols-outlined text-[14px]">verified</span> Berhasil Tuntas
                          </span>
                        )}
                        {a.status === "ditolak" && (
                          <span className="text-error text-[11px] font-bold flex items-center gap-0.5">
                            <span className="material-symbols-outlined text-[14px]">cancel</span> Ajukan Ulang
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <button
                className="w-full h-11 rounded-xl bg-surface-container-high hover:bg-surface-container text-on-surface text-xs font-bold transition-colors flex items-center justify-center gap-2"
                onClick={bukaAjukanBaru}
              >
                <span className="material-symbols-outlined text-[18px]">add_circle</span>
                Ajukan Perubahan Resmi KK
              </button>
            </div>

            {/* Informasi Hunian */}
            <div className="rounded-2xl bg-surface-container-lowest shadow-sm p-4 flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-secondary-container/40 text-secondary flex items-center justify-center">
                    <span className="material-symbols-outlined text-[20px]">home_pin</span>
                  </div>
                  <h3 className="text-base font-bold text-on-surface">Informasi Hunian Rumah</h3>
                </div>
                <span className="text-[11px] font-mono text-primary font-bold">{kodeHunian}</span>
              </div>
              <div className="flex flex-col gap-2.5">
                {[
                  { label: "Kode Blok Bangunan", value: kodeBlokLengkap, mono: true },
                  { label: "Status Kepemilikan", value: "Dihuni Pemilik Tetap", icon: "verified", color: "text-secondary" },
                  { label: "Spesifikasi Bangunan", value: "120 m² (1 Lantai)" },
                  { label: "Terdaftar di RT Sejak", value: "Maret 2018 (8 Tahun)" },
                  { label: "Jumlah KK di Alamat Ini", value: `${allKk.length} KK`, bold: true },
                  { label: "Kendaraan Roda 4", value: `${kendaraanR4Count} Unit`, icon: "directions_car", color: "text-primary" },
                ].map((item) => (
                  <div key={item.label} className="flex items-center justify-between py-1.5">
                    <span className="text-xs text-on-surface-variant">{item.label}</span>
                    <span className={`text-xs font-semibold text-on-surface flex items-center gap-1 ${item.mono ? "font-mono font-bold" : ""} ${item.color || ""} ${item.bold ? "font-bold text-primary" : ""}`}>
                      {item.icon && <span className="material-symbols-outlined text-[16px]">{item.icon}</span>}
                      {item.value}
                    </span>
                  </div>
                ))}
              </div>
              <button
                className="w-full h-10 rounded-xl bg-surface-container-low hover:bg-surface-container-high text-primary text-xs font-bold transition-colors flex items-center justify-center gap-1.5"
                onClick={() => setShowDetailRumah(true)}
              >
                <span className="material-symbols-outlined text-[18px]">domain</span>
                Lihat Detail Hunian Rumah
              </button>
            </div>

            {/* Keamanan Data */}
            <div className="rounded-2xl bg-surface-container-low p-4 flex flex-col gap-3">
              <div className="flex items-center gap-2.5 text-primary">
                <span className="material-symbols-outlined text-[24px]">shield_lock</span>
                <h4 className="text-sm font-bold text-on-surface">Keamanan Data Pribadi (UU PDP)</h4>
              </div>
              <p className="text-xs text-on-surface-variant leading-relaxed">
                Data NIK, tanggal lahir, dan susunan KK keluarga Anda dienkripsi menggunakan standar <strong>AES-256</strong>. Akses berkas kependudukan dibatasi secara ketat hanya untuk Pengurus RT yang sedang menjabat dan diverifikasi legalitasnya.
              </p>
              <div className="flex items-center gap-2 text-[11px] text-on-surface-variant">
                <span className="w-2 h-2 rounded-full bg-secondary" />
                Kepatuhan UU No. 27 Tahun 2022 (Perlindungan Data Pribadi)
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Modal: Tambah KK Baru */}
      {showTambahKk && (
        <TambahKkModal
          onClose={() => setShowTambahKk(false)}
          onSubmit={(kk) => {
            handleTambahKk(kk);
            setShowTambahKk(false);
          }}
        />
      )}

      {/* Modal: Tambah Anggota ke KK */}
      {showTambahAnggota && (
        <TambahAnggotaModal
          kkName={currentKk?.kepala || ""}
          onClose={() => setShowTambahAnggota(false)}
          onAdd={(m) => {
            const updated = allKk.map((k) => {
              if (k.id !== selectedKk) return k;
              return { ...k, anggota: [...k.anggota, m] };
            });
            setAllKk(updated);
            const target = updated.find((k) => k.id === selectedKk);
            if (target) onKkUpdated?.(target.id, { anggota: target.anggota });
            setShowTambahAnggota(false);
            // Jujur: tidak ada endpoint penambahan anggota di sisi warga —
            // pengubahan KK resmi melewati ajuan `POST /warga/keluarga/ajuan`
            // (jenis `tambah_anggota`, kontrak §5.4). Baris lokal hanya tampilan.
            flash(
              `Anggota "${m.name}" ditambahkan di sesi ini — TIDAK tersimpan di server. ` +
                `Ajukan penambahan lewat "Ajukan Perubahan Resmi" (jenis: Tambah Anggota) agar Pengurus RT memproses.`,
            );
          }}
        />
      )}

      {/* Modal: Lihat NIK Lengkap */}
      {showNikModal && nikModalData && (
        <div className="fixed inset-0 z-50 bg-on-background/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-sm rounded-2xl bg-surface-container-lowest shadow-2xl p-6 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary-fixed/50 text-primary flex items-center justify-center">
                  <span className="material-symbols-outlined text-[22px]">lock_open</span>
                </div>
                <div>
                  <h3 className="text-base font-bold text-on-surface">
                    {nikModalData.nikFull ? "NIK Lengkap" : "NIK (Ter-mask)"}
                  </h3>
                  <p className="text-xs text-on-surface-variant">{nikModalData.name}</p>
                </div>
              </div>
              <button className="w-8 h-8 rounded-lg bg-surface-container flex items-center justify-center text-on-surface-variant hover:text-on-surface" onClick={() => setShowNikModal(false)}>
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>
            <div className="p-4 rounded-xl bg-surface-container-low flex flex-col items-center gap-2">
              <span className="font-mono text-xl font-extrabold text-on-surface tracking-wider">
                {nikModalData.nikFull ?? nikModalData.nik}
              </span>
              <span className="text-[11px] text-on-surface-variant">
                {nikModalData.nikFull
                  ? "Data bersifat rahasia sesuai UU PDP No. 27/2022"
                  : "NIK ditampilkan ter-mask — portal warga tidak pernah menyajikan NIK plaintext (PRD §14)."}
              </span>
            </div>
            <div className="flex items-center gap-2 text-[11px] text-on-surface-variant">
              <span className="material-symbols-outlined text-[14px] text-primary">info</span>
              NIK ini hanya ditampilkan sesaat. Segera tutup setelah selesai mencatat.
            </div>
            <button
              className="w-full h-11 rounded-xl bg-primary text-on-primary text-sm font-bold shadow-md"
              onClick={() => setShowNikModal(false)}
            >
              Tutup
            </button>
          </div>
        </div>
      )}

      {/* Modal: Detail Hunian Rumah */}
      {showDetailRumah && (
        <div className="fixed inset-0 z-50 bg-on-background/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-2xl bg-surface-container-lowest shadow-2xl p-6 flex flex-col gap-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-secondary-container/40 text-secondary flex items-center justify-center">
                  <span className="material-symbols-outlined text-[22px]">home</span>
                </div>
                <div>
                  <h3 className="text-base font-bold text-on-surface">Detail Hunian Rumah</h3>
                  <p className="text-xs text-on-surface-variant">{tenant.label} - {pendekHunian}</p>
                </div>
              </div>
              <button className="w-8 h-8 rounded-lg bg-surface-container flex items-center justify-center text-on-surface-variant hover:text-on-surface" onClick={() => setShowDetailRumah(false)}>
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            {/* Data yang hanya bisa diubah oleh Pengurus RT */}
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="material-symbols-outlined text-[14px] text-on-surface-variant">lock</span>
                <span className="text-[11px] font-bold text-on-surface-variant uppercase tracking-wider">Data Resmi (Hanya Pengurus RT)</span>
              </div>
              {[
                { label: "Alamat Lengkap", value: alamatHunian },
                { label: "Kode Blok Bangunan", value: kodeBlokLengkap, mono: true },
                { label: "Tipe Rumah", value: "Rumah Tinggal (Type 45/60)" },
                { label: "Terdaftar di RT Sejak", value: "Maret 2018 (8 Tahun)" },
                { label: "Status Hunian", value: "Dihuni Pemilik", badge: true },
                { label: "Jumlah KK di Alamat Ini", value: `${allKk.length} KK`, bold: true },
              ].map((item) => (
                <div key={item.label} className="flex items-start justify-between py-2 border-b border-outline-variant/10 last:border-0">
                  <span className="text-xs text-on-surface-variant">{item.label}</span>
                  <span className={`text-xs font-semibold text-on-surface text-right ${item.mono ? "font-mono font-bold" : ""} ${item.bold ? "font-bold text-primary" : ""}`}>
                    {item.badge ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-secondary-container/40 text-secondary text-[11px] font-bold">
                        <span className="material-symbols-outlined text-[14px]">verified</span>
                        {item.value}
                      </span>
                    ) : item.value}
                  </span>
                </div>
              ))}
            </div>

            {/* Data yang bisa diupdate oleh warga */}
            <div className="flex flex-col gap-3 pt-2 border-t border-outline-variant/20">
              <div className="flex items-center gap-2 mb-1">
                <span className="material-symbols-outlined text-[14px] text-primary">edit</span>
                <span className="text-[11px] font-bold text-primary uppercase tracking-wider">Data yang Dapat Diperbarui</span>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface">Gang / Ganggang (Opsional)</label>
                <input className="w-full h-10 px-3 rounded-lg bg-surface-container-low text-xs text-on-surface focus:outline-none focus:ring-2 focus:ring-primary" type="text" placeholder="Contoh: Gang Melati" defaultValue="" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface">Nomor Jalan (Opsional)</label>
                <input className="w-full h-10 px-3 rounded-lg bg-surface-container-low text-xs text-on-surface focus:outline-none focus:ring-2 focus:ring-primary" type="text" placeholder="Contoh: No. B-12" defaultValue="B-12" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface">Total Kendaraan Roda 4</label>
                <div className="flex flex-wrap gap-2">
                  {["0", "1", "2", "3", "Lainnya"].map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      className={`h-9 px-4 rounded-lg text-xs font-bold transition-all ${
                        kendaraanR4 === opt
                          ? "bg-primary text-on-primary shadow-sm"
                          : "bg-surface-container-low text-on-surface-variant hover:bg-surface-container-high"
                      }`}
                      onClick={() => { setKendaraanR4(opt); if (opt !== "Lainnya") setKendaraanR4Custom(""); }}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
                {kendaraanR4 === "Lainnya" && (
                  <input
                    className="w-full h-10 px-3 rounded-lg bg-surface-container-low text-xs text-on-surface font-mono focus:outline-none focus:ring-2 focus:ring-primary mt-1"
                    type="tel"
                    inputMode="numeric"
                    min="4"
                    maxLength={2}
                    placeholder="Masukkan jumlah (min. 4)"
                    value={kendaraanR4Custom}
                    onChange={(e) => setKendaraanR4Custom(onlyDigits(e.target.value))}
                    autoFocus
                  />
                )}
              </div>
              <div className="p-3 rounded-xl bg-primary-fixed/30 flex items-start gap-2 text-on-surface-variant text-[12px]">
                <span className="material-symbols-outlined text-[18px] text-primary shrink-0">info</span>
                <span>Perubahan data hunian akan langsung tersimpan. Untuk perubahan alamat resmi atau tipe rumah, silakan ajukan permohonan ke Pengurus RT.</span>
              </div>
            </div>

            {/* Ringkasan Data Tersimpan */}
            <div className="p-3 rounded-xl bg-surface-container-low border border-outline-variant/20">
              <div className="flex items-center gap-2 mb-2">
                <span className="material-symbols-outlined text-[16px] text-secondary">check_circle</span>
                <span className="text-xs font-bold text-on-surface">Data Tersimpan</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-on-surface-variant">Kendaraan Roda 4:</span>
                  <span className="font-bold text-on-surface">{kendaraanR4 === "Lainnya" ? (kendaraanR4Custom || "0") : kendaraanR4} Unit</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-on-surface-variant">Est. Iuran/Bulan:</span>
                  <span className="font-bold text-primary font-mono">{formatRupiah((kendaraanR4 === "Lainnya" ? parseInt(kendaraanR4Custom) || 0 : parseInt(kendaraanR4)) * nominalR4)}</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 text-[11px] text-on-surface-variant">
              <span className="material-symbols-outlined text-[14px] text-primary">shield</span>
              Data hunian bersumber dari basis data kependudukan {tenant.rtFull} dan Dukcapil.
            </div>
            <div className="flex gap-3">
              <button
                className="flex-1 h-11 rounded-xl bg-surface-container-high hover:bg-surface-container text-on-surface text-sm font-bold"
                onClick={() => setShowDetailRumah(false)}
              >
                Tutup
              </button>
              <button
                className="flex-1 h-11 rounded-xl bg-primary hover:bg-primary-container text-on-primary text-sm font-bold shadow-md disabled:opacity-60 disabled:cursor-wait"
                disabled={r4Sedang}
                onClick={async () => {
                  const count = kendaraanR4 === "Lainnya" ? parseInt(kendaraanR4Custom) || 0 : parseInt(kendaraanR4);
                  if (count < 0 || count > 99) {
                    flash("Jumlah kendaraan roda 4 harus 0–99 unit.");
                    return;
                  }
                  setR4Sedang(true);
                  try {
                    // API-first (Batch 15): `true` = tersimpan di server,
                    // `false` = OFFLINE/baris lokal — pesan dibedakan jujur.
                    const tersimpan = await onKendaraanR4Change?.(count);
                    if (tersimpan) {
                      flash("Jumlah kendaraan roda 4 tersimpan di server.");
                    } else if (onKendaraanR4Change) {
                      flash(
                        "Mode offline (server tidak terjangkau) — unit R4 hanya tampil di layar ini, TIDAK tersimpan di server.",
                      );
                    } else {
                      flash("Perubahan TIDAK tersimpan — muat ulang halaman lalu coba lagi.");
                    }
                    setShowDetailRumah(false);
                  } catch (e) {
                    // Galat server (validasi, 409 belum tertaut, sesi habis):
                    // tampilkan jujur — jangan pernah menutup modal seolah sukses.
                    flash(
                      `Gagal menyimpan: ${e instanceof Error ? e.message : "periksa koneksi"} — perubahan TIDAK tersimpan.`,
                    );
                  } finally {
                    setR4Sedang(false);
                  }
                }}
              >
                {r4Sedang ? "Menyimpan…" : "Simpan Perubahan"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Official Modal */}
      {showOfficialModal && (
        <div className="fixed inset-0 z-50 bg-on-background/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-xl rounded-2xl bg-surface-container-lowest shadow-2xl p-6 flex flex-col gap-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary-fixed/50 text-primary flex items-center justify-center">
                  <span className="material-symbols-outlined text-[22px]">policy</span>
                </div>
                <div>
                  <h3 className="text-base font-bold text-on-surface">Ajukan Perubahan Resmi KK</h3>
                  <p className="text-xs text-on-surface-variant">
                    {nikModalData ? `Untuk: ${nikModalData.name}` : `Verifikasi administratif oleh Ketua ${tenant.rtFull}`}
                  </p>
                </div>
              </div>
              <button className="w-8 h-8 rounded-lg bg-surface-container flex items-center justify-center text-on-surface-variant hover:text-on-surface" onClick={() => setShowOfficialModal(false)}>
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>
            <form className="flex flex-col gap-4" onSubmit={kirimAjuanKeRt}>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface">Jenis Pengajuan Dokumen</label>
                <select
                  className="w-full h-11 px-3 rounded-xl bg-surface-container-low text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary"
                  value={formAjuan.jenis}
                  onChange={(e) => setFormAjuan((f) => ({ ...f, jenis: e.target.value as JenisAjuan }))}
                >
                  <option value="tambah_anggota">Penambahan Anggota Keluarga Baru (Kelahiran/Pernikahan)</option>
                  <option value="sensitif">Koreksi Penulisan Nama / Tanggal Lahir / NIK Resmi</option>
                  <option value="perubahan_kk">Mutasi Pindah Domisili Anggota Keluarga Keluar RT</option>
                  <option value="kontak">Pembaruan Status Pekerjaan / Pendidikan Resmi</option>
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface">Nama Anggota Keluarga yang Bersangkutan</label>
                <input
                  className="w-full h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary"
                  type="text"
                  value={formAjuan.namaAnggota}
                  onChange={(e) => setFormAjuan((f) => ({ ...f, namaAnggota: e.target.value }))}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface">Unggah Berkas Pendukung (Akta Lahir / Surat Pindah / Resi Dukcapil)</label>
                <div className="p-6 rounded-xl border border-dashed border-outline/30 bg-surface-container-low/50 flex flex-col items-center justify-center text-center gap-2 cursor-pointer hover:bg-surface-container-low transition-colors">
                  <span className="material-symbols-outlined text-[32px] text-primary">upload_file</span>
                  <div className="text-xs font-bold text-on-surface">Klik atau seret file PDF / JPG ke sini</div>
                  <span className="text-[11px] text-on-surface-variant">Maksimal berkas 5 MB, pastikan hasil pindai jelas terbaca • lampirkan fisik berkas saat verifikasi</span>
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface">Keterangan Tambahan untuk Ketua RT</label>
                <textarea
                  className="w-full p-3 rounded-xl bg-surface-container-low text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                  placeholder="Contoh: Lampiran surat pindah dari Disdukcapil..." rows={3}
                  value={formAjuan.keterangan}
                  onChange={(e) => setFormAjuan((f) => ({ ...f, keterangan: e.target.value }))}
                />
              </div>
              <div className="p-3 rounded-xl bg-surface-container-low flex items-start gap-2 text-on-surface-variant text-[12px]">
                <span className="material-symbols-outlined text-[18px] text-primary shrink-0">info</span>
                <span>Pengajuan ini akan dikirim langsung ke dasbor Pengurus {tenant.rtFull} dan diproses maksimal 2x24 jam kerja.</span>
              </div>
              <div className="flex items-center justify-end gap-3 pt-2">
                <button className="h-11 px-5 rounded-xl bg-surface-container-high text-on-surface text-sm hover:bg-surface-container" type="button" onClick={() => setShowOfficialModal(false)}>Batal</button>
                <button
                  className="h-11 px-6 rounded-xl bg-primary text-on-primary text-sm font-bold shadow-md hover:bg-primary-container disabled:opacity-60 disabled:cursor-not-allowed"
                  type="submit"
                  disabled={kirimAjuanSedang}
                >
                  {kirimAjuanSedang ? "Mengirim…" : "Kirim Pengajuan ke RT"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- Modal Tambah KK Baru ---------- */
interface AnggotaBaru {
  nama: string;
  nik: string;
  hubungan: string;
  jenisKelamin: string;
  tanggalLahir: string;
  pekerjaan: string;
  agama: string;
  statusPernikahan: string;
  noWa: string;
  goldarah: string;
}

function TambahKkModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (kk: KkData) => void }) {
  const [noKk, setNoKk] = useState("");
  const [alamat, setAlamat] = useState(`Blok B4 No. 12, ${tenant.label}`);
  const [anggota, setAnggota] = useState<AnggotaBaru[]>([
    { nama: "", nik: "", hubungan: "Kepala Keluarga", jenisKelamin: "Laki-laki", tanggalLahir: "", pekerjaan: "", agama: "Islam", statusPernikahan: "Menikah", noWa: "", goldarah: "" },
  ]);
  const { flash, toast } = useFlash();


  function addAnggota() {
    setAnggota([
      ...anggota,
      { nama: "", nik: "", hubungan: "Anak", jenisKelamin: "Laki-laki", tanggalLahir: "", pekerjaan: "", agama: "Islam", statusPernikahan: "Belum Menikah", noWa: "", goldarah: "" },
    ]);
  }

  function removeAnggota(idx: number) {
    if (anggota.length <= 1) {
      flash("Minimal harus ada 1 anggota keluarga");
      return;
    }
    setAnggota(anggota.filter((_, i) => i !== idx));
  }

  function updateAnggota(idx: number, field: keyof AnggotaBaru, value: string) {
    const updated = [...anggota];
    updated[idx] = { ...updated[idx], [field]: value };
    setAnggota(updated);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!noKk.trim()) {
      flash("Nomor KK wajib diisi");
      return;
    }
    if (!/^\d+$/.test(noKk)) {
      flash("Nomor KK hanya boleh berisi angka");
      return;
    }
    if (noKk.length !== KK_LENGTH) {
      flash(`Nomor KK harus ${KK_LENGTH} digit (saat ini ${noKk.length} digit)`);
      return;
    }
    if (!anggota[0]?.nama.trim()) {
      flash("Nama Kepala Keluarga wajib diisi");
      return;
    }
    for (let i = 0; i < anggota.length; i++) {
      const a = anggota[i];
      if (a.nik && !/^\d+$/.test(a.nik)) {
        flash(`NIK anggota ${i + 1} hanya boleh berisi angka`);
        return;
      }
      if (a.nik && a.nik.length !== NIK_LENGTH) {
        flash(`NIK anggota ${i + 1} harus ${NIK_LENGTH} digit (saat ini ${a.nik.length} digit)`);
        return;
      }
      if (a.noWa && !/^\d+$/.test(a.noWa)) {
        flash(`No. WhatsApp anggota ${i + 1} hanya boleh berisi angka`);
        return;
      }
      if (a.noWa && (a.noWa.length < PHONE_MIN || a.noWa.length > PHONE_MAX)) {
        flash(`No. WhatsApp anggota ${i + 1} harus ${PHONE_MIN}-${PHONE_MAX} digit (saat ini ${a.noWa.length} digit)`);
        return;
      }
    }

    const kepalas = anggota.filter((a) => a.hubungan === "Kepala Keluarga");
    const kepala = kepalas[0] || anggota[0];

    const members: FamilyMember[] = anggota.map((a, i) => ({
      name: a.nama,
      initials: a.nama.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase(),
      role: a.hubungan,
      filter: (a.hubungan === "Kepala Keluarga" ? "kepala" : a.hubungan === "Istri" ? "istri" : "anak") as MemberFilter,
      gender: a.jenisKelamin,
      age: a.tanggalLahir ? Math.floor((Date.now() - new Date(a.tanggalLahir).getTime()) / (365.25 * 24 * 60 * 60 * 1000)) : 0,
      birthDate: a.tanggalLahir
        ? new Date(a.tanggalLahir).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })
        : "-",
      nik: a.nik || "3171-xxxx-xxxx-0000",
      nikFull: a.nik || "3171000000000000",
      relation: a.hubungan === "Kepala Keluarga" ? "Kepala Keluarga" : a.hubungan === "Istri" ? "Istri" : `Anak ke-${i}`,
      job: a.pekerjaan || "-",
      wa: a.noWa || "+62 8xx-xxxx-xxxx",
      email: "",
      blood: a.goldarah ? `${a.goldarah} (Rhesus +)` : "-",
      agama: a.agama,
      statusPernikahan: a.statusPernikahan,
      statusNote: "Menunggu Verifikasi RT",
      statusIcon: "schedule",
      statusColor: "text-primary",
      avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(a.nama)}&background=random&color=fff&size=128`,
      ringColor: "ring-surface-variant",
    }));

    const newKk: KkData = {
      id: `kk-${Date.now()}`,
      noKk,
      kepala: kepala.nama,
      alamat,
      anggota: members,
    };

    onSubmit(newKk);
  }

  return (
    <div className="fixed inset-0 z-50 bg-on-background/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-2xl rounded-2xl bg-surface-container-lowest shadow-2xl p-6 flex flex-col gap-5 max-h-[90vh] overflow-y-auto">
        {toast}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary-fixed/50 text-primary flex items-center justify-center">
              <span className="material-symbols-outlined text-[22px]">add_circle</span>
            </div>
            <div>
              <h3 className="text-base font-bold text-on-surface">Tambah Kartu Keluarga (KK) Baru</h3>
              <p className="text-xs text-on-surface-variant">1 rumah dapat memiliki lebih dari 1 KK</p>
            </div>
          </div>
          <button className="w-8 h-8 rounded-lg bg-surface-container flex items-center justify-center text-on-surface-variant hover:text-on-surface" onClick={onClose}>
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        <form className="flex flex-col gap-5" onSubmit={handleSubmit}>
          {/* Data KK */}
          <div className="flex flex-col gap-3 p-4 rounded-xl bg-surface-container-low">
            <h4 className="text-sm font-bold text-on-surface">Data Kartu Keluarga</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface">Nomor KK *</label>
                <input
                  className="w-full h-11 px-4 rounded-xl bg-surface-container-lowest text-sm text-on-surface font-mono focus:outline-none focus:ring-2 focus:ring-primary"
                  type="tel"
                  inputMode="numeric"
                  maxLength={KK_LENGTH}
                  placeholder={`${KK_LENGTH} digit angka`}
                  value={noKk}
                  onChange={(e) => setNoKk(onlyDigits(e.target.value))}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface">Alamat Lengkap</label>
                <input
                  className="w-full h-11 px-4 rounded-xl bg-surface-container-lowest text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary"
                  type="text"
                  value={alamat}
                  onChange={(e) => setAlamat(e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* Anggota Keluarga */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-bold text-on-surface">Anggota Keluarga ({anggota.length} orang)</h4>
              <button
                type="button"
                className="h-9 px-3 rounded-xl bg-primary-container text-on-primary text-xs font-bold hover:bg-primary hover:text-on-primary transition-colors flex items-center gap-1"
                onClick={addAnggota}
              >
                <span className="material-symbols-outlined text-[16px]">person_add</span>
                Tambah Anggota
              </button>
            </div>

            {anggota.map((a, idx) => (
              <div key={idx} className="p-4 rounded-xl bg-surface-container-low flex flex-col gap-3 border border-outline-variant/10">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-on-surface flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-primary text-on-primary text-[11px] font-bold flex items-center justify-center">{idx + 1}</span>
                    {a.hubungan} {idx === 0 && "(Kepala Keluarga)"}
                  </span>
                  {idx > 0 && (
                    <button type="button" className="text-error hover:text-on-error transition-colors" onClick={() => removeAnggota(idx)}>
                      <span className="material-symbols-outlined text-[18px]">delete</span>
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] font-bold text-on-surface-variant">Nama Lengkap *</label>
                    <input className="w-full h-10 px-3 rounded-lg bg-surface-container-lowest text-xs text-on-surface focus:outline-none focus:ring-2 focus:ring-primary" type="text" value={a.nama} onChange={(e) => updateAnggota(idx, "nama", e.target.value)} />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] font-bold text-on-surface-variant">NIK</label>
                    <input className="w-full h-10 px-3 rounded-lg bg-surface-container-lowest text-xs text-on-surface font-mono focus:outline-none focus:ring-2 focus:ring-primary" type="tel" inputMode="numeric" maxLength={NIK_LENGTH} placeholder={`${NIK_LENGTH} digit angka`} value={a.nik} onChange={(e) => updateAnggota(idx, "nik", onlyDigits(e.target.value))} />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] font-bold text-on-surface-variant">Hubungan *</label>
                    <select className="w-full h-10 px-3 rounded-lg bg-surface-container-lowest text-xs text-on-surface focus:outline-none focus:ring-2 focus:ring-primary" value={a.hubungan} onChange={(e) => updateAnggota(idx, "hubungan", e.target.value)}>
                      <option>Kepala Keluarga</option>
                      <option>Istri</option>
                      <option>Anak</option>
                      <option>Mertua</option>
                      <option>Pembantu</option>
                    </select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] font-bold text-on-surface-variant">Jenis Kelamin *</label>
                    <select className="w-full h-10 px-3 rounded-lg bg-surface-container-lowest text-xs text-on-surface focus:outline-none focus:ring-2 focus:ring-primary" value={a.jenisKelamin} onChange={(e) => updateAnggota(idx, "jenisKelamin", e.target.value)}>
                      <option>Laki-laki</option>
                      <option>Perempuan</option>
                    </select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] font-bold text-on-surface-variant">Tanggal Lahir</label>
                    <input className="w-full h-10 px-3 rounded-lg bg-surface-container-lowest text-xs text-on-surface focus:outline-none focus:ring-2 focus:ring-primary" type="date" value={a.tanggalLahir} onChange={(e) => updateAnggota(idx, "tanggalLahir", e.target.value)} />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] font-bold text-on-surface-variant">Pekerjaan</label>
                    <input className="w-full h-10 px-3 rounded-lg bg-surface-container-lowest text-xs text-on-surface focus:outline-none focus:ring-2 focus:ring-primary" type="text" value={a.pekerjaan} onChange={(e) => updateAnggota(idx, "pekerjaan", e.target.value)} />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] font-bold text-on-surface-variant">Agama *</label>
                    <select className="w-full h-10 px-3 rounded-lg bg-surface-container-lowest text-xs text-on-surface focus:outline-none focus:ring-2 focus:ring-primary" value={a.agama} onChange={(e) => updateAnggota(idx, "agama", e.target.value)}>
                      {agamaList.map((ag) => <option key={ag}>{ag}</option>)}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] font-bold text-on-surface-variant">Status Pernikahan *</label>
                    <select className="w-full h-10 px-3 rounded-lg bg-surface-container-lowest text-xs text-on-surface focus:outline-none focus:ring-2 focus:ring-primary" value={a.statusPernikahan} onChange={(e) => updateAnggota(idx, "statusPernikahan", e.target.value)}>
                      {statusPernikahanList.map((sp) => <option key={sp}>{sp}</option>)}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] font-bold text-on-surface-variant">No. WhatsApp</label>
                    <input className="w-full h-10 px-3 rounded-lg bg-surface-container-lowest text-xs text-on-surface font-mono focus:outline-none focus:ring-2 focus:ring-primary" type="tel" inputMode="numeric" maxLength={PHONE_MAX} placeholder="08xxxxxxxxxx" value={a.noWa} onChange={(e) => updateAnggota(idx, "noWa", onlyDigits(e.target.value))} />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] font-bold text-on-surface-variant">Golongan Darah</label>
                    <select className="w-full h-10 px-3 rounded-lg bg-surface-container-lowest text-xs text-on-surface focus:outline-none focus:ring-2 focus:ring-primary" value={a.goldarah} onChange={(e) => updateAnggota(idx, "goldarah", e.target.value)}>
                      <option value="">Pilih</option>
                      <option>A</option>
                      <option>B</option>
                      <option>AB</option>
                      <option>O</option>
                    </select>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="p-3 rounded-xl bg-surface-container-low flex items-start gap-2 text-on-surface-variant text-[12px]">
            <span className="material-symbols-outlined text-[18px] text-primary shrink-0">info</span>
            <span>KK baru akan diverifikasi oleh Pengurus {tenant.rtFull}. Setelah disetujui, data akan otomatis terdaftar di portal warga.</span>
          </div>

          <div className="flex items-center justify-end gap-3 pt-1">
            <button className="h-11 px-5 rounded-xl bg-surface-container-high text-on-surface text-sm hover:bg-surface-container" type="button" onClick={onClose}>Batal</button>
            <button className="h-11 px-6 rounded-xl bg-primary text-on-primary text-sm font-bold shadow-md hover:bg-primary-container" type="submit">Simpan KK Baru</button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ---------- Modal Tambah Anggota ke KK ---------- */
function TambahAnggotaModal({
  kkName,
  onClose,
  onAdd,
}: {
  kkName: string;
  onClose: () => void;
  onAdd: (m: FamilyMember) => void;
}) {
  const [nama, setNama] = useState("");
  const [nik, setNik] = useState("");
  const [hubungan, setHubungan] = useState("Anak");
  const [jenisKelamin, setJenisKelamin] = useState("Laki-laki");
  const [tanggalLahir, setTanggalLahir] = useState("");
  const [pekerjaan, setPekerjaan] = useState("");
  const [agama, setAgama] = useState("Islam");
  const [statusPernikahan, setStatusPernikahan] = useState("Belum Menikah");
  const [noWa, setNoWa] = useState("");
  const [goldarah, setGoldarah] = useState("");
  const { flash, toast } = useFlash();


  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!nama.trim()) { flash("Nama lengkap wajib diisi"); return; }
    if (nik && !/^\d+$/.test(nik)) { flash("NIK hanya boleh berisi angka"); return; }
    if (nik && nik.length !== NIK_LENGTH) { flash(`NIK harus ${NIK_LENGTH} digit (saat ini ${nik.length} digit)`); return; }
    if (noWa && !/^\d+$/.test(noWa)) { flash("No. WhatsApp hanya boleh berisi angka"); return; }
    if (noWa && (noWa.length < PHONE_MIN || noWa.length > PHONE_MAX)) { flash(`No. WhatsApp harus ${PHONE_MIN}-${PHONE_MAX} digit`); return; }

    const member: FamilyMember = {
      name: nama,
      initials: nama.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase(),
      role: hubungan,
      filter: (hubungan === "Kepala Keluarga" ? "kepala" : hubungan === "Istri" ? "istri" : "anak") as MemberFilter,
      gender: jenisKelamin,
      age: tanggalLahir ? Math.floor((Date.now() - new Date(tanggalLahir).getTime()) / (365.25 * 24 * 60 * 60 * 1000)) : 0,
      birthDate: tanggalLahir
        ? new Date(tanggalLahir).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })
        : "-",
      nik: nik || "3171-xxxx-xxxx-0000",
      nikFull: nik || "3171000000000000",
      relation: hubungan === "Kepala Keluarga" ? "Kepala Keluarga" : hubungan === "Istri" ? "Istri" : `Anak ke-1`,
      job: pekerjaan || "-",
      wa: noWa ? `+62 ${noWa}` : "-",
      email: "",
      blood: goldarah ? `${goldarah} (Rhesus +)` : "-",
      agama,
      statusPernikahan,
      statusNote: "Menunggu Verifikasi RT",
      statusIcon: "pending",
      statusColor: "text-outline",
      avatar: "https://lh3.googleusercontent.com/aida-public/AB6AXuCTUZo61na-G0petq_ViSUWDM11glUb9JnNFCYcMwmq3TcgnaKiAHbHeq8sAx6Y_cq1QODcOAxGIRrS6x35NHAZMZ3S2K3UU4u2z1eTs30B4dKOTnrSbXMkuIh5zJ5V2nDwCOF9rNgAh7-bHgVYcRreDVxttbS-OHBoFfHwI9oMioqELpwqEO7eQ0j_loRz8Yn_sQv1RCrcRchse3wx5cPhhJPs9djqSyHijlAXjXN63zze-lx7OW3d",
      ringColor: "ring-surface-variant",
    };

    onAdd(member);
  }

  return (
    <div className="fixed inset-0 z-50 bg-on-background/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-xl rounded-2xl bg-surface-container-lowest shadow-2xl p-6 flex flex-col gap-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary-fixed/50 text-primary flex items-center justify-center">
              <span className="material-symbols-outlined text-[22px]">person_add</span>
            </div>
            <div>
              <h3 className="text-base font-bold text-on-surface">Tambah Anggota Keluarga</h3>
              <p className="text-xs text-on-surface-variant">KK Kepala: {kkName}</p>
            </div>
          </div>
          <button className="w-8 h-8 rounded-lg bg-surface-container flex items-center justify-center text-on-surface-variant hover:text-on-surface" onClick={onClose}>
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-bold text-on-surface-variant">Nama Lengkap *</label>
              <input className="w-full h-10 px-3 rounded-lg bg-surface-container-lowest text-xs text-on-surface focus:outline-none focus:ring-2 focus:ring-primary" type="text" value={nama} onChange={(e) => setNama(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-bold text-on-surface-variant">NIK</label>
              <input className="w-full h-10 px-3 rounded-lg bg-surface-container-lowest text-xs text-on-surface font-mono focus:outline-none focus:ring-2 focus:ring-primary" type="tel" inputMode="numeric" maxLength={NIK_LENGTH} placeholder={`${NIK_LENGTH} digit angka`} value={nik} onChange={(e) => setNik(onlyDigits(e.target.value))} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-bold text-on-surface-variant">Hubungan *</label>
              <select className="w-full h-10 px-3 rounded-lg bg-surface-container-lowest text-xs text-on-surface focus:outline-none focus:ring-2 focus:ring-primary" value={hubungan} onChange={(e) => setHubungan(e.target.value)}>
                <option>Anak</option>
                <option>Istri</option>
                <option>Kepala Keluarga</option>
                <option>Mertua</option>
                <option>Pembantu</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-bold text-on-surface-variant">Jenis Kelamin *</label>
              <select className="w-full h-10 px-3 rounded-lg bg-surface-container-lowest text-xs text-on-surface focus:outline-none focus:ring-2 focus:ring-primary" value={jenisKelamin} onChange={(e) => setJenisKelamin(e.target.value)}>
                <option>Laki-laki</option>
                <option>Perempuan</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-bold text-on-surface-variant">Tanggal Lahir</label>
              <input className="w-full h-10 px-3 rounded-lg bg-surface-container-lowest text-xs text-on-surface focus:outline-none focus:ring-2 focus:ring-primary" type="date" value={tanggalLahir} onChange={(e) => setTanggalLahir(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-bold text-on-surface-variant">Pekerjaan</label>
              <input className="w-full h-10 px-3 rounded-lg bg-surface-container-lowest text-xs text-on-surface focus:outline-none focus:ring-2 focus:ring-primary" type="text" value={pekerjaan} onChange={(e) => setPekerjaan(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-bold text-on-surface-variant">Agama *</label>
              <select className="w-full h-10 px-3 rounded-lg bg-surface-container-lowest text-xs text-on-surface focus:outline-none focus:ring-2 focus:ring-primary" value={agama} onChange={(e) => setAgama(e.target.value)}>
                {agamaList.map((ag) => <option key={ag}>{ag}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-bold text-on-surface-variant">Status Pernikahan *</label>
              <select className="w-full h-10 px-3 rounded-lg bg-surface-container-lowest text-xs text-on-surface focus:outline-none focus:ring-2 focus:ring-primary" value={statusPernikahan} onChange={(e) => setStatusPernikahan(e.target.value)}>
                {statusPernikahanList.map((sp) => <option key={sp}>{sp}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-bold text-on-surface-variant">No. WhatsApp</label>
              <input className="w-full h-10 px-3 rounded-lg bg-surface-container-lowest text-xs text-on-surface font-mono focus:outline-none focus:ring-2 focus:ring-primary" type="tel" inputMode="numeric" maxLength={PHONE_MAX} placeholder="08xxxxxxxxxx" value={noWa} onChange={(e) => setNoWa(onlyDigits(e.target.value))} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-bold text-on-surface-variant">Golongan Darah</label>
              <select className="w-full h-10 px-3 rounded-lg bg-surface-container-lowest text-xs text-on-surface focus:outline-none focus:ring-2 focus:ring-primary" value={goldarah} onChange={(e) => setGoldarah(e.target.value)}>
                <option value="">Pilih</option>
                <option>A</option><option>B</option><option>AB</option><option>O</option>
              </select>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-surface-container-low flex items-start gap-2 text-on-surface-variant text-[12px]">
            <span className="material-symbols-outlined text-[18px] text-primary shrink-0">info</span>
            <span>Penambahan anggota baru akan diverifikasi oleh Pengurus {tenant.rtFull}. Lampirkan dokumen pendukung jika diperlukan.</span>
          </div>

          <div className="flex items-center justify-end gap-3 pt-1">
            <button className="h-11 px-5 rounded-xl bg-surface-container-high text-on-surface text-sm hover:bg-surface-container" type="button" onClick={onClose}>Batal</button>
            <button className="h-11 px-6 rounded-xl bg-primary text-on-primary text-sm font-bold shadow-md hover:bg-primary-container" type="submit">Tambahkan Anggota</button>
          </div>
        </form>
      </div>

      {toast}
    </div>
  );
}
