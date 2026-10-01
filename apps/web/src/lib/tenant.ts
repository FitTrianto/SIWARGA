export const tenant = {
  rt: "04",
  rw: "012",
  kelurahan: "Pulo Gadung",
  kecamatan: "Pulo Gadung",
  kota: "Jakarta Timur",
  provinsi: "DKI Jakarta",
  /** Nama perumahan tempat RT ini berada — satu-satunya sumber nama komplek. */
  perumahan: "Komplek Melati Indah",
  /** Nama pendek perumahan untuk kalimat ("... Melati 2024-2027"). */
  perumahanSingkat: "Melati",
  /** Nama Ketua RW — sumber tunggal untuk dokumen/dashboard. */
  ketuaRw: "H. Subaidi",
  get rtFull() { return `RT ${this.rt}`; },
  get rwFull() { return `RW ${this.rw}`; },
  get label() { return `RT ${this.rt} / RW ${this.rw}`; },
  get shortLabel() { return `${this.rt}-${this.rw}`; },
  get alamatLengkap() { return `${this.rtFull} ${this.rwFull}, Kel. ${this.kelurahan}, Kec. ${this.kecamatan}, ${this.kota}`; },
};

const MONTHS_ID = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

function padZero(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Generate nomor surat: SKP/RT-RW/Bulan/Tahun/noUrut
 * Example: SKP/04-012/09/2026/010
 */
export function generateNoSurat(
  kode: string,
  month: number,
  year: number,
  sequence: number,
): string {
  return `${kode}/${tenant.shortLabel}/${padZero(month)}/${year}/${padZero(sequence).padStart(3, "0")}`;
}

export function getMonthName(month: number): string {
  return MONTHS_ID[month - 1] || "";
}

export function padSequence(n: number): string {
  return String(n).padStart(3, "0");
}
