/**
 * Status turunan tagihan — PRD §6.4.7 (task B10) · aturan §4.4 dokumen desain.
 *
 * Penting: status DITURUNKAN dari `sisa`, bukan dari pembayaran terakhir, dan
 * label menunggak/keringanan ditandai TERPISAH — keringanan tidak pernah
 * menggantikan status lunas/sebagian/belum_bayar.
 */

export type StatusTagihan = "belum_bayar" | "sebagian" | "lunas";

export interface InputStatus {
  /** sisa tagihan setelah alokasi */
  sisa: number;
  /** nominal sebelum keringanan */
  nominalAwal: number;
  /** 'YYYY-MM' periode tagihan */
  periode: string;
  /** 'YYYY-MM' periode berjalan (PERIODE_AKTIF sistem) */
  periodeAktif: string;
  /** ada baris keringanan berstatus 'aktif' untuk tagihan ini */
  keringananAktif?: boolean;
}

export interface HasilStatus {
  status: StatusTagihan;
  /** teks singkat untuk tabel FE */
  label: string;
  menunggak: boolean;
  /** jumlah bulan tunggakan; 0 bila tidak menunggak */
  bulanTunggak: number;
  /** ditandai TERPISAH — bukan pengganti `status` (§4.4) */
  keringananAktif: boolean;
}

const r2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** Selisih bulan kalender antara dua periode 'YYYY-MM' (positif bila a setelah b). */
export function selisihBulan(dari: string, sampai: string): number {
  const parse = (p: string): number => {
    const [y, m] = p.split("-").map(Number);
    if (!y || !m || m < 1 || m > 12) throw new Error(`Periode tidak valid: ${p}`);
    return y * 12 + (m - 1);
  };
  return parse(sampai) - parse(dari);
}

export function statusTurunan(input: InputStatus): HasilStatus {
  const sisa = r2(input.sisa);
  const nominalAwal = r2(input.nominalAwal);
  const keringananAktif = input.keringananAktif === true;

  if (nominalAwal < 0 || sisa < 0) {
    throw new Error("sisa/nominal_awal tidak boleh negatif.");
  }

  if (sisa === 0) {
    return {
      status: "lunas",
      label: "Lunas",
      menunggak: false,
      bulanTunggak: 0,
      keringananAktif,
    };
  }

  if (sisa < nominalAwal) {
    return {
      status: "sebagian",
      label: `Dicicil (kurang Rp ${sisa.toLocaleString("id-ID")})`,
      menunggak: false,
      bulanTunggak: 0,
      keringananAktif,
    };
  }

  // sisa === nominal_awal → belum_bayar
  const bulanTunggak = Math.max(0, selisihBulan(input.periode, input.periodeAktif));
  const menunggak = bulanTunggak > 0;
  return {
    status: "belum_bayar",
    label: menunggak ? `Menunggak (${bulanTunggak} bulan)` : "Belum Bayar",
    menunggak,
    bulanTunggak,
    keringananAktif,
  };
}

/** Kolom `tagihan.status` yang harus ditulis ke database. */
export function statusUntukDb(hasil: HasilStatus): StatusTagihan {
  return hasil.status;
}
