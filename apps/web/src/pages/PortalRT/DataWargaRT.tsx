import { useEffect, useState } from "react";
import { tenant } from "../../lib/tenant";
import {
  KkData,
  WargaRt,
  HunianRumah,
  DetailKk,
  digitsOnly,
  noKkNorm,
  initialsOf,
  fmtWa,
  memberWaValue,
  maskedNik,
  fmtNoKk,
  maskedNoKk,
  badgePortal,
  linkFor,
  buildMember,
  gabungDaftarWarga,
  shortAlamat,
  downloadText,
  detailKosong,
  detailDariMember,
  detailDariRow,
  detailKeRow,
  terapkanDetailKeMember,
  tglKeIso,
  isoKeTgl,
  usiaDariTgl,
  AnggotaBaru,
  anggotaKosong,
  anggotaTerisi,
  buildMemberBaru,
  LABEL_JENIS_AJUAN,
  LABEL_STATUS_AJUAN,
  KIRI_AJUAN,
  type AjuanPerubahanRt,
} from "../../lib/shared";
import { Undangan } from "../../lib/undangan";
import {
  GalatApi,
  barisServerKeWargaRt,
  enumAman,
  golDarahKeServer,
  hubunganKeServer,
  jenisKelaminKeServer,
  keluargaKeKkData,
  statusAksesKePortal,
  statusKawinKeServer,
  wargaNegaraKeServer,
  type AnggotaBaruServer,
  type BarisWargaRtServer,
  type HasilImporWarga,
  type KeluargaRingkasServer,
  type PatchWargaRt,
  type StatusAksesServer,
  type TambahWargaRtPayload,
  type TemuanInspeksiUndangan,
} from "../../lib/api";
import { KartuUndangan } from "../Undangan/KartuUndangan";
import { EmptyState } from "../../components/EmptyState";
import { KonfirmasiDialog } from "../../components/KonfirmasiDialog";
import { useFlash } from "../../lib/useFlash";

interface DataWargaRTProps {
  onNavigate?: (page: string) => void;
  /**
   * Sesi berjalan dalam MODE DEMO — `LoginPage` menandai `modeDemo: true` bila
   * pengguna masuk saat server tidak terjangkau (banner "MODE DEMO" di App).
   *
   * `false` (sesi daring biasa) → galat `OFFLINE` pada mutasi adalah KEgagalan
   * NYATA: form dipertahankan terbuka dan pesan menyatakan data TIDAK masuk
   * database. Tanpa cabang ini, jalur lokal menutup form dengan pesan yang
   * PERSIS sama dengan jalur server ("berhasil ditambahkan") — itulah akar bug
   * data "Siti Hamizah" 6 Okt 2026: pengguna disuguhi sukses padahal request
   * tidak pernah mencapai server (tidak ada `POST /rt/warga` di log API,
   * tidak ada baris di DB, tidak ada audit).
   */
  modeDemo?: boolean;
  kkList: KkData[];
  wargaRt: WargaRt[];
  /**
   * §6.1 · daftar hunian (Data Hunian, server) — alamat unit terdaftar ikut
   * masuk dropdown "alamat terdaftar" walau belum ada KK di atasnya. Tanpa
   * ini, alamat hasil Tambah Hunian tidak pernah muncul di sini (akar bug
   * alamat hunian terblokir di form Tambah Data KK).
   */
  hunian?: HunianRumah[];
  onWargaRtChange: (next: WargaRt[]) => void;
  onKkUpdated: (kkId: string, patch: Partial<KkData>) => void;
  /** Tambah 1 KK baru (berisi beberapa NIK) dari form Tambah Data KK. */
  onKkAdded: (kk: KkData) => void;
  // --- B13 · CRUD Data Warga ke API (§5.4) — API-first ------------------------
  // Handler tipis dari App.tsx: sukses → objek respons server; OFFLINE → `null`
  // (halaman lanjut jalur demo lokal); galat non-OFFLINE DILEMPAR agar pesan
  // server tampil — tidak pernah "berhasil" untuk kegagalan. Penerapan state
  // (baris + KK dari respons) dilakukan halaman ini sendiri.
  /** PATCH /rt/warga/:id — `{ warga, keluarga }` terbaru dari server. */
  onSimpanWarga?: (
    id: string,
    patch: PatchWargaRt,
  ) => Promise<{ warga: BarisWargaRtServer; keluarga: KeluargaRingkasServer } | null>;
  /** POST /rt/warga — KK baru (N anggota) dalam satu transaksi server. */
  onTambahWarga?: (
    payload: TambahWargaRtPayload,
  ) => Promise<{ warga: BarisWargaRtServer[]; keluarga: KeluargaRingkasServer } | null>;
  /**
   * POST /rt/warga/:kkId/anggota (Okt 2026) — tambah anggota ke KK YANG SUDAH
   * ADA. Tujuan dipegang UUID `kkId` dari `kkList` (No. KK & alamat form
   * dikunci); OFFLINE → `null` (jalur demo lokal dengan pesan jujur); galat
   * non-OFFLINE DILEMPAR agar pesan server tampil — tidak pernah sukses palsu.
   */
  onTambahAnggotaKk?: (
    kkId: string,
    anggota: AnggotaBaruServer[],
  ) => Promise<{ warga: BarisWargaRtServer[]; keluarga: KeluargaRingkasServer } | null>;
  /** DELETE /rt/warga/:id — `keluarga` = KK sisa (tetap ada walau kosong). */
  onHapusWarga?: (
    id: string,
  ) => Promise<{ id: string; keluarga: KeluargaRingkasServer | null } | null>;
  /**
   * A10 · Migrasi Data (§9.1(6)): kirim berkas ke `POST /rt/warga/import`
   * (multipart, §5.4). OFFLINE → `null` (mode demo — halaman menampilkan
   * pesan jujur, tidak ada "impor sukses" palsu); galat non-OFFLINE
   * DILEMPAR agar pesan server tampil. Sukses → App.tsx memuat ulang daftar
   * warga + KK (impor dapat membuat banyak KK sekaligus) — halaman ini cukup
   * menampilkan ringkasan hasil + alasan penolakan.
   */
  onImporWarga?: (file: File) => Promise<HasilImporWarga | null>;
  /** Daftar undangan aktif (sumber kebenaran bersama di App.tsx). */
  undangan: Undangan[];
  /**
   * Terbitkan undangan untuk warga terdaftar ini — API-first (Fase 3):
   * backend menyala → token asli dari server; backend mati → daftar lokal
   * (mode demo). Galat API NON-OFFLINE dilempar sebagai `GalatApi` agar
   * pemanggil menampilkannya lewat `flash` — jangan ditelan diam-diam.
   */
  onUndanganWarga: (data: {
    nama: string;
    alamat: string;
    noWa: string;
    /**
     * UUID warga (bila baris berasal dari server) — dipakai sebagai kunci
     * `POST /rt/warga/:id/undangan`. Tanpa ini, warga TANPA no. HP menghasilkan
     * path kosong (`/rt/warga//undangan` → 404) dan undangan tak pernah terbit.
     * Server tetap yang memvalidasi no. HP (pesan VALIDATION jujur).
     */
    idWarga?: string;
  }) => Promise<Undangan>;
  /**
   * F-5 · B11: antrean ajuan perubahan data warga (dari App lewat
   * `GET /rt/ajuan-perubahan`). Kosong = belum ada pengajuan.
   */
  ajuan?: AjuanPerubahanRt[];
  /**
   * F-5 · B20: setujui/tolak 1 ajuan — API-first; OFFLINE → baris lokal.
   * Galat lain (409 sudah diproses, sesi habis) DITERUSKAN agar halaman
   * menampilkan gagal — tidak pernah "berhasil" untuk kegagalan.
   */
  onVerifikasiAjuan?: (id: string, aksi: "setujui" | "tolak", catatan?: string) => Promise<void>;
  // --- B5 · manajemen undangan & akses portal (§5.4) -------------------------
  // Semua API-first: sukses → hasil server; OFFLINE → `null` (mode demo, halaman
  // lanjut jalur lokal); galat non-OFFLINE DILEMPAR agar pesan server tampil.
  /**
   * POST `/rt/undangan/:id/kirim-ulang` — token lama dicabut, token baru terbit.
   * `tokenId` wajib berupa UUID token server (entri daftar demo tidak dipanggil).
   */
  onKirimUlangUndangan?: (tokenId: string, noHpBaru?: string) => Promise<Undangan | null>;
  /** DELETE `/rt/undangan/:id` — cabut undangan (idempoten di server). */
  onCabutUndangan?: (tokenId: string) => Promise<boolean | null>;
  /** PATCH `/rt/warga/:id/akses` — HANYA `"dinonaktifkan"` (Okt 2026: pengurus RT hanya dapat merubah status portal MENJADI nonaktif; server menolak `aktif` 400); sesi warga ikut dicabut. */
  onUbahAksesWarga?: (
    idWarga: string,
    tujuan: "dinonaktifkan",
  ) => Promise<StatusAksesServer | null>;
  // --- B6 · kotak masuk keamanan --------------------------------------------
  /** GET `/rt/undangan/inspeksi` — token yang disentuh >1 perangkat; OFFLINE → `null` (chip disembunyikan). */
  onInspeksiUndangan?: () => Promise<TemuanInspeksiUndangan[] | null>;
}

/** Aksi B5 yang butuh konfirmasi (kirim ulang / cabut / nonaktifkan) — "aktifkan" DIHAPUS: pengurus RT tak punya kewenangan itu (Okt 2026). */
type AksiAkses = "kirim-ulang" | "cabut" | "nonaktifkan";

type PortalStatus = "all" | "aktif" | "belum-aktif" | "undangan" | "kedaluwarsa" | "dinonaktifkan";

/** ID token server selalu UUID — entri demo (`un1`, …) tidak pernah dikirim ke API. */
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Gaya tombol aksi B5 — aksi merusak (cabut/nonaktifkan) memakai aksen error. */
const AKSES_KELAS: Record<AksiAkses, string> = {
  "kirim-ulang": "bg-tertiary-container/40 text-on-tertiary-container hover:bg-tertiary-container",
  cabut: "bg-error-container/30 text-error hover:bg-error-container hover:text-on-error-container",
  nonaktifkan: "bg-error-container/30 text-error hover:bg-error-container hover:text-on-error-container",
};

/**
 * Bug laporan · status kiriman undangan harus terbaca dari tabel Data Warga.
 * Baris KK hanya memuat badge agregat "X/Y aktif" (anggota Aktif tidak lagi
 * butuh perhatian) — daftar status di bawahnya melengkapi yang sisanya.
 */
const LABEL_STATUS_PORTAL: Record<string, string> = {
  "Belum Aktif": "belum aktif",
  "Undangan Dikirim": "undangan dikirim",
  "Kedaluwarsa": "kedaluwarsa",
  Dinonaktifkan: "dinonaktifkan",
};

// Opsi form Edit Data Warga (14 kolom data KK) — daftarnya sama dengan yang
// dipakai Data Keluarga di Portal Warga supaya nilainya selalu cocok.
const agamaOpsi = ["Islam", "Kristen Protestan", "Kristen Katolik", "Hindu", "Buddha", "Konghucu", "Lainnya"];
const statusKawinOpsi = ["Belum Menikah", "Menikah", "Cerai Hidup", "Cerai Mati"];
const jenisKelaminOpsi = ["Laki-laki", "Perempuan"];
const goldarahOpsi = ["A", "B", "AB", "O"];
const pendidikanOpsi = ["Tidak Sekolah", "TK", "SD", "SMP", "SMA / SMK", "Diploma", "S1", "S2", "S3", "Lainnya"];
const hubunganOpsi = ["Kepala Keluarga", "Istri", "Anak", "Ayah / Ibu", "Mertua", "Lainnya"];
const pekerjaanOpsi = [
  "Pegawai Negeri", "TNI / Polri", "Pegawai Swasta", "Wiraswasta", "Petani",
  "Nelayan", "Buruh", "Guru / Dosen", "Kesehatan", "Pelajar", "Mahasiswa", "Ibu Rumah Tangga", "Belum Bekerja", "Lainnya",
];
const wargaNegaraOpsi = ["WNI", "WNA"];

/** Nilai di luar daftar opsi tetap ditampilkan agar pilihan lama tidak hilang. */
function denganNilai(opsi: string[], nilai: string): string[] {
  const v = nilai.trim();
  return v && !opsi.includes(v) ? [v, ...opsi] : opsi;
}

export function DataWargaRT({ onNavigate, modeDemo = false, kkList, wargaRt, hunian = [], onWargaRtChange, onKkUpdated, onKkAdded, onSimpanWarga, onTambahWarga, onTambahAnggotaKk, onHapusWarga, onImporWarga, undangan, onUndanganWarga, ajuan = [], onVerifikasiAjuan, onKirimUlangUndangan, onCabutUndangan, onUbahAksesWarga, onInspeksiUndangan }: DataWargaRTProps) {
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<PortalStatus>("all");
  /**
   * KK yang dibuka pada modal "Anggota Keluarga" (keputusan 8 Okt 2026):
   * tabel hanya menampilkan SATU baris per kepala keluarga + jumlah anggota
   * (tanpa sub-baris); kelola tambah/ubah/hapus anggota dilakukan lewat
   * modal ini sehingga tabel tetap ringkas.
   */
  const [kkKeluarga, setKkKeluarga] = useState<KkData | null>(null);
  const [showInputModal, setShowInputModal] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [editing, setEditing] = useState<WargaRt | null>(null);
  const [detailWarga, setDetailWarga] = useState<WargaRt | null>(null);
  const [kartuUndangan, setKartuUndangan] = useState<Undangan | null>(null);
  /**
   * Bug laporan · antrean kartu QR untuk kirim massal (baris keluarga / modal
   * "Kirim Undangan"). Kosong = kartu tunggal (jalur per-warga). Token hanya
   * ada saat penerbitan, jadi QR SEMUA penerima wajib ditampilkan berurutan di
   * sesi ini — tidak bisa dipanggil ulang tanpa memutar token.
   */
  const [antreanKartu, setAntreanKartu] = useState<Undangan[]>([]);
  /** Indeks kartu aktif di antrean massal (−1 = kartu tunggal → pager disembunyikan). */
  const idxKartu = kartuUndangan ? antreanKartu.findIndex((u) => u === kartuUndangan) : -1;
  const [selectedWarga, setSelectedWarga] = useState<string[]>([]);
  /** Menceklik dua kali saat penerbitan undangan masih berjalan (menunggu API). */
  const [kirimSedang, setKirimSedang] = useState(false);
  /** Kunci tombol simpan/hapus selama panggilan API CRUD (B13) sedang berjalan. */
  const [simpanSedang, setSimpanSedang] = useState(false);
  // F-5 · B11/B20: antrean ajuan perubahan data + modal alasan penolakan
  // (alasan wajib ≥ 3 karakter — kontrak server `POST .../tolak`).
  const [ajuanDitolak, setAjuanDitolak] = useState<AjuanPerubahanRt | null>(null);
  const [alasanTolak, setAlasanTolak] = useState("");
  const [prosesAjuan, setProsesAjuan] = useState(false);
  const { flash, toast } = useFlash();
  const [uploadFileName, setUploadFileName] = useState("");
  /** Berkas terpilih — objek `File` asli yang dikirim ke server (nama saja tak cukup). */
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  /** Sedang mengimpor — tombol dimatikan agar berkas tak terkirim dua kali. */
  const [imporSedang, setImporSedang] = useState(false);

  // ---- Form "Tambah Data KK": 1 KK berisi beberapa NIK (kepala, istri, anak) ----
  const [formKk, setFormKk] = useState({ noKk: "", alamat: "" });
  const [anggotaBaru, setAnggotaBaru] = useState<AnggotaBaru[]>([
    { ...anggotaKosong(), hubungan: "Kepala Keluarga" },
  ]);
  /**
   * Mode "Tambah Anggota" (Okt 2026): `null` = form KK baru; terisi = form
   * menambah anggota ke KK INI (No. KK & alamat dikunci, tujuan dipegang
   * `kkTujuan.id`). Membuka form KK baru selalu mengembalikan `null` — kedua
   * mode tidak pernah bercampur dalam satu submit.
   */
  const [kkTujuan, setKkTujuan] = useState<KkData | null>(null);

  const [formEdit, setFormEdit] = useState({
    nama: "",
    nik: "",
    noKk: "",
    alamat: "",
    noWa: "",
    statusPortal: "Aktif",
    // 14 kolom data KK lengkap (lihat lib/shared.ts → DetailKk).
    ...detailKosong,
  });

  // Toggle mata: NIK & No. KK tampil ter-mask secara bawaan.
  const [lihatNik, setLihatNik] = useState(false);
  const [lihatNoKk, setLihatNoKk] = useState(false);

  // Konfirmasi hapus data warga yang sudah tidak dipakai.
  const [hapusTarget, setHapusTarget] = useState<WargaRt | null>(null);

  // B5 · konfirmasi aksi undangan/akses yang menunggu jawaban pengguna, dan
  // kunci anti klik-ganda selama panggilan API-nya berjalan.
  const [konfirmasiAksi, setKonfirmasiAksi] = useState<{ jenis: AksiAkses; warga: WargaRt } | null>(null);
  const [aksiSedang, setAksiSedang] = useState(false);

  // B6 · kotak masuk keamanan: `null` = belum dimuat / OFFLINE (chip disembunyikan).
  const [temuan, setTemuan] = useState<TemuanInspeksiUndangan[] | null>(null);
  const [lihatTemuan, setLihatTemuan] = useState(false);
  const [inspeksiSedang, setInspeksiSedang] = useState(false);

  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [editErrors, setEditErrors] = useState<Record<string, string>>({});

  // B6 · muat kotak masuk keamanan sekali saat halaman dibuka. OFFLINE → `null`
  // (chip "Perlu Perhatian" tak pernah muncul di mode demo); galat lain sudah
  // ditangani App (`tanganiSesiHabis`) dan di sini cukup senyap — halaman lain
  // tetap utuh. Handler App tidak dimemoisasi → daftar dependensi `[]` + eslint-disable.
  useEffect(() => {
    if (!onInspeksiUndangan) return;
    let batal = false;
    setInspeksiSedang(true);
    onInspeksiUndangan()
      .then((d) => {
        if (!batal) setTemuan(d);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!batal) setInspeksiSedang(false);
      });
    return () => {
      batal = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Muat ulang temuan keamanan (dipakai tombol refresh di modal inspeksi). */
  async function segarkanInspeksi() {
    if (!onInspeksiUndangan || inspeksiSedang) return;
    setInspeksiSedang(true);
    try {
      setTemuan(await onInspeksiUndangan());
    } catch {
      // galat sudah ditangani App (sesi habis → halaman masuk)
    } finally {
      setInspeksiSedang(false);
    }
  }


  /* ---------- Baris tampilan: gabungan data RT + data KK dari Portal Warga ---------- */
  // Urutan selalu berdasarkan Alamat lalu No. KK (sesuai permintaan Pengurus RT).
  const pengurutDataWarga = (a: WargaRt, b: WargaRt): number => {
    const opt = { numeric: true, sensitivity: "base" } as const;
    const alamat = shortAlamat(a.alamat).localeCompare(shortAlamat(b.alamat), "id", opt);
    if (alamat !== 0) return alamat;
    // No. KK disimpan dalam dua gaya ("3171050101050002" vs "3171-0512-1290-0077").
    // Tanpa dinormalkan, tanda hubung ('-') selalu dianggap lebih kecil dari angka
    // sehingga KK ber-format meleset ke atas. Samakan dulu nilainya.
    return noKkNorm(a.noKk).localeCompare(noKkNorm(b.noKk), "id", opt);
  };
  const rows: WargaRt[] = gabungDaftarWarga(kkList, wargaRt).sort(pengurutDataWarga);

  const alamatOptions = Array.from(
    new Set([
      ...rows.map((r) => r.alamat.trim()).filter(Boolean),
      ...kkList.map((k) => shortAlamat(k.alamat)),
      // §6.1 · alamat unit dari daftar hunian server ikut muncul walau belum
      // ada KK — inilah perbaikan "alamat hasil Tambah Hunian tak terlihat".
      ...hunian.map((h) => shortAlamat(h.alamat)),
    ])
  ).sort();

  /** Validasi form Tambah Data KK (No. KK + alamat + daftar anggota). */
  function validateTambahKk(): boolean {
    const errors: Record<string, string> = {};
    const modeAnggota = kkTujuan !== null;
    // Mode Tambah Anggota: No. KK & alamat terkunci dari KK tujuan (sudah
    // valid di server) — validasi 16 digit/alamat hanya untuk KK BARU.
    if (!modeAnggota) {
      if (digitsOnly(formKk.noKk).length !== 16) errors.noKk = "No. KK harus 16 digit angka";
      if (!formKk.alamat.trim()) errors.alamat = "Alamat wajib diisi";
    }

    // NIK tidak boleh ganda di seluruh sistem. No. KK & alamat BOLEH sama:
    // 1 KK memuat banyak NIK, dan 1 alamat boleh dipakai lebih dari 1 KK.
    const terpakai = new Set<string>();
    kkList.forEach((k) => k.anggota.forEach((m) => terpakai.add(digitsOnly(m.nikFull ?? m.nik))));
    wargaRt.forEach((w) => {
      const n = digitsOnly(w.nik);
      if (n) terpakai.add(n);
    });

    const dalamForm = new Set<string>();
    let adaKepala = false;

    anggotaBaru.forEach((a, i) => {
      if (!anggotaTerisi(a)) return; // baris kosong diabaikan

      if (!/^\d{16}$/.test(a.nik)) errors[`nik-${i}`] = "NIK harus 16 digit angka";
      else if (terpakai.has(a.nik)) errors[`nik-${i}`] = "NIK ini sudah terdaftar di sistem";
      else if (dalamForm.has(a.nik)) errors[`nik-${i}`] = "NIK sama dipakai lebih dari satu anggota";
      else dalamForm.add(a.nik);

      if (!a.nama.trim()) errors[`nama-${i}`] = "Nama lengkap wajib diisi";
      if (!a.hubungan) errors[`hubungan-${i}`] = "Hubungan wajib dipilih";
      if (a.hubungan === "Kepala Keluarga") adaKepala = true;

      const wa = digitsOnly(a.waDigits);
      if (a.waDigits && (wa.length < 10 || wa.length > 13)) errors[`noWa-${i}`] = "No. WA harus 10-13 digit";
    });

    if (!anggotaBaru.some(anggotaTerisi)) errors.anggota = "Isi minimal satu anggota keluarga";
    // Syarat "minimal satu Kepala" hanya untuk KK BARU; KK tujuan mode
    // Tambah Anggota sudah punya kepala keluarga.
    else if (!adaKepala && kkTujuan === null)
      errors.anggota = "Pilih minimal satu anggota berstatus Kepala Keluarga";

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  }

  /**
   * Baris form anggota → payload `AnggotaBaruServer` (label FE dikonversi ke
   * enum server). Dipakai kedua mode: KK BARU (`POST /rt/warga`) dan TAMBAH
   * ANGGOTA ke KK ada (`POST /rt/warga/:kkId/anggota`) — pemetaan identik,
   * sekali didefinisikan agar jalur tidak pernah berbeda diam-diam.
   */
  function anggotaServerDariForm(): AnggotaBaruServer[] {
    return anggotaBaru.filter(anggotaTerisi).map((a) => ({
      nama: a.nama.trim(),
      nik: a.nik,
      hubungan: hubunganKeServer(a.hubungan),
      jenisKelamin: jenisKelaminKeServer(a.jenisKelamin),
      agama: a.agama.trim() || null,
      tanggalLahir: a.tglLahir || null,
      pekerjaan: a.pekerjaan.trim() || null,
      noHp: digitsOnly(a.waDigits) || null,
    }));
  }

  async function handleSubmitKk(e: React.FormEvent) {
    e.preventDefault();
    if (simpanSedang) return;
    if (!validateTambahKk()) return;

    setSimpanSedang(true);
    try {
      // ===== Mode Tambah Anggota: rujuk ke KK yang sudah ada (Okt 2026) =====
      // Tujuan dipegang `kkTujuan.id` (UUID dari kkList) — No. KK & alamat
      // form dikunci, sehingga baris baru mustahil masuk ke KK lain.
      if (kkTujuan) {
        const tujuan = kkTujuan;
        let hasil: { warga: BarisWargaRtServer[]; keluarga: KeluargaRingkasServer } | null = null;
        if (onTambahAnggotaKk) {
          hasil = await onTambahAnggotaKk(tujuan.id, anggotaServerDariForm());
        }
        if (hasil) {
          const baris = hasil.warga.map(barisServerKeWargaRt);
          onWargaRtChange([...wargaRt, ...baris]);
          onKkUpdated(hasil.keluarga.kk.id, keluargaKeKkData(hasil.keluarga));
          flash(
            `${hasil.warga.length} anggota baru (${hasil.warga.map((b) => b.nama).join(", ")}) ditambahkan ke KK ${hasil.keluarga.kk.noKk} — tersimpan di server.`,
          );
          tutupInput();
          return;
        }
        // Sesi DARING (bukan mode demo) tetapi mutasi gagal terkirim →
        // kegagalan NYATA (pola batch 10): form tetap terbuka & pesan
        // menyatakan data TIDAK masuk database — tanpa sukses palsu.
        if (!modeDemo) {
          flash(
            "Server tidak terjangkau saat menyimpan — anggota TIDAK masuk database. Form tetap terbuka; perbaiki koneksi lalu tekan Simpan kembali.",
          );
          return;
        }
        // MODE DEMO (sah): tambah lokal ke KK ini — pesan wajib menyebut
        // TIDAK tersimpan di server.
        const baru = anggotaBaru.filter(anggotaTerisi).map(buildMemberBaru);
        onKkUpdated(tujuan.id, { ...tujuan, anggota: [...tujuan.anggota, ...baru] });
        flash(
          `${baru.length} anggota (${baru.map((m) => m.name).join(", ")}) ditambahkan ke KK ${maskedNoKk(tujuan.noKk)} di daftar sesi ini (mode demo — TIDAK tersimpan di server).`,
        );
        tutupInput();
        return;
      }

      // B13 · API-first: server membuat KK + seluruh N anggota dalam SATU
      // transaksi (KK kosong/parsial tidak mungkin tersisa, §5.4). OFFLINE →
      // `null` → jalur demo lokal di bawah; galat lain → flash + batal.
      if (onTambahWarga) {
        const payload: TambahWargaRtPayload = {
          noKk: digitsOnly(formKk.noKk),
          alamat: formKk.alamat.trim(),
          anggota: anggotaServerDariForm(),
        };
        const hasil = await onTambahWarga(payload);
        if (hasil) {
          const baris = hasil.warga.map(barisServerKeWargaRt);
          onWargaRtChange([...wargaRt, ...baris]);
          onKkAdded(keluargaKeKkData(hasil.keluarga));
          flash(
            `Data KK "${hasil.keluarga.kk.alamat}" — ${hasil.warga.length} anggota (Kepala: ${hasil.keluarga.kk.kepala}) berhasil ditambahkan.`,
          );
          tutupInput();
          return;
        }
      }

      // Sesi DARING (bukan mode demo) tetapi mutasi gagal terkirim → kegagalan
      // NYATA: form dipertahankan terbuka agar bisa diulang dan pesan
      // menyatakan data TIDAK masuk database. Tanpa cabang ini, pesan jalur
      // lokal yang identik dengan jalur server menutup form atas nama "sukses"
      // padahal datanya hanya hidup di memori browser (laporan "Siti Hamizah",
      // 6 Okt 2026 — tidak ada POST /rt/warga di log API).
      if (!modeDemo) {
        flash(
          "Server tidak terjangkau saat menyimpan — data TIDAK masuk database. Form tetap terbuka; perbaiki koneksi lalu tekan Simpan kembali.",
        );
        return;
      }

      // Jalur lokal (MODE DEMO sah) — pesan wajib menyebut tidak tersimpan.
      const anggota = anggotaBaru.filter(anggotaTerisi).map((a) => buildMemberBaru(a));
      const kepala = anggota.find((m) => m.filter === "kepala")?.name ?? anggota[0].name;
      const kk: KkData = {
        id: `kk-${Date.now()}`,
        noKk: fmtNoKk(formKk.noKk),
        kepala,
        alamat: formKk.alamat.trim(),
        anggota,
      };
      onKkAdded(kk);
      flash(
        `Data KK "${kk.alamat}" — ${anggota.length} anggota (Kepala: ${kepala}) ditambahkan di daftar sesi ini (mode demo — TIDAK tersimpan di server).`,
      );
      tutupInput();
    } catch (err) {
      flash(
        err instanceof GalatApi
          ? err.message
          : kkTujuan
            ? "Gagal menyimpan anggota keluarga — data tidak ditambahkan."
            : "Gagal menyimpan Data KK.",
      );
    } finally {
      setSimpanSedang(false);
    }
  }

  /* ---------- Aksi form Tambah Data KK ---------- */
  /** Hilangkan 1 pesan error begitu pengguna mengubah isinya. */
  function hapusError(kunci: string) {
    setFormErrors((prev) => {
      if (!(kunci in prev)) return prev;
      const next = { ...prev };
      delete next[kunci];
      return next;
    });
  }

  function ubahFormKk(field: "noKk" | "alamat", value: string) {
    hapusError(field);
    setFormKk((prev) => ({ ...prev, [field]: value }));
  }

  function bukaInput() {
    setFormKk({ noKk: "", alamat: "" });
    setAnggotaBaru([{ ...anggotaKosong(), hubungan: "Kepala Keluarga" }]);
    setFormErrors({});
    setKkTujuan(null); // form KK BARU — bukan mode tambah anggota
    setShowInputModal(true);
  }

  /**
   * Buka form Tambah Anggota untuk 1 KK yang sudah ada (Okt 2026). No. KK &
   * alamat dikunci dari KK tujuan — anggota baru mustahil dirujuk ke KK lain;
   * baris pertama sengaja TANPA hubungan bawaan "Kepala" (KK sudah punya
   * kepala keluarga).
   */
  function bukaTambahAnggota(kk: KkData) {
    setFormKk({ noKk: kk.noKk, alamat: kk.alamat });
    setAnggotaBaru([anggotaKosong()]);
    setFormErrors({});
    setKkTujuan(kk);
    setShowInputModal(true);
  }

  function tutupInput() {
    setShowInputModal(false);
    setFormErrors({});
    setKkTujuan(null);
  }

  /** Hapus error per-anggota saja (error No. KK/Alamat tetap disimpan). */
  function bersihkanErrorAnggota() {
    setFormErrors((prev) => {
      const next: Record<string, string> = {};
      for (const [k, v] of Object.entries(prev)) {
        if (k !== "anggota" && !/^(nik|nama|hubungan|noWa)-\d+$/.test(k)) next[k] = v;
      }
      return next;
    });
  }

  /** Peta field anggota → kunci pesan error yang melekat padanya. */
  const errorAnggota: Record<string, string> = { nik: "nik", nama: "nama", hubungan: "hubungan", waDigits: "noWa" };

  function ubahAnggota(i: number, field: keyof AnggotaBaru, value: string) {
    const kunci = errorAnggota[field];
    if (kunci) hapusError(`${kunci}-${i}`);
    setAnggotaBaru((prev) => prev.map((a, idx) => (idx === i ? { ...a, [field]: value } : a)));
  }

  function tambahAnggota() {
    bersihkanErrorAnggota();
    setAnggotaBaru((prev) => [...prev, anggotaKosong()]);
  }

  function hapusAnggotaBaris(i: number) {
    bersihkanErrorAnggota();
    setAnggotaBaru((prev) => prev.filter((_, idx) => idx !== i));
  }

  /**
   * KK tujuan "Tambah Anggota" untuk 1 baris — `null` bila baris tak terpasang
   * di KK mana pun (data contoh/non-KK). Dipakai pengelompokan tabel: baris
   * dengan KK yang sama digabung jadi induk + sub-baris anggota.
   */
  function kkUntukBaris(w: WargaRt): KkData | null {
    const link = linkFor(w, kkList);
    return (link ? kkList.find((k) => k.id === link.kkId) : undefined) ?? null;
  }

  /**
   * Aksi baris anggota/tunggal: Edit, Detail, Hapus, Undangan, dan aksi
   * Status Portal (konfirmasi dulu). Tombol "Tambah Anggota" TIDAK ada di
   * sini — pintunya baris INDUK KK (satu per keluarga, selalu terlihat).
   */
  function aksiBaris(w: WargaRt) {
    return (
      <>
        <button
          className="h-8 px-3 rounded-lg bg-surface-container-low text-on-surface-variant hover:text-primary hover:bg-surface-container text-xs font-semibold inline-flex items-center gap-1 transition-colors"
          onClick={() => openEdit(w)}
        >
          <span className="material-symbols-outlined text-[14px]">edit</span>
          Edit
        </button>
        <button
          className="h-8 px-3 rounded-lg bg-surface-container-low text-on-surface-variant hover:text-primary hover:bg-surface-container text-xs font-semibold inline-flex items-center gap-1 transition-colors"
          onClick={() => setDetailWarga(w)}
        >
          <span className="material-symbols-outlined text-[14px]">visibility</span>
          Detail
        </button>
        <button
          className="h-8 px-3 rounded-lg bg-error-container/30 text-error hover:bg-error-container hover:text-on-error-container text-xs font-semibold inline-flex items-center gap-1 transition-colors"
          onClick={() => setHapusTarget(w)}
        >
          <span className="material-symbols-outlined text-[14px]">delete</span>
          Hapus
        </button>
        {w.statusPortal === "Belum Aktif" && (
          <button
            className="h-8 px-3 rounded-lg bg-tertiary-container/40 text-on-tertiary-container hover:bg-tertiary-container text-xs font-semibold inline-flex items-center gap-1 transition-colors"
            onClick={() => handleKirimUndangan(w)}
          >
            <span className="material-symbols-outlined text-[14px]">qr_code_2</span>
            Undangan
          </button>
        )}
        {/* B5 · aksi undangan/akses sesuai Status Portal (konfirmasi dulu). */}
        {aksiAkses(w).map((a) => (
          <button
            key={a.jenis}
            className={`h-8 px-3 rounded-lg text-xs font-semibold inline-flex items-center gap-1 transition-colors disabled:opacity-60 ${AKSES_KELAS[a.jenis]}`}
            disabled={aksiSedang}
            onClick={() => setKonfirmasiAksi({ jenis: a.jenis, warga: w })}
          >
            <span className="material-symbols-outlined text-[14px]">{a.ikon}</span>
            {a.label}
          </button>
        ))}
      </>
    );
  }

  /* ---------- Edit data warga (sinkron 2 arah bila terpasang dengan kkList) ---------- */
  function openEdit(w: WargaRt) {
    const link = linkFor(w, kkList);
    const kk = link ? kkList.find((k) => k.id === link.kkId) : undefined;
    const member = link && link.idx >= 0 && kk ? kk.anggota[link.idx] : undefined;
    const detail = member ? detailDariMember(member) : detailDariRow(w);
    setEditing(w);
    setFormEdit({
      nama: w.nama,
      // NIK ter-mask (data API) TIDAK dipaksa jadi 16 digit — nilai asli
      // dipertahankan; validasi Edit hanya menuntut 16 digit bila diganti.
      nik: digitsOnly(w.nik).length === 16 ? digitsOnly(w.nik) : w.nik,
      noKk: w.noKk,
      alamat: kk ? kk.alamat : w.alamat,
      noWa: digitsOnly(w.noWa),
      statusPortal: w.statusPortal,
      // Isi 14 kolom data KK: berasal dari anggota keluarga bila ada,
      // kalau tidak ada dari salinan lokal baris. Tanggal dikonversi ke ISO
      // agar cocok untuk <input type="date">.
      ...detail,
      tglLahir: tglKeIso(detail.tglLahir),
      tglKawin: tglKeIso(detail.tglKawin),
    });
    setEditErrors({});
    setLihatNik(false);
    setLihatNoKk(false);
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing || simpanSedang) return;
    const errors: Record<string, string> = {};
    if (!formEdit.nama.trim()) errors.nama = "Nama lengkap wajib diisi";
    // Relaxed: NIK ter-mask yang TIDAK berubah lolos validasi (data API tidak
    // pernah mengirim NIK plaintext §14); hanya penggantian wajib 16 digit penuh.
    if (formEdit.nik !== editing.nik && !/^\d{16}$/.test(formEdit.nik))
      errors.nik = "NIK harus 16 digit angka";
    if (noKkNorm(formEdit.noKk).length !== 16) errors.noKk = "No. KK harus 16 digit (angka)";
    if (!formEdit.alamat.trim()) errors.alamat = "Alamat wajib diisi";
    const waDigits = digitsOnly(formEdit.noWa);
    // WA opsional (kontrak PATCH §5.4: `noHp` opsional) — kosong diperbolehkan
    // sehingga warga tanpa HP tetap bisa diedit; bila diisi wajib 10–13 digit.
    if (waDigits && (waDigits.length < 10 || waDigits.length > 13))
      errors.noWa = "No. WA harus 10-13 digit";
    setEditErrors(errors);
    if (Object.keys(errors).length > 0) return;

    const detail: DetailKk = {
      tempatLahir: formEdit.tempatLahir.trim(),
      tglLahir: isoKeTgl(formEdit.tglLahir),
      jenisKelamin: formEdit.jenisKelamin.trim(),
      agama: formEdit.agama.trim(),
      pendidikan: formEdit.pendidikan.trim(),
      pekerjaan: formEdit.pekerjaan.trim(),
      goldarah: formEdit.goldarah.trim(),
      statusKawin: formEdit.statusKawin.trim(),
      tglKawin: isoKeTgl(formEdit.tglKawin),
      hubungan: formEdit.hubungan.trim(),
      wargaNegara: formEdit.wargaNegara.trim(),
    };

    // Payload PATCH /rt/warga/:id (mode patch — hanya field yang dikirim;
    // `null` = bersihkan, tidak dikirim = tidak diubah, §5.4).
    const patch: PatchWargaRt = {
      nama: formEdit.nama.trim(),
      // `noHp` PATCH opsional & tidak menerima null (kontrak BE): WA kosong →
      // TIDAK dikirim (nilai lama, termasuk null, tetap apa adanya).
      ...(waDigits ? { noHp: waDigits } : {}),
      hubungan: hubunganKeServer(formEdit.hubungan),
      // Kolom detail: "" → null (bersihkan); nilai di luar kamus enum TIDAK
      // dikirim (`enumAman`) — mencegah mengosongkan data lama yang tak terwakili.
      tempatLahir: formEdit.tempatLahir.trim() || null,
      tanggalLahir: formEdit.tglLahir || null,
      jenisKelamin: enumAman(formEdit.jenisKelamin, jenisKelaminKeServer(formEdit.jenisKelamin)),
      agama: formEdit.agama.trim() || null,
      pendidikan: formEdit.pendidikan.trim() || null,
      pekerjaan: formEdit.pekerjaan.trim() || null,
      golDarah: enumAman(formEdit.goldarah, golDarahKeServer(formEdit.goldarah)),
      statusKawin: enumAman(formEdit.statusKawin, statusKawinKeServer(formEdit.statusKawin)),
      tanggalPerkawinan: formEdit.tglKawin || null,
      wargaNegara: enumAman(formEdit.wargaNegara, wargaNegaraKeServer(formEdit.wargaNegara)),
    };
    // NIK/No. KK: hanya nilai 16-digit MENTAH yang berbeda dari nilai lama —
    // nilai ter-mask tidak pernah ikut ke server (server tak menerimanya).
    if (/^\d{16}$/.test(formEdit.nik) && formEdit.nik !== editing.nik) patch.nikBaru = formEdit.nik;
    const noKkBaru = digitsOnly(formEdit.noKk);
    if (noKkBaru.length === 16 && noKkBaru !== digitsOnly(editing.noKk)) patch.noKk = noKkBaru;
    // Alamat hanya bila beda dari KK sumbernya.
    const linkAwal = linkFor(editing, kkList);
    const kkAwal = linkAwal ? kkList.find((k) => k.id === linkAwal.kkId) : undefined;
    if (formEdit.alamat.trim() !== (kkAwal ? kkAwal.alamat : editing.alamat))
      patch.alamat = formEdit.alamat.trim();
    // Status portal TIDAK ikut PATCH umum (server menolak `statusAkses` di rute
    // itu — pintu tunggal `/akses`, Okt 2026). Form hanya menawarkan status saat
    // ini + "Dinonaktifkan"; nilai lain → batalkan dengan pesan jujur.
    const pindahStatus =
      formEdit.statusPortal !== editing.statusPortal ? formEdit.statusPortal : null;
    if (pindahStatus && pindahStatus !== "Dinonaktifkan") {
      flash("Status portal hanya dapat diubah menjadi Dinonaktifkan — perubahan dibatalkan.");
      return;
    }

    // B13 · API-first: baris ber-ID server → respons server jadi rujukan
    // (baris + KK). OFFLINE (`null`) → lanjut jalur lokal mode demo di bawah;
    // galat server (validasi/bentrok/404) → tampilkan pesan & BATAL — jangan
    // menyamar sebagai sukses.
    if (editing.idWarga && onSimpanWarga) {
      setSimpanSedang(true);
      try {
        const hasil = await onSimpanWarga(editing.idWarga, patch);
        if (hasil) {
          const baris = barisServerKeWargaRt(hasil.warga);
          onWargaRtChange(
            wargaRt.some((x) => x.idWarga === baris.idWarga)
              ? wargaRt.map((x) => (x.idWarga === baris.idWarga ? baris : x))
              : [...wargaRt, baris],
          );
          // KK (alamat/kepala/anggota) ikut diperbarui dari respons server.
          onKkUpdated(hasil.keluarga.kk.id, keluargaKeKkData(hasil.keluarga));
          setEditing(null);
          // Perubahan status portal → pintu `/akses` TERPISAH (kejujuran parsial):
          // bila langkah ini gagal, data tetap tersimpan DAN pesannya mengatakan
          // apa adanya — tidak pernah "semua berhasil" untuk kegagalan sebagian.
          if (pindahStatus === "Dinonaktifkan" && onUbahAksesWarga) {
            try {
              const st = await onUbahAksesWarga(editing.idWarga, "dinonaktifkan");
              if (st) {
                tandaiStatusPortal(baris, statusAksesKePortal(st));
                flash("Data warga diperbarui & akses portal dinonaktifkan — sesi login warga ikut dicabut.");
              } else {
                flash("Data warga tersimpan; status portal hanya berubah di daftar lokal (server tidak terjangkau).");
              }
            } catch (errAkses) {
              flash(
                `Data warga tersimpan, tetapi status portal GAGAL diubah: ${
                  errAkses instanceof GalatApi ? errAkses.message : "kesalahan tak terduga"
                } — ulangi lewat tombol Nonaktifkan.`,
              );
            }
          } else {
            flash("Data warga diperbarui — tersinkron di kedua portal.");
          }
          return;
        }
      } catch (err) {
        flash(err instanceof GalatApi ? err.message : "Gagal menyimpan data warga.");
        return;
      } finally {
        setSimpanSedang(false);
      }
    }

    // Sesi DARING tetapi mutasi gagal terkirim → kegagalan NYATA: form edit
    // tetap terbuka, daftar tak disentuh, dan tidak menyamar sebagai "mode
    // demo" (mode demo hanya sah bila pengguna memang masuk tanpa server).
    if (editing.idWarga && onSimpanWarga && !modeDemo) {
      flash(
        "Server tidak terjangkau saat menyimpan — perubahan TIDAK masuk database. Form tetap terbuka; perbaiki koneksi lalu tekan Simpan kembali.",
      );
      return;
    }

    const updatedRow: WargaRt = detailKeRow(
      {
        ...editing,
        nama: formEdit.nama.trim(),
        nik: formEdit.nik,
        noKk: fmtNoKk(formEdit.noKk),
        alamat: formEdit.alamat.trim(),
        noWa: fmtWa(waDigits),
        statusPortal: formEdit.statusPortal,
        statusBadge: badgePortal(formEdit.statusPortal),
      },
      detail
    );

    // Selalu perbarui baris lokal (status portal & baris non-kkList tinggal di sini).
    onWargaRtChange(
      wargaRt.some((x) => x.id === editing.id)
        ? wargaRt.map((x) => (x.id === editing.id ? updatedRow : x))
        : [...wargaRt, updatedRow]
    );

    // Bila warga berasal dari kkList → simpan perubahan ke Data Keluarga (Portal Warga).
    const link = linkFor(editing, kkList);
    const kk = link ? kkList.find((k) => k.id === link.kkId) : undefined;
    if (link && kk) {
      const patchKk: Partial<KkData> = {
        alamat: formEdit.alamat.trim(),
        noKk: fmtNoKk(formEdit.noKk),
      };
      if (link.idx >= 0) {
        const mBaru = terapkanDetailKeMember(
          {
            ...kk.anggota[link.idx],
            name: updatedRow.nama,
            initials: initialsOf(updatedRow.nama),
            nik: maskedNik(updatedRow.nik),
            nikFull: updatedRow.nik,
            wa: memberWaValue(waDigits),
          },
          detail
        );
        patchKk.anggota = kk.anggota.map((m, i) => (i === link.idx ? mBaru : m));
        if (mBaru.filter === "kepala") patchKk.kepala = mBaru.name;
      } else {
        const mBaru = terapkanDetailKeMember(buildMember(updatedRow.nama, updatedRow.nik, waDigits), detail);
        patchKk.anggota = [...kk.anggota, mBaru];
        if (mBaru.filter === "kepala") patchKk.kepala = mBaru.name;
      }
      onKkUpdated(kk.id, patchKk);
    }

    setEditing(null);
    // Jalur lokal (mode demo / baris tanpa id server): perubahan hanya ada di
    // memori — pesan jujur, tidak mengaku "tersinkron di kedua portal".
    flash(
      pindahStatus
        ? `Data warga diperbarui di daftar lokal — status portal menjadi ${pindahStatus} (mode demo, TIDAK tersimpan di server).`
        : "Data warga diperbarui di daftar lokal (mode demo — server tidak terjangkau).",
    );
  }

  /* ---------- Hapus data warga yang sudah tidak dipakai ---------- */
  async function handleHapus() {
    const w = hapusTarget;
    if (!w || simpanSedang) return;

    // Baris: dedup by `id`/`idWarga` — cabang NIK hanya untuk baris TANPA
    // `idWarga` (NIK ter-mask 8 digit bisa tabrak antar baris API → salah hapus).
    const barisSisa = wargaRt.filter((x) => {
      if (w.idWarga || x.idWarga) return x.id !== w.id && x.idWarga !== w.idWarga;
      const nik = digitsOnly(w.nik);
      return x.id !== w.id && !(nik && digitsOnly(x.nik) === nik);
    });

    // B13 · API-first: baris ber-ID server → server menghapus & `keluarga` dari
    // respons (kepala/jumlah diperbaiki server-side) menjadi rujukan KK.
    // OFFLINE (`null`) → lanjut jalur lokal mode demo; galat lain → flash + batal.
    if (w.idWarga && onHapusWarga) {
      setSimpanSedang(true);
      try {
        const hasil = await onHapusWarga(w.idWarga);
        if (hasil) {
          onWargaRtChange(barisSisa);
          if (hasil.keluarga) onKkUpdated(hasil.keluarga.kk.id, keluargaKeKkData(hasil.keluarga));
          setSelectedWarga((prev) => prev.filter((id) => id !== w.id));
          setHapusTarget(null);
          flash(`Data ${w.nama} (${w.alamat}) berhasil dihapus dari Data Warga.`);
          return;
        }
      } catch (err) {
        flash(err instanceof GalatApi ? err.message : "Gagal menghapus data warga.");
        return;
      } finally {
        setSimpanSedang(false);
      }
    }

    // Sesi DARING tetapi mutasi gagal terkirim → kegagalan NYATA: baris TIDAK
    // dihapus dari daftar (data server tetap utuh) dan pesan mengatakan
    // apa adanya — tidak ada "berhasil dihapus" untuk penghapusan yang tak
    // pernah sampai ke server.
    if (w.idWarga && onHapusWarga && !modeDemo) {
      flash(
        "Server tidak terjangkau — data TIDAK dihapus dari database. Daftar tidak berubah; coba lagi setelah koneksi pulih.",
      );
      return;
    }

    // 1) Baris Data Warga (baris murni kkList tidak ada di sini — dihapus di langkah 2).
    onWargaRtChange(barisSisa);

    // 2) Bila terpasang di kkList → hapus juga dari anggota keluarga (Portal Warga),
    //    supaya barisnya tidak muncul lagi saat daftar warga digabung.
    const link = linkFor(w, kkList);
    const kk = link ? kkList.find((k) => k.id === link.kkId) : undefined;
    if (link && kk && link.idx >= 0) {
      const sisa = kk.anggota.filter((_, i) => i !== link.idx);
      const patch: Partial<KkData> = { anggota: sisa };
      if (kk.anggota[link.idx].filter === "kepala") patch.kepala = sisa[0]?.name ?? "";
      onKkUpdated(kk.id, patch);
    }

    setSelectedWarga((prev) => prev.filter((id) => id !== w.id));
    setHapusTarget(null);
    flash(
      w.idWarga && onHapusWarga
        ? `Data ${w.nama} (${w.alamat}) dihapus dari daftar sesi ini (mode demo — TIDAK dihapus di server).`
        : `Data ${w.nama} (${w.alamat}) berhasil dihapus dari Data Warga.`,
    );
  }

  /* ---------- Undangan ---------- */
  function markUndangan(ids: string[]) {
    const next = [...wargaRt];
    for (const id of ids) {
      const row = rows.find((r) => r.id === id);
      if (!row) continue;
      const i = next.findIndex(
        (x) =>
          x.id === row.id ||
          (digitsOnly(row.nik).length > 0 && digitsOnly(x.nik) === digitsOnly(row.nik))
      );
      if (i >= 0) {
        next[i] = { ...next[i], statusPortal: "Undangan Dikirim", statusBadge: badgePortal("Undangan Dikirim") };
      } else {
        next.push({ ...row, statusPortal: "Undangan Dikirim", statusBadge: badgePortal("Undangan Dikirim") });
      }
    }
    onWargaRtChange(next);
  }

  /** Galat API → pesan yang layak ditampilkan. OFFLINE tidak pernah sampai sini
   *  (di-tangani fallback demo di App.tsx). */
  function pesanGalatUndangan(err: unknown): string {
    if (err instanceof GalatApi) return err.message;
    return "Terjadi kesalahan tak terduga saat menerbitkan undangan.";
  }

  async function handleKirimUndangan(w: WargaRt) {
    if (kirimSedang) return;
    setKirimSedang(true);
    try {
      // API-first: server menerbitkan token `<id>.<kode>` (mencabut token lama);
      // offline → daftar lokal mode demo. Galat API non-OFFLINE ditampilkan via flash.
      const u = await onUndanganWarga({ nama: w.nama, alamat: w.alamat, noWa: w.noWa, idWarga: w.idWarga });
      markUndangan([w.id]);
      setAntreanKartu([]);
      setKartuUndangan(u);
      flash(`Kartu undangan ${w.nama} siap — bagikan link atau QR-nya.`);
    } catch (err) {
      flash(pesanGalatUndangan(err));
    } finally {
      setKirimSedang(false);
    }
  }

  /**
   * Bug laporan · terbitkan undangan untuk SEMUA anggota ber-status "Belum Aktif"
   * pada satu keluarga, lalu tampilkan kartu QR-nya berantai (bila >1 penerima).
   *
   * Sebelumnya baris keluarga tidak punya pintu sama sekali — modal massal pun
   * hanya menampilkan `flash` tanpa QR, padahal token tidak bisa diminta ulang
   * (server menyimpan hash-nya). Status "Undangan Dikirim" ikut diperbarui supaya
   * keluhan "status kirim undangan tidak ada" ikut terjawab di tabel.
   */
  async function kirimUndanganKelompok(sasaran: WargaRt[]) {
    if (kirimSedang) return;
    if (sasaran.length === 0) {
      flash("Tidak ada anggota ber-status Belum Aktif pada keluarga ini.");
      return;
    }
    setKirimSedang(true);
    const kartuBaru: Undangan[] = [];
    const idBerhasil: string[] = [];
    const gagal: { nama: string; pesan: string }[] = [];
    // Kunci dedup sama dengan modal massal: satu token per no. HP.
    const sudah = new Set<string>();
    let dilewati = 0;
    for (const w of sasaran) {
      const kunci = digitsOnly(w.noWa) ? `wa:${digitsOnly(w.noWa)}` : `baris:${w.id}`;
      if (sudah.has(kunci)) {
        dilewati += 1;
        continue;
      }
      sudah.add(kunci);
      try {
        kartuBaru.push(
          await onUndanganWarga({ nama: w.nama, alamat: w.alamat, noWa: w.noWa, idWarga: w.idWarga }),
        );
        idBerhasil.push(w.id);
      } catch (err) {
        gagal.push({ nama: w.nama, pesan: pesanGalatUndangan(err) });
      }
    }
    setKirimSedang(false);
    markUndangan(idBerhasil);
    if (kartuBaru.length > 0) {
      setAntreanKartu(kartuBaru);
      setKartuUndangan(kartuBaru[0]);
    }
    const catatan = dilewati > 0 ? ` · ${dilewati} dilewati (no. HP sama)` : "";
    if (gagal.length === 0) {
      flash(
        kartuBaru.length === 1
          ? `Kartu undangan ${kartuBaru[0].nama} siap — bagikan link atau QR-nya.${catatan}`
          : `${kartuBaru.length} undangan dibuat — pindai/tukar kartu QR satu per satu lewat tombol panah di kartu.${catatan}`,
      );
    } else if (kartuBaru.length === 0) {
      flash(`Undangan gagal dibuat — ${gagal[0].pesan}`);
    } else {
      flash(
        `${kartuBaru.length} undangan terkirim — gagal untuk ${gagal.map((x) => x.nama).join(", ")}: ${gagal[0].pesan}${catatan}`,
      );
    }
  }

  /* ---------- B5 · aksi undangan & akses portal (konfirmasi + anti klik-ganda) ---------- */

  /** Token undangan tercatat untuk baris ini — dipasangkan lewat no. HP (satu token aktif per warga). */
  const tokenUntuk = (w: WargaRt): Undangan | undefined =>
    undangan.find((u) => digitsOnly(u.noWa) === digitsOnly(w.noWa) && u.status !== "Dipakai");

  /** Aksi B5 yang sah untuk Status Portal baris ini (B4: empat label; "Dinonaktifkan" tanpa aksi — pengaktifan ulang tak tersedia di Portal RT, Okt 2026). */
  function aksiAkses(w: WargaRt): Array<{ jenis: AksiAkses; label: string; ikon: string }> {
    switch (w.statusPortal) {
      case "Undangan Dikirim":
      case "Kedaluwarsa":
        return [
          { jenis: "kirim-ulang", label: "Kirim Ulang", ikon: "forward_to_inbox" },
          { jenis: "cabut", label: "Cabut", ikon: "block" },
        ];
      case "Aktif":
        return [{ jenis: "nonaktifkan", label: "Nonaktifkan", ikon: "person_off" }];
      default:
        return []; // "Belum Aktif"/"Dinonaktifkan" → tombol Undangan (penerbitan baru) / tanpa aksi
    }
  }

  /** Teks konfirmasi per aksi — selalu menyebutkan sasaran & akibatnya. */
  function infoAksiAkses(jenis: AksiAkses, w: WargaRt) {
    switch (jenis) {
      case "kirim-ulang":
        return {
          judul: "Kirim Ulang Undangan?",
          pesan: `Token lama ${w.nama} akan dicabut dan tautan baru dikirim ke ${fmtWa(w.noWa)}.`,
          ikon: "forward_to_inbox",
          aksen: "primary" as const,
          labelYa: "Kirim Ulang",
        };
      case "cabut":
        return {
          judul: "Cabut Undangan?",
          pesan: `Tautan aktivasi ${w.nama} tidak lagi berlaku — warga memerlukan undangan baru untuk masuk portal.`,
          ikon: "block",
          aksen: "error" as const,
          labelYa: "Ya, Cabut",
        };
      case "nonaktifkan":
        return {
          judul: "Nonaktifkan Akses Portal?",
          pesan: `${w.nama} tidak dapat masuk Portal Warga lagi — sesi login yang sedang berjalan ikut dicabut. Data warga TIDAK dihapus. Pengaktifan ulang tidak tersedia di Portal RT (aturan Okt 2026).`,
          ikon: "person_off",
          aksen: "error" as const,
          labelYa: "Nonaktifkan",
        };
      default:
        // Tak terjangkau (semua anggota `AksiAkses` punya case sendiri) —
        // teks netral sebagai jaring pengaman bila tipe aksi berkembang.
        return {
          judul: "Ubah Akses Portal?",
          pesan: `Ubah status akses portal ${w.nama}.`,
          ikon: "person_off",
          aksen: "error" as const,
          labelYa: "Lanjutkan",
        };
    }
  }

  /** Perbarui label Status Portal satu baris (baris murni KK disalin dulu ke daftar RT). */
  function tandaiStatusPortal(w: WargaRt, label: string) {
    const badge = badgePortal(label);
    const i = wargaRt.findIndex(
      (x) =>
        x.id === w.id ||
        (!!w.idWarga && x.idWarga === w.idWarga) ||
        (digitsOnly(w.nik).length > 0 && digitsOnly(x.nik) === digitsOnly(w.nik)),
    );
    if (i >= 0) {
      const next = [...wargaRt];
      next[i] = { ...next[i], statusPortal: label, statusBadge: badge };
      onWargaRtChange(next);
    } else {
      onWargaRtChange([...wargaRt, { ...w, statusPortal: label, statusBadge: badge }]);
    }
  }

  /**
   * Jalankan aksi B5 yang sudah dikonfirmasi. `aksiSedang` menahan klik ganda
   * selama API berjalan; galat server MEMBIARKAN dialog terbuka (pengguna bisa
   * membatalkan) dan ditampilkan lewat `flash` — tidak pernah menyamar sukses.
   */
  async function jalankanAksi() {
    const target = konfirmasiAksi;
    if (!target || aksiSedang) return;
    const { jenis, warga: w } = target;
    setAksiSedang(true);
    try {
      if (jenis === "kirim-ulang") {
        const token = tokenUntuk(w);
        const hasil =
          token && RE_UUID.test(token.id) && onKirimUlangUndangan
            ? await onKirimUlangUndangan(token.id)
            : null;
        if (!hasil) {
          // Token tak tercatat / OFFLINE → rute penerbitan biasa; server melakukan
          // hal yang sama (cabut token 'menunggu' + terbitkan tautan segar).
          setKonfirmasiAksi(null);
          await handleKirimUndangan(w);
          return;
        }
        setKonfirmasiAksi(null);
        tandaiStatusPortal(w, "Undangan Dikirim");
        setAntreanKartu([]);
        setKartuUndangan(hasil);
        flash(`Undangan ${w.nama} dikirim ulang — tautan lama sudah dicabut.`);
        return;
      }

      if (jenis === "cabut") {
        const token = tokenUntuk(w);
        setKonfirmasiAksi(null);
        if (!token) {
          flash(`Tidak ada undangan aktif untuk ${w.nama}.`);
          return;
        }
        // ID server (UUID) → cabut di server; entri demo → cabut lokal (mode demo).
        if (RE_UUID.test(token.id) && onCabutUndangan) await onCabutUndangan(token.id);
        tandaiStatusPortal(w, "Belum Aktif");
        flash(`Undangan ${w.nama} dicabut — tautan tidak lagi berlaku.`);
        return;
      }

      // nonaktifkan — satu-satunya tujuan yang diizinkan (Okt 2026: pengurus RT
      // hanya dapat mengubah status portal MENJADI nonaktif; `aktif` ditolak
      // server 400 VALIDATION).
      const hasil =
        w.idWarga && onUbahAksesWarga ? await onUbahAksesWarga(w.idWarga, "dinonaktifkan") : null;
      setKonfirmasiAksi(null);
      // `null` (OFFLINE / baris demo) → status diubah lokal seperti mode demo.
      tandaiStatusPortal(w, hasil ? statusAksesKePortal(hasil) : "Dinonaktifkan");
      flash(
        hasil
          ? `Akses portal ${w.nama} dinonaktifkan — sesi login warga ikut dicabut.`
          : `Akses portal ${w.nama} dinonaktifkan di daftar lokal (mode demo — server tidak terjangkau).`,
      );
    } catch (err) {
      flash(err instanceof GalatApi ? err.message : "Permintaan gagal diproses — coba lagi.");
    } finally {
      setAksiSedang(false);
    }
  }

  /* ---------- Upload & template ---------- */
  function handleUnduhTemplate() {
    const header = "Nama,NIK,No. KK,Alamat,No. WA,Email";
    const contoh = [
      "Budi Santoso,3171050101050011,3171050101050010,Blok A1 No. 1,081234567890,budi@email.com",
      "Siti Aminah,3171050202060022,3171050101050011,Blok B2 No. 14,081398765432,siti@email.com",
    ].join("\n");
    downloadText("template-data-warga.csv", `${header}\n${contoh}`);
    flash("Template CSV data warga berhasil diunduh.");
  }

  function tutupUpload() {
    setShowUploadModal(false);
    setUploadFileName("");
    setUploadFile(null);
  }

  async function handleImportFile() {
    if (!uploadFile) {
      flash("Pilih file CSV/XLSX terlebih dahulu.");
      return;
    }
    if (imporSedang) return;
    setImporSedang(true);
    try {
      // A10 · Migrasi Data — API-first: berkas dikirim apa adanya ke
      // `POST /rt/warga/import`; server yang memparse, memvalidasi, dan
      // mencatat `impor_data` + audit (§5.4). OFFLINE → `null` → jalur demo
      // di bawah; galat server (400 kolom salah, 413 kebesaran, sesi habis)
      // tampil apa adanya — tidak pernah "berhasil" untuk kegagalan.
      if (onImporWarga) {
        const hasil = await onImporWarga(uploadFile);
        if (hasil) {
          const alasanPertama = hasil.alasan[0];
          const rincian =
            hasil.gagal > 0 && alasanPertama
              ? ` ${hasil.gagal} ditolak — baris ${alasanPertama.nomor} (${alasanPertama.nama}): ${alasanPertama.pesan}`
              : "";
          flash(
            hasil.berhasil > 0
              ? `Impor "${hasil.namaFile}": ${hasil.berhasil}/${hasil.jumlahBaris} baris masuk.${rincian}`
              : `Tidak ada baris yang masuk dari "${hasil.namaFile}" — perbaiki lalu impor ulang.${rincian}`,
          );
          tutupUpload();
          return;
        }
      }
      // Mode demo (backend dimatikan): impor adalah operasi server — tidak      // ada "impor sukses" palsu (prinsip api.ts: klien tidak pernah
      // menyamar sebagai sukses). Data demo tetap bisa ditambah manual lewat
      // form Tambah Data KK.
      flash(
        `Mode demo: impor "${uploadFile.name}" membutuhkan server menyala — tidak ada data yang diubah. Tambahkan data lewat form Tambah Data KK.`,
      );
      tutupUpload();
    } catch (err) {
      flash(err instanceof GalatApi ? err.message : "Impor data gagal diproses — coba lagi.");
    } finally {
      setImporSedang(false);
    }
  }

  /* ---------- Seleksi & filter ---------- */
  function toggleSelectWarga(id: string) {
    setSelectedWarga((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function toggleSelectAll() {
    if (selectedWarga.length === filtered.length) {
      setSelectedWarga([]);
    } else {
      setSelectedWarga(filtered.map((w) => w.id));
    }
  }

  const filtered = rows.filter((w) => {
    const matchSearch = search === "" || w.nama.toLowerCase().includes(search.toLowerCase()) || w.nik.includes(search) || w.alamat.toLowerCase().includes(search.toLowerCase());
    const matchFilter =
      filterType === "all" ||
      (filterType === "aktif" && w.statusPortal === "Aktif") ||
      (filterType === "belum-aktif" && w.statusPortal === "Belum Aktif") ||
      (filterType === "undangan" && w.statusPortal === "Undangan Dikirim") ||
      (filterType === "kedaluwarsa" && w.statusPortal === "Kedaluwarsa") ||
      (filterType === "dinonaktifkan" && w.statusPortal === "Dinonaktifkan");
    return matchSearch && matchFilter;
  });

  /* ---------- Tabel satu baris per KEPALA keluarga + jumlah anggota ---------- */
  // Baris tersaring dikelompokkan per KK (`kkList`): tabel hanya menampilkan
  // KEPALA keluarga beserta jumlah anggota keluarga (keputusan 8 Okt 2026)
  // tanpa sub-baris — anggota dikelola lewat modal "Anggota Keluarga"
  // (tambah/ubah/hapus). Warga tanpa KK (data contoh / non-KK) tetap jadi
  // baris tersendiri agar tidak ada data yang tersembunyi.
  const grupMap = new Map<string, KkData>();
  const barisTunggal: WargaRt[] = [];
  for (const w of filtered) {
    const kk = kkUntukBaris(w);
    if (!kk) {
      barisTunggal.push(w);
      continue;
    }
    if (!grupMap.has(kk.id)) grupMap.set(kk.id, kk);
  }
  const grupKk = Array.from(grupMap.values());

  /** Seluruh anggota 1 KK dari `rows` (tak terpengaruh pencarian/filter). */
  function anggotaKk(kkId: string): WargaRt[] {
    return rows.filter((w) => {
      const l = linkFor(w, kkList);
      return l !== null && l.kkId === kkId;
    });
  }

  /** Jumlah anggota keluarga ber-status portal "Aktif". */
  function hitungAktif(anggota: WargaRt[]): number {
    return anggota.filter((w) => w.statusPortal === "Aktif").length;
  }

  /**
   * Bug laporan — ringkasan status portal per anggota keluarga yang BELUM Aktif
   * ("2 undangan dikirim · 1 belum aktif"); string kosong bila semua Aktif.
   */
  function ringkasPortal(anggota: WargaRt[]): string {
    const hitung = new Map<string, number>();
    for (const w of anggota) hitung.set(w.statusPortal, (hitung.get(w.statusPortal) ?? 0) + 1);
    return [...hitung.entries()]
      .filter(([s]) => s !== "Aktif")
      .map(([s, n]) => `${n} ${LABEL_STATUS_PORTAL[s] ?? s.toLowerCase()}`)
      .join(" · ");
  }

  /** Pilih/batal pilih SEMUA anggota 1 keluarga sekaligus (checkbox baris). */
  function togglePilihKeluarga(idKeluarga: string[], sedangTerpilih: boolean) {
    setSelectedWarga((prev) =>
      sedangTerpilih
        ? prev.filter((id) => !idKeluarga.includes(id))
        : Array.from(new Set([...prev, ...idKeluarga])),
    );
  }

  /** Seluruh anggota KK yang sedang dibuka pada modal "Anggota Keluarga". */
  const anggotaKeluarga = kkKeluarga ? anggotaKk(kkKeluarga.id) : [];

  /** Enum server ("kepala") → label tampilan; label bebas ("Mertua") dipertahankan. */
  function labelHubungan(w: WargaRt): string {
    const v = (w.hubungan ?? "").trim();
    if (!v) return "-";
    const enumDikenal: Record<string, string> = {
      kepala: "Kepala Keluarga",
      istri: "Istri",
      anak: "Anak",
      lainnya: "Lainnya",
    };
    return enumDikenal[v.toLowerCase()] ?? v;
  }

  /** Chip warna-warni hubungan sub-baris (Kepala/Istri/Anak/Mertua/…). */
  function chipHubungan(w: WargaRt) {
    const label = labelHubungan(w);
    const bawah = label.toLowerCase();
    const kelas = bawah.startsWith("kepala")
      ? "bg-primary-container/70 text-on-primary-container"
      : bawah.startsWith("istri")
        ? "bg-secondary-container text-on-secondary-container"
        : label === "-"
          ? "bg-surface-container text-on-surface-variant"
          : "bg-tertiary-container/60 text-on-tertiary-container";
    return (
      <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-bold whitespace-nowrap ${kelas}`}>
        {label}
      </span>
    );
  }

  // ---- F-5 · B11/B20: verifikasi ajuan perubahan data warga ----
  const antreanAjuan = ajuan.filter((a) => a.status === "menunggu");

  /** ISO server → `"12 Sep 2026"`; null/invalid → `"-"`. */
  function tglPanjang(iso: string | null): string {
    if (!iso) return "-";
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
      ? "-"
      : d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
  }

  const setujuiAjuan = async (a: AjuanPerubahanRt) => {
    if (prosesAjuan) return;
    setProsesAjuan(true);
    try {
      await onVerifikasiAjuan?.(a.id, "setujui");
      flash(`Pengajuan perubahan data ${a.namaWarga} disetujui — status tersinkron ke portal warga.`);
    } catch (e) {
      flash(`Gagal menyetujui pengajuan: ${e instanceof GalatApi ? e.message : "periksa koneksi"}`);
    } finally {
      setProsesAjuan(false);
    }
  };

  const tolakAjuanTerpilih = async () => {
    if (!ajuanDitolak || prosesAjuan) return;
    const alasan = alasanTolak.trim();
    if (alasan.length < 3) {
      flash("Alasan penolakan wajib diisi (min. 3 karakter).");
      return;
    }
    const target = ajuanDitolak;
    setProsesAjuan(true);
    try {
      await onVerifikasiAjuan?.(target.id, "tolak", alasan);
      setAjuanDitolak(null);
      setAlasanTolak("");
      flash(`Pengajuan ${target.namaWarga} ditolak — catatan terbaca di portal warga.`);
    } catch (e) {
      flash(`Gagal menolak pengajuan: ${e instanceof GalatApi ? e.message : "periksa koneksi"}`);
    } finally {
      setProsesAjuan(false);
    }
  };

  // -------------------------------------------------------------------------
  // KPI kependudukan (batch 14, 8 Okt 2026 — masukan pengurus): lansia, balita,
  // KK masuk & keluar. Semua dihitung jujur dari baris yang ada:
  //  · Lansia  = usia ≥ 60 tahun (patokan UU; hanya warga ber-tanggal lahir).
  //  · Balita  = usia < 5 tahun  (bawah lima tahun; sama — tanpa tgl lahir
  //              tidak dihitung, dicatat pada tooltip berapa yang tersisa).
  //  · KK Masuk  = KK yang didaftarkan bulan berjalan (`kartu_keluarga.created_at`).
  //  · KK Keluar = KK yang SELURUH anggotanya ber-status `pindah`/`meninggal`
  //              (kumulatif; baris demo tanpa status → dianggap `aktif`).
  // -------------------------------------------------------------------------
  /** Usia warga (tahun) bila tanggal lahir terisi & masuk akal; selain itu `null`. */
  function usiaWarga(r: WargaRt): number | null {
    if (!r.tglLahir) return null;
    const u = usiaDariTgl(r.tglLahir);
    return u >= 0 ? u : null;
  }

  const tanpaTglLahir = rows.filter((r) => !r.tglLahir).length;
  const lansia = rows.filter((r) => (usiaWarga(r) ?? -1) >= 60).length;
  const balita = rows.filter((r) => {
    const u = usiaWarga(r);
    return u !== null && u < 5;
  }).length;

  /** KK unik (No. KK ternormalisasi) yang didaftarkan bulan berjalan. */
  const kkMasuk = new Set(
    rows
      .filter((r) => {
        if (!r.kkCreatedAt) return false;
        const d = new Date(r.kkCreatedAt);
        const now = new Date();
        return !Number.isNaN(d.getTime()) && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      })
      .map((r) => noKkNorm(r.noKk)),
  ).size;

  /** KK unik yang seluruh anggotanya sudah `pindah`/`meninggal`. */
  const kkKeluar = (() => {
    const perKk = new Map<string, { total: number; keluar: number }>();
    for (const r of rows) {
      const kunci = noKkNorm(r.noKk);
      const s = perKk.get(kunci) ?? { total: 0, keluar: 0 };
      s.total += 1;
      if (r.statusDemografis === "pindah" || r.statusDemografis === "meninggal") s.keluar += 1;
      perKk.set(kunci, s);
    }
    return Array.from(perKk.values()).filter((s) => s.total > 0 && s.keluar === s.total).length;
  })();

  const ketUsia = tanpaTglLahir > 0 ? ` (${tanpaTglLahir} warga tanpa tanggal lahir tidak dihitung)` : "";
  const kpiData: { label: string; value: string; icon: string; color: string; title: string }[] = [
    { label: "Total Warga", value: String(rows.length), icon: "groups", color: "bg-primary-container text-on-primary-container", title: "Seluruh warga terdaftar pada RT ini" },
    { label: "KK Terdaftar", value: String(new Set(rows.map((r) => noKkNorm(r.noKk))).size), icon: "badge", color: "bg-secondary-container text-on-secondary-container", title: "Jumlah No. KK unik milik warga terdaftar" },
    { label: "Warga Aktif Portal", value: String(rows.filter((r) => r.statusPortal === "Aktif").length), icon: "smartphone", color: "bg-tertiary-container text-on-tertiary-container", title: "Warga ber-status portal Aktif" },
    { label: "Undangan Terkirim", value: String(rows.filter((r) => r.statusPortal === "Undangan Dikirim").length), icon: "mail", color: "bg-error-container/40 text-on-error-container", title: "Warga ber-status Undangan Dikirim" },
    { label: "Lansia", value: String(lansia), icon: "elderly", color: "bg-secondary-container text-on-secondary-container", title: `Warga berusia 60 tahun ke atas${ketUsia}` },
    { label: "Balita", value: String(balita), icon: "child_care", color: "bg-primary-container text-on-primary-container", title: `Warga berusia di bawah 5 tahun${ketUsia}` },
    { label: "KK Masuk", value: String(kkMasuk), icon: "login", color: "bg-tertiary-container text-on-tertiary-container", title: "KK baru yang didaftarkan bulan ini (tanggal pendaftaran KK)" },
    { label: "KK Keluar", value: String(kkKeluar), icon: "logout", color: "bg-error-container/40 text-on-error-container", title: "KK yang SELURUH anggotanya sudah ber-status pindah/meninggal" },
  ];

  return (
    <div className="max-w-7xl mx-auto w-full space-y-6">
      {/* Toast */}
      {toast}

      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-sm text-on-surface-variant">
        <button type="button" className="hover:text-primary transition-colors flex items-center gap-1" onClick={() => onNavigate?.("dashboard-rt")}><span className="material-symbols-outlined text-[16px]">home</span>
          Portal RT
        </button>
        <span className="material-symbols-outlined text-[14px]">chevron_right</span>
        <span className="font-bold text-on-surface">Data Warga</span>
      </div>

      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div className="max-w-3xl space-y-1.5">
          <div className="inline-flex items-center gap-1.5 text-primary text-sm font-bold uppercase tracking-wider">
            <span className="material-symbols-outlined text-[16px]">group</span>
            Administrasi Kependudukan Warga
          </div>
          <h1 className="text-2xl lg:text-[32px] text-on-surface tracking-tight font-extrabold">
            Data Warga {tenant.label}
          </h1>
          <p className="text-sm text-on-surface-variant leading-relaxed">
            Kelola data seluruh warga {tenant.rtFull} {tenant.rwFull}, termasuk verifikasi identitas, status aktivasi portal, dan pengiriman undangan digital.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 shrink-0">
          {/* B6 · kotak masuk keamanan — hanya bila server punya temuan (OFFLINE → tak pernah tampil). */}
          {temuan && temuan.length > 0 && (
            <button
              className="h-11 px-4 rounded-xl bg-error-container text-on-error-container text-sm font-bold shadow-sm hover:opacity-90 transition-all flex items-center gap-2"
              onClick={() => setLihatTemuan(true)}
            >
              <span className="material-symbols-outlined text-[20px]">gpp_maybe</span>
              {temuan.length} Perlu Perhatian
            </button>
          )}
          <button
            className="h-11 px-5 rounded-xl bg-surface-container-lowest text-on-surface text-sm shadow-sm hover:shadow-md hover:bg-surface-container-low transition-all flex items-center gap-2"
            onClick={() => setShowUploadModal(true)}
          >
            <span className="material-symbols-outlined text-primary text-[20px]">upload_file</span>
            Upload Bulk
          </button>
          <button
            className="h-11 px-5 rounded-xl bg-surface-container-lowest text-on-surface text-sm shadow-sm hover:shadow-md hover:bg-surface-container-low transition-all flex items-center gap-2"
            onClick={() => setShowInviteModal(true)}
          >
            <span className="material-symbols-outlined text-tertiary text-[20px]">mail</span>
            Kirim Undangan
          </button>
          <button
            className="h-11 px-5 rounded-xl bg-primary text-on-primary text-sm shadow-md hover:bg-primary-container active:scale-[0.98] transition-all flex items-center gap-2"
            onClick={bukaInput}
          >
            <span className="material-symbols-outlined text-[20px]">group_add</span>
            Tambah Data KK
          </button>
        </div>
      </div>

      {/* Keterangan sinkronisasi dua arah */}
      <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-primary-container/25 border border-primary/15">
        <span className="material-symbols-outlined text-primary text-[18px] mt-0.5 shrink-0">sync</span>
        <p className="text-xs text-on-surface-variant leading-relaxed">
          <strong className="text-on-surface">Data dapat diperbarui oleh pengurus RT maupun warga melalui Portal Warga (Data Keluarga).</strong>{" "}
          Perubahan pada warga yang terdaftar di Kartu Keluarga akan tersinkron otomatis di kedua portal.
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpiData.map((kpi) => (
          <div key={kpi.label} className="bg-surface-container-lowest rounded-xl p-5 shadow-sm flex flex-col justify-between" title={kpi.title}>
            <div className="flex items-start justify-between">
              <span className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">{kpi.label}</span>
              <div className={`w-10 h-10 rounded-full ${kpi.color} flex items-center justify-center`}>
                <span className="material-symbols-outlined text-[22px]">{kpi.icon}</span>
              </div>
            </div>
            <div className="mt-4">
              <div className="text-2xl font-extrabold text-on-surface">{kpi.value}</div>
            </div>
          </div>
        ))}
      </div>

      {/* F-5 · B11/B20 — Antrean verifikasi ajuan perubahan data warga */}
      <div className="bg-surface-container-lowest rounded-xl shadow-sm p-5 flex flex-col gap-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-primary-container text-on-primary-container flex items-center justify-center">
              <span className="material-symbols-outlined text-[22px]">rule</span>
            </div>
            <div>
              <h2 className="text-sm font-bold text-on-surface">Pengajuan Perubahan Data Warga</h2>
              <p className="text-xs text-on-surface-variant">Verifikasi ajuan resmi KK dari Portal Warga (B11/B20)</p>
            </div>
          </div>
          <span className="px-2.5 py-1 rounded-full bg-primary-container/60 text-on-primary-container text-[11px] font-bold">
            {antreanAjuan.length} Menunggu
          </span>
        </div>
        {ajuan.length === 0 && (
          <p className="text-xs text-on-surface-variant bg-surface-container-low rounded-xl p-4 text-center">
            Belum ada pengajuan perubahan data dari warga.
          </p>
        )}
        <div className="flex flex-col gap-3">
          {ajuan.slice(0, 8).map((a) => {
            const chip = KIRI_AJUAN[a.status];
            return (
              <div key={a.id} className="p-4 rounded-xl bg-surface-container-low flex flex-col md:flex-row md:items-start gap-3">
                <div className="w-9 h-9 rounded-full bg-secondary-container text-on-secondary-container flex items-center justify-center shrink-0">
                  <span className="material-symbols-outlined text-[18px]">person</span>
                </div>
                <div className="flex-1 flex flex-col gap-1.5 min-w-0">
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div className="flex flex-col">
                      <span className="text-sm font-bold text-on-surface">
                        {a.namaWarga} <span className="font-normal text-on-surface-variant">• {a.hubungan}</span>
                      </span>
                      <span className="text-[11px] text-on-surface-variant">
                        {a.alamat}{a.pengajuNama ? ` • diajukan oleh ${a.pengajuNama}` : ""}
                      </span>
                    </div>
                    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full ${chip.kelas} text-[11px] font-bold shrink-0`}>
                      <span className="material-symbols-outlined text-[14px]">{chip.icon}</span>
                      {LABEL_STATUS_AJUAN[a.status]}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-on-surface">
                    <span className="px-2 py-0.5 rounded-md bg-surface-container-highest text-[11px] font-bold">{LABEL_JENIS_AJUAN[a.jenis]}</span>
                    {a.namaAnggota && <span className="text-on-surface-variant">Untuk: {a.namaAnggota}</span>}
                    <span className="text-on-surface-variant">Diajukan: {tglPanjang(a.diajukanPada)}</span>
                  </div>
                  {a.keterangan && (
                    <p className="text-xs text-on-surface-variant leading-relaxed">{a.keterangan}</p>
                  )}
                  {a.catatanVerifikasi && a.status !== "menunggu" && (
                    <p className="text-[11px] text-on-surface-variant italic">Catatan: {a.catatanVerifikasi}</p>
                  )}
                </div>
                {a.status === "menunggu" && (
                  <div className="flex md:flex-col gap-2 shrink-0">
                    <button
                      className="h-9 px-4 rounded-lg bg-primary text-on-primary text-xs font-bold hover:bg-primary-container disabled:opacity-60 transition-colors"
                      disabled={prosesAjuan}
                      onClick={() => void setujuiAjuan(a)}
                    >
                      Setujui
                    </button>
                    <button
                      className="h-9 px-4 rounded-lg bg-error-container/60 text-on-error-container text-xs font-bold hover:bg-error-container disabled:opacity-60 transition-colors"
                      disabled={prosesAjuan}
                      onClick={() => {
                        setAjuanDitolak(a);
                        setAlasanTolak("");
                      }}
                    >
                      Tolak
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* F-5 · B20 — Modal alasan penolakan (catatan wajib — kontrak server) */}
      {ajuanDitolak && (
        <div className="fixed inset-0 z-50 bg-on-background/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-surface-container-lowest shadow-2xl p-6 flex flex-col gap-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-error-container/40 text-error flex items-center justify-center">
                  <span className="material-symbols-outlined text-[22px]">cancel</span>
                </div>
                <div>
                  <h3 className="text-base font-bold text-on-surface">Tolak Pengajuan</h3>
                  <p className="text-xs text-on-surface-variant">{ajuanDitolak.namaWarga} • {LABEL_JENIS_AJUAN[ajuanDitolak.jenis]}</p>
                </div>
              </div>
              <button
                className="w-8 h-8 rounded-lg bg-surface-container flex items-center justify-center text-on-surface-variant hover:text-on-surface"
                onClick={() => setAjuanDitolak(null)}
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>
            <textarea
              className="w-full p-3 rounded-xl bg-surface-container-low text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-error resize-none"
              placeholder="Tuliskan alasan penolakan — warga akan melihat catatan ini di panel Status Pengajuan."
              rows={3}
              value={alasanTolak}
              onChange={(e) => setAlasanTolak(e.target.value)}
            />
            <div className="flex items-center justify-end gap-3">
              <button
                className="h-10 px-4 rounded-xl bg-surface-container-high text-on-surface text-sm hover:bg-surface-container"
                onClick={() => setAjuanDitolak(null)}
              >
                Batal
              </button>
              <button
                className="h-10 px-5 rounded-xl bg-error text-on-error text-sm font-bold hover:opacity-90 disabled:opacity-60 transition-opacity"
                disabled={prosesAjuan}
                onClick={() => void tolakAjuanTerpilih()}
              >
                {prosesAjuan ? "Memproses…" : "Tolak Pengajuan"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Search & Filter Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 p-4 rounded-xl bg-surface-container-lowest shadow-sm">
        <div className="relative flex-1">
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 material-symbols-outlined text-on-surface-variant text-[20px]">search</span>
          <input
            className="w-full h-11 pl-11 pr-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all"
            placeholder="Cari berdasarkan nama, NIK, atau alamat..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {([
            { key: "all", label: "Semua" },
            { key: "aktif", label: "Aktif" },
            { key: "belum-aktif", label: "Belum Aktif" },
            { key: "undangan", label: "Undangan Dikirim" },
            { key: "kedaluwarsa", label: "Kedaluwarsa" },
            { key: "dinonaktifkan", label: "Dinonaktifkan" },
          ] as const).map((f) => (
            <button
              key={f.key}
              className={`px-3 py-1.5 rounded-lg text-xs transition-all ${
                filterType === f.key
                  ? "bg-primary text-on-primary font-semibold shadow-sm"
                  : "bg-surface-container-high text-on-surface-variant hover:bg-surface-container"
              }`}
              onClick={() => setFilterType(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-surface-container-lowest rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-on-surface">
            <thead className="bg-surface-container-low text-xs text-on-surface-variant uppercase tracking-wider">
              <tr>
                <th className="py-3 px-6 w-10" title="Pilih semua warga yang tampil">
                  <input
                    type="checkbox"
                    className="rounded border-outline-variant text-primary focus:ring-primary"
                    checked={filtered.length > 0 && selectedWarga.length === filtered.length}
                    onChange={toggleSelectAll}
                  />
                </th>
                <th className="py-3 px-4" title="Satu baris per kepala keluarga — nama kepala & No. KK miliknya">Kepala Keluarga</th>
                <th className="py-3 px-4" title="Jumlah anggota keluarga pada KK yang sama">Anggota</th>
                <th className="py-3 px-4">Alamat</th>
                <th className="py-3 px-4" title="X dari Y anggota keluarga ber-status portal Aktif">Status Portal</th>
                <th className="py-3 px-4">No. WA</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-6 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-container-high">
              {/* ===== Satu baris per KEPALA keluarga + jumlah anggota (tanpa sub-baris) ===== */}
              {grupKk.map((kk) => {
                const anggotaSemua = anggotaKk(kk.id);
                // Kepala dicari dari seluruh rows supaya WA/status/Edit selalu
                // menunjuk kepala KK (fallback: anggota pertama bila tak ada).
                const kepalaBaris =
                  anggotaSemua.find((w) => labelHubungan(w).toLowerCase().startsWith("kepala")) ?? anggotaSemua[0];
                const portalAktif = hitungAktif(anggotaSemua);
                const semuaAktif = anggotaSemua.length > 0 && portalAktif === anggotaSemua.length;
                // Bug laporan — status kiriman undangan terlihat langsung di
                // tabel + pintu QR per keluarga (anggota yang belum berportal).
                const belumAktif = anggotaSemua.filter((w) => w.statusPortal === "Belum Aktif");
                const ringkasStatus = ringkasPortal(anggotaSemua);
                const idKeluarga = anggotaSemua.map((w) => w.id);
                const semuaTerpilih = idKeluarga.length > 0 && idKeluarga.every((id) => selectedWarga.includes(id));
                return (
                  <tr key={kk.id} className="bg-surface-container-low/60 hover:bg-surface-container-low transition-colors">
                    <td className="py-3 px-6">
                      <input
                        type="checkbox"
                        className="rounded border-outline-variant text-primary focus:ring-primary"
                        checked={semuaTerpilih}
                        title={`Pilih semua ${idKeluarga.length} anggota keluarga ${kk.kepala || ""}`}
                        onChange={() => togglePilihKeluarga(idKeluarga, semuaTerpilih)}
                      />
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-primary-container flex items-center justify-center text-on-primary-container font-bold text-xs shrink-0">
                          {initialsOf(kk.kepala || "-")}
                        </div>
                        <div className="min-w-0">
                          <span className="text-sm font-bold text-on-surface block truncate">{kk.kepala || "-"}</span>
                          <span className="text-[11px] font-mono text-on-surface-variant">No. KK {maskedNoKk(kk.noKk)}</span>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary-container/60 text-on-primary-container text-xs font-bold whitespace-nowrap"
                        title={`${anggotaSemua.length} anggota terdaftar pada KK ini — klik "Edit" untuk membuka daftar & mengelola anggota`}
                      >
                        <span className="material-symbols-outlined text-[14px]">group</span>
                        {anggotaSemua.length} anggota
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span className="text-sm text-on-surface-variant">{shortAlamat(kk.alamat)}</span>
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold whitespace-nowrap ${
                          semuaAktif
                            ? "bg-tertiary-container text-on-tertiary-container"
                            : "bg-surface-container text-on-surface-variant"
                        }`}
                        title={`${portalAktif} dari ${anggotaSemua.length} anggota ber-status portal Aktif`}
                      >
                        {portalAktif}/{anggotaSemua.length} aktif
                      </span>
                      {/* Bug laporan — status kirim undangan per anggota keluarga:
                          "X/Y aktif" saja tidak pernah menunjukkan baris yang masih
                          menunggu undangan / sudah dikirim / kedaluwarsa. */}
                      {ringkasStatus && (
                        <span
                          className="mt-1 block text-[11px] leading-tight text-on-surface-variant"
                          title={anggotaSemua
                            .map((w) => `${w.nama}: ${w.statusPortal}`)
                            .join("\n")}
                        >
                          {ringkasStatus}
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <span className="text-xs font-mono text-on-surface">{fmtWa(kepalaBaris?.noWa ?? "")}</span>
                    </td>
                    <td className="py-3 px-4">
                      <span className="text-xs text-on-surface-variant">{kepalaBaris?.status ?? "-"}</span>
                    </td>
                    <td className="py-3 px-6 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {/* Batch 14 — "Edit" baris keluarga membuka daftar anggota:
                            dari sana Kepala, Istri, Anak, Mertua, … semuanya bisa
                            diubah (bukan hanya kepala seperti sebelumnya). */}
                        <button
                          className="h-8 px-3 rounded-lg bg-primary-container text-on-primary-container hover:bg-primary hover:text-on-primary text-xs font-bold inline-flex items-center gap-1 transition-colors"
                          title={`Edit data keluarga ${kk.kepala || ""} — pilih anggota (Kepala, Istri, Anak, Mertua, …) untuk diubah`}
                          onClick={() => setKkKeluarga(kk)}
                        >
                          <span className="material-symbols-outlined text-[14px]">edit</span>
                          Edit
                        </button>
                        <button
                          className="h-8 px-3 rounded-lg bg-surface-container-low text-on-surface-variant hover:text-primary hover:bg-surface-container text-xs font-semibold inline-flex items-center gap-1 transition-colors"
                          title={`Tambah anggota ke KK ${maskedNoKk(kk.noKk)} (Kepala: ${kk.kepala})`}
                          onClick={() => bukaTambahAnggota(kk)}
                        >
                          <span className="material-symbols-outlined text-[14px]">person_add</span>
                          Tambah Anggota
                        </button>
                        {/* Bug laporan — pintu QR dari tabel: baris keluarga tidak
                            pernah punya tombol Undangan, padahal modal massal hanya
                            menampilkan `flash`. Terbitkan untuk anggota "Belum Aktif"
                            lalu kartu QR tampil berurutan. */}
                        {belumAktif.length > 0 && (
                          <button
                            className="h-8 px-3 rounded-lg bg-tertiary-container/40 text-on-tertiary-container hover:bg-tertiary-container text-xs font-bold inline-flex items-center gap-1 transition-colors disabled:opacity-60"
                            title={`Terbitkan undangan portal untuk ${belumAktif.length} anggota keluarga ${kk.kepala || ""} yang ber-status Belum Aktif, lalu tampilkan QR/link-nya`}
                            disabled={kirimSedang}
                            onClick={() => void kirimUndanganKelompok(belumAktif)}
                          >
                            <span className="material-symbols-outlined text-[14px]">qr_code_2</span>
                            Undangan ({belumAktif.length})
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {/* ===== Baris tunggal: warga tanpa KK terpasang (data contoh / non-KK) ===== */}
              {barisTunggal.map((warga) => (
                <tr key={warga.id} className="hover:bg-surface-container-low/50 transition-colors">
                  <td className="py-4 px-6">
                    <input
                      type="checkbox"
                      className="rounded border-outline-variant text-primary focus:ring-primary"
                      checked={selectedWarga.includes(warga.id)}
                      onChange={() => toggleSelectWarga(warga.id)}
                    />
                  </td>
                  <td className="py-4 px-4">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-primary-container flex items-center justify-center text-on-primary-container font-bold text-xs shrink-0">
                        {initialsOf(warga.nama)}
                      </div>
                      <div>
                        <span className="text-sm font-bold text-on-surface block">{warga.nama}</span>
                        <span className="flex items-center gap-1.5 text-[11px]">
                          {warga.noKk && <span className="font-mono text-on-surface-variant">{maskedNoKk(warga.noKk)} ·</span>}
                          <span className={`font-semibold ${warga.statusColor}`}>{warga.status}</span>
                        </span>
                      </div>
                    </div>
                  </td>
                  <td className="py-4 px-4">
                    <span className="text-sm text-on-surface">{warga.alamat}</span>
                  </td>
                  {/* Tanpa grup KK — kolom "Anggota" kosong (tanda "—"). */}
                  <td className="py-4 px-4">
                    <span className="text-xs text-on-surface-variant">—</span>
                  </td>
                  <td className="py-4 px-4">
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${warga.statusBadge}`}>
                      <span className="w-2 h-2 rounded-full bg-current opacity-60" />
                      {warga.statusPortal}
                    </span>
                  </td>
                  <td className="py-4 px-4">
                    <span className="text-xs font-mono text-on-surface">{fmtWa(warga.noWa)}</span>
                  </td>
                  <td className="py-4 px-4">
                    <span className="text-xs text-on-surface-variant">{warga.status}</span>
                  </td>
                  <td className="py-4 px-6 text-right">
                    <div className="flex items-center justify-end gap-2">{aksiBaris(warga)}</div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-4">
                    <EmptyState
                      icon="person_search"
                      judul="Data warga tidak ditemukan"
                      pesan="Ubah kata kunci pencarian untuk melihat data warga lain."
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="px-6 py-3 border-t border-surface-container-high flex items-center justify-between text-xs text-on-surface-variant">
          <span>
            Menampilkan {grupKk.length} keluarga
            {barisTunggal.length > 0 ? ` + ${barisTunggal.length} warga tanpa KK` : ""} ({filtered.length} warga cocok) dari {rows.length} warga terdaftar
          </span>
          <span className="font-semibold">Halaman 1 dari 1</span>
        </div>
      </div>

      {/* Modal: Anggota Keluarga — tambah / ubah / hapus anggota 1 KK */}
      {kkKeluarga && (
        <div
          className="fixed inset-0 z-50 bg-on-background/40 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setKkKeluarga(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Anggota keluarga"
        >
          <div
            className="w-full max-w-3xl rounded-2xl bg-surface-container-lowest shadow-2xl max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 p-5 border-b border-surface-container-high">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-primary-container flex items-center justify-center text-on-primary-container shrink-0">
                  <span className="material-symbols-outlined text-[22px]">groups</span>
                </div>
                <div className="min-w-0">
                  <h3 className="text-base font-bold text-on-surface truncate">Anggota Keluarga {kkKeluarga.kepala || "-"}</h3>
                  <p className="text-xs text-on-surface-variant">
                    <span className="font-mono">{maskedNoKk(kkKeluarga.noKk)}</span> · {shortAlamat(kkKeluarga.alamat)} ·{" "}
                    {anggotaKeluarga.length} anggota
                  </p>
                </div>
              </div>
              <button
                className="w-9 h-9 rounded-lg flex items-center justify-center text-on-surface-variant hover:bg-surface-container hover:text-on-surface transition-colors shrink-0"
                aria-label="Tutup"
                title="Tutup"
                onClick={() => setKkKeluarga(null)}
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <div className="p-5 overflow-y-auto flex flex-col gap-2">
              <p className="text-xs text-on-surface-variant mb-1">
                Pilih anggota (Kepala, Istri, Anak, Mertua, …) lalu <span className="font-bold text-on-surface">Edit</span> — atau
                tambah / hapus anggota di sini.
              </p>
              {anggotaKeluarga.map((w) => (
                <div
                  key={w.id}
                  className="flex items-center gap-3 p-3 rounded-xl bg-surface-container-low/60 border border-surface-container-high"
                >
                  <div className="w-9 h-9 rounded-full bg-primary-container flex items-center justify-center text-on-primary-container font-bold text-xs shrink-0">
                    {initialsOf(w.nama)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold text-on-surface">{w.nama}</span>
                      {chipHubungan(w)}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap text-[11px] text-on-surface-variant mt-0.5">
                      <span className="font-mono">{maskedNik(w.nik)}</span>
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold ${w.statusBadge}`}>
                        {w.statusPortal}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap justify-end shrink-0">{aksiBaris(w)}</div>
                </div>
              ))}
              {anggotaKeluarga.length === 0 && (
                <EmptyState
                  icon="person_search"
                  judul="Belum ada anggota pada KK ini"
                  pesan="Tambahkan anggota keluarga lewat tombol di bawah."
                />
              )}
            </div>

            <div className="p-5 border-t border-surface-container-high flex items-center justify-between gap-3">
              <button
                className="h-10 px-4 rounded-xl bg-surface-container-low text-on-surface-variant hover:bg-surface-container text-sm font-semibold transition-colors"
                onClick={() => setKkKeluarga(null)}
              >
                Tutup
              </button>
              <button
                className="h-10 px-4 rounded-xl bg-primary text-on-primary text-sm font-bold inline-flex items-center gap-1.5 shadow-sm hover:opacity-90 active:scale-[0.98] transition-all"
                title="Tambah anggota ke KK ini"
                onClick={() => {
                  if (kkKeluarga) bukaTambahAnggota(kkKeluarga);
                }}
              >
                <span className="material-symbols-outlined text-[18px]">person_add</span>
                Tambah Anggota
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Input Manual */}
      {showInputModal && (
        <div className="fixed inset-0 z-50 bg-on-background/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg mx-4 sm:mx-auto rounded-2xl bg-surface-container-lowest shadow-2xl p-6 flex flex-col gap-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary-container flex items-center justify-center text-on-primary-container">
                  <span className="material-symbols-outlined text-[22px]">group_add</span>
                </div>
                <div>
                  <h3 className="text-base font-bold text-on-surface">
                    {kkTujuan ? "Tambah Anggota Keluarga" : "Tambah Data KK"}
                  </h3>
                  <p className="text-xs text-on-surface-variant">
                    {kkTujuan
                      ? `Dirujuk ke KK ${maskedNoKk(kkTujuan.noKk)} — Kepala: ${kkTujuan.kepala}`
                      : "1 Kartu Keluarga — beberapa NIK (Kepala, Istri, Anak, …)"}
                  </p>
                </div>
              </div>
              <button className="w-8 h-8 rounded-lg bg-surface-container flex items-center justify-center text-on-surface-variant hover:text-on-surface" onClick={tutupInput}>
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <form onSubmit={handleSubmitKk} className="flex flex-col gap-5">
              {/* ===== Data Kartu Keluarga ===== */}
              <div className="flex flex-col gap-3">
                <p className="text-[11px] font-bold uppercase tracking-wider text-primary">Data Kartu Keluarga</p>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-on-surface flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[16px] text-on-surface-variant">credit_card</span>
                    No. KK (16 Digit)
                  </label>
                  <input
                    className={`w-full h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface font-mono focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all ${formErrors.noKk ? "ring-2 ring-error" : ""} ${kkTujuan ? "bg-surface-container-high/60 text-on-surface-variant cursor-not-allowed focus:ring-0" : ""}`}
                    type="text"
                    inputMode="numeric"
                    maxLength={16}
                    placeholder="317105..."
                    value={formKk.noKk}
                    readOnly={kkTujuan !== null}
                    onChange={(e) => ubahFormKk("noKk", e.target.value.replace(/\D/g, "").slice(0, 16))}
                  />
                  {formErrors.noKk && <span className="text-xs text-error font-semibold">{formErrors.noKk}</span>}
                  {kkTujuan && (
                    <span className="text-[11px] text-on-surface-variant flex items-center gap-1">
                      <span className="material-symbols-outlined text-[14px] text-tertiary">lock</span>
                      No. KK &amp; alamat dikunci — anggota baru otomatis tercatat pada KK ini.
                    </span>
                  )}
                </div>
              </div>

              {/* Alamat: pilih yang sudah ada (1 alamat > 1 KK) atau alamat baru.
                  Mode Tambah Anggota: alamat ikut terkunci bersama No. KK. */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[16px] text-on-surface-variant">home</span>
                  Alamat
                </label>
                {kkTujuan && (
                  <input
                    className="w-full h-11 px-4 rounded-xl bg-surface-container-high/60 text-sm text-on-surface-variant cursor-not-allowed"
                    type="text"
                    value={formKk.alamat}
                    readOnly
                    aria-readonly
                  />
                )}
                {!kkTujuan && (
                  <>
                    <select
                      className="w-full h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all"
                      value=""
                      onChange={(e) => {
                        if (e.target.value) ubahFormKk("alamat", e.target.value);
                      }}
                    >
                      <option value="">— Pilih alamat terdaftar (opsional) —</option>
                      {alamatOptions.map((a) => (
                        <option key={a} value={a}>{a}</option>
                      ))}
                    </select>
                    <input
                      className={`w-full h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all ${formErrors.alamat ? "ring-2 ring-error" : ""}`}
                      type="text"
                      placeholder="Blok XX No. YY (alamat baru) atau hasil pilihan di atas"
                      value={formKk.alamat}
                      onChange={(e) => ubahFormKk("alamat", e.target.value)}
                    />
                    {formErrors.alamat && <span className="text-xs text-error font-semibold">{formErrors.alamat}</span>}
                    <span className="text-[11px] text-on-surface-variant flex items-center gap-1">
                      <span className="material-symbols-outlined text-[14px] text-tertiary">groups</span>
                      Satu alamat dapat menampung lebih dari satu KK (Multi-KK).
                    </span>
                  </>
                )}
              </div>

              {/* ===== Anggota Keluarga (1 KK — beberapa NIK) ===== */}
              <div className="flex flex-col gap-3 border-t border-surface-container-high pt-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-primary">
                    {kkTujuan ? "Anggota Baru" : "Anggota Keluarga"} — {anggotaBaru.length} NIK
                  </p>
                  <span className="text-[11px] text-on-surface-variant">Kepala &bull; Istri &bull; Anak &bull; lainnya</span>
                </div>

                {anggotaBaru.map((a, i) => (
                  <div key={i} className="rounded-2xl border border-outline-variant/40 bg-surface-container-low/60 p-4 flex flex-col gap-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="w-6 h-6 shrink-0 rounded-full bg-primary-container text-on-primary text-[11px] font-bold flex items-center justify-center">{i + 1}</span>
                        <span className="text-xs font-bold text-on-surface">Anggota {i + 1}</span>
                        {a.hubungan && <span className="text-[11px] text-on-surface-variant truncate">— {a.hubungan}</span>}
                      </div>
                      {anggotaBaru.length > 1 && (
                        <button
                          type="button"
                          onClick={() => hapusAnggotaBaris(i)}
                          className="h-7 px-2 rounded-lg text-error text-[11px] font-bold flex items-center gap-1 hover:bg-error-container/40 transition-colors shrink-0"
                        >
                          <span className="material-symbols-outlined text-[14px]">person_remove</span>
                          Hapus
                        </button>
                      )}
                    </div>

                    {/* NIK & Nama */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-bold text-on-surface flex items-center gap-1.5">
                          <span className="material-symbols-outlined text-[16px] text-on-surface-variant">badge</span>
                          NIK (16 Digit)
                        </label>
                        <input
                          className={`w-full h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface font-mono focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all ${formErrors[`nik-${i}`] ? "ring-2 ring-error" : ""}`}
                          type="text"
                          inputMode="numeric"
                          maxLength={16}
                          placeholder="317105..."
                          value={a.nik}
                          onChange={(e) => ubahAnggota(i, "nik", e.target.value.replace(/\D/g, "").slice(0, 16))}
                        />
                        {formErrors[`nik-${i}`] && <span className="text-xs text-error font-semibold">{formErrors[`nik-${i}`]}</span>}
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-bold text-on-surface flex items-center gap-1.5">
                          <span className="material-symbols-outlined text-[16px] text-on-surface-variant">person</span>
                          Nama Lengkap
                        </label>
                        <input
                          className={`w-full h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all ${formErrors[`nama-${i}`] ? "ring-2 ring-error" : ""}`}
                          type="text"
                          placeholder="Masukkan nama lengkap"
                          value={a.nama}
                          onChange={(e) => ubahAnggota(i, "nama", e.target.value)}
                        />
                        {formErrors[`nama-${i}`] && <span className="text-xs text-error font-semibold">{formErrors[`nama-${i}`]}</span>}
                      </div>
                    </div>

                    {/* Hubungan & Jenis Kelamin */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-bold text-on-surface flex items-center gap-1.5">
                          <span className="material-symbols-outlined text-[16px] text-on-surface-variant">family_restroom</span>
                          Hubungan
                        </label>
                        <select
                          className={`w-full h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all ${formErrors[`hubungan-${i}`] ? "ring-2 ring-error" : ""}`}
                          value={a.hubungan}
                          onChange={(e) => ubahAnggota(i, "hubungan", e.target.value)}
                        >
                          <option value="">Pilih hubungan</option>
                          {hubunganOpsi.map((h) => (
                            <option key={h} value={h}>{h}</option>
                          ))}
                        </select>
                        {formErrors[`hubungan-${i}`] && <span className="text-xs text-error font-semibold">{formErrors[`hubungan-${i}`]}</span>}
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-bold text-on-surface flex items-center gap-1.5">
                          <span className="material-symbols-outlined text-[16px] text-on-surface-variant">person</span>
                          Jenis Kelamin
                        </label>
                        <select
                          className="w-full h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all"
                          value={a.jenisKelamin}
                          onChange={(e) => ubahAnggota(i, "jenisKelamin", e.target.value)}
                        >
                          <option value="">Pilih jenis kelamin</option>
                          {jenisKelaminOpsi.map((j) => (
                            <option key={j} value={j}>{j}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Agama & Tanggal Lahir */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-bold text-on-surface flex items-center gap-1.5">
                          <span className="material-symbols-outlined text-[16px] text-on-surface-variant">church</span>
                          Agama
                        </label>
                        <select
                          className="w-full h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all"
                          value={a.agama}
                          onChange={(e) => ubahAnggota(i, "agama", e.target.value)}
                        >
                          <option value="">Pilih agama</option>
                          {agamaOpsi.map((g) => (
                            <option key={g} value={g}>{g}</option>
                          ))}
                        </select>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-bold text-on-surface flex items-center gap-1.5">
                          <span className="material-symbols-outlined text-[16px] text-on-surface-variant">cake</span>
                          Tanggal Lahir
                        </label>
                        <input
                          className="w-full h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all"
                          type="date"
                          value={a.tglLahir}
                          onChange={(e) => ubahAnggota(i, "tglLahir", e.target.value)}
                        />
                      </div>
                    </div>

                    {/* Pekerjaan & No. WA */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-bold text-on-surface flex items-center gap-1.5">
                          <span className="material-symbols-outlined text-[16px] text-on-surface-variant">work</span>
                          Pekerjaan
                        </label>
                        <input
                          className="w-full h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all"
                          type="text"
                          placeholder="Contoh: Karyawan Swasta"
                          value={a.pekerjaan}
                          onChange={(e) => ubahAnggota(i, "pekerjaan", e.target.value)}
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-bold text-on-surface flex items-center gap-1.5">
                          <span className="material-symbols-outlined text-[16px] text-on-surface-variant">chat</span>
                          No. WA (opsional)
                        </label>
                        <input
                          className={`w-full h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface font-mono focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all ${formErrors[`noWa-${i}`] ? "ring-2 ring-error" : ""}`}
                          type="tel"
                          inputMode="numeric"
                          maxLength={13}
                          placeholder="08xxxxxxxxxx"
                          value={a.waDigits}
                          onChange={(e) => ubahAnggota(i, "waDigits", e.target.value.replace(/\D/g, "").slice(0, 13))}
                        />
                        {formErrors[`noWa-${i}`] && <span className="text-xs text-error font-semibold">{formErrors[`noWa-${i}`]}</span>}
                      </div>
                    </div>
                  </div>
                ))}

                <button
                  type="button"
                  onClick={tambahAnggota}
                  className="h-11 rounded-xl border-2 border-dashed border-primary/40 text-primary text-sm font-bold flex items-center justify-center gap-2 hover:bg-primary-container/30 transition-colors"
                >
                  <span className="material-symbols-outlined text-[18px]">person_add</span>
                  Tambah Anggota
                </button>
                {formErrors.anggota && <span className="text-xs text-error font-semibold">{formErrors.anggota}</span>}
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-3 pt-2 border-t border-surface-container-high">
                <button
                  type="button"
                  className="h-11 px-4 rounded-xl text-on-surface-variant text-sm hover:bg-surface-container-high transition-colors"
                  onClick={tutupInput}
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={simpanSedang}
                  className="h-11 px-6 rounded-xl bg-primary text-on-primary text-sm font-bold shadow-md hover:bg-primary-container active:scale-[0.98] transition-all flex items-center gap-2 disabled:opacity-60"
                >
                  <span className="material-symbols-outlined text-[18px]">save</span>
                  {kkTujuan ? "Simpan Anggota" : "Simpan Data KK"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Edit Data Warga */}
      {editing && (
        <div className="fixed inset-0 z-50 bg-on-background/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-2xl mx-4 sm:mx-auto rounded-2xl bg-surface-container-lowest shadow-2xl p-6 flex flex-col gap-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary-container flex items-center justify-center text-on-primary-container">
                  <span className="material-symbols-outlined text-[22px]">edit</span>
                </div>
                <div>
                  <h3 className="text-base font-bold text-on-surface">Edit Data Warga</h3>
                  <p className="text-xs text-on-surface-variant">
                    {linkFor(editing, kkList)
                      ? "Tersinkron dengan Data Keluarga (Portal Warga)"
                      : "Data lokal Portal RT"}
                  </p>
                </div>
              </div>
              <button className="w-8 h-8 rounded-lg bg-surface-container flex items-center justify-center text-on-surface-variant hover:text-on-surface" onClick={() => setEditing(null)}>
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface">Nama Lengkap</label>
                <input
                  className={`w-full h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all ${editErrors.nama ? "ring-2 ring-error" : ""}`}
                  type="text"
                  value={formEdit.nama}
                  onChange={(e) => setFormEdit({ ...formEdit, nama: e.target.value })}
                />
                {editErrors.nama && <span className="text-xs text-error font-semibold">{editErrors.nama}</span>}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-on-surface">NIK (16 Digit)</label>
                  <div className="relative">
                    <input
                      className={`w-full h-11 pl-4 pr-11 rounded-xl bg-surface-container-low text-sm text-on-surface font-mono focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all ${editErrors.nik ? "ring-2 ring-error" : ""}`}
                      type={lihatNik ? "text" : "password"}
                      inputMode="numeric"
                      maxLength={16}
                      autoComplete="off"
                      value={formEdit.nik}
                      onChange={(e) => setFormEdit({ ...formEdit, nik: e.target.value.replace(/\D/g, "").slice(0, 16) })}
                    />
                    <button
                      type="button"
                      aria-label={lihatNik ? "Sembunyikan NIK" : "Tampilkan NIK"}
                      title={lihatNik ? "Sembunyikan NIK" : "Tampilkan NIK"}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 w-8 h-8 rounded-lg flex items-center justify-center text-on-surface-variant hover:text-primary hover:bg-surface-container transition-colors"
                      onClick={() => setLihatNik((v) => !v)}
                    >
                      <span className="material-symbols-outlined text-[20px]">{lihatNik ? "visibility_off" : "visibility"}</span>
                    </button>
                  </div>
                  {editErrors.nik && <span className="text-xs text-error font-semibold">{editErrors.nik}</span>}
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-on-surface">No. KK (16 Digit)</label>
                  <div className="relative">
                    <input
                      className={`w-full h-11 pl-4 pr-11 rounded-xl bg-surface-container-low text-sm text-on-surface font-mono focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all ${editErrors.noKk ? "ring-2 ring-error" : ""}`}
                      type={lihatNoKk ? "text" : "password"}
                      placeholder="317105... atau 3171-xxxx-xxxx-0988"
                      autoComplete="off"
                      value={formEdit.noKk}
                      onChange={(e) => setFormEdit({ ...formEdit, noKk: e.target.value.replace(/[^0-9x-]/gi, "").slice(0, 19) })}
                    />
                    <button
                      type="button"
                      aria-label={lihatNoKk ? "Sembunyikan No. KK" : "Tampilkan No. KK"}
                      title={lihatNoKk ? "Sembunyikan No. KK" : "Tampilkan No. KK"}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 w-8 h-8 rounded-lg flex items-center justify-center text-on-surface-variant hover:text-primary hover:bg-surface-container transition-colors"
                      onClick={() => setLihatNoKk((v) => !v)}
                    >
                      <span className="material-symbols-outlined text-[20px]">{lihatNoKk ? "visibility_off" : "visibility"}</span>
                    </button>
                  </div>
                  {editErrors.noKk && <span className="text-xs text-error font-semibold">{editErrors.noKk}</span>}
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface">Alamat</label>
                <input
                  className={`w-full h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all ${editErrors.alamat ? "ring-2 ring-error" : ""}`}
                  type="text"
                  value={formEdit.alamat}
                  onChange={(e) => setFormEdit({ ...formEdit, alamat: e.target.value })}
                />
                {editErrors.alamat && <span className="text-xs text-error font-semibold">{editErrors.alamat}</span>}
              </div>

              {/* ===== 14 kolom data KK lengkap (bisa diperbaiki Pengurus RT) ===== */}
              <p className="text-[11px] font-bold uppercase tracking-wider text-primary pt-1">Data Kartu Keluarga</p>

              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-on-surface">Tempat Lahir</label>
                  <input
                    className="w-full h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all"
                    type="text"
                    placeholder="Contoh: Jakarta"
                    value={formEdit.tempatLahir}
                    onChange={(e) => setFormEdit({ ...formEdit, tempatLahir: e.target.value })}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-on-surface">Tanggal Lahir</label>
                  <input
                    className="w-full h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all"
                    type="date"
                    value={formEdit.tglLahir}
                    onChange={(e) => setFormEdit({ ...formEdit, tglLahir: e.target.value })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-on-surface">Jenis Kelamin</label>
                  <select
                    className="w-full h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all"
                    value={formEdit.jenisKelamin}
                    onChange={(e) => setFormEdit({ ...formEdit, jenisKelamin: e.target.value })}
                  >
                    <option value="">— Pilih —</option>
                    {denganNilai(jenisKelaminOpsi, formEdit.jenisKelamin).map((o) => <option key={o}>{o}</option>)}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-on-surface">Agama</label>
                  <select
                    className="w-full h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all"
                    value={formEdit.agama}
                    onChange={(e) => setFormEdit({ ...formEdit, agama: e.target.value })}
                  >
                    <option value="">— Pilih —</option>
                    {denganNilai(agamaOpsi, formEdit.agama).map((o) => <option key={o}>{o}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-on-surface">Pendidikan</label>
                  <select
                    className="w-full h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all"
                    value={formEdit.pendidikan}
                    onChange={(e) => setFormEdit({ ...formEdit, pendidikan: e.target.value })}
                  >
                    <option value="">— Pilih —</option>
                    {denganNilai(pendidikanOpsi, formEdit.pendidikan).map((o) => <option key={o}>{o}</option>)}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-on-surface">Jenis Pekerjaan</label>
                  <select
                    className="w-full h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all"
                    value={formEdit.pekerjaan}
                    onChange={(e) => setFormEdit({ ...formEdit, pekerjaan: e.target.value })}
                  >
                    <option value="">— Pilih —</option>
                    {denganNilai(pekerjaanOpsi, formEdit.pekerjaan).map((o) => <option key={o}>{o}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-on-surface">Golongan Darah</label>
                  <select
                    className="w-full h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all"
                    value={formEdit.goldarah}
                    onChange={(e) => setFormEdit({ ...formEdit, goldarah: e.target.value })}
                  >
                    <option value="">— Pilih —</option>
                    {denganNilai(goldarahOpsi, formEdit.goldarah).map((o) => <option key={o}>{o}</option>)}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-on-surface">Status Perkawinan</label>
                  <select
                    className="w-full h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all"
                    value={formEdit.statusKawin}
                    onChange={(e) => setFormEdit({ ...formEdit, statusKawin: e.target.value })}
                  >
                    <option value="">— Pilih —</option>
                    {denganNilai(statusKawinOpsi, formEdit.statusKawin).map((o) => <option key={o}>{o}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-on-surface">Tanggal Perkawinan</label>
                  <input
                    className="w-full h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all"
                    type="date"
                    value={formEdit.tglKawin}
                    onChange={(e) => setFormEdit({ ...formEdit, tglKawin: e.target.value })}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-on-surface">Status Hubungan dalam Keluarga</label>
                  <select
                    className="w-full h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all"
                    value={formEdit.hubungan}
                    onChange={(e) => setFormEdit({ ...formEdit, hubungan: e.target.value })}
                  >
                    <option value="">— Pilih —</option>
                    {denganNilai(hubunganOpsi, formEdit.hubungan).map((o) => <option key={o}>{o}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-on-surface">Warga Negara</label>
                  <select
                    className="w-full h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all"
                    value={formEdit.wargaNegara}
                    onChange={(e) => setFormEdit({ ...formEdit, wargaNegara: e.target.value })}
                  >
                    <option value="">— Pilih —</option>
                    {denganNilai(wargaNegaraOpsi, formEdit.wargaNegara).map((o) => <option key={o}>{o}</option>)}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-on-surface">No. WA (10-13 Digit)</label>
                  <input
                    className={`w-full h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface font-mono focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all ${editErrors.noWa ? "ring-2 ring-error" : ""}`}
                    type="tel"
                    inputMode="numeric"
                    maxLength={13}
                    value={formEdit.noWa}
                    onChange={(e) => setFormEdit({ ...formEdit, noWa: e.target.value.replace(/\D/g, "").slice(0, 13) })}
                  />
                  {editErrors.noWa && <span className="text-xs text-error font-semibold">{editErrors.noWa}</span>}
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface">Status Portal</label>
                <select
                  className="w-full h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all"
                  value={formEdit.statusPortal}
                  onChange={(e) => setFormEdit({ ...formEdit, statusPortal: e.target.value })}
                >
                  {/* Okt 2026 · pengurus RT HANYA dapat mengubah status MENJADI
                      "Dinonaktifkan" — opsi Aktif/dkk. tidak lagi ditawarkan;
                      status saat ini selalu ikut agar baris tetap terbaca. */}
                  {denganNilai(
                    [formEdit.statusPortal, "Dinonaktifkan"].filter((v, i, a) => a.indexOf(v) === i),
                    formEdit.statusPortal,
                  ).map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
                <span className="text-[11px] text-on-surface-variant leading-snug">
                  Perubahan status portal hanya dapat menjadi <strong>Dinonaktifkan</strong> —
                  pengaktifan ulang tidak tersedia di Portal RT.
                </span>
              </div>

              <div className="p-3 rounded-xl bg-primary-container/25 border border-primary/15 flex items-start gap-2">
                <span className="material-symbols-outlined text-primary text-[16px] mt-0.5">sync</span>
                <p className="text-xs text-on-surface-variant leading-relaxed">
                  Perubahan akan tersimpan dan <strong className="text-on-surface">tersinkron di kedua portal</strong> bila warga ini terdaftar pada Kartu Keluarga (Data Keluarga).
                </p>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2 border-t border-surface-container-high">
                <button type="button" className="h-11 px-4 rounded-xl text-on-surface-variant text-sm hover:bg-surface-container-high transition-colors" onClick={() => setEditing(null)}>Batal</button>
                <button type="submit" disabled={simpanSedang} className="h-11 px-6 rounded-xl bg-primary text-on-primary text-sm font-bold shadow-md hover:bg-primary-container active:scale-[0.98] transition-all flex items-center gap-2 disabled:opacity-60">
                  <span className="material-symbols-outlined text-[18px]">save</span>
                  Simpan Perubahan
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Konfirmasi Hapus Data Warga */}
      {hapusTarget && (
        <div className="fixed inset-0 z-50 bg-on-background/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-surface-container-lowest shadow-2xl p-6 flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-error-container/40 flex items-center justify-center text-error shrink-0">
                <span className="material-symbols-outlined text-[22px]">delete</span>
              </div>
              <div>
                <h3 className="text-base font-bold text-on-surface">Hapus Data Warga?</h3>
                <p className="text-xs text-on-surface-variant">Data yang sudah tidak dipakai akan dihapus permanen.</p>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-surface-container-low flex flex-col gap-1.5">
              <span className="text-sm font-bold text-on-surface">{hapusTarget.nama}</span>
              <span className="text-xs text-on-surface-variant break-all">
                {hapusTarget.alamat} &bull; {maskedNoKk(hapusTarget.noKk)}
              </span>
            </div>

            <p className="text-xs text-on-surface-variant leading-relaxed">
              Warga ini akan dihapus dari <strong className="text-on-surface">Data Warga</strong> dan dari
              <strong className="text-on-surface"> Data Keluarga</strong> (bila terpasang pada Kartu Keluarga).
              Riwayat surat &amp; pembayaran tetap tersimpan.
            </p>

            <div className="flex items-center justify-end gap-3 pt-2 border-t border-surface-container-high">
              <button
                className="h-11 px-4 rounded-xl text-on-surface-variant text-sm hover:bg-surface-container-high transition-colors"
                onClick={() => setHapusTarget(null)}
              >
                Batal
              </button>
              <button
                disabled={simpanSedang}
                className="h-11 px-6 rounded-xl bg-error text-on-error text-sm font-bold shadow-md hover:opacity-90 active:scale-[0.98] transition-all flex items-center gap-2 disabled:opacity-60"
                onClick={handleHapus}
              >
                <span className="material-symbols-outlined text-[18px]">delete</span>
                Ya, Hapus
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Detail Warga */}
      {detailWarga && (() => {
        const w = detailWarga;
        const link = linkFor(w, kkList);
        const kk = link ? kkList.find((k) => k.id === link.kkId) : undefined;
        const riwayat: { icon: string; text: string }[] = [];
        if (link && kk) {
          riwayat.push({ icon: "sync", text: `Tersinkron dengan Data Keluarga — KK ${maskedNoKk(kk.noKk)} (Kepala: ${kk.kepala}).` });
        } else {
          riwayat.push({ icon: "person_add", text: `Terdaftar langsung di basis data ${tenant.rtFull} (input manual Pengurus RT).` });
        }
        if (w.statusPortal === "Aktif") {
          riwayat.push({ icon: "check_circle", text: "Akun portal warga aktif — dapat mengakses layanan mandiri." });
        } else if (w.statusPortal === "Undangan Dikirim") {
          const u = undangan.find((x) => digitsOnly(x.noWa) === digitsOnly(w.noWa));
          riwayat.push({
            icon: "mail",
            text: u
              ? u.status === "Dipakai"
                ? "Undangan sudah dikonfirmasi warga — akses portal terbuka."
                : `Undangan aktifasi dibuat — link & QR siap dibagikan, berlaku s/d ${u.berlakuSampai} (status ${u.status}).`
              : "Undangan aktivasi portal dikirim ke warga lewat WhatsApp.",
          });
        } else {
          riwayat.push({ icon: "schedule", text: "Akun portal belum aktif — kirim undangan untuk aktivasi." });
        }
        riwayat.push({ icon: "history", text: `Data tercatat dalam administrasi kependudukan ${tenant.label}.` });
        return (
          <div className="fixed inset-0 z-50 bg-on-background/40 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="w-full max-w-lg mx-4 sm:mx-auto rounded-2xl bg-surface-container-lowest shadow-2xl p-6 flex flex-col gap-5 max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-primary-container flex items-center justify-center text-on-primary-container font-bold text-xs">
                    {initialsOf(w.nama)}
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-on-surface">{w.nama}</h3>
                    <p className="text-xs text-on-surface-variant">{w.status} &bull; {w.alamat}</p>
                  </div>
                </div>
                <button className="w-8 h-8 rounded-lg bg-surface-container flex items-center justify-center text-on-surface-variant hover:text-on-surface" onClick={() => setDetailWarga(null)}>
                  <span className="material-symbols-outlined text-[18px]">close</span>
                </button>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 rounded-lg bg-surface-container-low gap-3">
                  <span className="text-sm text-on-surface-variant shrink-0">NIK</span>
                  <span className="text-sm font-bold text-on-surface font-mono break-all text-right">{maskedNik(w.nik)}</span>
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg bg-surface-container-low gap-3">
                  <span className="text-sm text-on-surface-variant shrink-0">No. KK</span>
                  <span className="text-sm font-bold text-on-surface font-mono break-all text-right">{maskedNoKk(w.noKk)}</span>
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg bg-surface-container-low gap-3">
                  <span className="text-sm text-on-surface-variant shrink-0">Alamat</span>
                  <span className="text-sm font-bold text-on-surface text-right">{w.alamat}, {tenant.label}</span>
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg bg-surface-container-low gap-3">
                  <span className="text-sm text-on-surface-variant shrink-0">No. WA</span>
                  <span className="text-sm font-bold text-on-surface font-mono text-right">{fmtWa(w.noWa)}</span>
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg bg-surface-container-low gap-3">
                  <span className="text-sm text-on-surface-variant shrink-0">Status Portal</span>
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${w.statusBadge}`}>
                    <span className="w-2 h-2 rounded-full bg-current opacity-60" />
                    {w.statusPortal}
                  </span>
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg bg-surface-container-low gap-3">
                  <span className="text-sm text-on-surface-variant shrink-0">Peran / Status</span>
                  <span className={`text-sm font-bold text-right ${w.statusColor}`}>{w.status}</span>
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-surface-container-low flex flex-col gap-2.5">
                <div className="flex items-center gap-2 text-xs font-bold text-on-surface-variant uppercase tracking-wider">
                  <span className="material-symbols-outlined text-[16px] text-primary">history</span>
                  Riwayat Singkat
                </div>
                <ul className="flex flex-col gap-2">
                  {riwayat.map((r, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs text-on-surface-variant leading-relaxed">
                      <span className="material-symbols-outlined text-[15px] text-primary mt-0.5 shrink-0">{r.icon}</span>
                      {r.text}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2 border-t border-surface-container-high">
                <button className="h-11 px-4 rounded-xl text-on-surface-variant text-sm hover:bg-surface-container-high transition-colors" onClick={() => setDetailWarga(null)}>Tutup</button>
                {w.statusPortal === "Belum Aktif" && (
                  <button
                    className="h-11 px-5 rounded-xl bg-tertiary-container/60 text-on-tertiary-container text-sm font-bold shadow-md hover:bg-tertiary-container active:scale-[0.98] transition-all flex items-center gap-2"
                    onClick={() => { const w2 = detailWarga; setDetailWarga(null); handleKirimUndangan(w2); }}
                  >
                    <span className="material-symbols-outlined text-[18px]">qr_code_2</span>
                    Undangan
                  </button>
                )}
                {/* B5 · aksi sesuai Status Portal — modal ditutup dulu, lalu konfirmasi. */}
                {aksiAkses(w).map((a) => (
                  <button
                    key={a.jenis}
                    className={`h-11 px-5 rounded-xl text-sm font-bold shadow-md active:scale-[0.98] transition-all flex items-center gap-2 disabled:opacity-60 ${AKSES_KELAS[a.jenis]}`}
                    disabled={aksiSedang}
                    onClick={() => { const w2 = detailWarga; setDetailWarga(null); setKonfirmasiAksi({ jenis: a.jenis, warga: w2 }); }}
                  >
                    <span className="material-symbols-outlined text-[18px]">{a.ikon}</span>
                    {a.label}
                  </button>
                ))}
                <button
                  className="h-11 px-5 rounded-xl bg-primary text-on-primary text-sm font-bold shadow-md hover:bg-primary-container active:scale-[0.98] transition-all flex items-center gap-2"
                  onClick={() => { const w2 = detailWarga; setDetailWarga(null); openEdit(w2); }}
                >
                  <span className="material-symbols-outlined text-[18px]">edit</span>
                  Edit Data
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Modal: Upload Bulk */}
      {showUploadModal && (
        <div className="fixed inset-0 z-50 bg-on-background/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg mx-4 sm:mx-auto rounded-2xl bg-surface-container-lowest shadow-2xl p-6 flex flex-col gap-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-secondary-container/40 flex items-center justify-center text-on-secondary-container">
                  <span className="material-symbols-outlined text-[22px]">upload_file</span>
                </div>
                <div>
                  <h3 className="text-base font-bold text-on-surface">Upload Bulk Data Warga</h3>
                  <p className="text-xs text-on-surface-variant">Import data warga dari file CSV atau XLSX</p>
                </div>
              </div>
              <button className="w-8 h-8 rounded-lg bg-surface-container flex items-center justify-center text-on-surface-variant hover:text-on-surface" onClick={tutupUpload}>
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            {/* Template Download */}
            <div className="p-4 rounded-xl bg-surface-container-low flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <span className="material-symbols-outlined text-primary text-[24px] shrink-0">description</span>
                <div className="min-w-0">
                  <span className="text-sm font-bold text-on-surface block">Template CSV Data Warga</span>
                  <span className="text-xs text-on-surface-variant">Format: Nama, NIK, No. KK, Alamat, No. WA, Email</span>
                </div>
              </div>
              <button
                className="h-9 px-3 rounded-lg bg-primary-container text-on-primary text-xs font-bold hover:bg-primary hover:text-on-primary transition-colors flex items-center gap-1 shrink-0"
                onClick={handleUnduhTemplate}
              >
                <span className="material-symbols-outlined text-[16px]">download</span>
                Unduh Template
              </button>
            </div>

            {/* Upload Area */}
            <label
              htmlFor="file-upload"
              className="border-2 border-dashed border-outline-variant hover:border-primary rounded-xl p-8 text-center bg-surface-container-low/50 cursor-pointer transition-colors block"
            >
              <span className="material-symbols-outlined text-primary text-[48px] block">cloud_upload</span>
              <span className="text-sm text-on-surface font-bold mt-2 block">Klik untuk memilih file atau seret ke sini</span>
              <span className="text-xs text-on-surface-variant block mt-1">Format yang didukung: CSV, XLSX (Maksimal 5 MB)</span>
              {uploadFileName && (
                <span className="text-xs text-primary font-bold block mt-2 break-all">
                  <span className="material-symbols-outlined text-[14px] align-middle">attach_file</span>{" "}
                  {uploadFileName}
                </span>
              )}
            </label>
            <input
              id="file-upload"
              type="file"
              accept=".csv,.xlsx"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) {
                  setUploadFileName(f.name);
                  setUploadFile(f);
                }
              }}
            />

            {/* Preview Table */}
            <div className="rounded-xl border border-surface-container-high overflow-hidden">
              <div className="px-4 py-3 bg-surface-container-low text-xs font-bold text-on-surface-variant uppercase tracking-wider">
                Preview Data (3 baris pertama)
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-surface-container-lowest text-on-surface-variant">
                    <tr>
                      <th className="py-2 px-4">Nama</th>
                      <th className="py-2 px-4">NIK</th>
                      <th className="py-2 px-4">No. KK</th>
                      <th className="py-2 px-4">Alamat</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-container-high text-on-surface">
                    <tr className="bg-surface-container-low/30">
                      <td className="py-2 px-4 font-semibold">Contoh Warga 1</td>
                      <td className="py-2 px-4 font-mono">317105010105XXXX</td>
                      <td className="py-2 px-4 font-mono">317105010105XXXX</td>
                      <td className="py-2 px-4">Blok A1 No. 1</td>
                    </tr>
                    <tr className="bg-surface-container-low/30">
                      <td className="py-2 px-4 font-semibold">Contoh Warga 2</td>
                      <td className="py-2 px-4 font-mono">317105010105XXXX</td>
                      <td className="py-2 px-4 font-mono">317105010105XXXX</td>
                      <td className="py-2 px-4">Blok B2 No. 14</td>
                    </tr>
                    <tr className="bg-surface-container-low/30">
                      <td className="py-2 px-4 font-semibold">Contoh Warga 3</td>
                      <td className="py-2 px-4 font-mono">317105010105XXXX</td>
                      <td className="py-2 px-4 font-mono">317105010105XXXX</td>
                      <td className="py-2 px-4">Blok C1 No. 8</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                className="h-11 px-4 rounded-xl text-on-surface-variant text-sm hover:bg-surface-container-high transition-colors"
                onClick={tutupUpload}
              >
                Batal
              </button>
              <button
                className="h-11 px-6 rounded-xl bg-primary text-on-primary text-sm font-bold shadow-md hover:bg-primary-container active:scale-[0.98] transition-all flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                onClick={handleImportFile}
                disabled={imporSedang || !uploadFile}
              >
                <span className="material-symbols-outlined text-[18px]">
                  {imporSedang ? "progress_activity" : "upload_file"}
                </span>
                {imporSedang ? "Mengimpor..." : "Import Data"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Kirim Undangan */}
      {showInviteModal && (
        <div className="fixed inset-0 z-50 bg-on-background/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg mx-4 sm:mx-auto rounded-2xl bg-surface-container-lowest shadow-2xl p-6 flex flex-col gap-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-tertiary-container/40 flex items-center justify-center text-on-tertiary-container">
                  <span className="material-symbols-outlined text-[22px]">mail</span>
                </div>
                <div>
                  <h3 className="text-base font-bold text-on-surface">Kirim Undangan Portal</h3>
                  <p className="text-xs text-on-surface-variant">Pilih warga untuk mengirim undangan aktivasi portal</p>
                </div>
              </div>
              <button className="w-8 h-8 rounded-lg bg-surface-container flex items-center justify-center text-on-surface-variant hover:text-on-surface" onClick={() => { setShowInviteModal(false); setSelectedWarga([]); }}>
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            {/* Select Info */}
            <div className="p-3 rounded-lg bg-tertiary-container/20 text-xs text-on-surface-variant flex items-center gap-2">
              <span className="material-symbols-outlined text-[16px] text-tertiary">info</span>
              {selectedWarga.length > 0 ? (
                <span><strong className="text-on-surface">{selectedWarga.length}</strong> warga dipilih untuk dikirim undangan</span>
              ) : (
                <span>Pilih warga dari tabel di bawah atau gunakan checkbox</span>
              )}
            </div>

            {/* Resident List */}
            <div className="rounded-xl border border-surface-container-high overflow-hidden max-h-60 overflow-y-auto">
              <div className="divide-y divide-surface-container-high">
                {rows.filter((w) => w.statusPortal !== "Aktif").map((warga) => (
                  <label key={warga.id} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-container-low/50 cursor-pointer transition-colors">
                    <input
                      type="checkbox"
                      className="rounded border-outline-variant text-primary focus:ring-primary"
                      checked={selectedWarga.includes(warga.id)}
                      onChange={() => toggleSelectWarga(warga.id)}
                    />
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-bold text-on-surface block truncate">{warga.nama}</span>
                      <span className="text-xs text-on-surface-variant">{warga.alamat} &bull; {fmtWa(warga.noWa)}</span>
                    </div>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${warga.statusBadge}`}>
                      {warga.statusPortal}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {/* Message Preview */}
            <div className="p-4 rounded-xl bg-surface-container-low flex flex-col gap-2">
              <div className="flex items-center gap-2 text-xs font-bold text-on-surface-variant">
                <span className="material-symbols-outlined text-[16px]">chat</span>
                Pesan Undangan via WhatsApp:
              </div>
              <div className="text-xs text-on-surface leading-relaxed p-3 rounded-lg bg-surface-container-lowest">
                Assalamu&apos;alaikum wr. wb. Yth. Warga {tenant.rtFull} {tenant.rwFull},<br /><br />
                Anda diundang untuk mengaktifkan portal layanan warga SIWARGA. Buka link undangan unik milik Anda
                (dibagikan Pengurus lewat tombol <strong>Undangan</strong> pada data warga) lalu{" "}
                <strong>buat kata sandi</strong> portal Anda di halaman undangan.<br /><br />
                Salam,<br />
                Pengurus {tenant.rtFull} {tenant.rwFull}
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                className="h-11 px-4 rounded-xl text-on-surface-variant text-sm hover:bg-surface-container-high transition-colors"
                onClick={() => { setShowInviteModal(false); setSelectedWarga([]); }}
              >
                Batal
              </button>
              <button
                className="h-11 px-6 rounded-xl bg-primary text-on-primary text-sm font-bold shadow-md hover:bg-primary-container active:scale-[0.98] transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={selectedWarga.length === 0 || kirimSedang}
                onClick={async () => {
                  if (kirimSedang) return;
                  setKirimSedang(true);
                  // Satu panggilan per penerima unik — API-first per warga; baris
                  // yang sukses diberi status "Undangan Dikirim", yang gagal
                  // (mis. CONFLICT warga sudah aktif) dilaporkan via flash.
                  // Kunci dedup: no. HP (bila ada) → satu token per nomor; baris
                  // TANPA no. HP jangan sampai saling meniadakan (key "" sama).
                  const sudah: string[] = [];
                  const idBerhasil: string[] = [];
                  const kartuBaru: Undangan[] = [];
                  const gagal: { nama: string; pesan: string }[] = [];
                  for (const id of selectedWarga) {
                    const r = rows.find((x) => x.id === id);
                    if (!r) continue;
                    const kunci = digitsOnly(r.noWa) ? `wa:${digitsOnly(r.noWa)}` : `baris:${r.id}`;
                    if (sudah.includes(kunci)) continue;
                    sudah.push(kunci);
                    try {
                      // Bug laporan — hasil penerbitan disimpan: token hanya ada
                      // saat ini, jadi QR tiap penerima harus ditampilkan sekarang.
                      kartuBaru.push(
                        await onUndanganWarga({ nama: r.nama, alamat: r.alamat, noWa: r.noWa, idWarga: r.idWarga }),
                      );
                      idBerhasil.push(r.id);
                    } catch (err) {
                      gagal.push({ nama: r.nama, pesan: pesanGalatUndangan(err) });
                    }
                  }
                  setKirimSedang(false);
                  markUndangan(idBerhasil);
                  setShowInviteModal(false);
                  setSelectedWarga([]);
                  if (kartuBaru.length > 0) {
                    setAntreanKartu(kartuBaru);
                    setKartuUndangan(kartuBaru[0]);
                  }
                  if (gagal.length === 0) {
                    flash(
                      kartuBaru.length === 1
                        ? `Kartu undangan ${kartuBaru[0].nama} siap — bagikan link atau QR-nya.`
                        : `Undangan aktivasi dibuat untuk ${idBerhasil.length} warga — pindai/tukar kartu QR satu per satu lewat tombol panah.`,
                    );
                  } else if (idBerhasil.length === 0) {
                    flash(`Undangan gagal dibuat — ${gagal[0].pesan}`);
                  } else {
                    flash(`${idBerhasil.length} undangan terkirim — gagal untuk ${gagal.map((x) => x.nama).join(", ")}: ${gagal[0].pesan}`);
                  }
                }}
              >
                {kirimSedang ? (
                  <>
                    <span className="material-symbols-outlined text-[18px] animate-spin">progress_activity</span>
                    Mengirim…
                  </>
                ) : (
                  <>
                    <span className="material-symbols-outlined text-[18px]">send</span>
                    Kirim ke {selectedWarga.length} Warga
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Kartu Undangan (QR + link) untuk warga terpilih */}
      {kartuUndangan && (
        <div className="fixed inset-0 z-50 bg-on-background/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md mx-4 sm:mx-auto rounded-2xl bg-surface-container-lowest shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
            <div className="flex items-center justify-between px-5 py-4 bg-surface-container-low border-b border-surface-container-high">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-tertiary-container/40 flex items-center justify-center text-on-tertiary-container">
                  <span className="material-symbols-outlined text-[20px]">qr_code_2</span>
                </div>
                <div>
                  <h3 className="text-sm font-bold text-on-surface">Undangan Portal Warga</h3>
                  <p className="text-[11px] text-on-surface-variant">Link &amp; QR untuk {kartuUndangan.nama}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {/* Bug laporan — kirim massal menghasilkan banyak token; token tak
                    bisa diminta ulang (server simpan hash), jadi tiap kartu harus
                    bisa ditelusuri di sesi ini lewat pager. */}
                {idxKartu >= 0 && antreanKartu.length > 1 && (
                  <div className="flex items-center gap-1">
                    <button
                      className="w-7 h-7 rounded-lg bg-surface-container flex items-center justify-center text-on-surface-variant hover:text-on-surface disabled:opacity-40"
                      title="QR penerima sebelumnya"
                      disabled={idxKartu === 0}
                      onClick={() => setKartuUndangan(antreanKartu[idxKartu - 1])}
                    >
                      <span className="material-symbols-outlined text-[16px]">chevron_left</span>
                    </button>
                    <span className="text-[11px] font-bold text-on-surface-variant tabular-nums min-w-[3.25rem] text-center">
                      {idxKartu + 1} / {antreanKartu.length}
                    </span>
                    <button
                      className="w-7 h-7 rounded-lg bg-surface-container flex items-center justify-center text-on-surface-variant hover:text-on-surface disabled:opacity-40"
                      title="QR penerima berikutnya"
                      disabled={idxKartu === antreanKartu.length - 1}
                      onClick={() => setKartuUndangan(antreanKartu[idxKartu + 1])}
                    >
                      <span className="material-symbols-outlined text-[16px]">chevron_right</span>
                    </button>
                  </div>
                )}
                <button
                  className="w-8 h-8 rounded-lg bg-surface-container flex items-center justify-center text-on-surface-variant hover:text-on-surface"
                  onClick={() => { setAntreanKartu([]); setKartuUndangan(null); }}
                >
                  <span className="material-symbols-outlined text-[18px]">close</span>
                </button>
              </div>
            </div>
            {/* `flex-1 min-h-0` + `overflow-y-auto`: badan modal dikunci pada
                tinggi maksimal (92vh) lalu MENSCROLL — bukan memotong kartu. */}
            <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4 flex flex-col gap-4">
              <KartuUndangan u={kartuUndangan} />
              <div className="p-3 rounded-xl bg-surface-container-low text-[11px] text-on-surface-variant leading-relaxed flex items-start gap-2">
                <span className="material-symbols-outlined text-[15px] text-primary mt-0.5 shrink-0">info</span>
                <span>
                  Bagikan link atau QR ini ke warga &rarr; warga <strong>buat kata sandi portal</strong> di
                  halaman undangan &rarr; akses Portal Warga terbuka untuk update data pribadi &amp; keluarga.
                  Undangan hanya dapat dibuat untuk warga terdaftar di Data Warga.
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* B5 · konfirmasi aksi undangan/akses — dialog bersama lintas halaman */}
      {konfirmasiAksi &&
        (() => {
          const info = infoAksiAkses(konfirmasiAksi.jenis, konfirmasiAksi.warga);
          const w = konfirmasiAksi.warga;
          return (
            <KonfirmasiDialog
              judul={info.judul}
              pesan={info.pesan}
              ikon={info.ikon}
              aksen={info.aksen}
              labelYa={info.labelYa}
              sedang={aksiSedang}
              detail={
                <div className="p-3.5 rounded-xl bg-surface-container-low flex flex-col gap-1.5">
                  <span className="text-sm font-bold text-on-surface">{w.nama}</span>
                  <span className="text-xs text-on-surface-variant break-all">
                    {w.alamat} &bull; {maskedNoKk(w.noKk)}
                  </span>
                  <span
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 mt-1 self-start rounded-full text-xs font-bold ${w.statusBadge}`}
                  >
                    <span className="w-2 h-2 rounded-full bg-current opacity-60" />
                    {w.statusPortal}
                  </span>
                </div>
              }
              onBatal={() => setKonfirmasiAksi(null)}
              onYa={() => void jalankanAksi()}
            />
          );
        })()}

      {/* B6 · kotak masuk keamanan — token undangan yang disentuh >1 perangkat */}
      {lihatTemuan && (
        <div className="fixed inset-0 z-50 bg-on-background/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-2xl mx-4 sm:mx-auto rounded-2xl bg-surface-container-lowest shadow-2xl p-6 flex flex-col gap-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-error-container/40 flex items-center justify-center text-error shrink-0">
                  <span className="material-symbols-outlined text-[22px]">gpp_maybe</span>
                </div>
                <div>
                  <h3 className="text-base font-bold text-on-surface">Perlu Perhatian</h3>
                  <p className="text-xs text-on-surface-variant leading-relaxed">
                    Undangan yang dibuka dari lebih dari satu perangkat — kemungkinan tautan dibagikan ke pihak lain.
                  </p>
                </div>
              </div>
              <button
                className="w-8 h-8 rounded-lg bg-surface-container flex items-center justify-center text-on-surface-variant hover:text-on-surface shrink-0"
                onClick={() => setLihatTemuan(false)}
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <div className="flex flex-col gap-3">
              {(temuan ?? []).map((t) => (
                <div
                  key={t.id}
                  className="rounded-xl border border-error-container/60 bg-surface-container-low p-4 flex flex-col gap-2.5"
                >
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div>
                      <span className="text-sm font-bold text-on-surface block">{t.nama}</span>
                      <span className="text-[11px] text-on-surface-variant">
                        {t.noHp ? fmtWa(t.noHp) : "No. HP tidak tercatat"} &bull; status{" "}
                        {statusAksesKePortal(t.statusAkses)} &bull; undangan {t.status.replace("_", " ")}
                      </span>
                    </div>
                    <span className="px-2.5 py-1 rounded-full bg-error-container text-on-error-container text-[11px] font-bold shrink-0">
                      {t.jumlahPerangkat} Perangkat &bull; {t.jumlahPercobaan} Percobaan
                    </span>
                  </div>
                  <ul className="flex flex-col gap-1.5">
                    {t.percobaan.slice(0, 10).map((p, i) => (
                      <li
                        key={`${p.deviceHash}-${i}-${p.waktu}`}
                        className="flex items-start justify-between gap-3 text-[11px] text-on-surface-variant bg-surface-container-lowest rounded-lg px-3 py-2"
                      >
                        <span className="font-mono break-all">
                          {p.deviceHash.slice(0, 12)}&hellip; &bull; {p.ip ?? "IP tak tercatat"}
                        </span>
                        <span className="text-right shrink-0">
                          {new Date(p.waktu).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })}{" "}
                          &bull; <strong className="text-on-surface">{p.hasil ?? "tanpa hasil"}</strong>
                        </span>
                      </li>
                    ))}
                    {t.percobaan.length > 10 && (
                      <li className="text-[11px] text-on-surface-variant px-3">
                        &hellip; {t.percobaan.length - 10} percobaan lain tidak ditampilkan.
                      </li>
                    )}
                  </ul>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-end gap-3 pt-2 border-t border-surface-container-high">
              <button
                className="h-11 px-4 rounded-xl text-on-surface-variant text-sm hover:bg-surface-container-high transition-all flex items-center gap-2 disabled:opacity-60"
                onClick={() => void segarkanInspeksi()}
                disabled={inspeksiSedang}
              >
                <span className={`material-symbols-outlined text-[18px] ${inspeksiSedang ? "animate-spin" : ""}`}>
                  refresh
                </span>
                Muat Ulang
              </button>
              <button
                className="h-11 px-6 rounded-xl bg-primary text-on-primary text-sm font-bold shadow-md hover:bg-primary-container active:scale-[0.98] transition-all"
                onClick={() => setLihatTemuan(false)}
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
