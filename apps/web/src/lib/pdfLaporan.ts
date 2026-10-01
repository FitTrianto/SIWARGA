// ---------------------------------------------------------------------------
// pdfLaporan — generator dokumen PDF (A4, satuan mm) untuk Laporan Bulanan RT
// dan Laporan Agregat Lintas-RT RW, memakai jsPDF + jspdf-autotable.
//
// Struktur dokumen (sesuai permintaan): sampul dengan banner instansi,
// daftar isi bernomor halaman, bagian tabel, grafik batang vektor, dan
// blok tanda tangan pengurus RT/RW.
// ---------------------------------------------------------------------------
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { tenant, generateNoSurat, getMonthName } from "./tenant";
import { formatRupiah, type RtAgregat } from "./shared";

type RGB = [number, number, number];

const W = 210;
const H = 297;
const M = 16;
const CW = W - 2 * M; // lebar konten = 178 mm

/** Warna mengikuti token desain aplikasi (packages/ui/preset.js). */
const C = {
  primer: [0, 101, 44] as RGB, //   #00652c
  primerTua: [0, 74, 32] as RGB, //  #004a20
  sekunder: [155, 69, 0] as RGB, //  #9b4500 (kepatuhan "Baik")
  tersier: [178, 0, 16] as RGB, //   #b20010 (kepatuhan "Cukup")
  error: [186, 26, 26] as RGB, //    #ba1a1a (kurang / pengeluaran)
  tinta: [19, 27, 46] as RGB, //     #131b2e (on-surface)
  abu: [96, 106, 96] as RGB, //      teks sekunder
  garis: [214, 219, 236] as RGB, //  outline-variant
  kartu: [250, 248, 255] as RGB, //  surface
  panel: [234, 237, 255] as RGB, //  surface-container
  putih: [255, 255, 255] as RGB,
  hijauMuda: [174, 231, 190] as RGB, // teks aksen di atas band primer
  barBg: [233, 236, 245] as RGB, //  latar bar grafik
};

const setF = (d: jsPDF, c: RGB) => d.setFillColor(c[0], c[1], c[2]);
const setT = (d: jsPDF, c: RGB) => d.setTextColor(c[0], c[1], c[2]);
const setG = (d: jsPDF, c: RGB) => d.setDrawColor(c[0], c[1], c[2]);

const rp = formatRupiah;
const or = (n: number) => n.toLocaleString("id-ID");

/** "Oktober" → 10 (untuk nomor dokumen). */
export function angkaBulan(namaBulan: string): number {
  for (let i = 1; i <= 12; i++) if (getMonthName(i) === namaBulan) return i;
  return new Date().getMonth() + 1;
}

function tanggalPanjang(): string {
  return new Date().toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
}

/** Warna kepatuhan mengikuti legenda aplikasi: Baik ≥90, Cukup ≥80, Kurang <80. */
function warnaKepatuhan(persen: number): RGB {
  if (persen >= 90) return C.sekunder;
  if (persen >= 80) return C.tersier;
  return C.error;
}

interface BagianIsi {
  judul: string;
  halaman: number;
}

// ===========================================================================
// Komponen halaman
// ===========================================================================

/** Sampul: band banner instansi + metadata + kartu KPI + catatan dokumen. */
function gambarSampul(
  doc: jsPDF,
  o: {
    eyebrow: string;
    judul: string;
    sub: string;
    meta: { label: string; nilai: string }[];
    kpi: { label: string; nilai: string; warna: RGB; catatan?: string }[];
    catatan: string[];
  }
): void {
  // — Band banner (banner RT/RW) —
  setF(doc, C.primer);
  doc.rect(0, 0, W, 46, "F");
  setF(doc, C.sekunder);
  doc.rect(0, 46, W, 2.4, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  setT(doc, C.hijauMuda);
  doc.text("SIWARGA — PLATFORM TATA KELOLA RT & RW DIGITAL TERPADU", M, 14);

  doc.setFontSize(19);
  setT(doc, C.putih);
  doc.text(o.judul, M, 26.5);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(o.sub, M, 34);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  setT(doc, C.hijauMuda);
  doc.text(o.eyebrow, M, 42);

  // — Grid metadata 2×2 —
  const bw = (CW - 8) / 2;
  o.meta.forEach((m, i) => {
    const x = M + (i % 2) * (bw + 8);
    const y = 55 + Math.floor(i / 2) * 26;
    setF(doc, C.kartu);
    setG(doc, C.garis);
    doc.setLineWidth(0.3);
    doc.roundedRect(x, y, bw, 21, 3, 3, "FD");
    setF(doc, C.primer);
    doc.rect(x, y + 1, 1.6, 19, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    setT(doc, C.abu);
    doc.text(m.label.toUpperCase(), x + 6, y + 7.5);
    doc.setFontSize(11);
    setT(doc, C.tinta);
    doc.text(m.nilai, x + 6, y + 16);
  });

  // — Kartu KPI 2×2 —
  setF(doc, C.primer);
  doc.rect(M, 113, 26, 2, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  setT(doc, C.tinta);
  doc.text("Ringkasan Cepat", M, 110.5);

  o.kpi.forEach((k, i) => {
    const x = M + (i % 2) * (bw + 8);
    const y = 120 + Math.floor(i / 2) * 30;
    setF(doc, C.kartu);
    setG(doc, C.garis);
    doc.setLineWidth(0.3);
    doc.roundedRect(x, y, bw, 25, 3, 3, "FD");
    setF(doc, k.warna);
    doc.roundedRect(x, y, bw, 1.6, 0.8, 0.8, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    setT(doc, C.abu);
    doc.text(k.label.toUpperCase(), x + 6, y + 8);
    doc.setFontSize(15);
    setT(doc, k.warna);
    doc.text(k.nilai, x + 6, y + 18);
    if (k.catatan) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      setT(doc, C.abu);
      doc.text(k.catatan, x + 6, y + 23.5);
    }
  });

  // — Catatan dokumen —
  setF(doc, C.primer);
  doc.rect(M, 188, 18, 1.6, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  setT(doc, C.tinta);
  doc.text("CATATAN DOKUMEN", M, 196);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  setT(doc, C.abu);
  const teks = o.catatan.join(" ");
  doc.text(doc.splitTextToSize(teks, CW), M, 202, { lineHeightFactor: 1.55 });

  doc.setFontSize(8);
  doc.text(
    `Dokumen dihasilkan otomatis oleh Platform SIWARGA — ${tanggalPanjang()}.`,
    M,
    H - 18
  );
}

/** Halaman daftar isi (dibuat kosong lebih dulu, diisi setelah semua bagian selesai). */
function buatHalamanDaftarIsi(doc: jsPDF, sub: string): void {
  doc.addPage();
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  setT(doc, C.tinta);
  doc.text("DAFTAR ISI", M, 27);
  setF(doc, C.primer);
  doc.rect(M, 31, 26, 2.2, "F");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  setT(doc, C.abu);
  doc.text(sub, M, 39);
}

/** Isi daftar isi dengan nomor bagian + titik-titik + nomor halaman. */
function isiDaftarIsi(doc: jsPDF, bagian: BagianIsi[]): void {
  doc.setPage(2);
  let y = 54;
  bagian.forEach((b, i) => {
    const xPage = M + CW;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    setT(doc, C.primer);
    doc.text(`${i + 1}.`, M, y);

    const xJudul = M + 10;
    setT(doc, C.tinta);
    const lebarJudul = doc.getTextWidth(b.judul);
    doc.text(b.judul, xJudul, y);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    setT(doc, C.abu);
    const xAwalTitik = xJudul + lebarJudul + 3;
    const lebarHal = doc.getTextWidth(String(b.halaman));
    const xAkhirTitik = xPage - lebarHal - 5;
    if (xAkhirTitik > xAwalTitik + 4) {
      const wTitik = doc.getTextWidth(".");
      const jumlah = Math.floor((xAkhirTitik - xAwalTitik) / wTitik);
      doc.text(".".repeat(Math.max(4, jumlah)), xAwalTitik, y);
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    setT(doc, C.tinta);
    doc.text(String(b.halaman), xPage, y, { align: "right" });
    y += 10;
  });
}

/** Halaman baru untuk suatu bagian; mencatat nomor halaman untuk daftar isi. */
function mulaiBagian(doc: jsPDF, bagian: BagianIsi[], judul: string, sub: string): number {
  doc.addPage();
  bagian.push({ judul, halaman: doc.getCurrentPageInfo().pageNumber });

  const y = M + 11;
  setF(doc, C.primer);
  doc.roundedRect(M, y - 7, 9.5, 9.5, 2, 2, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  setT(doc, C.putih);
  doc.text(String(bagian.length), M + 4.75, y, { align: "center" });

  doc.setFontSize(14);
  setT(doc, C.tinta);
  doc.text(judul, M + 14, y);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  setT(doc, C.abu);
  doc.text(sub, M + 14, y + 6);

  setG(doc, C.primer);
  doc.setLineWidth(0.7);
  doc.line(M, y + 10.5, M + CW, y + 10.5);

  return y + 17;
}

/** Tabel rapi (autotable): kepala hijau primer, zebra lembut, kaki total. */
function tabel(
  doc: jsPDF,
  startY: number,
  head: string[],
  body: string[][],
  opsi: { kanan?: number[]; foot?: string[] } = {}
): number {
  const columnStyles: Record<string, { halign: "right" }> = {};
  (opsi.kanan ?? []).forEach((i) => (columnStyles[String(i)] = { halign: "right" }));

  autoTable(doc, {
    head: [head],
    body,
    ...(opsi.foot ? { foot: [opsi.foot] } : {}),
    startY,
    margin: { left: M, right: M, top: M, bottom: 18 },
    theme: "grid",
    styles: {
      font: "helvetica",
      fontSize: 9,
      cellPadding: 2.3,
      textColor: C.tinta,
      lineColor: C.garis,
      lineWidth: 0.1,
      valign: "middle",
      overflow: "linebreak",
    },
    headStyles: {
      fillColor: C.primer,
      textColor: C.putih,
      fontStyle: "bold",
      fontSize: 9,
    },
    footStyles: {
      fillColor: C.panel,
      textColor: C.tinta,
      fontStyle: "bold",
    },
    alternateRowStyles: { fillColor: C.kartu },
    columnStyles,
  });

  const akhir = (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY;
  return akhir ?? startY + 20;
}

/** Grafik batang horizontal vektor: label — bar — nilai. */
function grafikBatang(
  doc: jsPDF,
  startY: number,
  judul: string,
  sub: string,
  items: { label: string; nilai: number; warna: RGB }[],
  fmt: (n: number) => string,
  maks?: number
): number {
  let y = startY;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11.5);
  setT(doc, C.tinta);
  doc.text(judul, M, y);
  y += 5.5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  setT(doc, C.abu);
  doc.text(sub, M, y);
  y += 6;

  if (items.length === 0) {
    setF(doc, C.kartu);
    doc.roundedRect(M, y, CW, 14, 3, 3, "F");
    doc.setFontSize(9);
    doc.text("Tidak ada data untuk ditampilkan pada periode ini.", M + 6, y + 8.5);
    return y + 19;
  }

  const wLab = 46;
  const xBar = M + wLab + 3;
  const wBar = CW - wLab - 3 - 37;
  const xNilai = M + CW;
  const nilaiMaks = maks ?? Math.max(...items.map((i) => i.nilai), 1);

  for (const it of items) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    setT(doc, C.tinta);
    doc.text(it.label, M, y + 4.4);
    setF(doc, C.barBg);
    doc.roundedRect(xBar, y, wBar, 6.2, 3.1, 3.1, "F");
    const w = Math.max(2.4, Math.min(1, it.nilai / nilaiMaks) * wBar);
    setF(doc, it.warna);
    doc.roundedRect(xBar, y, w, 6.2, 3.1, 3.1, "F");
    doc.setFont("helvetica", "bold");
    setT(doc, C.tinta);
    doc.text(fmt(it.nilai), xNilai, y + 4.4, { align: "right" });
    y += 9.4;
  }

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  setT(doc, C.abu);
  doc.text("0", xBar, y + 0.5);
  doc.text(fmt(nilaiMaks), xBar + wBar, y + 0.5, { align: "right" });
  return y + 6;
}

/** Legenda titik warna (mis. Baik/Cukup/Kurang). */
function legenda(doc: jsPDF, startY: number, items: { warna: RGB; teks: string }[]): number {
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  setT(doc, C.abu);
  let x = M;
  for (const it of items) {
    setF(doc, it.warna);
    doc.circle(x + 1.6, startY - 1.2, 1.6, "F");
    doc.text(it.teks, x + 5.5, startY);
    x += 5.5 + doc.getTextWidth(it.teks) + 10;
  }
  return startY + 4;
}

/** Paragraf (auto-wrap) pada margin kiri. */
function paragraf(
  doc: jsPDF,
  startY: number,
  teks: string,
  opsi: { warna?: RGB; size?: number; lebar?: number } = {}
): number {
  const size = opsi.size ?? 9;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(size);
  setT(doc, opsi.warna ?? C.abu);
  const baris = doc.splitTextToSize(teks, opsi.lebar ?? CW) as string[];
  doc.text(baris, M, startY, { lineHeightFactor: 1.55 });
  return startY + baris.length * (size * 1.55 * 0.3528) + 2;
}

/** Kotak catatan dengan aksen kiri (untuk catatan privasi/ringkasan angka). */
function kotakInfo(doc: jsPDF, startY: number, teks: string): number {
  const size = 8.5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(size);
  const baris = doc.splitTextToSize(teks, CW - 14) as string[];
  const h = baris.length * 4.6 + 8;
  setF(doc, C.panel);
  doc.roundedRect(M, startY, CW, h, 3, 3, "F");
  setF(doc, C.primer);
  doc.rect(M, startY, 1.7, h, "F");
  setT(doc, C.tinta);
  doc.text(baris, M + 7, startY + 5.6, { lineHeightFactor: 1.55 });
  return startY + h + 5;
}

/** Blok tanda tangan dua kolom: Mengetahui (kiri) & Dibuat oleh (kanan). */
function tandaTangan(
  doc: jsPDF,
  startY: number,
  kiri: { atas: string; jabatan: string; nama: string; tanggal?: string },
  kanan: { atas: string; jabatan: string; nama: string; tanggal?: string }
): number {
  const colW = (CW - 8) / 2;
  const gambar = (x: number, b: typeof kiri) => {
    let y = startY;
    if (b.tanggal) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.5);
      setT(doc, C.tinta);
      doc.text(b.tanggal, x, y);
      y += 5.6;
    }
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    setT(doc, C.tinta);
    doc.text(b.atas, x, y);
    doc.text(b.jabatan, x, y + 5.4);
    setG(doc, C.garis);
    doc.setLineWidth(0.4);
    doc.line(x, y + 27, x + colW, y + 27);
    if (b.nama) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10.5);
      setT(doc, C.tinta);
      doc.text(b.nama, x, y + 32.5);
    }
  };
  gambar(M, kiri);
  gambar(M + colW + 8, kanan);
  return startY + 44;
}

/** Footer setiap halaman: identitas kiri + "Halaman x dari n" kanan. */
function beriFooter(doc: jsPDF, teksKiri: string): void {
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    setG(doc, C.garis);
    doc.setLineWidth(0.3);
    doc.line(M, H - 13, M + CW, H - 13);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    setT(doc, C.abu);
    doc.text(teksKiri, M, H - 9);
    doc.setFont("helvetica", "bold");
    setT(doc, C.tinta);
    doc.text(`Halaman ${i} dari ${n}`, M + CW, H - 9, { align: "right" });
  }
  doc.setPage(1);
}

// ===========================================================================
// Laporan 1 — Laporan Bulanan RT
// ===========================================================================

export interface DataLaporanRt {
  periode: string;
  bulan: number;
  tahun: number;
  /** Nama Ketua RT dari daftar pengurus (state aplikasi). */
  ketuaRt: string;
  pendapatan: { kategori: string; target: number; terealisasi: number; persentase: number }[];
  pengeluaran: { kategori: string; transaksi: number; realisasi: number; porsi: number }[];
  totalTarget: number;
  totalPendapatan: number;
  rataPendapatan: number;
  totalPengeluaran: number;
  totalTransaksi: number;
  surplus: number;
  kepatuhan: number;
  rekap: { terkumpul: number; tunggakan: number; lunasCount: number; belumCount: number };
  populasi: { kk: number; jiwa: number };
  hunian: { total: number; terisi: number; multi: number; kosong: number };
  wargaAktif: number;
  persuratan: { status: string; jumlah: number }[];
  totalSurat: number;
}

export function buatPdfLaporanRt(d: DataLaporanRt): jsPDF {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const tanggal = tanggalPanjang();
  const noDok = generateNoSurat("LAP", d.bulan, d.tahun, 1);
  const tingkatHunian = d.hunian.total ? Math.round((d.hunian.terisi / d.hunian.total) * 100) : 0;

  // — Halaman 1: sampul + banner RT —
  gambarSampul(doc, {
    eyebrow: `LAPORAN BULANAN • PERIODE ${d.periode.toUpperCase()}`,
    judul: `LAPORAN BULANAN ${tenant.rtFull.toUpperCase()} / ${tenant.rwFull.toUpperCase()}`,
    sub: `${tenant.perumahan} — Kel. ${tenant.kelurahan}, Kec. ${tenant.kecamatan}, ${tenant.kota}`,
    meta: [
      { label: "Periode Laporan", nilai: d.periode },
      { label: "Tanggal Terbit", nilai: tanggal },
      { label: "Nomor Dokumen", nilai: noDok },
      { label: "Tujuan", nilai: "Arsip & Pelaporan Internal RT" },
    ],
    kpi: [
      {
        label: "Total Pendapatan",
        nilai: rp(d.rekap.terkumpul),
        warna: C.sekunder,
        catatan: `Target ${rp(d.totalTarget)} • Kepatuhan ${d.kepatuhan.toFixed(1)}%`,
      },
      {
        label: "Total Pengeluaran",
        nilai: rp(d.totalPengeluaran),
        warna: C.error,
        catatan: `${d.totalTransaksi} transaksi • ${d.pengeluaran.length} kategori`,
      },
      {
        label: d.surplus >= 0 ? "Surplus Operasional" : "Defisit Operasional",
        nilai: `${d.surplus >= 0 ? "+" : "-"}${rp(Math.abs(d.surplus))}`,
        warna: d.surplus >= 0 ? C.primer : C.error,
        catatan: "Pendapatan dikurangi pengeluaran",
      },
      {
        label: "Kepatuhan Iuran",
        nilai: `${d.kepatuhan.toFixed(1)}%`,
        warna: warnaKepatuhan(d.kepatuhan),
        catatan: `${d.rekap.lunasCount} rumah lunas • ${d.rekap.belumCount} belum`,
      },
    ],
    catatan: [
      `Laporan ini disusun otomatis oleh Platform SIWARGA berdasarkan data kependudukan, iuran, kas, dan persuratan ${tenant.rtFull} yang tercatat pada sistem hingga tanggal terbit. Seluruh angka bersifat agregat per kategori; rincian per warga tersedia pada modul Iuran dan Data Warga di Portal RT.`,
    ],
  });

  // — Halaman 2: daftar isi (diisi setelah bagian selesai) —
  const bagian: BagianIsi[] = [];
  buatHalamanDaftarIsi(doc, `Laporan Bulanan ${tenant.label} — Periode ${d.periode}`);

  // — 1. Ringkasan Kependudukan —
  let y = mulaiBagian(
    doc,
    bagian,
    "Ringkasan Kependudukan",
    `Data kependudukan & hunian ${tenant.rtFull} per akhir periode ${d.periode}`
  );
  y = tabel(
    doc,
    y,
    ["Indikator", "Nilai"],
    [
      ["Total Keluarga (KK)", `${or(d.populasi.kk)} KK`],
      ["Total Jiwa", `${or(d.populasi.jiwa)} orang`],
      ["Rumah Terisi", `${d.hunian.terisi} dari ${d.hunian.total} unit (${tingkatHunian}%)`],
      ["Rumah Kosong", `${d.hunian.kosong} unit`],
      ["Rumah Multi-KK", `${d.hunian.multi} unit`],
      ["Warga Aktif Portal Warga", `${or(d.wargaAktif)} orang`],
    ],
    { kanan: [1] }
  );
  y = paragraf(
    doc,
    y + 7,
    `Tingkat hunian ${tenant.rtFull} tercatat ${tingkatHunian}% dengan ${d.hunian.multi} rumah dihuni lebih dari satu Kartu Keluarga. Keaktifan Portal Warga (${or(d.wargaAktif)} akun) menunjukkan tingkat adopsi layanan digital warga pada periode ${d.periode}.`
  );

  // — 2. Rekapitulasi Pendapatan —
  y = mulaiBagian(
    doc,
    bagian,
    "Rekapitulasi Pendapatan",
    `Realisasi pemasukan per kategori iuran — periode ${d.periode}`
  );
  y = tabel(
    doc,
    y,
    ["Kategori", "Target (Rp)", "Terealisasi (Rp)", "Persentase"],
    d.pendapatan.map((p) => [p.kategori, rp(p.target), rp(p.terealisasi), `${p.persentase}%`]),
    {
      kanan: [1, 2, 3],
      foot: ["Total", rp(d.totalTarget), rp(d.totalPendapatan), `${d.rataPendapatan}%`],
    }
  );
  y = kotakInfo(
    doc,
    y + 7,
    `Rekap iuran: terkumpul ${rp(d.rekap.terkumpul)} dari target ${rp(d.totalTarget)} (kepatuhan ${d.kepatuhan.toFixed(
      1
    )}%) — ${d.rekap.lunasCount} rumah lunas, ${d.rekap.belumCount} belum lunas, tunggakan ${rp(
      d.rekap.tunggakan
    )}. Pembayaran tercatat lengkap beserta metode dan kuitansi pada modul Iuran.`
  );

  // — 3. Rekapitulasi Pengeluaran —
  y = mulaiBagian(
    doc,
    bagian,
    "Rekapitulasi Pengeluaran",
    `Realisasi pengeluaran buku kas ${tenant.rtFull} — periode ${d.periode}`
  );
  y = tabel(
    doc,
    y,
    ["Kategori", "Transaksi", "Realisasi (Rp)", "Porsi (%)"],
    d.pengeluaran.length > 0
      ? d.pengeluaran.map((p) => [p.kategori, String(p.transaksi), rp(p.realisasi), `${p.porsi}%`])
      : [["Belum ada pengeluaran kas tercatat pada periode ini.", "—", "—", "—"]],
    {
      kanan: [1, 2, 3],
      foot: [
        "Total",
        String(d.totalTransaksi),
        rp(d.totalPengeluaran),
        d.totalPengeluaran ? "100%" : "0%",
      ],
    }
  );

  // — 4. Grafik Analisa —
  y = mulaiBagian(
    doc,
    bagian,
    "Grafik Analisa",
    `Visualisasi kepatuhan iuran dan komposisi pengeluaran — periode ${d.periode}`
  );
  y = grafikBatang(
    doc,
    y,
    "Grafik 1 — Kepatuhan Iuran per Kategori",
    "Persentase ketercapaian target penerimaan per kategori iuran",
    d.pendapatan.map((p) => ({
      label: p.kategori,
      nilai: p.persentase,
      warna: warnaKepatuhan(p.persentase),
    })),
    (n) => `${n}%`,
    100
  );
  y = legenda(doc, y + 2, [
    { warna: C.sekunder, teks: "Baik (min. 90%)" },
    { warna: C.tersier, teks: "Cukup (min. 80%)" },
    { warna: C.error, teks: "Kurang (< 80%)" },
  ]);
  y += 6;
  y = grafikBatang(
    doc,
    y,
    "Grafik 2 — Pengeluaran per Kategori",
    "Realisasi buku kas menurut kategori pengeluaran",
    d.pengeluaran.map((p) => ({ label: p.kategori, nilai: p.realisasi, warna: C.error })),
    (n) => rp(n)
  );

  // — 5. Ringkasan Persuratan —
  y = mulaiBagian(
    doc,
    bagian,
    "Ringkasan Persuratan",
    `Jumlah dokumen surat per status — periode ${d.periode}`
  );
  y = tabel(
    doc,
    y,
    ["Status Surat", "Jumlah"],
    d.persuratan.map((p) => [p.status, `${p.jumlah} dokumen`]),
    { kanan: [1], foot: ["Total", `${d.totalSurat} dokumen`] }
  );
  const menungguRt = d.persuratan.find((p) => p.status === "Menunggu RT")?.jumlah ?? 0;
  y = paragraf(
    doc,
    y + 7,
    `Total ${d.totalSurat} dokumen surat tercatat pada periode ${d.periode}, dengan ${menungguRt} dokumen masih menunggu persetujuan ${tenant.rtFull}. Riwayat pengajuan dan alasan persetujuan/penolakan tersimpan pada modul Surat Pengantar.`
  );

  // — 6. Pengesahan —
  y = mulaiBagian(
    doc,
    bagian,
    "Pengesahan & Tanda Tangan Pengurus",
    "Laporan ini ditandatangani oleh pengurus RT dan diketahui pengurus RW"
  );
  y = paragraf(
    doc,
    y + 3,
    `Demikian Laporan Bulanan ${tenant.rtFull} periode ${d.periode} ini disusun dengan sebenar-benarnya dari data yang tercatat pada Platform SIWARGA dan dipertanggungjawabkan oleh pengurus di bawah tanda tangan berikut.`
  );
  y = tandaTangan(
    doc,
    y + 14,
    { atas: "Mengetahui,", jabatan: `Ketua ${tenant.rwFull} ${tenant.perumahan}`, nama: tenant.ketuaRw },
    {
      atas: "Dibuat oleh,",
      jabatan: `Ketua ${tenant.rtFull} ${tenant.perumahan}`,
      nama: d.ketuaRt,
      tanggal: `Jakarta, ${tanggal}`,
    }
  );
  y = paragraf(
    doc,
    y + 4,
    `Lampiran data pendukung: buku kas RT, rincian pembayaran warga, dan arsip surat tersedia digital pada Portal RT.`,
    { size: 8.5 }
  );

  isiDaftarIsi(doc, bagian);
  beriFooter(doc, `Laporan Bulanan ${tenant.label} • ${d.periode} • Platform SIWARGA`);
  return doc;
}

// ===========================================================================
// Laporan 2 — Laporan Agregat Lintas-RT (RW)
// ===========================================================================

export interface DataLaporanRw {
  periode: string;
  bulan: number;
  tahun: number;
  rows: RtAgregat[];
  totalKk: number;
  totalWarga: number;
  totalRumah: number;
  totalHunian: number;
  rataKepatuhan: number;
  totalTerkumpul: number;
  totalSubsidiJumlah: number;
  totalSubsidiNominal: number;
  totalTunggakan: number;
  totalPemasukan: number;
  totalPengeluaran: number;
  saldoAkhir: number;
  jumlahTransaksi: number;
}

export function buatPdfLaporanRw(d: DataLaporanRw): jsPDF {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const tanggal = tanggalPanjang();
  const noDok = generateNoSurat("LAPRW", d.bulan, d.tahun, 1);
  const tingkatHunian = d.totalRumah ? Math.round((d.totalHunian / d.totalRumah) * 100) : 0;

  // — Halaman 1: sampul + banner RW —
  gambarSampul(doc, {
    eyebrow: `LAPORAN AGREGAT LINTAS-RT • PERIODE ${d.periode.toUpperCase()}`,
    judul: `LAPORAN AGREGAT ${tenant.rwFull.toUpperCase()}`,
    sub: `${tenant.perumahan} — Kel. ${tenant.kelurahan}, Kec. ${tenant.kecamatan}, ${tenant.kota}`,
    meta: [
      { label: "Periode Laporan", nilai: d.periode },
      { label: "Tanggal Terbit", nilai: tanggal },
      { label: "Nomor Dokumen", nilai: noDok },
      { label: "Tujuan", nilai: "Kelurahan & Kecamatan" },
    ],
    kpi: [
      {
        label: "Total Keluarga",
        nilai: `${or(d.totalKk)} KK`,
        warna: C.primer,
        catatan: `${or(d.totalWarga)} jiwa di ${d.rows.length} RT`,
      },
      {
        label: "Rata-rata Kepatuhan",
        nilai: `${d.rataKepatuhan.toFixed(1)}%`,
        warna: warnaKepatuhan(d.rataKepatuhan),
        catatan: `Terkumpul ${rp(d.totalTerkumpul)}`,
      },
      {
        label: "Saldo Akhir Kas RW",
        nilai: rp(d.saldoAkhir),
        warna: C.primerTua,
        catatan: `${d.jumlahTransaksi} transaksi tercatat`,
      },
      {
        label: "Tunggakan Agregat",
        nilai: rp(d.totalTunggakan),
        warna: C.error,
        catatan: `Subsidi ${d.totalSubsidiJumlah} rumah`,
      },
    ],
    catatan: [
      `Laporan ini memuat data agregat per RT untuk periode ${d.periode} dan disusun dalam format siap dikirim ke Kelurahan/Kecamatan. Seluruh angka iuran — termasuk subsidi/keringanan — disajikan dalam bentuk agregat per RT tanpa rincian individu warga, sesuai prinsip privasi §4.3 dan §6.4.10.`,
    ],
  });

  // — Halaman 2: daftar isi —
  const bagian: BagianIsi[] = [];
  buatHalamanDaftarIsi(doc, `Laporan Agregat Lintas-RT ${tenant.rwFull} — Periode ${d.periode}`);

  // — 1. Kependudukan —
  let y = mulaiBagian(
    doc,
    bagian,
    "Bagian A — Kependudukan",
    `Data agregat kependudukan per RT — periode ${d.periode}`
  );
  y = tabel(
    doc,
    y,
    ["RT", "KK", "Warga", "Rumah", "Hunian"],
    [
      ...d.rows.map((r) => [r.rt, String(r.kk), String(r.warga), String(r.totalRumah), String(r.hunian)]),
      ["TOTAL", String(d.totalKk), String(d.totalWarga), String(d.totalRumah), String(d.totalHunian)],
    ],
    { kanan: [1, 2, 3, 4] }
  );
  y = paragraf(
    doc,
    y + 7,
    `Secara agregat, ${tenant.rwFull} menampung ${or(d.totalKk)} Kartu Keluarga dengan ${or(
      d.totalWarga
    )} jiwa pada ${d.totalRumah} unit rumah, dan tingkat hunian ${tingkatHunian}% (${d.totalHunian} unit terisi).`
  );

  // — 2. Iuran (agregat) —
  y = mulaiBagian(
    doc,
    bagian,
    "Bagian B — Iuran (Agregat)",
    `Kepatuhan, penerimaan, subsidi, dan tunggakan per RT — periode ${d.periode}`
  );
  y = tabel(
    doc,
    y,
    ["RT", "Kepatuhan", "Terkumpul", "Subsidi (Agregat)", "Tunggakan"],
    d.rows.map((r) => [
      r.rt,
      `${r.kepatuhan}%`,
      rp(r.terkumpul),
      `${r.subsidiJumlah} rumah — ${rp(r.subsidiNominal)}`,
      rp(r.tunggakan),
    ]),
    {
      kanan: [1, 2, 3, 4],
      foot: [
        "TOTAL",
        `${d.rataKepatuhan.toFixed(1)}%`,
        rp(d.totalTerkumpul),
        `${d.totalSubsidiJumlah} rumah — ${rp(d.totalSubsidiNominal)}`,
        rp(d.totalTunggakan),
      ],
    }
  );
  y = kotakInfo(
    doc,
    y + 7,
    "Catatan: subsidi/keringanan iuran disajikan dalam bentuk agregat per RT (jumlah rumah & total nominal), tanpa rincian warga penerima — sesuai prinsip privasi §4.3 dan §6.4.10."
  );
  y = grafikBatang(
    doc,
    y + 6,
    "Grafik — Kepatuhan Iuran per RT",
    "Persentase ketercapaian iuran tiap RT pada periode berjalan",
    d.rows.map((r) => ({ label: r.rt, nilai: r.kepatuhan, warna: warnaKepatuhan(r.kepatuhan) })),
    (n) => `${n}%`,
    100
  );
  y = legenda(doc, y + 2, [
    { warna: C.sekunder, teks: "Baik (min. 90%)" },
    { warna: C.tersier, teks: "Cukup (min. 80%)" },
    { warna: C.error, teks: "Kurang (< 80%)" },
  ]);

  // — 3. Kas RW —
  y = mulaiBagian(
    doc,
    bagian,
    "Bagian C — Kas RW",
    `Ringkasan buku kas RW — periode ${d.periode}`
  );
  y = tabel(
    doc,
    y,
    ["Indikator", "Nilai"],
    [
      ["Saldo Akhir", rp(d.saldoAkhir)],
      ["Total Pemasukan", rp(d.totalPemasukan)],
      ["Total Pengeluaran", rp(d.totalPengeluaran)],
      ["Jumlah Transaksi", `${d.jumlahTransaksi} transaksi`],
    ],
    { kanan: [1] }
  );
  y += 6;
  y = grafikBatang(
    doc,
    y,
    "Grafik — Arus Kas RW",
    "Perbandingan total pemasukan dan pengeluaran buku kas RW",
    [
      { label: "Pemasukan", nilai: d.totalPemasukan, warna: C.primer },
      { label: "Pengeluaran", nilai: d.totalPengeluaran, warna: C.error },
    ],
    (n) => rp(n)
  );
  y = paragraf(
    doc,
    y + 6,
    `Kas RW dikelola terpisah dari kas RT dan bersifat append-only (hanya dapat ditambahkan, tidak diubah). Seluruh transaksi tercatat pada modul Kas RW dengan kegiatan pengguna yang tercatat pada Riwayat Aktivitas.`
  );

  // — 4. Pengesahan —
  y = mulaiBagian(
    doc,
    bagian,
    "Pengesahan & Tanda Tangan Pengurus",
    "Laporan ditandatangani pengurus RW dan diketahui pihak berwenang"
  );
  y = paragraf(
    doc,
    y + 3,
    `Demikian Laporan Agregat Lintas-RT ${tenant.rwFull} periode ${d.periode} ini disusun dengan sebenar-benarnya dari data agregat yang tercatat pada Platform SIWARGA, dan disampaikan kepada Kelurahan ${tenant.kelurahan} beserta arsip digitalnya.`
  );
  y = tandaTangan(
    doc,
    y + 14,
    {
      atas: "Mengetahui,",
      jabatan: `Kepala Kelurahan ${tenant.kelurahan}`,
      nama: "",
    },
    {
      atas: "Dibuat oleh,",
      jabatan: `Ketua ${tenant.rwFull} ${tenant.perumahan}`,
      nama: tenant.ketuaRw,
      tanggal: `Jakarta, ${tanggal}`,
    }
  );

  isiDaftarIsi(doc, bagian);
  beriFooter(doc, `Laporan Agregat ${tenant.rwFull} • ${d.periode} • Platform SIWARGA`);
  return doc;
}
