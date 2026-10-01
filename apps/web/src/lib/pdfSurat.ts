// ---------------------------------------------------------------------------
// pdfSurat — generator PDF surat pengantar resmi (A4, satuan mm) untuk
// Portal RT & Portal Warga: kop konfigurasi per-RT (B12 · §6.6), identitas
// pemohon, tanda tangan Ketua RT, serta QR verifikasi publik `/q/:token`.
//
// Keputusan desain (dicatat di laporan tugas):
//  • Dirender di KLIEN dengan jsPDF — konsisten dengan `lib/pdfLaporan.ts`
//    (B24). `GET /rt/surat/:id/pdf` & `GET /warga/surat/:id/pdf` sengaja tidak
//    dibuat di server (deviasi terdokumentasi).
//  • QR dibuat dari `QRCodeSVG` (qrcode.react) di luar layar → SVG → PNG via
//    <canvas> → `jsPDF.addImage`. Kegagalan apa pun men-dihitung SEBAGAI TIDAK
//    ADA QR (dilewati), bukan menggagalkan unduhan — surat tetap terbit.
//  • Isi QR = tautan absolut `/q/<qrToken>`; baris demo tanpa token memakai
//    `lokal-<id>` yang lolos regex server (`[A-Za-z0-9_-]{8,64}`) sehingga
//    endpoint publik dengan JUJUR menjawab `valid: false`. Verifikasi tidak
//    pernah dipalsukan di sisi mana pun.
// ---------------------------------------------------------------------------
import { jsPDF } from "jspdf";
import type { ComponentType } from "react";
import type { Root } from "react-dom/client";
import { tenant } from "./tenant";
import { kopSuratDefault, type KopSurat, type StatusSurat } from "./shared";
import { dasarDeploy } from "./deploy";

type RGB = [number, number, number];

const W = 210;
const H = 297;
const M = 20;
const CW = W - 2 * M; // lebar konten = 170 mm

/** Warna mengikuti token desain aplikasi (packages/ui/preset.js) — sama dengan pdfLaporan. */
const C = {
  primer: [0, 101, 44] as RGB, //   #00652c
  tinta: [19, 27, 46] as RGB, //     #131b2e (on-surface)
  abu: [96, 106, 96] as RGB, //      teks sekunder
  garis: [138, 146, 166] as RGB, //  outline (lebih tegas dari outline-variant)
  putih: [255, 255, 255] as RGB,
};

const setT = (d: jsPDF, c: RGB) => d.setTextColor(c[0], c[1], c[2]);
const setF = (d: jsPDF, c: RGB) => d.setFillColor(c[0], c[1], c[2]);
const setG = (d: jsPDF, c: RGB) => d.setDrawColor(c[0], c[1], c[2]);

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
): number {
  let s = size;
  doc.setFont("helvetica", berani ? "bold" : "normal");
  doc.setFontSize(s);
  while (s > 6 && doc.getTextWidth(teks) > lebar) {
    s -= 0.5;
    doc.setFontSize(s);
  }
  doc.text(teks, x, y, opsi.tengah ? { align: "center" } : {});
  return s;
}

/** Paragraf auto-wrap pada margin kiri → y berikutnya. */
function paragraf(doc: jsPDF, startY: number, teks: string, size = 10.5, warna: RGB = C.tinta): number {
  doc.setFont("helvetica", "normal");
  doc.setFontSize(size);
  setT(doc, warna);
  const baris = doc.splitTextToSize(teks, CW) as string[];
  doc.text(baris, M, startY, { lineHeightFactor: 1.5 });
  return startY + baris.length * (size * 1.5 * 0.3528) + 2;
}

/**
 * B12 — QR verifikasi jadi PNG data-URL. Semua kegagalan (import, gambar,
 * kanvas) bernilai `null`: PDF harus tetap terunduh tanpa QR.
 */
async function qrKePng(teks: string, ukuran = 480): Promise<string | null> {
  if (typeof document === "undefined") return null;
  let kontainer: HTMLElement | null = null;
  let akar: Root | null = null;
  try {
    const [{ createElement }, { QRCodeSVG }, { createRoot }, { flushSync }] = await Promise.all([
      import("react"),
      import("qrcode.react"),
      import("react-dom/client"),
      import("react-dom"),
    ]);
    kontainer = document.createElement("div");
    kontainer.style.position = "fixed";
    kontainer.style.left = "-10000px";
    kontainer.style.top = "0";
    document.body.appendChild(kontainer);
    akar = createRoot(kontainer);
    // File ini `.ts` (bukan `.tsx`) → QR dirender dengan createElement.
    const KodeQR = QRCodeSVG as unknown as ComponentType<{ value: string; size: number; level: string }>;
    flushSync(() => {
      akar!.render(createElement(KodeQR, { value: teks, size: ukuran, level: "M" }));
    });

    const svg = kontainer.querySelector("svg");
    if (!svg) return null;
    svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    svg.setAttribute("width", String(ukuran));
    svg.setAttribute("height", String(ukuran));
    const mentah = new XMLSerializer().serializeToString(svg);
    const sumber = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(mentah)}`;

    const gambar = await new Promise<HTMLImageElement | null>((selesai) => {
      const img = new Image();
      img.onload = () => selesai(img);
      img.onerror = () => selesai(null);
      img.src = sumber;
    });
    if (!gambar) return null;

    const kanvas = document.createElement("canvas");
    kanvas.width = ukuran;
    kanvas.height = ukuran;
    const ctx = kanvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, ukuran, ukuran);
    ctx.drawImage(gambar, 0, 0, ukuran, ukuran);
    return kanvas.toDataURL("image/png");
  } catch {
    return null;
  } finally {
    try {
      akar?.unmount();
      kontainer?.remove();
    } catch {
      /* pembersihan terbaik — tidak boleh menjatuhkan unduhan */
    }
  }
}

/** Tautan absolut yang dicetak QR-nya (lihat catatan pada kepala berkas). */
export function tautanQrSurat(qrToken: string | undefined, idBaris: string | undefined): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const token = qrToken || (idBaris ? `lokal-${idBaris}` : "");
  // dasarDeploy(): prefix base bila deploy di sub-path (GitHub Pages).
  return token ? `${origin}${dasarDeploy()}q/${token}` : "";
}

/** Nama berkas unduhan yang rapi & unik per surat. */
export function namaBerkasSurat(noSurat: string, jenis: string): string {
  const dariNomor = noSurat ? noSurat.replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "") : "";
  const dariJenis = jenis.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `Surat-${dariNomor || dariJenis || "pengantar"}.pdf`;
}

/** Input pembuatan PDF surat — dipakai kedua portal agar hasilnya identik. */
export interface DataPdfSurat {
  /** Kop tersimpan RT (`GET /rt/pengaturan` / `GET /warga/surat`); `null` → kop bawaan. */
  kop: KopSurat | null;
  /** Baris surat — dipakai fallback token QR mode demo. */
  idBaris?: string;
  noSurat: string;
  jenis: string;
  pemohon: string;
  keperluan: string;
  /** Tanggal panjang Indonesia — "01 September 2026". */
  tanggal: string;
  status: StatusSurat;
  perluRw: boolean;
  /** Token QR dari server; hilang = baris demo (QR-nya dijawab `valid: false`). */
  qrToken?: string;
  /** Penandatangan — Ketua RT dari daftar pengurus. `ttd` = data-URL gambar. */
  ketua: { nama: string; jabatan: string; ttd?: string | null };
}

/**
 * B12 — susun PDF surat pengantar: kop → judul & nomor → paragraf pembuka →
 * data pemohon → paragraf penutup → blok TTD (kanan) + QR verifikasi (kiri).
 * Mengembalikan dokumen mentah; pemanggil memanggil `doc.save(...)`.
 */
export async function buatPdfSurat(d: DataPdfSurat): Promise<jsPDF> {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const kop = d.kop ?? kopSuratDefault();

  // — Kop surat (3 baris, dirata tengah) + garis ganda —
  let y = 17;
  teksMuat(doc, kop.baris1, W / 2, y, CW, 14, true, { tengah: true });
  teksMuat(doc, kop.baris2, W / 2, y + 6.6, CW, 10.5, true, { tengah: true });
  teksMuat(doc, kop.baris3, W / 2, y + 12.8, CW, 11.5, true, { tengah: true });
  y += 12.8;

  setG(doc, C.tinta);
  doc.setLineWidth(0.9);
  doc.line(M, y + 3.4, W - M, y + 3.4);
  doc.setLineWidth(0.25);
  doc.line(M, y + 5.2, W - M, y + 5.2);
  y += 14;

  // — Judul & nomor —
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  setT(doc, C.tinta);
  const judul = "SURAT PENGANTAR";
  doc.text(judul, W / 2, y, { align: "center" });
  const lebarJudul = doc.getTextWidth(judul);
  doc.setLineWidth(0.5);
  doc.line((W - lebarJudul) / 2, y + 1.8, (W + lebarJudul) / 2, y + 1.8);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);
  setT(doc, C.abu);
  doc.text(`Nomor: ${d.noSurat || "—"}`, W / 2, y + 8, { align: "center" });
  y += 17;

  // — Paragraf pembuka (identik dengan preview di Portal RT) —
  y = paragraf(
    doc,
    y,
    `Yang bertanda tangan di bawah ini, Ketua ${tenant.rtFull} ${tenant.rwFull} Kel. ${tenant.kelurahan}, ` +
      `Kec. ${tenant.kecamatan}, ${tenant.kota}, dengan ini menerangkan bahwa:`,
  );
  y += 3;

  // — Data pemohon (grid label : nilai) —
  const statusTeks =
    d.status === "Menunggu RW" ? "Menunggu RW (menunggu persetujuan Portal RW)" : d.status;
  const baris: Array<{ label: string; nilai: string }> = [
    { label: "Nama", nilai: d.pemohon },
    { label: "Jenis Surat", nilai: d.jenis },
    { label: "Keperluan", nilai: d.keperluan },
    { label: "Tanggal", nilai: d.tanggal },
    { label: "Status", nilai: statusTeks },
  ];
  const xLabel = M + 2;
  const xTitik = M + 40;
  const xNilai = M + 44;
  const lebarNilai = CW - 46;
  for (const b of baris) {
    const isi = doc.splitTextToSize(b.nilai, lebarNilai) as string[];
    const tinggi = Math.max(7, isi.length * 5.4 + 2);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10.5);
    setT(doc, C.abu);
    doc.text(b.label, xLabel, y + 4.6);
    setT(doc, C.tinta);
    doc.text(":", xTitik, y + 4.6);
    doc.text(isi, xNilai, y + 4.6, { lineHeightFactor: 1.32 });
    y += tinggi;
  }
  y += 4;

  // — Paragraf penutup + catatan status (jujur: surat belum tentu terbit) —
  y = paragraf(
    doc,
    y,
    "Demikian surat pengantar ini dibuat dengan sebenarnya untuk dapat dipergunakan sebagaimana mestinya.",
  );
  y += 2;
  if (d.status !== "Disetujui") {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9);
    setT(doc, C.abu);
    const catatan =
      `Catatan: dokumen ini berstatus "${d.status}"${
        d.perluRw ? " dan masih menunggu persetujuan Portal RW" : ""
      } — belum berlaku sebagai surat resmi sebelum diterbitkan Pengurus ` + `${tenant.rtFull}.`;
    const kalimat = doc.splitTextToSize(catatan, CW) as string[];
    doc.text(kalimat, M, y, { lineHeightFactor: 1.45 });
    y += kalimat.length * 4.4 + 3;
  }
  y += 8;

  // — Blok tanda tangan (kanan) —
  const lebarTtd = 80;
  const xTtd = W - M - lebarTtd;
  let ys = y;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);
  setT(doc, C.tinta);
  doc.text(`${tenant.kelurahan}, ${d.tanggal}`, xTtd, ys);
  doc.text(`Ketua ${tenant.rtFull} ${tenant.rwFull}`, xTtd, ys + 6);

  const tinggiTtd = 17;
  if (d.ketua.ttd) {
    try {
      doc.addImage(d.ketua.ttd, "PNG", xTtd + (lebarTtd - 32) / 2, ys + 9, 32, tinggiTtd);
    } catch {
      // Data-URL rusak/bukan PNG → jatuh ke nama miring seperti tanpa gambar.
      doc.setFont("helvetica", "italic");
      doc.setFontSize(13);
      setT(doc, C.abu);
      doc.text(d.ketua.nama, xTtd + lebarTtd / 2, ys + 19, { align: "center" });
    }
  } else {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(13);
    setT(doc, C.abu);
    doc.text(d.ketua.nama || "Ketua RT", xTtd + lebarTtd / 2, ys + 19, { align: "center" });
  }

  const yTanda = ys + 9 + tinggiTtd + 3;
  setG(doc, C.tinta);
  doc.setLineWidth(0.4);
  doc.line(xTtd, yTanda, xTtd + lebarTtd, yTanda);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  setT(doc, C.tinta);
  doc.text(d.ketua.nama || "Ketua RT", xTtd, yTanda + 5.5);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  setT(doc, C.abu);
  doc.text(d.ketua.jabatan || `Ketua ${tenant.rtFull} ${tenant.rwFull}`, xTtd, yTanda + 11);

  // — QR verifikasi publik (kiri, sejajar blok TTD) —
  const tautan = tautanQrSurat(d.qrToken, d.idBaris);
  if (tautan) {
    const png = await qrKePng(tautan);
    if (png) {
      try {
        const ukuran = 30;
        const xQr = M;
        const yQr = ys + 9;
        setF(doc, C.putih);
        setG(doc, C.garis);
        doc.setLineWidth(0.3);
        doc.rect(xQr - 1.5, yQr - 1.5, ukuran + 3, ukuran + 3, "FD");
        doc.addImage(png, "PNG", xQr, yQr, ukuran, ukuran);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8);
        setT(doc, C.tinta);
        doc.text("Verifikasi keaslian surat ini:", xQr, yQr + ukuran + 5);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7);
        setT(doc, C.abu);
        const pendek = tautan.replace(/^https?:\/\//, "");
        const link = doc.splitTextToSize(pendek, 78) as string[];
        doc.text(link, xQr, yQr + ukuran + 9.2, { lineHeightFactor: 1.35 });
        doc.text("Pindai QR atau buka tautan di atas.", xQr, yQr + ukuran + 9.2 + link.length * 3.4 + 1);
      } catch {
        // QR gagal ditanam → surat tetap sah tanpanya (tidak memutus unduhan).
      }
    }
  }

  // — Footer —
  setG(doc, C.garis);
  doc.setLineWidth(0.3);
  doc.line(M, H - 14, W - M, H - 14);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  setT(doc, C.abu);
  doc.text(`Surat Pengantar ${tenant.label} • Platform SIWARGA`, M, H - 10);
  setT(doc, C.tinta);
  doc.text(`Terbit ${d.tanggal}`, W - M, H - 10, { align: "right" });

  return doc;
}
