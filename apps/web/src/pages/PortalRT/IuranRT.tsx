import { useEffect, useState } from "react";
import { tenant } from "../../lib/tenant";
import {
  KategoriIuran,
  Pembayaran,
  SifatIuran,
  StatusPembayaran,
  TagihanRow,
  TagihanTambahan,
  TagihanTambahanBaru,
  TipeTarif,
  hitungIuranBulanan,
  hitungTagihanRows,
  kategoriTagihan,
  rekapIuran,
  formatRupiah,
  sifatIuranLabel,
  sifatIuranOpsi,
  shortAlamat,
  downloadText,
  tipeTarifLabel,
  tipeTarifOpsi,
  PERIODE_AKTIF,
} from "../../lib/shared";
import {
  GalatApi,
  labelPeriodeServer,
  type BarisProfilIuran,
  type BarisTagihanRtServer,
  type HasilGenerateTagihan,
  type KategoriIuranServer,
  type PengaturanIuranRt,
} from "../../lib/api";
import { EmptyState } from "../../components/EmptyState";
import { KonfirmasiDialog } from "../../components/KonfirmasiDialog";
import { useFlash } from "../../lib/useFlash";

/** Bentuk lengkap respons `GET /rt/iuran/tagihan` (B9/B10). */
interface TagihanServer {
  periode: string;
  rows: BarisTagihanRtServer[];
  rekap: {
    total: number;
    lunas: number;
    sebagian: number;
    menungguVerifikasi: number;
    belumBayar: number;
    target: number;
    terkumpul: number;
  };
}

/** Form profil iuran per kategori (string agar bebas dikosongkan pengguna). */
interface FormProfil {
  nominal: string;
  unit: string;
}

interface IuranRTProps {
  onNavigate?: (page: string) => void;
  kategoriIuran: KategoriIuran[];
  onKategoriChange: (k: KategoriIuran[]) => void;
  pembayaran: Pembayaran[];
  /**
   * API-first (F-6): bila melempar galat (bukan OFFLINE) → tampilkan gagal.
   * `kategoriTujuan` hanya dikirim pada mode alokasi `terpisah` (B7).
   */
  onVerifikasi: (
    id: string,
    status: StatusPembayaran,
    kategoriTujuan?: string,
  ) => void | Promise<void>;
  alamatWarga: string;
  kendaraanR4Count: number;
  tagihanTambahan: TagihanTambahan[];
  onTambahTagihanTambahan: (t: TagihanTambahanBaru) => Promise<void>;
  /** B7 — `GET /rt/iuran/pengaturan`; `null` = OFFLINE. */
  onMuatPengaturanIuran: () => Promise<PengaturanIuranRt | null>;
  /** B7 — master kategori dari server; `null` = OFFLINE. */
  onMuatKategoriServer: () => Promise<KategoriIuranServer[] | null>;
  /** B9 — `POST /rt/iuran/tagihan/generate`; `null` = OFFLINE. */
  onGenerateTagihan: (periode?: string) => Promise<HasilGenerateTagihan | null>;
  /** B9/B10 — `GET /rt/iuran/tagihan`; `null` = OFFLINE. */
  onMuatTagihanServer: (opsi: {
    periode?: string;
    kategori?: string;
    status?: string;
    q?: string;
  }) => Promise<TagihanServer | null>;
  /** B9 — `GET /rt/warga/:id/profil-iuran`; `null` = OFFLINE. */
  onMuatProfilIuran: (
    wargaId: string,
  ) => Promise<{ warga: { id: string; nama: string }; baris: BarisProfilIuran[] } | null>;
  /** B9 — `PUT /rt/warga/:id/profil-iuran`; `null` = OFFLINE. */
  onSimpanProfilIuran: (
    wargaId: string,
    payload: { kategoriId: string; nominalBerlaku?: number | null; jumlahUnit?: number },
  ) => Promise<{ warga: { id: string; nama: string }; profil: { kategoriId: string; nama: string } } | null>;
}

type StatusFilter = "all" | "lunas" | "pending" | "belum" | "sebagian" | "denda";

const badgeMap: Record<string, string> = {
  Lunas: "bg-secondary-container text-on-secondary-container",
  "Menunggu Verifikasi": "bg-tertiary-container text-on-tertiary-container",
  "Belum Bayar": "bg-error-container/40 text-on-error-container",
  Sebagian: "bg-tertiary-container text-on-tertiary-container",
  Denda: "bg-error/20 text-error",
  Ditolak: "bg-error/20 text-error",
};

function badgeFor(status: string): string {
  return badgeMap[status] ?? "bg-surface-container-high text-on-surface-variant";
}

const BULAN_PENDEK = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

/** Tanggal ISO input date → "25 Okt 2026" (gaya tenggat tagihan tambahan). */
function isoKeTenggat(iso: string): string {
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${Number(d)} ${BULAN_PENDEK[Number(m) - 1]} ${y}`;
}

function initials(nama: string): string {
  return nama.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase();
}

/** Bentuk isi form kategori iuran — dipakai untuk mode tambah maupun edit. */
interface FormKategori {
  nama: string;
  nominal: string;
  tipe: TipeTarif;
  sifat: SifatIuran;
}

const FORM_KATEGORI_KOSONG: FormKategori = { nama: "", nominal: "", tipe: "flat", sifat: "wajib" };

/** Penjelasan singkat per tipe tarif (tampil di bawah select tipe). */
const PETUNJUK_TIPE: Record<TipeTarif, string> = {
  flat: "Nominal tetap untuk setiap rumah dan ditagihkan otomatis tiap bulan.",
  per_unit: "Nominal dikalikan jumlah unit R4 yang terdaftar pada rumah.",
  insidental: "Tidak ditagihkan otomatis — Bendahara menambahkan tagihannya manual.",
};

export function IuranRT({
  onNavigate,
  kategoriIuran,
  onKategoriChange,
  pembayaran,
  onVerifikasi,
  alamatWarga,
  kendaraanR4Count,
  tagihanTambahan,
  onTambahTagihanTambahan,
  onMuatPengaturanIuran,
  onMuatKategoriServer,
  onGenerateTagihan,
  onMuatTagihanServer,
  onMuatProfilIuran,
  onSimpanProfilIuran,
}: IuranRTProps) {
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<StatusFilter>("all");
  const [filterPeriode, setFilterPeriode] = useState(PERIODE_AKTIF);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [detailRumah, setDetailRumah] = useState<TagihanRow | null>(null);
  const { flash, toast } = useFlash();

  // --- B7/B9/B10 · data server (di samping data demo yang selama ini dipakai) --
  // `null` = OFFLINE / belum dimuat → bagian server menampilkan catatan mode demo,
  // TIDAK PERNAH menyamar sebagai data valid.
  const [pengaturanIuran, setPengaturanIuran] = useState<PengaturanIuranRt | null>(null);
  const [kategoriServer, setKategoriServer] = useState<KategoriIuranServer[]>([]);
  const [tagihanServer, setTagihanServer] = useState<BarisTagihanRtServer[] | null>(null);
  const [rekapServer, setRekapServer] = useState<TagihanServer["rekap"] | null>(null);
  const [periodeServer, setPeriodeServer] = useState<string>("");

  // Filter bagian server (diproses server, bukan FE).
  const [fPeriode, setFPeriode] = useState("");
  const [fKategori, setFKategori] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [qServer, setQServer] = useState("");
  // Penanda muat ulang (mis. sesudah generate) tanpa mengubah filter.
  const [pemicuMuat, setPemicuMuat] = useState(0);
  const [serverSedangMuat, setServerSedangMuat] = useState(true);

  // B9 — konfirmasi generate tagihan bulanan.
  const [konfirmasiGenerate, setKonfirmasiGenerate] = useState(false);
  const [generateSedang, setGenerateSedang] = useState(false);

  // B9 — modal profil iuran per warga (override nominal & jumlah unit R4).
  const [profilTarget, setProfilTarget] = useState<BarisTagihanRtServer | null>(null);
  const [profilBaris, setProfilBaris] = useState<BarisProfilIuran[] | null>(null);
  const [profilForm, setProfilForm] = useState<Record<string, FormProfil>>({});
  const [profilSedang, setProfilSedang] = useState(false);

  // B7 — mode `terpisah`: kategori tujuan alokasi dipilih sekali untuk seluruh
  // verifikasi pada halaman ini.
  const [kategoriTujuan, setKategoriTujuan] = useState("");

  // Muat pengaturan + master kategori sekali saat halaman dibuka. StrictMode
  // menjalankan efek dua kali → penjaga `batal`; GET idempoten sehingga aman.
  useEffect(() => {
    let batal = false;
    void (async () => {
      try {
        const [p, k] = await Promise.all([onMuatPengaturanIuran(), onMuatKategoriServer()]);
        if (batal) return;
        if (p) setPengaturanIuran(p);
        if (k) setKategoriServer(k);
      } catch (err) {
        // Sesi habis ditangani App; galat lain ditampilkan tanpa merusak halaman.
        if (!batal && err instanceof GalatApi && err.code !== "UNAUTHORIZED") {
          flash(`Gagal memuat pengaturan iuran: ${err.message}`);
        }
      }
    })();
    return () => {
      batal = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Muat tagihan tercatat (server) mengikuti filter — jeda 300 ms agar mengetik
  // di kolom pencarian tidak membanjiri server.
  useEffect(() => {
    let batal = false;
    setServerSedangMuat(true);
    const jeda = window.setTimeout(() => {
      void onMuatTagihanServer({
        periode: fPeriode || undefined,
        kategori: fKategori || undefined,
        status: fStatus || undefined,
        q: qServer.trim() || undefined,
      })
        .then((h) => {
          if (batal) return;
          if (h) {
            setTagihanServer(h.rows);
            setRekapServer(h.rekap);
            setPeriodeServer(h.periode);
          } else {
            setTagihanServer(null);
            setRekapServer(null);
            setPeriodeServer("");
          }
        })
        .catch((err: unknown) => {
          if (!batal && err instanceof GalatApi && err.code !== "UNAUTHORIZED") {
            flash(`Gagal memuat tagihan tercatat: ${err.message}`);
          }
        })
        .finally(() => {
          if (!batal) setServerSedangMuat(false);
        });
    }, 300);
    return () => {
      batal = true;
      window.clearTimeout(jeda);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fPeriode, fKategori, fStatus, qServer, pemicuMuat]);

  const modeTerpisah = pengaturanIuran?.modeAlokasi === "terpisah";
  /** Kategori tujuan yang boleh dipilih — hanya yang aktif. */
  const kategoriTujuanOpsi = kategoriServer.filter((k) => k.statusAktif);

  /**
   * B7 — mode `terpisah` mewajibkan kategori tujuan alokasi; `false` berarti
   * verifikasi dibatalkan (pesan sudah di-flash).
   */
  function siapVerifikasi(): boolean {
    if (!modeTerpisah || kategoriTujuan) return true;
    flash("Mode alokasi terpisah: pilih kategori tujuan alokasi terlebih dahulu.");
    return false;
  }

  /**
   * B9 — "Buat Tagihan Bulan Ini": server menentukan periode aktif sendiri dan
   * idempoten per warga+kategori+periode (yang sudah ada DILEWATI, tidak dobel).
   */
  async function handleGenerateTagihan() {
    if (generateSedang) return flash("Permintaan masih diproses — tunggu sebentar.");
    setGenerateSedang(true);
    try {
      const hasil = await onGenerateTagihan();
      setGenerateSedang(false);
      setKonfirmasiGenerate(false);
      if (hasil) {
        flash(
          `Tagihan ${labelPeriodeServer(hasil.periode)} — ${hasil.dibuat} dibuat, ${hasil.dilewati} dilewati` +
            (hasil.sinkron ? `, ${hasil.sinkron} disinkronkan dengan profil iuran` : "") +
            " (sudah tercatat)."
        );
        setPemicuMuat((n) => n + 1);
      } else {
        flash("Mode demo (server tidak terjangkau) — tagihan tidak dibuat di server.");
      }
    } catch (err) {
      setGenerateSedang(false);
      setKonfirmasiGenerate(false);
      return flash(
        err instanceof GalatApi ? err.message : "Generate tagihan gagal — coba lagi."
      );
    }
  }

  /** B9 — buka modal profil iuran lalu muat baris override per kategori. */
  async function bukaProfilIuran(row: BarisTagihanRtServer) {
    setProfilTarget(row);
    setProfilBaris(null);
    setProfilForm({});
    try {
      const h = await onMuatProfilIuran(row.wargaId);
      if (!h) {
        setProfilBaris([]);
        return;
      }
      const awal: Record<string, FormProfil> = {};
      for (const b of h.baris) {
        awal[b.kategoriId] = {
          nominal: b.nominalBerlaku === null ? "" : String(b.nominalBerlaku),
          unit: String(b.jumlahUnit),
        };
      }
      setProfilBaris(h.baris);
      setProfilForm(awal);
    } catch (err) {
      setProfilTarget(null);
      flash(
        err instanceof GalatApi ? err.message : "Gagal memuat profil iuran warga."
      );
    }
  }

  /** B9 — simpan hanya baris yang berubah (PUT per kategori, wajib CSRF). */
  async function handleSimpanProfilIuran() {
    if (!profilTarget || !profilBaris) return;
    if (profilSedang) return flash("Permintaan masih diproses — tunggu sebentar.");

    const antre: Array<{ kategoriId: string; payload: { kategoriId: string; nominalBerlaku?: number | null; jumlahUnit?: number } }> = [];
    for (const b of profilBaris) {
      const f = profilForm[b.kategoriId];
      if (!f) continue;
      const payload: { kategoriId: string; nominalBerlaku?: number | null; jumlahUnit?: number } = { kategoriId: b.kategoriId };
      // Kosong = ikut `nominal_default` kategori (dikirim sebagai `null`).
      let nominalNilai: number | null = null;
      if (f.nominal.trim() !== "") {
        const n = Number(f.nominal);
        if (!Number.isFinite(n) || n < 0) {
          return flash(`Nominal "${b.nama}" tidak valid — angka ≥ 0 atau kosong.`);
        }
        nominalNilai = n;
      }
      if (b.nominalBerlaku !== nominalNilai) payload.nominalBerlaku = nominalNilai;

      if (b.tipeTarif === "per_unit") {
        const unit = Number(f.unit);
        if (!Number.isInteger(unit) || unit < 1 || unit > 999) {
          return flash(`Jumlah unit "${b.nama}" harus bilangan bulat 1–999.`);
        }
        if (b.jumlahUnit !== unit) payload.jumlahUnit = unit;
      }
      if (Object.keys(payload).length > 1) antre.push({ kategoriId: b.kategoriId, payload });
    }

    if (antre.length === 0) {
      setProfilTarget(null);
      return flash("Belum ada perubahan pada profil iuran.");
    }

    setProfilSedang(true);
    try {
      for (const a of antre) await onSimpanProfilIuran(profilTarget.wargaId, a.payload);
      setProfilSedang(false);
      setProfilTarget(null);
      flash(`Profil iuran ${profilTarget.nama} tersimpan (${antre.length} kategori diperbarui).`);
      setPemicuMuat((n) => n + 1);
    } catch (err) {
      setProfilSedang(false);
      return flash(
        err instanceof GalatApi
          ? `Profil iuran gagal disimpan: ${err.message}`
          : "Profil iuran gagal disimpan — coba lagi."
      );
    }
  }

  const [formTagihan, setFormTagihan] = useState({
    nama: "",
    nominal: "",
    jatuhTempo: "",
    target: "semua",
  });
  const [targetAlamat, setTargetAlamat] = useState("");

  const [formKategori, setFormKategori] = useState<FormKategori>(FORM_KATEGORI_KOSONG);
  const [editKategoriId, setEditKategoriId] = useState<string | null>(null);


  // Baris tagihan per alamat unik, jumlah dihitung dari kategori × unit R4
  // (unit R4 milik warga yang login diselaraskan lewat opsi hitung bersama).
  const tagihanRows: TagihanRow[] = hitungTagihanRows(kategoriIuran, pembayaran, {
    alamatWarga,
    unitR4Warga: kendaraanR4Count,
  });

  const filtered = tagihanRows.filter((row) => {
    const matchSearch =
      search === "" ||
      row.alamat.toLowerCase().includes(search.toLowerCase()) ||
      row.kepalaKk.toLowerCase().includes(search.toLowerCase());
    const matchStatus =
      filterStatus === "all" ||
      (filterStatus === "lunas" && row.status === "Lunas") ||
      (filterStatus === "pending" && row.status === "Menunggu Verifikasi") ||
      (filterStatus === "belum" && row.status === "Belum Bayar") ||
      (filterStatus === "sebagian" && row.status === "Sebagian") ||
      (filterStatus === "denda" && row.status === "Denda");
    const matchPeriode = row.periode === filterPeriode;
    return matchSearch && matchStatus && matchPeriode;
  });

  const rekap = rekapIuran(tagihanRows, pembayaran);

  const kpiData = [
    { label: "Total Terkumpul", value: formatRupiah(rekap.terkumpul), icon: "paid", color: "bg-secondary-container text-on-secondary-container" },
    { label: "Kepatuhan", value: `${rekap.kepatuhan.toFixed(1)}%`, icon: "verified", color: "bg-primary-container text-on-primary-container" },
    { label: "Tunggakan", value: formatRupiah(rekap.tunggakan), icon: "warning", color: "bg-error-container/40 text-on-error-container" },
    { label: "Rumah Belum Bayar", value: String(rekap.belumCount), icon: "home", color: "bg-tertiary-container text-on-tertiary-container" },
  ];

  const pendingList = pembayaran.filter((p) => p.status === "Menunggu Verifikasi");

  async function handleVerifikasiPembayaran(p: Pembayaran, status: StatusPembayaran) {
    if (status === "Lunas" && !siapVerifikasi()) return;
    try {
      await onVerifikasi(
        p.id,
        status,
        modeTerpisah && status === "Lunas" ? kategoriTujuan : undefined,
      );
      // Refetch baris tagihan (sisa/alokasi diperbarui server setelah verifikasi).
      setPemicuMuat((n) => n + 1);
      flash(
        status === "Lunas"
          ? `Pembayaran ${p.nama} (${p.alamat}) berhasil diverifikasi`
          : `Pembayaran ${p.nama} (${p.alamat}) ditolak.`
      );
    } catch {
      flash("Verifikasi gagal — periksa koneksi lalu coba lagi.");
    }
  }

  async function handleVerifikasiMassal() {
    if (!siapVerifikasi()) return;
    const jumlah = pendingList.length;
    try {
      for (const p of pendingList) {
        await onVerifikasi(p.id, "Lunas", modeTerpisah ? kategoriTujuan : undefined);
      }
      setPemicuMuat((n) => n + 1);
      flash(`${jumlah} pembayaran berhasil diverifikasi sekaligus`);
    } catch {
      flash("Sebagian verifikasi gagal — periksa koneksi lalu coba lagi.");
    }
  }

  function handleUnduhTemplate() {
    const header = "ID Pembayaran,Alamat,Nama,Periode,Jumlah,Metode,Tanggal,Status";
    const isi = pendingList
      .map(
        (p) =>
          `${p.id},"${p.alamat}","${p.nama}","${p.periode}",${p.jumlah},"${p.metode}","${p.tanggal}","${p.status}"`
      )
      .join("\n");
    downloadText("template-verifikasi-iuran.csv", isi ? `${header}\n${isi}` : header);
    flash("Template verifikasi pembayaran berhasil diunduh");
  }

  /**
   * Unduh kuitansi warga LUNAS dari modal detail rumah (PDF, klien — konsisten
   * dengan Portal Warga; tetap jalan OFFLINE karena tidak menyentuh server).
   */
  async function unduhKuitansiRt(p: Pembayaran) {
    try {
      const { simpanPdfKuitansi } = await import("../../lib/pdfKuitansi");
      simpanPdfKuitansi({
        judul: p.status === "Lunas" ? "Kuitansi Pembayaran Iuran" : "Pengajuan Pembayaran Iuran",
        ref: p.id.toUpperCase(),
        tanggal: p.tanggal,
        warga: p.nama,
        hunian: shortAlamat(p.alamat),
        periode: p.periode,
        jumlah: p.jumlah,
        metode: p.metode,
        status: p.status,
      });
      flash("Kuitansi PDF berhasil diunduh.");
    } catch {
      flash("Kuitansi gagal dibuat — coba lagi.");
    }
  }

  async function handleSubmitTagihan(e: React.FormEvent) {
    e.preventDefault();
    const nama = formTagihan.nama.trim();
    const nominal = Number(formTagihan.nominal);
    if (!nama || !nominal) {
      flash("Nama tagihan dan nominal wajib diisi.");
      return;
    }
    const target =
      formTagihan.target === "pilih" && targetAlamat ? targetAlamat : "semua";
    try {
      await onTambahTagihanTambahan({
        nama,
        nominal,
        tenggat: isoKeTenggat(formTagihan.jatuhTempo) || "-",
        tenggatIso: formTagihan.jatuhTempo || undefined,
        target,
      });
    } catch (err) {
      // Galat server (validasi/sesi) ditampilkan apa adanya — tanpa sukses palsu.
      flash(
        err instanceof Error && err.message
          ? err.message
          : "Tagihan gagal dibuat — periksa koneksi lalu coba lagi.",
      );
      return;
    }
    flash(`Tagihan "${nama}" berhasil dibuat`);
    setShowCreateModal(false);
    setFormTagihan({ nama: "", nominal: "", jatuhTempo: "", target: "semua" });
    setTargetAlamat("");
  }

  /**
   * Simpan kategori — SATU form untuk tambah maupun edit, sehingga tidak ada
   * atribut (tipe/sifat) yang bisa terlupa saat Pengurus RT mengubah data seed.
   * Validasi meniru batas DB: nama unik per RT (maks 80 karakter) & nominal >= 0.
   */
  function handleSimpanKategori(e: React.FormEvent) {
    e.preventDefault();
    const nama = formKategori.nama.trim();
    if (!nama) {
      flash("Nama kategori wajib diisi.");
      return;
    }
    if (nama.length > 80) {
      flash("Nama kategori maksimal 80 karakter.");
      return;
    }

    const nominal = Number(formKategori.nominal);
    if (!Number.isFinite(nominal) || nominal < 0) {
      flash("Nominal tidak boleh negatif.");
      return;
    }
    if (formKategori.tipe !== "insidental" && nominal === 0) {
      flash("Nominal harus lebih dari 0.");
      return;
    }

    const kembar = kategoriIuran.some(
      (c) => c.id !== editKategoriId && c.nama.trim().toLowerCase() === nama.toLowerCase()
    );
    if (kembar) {
      flash(`Kategori "${nama}" sudah ada — pilih nama lain.`);
      return;
    }

    if (editKategoriId) {
      onKategoriChange(
        kategoriIuran.map((c) =>
          c.id === editKategoriId
            ? { ...c, nama, nominal, tipe: formKategori.tipe, sifat: formKategori.sifat }
            : c
        )
      );
      flash(`Kategori "${nama}" berhasil diperbarui`);
    } else {
      const urutan = kategoriIuran.reduce((m, c) => Math.max(m, c.urutan), 0) + 1;
      const baru: KategoriIuran = {
        id: `k${Date.now()}`,
        nama,
        nominal,
        tipe: formKategori.tipe,
        sifat: formKategori.sifat,
        urutan,
        statusAktif: true,
      };
      onKategoriChange([...kategoriIuran, baru]);
      flash(`Kategori "${nama}" berhasil ditambahkan`);
    }

    setFormKategori(FORM_KATEGORI_KOSONG);
    setEditKategoriId(null);
  }

  /** Isi form dengan data kategori pilihan (mode edit). */
  function handleEditKategori(k: KategoriIuran) {
    setEditKategoriId(k.id);
    setFormKategori({ nama: k.nama, nominal: String(k.nominal), tipe: k.tipe, sifat: k.sifat });
  }

  function handleBatalEditKategori() {
    setEditKategoriId(null);
    setFormKategori(FORM_KATEGORI_KOSONG);
  }

  /**
   * Nonaktifkan/aktifkan kategori — PRD §6.4.1 memakai "menonaktifkan", bukan
   * hapus fisik, agar riwayat tagihan, pembayaran, dan kas tetap utuh.
   */
  function handleToggleStatusKategori(k: KategoriIuran) {
    onKategoriChange(
      kategoriIuran.map((c) => (c.id === k.id ? { ...c, statusAktif: !c.statusAktif } : c))
    );
    flash(
      k.statusAktif
        ? `Kategori "${k.nama}" dinonaktifkan — tidak lagi ditagihkan`
        : `Kategori "${k.nama}" diaktifkan kembali`
    );
  }

  return (
    <div className="max-w-7xl mx-auto w-full space-y-6">
      {toast}

      <div className="flex items-center gap-1.5 text-sm text-on-surface-variant">
        <button type="button" className="hover:text-primary transition-colors flex items-center gap-1" onClick={() => onNavigate?.("dashboard-rt")}><span className="material-symbols-outlined text-[16px]">home</span>
          Portal RT
        </button>
        <span className="material-symbols-outlined text-[14px]">chevron_right</span>
        <span className="font-bold text-on-surface">Iuran</span>
      </div>

      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div className="max-w-3xl space-y-1.5">
          <div className="inline-flex items-center gap-1.5 text-primary text-sm font-bold uppercase tracking-wider">
            <span className="material-symbols-outlined text-[16px]">request_quote</span>
            Administrasi Iuran Warga
          </div>
          <h1 className="text-2xl lg:text-[32px] text-on-surface tracking-tight font-extrabold">
            Manajemen Iuran {tenant.label}
          </h1>
          <p className="text-sm text-on-surface-variant leading-relaxed">
            Kelola tagihan iuran per rumah di {tenant.rtFull} {tenant.rwFull}, lacak status pembayaran, dan kirim pengingat kepada rumah yang belum lunas.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <button
            className="h-11 px-5 rounded-xl bg-surface-container-lowest text-on-surface text-sm shadow-sm hover:shadow-md hover:bg-surface-container-low transition-all flex items-center gap-2"
            onClick={() => setShowCategoryModal(true)}
          >
            <span className="material-symbols-outlined text-primary text-[20px]">category</span>
            Atur Kategori
          </button>
          <button
            className="h-11 px-5 rounded-xl bg-surface-container-lowest text-on-surface text-sm shadow-sm hover:shadow-md hover:bg-surface-container-low transition-all flex items-center gap-2"
            onClick={() => flash(`Pengingat terkirim ke ${rekap.belumCount} rumah yang belum bayar`)}
          >
            <span className="material-symbols-outlined text-tertiary text-[20px]">notifications</span>
            Kirim Pengingat
          </button>
          <button
            className="h-11 px-5 rounded-xl bg-primary text-on-primary text-sm shadow-md hover:bg-primary-container active:scale-[0.98] transition-all flex items-center gap-2"
            onClick={() => setShowCreateModal(true)}
          >
            <span className="material-symbols-outlined text-[20px]">add</span>
            + Buat Tagihan Baru
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpiData.map((kpi) => (
          <div key={kpi.label} className="bg-surface-container-lowest rounded-xl p-5 shadow-sm flex flex-col justify-between">
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

      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 p-4 rounded-xl bg-surface-container-lowest shadow-sm">
        <select
          className="h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all"
          value={filterPeriode}
          onChange={(e) => setFilterPeriode(e.target.value)}
        >
          <option value={PERIODE_AKTIF}>{PERIODE_AKTIF}</option>
          <option value="September 2026">September 2026</option>
          <option value="Agustus 2026">Agustus 2026</option>
        </select>
        <select
          className="h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all"
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value as StatusFilter)}
        >
          <option value="all">Semua Status</option>
          <option value="lunas">Lunas</option>
          <option value="pending">Menunggu Verifikasi</option>
          <option value="belum">Belum Bayar</option>
          <option value="sebagian">Sebagian</option>
          <option value="denda">Denda</option>
        </select>
        <div className="relative flex-1">
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 material-symbols-outlined text-on-surface-variant text-[20px]">search</span>
          <input
            className="w-full h-11 pl-11 pr-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all"
            placeholder="Cari berdasarkan nama KK atau alamat..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="bg-surface-container-lowest rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-on-surface">
            <thead className="bg-surface-container-low text-xs text-on-surface-variant uppercase tracking-wider">
              <tr>
                <th className="py-3 px-4">Alamat Rumah</th>
                <th className="py-3 px-4">Periode</th>
                <th className="py-3 px-4">Jumlah</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Tanggal Bayar</th>
                <th className="py-3 px-4 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-container-high">
              {filtered.map((row) => {
                const pendingRow = pembayaran.find(
                  (p) =>
                    shortAlamat(p.alamat) === row.alamat &&
                    p.periode === row.periode &&
                    p.status === "Menunggu Verifikasi"
                );
                return (
                  <tr key={row.id} className="hover:bg-surface-container-low/50 transition-colors">
                    <td className="py-4 px-4">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-primary-container flex items-center justify-center text-on-primary-container font-bold text-xs shrink-0">
                          {initials(row.kepalaKk)}
                        </div>
                        <div>
                          <span className="text-sm font-bold text-on-surface block">{row.alamat}</span>
                          <span className="text-xs text-on-surface-variant font-mono">{row.kkCount} KK</span>
                        </div>
                      </div>
                    </td>
                    <td className="py-4 px-4">
                      <span className="text-xs text-on-surface">{row.periode}</span>
                    </td>
                    <td className="py-4 px-4">
                      <span className="text-sm font-bold text-on-surface font-mono">{formatRupiah(row.jumlah)}</span>
                    </td>
                    <td className="py-4 px-4">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${badgeFor(row.status)}`}>
                        <span className="w-2 h-2 rounded-full bg-current opacity-60" />
                        {row.status}
                      </span>
                    </td>
                    <td className="py-4 px-4">
                      <span className="text-xs text-on-surface-variant font-mono">
                        {row.tanggalBayar || "-"}
                      </span>
                    </td>
                    <td className="py-4 px-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          className="h-8 px-3 rounded-lg bg-surface-container-low text-on-surface-variant hover:text-primary hover:bg-surface-container text-xs font-semibold inline-flex items-center gap-1 transition-colors"
                          onClick={() => setDetailRumah(row)}
                        >
                          <span className="material-symbols-outlined text-[14px]">visibility</span>
                          Detail
                        </button>
                        {(row.status === "Belum Bayar" || row.status === "Denda" || row.status === "Sebagian") && (
                          <button
                            className="h-8 px-3 rounded-lg bg-tertiary-container/40 text-on-tertiary-container hover:bg-tertiary-container text-xs font-semibold inline-flex items-center gap-1 transition-colors"
                            onClick={() => flash(`Pengingat terkirim ke ${row.kepalaKk} (${row.alamat})`)}
                          >
                            <span className="material-symbols-outlined text-[14px]">notifications</span>
                            Kirim Pengingat
                          </button>
                        )}
                        {row.status === "Denda" && (
                          <button
                            className="h-8 px-3 rounded-lg bg-secondary-container/40 text-on-secondary-container hover:bg-secondary-container text-xs font-semibold inline-flex items-center gap-1 transition-colors"
                            onClick={() => flash(`Denda untuk ${row.alamat} telah dibebaskan`)}
                          >
                            <span className="material-symbols-outlined text-[14px]">gavel</span>
                            Bebaskan Denda
                          </button>
                        )}
                        {row.status === "Menunggu Verifikasi" && pendingRow && (
                          <button
                            className="h-8 px-3 rounded-lg bg-primary/10 text-primary hover:bg-primary hover:text-on-primary text-xs font-semibold inline-flex items-center gap-1 transition-colors"
                            onClick={() => handleVerifikasiPembayaran(pendingRow, "Lunas")}
                          >
                            <span className="material-symbols-outlined text-[14px]">task_alt</span>
                            Verifikasi
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-4">
                    <EmptyState
                      icon="receipt_long"
                      judul="Iuran tidak ditemukan"
                      pesan="Ubah filter periode atau alamat untuk melihat tagihan lain."
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="px-6 py-3 border-t border-surface-container-high flex items-center justify-between text-xs text-on-surface-variant">
          <span>Menampilkan {filtered.length} dari {tagihanRows.length} tagihan iuran</span>
          <span className="font-semibold">Halaman 1 dari 1</span>
        </div>
      </div>

      {/* B9/B10 · Tagihan Tercatat — data riil server (`GET /rt/iuran/tagihan`),
          dipisah dari tabel demo di atas agar tidak pernah tercampur. */}
      <div className="bg-surface-container-lowest rounded-xl shadow-sm overflow-hidden">
        <div className="p-5 border-b border-surface-container-high flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-tertiary-container flex items-center justify-center text-on-tertiary-container">
              <span className="material-symbols-outlined text-[22px]">database</span>
            </div>
            <div>
              <h2 className="text-base font-bold text-on-surface">Tagihan Tercatat (server)</h2>
              <p className="text-xs text-on-surface-variant">
                {tagihanServer === null
                  ? "Server tidak terjangkau — belum ada tagihan tercatat yang bisa ditampilkan."
                  : `${tagihanServer.length} warga · periode ${
                      periodeServer ? labelPeriodeServer(periodeServer) : "periode aktif"
                    }${serverSedangMuat ? " · memuat…" : ""}`}
              </p>
            </div>
          </div>
          <button
            className="h-11 px-5 rounded-xl bg-primary text-on-primary text-sm shadow-md hover:bg-primary-container active:scale-[0.98] transition-all flex items-center gap-2 shrink-0"
            onClick={() => setKonfirmasiGenerate(true)}
          >
            <span className="material-symbols-outlined text-[20px]">calendar_add_on</span>
            Buat Tagihan Bulan Ini
          </button>
        </div>

        {rekapServer && (
          <div className="px-5 py-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 bg-surface-container-low/60">
            {[
              { l: "Terkumpul", v: formatRupiah(rekapServer.terkumpul) },
              { l: "Target", v: formatRupiah(rekapServer.target) },
              { l: "Lunas", v: String(rekapServer.lunas) },
              { l: "Sebagian", v: String(rekapServer.sebagian) },
              { l: "Menunggu Verifikasi", v: String(rekapServer.menungguVerifikasi) },
              { l: "Belum Bayar", v: String(rekapServer.belumBayar) },
            ].map((c) => (
              <div key={c.l} className="p-2.5 rounded-xl bg-surface-container-lowest">
                <div className="text-[10px] text-on-surface-variant uppercase tracking-wider font-semibold truncate">
                  {c.l}
                </div>
                <div className="text-sm font-extrabold text-on-surface font-mono truncate">{c.v}</div>
              </div>
            ))}
          </div>
        )}

        {/* Filter — diproses SERVER (periode/kategori/status/q). */}
        <div className="p-4 flex flex-col sm:flex-row items-stretch sm:items-center gap-3 border-b border-surface-container-high">
          <input
            className="h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all"
            type="month"
            title="Kosongkan untuk periode aktif"
            value={fPeriode}
            onChange={(e) => setFPeriode(e.target.value)}
          />
          <select
            className="h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all"
            value={fKategori}
            onChange={(e) => setFKategori(e.target.value)}
          >
            <option value="">Semua Kategori</option>
            {kategoriServer.map((k) => (
              <option key={k.id} value={k.id}>
                {k.nama}
                {k.tipeTarif === "per_unit" ? " (per unit)" : ""}
              </option>
            ))}
          </select>
          <select
            className="h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all"
            value={fStatus}
            onChange={(e) => setFStatus(e.target.value)}
          >
            <option value="">Semua Status</option>
            <option value="Lunas">Lunas</option>
            <option value="Sebagian">Sebagian</option>
            <option value="Belum Bayar">Belum Bayar</option>
            <option value="Menunggu Verifikasi">Menunggu Verifikasi</option>
          </select>
          <div className="relative flex-1">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 material-symbols-outlined text-on-surface-variant text-[20px]">search</span>
            <input
              className="w-full h-11 pl-11 pr-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all"
              placeholder="Cari nama warga atau alamat..."
              maxLength={80}
              value={qServer}
              onChange={(e) => setQServer(e.target.value)}
            />
          </div>
          {(fPeriode || fKategori || fStatus || qServer) && (
            <button
              className="h-11 px-4 rounded-xl bg-surface-container-high text-on-surface-variant hover:text-primary text-xs font-semibold inline-flex items-center gap-1 transition-colors shrink-0"
              onClick={() => {
                setFPeriode("");
                setFKategori("");
                setFStatus("");
                setQServer("");
              }}
            >
              <span className="material-symbols-outlined text-[14px]">filter_alt_off</span>
              Reset
            </button>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-on-surface">
            <thead className="bg-surface-container-low text-xs text-on-surface-variant uppercase tracking-wider">
              <tr>
                <th className="py-3 px-4">Warga</th>
                <th className="py-3 px-4 text-right">Tagihan</th>
                <th className="py-3 px-4 text-right">Sisa</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Tanggal Bayar</th>
                <th className="py-3 px-4 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-container-high">
              {(tagihanServer ?? []).map((r) => (
                <tr key={r.wargaId} className="hover:bg-surface-container-low/50 transition-colors">
                  <td className="py-4 px-4">
                    <span className="text-sm font-bold text-on-surface block">{r.nama}</span>
                    <span className="text-xs text-on-surface-variant font-mono">{r.alamat}</span>
                  </td>
                  <td className="py-4 px-4 text-right">
                    <span className="text-sm font-bold text-on-surface font-mono">{formatRupiah(r.jumlah)}</span>
                  </td>
                  <td className="py-4 px-4 text-right">
                    <span className={`text-sm font-bold font-mono ${r.sisa > 0 ? "text-error" : "text-on-surface-variant"}`}>
                      {formatRupiah(r.sisa)}
                    </span>
                  </td>
                  <td className="py-4 px-4">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${badgeFor(r.status)}`}>
                        <span className="w-2 h-2 rounded-full bg-current opacity-60" />
                        {r.status}
                      </span>
                      {/* B10 — badge keringanan & tunggakan */}
                      {r.keringananAktif && (
                        <span
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-secondary-container/60 text-on-secondary-container text-[10px] font-bold uppercase tracking-wider"
                          title="Ada keringanan aktif untuk warga ini"
                        >
                          <span className="material-symbols-outlined text-[12px]">percent</span>
                          Keringanan (aktif)
                        </span>
                      )}
                      {!!r.tunggakanBulan && (
                        <span
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-error-container/40 text-on-error-container text-[10px] font-bold uppercase tracking-wider"
                          title="Tunggakan tertua sebelum periode aktif"
                        >
                          <span className="material-symbols-outlined text-[12px]">warning</span>
                          Menunggak ({r.tunggakanBulan} bln)
                        </span>
                      )}
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {r.perKategori.map((k) => (
                        <span
                          key={k.kategoriId}
                          className="inline-flex items-center px-2 py-0.5 rounded-md bg-surface-container-low text-[10px] text-on-surface-variant font-mono"
                          title={`${k.kategori} — ${formatRupiah(k.nominal)} · sisa ${formatRupiah(k.sisa)} · ${k.label}`}
                        >
                          {k.kategori}: {k.label}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="py-4 px-4">
                    <span className="text-xs text-on-surface-variant font-mono">{r.tanggalBayar ?? "-"}</span>
                  </td>
                  <td className="py-4 px-4 text-right">
                    <button
                      className="h-8 px-3 rounded-lg bg-surface-container-low text-on-surface-variant hover:text-primary hover:bg-surface-container text-xs font-semibold inline-flex items-center gap-1 transition-colors"
                      onClick={() => void bukaProfilIuran(r)}
                    >
                      <span className="material-symbols-outlined text-[14px]">manage_accounts</span>
                      Profil Iuran
                    </button>
                  </td>
                </tr>
              ))}
              {(tagihanServer ?? []).length === 0 && (
                <tr>
                  <td colSpan={6} className="py-4">
                    {serverSedangMuat && !tagihanServer ? (
                      <EmptyState
                        icon="progress_activity"
                        judul="Memuat tagihan tercatat…"
                        pesan="Mengambil data tagihan dari server."
                      />
                    ) : (
                      <EmptyState
                        icon={tagihanServer === null ? "cloud_off" : "receipt_long"}
                        judul={
                          tagihanServer === null
                            ? "Server tidak terjangkau"
                            : "Belum ada tagihan tercatat"
                        }
                        pesan={
                          tagihanServer === null
                            ? "Bagian ini hanya menampilkan data riil server — nyalakan backend lalu muat ulang halaman."
                            : "Ubah filter atau tekan “Buat Tagihan Bulan Ini” untuk membuat tagihan periode berjalan."
                        }
                      />
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-surface-container-lowest rounded-xl shadow-sm p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-tertiary-container flex items-center justify-center text-on-tertiary-container">
              <span className="material-symbols-outlined text-[22px]">task_alt</span>
            </div>
            <div>
              <h2 className="text-base font-bold text-on-surface">Verifikasi Pembayaran</h2>
              <p className="text-xs text-on-surface-variant">
                {pendingList.length > 0
                  ? `${pendingList.length} pembayaran menunggu verifikasi`
                  : "Tidak ada pembayaran yang menunggu verifikasi"}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              className="h-9 px-3 rounded-lg bg-surface-container-low text-on-surface-variant hover:text-primary hover:bg-surface-container text-xs font-semibold inline-flex items-center gap-1 transition-colors"
              onClick={handleUnduhTemplate}
            >
              <span className="material-symbols-outlined text-[14px]">download</span>
              Unduh Template
            </button>
            {pendingList.length > 1 && (
              <button
                className="h-9 px-3 rounded-lg bg-primary text-on-primary text-xs font-bold hover:bg-primary-container transition-colors inline-flex items-center gap-1"
                onClick={handleVerifikasiMassal}
              >
                <span className="material-symbols-outlined text-[14px]">done_all</span>
                Verifikasi Massal
              </button>
            )}
          </div>
        </div>

        {/* B7 · mode alokasi `terpisah`: wajib memilih kategori tujuan alokasi
            sebelum pembayaran disetujui (server menolak tanpa `kategoriTujuan`). */}
        {modeTerpisah && (
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 rounded-xl bg-tertiary-container/30 border border-tertiary/40">
            <span className="material-symbols-outlined text-tertiary text-[20px]">account_balance_wallet</span>
            <div className="flex-1">
              <div className="text-sm font-bold text-on-surface">Mode alokasi: Terpisah</div>
              <div className="text-xs text-on-surface-variant">
                Dana yang disetujui harus dialokasikan ke satu kategori tujuan.
              </div>
            </div>
            <select
              aria-label="Kategori tujuan alokasi"
              className="h-11 px-4 rounded-xl bg-surface-container-lowest text-sm text-on-surface focus:ring-2 focus:ring-primary focus:outline-none transition-all min-w-[220px]"
              value={kategoriTujuan}
              onChange={(e) => setKategoriTujuan(e.target.value)}
            >
              <option value="">— Pilih kategori tujuan —</option>
              {kategoriTujuanOpsi.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.nama}
                  {k.tipeTarif === "per_unit" ? " (per unit)" : ""}
                </option>
              ))}
            </select>
          </div>
        )}

        {pendingList.length === 0 ? (
          <div className="py-8 text-center rounded-xl bg-surface-container-low">
            <span className="material-symbols-outlined text-[32px] text-on-surface-variant block mb-2">inbox</span>
            <p className="text-sm text-on-surface-variant">
              Semua pembayaran sudah diproses. Tidak ada yang menunggu verifikasi.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {pendingList.map((p) => (
              <div
                key={p.id}
                className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 p-4 rounded-xl bg-surface-container-low"
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-primary-container flex items-center justify-center text-on-primary-container font-bold text-xs shrink-0">
                    {initials(p.nama)}
                  </div>
                  <div>
                    <div className="text-sm font-bold text-on-surface">{p.nama}</div>
                    <div className="text-xs text-on-surface-variant">
                      {p.alamat} · {p.periode}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-on-surface-variant">
                  <span className="material-symbols-outlined text-[16px]">{p.metodeIcon}</span>
                  <span>
                    {p.metode} · <span className="font-mono">{p.tanggal}</span>
                  </span>
                </div>
                <div className="flex items-center justify-between lg:justify-end gap-3">
                  <span className="text-sm font-bold text-on-surface font-mono">{formatRupiah(p.jumlah)}</span>
                  <div className="flex items-center gap-2">
                    <button
                      className="h-9 px-3 rounded-lg bg-secondary-container/60 text-on-secondary-container hover:bg-secondary-container text-xs font-bold inline-flex items-center gap-1 transition-colors"
                      onClick={() => handleVerifikasiPembayaran(p, "Lunas")}
                    >
                      <span className="material-symbols-outlined text-[14px]">check</span>
                      Verifikasi
                    </button>
                    <button
                      className="h-9 px-3 rounded-lg bg-error-container/30 hover:bg-error-container text-error text-xs font-bold inline-flex items-center gap-1 transition-colors"
                      onClick={() => handleVerifikasiPembayaran(p, "Ditolak")}
                    >
                      <span className="material-symbols-outlined text-[14px]">close</span>
                      Tolak
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Tagihan Tambahan */}
      <div className="bg-surface-container-lowest rounded-xl shadow-sm p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-secondary-container flex items-center justify-center text-on-secondary-container">
            <span className="material-symbols-outlined text-[22px]">receipt_long</span>
          </div>
          <div>
            <h2 className="text-base font-bold text-on-surface">Tagihan Tambahan</h2>
            <p className="text-xs text-on-surface-variant">
              {tagihanTambahan.length > 0
                ? `${tagihanTambahan.length} tagihan kondisional dibuat pengurus RT`
                : "Belum ada tagihan tambahan untuk periode ini"}
            </p>
          </div>
        </div>

        {tagihanTambahan.length === 0 ? (
          <div className="py-8 text-center rounded-xl bg-surface-container-low">
            <span className="material-symbols-outlined text-[32px] text-on-surface-variant block mb-2">receipt_long</span>
            <p className="text-sm text-on-surface-variant">
              Belum ada tagihan tambahan. Buat lewat tombol &quot;+ Buat Tagihan Baru&quot;.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {tagihanTambahan.map((t) => (
              <div
                key={t.id}
                className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 p-4 rounded-xl bg-surface-container-low"
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-primary-container flex items-center justify-center text-on-primary-container shrink-0">
                    <span className="material-symbols-outlined text-[18px]">{t.icon}</span>
                  </div>
                  <div>
                    <div className="text-sm font-bold text-on-surface">{t.nama}</div>
                    <div className="text-xs text-on-surface-variant">
                      Tenggat <span className="font-mono">{t.tenggat}</span> · Target:{" "}
                      {t.targetSemua
                        ? "Semua Rumah"
                        : t.target && t.target !== "semua"
                          ? t.target
                          : t.total
                            ? `${t.total} rumah`
                            : "Semua Rumah"}
                      {t.periode ? ` · ${labelPeriodeServer(t.periode)}` : ""}
                    </div>
                    {t.total !== undefined && t.lunasCount !== undefined && (
                      <div className="text-xs text-on-surface-variant">
                        {t.lunasCount} dari {t.total} warga target sudah lunas
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-between lg:justify-end gap-3">
                  <span className="text-sm font-bold text-on-surface font-mono">{formatRupiah(t.nominal)}</span>
                  <span
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${
                      t.status === "Lunas"
                        ? "bg-secondary-container text-on-secondary-container"
                        : "bg-tertiary-container text-on-tertiary-container"
                    }`}
                  >
                    <span className="w-2 h-2 rounded-full bg-current opacity-60" />
                    {t.total !== undefined && t.lunasCount !== undefined && t.lunasCount > 0 && t.lunasCount < t.total
                      ? `${t.lunasCount}/${t.total} Lunas`
                      : t.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-on-background/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg mx-4 sm:mx-auto rounded-2xl bg-surface-container-lowest shadow-2xl p-6 flex flex-col gap-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary-container flex items-center justify-center text-on-primary-container">
                  <span className="material-symbols-outlined text-[22px]">add_circle</span>
                </div>
                <div>
                  <h3 className="text-base font-bold text-on-surface">Buat Tagihan Baru</h3>
                  <p className="text-xs text-on-surface-variant">Buat tagihan iuran untuk warga {tenant.rtFull}</p>
                </div>
              </div>
              <button className="w-8 h-8 rounded-lg bg-surface-container flex items-center justify-center text-on-surface-variant hover:text-on-surface" onClick={() => setShowCreateModal(false)}>
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <form onSubmit={handleSubmitTagihan} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[16px] text-on-surface-variant">title</span>
                  Nama Tagihan
                </label>
                <input
                  className="w-full h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all"
                  type="text"
                  placeholder="Contoh: Iuran Perbaikan Pos Ronda"
                  value={formTagihan.nama}
                  onChange={(e) => setFormTagihan({ ...formTagihan, nama: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-on-surface flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[16px] text-on-surface-variant">paid</span>
                    Nominal (Rp)
                  </label>
                  <input
                    className="w-full h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface font-mono focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all"
                    type="number"
                    placeholder="0"
                    value={formTagihan.nominal}
                    onChange={(e) => setFormTagihan({ ...formTagihan, nominal: e.target.value })}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-on-surface flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[16px] text-on-surface-variant">event</span>
                    Jatuh Tempo
                  </label>
                  <input
                    className="w-full h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface font-mono focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all"
                    type="date"
                    value={formTagihan.jatuhTempo}
                    onChange={(e) => setFormTagihan({ ...formTagihan, jatuhTempo: e.target.value })}
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[16px] text-on-surface-variant">group</span>
                  Target Tagihan
                </label>
                <div className="flex gap-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="target"
                      value="semua"
                      checked={formTagihan.target === "semua"}
                      onChange={() => setFormTagihan({ ...formTagihan, target: "semua" })}
                      className="text-primary focus:ring-primary"
                    />
                    <span className="text-sm text-on-surface">Semua Rumah</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="target"
                      value="pilih"
                      checked={formTagihan.target === "pilih"}
                      onChange={() => setFormTagihan({ ...formTagihan, target: "pilih" })}
                      className="text-primary focus:ring-primary"
                    />
                    <span className="text-sm text-on-surface">Pilih Rumah Tertentu</span>
                  </label>
                </div>
                {formTagihan.target === "pilih" && (
                  <select
                    className="w-full h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all"
                    value={targetAlamat}
                    onChange={(e) => setTargetAlamat(e.target.value)}
                  >
                    <option value="">— Pilih alamat rumah —</option>
                    {tagihanRows.map((r) => (
                      <option key={r.id} value={r.alamat}>
                        {r.alamat} — {r.kepalaKk}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="flex items-center justify-end gap-3 pt-2 border-t border-surface-container-high">
                <button
                  type="button"
                  className="h-11 px-4 rounded-xl text-on-surface-variant text-sm hover:bg-surface-container-high transition-colors"
                  onClick={() => setShowCreateModal(false)}
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="h-11 px-6 rounded-xl bg-primary text-on-primary text-sm font-bold shadow-md hover:bg-primary-container active:scale-[0.98] transition-all flex items-center gap-2"
                >
                  <span className="material-symbols-outlined text-[18px]">save</span>
                  Buat Tagihan
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showCategoryModal && (
        <div className="fixed inset-0 z-50 bg-on-background/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg mx-4 sm:mx-auto rounded-2xl bg-surface-container-lowest shadow-2xl p-6 flex flex-col gap-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-secondary-container/40 flex items-center justify-center text-on-secondary-container">
                  <span className="material-symbols-outlined text-[22px]">category</span>
                </div>
                <div>
                  <h3 className="text-base font-bold text-on-surface">Atur Kategori Iuran</h3>
                  <p className="text-xs text-on-surface-variant">Master kategori iuran (PRD §6.4.1) — data awal dari seed, bisa diubah kapan saja</p>
                </div>
              </div>
              <button className="w-8 h-8 rounded-lg bg-surface-container flex items-center justify-center text-on-surface-variant hover:text-on-surface" onClick={() => setShowCategoryModal(false)}>
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <div className="flex items-start gap-2 p-3 rounded-xl bg-primary-container/40">
              <span className="material-symbols-outlined text-[16px] text-primary shrink-0 mt-0.5">info</span>
              <span className="text-xs text-on-surface leading-relaxed">
                Perubahan nama, nominal, tipe, dan sifat otomatis tampil di Portal Warga.
                Kategori yang dinonaktifkan tidak lagi ditagihkan — riwayat tagihan &amp; kas
                yang sudah ada tetap utuh.
              </span>
            </div>

            <div className="space-y-3">
              {[...kategoriIuran]
                .sort((a, b) => a.urutan - b.urutan)
                .map((cat) => (
                  <div
                    key={cat.id}
                    className={`p-3 rounded-xl flex items-center justify-between gap-3 ${
                      cat.statusAktif ? "bg-surface-container-low" : "bg-surface-container-low/60"
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className={`text-sm font-bold ${
                            cat.statusAktif ? "text-on-surface" : "text-on-surface-variant"
                          }`}
                        >
                          {cat.nama}
                        </span>
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-primary-container/50 text-on-primary-container text-[10px] font-bold uppercase tracking-wider">
                          {tipeTarifLabel[cat.tipe]}
                        </span>
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                            cat.sifat === "wajib"
                              ? "bg-secondary-container/60 text-on-secondary-container"
                              : "bg-tertiary-container/60 text-on-tertiary-container"
                          }`}
                        >
                          {sifatIuranLabel[cat.sifat]}
                        </span>
                        {!cat.statusAktif && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-error-container/40 text-error text-[10px] font-bold uppercase tracking-wider">
                            Nonaktif
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-on-surface-variant font-mono">
                        {formatRupiah(cat.nominal)}
                        {cat.tipe === "per_unit" ? " / unit R4" : ""}
                        {cat.tipe === "insidental" ? " · nominal diisi manual saat dibuat" : ""}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        className="h-8 px-3 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface-variant text-xs font-semibold inline-flex items-center gap-1 transition-colors"
                        onClick={() => handleEditKategori(cat)}
                      >
                        <span className="material-symbols-outlined text-[14px]">edit</span>
                        Edit
                      </button>
                      <button
                        className={`h-8 px-3 rounded-lg text-xs font-semibold inline-flex items-center gap-1 transition-colors ${
                          cat.statusAktif
                            ? "bg-error-container/30 hover:bg-error-container text-error"
                            : "bg-secondary-container/60 hover:bg-secondary-container text-on-secondary-container"
                        }`}
                        onClick={() => handleToggleStatusKategori(cat)}
                      >
                        <span className="material-symbols-outlined text-[14px]">
                          {cat.statusAktif ? "block" : "check_circle"}
                        </span>
                        {cat.statusAktif ? "Nonaktifkan" : "Aktifkan"}
                      </button>
                    </div>
                  </div>
                ))}
              {kategoriIuran.length === 0 && (
                <div className="py-6 text-center text-sm text-on-surface-variant">
                  Belum ada kategori iuran. Tambahkan kategori pertama di bawah.
                </div>
              )}
            </div>

            <form
              onSubmit={handleSimpanKategori}
              className="space-y-3 p-3 rounded-xl bg-surface-container-low border border-dashed border-outline-variant"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">
                  {editKategoriId ? "Edit kategori" : "Tambah kategori"}
                </span>
                {editKategoriId && (
                  <button
                    type="button"
                    className="text-xs font-bold text-primary hover:underline"
                    onClick={handleBatalEditKategori}
                  >
                    Batal edit
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="flex flex-col gap-1 sm:col-span-2">
                  <span className="text-xs font-bold text-on-surface-variant">Nama kategori</span>
                  <input
                    className="h-9 px-3 rounded-lg bg-surface-container-lowest text-sm text-on-surface focus:ring-2 focus:ring-primary focus:outline-none transition-all"
                    type="text"
                    maxLength={80}
                    placeholder="mis. Keamanan &amp; Pos Ronda"
                    value={formKategori.nama}
                    onChange={(e) => setFormKategori({ ...formKategori, nama: e.target.value })}
                  />
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-xs font-bold text-on-surface-variant">Nominal default (Rp)</span>
                  <input
                    className="h-9 px-3 rounded-lg bg-surface-container-lowest text-sm text-on-surface font-mono focus:ring-2 focus:ring-primary focus:outline-none transition-all"
                    type="number"
                    min={0}
                    step={1000}
                    placeholder="50000"
                    value={formKategori.nominal}
                    onChange={(e) => setFormKategori({ ...formKategori, nominal: e.target.value })}
                  />
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-xs font-bold text-on-surface-variant">Sifat</span>
                  <select
                    className="h-9 px-3 rounded-lg bg-surface-container-lowest text-sm text-on-surface focus:ring-2 focus:ring-primary focus:outline-none transition-all"
                    value={formKategori.sifat}
                    onChange={(e) =>
                      setFormKategori({ ...formKategori, sifat: e.target.value as SifatIuran })
                    }
                  >
                    {sifatIuranOpsi.map((s) => (
                      <option key={s} value={s}>
                        {sifatIuranLabel[s]}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex flex-col gap-1 sm:col-span-2">
                  <span className="text-xs font-bold text-on-surface-variant">Tipe tarif</span>
                  <select
                    className="h-9 px-3 rounded-lg bg-surface-container-lowest text-sm text-on-surface focus:ring-2 focus:ring-primary focus:outline-none transition-all"
                    value={formKategori.tipe}
                    onChange={(e) =>
                      setFormKategori({ ...formKategori, tipe: e.target.value as TipeTarif })
                    }
                  >
                    {tipeTarifOpsi.map((t) => (
                      <option key={t} value={t}>
                        {tipeTarifLabel[t]}
                      </option>
                    ))}
                  </select>
                  <span className="text-[11px] text-on-surface-variant leading-relaxed">
                    {PETUNJUK_TIPE[formKategori.tipe]}
                  </span>
                </label>
              </div>

              <div className="flex items-center justify-end gap-2">
                <button
                  type="submit"
                  className="h-9 px-4 rounded-lg bg-primary text-on-primary text-xs font-bold hover:bg-primary-container transition-colors inline-flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-[14px]">
                    {editKategoriId ? "save" : "add"}
                  </span>
                  {editKategoriId ? "Simpan Perubahan" : "Tambah Kategori"}
                </button>
              </div>
            </form>

            <div className="flex items-center justify-end gap-3 pt-2 border-t border-surface-container-high">
              <button
                className="h-11 px-6 rounded-xl bg-primary text-on-primary text-sm font-bold shadow-md hover:bg-primary-container active:scale-[0.98] transition-all"
                onClick={() => setShowCategoryModal(false)}
              >
                Selesai
              </button>
            </div>
          </div>
        </div>
      )}

      {detailRumah && (
        <div className="fixed inset-0 z-50 bg-on-background/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg mx-4 sm:mx-auto rounded-2xl bg-surface-container-lowest shadow-2xl p-6 flex flex-col gap-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary-container flex items-center justify-center text-on-primary-container">
                  <span className="material-symbols-outlined text-[22px]">receipt_long</span>
                </div>
                <div>
                  <h3 className="text-base font-bold text-on-surface">{detailRumah.alamat}</h3>
                  <p className="text-xs text-on-surface-variant">
                    {detailRumah.periode} · <span className="font-mono">{detailRumah.kkCount} KK</span> ·{" "}
                    <span className="font-mono">{detailRumah.unitR4} unit R4</span>
                  </p>
                </div>
              </div>
              <button
                className="w-8 h-8 rounded-lg bg-surface-container flex items-center justify-center text-on-surface-variant hover:text-on-surface"
                onClick={() => setDetailRumah(null)}
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <div className="space-y-2">
              <h4 className="text-xs font-bold text-on-surface uppercase tracking-wider">Rincian Tagihan</h4>
              {kategoriTagihan(kategoriIuran).map((k) => (
                <div key={k.id} className="flex items-center justify-between gap-3 p-3 rounded-xl bg-surface-container-low">
                  <div>
                    <span className="text-sm text-on-surface block">{k.nama}</span>
                    <span className="text-xs text-on-surface-variant font-mono">
                      {formatRupiah(k.nominal)}
                      {k.tipe === "per_unit" ? ` × ${detailRumah.unitR4} unit R4` : ""}
                    </span>
                  </div>
                  <span className="text-sm font-bold text-on-surface font-mono shrink-0">
                    {formatRupiah(
                      k.tipe === "per_unit" ? k.nominal * detailRumah.unitR4 : k.nominal
                    )}
                  </span>
                </div>
              ))}
              {kategoriTagihan(kategoriIuran).length === 0 && (
                <div className="py-4 text-center text-sm text-on-surface-variant">
                  Belum ada kategori iuran. Atur kategori terlebih dahulu.
                </div>
              )}
              <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-primary-container/40">
                <span className="text-sm font-bold text-on-surface">Total Tagihan</span>
                <span className="text-base font-extrabold text-primary font-mono">
                  {formatRupiah(hitungIuranBulanan(kategoriIuran, detailRumah.unitR4))}
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <h4 className="text-xs font-bold text-on-surface uppercase tracking-wider">Riwayat Pembayaran</h4>
              {(() => {
                const riwayat = pembayaran.filter((p) => shortAlamat(p.alamat) === detailRumah.alamat);
                if (riwayat.length === 0) {
                  return (
                    <div className="py-6 text-center text-sm text-on-surface-variant rounded-xl bg-surface-container-low">
                      Belum ada riwayat pembayaran untuk alamat ini.
                    </div>
                  );
                }
                return riwayat.map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-3 p-3 rounded-xl bg-surface-container-low">
                    <div className="flex items-center gap-2.5">
                      <span className="material-symbols-outlined text-[18px] text-on-surface-variant">{p.metodeIcon}</span>
                      <div>
                        <span className="text-sm text-on-surface block">
                          {p.periode} · <span className="text-xs text-on-surface-variant">{p.metode}</span>
                        </span>
                        <span className="text-xs text-on-surface-variant font-mono">{p.tanggal}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-sm font-bold text-on-surface font-mono">{formatRupiah(p.jumlah)}</span>
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold ${badgeFor(p.status)}`}>
                        <span className="w-1.5 h-1.5 rounded-full bg-current opacity-60" />
                        {p.status}
                      </span>
                      {p.status === "Lunas" && (
                        <button
                          title="Unduh kuitansi PDF"
                          aria-label={`Unduh kuitansi pembayaran ${p.nama}`}
                          className="w-8 h-8 rounded-lg bg-surface-container flex items-center justify-center text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-all shrink-0"
                          onClick={() => void unduhKuitansiRt(p)}
                        >
                          <span className="material-symbols-outlined text-[18px]">download</span>
                        </button>
                      )}
                    </div>
                  </div>
                ));
              })()}
            </div>
          </div>
        </div>
      )}

      {/* B9 · konfirmasi generate tagihan bulanan — idempoten di server, jadi
          klik ulang tidak pernah menggandakan tagihan. */}
      {konfirmasiGenerate && (
        <KonfirmasiDialog
          judul="Buat Tagihan Bulan Ini"
          pesan={
            "Server akan membuat tagihan untuk seluruh warga aktif sesuai kategori iuran " +
            "pada periode berjalan. Tagihan yang sudah tercatat akan DILEWATI (tidak dobel); " +
            "tagihan yang belum teralokasi disesuaikan dengan profil iuran terbaru warga."
          }
          ikon="calendar_add_on"
          aksen="primary"
          labelYa="Buat Tagihan"
          sedang={generateSedang}
          onBatal={() => {
            if (!generateSedang) setKonfirmasiGenerate(false);
          }}
          onYa={() => void handleGenerateTagihan()}
          detail={
            <div className="p-3 rounded-xl bg-surface-container-low space-y-1.5">
              <div className="text-[11px] text-on-surface-variant uppercase tracking-wider font-semibold">
                Kategori ikut digenerate
              </div>
              {kategoriServer.filter((k) => k.statusAktif).length === 0 ? (
                <div className="text-xs text-on-surface-variant">
                  Belum ada kategori aktif dari server — muat ulang halaman bila ragu.
                </div>
              ) : (
                kategoriServer
                  .filter((k) => k.statusAktif)
                  .map((k) => (
                    <div key={k.id} className="flex items-center justify-between gap-3 text-xs">
                      <span className="text-on-surface font-semibold">{k.nama}</span>
                      <span className="text-on-surface-variant font-mono">
                        {k.tipeTarif === "insidental"
                          ? "manual"
                          : k.tipeTarif === "per_unit"
                            ? `${formatRupiah(k.nominalDefault)} / unit`
                            : formatRupiah(k.nominalDefault)}
                      </span>
                    </div>
                  ))
              )}
            </div>
          }
        />
      )}

      {/* B9 · profil iuran warga — override nominal & jumlah unit R4 yang
          dipakai generate tagihan berikutnya (PUT wajib CSRF). */}
      {profilTarget && (
        <div className="fixed inset-0 z-50 bg-on-background/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg mx-4 sm:mx-auto rounded-2xl bg-surface-container-lowest shadow-2xl p-6 flex flex-col gap-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary-container flex items-center justify-center text-on-primary-container">
                  <span className="material-symbols-outlined text-[22px]">manage_accounts</span>
                </div>
                <div>
                  <h3 className="text-base font-bold text-on-surface">Profil Iuran — {profilTarget.nama}</h3>
                  <p className="text-xs text-on-surface-variant">{profilTarget.alamat}</p>
                </div>
              </div>
              <button
                className="w-8 h-8 rounded-lg bg-surface-container flex items-center justify-center text-on-surface-variant hover:text-on-surface"
                onClick={() => {
                  if (!profilSedang) setProfilTarget(null);
                }}
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            {profilBaris === null ? (
              <div className="py-8 text-center rounded-xl bg-surface-container-low">
                <span className="material-symbols-outlined text-[32px] text-on-surface-variant block mb-2 animate-spin">
                  progress_activity
                </span>
                <p className="text-sm text-on-surface-variant">Memuat profil iuran…</p>
              </div>
            ) : profilBaris.length === 0 ? (
              <div className="py-8 text-center rounded-xl bg-surface-container-low">
                <span className="material-symbols-outlined text-[32px] text-on-surface-variant block mb-2">cloud_off</span>
                <p className="text-sm text-on-surface-variant">
                  Server tidak terjangkau — profil iuran tidak dapat diubah pada mode demo.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {profilBaris.map((b) => {
                  const f = profilForm[b.kategoriId] ?? { nominal: "", unit: "1" };
                  return (
                    <div key={b.kategoriId} className="p-3 rounded-xl bg-surface-container-low space-y-2">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm font-bold text-on-surface">{b.nama}</span>
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-primary-container/50 text-on-primary-container text-[10px] font-bold uppercase tracking-wider">
                          {tipeTarifLabel[b.tipeTarif]}
                        </span>
                      </div>
                      <div className="text-[11px] text-on-surface-variant font-mono">
                        Default: {formatRupiah(b.nominalDefault)}
                        {b.tipeTarif === "per_unit" ? " / unit R4" : ""}
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <label className="flex flex-col gap-1">
                          <span className="text-[11px] font-bold text-on-surface-variant">
                            Nominal khusus (Rp)
                          </span>
                          <input
                            className="h-9 px-3 rounded-lg bg-surface-container-lowest text-sm text-on-surface font-mono focus:ring-2 focus:ring-primary focus:outline-none transition-all"
                            type="number"
                            min={0}
                            step={1000}
                            placeholder={String(b.nominalDefault)}
                            title="Kosongkan untuk mengikuti nominal default kategori"
                            value={f.nominal}
                            onChange={(e) =>
                              setProfilForm((prev) => ({
                                ...prev,
                                [b.kategoriId]: { ...f, nominal: e.target.value },
                              }))
                            }
                          />
                        </label>
                        {b.tipeTarif === "per_unit" && (
                          <label className="flex flex-col gap-1">
                            <span className="text-[11px] font-bold text-on-surface-variant">
                              Jumlah unit R4
                            </span>
                            <input
                              className="h-9 px-3 rounded-lg bg-surface-container-lowest text-sm text-on-surface font-mono focus:ring-2 focus:ring-primary focus:outline-none transition-all"
                              type="number"
                              min={1}
                              max={999}
                              step={1}
                              value={f.unit}
                              onChange={(e) =>
                                setProfilForm((prev) => ({
                                  ...prev,
                                  [b.kategoriId]: { ...f, unit: e.target.value },
                                }))
                              }
                            />
                          </label>
                        )}
                      </div>
                      {b.tipeTarif === "per_unit" && (
                        <div className="text-[11px] text-on-surface-variant">
                          Tagihan per bulan:{" "}
                          <span className="font-mono font-bold text-on-surface">
                            {formatRupiah(b.nominalDefault * (Number(f.unit) || 0))}
                          </span>{" "}
                          {f.nominal.trim() !== "" &&
                            Number.isFinite(Number(f.nominal)) &&
                            Number(f.nominal) > 0 && (
                              <span className="text-on-surface-variant">
                                (khusus: {formatRupiah(Number(f.nominal) * (Number(f.unit) || 0))})
                              </span>
                            )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-2 border-t border-surface-container-high">
              <button
                type="button"
                className="h-11 px-4 rounded-xl text-on-surface-variant text-sm hover:bg-surface-container-high transition-colors disabled:opacity-60"
                disabled={profilSedang}
                onClick={() => setProfilTarget(null)}
              >
                Batal
              </button>
              <button
                type="button"
                className="h-11 px-6 rounded-xl bg-primary text-on-primary text-sm font-bold shadow-md hover:bg-primary-container active:scale-[0.98] transition-all flex items-center gap-2 disabled:opacity-60"
                disabled={profilSedang || profilBaris === null}
                onClick={() => void handleSimpanProfilIuran()}
              >
                <span className="material-symbols-outlined text-[18px]">save</span>
                {profilSedang ? "Menyimpan…" : "Simpan Profil Iuran"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
