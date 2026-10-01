/**
 * Buku kas append-only — PRD §6.5 (task B8) · aturan §4.5 dokumen desain.
 *
 * Prinsip buku besar:
 *   • INSERT diperbolehkan; UPDATE/DELETE DITOLAK (di database dijalankan
 *     trigger `fn_tolak_perubahan`, di sini direplikasi lewat API kelas —
 *     sehingga perilaku yang sama bisa diuji tanpa database).
 *   • Koreksi = entri `pembalik` dengan arah berlawanan yang menunjuk baris
 *     asal lewat `reversalOfId` — nominal asal tidak pernah berubah.
 *   • Saldo disimpan sebagai rantai `saldoSesudah` per entri; rekonsiliasi =
 *     validasi rantai tersebut.
 */

import { randomUUID } from "node:crypto";

export type TipeKas = "masuk" | "keluar" | "pembalik";
export type ArahKas = "positif" | "negatif";
export type KategoriTransaksi =
  | "iuran"
  | "pemasukan_lain"
  | "operasional"
  | "kegiatan"
  | "dana_sosial"
  | "lainnya";
export type SumberKas = "manual" | "iuran_alokasi" | "pembalik";

export interface EntriKas {
  id: string;
  /** 'YYYY-MM-DD' */
  tanggal: string;
  tipe: TipeKas;
  kategori: KategoriTransaksi;
  keterangan: string;
  nominal: number;
  arah: ArahKas;
  saldoSesudah: number;
  sumber: SumberKas;
  refType: string | null;
  refId: string | null;
  reversalOfId: string | null;
}

export interface InputEntriKas {
  tanggal: string;
  kategori: KategoriTransaksi;
  keterangan: string;
  nominal: number;
  tipe?: TipeKas;
  arah?: ArahKas;
  sumber?: SumberKas;
  refType?: string | null;
  refId?: string | null;
}

export class KasError extends Error {
  override readonly name = "KasError";
  constructor(
    message: string,
    readonly kode:
      | "APPEND_ONLY"
      | "NOMINAL_TIDAK_VALID"
      | "KETERANGAN_PANJANG"
      | "ENTRI_TIDAK_DITEMUKAN"
      | "SALDO_CHAIN_RUSAK"
      | "KOREKSI_TIDAK_SAH",
  ) {
    super(message);
  }
}

const r2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** Nominal kas selalu > 0 — arah ditentukan kolom `arah`, bukan tanda angka. */
function validasiNominal(nominal: number): void {
  if (!Number.isFinite(nominal) || nominal <= 0) {
    throw new KasError("Nominal kas harus lebih besar dari 0.", "NOMINAL_TIDAK_VALID");
  }
}

function idAcak(): string {
  // UUID v4 untuk representasi in-memory (database membuat UUID-nya sendiri)
  return randomUUID();
}

export class BukuKas {
  #entri: EntriKas[] = [];
  #saldoAwal: number;

  constructor(saldoAwal = 0) {
    if (!Number.isFinite(saldoAwal) || saldoAwal < 0) {
      throw new KasError("Saldo awal tidak valid.", "NOMINAL_TIDAK_VALID");
    }
    this.#saldoAwal = r2(saldoAwal);
  }

  get saldoAwal(): number {
    return this.#saldoAwal;
  }

  /** Saldo saat ini = `saldoSesudah` entri terakhir. */
  saldo(): number {
    const terakhir = this.#entri[this.#entri.length - 1];
    return terakhir ? terakhir.saldoSesudah : this.#saldoAwal;
  }

  daftar(): readonly EntriKas[] {
    return Object.freeze([...this.#entri]);
  }

  cari(id: string): EntriKas | undefined {
    return this.#entri.find((e) => e.id === id);
  }

  /** Satu-satunya cara menambah baris. */
  tambah(input: InputEntriKas): EntriKas {
    validasiNominal(input.nominal);
    if (input.keterangan.length > 200) {
      throw new KasError("Keterangan maksimal 200 karakter.", "KETERANGAN_PANJANG");
    }
    const tipe: TipeKas = input.tipe ?? "masuk";
    const arah: ArahKas = input.arah ?? (tipe === "keluar" ? "negatif" : "positif");
    const nominal = r2(input.nominal);
    const saldoBerikut = r2(this.saldo() + (arah === "positif" ? nominal : -nominal));

    const entri: EntriKas = Object.freeze({
      id: idAcak(),
      tanggal: input.tanggal,
      tipe,
      kategori: input.kategori,
      keterangan: input.keterangan.slice(0, 200),
      nominal,
      arah,
      saldoSesudah: saldoBerikut,
      sumber: input.sumber ?? "manual",
      refType: input.refType ?? null,
      refId: input.refId ?? null,
      reversalOfId: null,
    });
    this.#entri.push(entri);
    return entri;
  }

  /**
   * Mencatat uang masuk dari alokasi iuran (§6.4.9) — dipanggil otomatis oleh
   * proses alokasi, sumber `iuran_alokasi`, referensi ke pembayaran.
   */
  catatAlokasiIuran(pembayaranId: string, nominal: number, tanggal: string): EntriKas {
    return this.tambah({
      tanggal,
      tipe: "masuk",
      arah: "positif",
      kategori: "iuran",
      keterangan: "Alokasi pembayaran iuran",
      nominal,
      sumber: "iuran_alokasi",
      refType: "pembayaran",
      refId: pembayaranId,
    });
  }

  /**
   * Koreksi = INSERT entri pembalik (§6.5). Baris asal TIDAK pernah disentuh.
   */
  koreksi(idEntriAsal: string, alasan: string, tanggal: string): EntriKas {
    const asal = this.cari(idEntriAsal);
    if (!asal) {
      throw new KasError(`Entri ${idEntriAsal} tidak ditemukan.`, "ENTRI_TIDAK_DITEMUKAN");
    }
    if (asal.tipe === "pembalik") {
      throw new KasError(
        "Entri pembalik tidak boleh dibalik lagi — koreksi harus menunjuk entri asal.",
        "KOREKSI_TIDAK_SAH",
      );
    }
    const arahPembalik: ArahKas = asal.arah === "positif" ? "negatif" : "positif";
    const dibuat = this.tambah({
      tanggal,
      tipe: "pembalik",
      arah: arahPembalik,
      kategori: asal.kategori,
      keterangan: alasan.slice(0, 200),
      nominal: asal.nominal,
      sumber: "pembalik",
      refType: "kas_entry",
      refId: asal.id,
    });
    // tandai hubungan ke entri asal
    const indeks = this.#entri.findIndex((e) => e.id === dibuat.id);
    const denganRujukan = Object.freeze({ ...dibuat, reversalOfId: asal.id });
    this.#entri[indeks] = denganRujukan;
    return denganRujukan;
  }

  /**
   * Meniru trigger `trg_kas_entry_append_only`. Kedua method ini SELALU gagal —
   * menguji bahwa tidak ada jalur aplikasi yang memutasi riwayat kas.
   */
  ubah(): never {
    throw new KasError(
      "Tabel kas_entry bersifat append-only — UPDATE ditolak. Gunakan entri pembalik.",
      "APPEND_ONLY",
    );
  }

  hapus(): never {
    throw new KasError(
      "Tabel kas_entry bersifat append-only — DELETE ditolak.",
      "APPEND_ONLY",
    );
  }

  /** Validasi rantai saldo (rekonsiliasi §6.5). Mengembalikan daftar baris rusak. */
  validasiRantai(): string[] {
    const rusak: string[] = [];
    let jalan = this.#saldoAwal;
    for (const e of this.#entri) {
      jalan = r2(jalan + (e.arah === "positif" ? e.nominal : -e.nominal));
      if (r2(jalan) !== e.saldoSesudah) rusak.push(e.id);
    }
    return rusak;
  }
}
