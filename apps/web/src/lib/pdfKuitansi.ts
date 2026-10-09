// ---------------------------------------------------------------------------
// pdfKuitansi — generator PDF kuitansi iuran (A5, satuan mm) untuk Portal
// Warga (unduh kuitansi sendiri) dan Portal RT (unduh kuitansi warga lunas).
//
// Keputusan desain (dicatat di laporan perbaikan iuran):
//  • Dirender di KLIEN dengan jsPDF — konsisten dengan `lib/pdfSurat.ts`
//    (B12) & `lib/pdfLaporan.ts` (B24); bekerja pula saat OFFLINE karena
//    tidak menyentuh server (unduhan TIDAK PERNAH gagal karena backend mati).
//  • Menggantikan unduhan `.txt` sebelumnya (`downloadText`) — berkas kini
//    PDF siap cetak / siap kirim, tetap memuat NOIDIK/ID baris yang bisa
//    dicek pengurus lewat riwayat.
//  • Tanpa tanda tangan palsu: kuitansi elektronik jujur menyebut status
//    sebenarnya (Lunas vs Menunggu Verifikasi) dan bila kuitansi resmi terbit.
// ---------------------------------------------------------------------------
import { jsPDF } from "jspdf";
import { tenant } from "./tenant";
import { formatRupiah } from "./shared";

type RGB = [number, number, number];

const W = 148; // A5 landscape? — potrait: 148 × 210 mm
const H = 210;
const M = 14;
const CW = W - 2 * M; // lebar konten = 120 mm

/** Warna mengikuti token desain aplikasi (sama dengan pdfSurat/pdfLaporan). */
const C = {
  primer: [0, 101, 44] as RGB, //   #00652c
  tinta: [19, 27, 46] as RGB, //     #131b2e (on-surface)
  abu: [96, 106, 96] as RGB, //      teks sekunder
  garis: [138, 146, 166] as RGB, //  outline
  latar: [240, 244, 241] as RGB, //  surface-container-low
  putih: [255, 255, 255] as RGB,
};

const setT = (d: jsPDF, c: RGB) => d.setTextColor(c[0], c[1], c[2]);
const setF = (d: jsPDF, c: RGB) => d.setFillColor(c[0], c[1], c[2]);
const setG = (d: jsPDF, c: RGB) => d.setDrawColor(c[0], c[1], c[2]);

const BULAN_PENDEK = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

/** Data yang selalu tampil di kuitansi — dipanggil dari dua portal. */
export interface DataKuitansi {
  /** "Kuitansi Pembayaran Iuran" (Lunas) / "Pengajuan Pembayaran Iuran". */
  judul: string;
  /** Referensi kuitansi (id baris pembayaran/tagihan) — dicek pengurus. */
  ref: string;
  /** Tanggal tampil, sudah diformat ("16 Okt 2026"). */
  tanggal: string;
  warga: string;
  hunian: string;
  periode: string;
  jumlah: number;
  metode: string;
  status: string;
  /** Catatan tambahan (opsional) — mis. tujuan pembayaran kondisional. */
  catatan?: string | null;
  /**
   * Batch 15E — tanggal verifikasi pengurus ("9 Okt 2026"); HANYA diisi untuk
   * baris yang benar-benar sudah disetujui server — kuitansi resmi memuat cap
   * verifikasi nyata, bukan tanggal karangan.
   */
  diverifikasi?: string | null;
}

/** Teks satu baris yang otomatis mengecil sampai muat dalam `lebar` mm. */
function teksMuat(
  doc: jsPDF,
  teks: string,
  x: number,
  y: number,
  lebar: number,
  size: number,
  berani: boolean,
  opsi: { tengah?: boolean } = {},
): void {
  let s = size;
  doc.setFont("helvetica", berani ? "bold" : "normal");
  doc.setFontSize(s);
  while (s > 6 && doc.getTextWidth(teks) > lebar) {
    s -= 0.5;
    doc.setFontSize(s);
  }
  doc.text(teks, x, y, opsi.tengah ? { align: "center" } : {});
}

/** Satu baris "Label : Nilai" dengan garis titik-titik pemisah. */
function barisField(doc: jsPDF, y: number, label: string, nilai: number | string, opsi: { tebal?: boolean } = {}): number {
  const x = M + 2;
  const xNilai = x + 44;
  setT(doc, C.abu);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.text(label, x, y);
  setT(doc, C.tinta);
  doc.setFont("helvetica", opsi.tebal ? "bold" : "normal");
  doc.setFontSize(9.5);
  const teks = typeof nilai === "number" ? formatRupiah(nilai) : nilai;
  teksMuat(doc, teks, xNilai, y, M + CW - xNilai - 2, opsi.tebal ? 10.5 : 9.5, opsi.tebal === true);
  return y + 6.5;
}

/**
 * Susun kuitansi A5. `status` menentukan judul & catatan kaki — status
 * non-Lunas TIDAK PERNAH ditulis sebagai lunas (kejujuran status, §4.4).
 */
export function buatPdfKuitansi(d: DataKuitansi): jsPDF {
  const doc = new jsPDF({ unit: "mm", format: "a5" });
  const lunas = d.status.toLowerCase() === "lunas";

  // --- Kop surat mini ------------------------------------------------------
  let y = M;
  setT(doc, C.tinta);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(tenant.rtFull, W / 2, y, { align: "center" });
  y += 4.5;
  setT(doc, C.abu);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text(tenant.perumahan, W / 2, y, { align: "center" });
  y += 3.5;
  doc.text(tenant.alamatLengkap, W / 2, y, { align: "center" });

  y += 4;
  setG(doc, C.primer);
  doc.setLineWidth(0.6);
  doc.line(M, y, M + CW, y);

  // --- Judul ---------------------------------------------------------------
  y += 9;
  setT(doc, C.primer);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  teksMuat(doc, d.judul.toUpperCase(), W / 2, y, CW, 13, true, { tengah: true });
  y += 5;
  setT(doc, C.abu);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text(`Ref. ${d.ref}`, W / 2, y, { align: "center" });

  // --- Tubuh kuitansi ------------------------------------------------------
  y += 6;
  const tinggi = 74;
  setF(doc, C.latar);
  setG(doc, C.garis);
  doc.setLineWidth(0.25);
  doc.roundedRect(M, y, CW, tinggi, 2.5, 2.5, "FD");

  y += 8;
  y = barisField(doc, y, "No. Kuitansi", d.ref);
  y = barisField(doc, y, "Tanggal", d.tanggal);
  y = barisField(doc, y, "Nama Warga", d.warga);
  y = barisField(doc, y, "Hunian", d.hunian);
  y = barisField(doc, y, "Periode Iuran", d.periode);
  y = barisField(doc, y, "Metode", d.metode);

  // Jumlah — sorot sebagai baris terpenting.
  y += 1.5;
  setF(doc, C.primer);
  doc.roundedRect(M + 4, y - 5, CW - 8, 9, 1.5, 1.5, "F");
  setT(doc, C.putih);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.text("Jumlah", M + 7, y + 0.5);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text(formatRupiah(d.jumlah), M + CW - 7, y + 0.5, { align: "right" });
  y += 7;

  y = barisField(doc, y, "Status", d.status, { tebal: true });
  // Batch 15E — cap verifikasi nyata: hanya baris yang sudah disetujui RT
  // yang membawa tanggal; baris menunggu/ditolak tidak pernah menampilkan
  // tanggal verifikasi yang tidak ada.
  if (d.diverifikasi) y = barisField(doc, y, "Diverifikasi", d.diverifikasi);
  if (d.catatan) y = barisField(doc, y, "Keterangan", d.catatan.slice(0, 60));

  // --- Keterangan kaki (jujur tentang status) -------------------------------
  y = Math.max(y, M + tinggi + 8) ;
  setT(doc, lunas ? C.primer : C.abu);
  doc.setFont("helvetica", lunas ? "bold" : "normal");
  doc.setFontSize(8.5);
  const catatanKaki = lunas
    ? "Kuitansi resmi atas pembayaran yang sudah diverifikasi Bendahara RT."
    : "Bukti pengajuan — kuitansi resmi terbit setelah diverifikasi Bendahara RT.";
  const baris = doc.splitTextToSize(catatanKaki, CW - 4) as string[];
  doc.text(baris, M + 2, y, { lineHeightFactor: 1.4 });

  // Tanda tangan elektronik (tanpa nama/nama palsu): baris pengesahan RT.
  const yTTD = y + baris.length * 4 + 14;
  setT(doc, C.tinta);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text("Pengurus RT", M + CW - 2, yTTD - 14, { align: "right" });
  setG(doc, C.garis);
  doc.setLineWidth(0.25);
  doc.line(M + CW - 42, yTTD, M + CW - 2, yTTD);

  // --- Footer --------------------------------------------------------------
  const kini = new Date();
  const cetak = `${String(kini.getDate()).padStart(2, "0")} ${BULAN_PENDEK[kini.getMonth()]} ${kini.getFullYear()}`;
  setT(doc, C.abu);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.text(`Dicetak otomatis oleh Siwarga · ${cetak}`, M + 2, H - M + 2);
  doc.text(tenant.label, M + CW - 2, H - M + 2, { align: "right" });

  return doc;
}

/** Nama berkas unduhan — selalu `.pdf` (pengganti `.txt` lama). */
export function namaBerkasKuitansi(ref: string): string {
  const aman = ref.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "iuran";
  return `kuitansi-iuran-${aman}.pdf`;
}

/** Bangun + simpan (unduh) — dipanggil via dynamic import dari halaman. */
export function simpanPdfKuitansi(d: DataKuitansi): void {
  buatPdfKuitansi(d).save(namaBerkasKuitansi(d.ref));
}
