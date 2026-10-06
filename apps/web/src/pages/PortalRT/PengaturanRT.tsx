import { useEffect, useState } from "react";
import { tenant } from "../../lib/tenant";
import {
  Pengurus,
  Langganan,
  PaketLangganan,
  paketInfo,
  formatRupiah,
  KopSurat,
  kopSuratDefault,
} from "../../lib/shared";
import { GalatApi, type PengaturanIuranRt, type PengaturanSuratRt } from "../../lib/api";
import { useFlash } from "../../lib/useFlash";

interface PengaturanRTProps {
  onNavigate?: (page: string) => void;
  pengurus: Pengurus[];
  onPengurusChange: (p: Pengurus[]) => void;
  langganan: Langganan;
  onLanggananChange: (l: Langganan) => void;
  /**
   * B7 — `GET /rt/iuran/pengaturan`; `null` = OFFLINE (form memakai default
   * skema). MELEMPAR galat non-OFFLINE (sesi habis ditangani App).
   */
  onMuatPengaturanIuran: () => Promise<PengaturanIuranRt | null>;
  /**
   * B7 — `PATCH /rt/iuran/pengaturan` (parsial, wajib CSRF) → nilai sesudah;
   * `null` = OFFLINE. MELEMPAR galat non-OFFLINE.
   */
  onSimpanPengaturanIuran: (
    patch: Partial<PengaturanIuranRt>,
  ) => Promise<PengaturanIuranRt | null>;
  /**
   * B12 — `GET /rt/pengaturan` (kop surat resmi §6.6 + profil visual + profil
   * RT + sakelar notifikasi/mode pemeliharaan); `null` = OFFLINE (form memakai
   * nilai bawaan). MELEMPAR galat non-OFFLINE (sesi habis ditangani App).
   */
  onMuatPengaturanSurat: () => Promise<PengaturanSuratRt | null>;
  /**
   * B12 — `PATCH /rt/pengaturan` (parsial: kop, profil visual, profil RT,
   * `notifikasiWaEnabled`, `modePemeliharaan`; wajib CSRF) → nilai sesudah;
   * `null` = OFFLINE. MELEMPAR galat non-OFFLINE.
   */
  onSimpanPengaturanSurat: (patch: {
    kop?: Partial<KopSurat>;
    profil?: { namaRt: string; alamat: string };
    notifikasiWaEnabled?: boolean;
    modePemeliharaan?: boolean;
  }) => Promise<PengaturanSuratRt | null>;
}

interface UserAccess {
  id: string;
  nama: string;
  role: string;
  akses: string;
  initials: string;
  bgColor: string;
  textColor: string;
}

const userAccessDefault: UserAccess[] = [
  { id: "u1", nama: "Bpk. Joko Santoso", role: "Ketua RT", akses: "Full Access", initials: "JS", bgColor: "bg-primary-container", textColor: "text-on-primary-container" },
  { id: "u2", nama: "Rahmat Hidayat", role: "Sekretaris", akses: "Full Access", initials: "RH", bgColor: "bg-secondary-container", textColor: "text-on-secondary-container" },
  { id: "u3", nama: "Hj. Siti Rahmawati", role: "Bendahara", akses: "Keuangan + Warga", initials: "SR", bgColor: "bg-tertiary-container", textColor: "text-on-tertiary-container" },
];

const BULAN_SINGKAT = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

/** Format tanggal lokal: "24 Sep 2026". */
function formatTanggalID(d: Date): string {
  return `${String(d.getDate()).padStart(2, "0")} ${BULAN_SINGKAT[d.getMonth()]} ${d.getFullYear()}`;
}

/** Parse "24 Sep 2026" → Date (null bila format tak dikenal). */
function parseTanggalID(s: string): Date | null {
  const [dd, mon, yyyy] = s.split(" ");
  const idx = BULAN_SINGKAT.indexOf(mon);
  if (!dd || idx < 0 || !yyyy) return null;
  const parsed = new Date(Number(yyyy), idx, Number(dd));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Selisih hari (positif = masih berlaku) dari hari ini. */
function sisaHari(s: string): number | null {
  const d = parseTanggalID(s);
  if (!d) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}

function hitungInitials(nama: string): string {
  return nama.trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
}

const paketBadgeClass: Record<PaketLangganan, string> = {
  Free: "bg-surface-container-high text-on-surface-variant",
  Pro: "bg-primary-container text-on-primary-container",
  Max: "bg-secondary-container text-on-secondary-container",
};

/* QRIS placeholder */
function QrisPlaceholder({ size = 29 }: { size?: number }) {
  // PRNG deterministik (mulberry32) → pola module selalu sama tiap render.
  let seed = 0x51a72026;
  const next = () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const isFinderArea = (x: number, y: number) =>
    (x < 8 && y < 8) || (x >= size - 8 && y < 8) || (x < 8 && y >= size - 8);

  const modules: { x: number; y: number }[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (isFinderArea(x, y)) continue;
      if (next() > 0.52) modules.push({ x, y });
    }
  }

  const finder = (fx: number, fy: number) => (
    <g key={`finder-${fx}-${fy}`} transform={`translate(${fx} ${fy})`}>
      <rect width="7" height="7" fill="#0f172a" />
      <rect x="1" y="1" width="5" height="5" fill="#ffffff" />
      <rect x="2" y="2" width="3" height="3" fill="#0f172a" />
    </g>
  );

  return (
    <svg
      width="180"
      height="180"
      viewBox={`-1 -1 ${size + 2} ${size + 2}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label="Kode QRIS pembayaran langganan"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* QRIS placeholder */}
      <rect x="-1" y="-1" width={size + 2} height={size + 2} fill="#ffffff" />
      {modules.map((m) => (
        <rect key={`m-${m.x}-${m.y}`} x={m.x} y={m.y} width="1" height="1" fill="#0f172a" />
      ))}
      {finder(0, 0)}
      {finder(size - 7, 0)}
      {finder(0, size - 7)}
    </svg>
  );
}

export function PengaturanRT({
  onNavigate,
  pengurus,
  onPengurusChange,
  langganan,
  onLanggananChange,
  onMuatPengaturanIuran,
  onSimpanPengaturanIuran,
  onMuatPengaturanSurat,
  onSimpanPengaturanSurat,
}: PengaturanRTProps) {
  const { flash, toast } = useFlash();
  const [showAddPengurusModal, setShowAddPengurusModal] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [editForm, setEditForm] = useState<{ id: string; nama: string; jabatan: string; status: string } | null>(null);
  const [accessForm, setAccessForm] = useState<{ id: string; role: string; akses: string } | null>(null);
  const [showLanggananModal, setShowLanggananModal] = useState(false);
  const [pilihPaket, setPilihPaket] = useState<PaketLangganan>(langganan.paket);

  const [banner, setBanner] = useState<string | null>(null);
  const [stempel, setStempel] = useState<string | null>(null);

  const [profil, setProfil] = useState({
    namaRT: "Melati Indah",
    nomorRT: tenant.rt,
    nomorRW: tenant.rw,
    alamatLengkap: "Jl. Melati Indah No. 1-68",
    kelurahan: tenant.kelurahan,
    kecamatan: tenant.kecamatan,
    kota: tenant.kota,
  });
  /**
   * Profil RT API-first (kontrak §5.4 pada `GET/PATCH /rt/pengaturan`):
   * hanya `namaRT` + `alamatLengkap` yang persist (baris `rt`); nomor RT/RW
   * dan wilayah adalah identifier turunan → tampil read-only di form.
   * `profilTersimpan` = snapshot server; `profilOffline` = OFFLINE (mode demo).
   */
  const [profilTersimpan, setProfilTersimpan] = useState({ namaRT: "", alamatLengkap: "" });
  const [profilOffline, setProfilOffline] = useState(false);
  const [profilSedangSimpan, setProfilSedangSimpan] = useState(false);

  const [userAccess, setUserAccess] = useState<UserAccess[]>(userAccessDefault);

  const [toggles, setToggles] = useState({
    notifikasiWA: true,
    autoPengingatIuran: true,
    modePemeliharaan: false,
  });
  /**
   * Sakelar "Pengaturan Umum" API-first: `notifikasiWA` ↔ `notifikasiWaEnabled`
   * dan `modePemeliharaan` persist di `pengaturan_rt`. `autoPengingatIuran`
   * BELUM punya endpoint/kolom (belum diimplementasi) → kontrol dinonaktifkan
   * dengan keterangan jujur, bukan toggle yang mengaku tersimpan.
   */
  const [togglesTersimpan, setTogglesTersimpan] = useState({
    notifikasiWA: true,
    modePemeliharaan: false,
  });
  const [pengaturanOffline, setPengaturanOffline] = useState(false);
  const [pengaturanSedangSimpan, setPengaturanSedangSimpan] = useState(false);

  const [newPengurus, setNewPengurus] = useState({ nama: "", jabatan: "" });
  const [inviteEmail, setInviteEmail] = useState("");

  // --- B7 · pengaturan iuran (§6.4.5 · §6.4.10) -----------------------------
  // Nilai awal = default skema server; begitu `GET` berhasil, form diisi ulang
  // dengan nilai tersimpan. `bersih` = OFFLINE (mode demo) — ditandai di UI.
  const PENGATURAN_IURAN_DASAR: PengaturanIuranRt = {
    modeAlokasi: "gabungan",
    tenggatHari: 10,
    dendaAktif: false,
  };
  const [iuran, setIuran] = useState<PengaturanIuranRt>(PENGATURAN_IURAN_DASAR);
  // Snapshot nilai terakhir tersimpan → dipakai mendeteksi "belum ada perubahan".
  const [iuranTersimpan, setIuranTersimpan] = useState<PengaturanIuranRt>(PENGATURAN_IURAN_DASAR);
  const [iuranOffline, setIuranOffline] = useState(false);
  const [iuranDimuat, setIuranDimuat] = useState(false);
  const [iuranSedangSimpan, setIuranSedangSimpan] = useState(false);

  // Muat sekali saat halaman terbuka. React.StrictMode menjalankan efek dua
  // kali → penjaga `batal` membuat hasil permintaan kedua dibuang; efek kedua
  // mengulang GET (idempoten, tanpa efek samping). Handler App tidak dimemoisasi.
  useEffect(() => {
    let batal = false;
    onMuatPengaturanIuran()
      .then((h) => {
        if (batal) return;
        if (h) {
          setIuran(h);
          setIuranTersimpan(h);
          setIuranOffline(false);
        } else {
          setIuranOffline(true);
        }
      })
      .catch(() => {
        // Sesi habis sudah ditangani App; di sini cukup senyap (form tetap default).
      })
      .finally(() => {
        if (!batal) setIuranDimuat(true);
      });
    return () => {
      batal = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const iuranBerubah =
    iuran.modeAlokasi !== iuranTersimpan.modeAlokasi ||
    iuran.tenggatHari !== iuranTersimpan.tenggatHari ||
    iuran.dendaAktif !== iuranTersimpan.dendaAktif;

  /** B7 — simpan pengaturan iuran (PATCH parsial; hanya kirim yang berubah). */
  async function handleSimpanPengaturanIuran(e: React.FormEvent) {
    e.preventDefault();
    if (iuranSedangSimpan) return flash("Permintaan masih diproses — tunggu sebentar.");
    if (!iuranBerubah) return flash("Belum ada perubahan pada pengaturan iuran.");
    if (!Number.isInteger(iuran.tenggatHari) || iuran.tenggatHari < 1 || iuran.tenggatHari > 31) {
      return flash("Tenggat hari harus bilangan bulat 1–31.");
    }
    const patch: Partial<PengaturanIuranRt> = {};
    if (iuran.modeAlokasi !== iuranTersimpan.modeAlokasi) patch.modeAlokasi = iuran.modeAlokasi;
    if (iuran.tenggatHari !== iuranTersimpan.tenggatHari) patch.tenggatHari = iuran.tenggatHari;
    if (iuran.dendaAktif !== iuranTersimpan.dendaAktif) patch.dendaAktif = iuran.dendaAktif;

    setIuranSedangSimpan(true);
    try {
      const sesudah = await onSimpanPengaturanIuran(patch);
      setIuranSedangSimpan(false);
      if (sesudah) {
        setIuran(sesudah);
        setIuranTersimpan(sesudah);
        setIuranOffline(false);
        flash(
          `Pengaturan iuran tersimpan — alokasi ${sesudah.modeAlokasi}, tenggat hari ke-${sesudah.tenggatHari}, denda ${sesudah.dendaAktif ? "aktif" : "nonaktif"}.`
        );
      } else {
        // OFFLINE: server tak terjangkau → nilai lokal tetap berlaku di sesi ini
        // dan TIDAK diklaim tersimpan di server.
        setIuranTersimpan(iuran);
        setIuranOffline(true);
        flash("Mode demo (server tidak terjangkau) — pengaturan iuran hanya berlaku di sesi ini.");
      }
    } catch (err) {
      setIuranSedangSimpan(false);
      return flash(
        err instanceof GalatApi ? err.message : "Pengaturan iuran gagal disimpan — coba lagi."
      );
    }
  }

  // --- B12 · kop surat resmi (§6.6) ------------------------------------------
  // Pola B7: nilai awal = kop bawaan (identik kop hardcoded preview lama, jadi
  // tampilan tidak berubah sebelum RT mengisi), diisi ulang oleh
  // `GET /rt/pengaturan` bila RT pernah menyimpan. `kopOffline` = OFFLINE
  // (mode demo) — ditandai di UI dan perubahan TIDAK diklaim tersimpan server.
  /** Kop bawaan — jadi placeholder pratinjau bila satu baris dikosongkan. */
  const kopBawaan = kopSuratDefault();
  const [kop, setKop] = useState<KopSurat>(kopSuratDefault());
  const [kopTersimpan, setKopTersimpan] = useState<KopSurat>(kopSuratDefault());
  const [kopOffline, setKopOffline] = useState(false);
  const [kopDimuat, setKopDimuat] = useState(false);
  const [kopSedangSimpan, setKopSedangSimpan] = useState(false);

  // Muat sekali saat halaman terbuka — penjaga `batal` sama dengan efek B7 di
  // atas (React.StrictMode menjalankan efek dua kali; GET idempoten).
  // Satu `GET /rt/pengaturan` mengisi tiga blok: kop surat, profil RT, dan
  // sakelar pengaturan umum (kontrak §5.4 "Profil, banner, stempel, notifikasi,
  // mode pemeliharaan") — supaya form tidak pernah memakai nilai lokal yang
  // sebenarnya tidak ada di server.
  useEffect(() => {
    let batal = false;
    onMuatPengaturanSurat()
      .then((h) => {
        if (batal) return;
        if (h) {
          const k = h.kop ?? kopSuratDefault();
          setKop(k);
          setKopTersimpan(k);
          setKopOffline(false);

          // Profil RT — server duluan; nilai kosong ("") mempertahankan isi form.
          const p = {
            ...profil,
            namaRT: h.profil?.namaRt || profil.namaRT,
            alamatLengkap: h.profil?.alamat || profil.alamatLengkap,
          };
          setProfil(p);
          setProfilTersimpan({ namaRT: p.namaRT, alamatLengkap: p.alamatLengkap });
          setProfilOffline(false);

          // Sakelar pengaturan umum (yang punya kolom server).
          const t = {
            notifikasiWA: h.notifikasiWaEnabled,
            autoPengingatIuran: toggles.autoPengingatIuran,
            modePemeliharaan: h.modePemeliharaan,
          };
          setToggles(t);
          setTogglesTersimpan({
            notifikasiWA: t.notifikasiWA,
            modePemeliharaan: t.modePemeliharaan,
          });
          setPengaturanOffline(false);
        } else {
          setKopOffline(true);
          setProfilOffline(true);
          setPengaturanOffline(true);
        }
      })
      .catch(() => {
        // Sesi habis sudah ditangani App; di sini cukup senyap (kop tetap bawaan).
      })
      .finally(() => {
        if (!batal) setKopDimuat(true);
      });
    return () => {
      batal = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const kopBerubah =
    kop.baris1 !== kopTersimpan.baris1 ||
    kop.baris2 !== kopTersimpan.baris2 ||
    kop.baris3 !== kopTersimpan.baris3;

  /** B12 — simpan kop surat (PATCH parsial + CSRF; hanya baris yang berubah). */
  async function handleSimpanKop(e: React.FormEvent) {
    e.preventDefault();
    if (kopSedangSimpan) return flash("Permintaan masih diproses — tunggu sebentar.");
    if (!kopBerubah) return flash("Belum ada perubahan pada kop surat.");
    if (!kop.baris1.trim() || !kop.baris2.trim() || !kop.baris3.trim()) {
      return flash("Ketiga baris kop surat wajib diisi.");
    }
    const patch = {
      kop: {
        baris1: kop.baris1.trim(),
        baris2: kop.baris2.trim(),
        baris3: kop.baris3.trim(),
      },
    };

    setKopSedangSimpan(true);
    try {
      const sesudah = await onSimpanPengaturanSurat(patch);
      setKopSedangSimpan(false);
      if (sesudah) {
        const k = sesudah.kop ?? patch.kop;
        setKop(k);
        setKopTersimpan(k);
        setKopOffline(false);
        flash("Kop surat tersimpan — dipakai pada preview, cetak, dan PDF Surat Pengantar.");
      } else {
        // OFFLINE: server tak terjangkau → nilai lokal berlaku di sesi ini saja.
        setKopTersimpan(kop);
        setKopOffline(true);
        flash("Mode demo (server tidak terjangkau) — kop surat hanya berlaku di sesi ini.");
      }
    } catch (err) {
      setKopSedangSimpan(false);
      return flash(err instanceof GalatApi ? err.message : "Kop surat gagal disimpan — coba lagi.");
    }
  }


  function bacaGambar(
    file: File | null | undefined,
    onDone: (dataUrl: string) => void,
    maksMb = 2
  ) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      flash("File harus berupa gambar (JPG/PNG)");
      return;
    }
    if (file.size > maksMb * 1024 * 1024) {
      flash(`Ukuran gambar maksimal ${maksMb}MB`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => onDone(String(reader.result));
    reader.onerror = () => flash("Gagal membaca file gambar");
    reader.readAsDataURL(file);
  }

  /**
   * Profil RT — API-first `PATCH /rt/pengaturan { profil }` (kontrak §5.4).
   * Hanya `namaRT` + `alamatLengkap` yang dikirim (kolom `perumahan`/`alamat`
   * pada baris `rt`); nomor RT/RW & wilayah turunan tidak ikut dikirim.
   * OFFLINE → nilai lokal berlaku di sesi ini dan TIDAK diklaim tersimpan.
   */
  async function handleSimpanProfil(e: React.FormEvent) {
    e.preventDefault();
    if (profilSedangSimpan) return flash("Permintaan masih diproses — tunggu sebentar.");
    const namaRT = profil.namaRT.trim();
    const alamatLengkap = profil.alamatLengkap.trim();
    if (!namaRT) {
      flash("Nama RT wajib diisi");
      return;
    }
    if (!alamatLengkap) {
      flash("Alamat lengkap wajib diisi");
      return;
    }
    if (namaRT === profilTersimpan.namaRT && alamatLengkap === profilTersimpan.alamatLengkap) {
      return flash("Belum ada perubahan pada profil RT.");
    }

    setProfilSedangSimpan(true);
    try {
      const sesudah = await onSimpanPengaturanSurat({ profil: { namaRt: namaRT, alamat: alamatLengkap } });
      setProfilSedangSimpan(false);
      if (sesudah) {
        const p = {
          ...profil,
          namaRT: sesudah.profil?.namaRt || namaRT,
          alamatLengkap: sesudah.profil?.alamat || alamatLengkap,
        };
        setProfil(p);
        setProfilTersimpan({ namaRT: p.namaRT, alamatLengkap: p.alamatLengkap });
        setProfilOffline(false);
        flash("Profil RT tersimpan — nama & alamat kini dibaca dari server.");
      } else {
        // OFFLINE: server tak terjangkau → nilai lokal berlaku di sesi ini saja.
        setProfilTersimpan({ namaRT, alamatLengkap });
        setProfilOffline(true);
        flash("Mode demo (server tidak terjangkau) — profil RT hanya berlaku di sesi ini, TIDAK tersimpan di server.");
      }
    } catch (err) {
      setProfilSedangSimpan(false);
      return flash(err instanceof GalatApi ? err.message : "Profil RT gagal disimpan — coba lagi.");
    }
  }

  /**
   * Pengaturan umum — API-first `PATCH /rt/pengaturan` (parsial; hanya yang
   * berubah). `autoPengingatIuran` sengaja TIDAK dikirim: sakelarnya dinonaktifkan
   * di UI karena endpoint/kolomnya belum diimplementasi (lihat state `toggles`).
   */
  async function handleSimpanPengaturan(e: React.FormEvent) {
    e.preventDefault();
    if (pengaturanSedangSimpan) return flash("Permintaan masih diproses — tunggu sebentar.");
    const patch: { notifikasiWaEnabled?: boolean; modePemeliharaan?: boolean } = {};
    if (toggles.notifikasiWA !== togglesTersimpan.notifikasiWA) patch.notifikasiWaEnabled = toggles.notifikasiWA;
    if (toggles.modePemeliharaan !== togglesTersimpan.modePemeliharaan) {
      patch.modePemeliharaan = toggles.modePemeliharaan;
    }
    if (Object.keys(patch).length === 0) return flash("Belum ada perubahan pada pengaturan umum.");

    setPengaturanSedangSimpan(true);
    try {
      const sesudah = await onSimpanPengaturanSurat(patch);
      setPengaturanSedangSimpan(false);
      if (sesudah) {
        setToggles((t) => ({
          ...t,
          notifikasiWA: sesudah.notifikasiWaEnabled,
          modePemeliharaan: sesudah.modePemeliharaan,
        }));
        setTogglesTersimpan({
          notifikasiWA: sesudah.notifikasiWaEnabled,
          modePemeliharaan: sesudah.modePemeliharaan,
        });
        setPengaturanOffline(false);
        flash(
          `Pengaturan umum tersimpan — notifikasi WA ${sesudah.notifikasiWaEnabled ? "aktif" : "nonaktif"}, ` +
            `mode pemeliharaan ${sesudah.modePemeliharaan ? "aktif" : "nonaktif"}.`,
        );
      } else {
        // OFFLINE: server tak terjangkau → nilai lokal berlaku di sesi ini saja.
        setTogglesTersimpan({ notifikasiWA: toggles.notifikasiWA, modePemeliharaan: toggles.modePemeliharaan });
        setPengaturanOffline(true);
        flash("Mode demo (server tidak terjangkau) — pengaturan umum hanya berlaku di sesi ini, TIDAK tersimpan di server.");
      }
    } catch (err) {
      setPengaturanSedangSimpan(false);
      return flash(err instanceof GalatApi ? err.message : "Pengaturan umum gagal disimpan — coba lagi.");
    }
  }

  function handleAddPengurus(e: React.FormEvent) {
    e.preventDefault();
    if (!newPengurus.nama.trim() || !newPengurus.jabatan) {
      flash("Nama lengkap dan jabatan wajib diisi");
      return;
    }
    const nama = newPengurus.nama.trim();
    const colors = [
      { bg: "bg-primary-container", text: "text-on-primary-container" },
      { bg: "bg-secondary-container", text: "text-on-secondary-container" },
      { bg: "bg-tertiary-container", text: "text-on-tertiary-container" },
    ];
    const color = colors[pengurus.length % colors.length];
    onPengurusChange([
      ...pengurus,
      { id: `p${Date.now()}`, nama, jabatan: newPengurus.jabatan, status: "active", initials: hitungInitials(nama), bgColor: color.bg, textColor: color.text },
    ]);
    setNewPengurus({ nama: "", jabatan: "" });
    setShowAddPengurusModal(false);
    flash(`Pengurus ${nama} ditambahkan (sesi ini — belum tersimpan di server).`);
  }

  function openEditPengurus(p: Pengurus) {
    setEditForm({ id: p.id, nama: p.nama, jabatan: p.jabatan, status: p.status });
  }

  function handleSimpanEditPengurus(e: React.FormEvent) {
    e.preventDefault();
    if (!editForm) return;
    if (!editForm.nama.trim()) {
      flash("Nama lengkap wajib diisi");
      return;
    }
    const nama = editForm.nama.trim();
    onPengurusChange(
      pengurus.map((p) =>
        p.id === editForm.id
          ? { ...p, nama, jabatan: editForm.jabatan, status: editForm.status, initials: hitungInitials(nama) }
          : p
      )
    );
    setEditForm(null);
    flash("Data pengurus diperbarui (sesi ini — belum tersimpan di server).");
  }

  function handleRemovePengurus(id: string) {
    const target = pengurus.find((p) => p.id === id);
    onPengurusChange(pengurus.filter((p) => p.id !== id));
    flash(`Pengurus ${target?.nama ?? ""} dihapus dari daftar sesi ini (belum tersimpan di server).`.replace("  ", " "));
  }

  function handleUploadTtd(id: string, file: File | null | undefined) {
    bacaGambar(file, (dataUrl) => {
      onPengurusChange(pengurus.map((p) => (p.id === id ? { ...p, ttd: dataUrl } : p)));
      flash("TTD digital siap dipakai di sesi ini (belum tersimpan di server).");
    });
  }

  function handleRemoveTtd(id: string) {
    onPengurusChange(pengurus.map((p) => (p.id === id ? { ...p, ttd: undefined } : p)));
    flash("TTD digital dihapus dari sesi ini (belum tersimpan di server).");
  }

  function openAturAkses(u: UserAccess) {
    setAccessForm({ id: u.id, role: u.role, akses: u.akses });
  }

  function handleSimpanAkses(e: React.FormEvent) {
    e.preventDefault();
    if (!accessForm) return;
    setUserAccess((prev) =>
      prev.map((u) => (u.id === accessForm.id ? { ...u, role: accessForm.role, akses: accessForm.akses } : u))
    );
    setAccessForm(null);
    flash("Hak akses diperbarui (sesi ini — belum tersimpan di server).");
  }

  function handleRevokeAccess(id: string) {
    setUserAccess((prev) => prev.filter((u) => u.id !== id));
    flash("Akses pengguna dicabut (sesi ini — belum tersimpan di server).");
  }

  function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteEmail) {
      flash("Email undangan wajib diisi");
      return;
    }
    flash(`Undangan untuk ${inviteEmail} hanya dicatat di sesi ini — TIDAK dikirim dan belum tersimpan di server.`);
    setInviteEmail("");
    setShowInviteModal(false);
  }

  function openLanggananModal() {
    setPilihPaket(langganan.paket);
    setShowLanggananModal(true);
  }

  function handleSayaSudahBayar() {
    const mulai = formatTanggalID(new Date());
    const akhir = new Date();
    akhir.setFullYear(akhir.getFullYear() + 1);
    const aktifSampai = formatTanggalID(akhir);
    onLanggananChange({ paket: pilihPaket, mulai, aktifSampai });
    setShowLanggananModal(false);
    flash(`Perpanjangan dicatat di sesi ini — paket ${pilihPaket} s/d ${aktifSampai} (belum tersimpan di server).`);
  }

  const infoPaket = paketInfo[langganan.paket];
  const sisa = sisaHari(langganan.aktifSampai);
  const infoPilih = paketInfo[pilihPaket];

  return (
    <div className="max-w-7xl mx-auto w-full space-y-6">
      {toast}

      <div className="flex items-center gap-1.5 text-sm text-on-surface-variant">
        <button type="button" className="hover:text-primary transition-colors flex items-center gap-1" onClick={() => onNavigate?.("dashboard-rt")}><span className="material-symbols-outlined text-[16px]">home</span>
          Portal RT
        </button>
        <span className="material-symbols-outlined text-[14px]">chevron_right</span>
        <span className="font-bold text-on-surface">Pengaturan</span>
      </div>

      <div className="max-w-3xl space-y-1.5">
        <div className="inline-flex items-center gap-1.5 text-primary text-sm font-bold uppercase tracking-wider">
          <span className="material-symbols-outlined text-[16px]">settings</span>
          Pengaturan & Konfigurasi
        </div>
        <h1 className="text-2xl lg:text-[32px] text-on-surface tracking-tight font-extrabold">
          Pengaturan {tenant.label}
        </h1>
      </div>

      <section className="bg-surface-container-lowest rounded-xl p-6 shadow-sm">
        <div className="flex items-center justify-between pb-4 mb-4 border-b border-surface-container-high">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary-container flex items-center justify-center text-on-primary-container">
              <span className="material-symbols-outlined text-[22px]">business</span>
            </div>
            <div>
              <h2 className="text-lg font-bold text-on-surface">Profil RT</h2>
              <p className="text-xs text-on-surface-variant mt-0.5">
                Nama &amp; alamat disimpan di server (§5.4); nomor RT/RW &amp; wilayah hanya tampil dari data induk.
              </p>
            </div>
          </div>
          {profilOffline && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-error-container/40 text-on-error-container text-[11px] font-bold uppercase tracking-wider">
              <span className="material-symbols-outlined text-[13px]">cloud_off</span>
              Mode demo — belum tersimpan di server
            </span>
          )}
        </div>
        <form onSubmit={handleSimpanProfil} className="flex flex-col gap-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold text-on-surface flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[16px] text-on-surface-variant">badge</span>
                Nama RT
              </label>
              <input
                className="w-full h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all disabled:text-on-surface-variant"
                value={profil.namaRT}
                onChange={(e) => setProfil({ ...profil, namaRT: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[16px] text-on-surface-variant">tag</span>
                  Nomor RT
                </label>
                <input
                  className="w-full h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface-variant cursor-not-allowed"
                  value={profil.nomorRT}
                  disabled
                  title="Identifier wilayah — tidak dapat diubah dari halaman ini."
                  readOnly
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[16px] text-on-surface-variant">tag</span>
                  Nomor RW
                </label>
                <input
                  className="w-full h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface-variant cursor-not-allowed"
                  value={profil.nomorRW}
                  disabled
                  title="Identifier wilayah — tidak dapat diubah dari halaman ini."
                  readOnly
                />
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-on-surface flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px] text-on-surface-variant">home</span>
              Alamat Lengkap
            </label>
            <input
              className="w-full h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all"
              value={profil.alamatLengkap}
              onChange={(e) => setProfil({ ...profil, alamatLengkap: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold text-on-surface">Kelurahan</label>
              <input
                className="w-full h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface-variant cursor-not-allowed"
                value={profil.kelurahan}
                disabled
                title="Berasal dari data wilayah (kelurahan) — tidak dapat diubah dari halaman ini."
                readOnly
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold text-on-surface">Kecamatan</label>
              <input
                className="w-full h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface-variant cursor-not-allowed"
                value={profil.kecamatan}
                disabled
                title="Berasal dari data wilayah (kelurahan) — tidak dapat diubah dari halaman ini."
                readOnly
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold text-on-surface">Kota</label>
              <input
                className="w-full h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface-variant cursor-not-allowed"
                value={profil.kota}
                disabled
                title="Berasal dari data wilayah (kelurahan) — tidak dapat diubah dari halaman ini."
                readOnly
              />
            </div>
          </div>
          <p className="text-[11px] text-on-surface-variant -mt-1">
            Hanya Nama RT &amp; Alamat Lengkap yang dikirim ke server — kolom sisanya identifier wilayah, tampil read-only.
          </p>
          <div className="flex flex-wrap justify-end gap-3 pt-2 border-t border-surface-container-high">
            <button
              type="submit"
              disabled={profilSedangSimpan}
              className="h-11 px-6 rounded-xl bg-primary text-on-primary text-sm font-bold shadow-md hover:bg-primary-container active:scale-[0.98] transition-all flex items-center gap-2 disabled:opacity-60"
            >
              <span className="material-symbols-outlined text-[18px]">save</span>
              {profilSedangSimpan ? "Menyimpan…" : "Simpan Profil"}
            </button>
          </div>
        </form>
      </section>

      <section className="bg-surface-container-lowest rounded-xl p-6 shadow-sm">
        <div className="flex items-center justify-between pb-4 mb-4 border-b border-surface-container-high">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-secondary-container flex items-center justify-center text-on-secondary-container">
              <span className="material-symbols-outlined text-[22px]">image</span>
            </div>
            <div>
              <h2 className="text-lg font-bold text-on-surface">Banner & Stempel</h2>
              <p className="text-xs text-on-surface-variant mt-0.5">Identitas visual {tenant.rtFull}</p>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div>
            <h3 className="text-sm font-bold text-on-surface mb-3">Banner RT</h3>
            {banner ? (
              <div className="space-y-2">
                <div className="aspect-[3/1] rounded-xl overflow-hidden border border-surface-container-high bg-surface-container-low">
                  <img src={banner} alt="Banner RT" className="w-full h-full object-cover" />
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <label
                    htmlFor="input-banner"
                    className="h-8 px-3 rounded-lg bg-surface-container text-on-surface-variant hover:text-primary hover:bg-surface-container-high text-xs font-semibold inline-flex items-center gap-1 transition-colors cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[14px]">photo_camera</span>
                    Ganti
                  </label>
                  <button
                    type="button"
                    className="h-8 px-3 rounded-lg bg-error-container/20 text-error hover:bg-error-container/40 text-xs font-semibold inline-flex items-center gap-1 transition-colors"
                    onClick={() => { setBanner(null); flash("Banner RT dihapus dari sesi ini (belum tersimpan di server)."); }}
                  >
                    <span className="material-symbols-outlined text-[14px]">delete</span>
                    Hapus
                  </button>
                </div>
              </div>
            ) : (
              <label
                htmlFor="input-banner"
                className="aspect-[3/1] rounded-xl bg-surface-container-low border-2 border-dashed border-outline-variant flex flex-col items-center justify-center cursor-pointer hover:border-primary transition-colors"
              >
                <span className="material-symbols-outlined text-primary text-[36px]">add_photo_alternate</span>
                <span className="text-xs text-on-surface-variant mt-1">Upload Banner (1200 x 400 px)</span>
              </label>
            )}
            <input
              hidden
              id="input-banner"
              type="file"
              accept="image/*"
              onChange={(e) =>
                bacaGambar(e.target.files?.[0], (d) => { setBanner(d); flash("Banner RT dipakai di sesi ini (belum tersimpan di server)."); })
              }
            />
            <p className="text-[11px] text-on-surface-variant mt-2">Rekomendasi: 1200 x 400 px. Format JPG, PNG. Maks 2MB.</p>
          </div>
          <div>
            <h3 className="text-sm font-bold text-on-surface mb-3">Stempel RT</h3>
            {stempel ? (
              <div className="space-y-3">
                <div className="w-40 h-40 mx-auto rounded-full overflow-hidden border border-surface-container-high bg-white">
                  <img src={stempel} alt="Stempel RT" className="w-full h-full object-contain" />
                </div>
                <div className="flex flex-wrap justify-center gap-2">
                  <label
                    htmlFor="input-stempel"
                    className="h-8 px-3 rounded-lg bg-surface-container text-on-surface-variant hover:text-primary hover:bg-surface-container-high text-xs font-semibold inline-flex items-center gap-1 transition-colors cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[14px]">photo_camera</span>
                    Ganti
                  </label>
                  <button
                    type="button"
                    className="h-8 px-3 rounded-lg bg-error-container/20 text-error hover:bg-error-container/40 text-xs font-semibold inline-flex items-center gap-1 transition-colors"
                    onClick={() => { setStempel(null); flash("Stempel RT dihapus dari sesi ini (belum tersimpan di server)."); }}
                  >
                    <span className="material-symbols-outlined text-[14px]">delete</span>
                    Hapus
                  </button>
                </div>
              </div>
            ) : (
              <label
                htmlFor="input-stempel"
                className="w-40 h-40 mx-auto rounded-full bg-surface-container-low border-2 border-dashed border-outline-variant flex flex-col items-center justify-center cursor-pointer hover:border-primary transition-colors"
              >
                <span className="material-symbols-outlined text-primary text-[36px]">add_a_photo</span>
                <span className="text-[11px] text-on-surface-variant mt-1 text-center px-2">Upload Stempel<br />(200 x 200 px)</span>
              </label>
            )}
            <input
              hidden
              id="input-stempel"
              type="file"
              accept="image/*"
              onChange={(e) =>
                bacaGambar(e.target.files?.[0], (d) => { setStempel(d); flash("Stempel RT dipakai di sesi ini (belum tersimpan di server)."); })
              }
            />
            <p className="text-[11px] text-on-surface-variant mt-2">Format lingkaran. Rekomendasi 200 x 200 px. Format PNG transparan.</p>
          </div>
        </div>
      </section>

      <section className="bg-surface-container-lowest rounded-xl p-6 shadow-sm">
        <div className="flex items-center justify-between pb-4 mb-4 border-b border-surface-container-high">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-tertiary-container flex items-center justify-center text-on-tertiary-container">
              <span className="material-symbols-outlined text-[22px]">group</span>
            </div>
            <div>
              <h2 className="text-lg font-bold text-on-surface">Pengurus RT</h2>
              <p className="text-xs text-on-surface-variant mt-0.5">Daftar pengurus aktif {tenant.rtFull}</p>
            </div>
          </div>
          <button
            className="h-10 px-4 rounded-xl bg-primary text-on-primary text-xs font-bold shadow-md hover:bg-primary-container active:scale-[0.98] transition-all flex items-center gap-1.5 flex-wrap"
            onClick={() => setShowAddPengurusModal(true)}
          >
            <span className="material-symbols-outlined text-[16px]">person_add</span>
            + Tambah Pengurus
          </button>
        </div>
        <div className="space-y-3">
          {pengurus.length === 0 && (
            <div className="p-6 rounded-xl bg-surface-container-low text-center text-sm text-on-surface-variant">
              Belum ada pengurus. Klik <span className="font-bold text-on-surface">+ Tambah Pengurus</span> untuk menambahkan.
            </div>
          )}
          {pengurus.map((p) => (
            <div key={p.id} className="p-4 rounded-xl bg-surface-container-low flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex items-center gap-3 min-w-0">
                <div className={`w-11 h-11 rounded-full ${p.bgColor} ${p.textColor} flex items-center justify-center font-bold text-sm shrink-0`}>
                  {p.initials}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-bold text-on-surface truncate">{p.nama}</div>
                  <div className="text-xs text-on-surface-variant">{p.jabatan}</div>
                </div>
              </div>
              <div className="flex flex-col gap-2 xl:items-end">
                <div className="flex flex-wrap items-center gap-2">
                  {p.ttd ? (
                    <>
                      <img
                        src={p.ttd}
                        alt={`TTD ${p.nama}`}
                        className="h-8 object-contain bg-white rounded-lg border border-surface-container-high px-1.5"
                      />
                      <button
                        type="button"
                        className="h-8 px-3 rounded-lg bg-error-container/20 text-error hover:bg-error-container/40 text-xs font-semibold inline-flex items-center gap-1 transition-colors"
                        onClick={() => handleRemoveTtd(p.id)}
                      >
                        <span className="material-symbols-outlined text-[14px]">draw</span>
                        Hapus TTD
                      </button>
                    </>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-surface-container border border-outline-variant text-on-surface-variant text-[11px] font-bold">
                      <span className="material-symbols-outlined text-[13px]">draw</span>
                      Belum ada TTD
                    </span>
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    hidden
                    id={`ttd-${p.id}`}
                    onChange={(e) => handleUploadTtd(p.id, e.target.files?.[0])}
                  />
                  <label
                    htmlFor={`ttd-${p.id}`}
                    className="h-8 px-3 rounded-lg bg-primary-container text-on-primary-container hover:bg-primary hover:text-on-primary text-xs font-semibold inline-flex items-center gap-1 transition-colors cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[14px]">draw</span>
                    Unggah TTD
                  </label>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold ${
                      p.status === "active"
                        ? "bg-secondary-container text-on-secondary-container"
                        : "bg-error-container text-on-error-container"
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${p.status === "active" ? "bg-secondary" : "bg-error"}`} />
                    {p.status === "active" ? "Active" : "Nonaktif"}
                  </span>
                  <button
                    type="button"
                    className="h-8 px-3 rounded-lg bg-surface-container text-on-surface-variant hover:text-primary hover:bg-surface-container-high text-xs font-semibold inline-flex items-center gap-1 transition-colors"
                    onClick={() => openEditPengurus(p)}
                  >
                    <span className="material-symbols-outlined text-[14px]">edit</span>
                    Edit
                  </button>
                  <button
                    type="button"
                    className="h-8 px-3 rounded-lg bg-error-container/20 text-error hover:bg-error-container/40 text-xs font-semibold inline-flex items-center gap-1 transition-colors"
                    onClick={() => handleRemovePengurus(p.id)}
                  >
                    <span className="material-symbols-outlined text-[14px]">delete</span>
                    Hapus
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-surface-container-lowest rounded-xl p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 mb-4 border-b border-surface-container-high">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-secondary-container flex items-center justify-center text-on-secondary-container">
              <span className="material-symbols-outlined text-[22px]">workspace_premium</span>
            </div>
            <div>
              <h2 className="text-lg font-bold text-on-surface">Langganan & Lisensi</h2>
              <p className="text-xs text-on-surface-variant mt-0.5">Masa aktif lisensi portal {tenant.rtFull}</p>
            </div>
          </div>
          <button
            type="button"
            className="h-10 px-4 rounded-xl bg-primary text-on-primary text-xs font-bold shadow-md hover:bg-primary-container active:scale-[0.98] transition-all flex items-center gap-1.5"
            onClick={openLanggananModal}
          >
            <span className="material-symbols-outlined text-[16px]">qr_code_2</span>
            Perpanjang Berlangganan
          </button>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="p-4 rounded-xl bg-surface-container-low flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-extrabold uppercase tracking-wider ${paketBadgeClass[langganan.paket]}`}>
                <span className="material-symbols-outlined text-[15px]">verified</span>
                {langganan.paket}
              </span>
              <span className="text-xs text-on-surface-variant font-mono">
                {formatRupiah(infoPaket.harga)} / {infoPaket.per}
              </span>
            </div>
            <div className="text-sm text-on-surface">
              <span className="font-bold">Berlaku:</span> {langganan.mulai} – {langganan.aktifSampai}
            </div>
            {sisa !== null && (
              sisa < 0 ? (
                <span className="inline-flex w-fit items-center gap-1 px-2.5 py-1 rounded-full bg-error-container text-on-error-container text-[11px] font-bold">
                  <span className="material-symbols-outlined text-[13px]">error</span>
                  Kedaluwarsa
                </span>
              ) : (
                <span className="inline-flex w-fit items-center gap-1 px-2.5 py-1 rounded-full bg-primary-container text-on-primary-container text-[11px] font-bold">
                  <span className="material-symbols-outlined text-[13px]">schedule</span>
                  {sisa === 0 ? "Berakhir hari ini" : `Sisa ${sisa} hari`}
                </span>
              )
            )}
            <p className="text-[11px] text-on-surface-variant">
              Nomor lisensi: <span className="font-mono">LIC-{langganan.paket.toUpperCase()}-{tenant.rt}{tenant.rw}</span>
            </p>
          </div>
          <div>
            <h3 className="text-sm font-bold text-on-surface mb-3">Fitur Paket {langganan.paket}</h3>
            <ul className="space-y-2">
              {infoPaket.fitur.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm text-on-surface">
                  <span className="material-symbols-outlined text-secondary text-[18px] mt-0.5">check_circle</span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="bg-surface-container-lowest rounded-xl p-6 shadow-sm">
        <div className="flex items-center justify-between pb-4 mb-4 border-b border-surface-container-high">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary-container flex items-center justify-center text-on-primary-container">
              <span className="material-symbols-outlined text-[22px]">tune</span>
            </div>
            <div>
              <h2 className="text-lg font-bold text-on-surface">Pengaturan Umum</h2>
              <p className="text-xs text-on-surface-variant mt-0.5">Konfigurasi notifikasi dan pemeliharaan</p>
            </div>
          </div>
          {pengaturanOffline && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-error-container/40 text-on-error-container text-[11px] font-bold uppercase tracking-wider">
              <span className="material-symbols-outlined text-[13px]">cloud_off</span>
              Mode demo — belum tersimpan di server
            </span>
          )}
        </div>
        <form onSubmit={handleSimpanPengaturan} className="flex flex-col gap-4">
          <div className="flex items-center justify-between p-4 rounded-xl bg-surface-container-low gap-4">
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined text-secondary text-[22px]">chat</span>
              <div>
                <div className="text-sm font-bold text-on-surface">Aktifkan Notifikasi WhatsApp</div>
                <div className="text-xs text-on-surface-variant">Kirim notifikasi otomatis ke warga via WhatsApp</div>
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={toggles.notifikasiWA}
                onChange={(e) => setToggles({ ...toggles, notifikasiWA: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-surface-container-high peer-focus:ring-2 peer-focus:ring-primary rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-on-surface-variant after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary peer-checked:after:bg-on-primary" />
            </label>
          </div>

          <div className="flex items-center justify-between p-4 rounded-xl bg-surface-container-low gap-4">
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined text-tertiary text-[22px]">notifications_active</span>
              <div>
                <div className="text-sm font-bold text-on-surface flex items-center gap-2">
                  Auto-kirim Pengingat Iuran
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-surface-container-high text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">
                    Belum tersedia
                  </span>
                </div>
                <div className="text-xs text-on-surface-variant">
                  Kirim pengingat otomatis H-3 jatuh tempo iuran — endpoint &amp; kolomnya belum diimplementasi, jadi sakelar
                  dinonaktifkan (tidak diklaim tersimpan).
                </div>
              </div>
            </div>
            <label className="relative inline-flex items-center shrink-0 opacity-50 cursor-not-allowed">
              <input
                type="checkbox"
                checked={toggles.autoPengingatIuran}
                disabled
                readOnly
                title="Fitur belum diimplementasi — perubahan sakelar ini tidak dapat disimpan."
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-surface-container-high rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-on-surface-variant after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary peer-checked:after:bg-on-primary" />
            </label>
          </div>

          <div className="flex items-center justify-between p-4 rounded-xl bg-surface-container-low gap-4">
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined text-error text-[22px]">build</span>
              <div>
                <div className="text-sm font-bold text-on-surface">Mode Pemeliharaan</div>
                <div className="text-xs text-on-surface-variant">Nonaktifkan akses warga sementara untuk pemeliharaan sistem</div>
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={toggles.modePemeliharaan}
                onChange={(e) => setToggles({ ...toggles, modePemeliharaan: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-surface-container-high peer-focus:ring-2 peer-focus:ring-primary rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-on-surface-variant after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary peer-checked:after:bg-on-primary" />
            </label>
          </div>

          <div className="flex flex-wrap justify-end gap-3 pt-2 border-t border-surface-container-high">
            <button
              type="submit"
              disabled={pengaturanSedangSimpan}
              className="h-11 px-6 rounded-xl bg-primary text-on-primary text-sm font-bold shadow-md hover:bg-primary-container active:scale-[0.98] transition-all flex items-center gap-2 disabled:opacity-60"
            >
              <span className="material-symbols-outlined text-[18px]">save</span>
              {pengaturanSedangSimpan ? "Menyimpan…" : "Simpan Pengaturan"}
            </button>
          </div>
        </form>
      </section>

      {/* B7 · Pengaturan iuran — satu-satunya sumber mode alokasi / tenggat / denda */}
      <section className="bg-surface-container-lowest rounded-xl p-6 shadow-sm">
        <div className="flex items-center justify-between pb-4 mb-4 border-b border-surface-container-high">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-secondary-container flex items-center justify-center text-on-secondary-container">
              <span className="material-symbols-outlined text-[22px]">request_quote</span>
            </div>
            <div>
              <h2 className="text-lg font-bold text-on-surface">Pengaturan Iuran</h2>
              <p className="text-xs text-on-surface-variant mt-0.5">
                Mode alokasi kas, tenggat bayar, dan denda (PRD §6.4.5 · §6.4.10)
              </p>
            </div>
          </div>
          {iuranOffline && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-error-container/40 text-on-error-container text-[11px] font-bold uppercase tracking-wider">
              <span className="material-symbols-outlined text-[13px]">cloud_off</span>
              Mode demo — belum tersimpan di server
            </span>
          )}
        </div>

        <form onSubmit={handleSimpanPengaturanIuran} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <span className="text-xs font-bold text-on-surface uppercase tracking-wider">
              Mode alokasi kas
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {(
                [
                  {
                    nilai: "gabungan",
                    judul: "Gabungan",
                    ikon: "savings",
                    teks: "Seluruh iuran masuk ke satu kas RT — sederhana untuk RT kecil.",
                  },
                  {
                    nilai: "terpisah",
                    judul: "Terpisah",
                    ikon: "account_balance_wallet",
                    teks: "Tiap kategori dialokasikan ke kas/tujuan sendiri — wajib memilih kategori tujuan saat verifikasi pembayaran.",
                  },
                ] as const
              ).map((opsi) => (
                <label
                  key={opsi.nilai}
                  className={`p-4 rounded-xl border cursor-pointer transition-colors flex items-start gap-3 ${
                    iuran.modeAlokasi === opsi.nilai
                      ? "border-primary bg-primary-container/40"
                      : "border-surface-container-high bg-surface-container-low hover:border-outline-variant"
                  }`}
                >
                  <input
                    type="radio"
                    name="modeAlokasi"
                    value={opsi.nilai}
                    checked={iuran.modeAlokasi === opsi.nilai}
                    onChange={() => setIuran({ ...iuran, modeAlokasi: opsi.nilai })}
                    className="text-primary focus:ring-primary mt-0.5"
                  />
                  <span className="flex-1">
                    <span className="flex items-center gap-1.5 text-sm font-bold text-on-surface">
                      <span className="material-symbols-outlined text-[16px] text-primary">
                        {opsi.ikon}
                      </span>
                      {opsi.judul}
                    </span>
                    <span className="block text-xs text-on-surface-variant leading-relaxed mt-1">
                      {opsi.teks}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="tenggat-hari-iuran"
                className="text-xs font-bold text-on-surface flex items-center gap-1.5"
              >
                <span className="material-symbols-outlined text-[16px] text-on-surface-variant">
                  event
                </span>
                Tenggat bayar (hari ke-)
              </label>
              <input
                id="tenggat-hari-iuran"
                className="w-full h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface font-mono focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all"
                type="number"
                min={1}
                max={31}
                step={1}
                value={iuran.tenggatHari}
                onChange={(e) =>
                  setIuran({ ...iuran, tenggatHari: Number(e.target.value) })
                }
              />
              <span className="text-[11px] text-on-surface-variant leading-relaxed">
                Jatuh tempo otomatis hari ke-{iuran.tenggatHari} tiap bulan (1–31); melewati
                batas bulan dimajukan ke hari terakhir.
              </span>
            </div>

            <div className="flex items-start justify-between p-4 rounded-xl bg-surface-container-low gap-4">
              <div className="flex items-center gap-3">
                <span className="material-symbols-outlined text-error text-[22px]">gavel</span>
                <div>
                  <div className="text-sm font-bold text-on-surface">Denda Keterlambatan</div>
                  <div className="text-xs text-on-surface-variant">
                    Kenakan denda pada tagihan yang lewat tenggat
                  </div>
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  aria-label="Denda keterlambatan"
                  checked={iuran.dendaAktif}
                  onChange={(e) => setIuran({ ...iuran, dendaAktif: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-surface-container-high peer-focus:ring-2 peer-focus:ring-primary rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-on-surface-variant after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary peer-checked:after:bg-on-primary" />
              </label>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-surface-container-high">
            <span className="text-[11px] text-on-surface-variant">
              {iuranDimuat
                ? iuranBerubah
                  ? "Ada perubahan yang belum disimpan."
                  : "Semua perubahan sudah tersimpan."
                : "Memuat pengaturan iuran…"}
            </span>
            <button
              type="submit"
              disabled={iuranSedangSimpan || !iuranDimuat || !iuranBerubah}
              className="h-11 px-6 rounded-xl bg-primary text-on-primary text-sm font-bold shadow-md hover:bg-primary-container active:scale-[0.98] transition-all flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed disabled:active:scale-100"
            >
              <span className="material-symbols-outlined text-[18px]">
                {iuranSedangSimpan ? "progress_activity" : "save"}
              </span>
              {iuranSedangSimpan ? "Menyimpan…" : "Simpan Pengaturan Iuran"}
            </button>
          </div>
        </form>
      </section>

      {/* B12 · Kop surat resmi — tiga baris kop pada preview, cetak & PDF surat */}
      <section className="bg-surface-container-lowest rounded-xl p-6 shadow-sm">
        <div className="flex items-center justify-between pb-4 mb-4 border-b border-surface-container-high">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary-container flex items-center justify-center text-on-primary-container">
              <span className="material-symbols-outlined text-[22px]">article</span>
            </div>
            <div>
              <h2 className="text-lg font-bold text-on-surface">Kop Surat</h2>
              <p className="text-xs text-on-surface-variant mt-0.5">
                Tiga baris kop resmi pada Surat Pengantar (PRD §6.6)
              </p>
            </div>
          </div>
          {kopOffline && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-error-container/40 text-on-error-container text-[11px] font-bold uppercase tracking-wider">
              <span className="material-symbols-outlined text-[13px]">cloud_off</span>
              Mode demo — belum tersimpan di server
            </span>
          )}
        </div>

        <form onSubmit={handleSimpanKop} className="flex flex-col gap-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="flex flex-col gap-4">
              {(
                [
                  {
                    key: "baris1" as const,
                    label: "Baris 1 — instansi",
                    contoh: "PEMERINTAH PROVINSI DKI JAKARTA",
                    teks: "Baris terbesar; otomatis mengecil bila teksnya panjang.",
                  },
                  {
                    key: "baris2" as const,
                    label: "Baris 2 — kelurahan & kecamatan",
                    contoh: `KELURAHAN ${tenant.kelurahan.toUpperCase()} — KEC. ${tenant.kecamatan.toUpperCase()}`,
                    teks: "Wilayah administrasi tempat RT berada.",
                  },
                  {
                    key: "baris3" as const,
                    label: "Baris 3 — RT, RW & perumahan",
                    contoh: `${tenant.rtFull} ${tenant.rwFull} — ${tenant.perumahan}`,
                    teks: "Identitas lingkungan yang menerbitkan surat.",
                  },
                ] as const
              ).map((baris) => (
                <div key={baris.key} className="flex flex-col gap-1.5">
                  <label
                    htmlFor={`kop-${baris.key}`}
                    className="text-xs font-bold text-on-surface flex items-center gap-1.5"
                  >
                    <span className="material-symbols-outlined text-[16px] text-on-surface-variant">
                      drag_indicator
                    </span>
                    {baris.label}
                  </label>
                  <input
                    id={`kop-${baris.key}`}
                    className="w-full h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all"
                    value={kop[baris.key]}
                    placeholder={baris.contoh}
                    onChange={(e) => setKop({ ...kop, [baris.key]: e.target.value })}
                  />
                  <span className="text-[11px] text-on-surface-variant leading-relaxed">
                    {baris.teks}
                  </span>
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-xs font-bold text-on-surface uppercase tracking-wider">
                Pratinjau kop
              </span>
              <div className="rounded-xl border-2 border-on-surface/60 p-5 text-center bg-surface-container-lowest">
                <div className="text-sm font-extrabold tracking-wide text-on-surface">
                  {kop.baris1 || kopBawaan.baris1}
                </div>
                <div className="text-xs font-semibold text-on-surface mt-1">
                  {kop.baris2 || kopBawaan.baris2}
                </div>
                <div className="text-sm font-bold text-on-surface mt-1">
                  {kop.baris3 || kopBawaan.baris3}
                </div>
                <div className="mt-3 pt-3 border-t-2 border-on-surface">
                  <h4 className="text-lg font-extrabold tracking-widest text-on-surface underline">
                    SURAT PENGANTAR
                  </h4>
                  <div className="text-xs font-mono text-on-surface-variant mt-1">
                    Nomor: 000/{tenant.rt}/{String(new Date().getFullYear()).slice(-2)}
                  </div>
                </div>
              </div>
              <p className="text-[11px] text-on-surface-variant leading-relaxed">
                Kop yang sama dipakai pada preview Surat Pengantar dan PDF yang diunduh warga.
                Kosongkan satu baris untuk memakai teks bawaan sementara.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-surface-container-high">
            <span className="text-[11px] text-on-surface-variant">
              {kopDimuat
                ? kopBerubah
                  ? "Ada perubahan yang belum disimpan."
                  : "Semua perubahan sudah tersimpan."
                : "Memuat kop surat…"}
            </span>
            <button
              type="submit"
              disabled={kopSedangSimpan || !kopDimuat || !kopBerubah}
              className="h-11 px-6 rounded-xl bg-primary text-on-primary text-sm font-bold shadow-md hover:bg-primary-container active:scale-[0.98] transition-all flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed disabled:active:scale-100"
            >
              <span className="material-symbols-outlined text-[18px]">
                {kopSedangSimpan ? "progress_activity" : "save"}
              </span>
              {kopSedangSimpan ? "Menyimpan…" : "Simpan Kop Surat"}
            </button>
          </div>
        </form>
      </section>

      <section className="bg-surface-container-lowest rounded-xl p-6 shadow-sm">
        <div className="flex items-center justify-between pb-4 mb-4 border-b border-surface-container-high">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-error-container/30 flex items-center justify-center text-error">
              <span className="material-symbols-outlined text-[22px]">lock</span>
            </div>
            <div>
              <h2 className="text-lg font-bold text-on-surface">Keamanan & Akses</h2>
              <p className="text-xs text-on-surface-variant mt-0.5">Kelola hak akses pengguna sistem</p>
            </div>
          </div>
          <button
            className="h-10 px-4 rounded-xl bg-primary text-on-primary text-xs font-bold shadow-md hover:bg-primary-container active:scale-[0.98] transition-all flex items-center gap-1.5 flex-wrap"
            onClick={() => setShowInviteModal(true)}
          >
            <span className="material-symbols-outlined text-[16px]">mail</span>
            + Undang Pengurus
          </button>
        </div>
        <div className="space-y-3">
          {userAccess.length === 0 && (
            <div className="p-6 rounded-xl bg-surface-container-low text-center text-sm text-on-surface-variant">
              Semua akses telah dicabut. Klik <span className="font-bold text-on-surface">+ Undang Pengurus</span> untuk mengundang kembali.
            </div>
          )}
          {userAccess.map((u) => (
            <div key={u.id} className="p-4 rounded-xl bg-surface-container-low flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-11 h-11 rounded-full ${u.bgColor} ${u.textColor} flex items-center justify-center font-bold text-sm`}>
                  {u.initials}
                </div>
                <div>
                  <div className="text-sm font-bold text-on-surface">{u.nama}</div>
                  <div className="text-xs text-on-surface-variant">{u.role}</div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary-container text-on-primary-container text-[11px] font-bold">
                  <span className="material-symbols-outlined text-[12px]">vpn_key</span>
                  {u.akses}
                </span>
                <button
                  type="button"
                  className="h-8 px-3 rounded-lg bg-surface-container text-on-surface-variant hover:text-primary hover:bg-surface-container-high text-xs font-semibold inline-flex items-center gap-1 transition-colors"
                  onClick={() => openAturAkses(u)}
                >
                  <span className="material-symbols-outlined text-[14px]">admin_panel_settings</span>
                  Atur Akses
                </button>
                <button
                  type="button"
                  className="h-8 px-3 rounded-lg bg-error-container/20 text-error hover:bg-error-container/40 text-xs font-semibold inline-flex items-center gap-1 transition-colors"
                  onClick={() => handleRevokeAccess(u.id)}
                >
                  <span className="material-symbols-outlined text-[14px]">block</span>
                  Cabut Akses
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {showAddPengurusModal && (
        <div className="fixed inset-0 z-50 bg-on-background/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md mx-4 sm:mx-auto rounded-2xl bg-surface-container-lowest shadow-2xl p-6 flex flex-col gap-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary-container flex items-center justify-center text-on-primary-container">
                  <span className="material-symbols-outlined text-[22px]">person_add</span>
                </div>
                <div>
                  <h3 className="text-base font-bold text-on-surface">Tambah Pengurus</h3>
                  <p className="text-xs text-on-surface-variant">Tambah anggota pengurus baru</p>
                </div>
              </div>
              <button type="button" className="w-8 h-8 rounded-lg bg-surface-container flex items-center justify-center text-on-surface-variant hover:text-on-surface" onClick={() => setShowAddPengurusModal(false)}>
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <form onSubmit={handleAddPengurus} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface">Nama Lengkap</label>
                <input
                  className="w-full h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all"
                  placeholder="Masukkan nama lengkap"
                  value={newPengurus.nama}
                  onChange={(e) => setNewPengurus({ ...newPengurus, nama: e.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface">Jabatan</label>
                <select
                  className="w-full h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all"
                  value={newPengurus.jabatan}
                  onChange={(e) => setNewPengurus({ ...newPengurus, jabatan: e.target.value })}
                >
                  <option value="">-- Pilih Jabatan --</option>
                  <option value="Ketua RT">Ketua RT</option>
                  <option value="Sekretaris">Sekretaris</option>
                  <option value="Bendahara">Bendahara</option>
                  <option value="Seksi Keamanan">Seksi Keamanan</option>
                  <option value="Seksi Kebersihan">Seksi Kebersihan</option>
                  <option value="Seksi Sosial">Seksi Sosial</option>
                </select>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-3 pt-2 border-t border-surface-container-high">
                <button
                  type="button"
                  className="h-11 px-4 rounded-xl text-on-surface-variant text-sm hover:bg-surface-container-high transition-colors"
                  onClick={() => setShowAddPengurusModal(false)}
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="h-11 px-6 rounded-xl bg-primary text-on-primary text-sm font-bold shadow-md hover:bg-primary-container active:scale-[0.98] transition-all flex items-center gap-2"
                >
                  <span className="material-symbols-outlined text-[18px]">person_add</span>
                  Tambah Pengurus
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editForm && (
        <div className="fixed inset-0 z-50 bg-on-background/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md mx-4 sm:mx-auto rounded-2xl bg-surface-container-lowest shadow-2xl p-6 flex flex-col gap-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary-container flex items-center justify-center text-on-primary-container">
                  <span className="material-symbols-outlined text-[22px]">edit</span>
                </div>
                <div>
                  <h3 className="text-base font-bold text-on-surface">Edit Pengurus</h3>
                  <p className="text-xs text-on-surface-variant">Perbarui data pengurus RT</p>
                </div>
              </div>
              <button type="button" className="w-8 h-8 rounded-lg bg-surface-container flex items-center justify-center text-on-surface-variant hover:text-on-surface" onClick={() => setEditForm(null)}>
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <form onSubmit={handleSimpanEditPengurus} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface">Nama Lengkap</label>
                <input
                  className="w-full h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all"
                  placeholder="Masukkan nama lengkap"
                  value={editForm.nama}
                  onChange={(e) => setEditForm({ ...editForm, nama: e.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface">Jabatan</label>
                <select
                  className="w-full h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all"
                  value={editForm.jabatan}
                  onChange={(e) => setEditForm({ ...editForm, jabatan: e.target.value })}
                >
                  <option value="Ketua RT">Ketua RT</option>
                  <option value="Sekretaris">Sekretaris</option>
                  <option value="Bendahara">Bendahara</option>
                  <option value="Seksi Keamanan">Seksi Keamanan</option>
                  <option value="Seksi Kebersihan">Seksi Kebersihan</option>
                  <option value="Seksi Sosial">Seksi Sosial</option>
                  <option value="Anggota">Anggota</option>
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface">Status</label>
                <select
                  className="w-full h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all"
                  value={editForm.status}
                  onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                >
                  <option value="active">Aktif</option>
                  <option value="nonaktif">Nonaktif</option>
                </select>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-3 pt-2 border-t border-surface-container-high">
                <button
                  type="button"
                  className="h-11 px-4 rounded-xl text-on-surface-variant text-sm hover:bg-surface-container-high transition-colors"
                  onClick={() => setEditForm(null)}
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="h-11 px-6 rounded-xl bg-primary text-on-primary text-sm font-bold shadow-md hover:bg-primary-container active:scale-[0.98] transition-all flex items-center gap-2"
                >
                  <span className="material-symbols-outlined text-[18px]">save</span>
                  Simpan Perubahan
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {accessForm && (
        <div className="fixed inset-0 z-50 bg-on-background/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md mx-4 sm:mx-auto rounded-2xl bg-surface-container-lowest shadow-2xl p-6 flex flex-col gap-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary-container flex items-center justify-center text-on-primary-container">
                  <span className="material-symbols-outlined text-[22px]">admin_panel_settings</span>
                </div>
                <div>
                  <h3 className="text-base font-bold text-on-surface">Atur Akses</h3>
                  <p className="text-xs text-on-surface-variant">Ubah peran & cakupan akses pengguna</p>
                </div>
              </div>
              <button type="button" className="w-8 h-8 rounded-lg bg-surface-container flex items-center justify-center text-on-surface-variant hover:text-on-surface" onClick={() => setAccessForm(null)}>
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <form onSubmit={handleSimpanAkses} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface">Peran</label>
                <select
                  className="w-full h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all"
                  value={accessForm.role}
                  onChange={(e) => setAccessForm({ ...accessForm, role: e.target.value })}
                >
                  <option value="Ketua RT">Ketua RT</option>
                  <option value="Sekretaris">Sekretaris</option>
                  <option value="Bendahara">Bendahara</option>
                  <option value="Seksi Keamanan">Seksi Keamanan</option>
                  <option value="Seksi Kebersihan">Seksi Kebersihan</option>
                  <option value="Seksi Sosial">Seksi Sosial</option>
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface">Cakupan Akses</label>
                <select
                  className="w-full h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all"
                  value={accessForm.akses}
                  onChange={(e) => setAccessForm({ ...accessForm, akses: e.target.value })}
                >
                  <option value="Full Access">Full Access</option>
                  <option value="Keuangan + Warga">Keuangan + Warga</option>
                  <option value="Warga Only">Warga Only</option>
                  <option value="Read Only">Read Only</option>
                </select>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-3 pt-2 border-t border-surface-container-high">
                <button
                  type="button"
                  className="h-11 px-4 rounded-xl text-on-surface-variant text-sm hover:bg-surface-container-high transition-colors"
                  onClick={() => setAccessForm(null)}
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="h-11 px-6 rounded-xl bg-primary text-on-primary text-sm font-bold shadow-md hover:bg-primary-container active:scale-[0.98] transition-all flex items-center gap-2"
                >
                  <span className="material-symbols-outlined text-[18px]">save</span>
                  Simpan Akses
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showLanggananModal && (
        <div className="fixed inset-0 z-50 bg-on-background/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg mx-4 sm:mx-auto rounded-2xl bg-surface-container-lowest shadow-2xl p-6 flex flex-col gap-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-secondary-container flex items-center justify-center text-on-secondary-container">
                  <span className="material-symbols-outlined text-[22px]">workspace_premium</span>
                </div>
                <div>
                  <h3 className="text-base font-bold text-on-surface">Perpanjang Berlangganan</h3>
                  <p className="text-xs text-on-surface-variant">Pilih paket & bayar via QRIS</p>
                </div>
              </div>
              <button type="button" className="w-8 h-8 rounded-lg bg-surface-container flex items-center justify-center text-on-surface-variant hover:text-on-surface" onClick={() => setShowLanggananModal(false)}>
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {(Object.keys(paketInfo) as PaketLangganan[]).map((pk) => (
                <button
                  key={pk}
                  type="button"
                  onClick={() => setPilihPaket(pk)}
                  className={`p-3 rounded-xl border-2 text-left transition-all ${
                    pilihPaket === pk
                      ? "border-primary bg-primary-container/10"
                      : "border-surface-container-high hover:border-outline"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-bold text-on-surface">{pk}</span>
                    {pilihPaket === pk && (
                      <span className="material-symbols-outlined text-primary text-[18px]">check_circle</span>
                    )}
                  </div>
                  <div className="text-xs font-mono text-on-surface-variant mt-1">{formatRupiah(paketInfo[pk].harga)}</div>
                  <div className="text-[11px] text-on-surface-variant">per {paketInfo[pk].per}</div>
                </button>
              ))}
            </div>

            <div className="p-4 rounded-xl bg-surface-container-low space-y-1.5 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-on-surface-variant">Paket</span>
                <span className="font-bold text-on-surface">{pilihPaket}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-on-surface-variant">Periode</span>
                <span className="font-bold text-on-surface">1 tahun (12 bulan)</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-on-surface-variant">Harga</span>
                <span className="font-mono text-on-surface">{formatRupiah(infoPilih.harga)} / {infoPilih.per}</span>
              </div>
              <div className="flex items-center justify-between gap-3 pt-1.5 border-t border-surface-container-high">
                <span className="font-bold text-on-surface">Total Tagihan</span>
                <span className="font-mono font-extrabold text-primary">
                  {infoPilih.harga === 0 ? "Gratis" : formatRupiah(infoPilih.harga)}
                </span>
              </div>
            </div>

            {infoPilih.harga > 0 ? (
              <div className="flex flex-col items-center gap-3 p-4 rounded-xl bg-surface-container-low border border-dashed border-outline-variant">
                <div className="bg-white p-3 rounded-xl shadow-sm border border-surface-container-high">
                  <QrisPlaceholder />
                </div>
                <div className="text-center">
                  <div className="text-xs font-extrabold text-on-surface tracking-widest">QRIS</div>
                  <div className="text-[11px] text-on-surface-variant">SIWARGA – Langganan {pilihPaket}</div>
                </div>
                <p className="text-xs text-on-surface-variant text-center font-semibold">
                  Bayar via QRIS, lalu konfirmasi
                </p>
                <ol className="list-decimal list-inside text-[11px] text-on-surface-variant space-y-1 text-left w-full">
                  <li>Buka aplikasi bank / e-wallet pilihanmu.</li>
                  <li>Pindai kode QRIS di atas.</li>
                  <li>Bayar sesuai nominal total tagihan.</li>
                  <li>Tekan tombol "Saya Sudah Bayar" untuk konfirmasi.</li>
                </ol>
              </div>
            ) : (
              <div className="p-3 rounded-xl bg-primary-container/10 flex items-start gap-2">
                <span className="material-symbols-outlined text-primary text-[16px] mt-0.5">info</span>
                <p className="text-xs text-on-surface-variant leading-relaxed">
                  Paket Free tidak dipungut biaya. Konfirmasi untuk langsung mengaktifkan lisensi gratis selamanya.
                </p>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-end gap-3 pt-2 border-t border-surface-container-high">
              <button
                type="button"
                className="h-11 px-4 rounded-xl text-on-surface-variant text-sm hover:bg-surface-container-high transition-colors"
                onClick={() => setShowLanggananModal(false)}
              >
                Batal
              </button>
              <button
                type="button"
                className="h-11 px-6 rounded-xl bg-primary text-on-primary text-sm font-bold shadow-md hover:bg-primary-container active:scale-[0.98] transition-all flex items-center gap-2"
                onClick={handleSayaSudahBayar}
              >
                <span className="material-symbols-outlined text-[18px]">task_alt</span>
                Saya Sudah Bayar
              </button>
            </div>
          </div>
        </div>
      )}

      {showInviteModal && (
        <div className="fixed inset-0 z-50 bg-on-background/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md mx-4 sm:mx-auto rounded-2xl bg-surface-container-lowest shadow-2xl p-6 flex flex-col gap-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-secondary-container flex items-center justify-center text-on-secondary-container">
                  <span className="material-symbols-outlined text-[22px]">mail</span>
                </div>
                <div>
                  <h3 className="text-base font-bold text-on-surface">Undang Pengurus</h3>
                  <p className="text-xs text-on-surface-variant">Kirim undangan via email</p>
                </div>
              </div>
              <button type="button" className="w-8 h-8 rounded-lg bg-surface-container flex items-center justify-center text-on-surface-variant hover:text-on-surface" onClick={() => setShowInviteModal(false)}>
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <form onSubmit={handleInvite} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface">Email Pengurus</label>
                <input
                  className="w-full h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all"
                  type="email"
                  placeholder="contoh@email.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                />
              </div>
              <div className="p-3 rounded-xl bg-secondary-container/20 flex items-start gap-2">
                <span className="material-symbols-outlined text-secondary text-[16px] mt-0.5">info</span>
                <p className="text-xs text-on-surface-variant leading-relaxed">
                  Pengurus akan menerima email undangan untuk mengakses portal {tenant.rtFull}. Mereka akan diminta membuat akun baru atau login dengan akun yang sudah ada.
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-3 pt-2 border-t border-surface-container-high">
                <button
                  type="button"
                  className="h-11 px-4 rounded-xl text-on-surface-variant text-sm hover:bg-surface-container-high transition-colors"
                  onClick={() => setShowInviteModal(false)}
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="h-11 px-6 rounded-xl bg-primary text-on-primary text-sm font-bold shadow-md hover:bg-primary-container active:scale-[0.98] transition-all flex items-center gap-2"
                >
                  <span className="material-symbols-outlined text-[18px]">send</span>
                  Kirim Undangan
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
