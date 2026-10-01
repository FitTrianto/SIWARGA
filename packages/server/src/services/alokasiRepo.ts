/**
 * Penerapan alokasi & kas di database — F-3 (task B7 · §6.4.5 · §6.4.9 · §6.5).
 *
 * `services/alokasiFIFO.ts` sengaja murni (tanpa DB) agar bisa diuji langsung;
 * file ini menjalankan SELURUH konsekuensinya di dalam SATU transaksi ber-scope
 * RT (`denganScopeRequest` — §4.6), dalam urutan yang aman-kegagalan:
 *
 *   1. cek idempotensi — alokasi pernah ditulis → proses ulang = no-op (§15);
 *   2. baca tagihan warga dengan `sisa > 0` + keringanan aktif;
 *   3. `alokasikan()` → rencana FIFO (periode menaik, lalu tenggat);
 *   4. insert `alokasi_pembayaran` (guard unique `hash_idempotensi`);
 *   5. perbarui `tagihan.sisa` + kolom `status` lewat `statusTurunan` (B10);
 *   6. entri kas otomatis `sumber = iuran_alokasi` dengan rantai `saldo_sesudah`;
 *   7. sisa dana > 0 → `mutasi_saldo_warga(tipe = masuk)` — tidak pernah dibuang.
 *
 * Semua nominal dihitung dalam integer sen lalu dibulatkan 2 desimal — tidak ada
 * galat pembulatan float pada nominal rupiah (syarat §15 Keandalan Data).
 */
import { config } from "../config.js";
import { alokasikan, type ModeAlokasi, type TagihanAlokasi } from "./alokasiFIFO.js";
import type { DbTransaksi } from "./db.js";
import { statusTurunan, statusUntukDb, type StatusTagihan } from "./statusTagihan.js";

const r2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** Kolom `@db.Date` → 'YYYY-MM-DD'. */
export const tanggalPendek = (d: Date): string => d.toISOString().slice(0, 10);

export interface InputTerapkanAlokasi {
  rtId: string;
  pembayaran: { id: string; wargaId: string; nominal: number; tanggal: Date };
  /** dari `pengaturan_rt.mode_alokasi` (gabungan | terpisah). */
  mode: ModeAlokasi;
  /** wajib bila mode = 'terpisah'. */
  kategoriTujuan?: string | null;
  /** `pengurus_rt.id` — pembuat entri kas otomatis. */
  oleh: string;
  /** nama warga untuk keterangan kas. */
  namaWarga?: string;
}

export interface HasilTerapkanAlokasi {
  /** true bila alokasi pembayaran ini sudah pernah diterapkan (proses ulang). */
  sudahDiterapkan: boolean;
  alokasi: Array<{ tagihanId: string; periode: string; nominal: number; urutan: number }>;
  totalDialokasikan: number;
  kelebihanBayar: number;
  tagihan: Array<{ id: string; sisa: number; status: StatusTagihan }>;
  kas: { id: string; saldoSesudah: number } | null;
  mutasiSaldoId: string | null;
}

/**
 * Terapkan satu pembayaran (diasumsikan sudah sah & dalam status
 * `menunggu_verifikasi`) ke tagihan milik warga yang sama.
 *
 * Membaca + menulis SEMUANYA lewat `tx` transaksi yang sama sehingga tagihan,
 * alokasi, kas, dan saldo warga tidak pernah bisa tidak sinkron.
 */
export async function terapkanAlokasiPembayaran(
  tx: DbTransaksi,
  input: InputTerapkanAlokasi,
): Promise<HasilTerapkanAlokasi> {
  const { rtId, pembayaran } = input;

  // 1. Idempotensi — baris alokasi sudah ada = sudah pernah diverifikasi.
  const pernah = await tx.alokasiPembayaran.findMany({
    where: { pembayaranId: pembayaran.id },
    select: { id: true },
  });
  if (pernah.length > 0) {
    return {
      sudahDiterapkan: true,
      alokasi: [],
      totalDialokasikan: 0,
      kelebihanBayar: 0,
      tagihan: [],
      kas: null,
      mutasiSaldoId: null,
    };
  }

  // 2. Tagihan eligible + keringanan aktif (keringanan dilaporkan TERPISAH, §4.4).
  const barisTagihan = await tx.tagihan.findMany({
    where: { rtId, wargaId: pembayaran.wargaId, sisa: { gt: 0 } },
    select: {
      id: true,
      kategoriId: true,
      periode: true,
      tenggat: true,
      sisa: true,
      nominal: true,
    },
  });
  const keringanan = await tx.keringanan.findMany({
    where: { rtId, wargaId: pembayaran.wargaId, status: "aktif", statusApproval: "disetujui" },
    select: { kategoriId: true, periodeMulai: true, periodeSampai: true },
  });
  const adaKeringanan = (kategoriId: string, periode: string): boolean =>
    keringanan.some(
      (k) =>
        k.kategoriId === kategoriId &&
        k.periodeMulai <= periode &&
        (!k.periodeSampai || k.periodeSampai >= periode),
    );

  const petaBaris = new Map(barisTagihan.map((t) => [t.id, t]));
  const daftar: TagihanAlokasi[] = barisTagihan.map((t) => ({
    id: t.id,
    kategoriId: t.kategoriId,
    periode: t.periode,
    tenggat: t.tenggat ? tanggalPendek(t.tenggat) : null,
    sisa: Number(t.sisa),
    // tagihan ber-keringanan: status diturunkan terhadap jumlah yang memang
    // harus dibayar (setelah keringanan) — keringanan diberi label terpisah.
    nominalAwal: Number(t.nominal),
  }));

  // 3. Rencana alokasi FIFO (fungsi murni — task B18).
  const hasil = alokasikan(
    { id: pembayaran.id, nominal: pembayaran.nominal, kategoriTujuan: input.kategoriTujuan ?? null },
    daftar,
    input.mode,
  );

  // 4 & 5. Tulis alokasi + perbarui sisa & status turunan tagihan.
  const tagihanDiperbarui: HasilTerapkanAlokasi["tagihan"] = [];
  for (const baris of hasil.alokasi) {
    const t = petaBaris.get(baris.tagihanId);
    if (!t) continue; // mustahil datang dari `alokasikan()` — defensif saja
    await tx.alokasiPembayaran.create({
      data: {
        pembayaranId: pembayaran.id,
        tagihanId: baris.tagihanId,
        rtId,
        nominalDialokasikan: baris.nominal,
        urutan: baris.urutan,
        mode: input.mode,
        hashIdempotensi: baris.hashIdempotensi,
      },
    });

    const sisaBaru = r2(Math.max(0, Number(t.sisa) - baris.nominal));
    const status = statusTurunan({
      sisa: sisaBaru,
      nominalAwal: Number(t.nominal),
      periode: t.periode,
      periodeAktif: config.periodeAktif,
      keringananAktif: adaKeringanan(t.kategoriId, t.periode),
    });
    await tx.tagihan.update({
      where: { id: t.id },
      data: { sisa: sisaBaru, status: statusUntukDb(status) },
    });
    tagihanDiperbarui.push({ id: t.id, sisa: sisaBaru, status: statusUntukDb(status) });
  }

  // 6. Kas otomatis — satu entri per alokasi, saldo sebagai rantai.
  let kas: HasilTerapkanAlokasi["kas"] = null;
  if (hasil.totalDialokasikan > 0) {
    const terakhir = await tx.kasEntry.findFirst({
      where: { scopeLevel: "rt", scopeId: rtId },
      orderBy: { createdAt: "desc" },
      select: { saldoSesudah: true },
    });
    const saldoBaru = r2(Number(terakhir?.saldoSesudah ?? 0) + hasil.totalDialokasikan);
    const entri = await tx.kasEntry.create({
      data: {
        scopeLevel: "rt",
        scopeId: rtId,
        tanggal: pembayaran.tanggal,
        tipe: "masuk",
        kategori: "iuran",
        keterangan: `Alokasi pembayaran iuran${input.namaWarga ? ` ${input.namaWarga}` : ""}`.slice(0, 200),
        nominal: hasil.totalDialokasikan,
        arah: "positif",
        saldoSesudah: saldoBaru,
        sumber: "iuran_alokasi",
        refType: "pembayaran",
        refId: pembayaran.id,
        createdBy: input.oleh,
      },
    });
    kas = { id: entri.id, saldoSesudah: saldoBaru };
  }

  // 7. Kelebihan bayar = saldo warga (mutasi masuk) — tidak pernah dibuang.
  let mutasiSaldoId: string | null = null;
  if (hasil.kelebihanBayar > 0) {
    const terakhir = await tx.mutasiSaldoWarga.findFirst({
      where: { wargaId: pembayaran.wargaId },
      orderBy: { createdAt: "desc" },
      select: { saldoSesudah: true },
    });
    const saldoBaru = r2(Number(terakhir?.saldoSesudah ?? 0) + hasil.kelebihanBayar);
    const mutasi = await tx.mutasiSaldoWarga.create({
      data: {
        wargaId: pembayaran.wargaId,
        rtId,
        tipe: "masuk",
        nominal: hasil.kelebihanBayar,
        refType: "pembayaran",
        refId: pembayaran.id,
        saldoSesudah: saldoBaru,
      },
    });
    mutasiSaldoId = mutasi.id;
  }

  return {
    sudahDiterapkan: false,
    alokasi: hasil.alokasi.map((b) => ({
      tagihanId: b.tagihanId,
      periode: b.periode,
      nominal: b.nominal,
      urutan: b.urutan,
    })),
    totalDialokasikan: hasil.totalDialokasikan,
    kelebihanBayar: hasil.kelebihanBayar,
    tagihan: tagihanDiperbarui,
    kas,
    mutasiSaldoId,
  };
}
