/**
 * Identitas tenant untuk tampilan (Batch 18 · multi-tenant tampilan).
 *
 * Nilai AWAL = contoh pemasaran (RT 04 / RW 012 / Melati) — dipakai Landing
 * Page dan sesi MODE DEMO (server tidak terjangkau). Pada sesi DARING, App
 * mengisi objek ini dari server (`GET /rt/profil` / `GET /auth/warga/sesi`)
 * SEBELUM portal dirender, sehingga halaman portal selalu menampilkan
 * identitas milik sesi berjalan — bukan data contoh milik RT lain.
 */
export interface ProfilTenant {
  rt: string;
  rw: string;
  kelurahan: string;
  kecamatan: string;
  kota: string;
  provinsi: string;
  /** Nama perumahan tempat RT ini berada — satu-satunya sumber nama komplek. */
  perumahan: string;
  /** Nama pendek perumahan untuk kalimat ("... Melati 2024-2027"). */
  perumahanSingkat: string;
  /** Nama Ketua RW — sumber tunggal untuk dokumen/dashboard. */
  ketuaRw: string;
}

/** Nilai contoh (Landing Page & mode demo) — dikembalikan saat sesi berakhir. */
const TENANT_CONTOH: ProfilTenant = {
  rt: "04",
  rw: "012",
  kelurahan: "Pulo Gadung",
  kecamatan: "Pulo Gadung",
  kota: "Jakarta Timur",
  provinsi: "DKI Jakarta",
  perumahan: "Komplek Melati Indah",
  perumahanSingkat: "Melati",
  ketuaRw: "H. Subaidi",
};

export const tenant = {
  ...TENANT_CONTOH,
  get rtFull(): string { return `RT ${this.rt}`; },
  get rwFull(): string { return `RW ${this.rw}`; },
  get label(): string { return `RT ${this.rt} / RW ${this.rw}`; },
  get shortLabel(): string { return `${this.rt}-${this.rw}`; },
  get alamatLengkap(): string { return `${this.rtFull} ${this.rwFull}, Kel. ${this.kelurahan}, Kec. ${this.kecamatan}, ${this.kota}`; },
};

/**
 * Isi identitas tenant dari data sesi daring. `perumahan`/`provinsi` tidak
 * selalu ada di DB — bila kosong, diisi nilai faktis dari baris wilayah
 * (bukan nama komplek karangan).
 */
export function setTenantSesi(p: {
  rt: string;
  rw: string;
  kelurahan: string;
  kecamatan: string;
  kota: string | null;
  perumahan?: string | null;
  ketuaRw?: string | null;
}): void {
  tenant.rt = p.rt;
  tenant.rw = p.rw;
  tenant.kelurahan = p.kelurahan;
  tenant.kecamatan = p.kecamatan;
  tenant.kota = p.kota ?? "";
  tenant.provinsi = "";
  tenant.perumahan = p.perumahan?.trim() || `Kel. ${p.kelurahan}`;
  tenant.perumahanSingkat = "";
  tenant.ketuaRw = p.ketuaRw ?? "";
}

/** Kembalikan ke contoh pemasaran (saat sesi berakhir / mode demo). */
export function kembalikanTenantContoh(): void {
  Object.assign(tenant, TENANT_CONTOH);
}

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
