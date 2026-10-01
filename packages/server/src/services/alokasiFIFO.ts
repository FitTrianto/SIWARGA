/**
 * Alokasi pembayaran FIFO — PRD §6.4.5 (task B7) · aturan §4.1 dokumen desain.
 *
 * Sifat yang dijamin:
 *   • FIFO ke tagihan TERLAMA (urut periode, lalu tenggat) — lintas kategori pada
 *     mode "gabungan", terbatas pada satu kategori pada mode "terpisah".
 *   • Idempoten: setiap baris alokasi membawa `hashIdempotensi` unik
 *     sha256(pembayaran|tagihan|periode) sehingga proses ulang tidak menggandakan
 *     entri kas (syarat §15 Keandalan Data).
 *   • Sisa dana > 0 → kelebihan bayar dicatat sebagai `mutasi_saldo_warga` (masuk),
 *     bukan dibuang.
 *
 * Semua perhitungan dikerjakan dalam SATU KOMIT (integer sen) supaya tidak ada
 * galat pembulatan float pada nominal rupiah. Fungsi ini murni — tanpa database —
 * sehingga dapat diuji langsung (task B18).
 */
import { createHash } from "node:crypto";

export type ModeAlokasi = "gabungan" | "terpisah";

export interface TagihanAlokasi {
  id: string;
  kategoriId: string;
  /** 'YYYY-MM' */
  periode: string;
  /** 'YYYY-MM-DD' atau null (tenggat tidak ditetapkan) */
  tenggat: string | null;
  /** sisa tagihan (setelah keringanan) */
  sisa: number;
  nominalAwal: number;
}

export interface PembayaranAlokasi {
  id: string;
  nominal: number;
  /** Wajib diisi saat mode = 'terpisah' */
  kategoriTujuan?: string | null;
}

export interface BarisAlokasi {
  tagihanId: string;
  periode: string;
  nominal: number;
  /** urutan alokasi dalam 1 pembayaran, mulai dari 1 */
  urutan: number;
  hashIdempotensi: string;
}

export interface HasilAlokasi {
  alokasi: BarisAlokasi[];
  totalDialokasikan: number;
  /** dana sisa setelah seluruh tagihan eligible terpakai */
  sisaDana: number;
  /** > 0 → tulis mutasi_saldo_warga(tipe = 'masuk') */
  kelebihanBayar: number;
  /** tagihan yang dilewati karena mode 'terpisah' (bukan kategori tujuan) */
  tagihanDilewati: string[];
}

export class AlokasiError extends Error {
  override readonly name = "AlokasiError";
  constructor(
    message: string,
    readonly kode: "NOMINAL_TIDAK_VALID" | "KATEGORI_TUJUAN_WAJIB" | "PROMO_INVALID",
  ) {
    super(message);
  }
}

const r2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

export function hashIdempotensi(pembayaranId: string, tagihanId: string, periode: string): string {
  return createHash("sha256")
    .update([pembayaranId, tagihanId, periode].join("|"))
    .digest("hex");
}

/** Urut FIFO: periode menaik, lalu tenggat menaik (tenggat kosong diurutkan terakhir). */
export function urutkanTagihan(tagihan: TagihanAlokasi[]): TagihanAlokasi[] {
  return [...tagihan].sort((a, b) => {
    if (a.periode !== b.periode) return a.periode < b.periode ? -1 : 1;
    const ta = a.tenggat ?? "9999-12-31";
    const tb = b.tenggat ?? "9999-12-31";
    if (ta !== tb) return ta < tb ? -1 : 1;
    return a.id.localeCompare(b.id);
  });
}

/**
 * Alokasi satu pembayaran ke daftar tagihan.
 * Satu transaksi DB (lihat `services/alokasiRepo.ts` saat F-3) — fungsi ini
 * hanya menghitung rencana alokasi agar bisa diuji tanpa database.
 */
export function alokasikan(
  pembayaran: PembayaranAlokasi,
  daftarTagihan: TagihanAlokasi[],
  mode: ModeAlokasi = "gabungan",
): HasilAlokasi {
  if (!Number.isFinite(pembayaran.nominal) || pembayaran.nominal <= 0) {
    throw new AlokasiError("Nominal pembayaran harus lebih besar dari 0.", "NOMINAL_TIDAK_VALID");
  }
  if (mode === "terpisah" && !pembayaran.kategoriTujuan) {
    throw new AlokasiError(
      "Mode alokasi 'terpisah' mensyaratkan kategori tujuan.",
      "KATEGORI_TUJUAN_WAJIB",
    );
  }

  const sen = (n: number): number => Math.round(n * 100);
  let sisaDana = sen(pembayaran.nominal);
  const alokasi: BarisAlokasi[] = [];
  const dilewati: string[] = [];
  let urutan = 0;

  for (const t of urutkanTagihan(daftarTagihan)) {
    if (sisaDana <= 0) break;
    if (t.sisa <= 0) continue;
    if (mode === "terpisah" && t.kategoriId !== pembayaran.kategoriTujuan) {
      dilewati.push(t.id);
      continue;
    }
    const jumlahSen = Math.min(sisaDana, sen(t.sisa));
    if (jumlahSen <= 0) continue;
    urutan += 1;
    alokasi.push({
      tagihanId: t.id,
      periode: t.periode,
      nominal: jumlahSen / 100,
      urutan,
      hashIdempotensi: hashIdempotensi(pembayaran.id, t.id, t.periode),
    });
    sisaDana -= jumlahSen;
  }

  const total = alokasi.reduce((acc, b) => acc + sen(b.nominal), 0);

  return {
    alokasi,
    totalDialokasikan: r2(total / 100),
    sisaDana: r2(sisaDana / 100),
    kelebihanBayar: r2(sisaDana / 100),
    tagihanDilewati: dilewati,
  };
}

/**
 * Konsekuensi alokasi pada tiap tagihan: perbarui `sisa` + status turunan.
 * Mengembalikan salinan; pemanggil bertanggung jawab menulisnya dalam transaksi
 * yang sama dengan insert `alokasi_pembayaran`.
 */
export function terapkanAlokasi(
  daftarTagihan: TagihanAlokasi[],
  hasil: HasilAlokasi[],
): TagihanAlokasi[] {
  const peta = new Map(daftarTagihan.map((t) => [t.id, { ...t }]));
  for (const h of hasil) {
    for (const baris of h.alokasi) {
      const t = peta.get(baris.tagihanId);
      if (!t) continue;
      t.sisa = r2(t.sisa - baris.nominal);
      if (t.sisa < 0) t.sisa = 0;
    }
  }
  return [...peta.values()];
}
