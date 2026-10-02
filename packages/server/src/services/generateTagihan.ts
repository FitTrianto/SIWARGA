/**
 * Generator tagihan bulanan — PRD §6.4.3 (task B9).
 *
 * Satu-satunya sumber logika pembuatan tagihan per periode; dipakai oleh:
 *   • `POST /rt/iuran/tagihan/generate` — jalur manual bendahara (idempoten);
 *   • `plugins/autoTagihan.ts` — pemeriksa OTOMATIS saat server start +
 *     interval (tagihan bulanan tergenerate tanpa klik tombol);
 *   • opsi `sinkronProfil` — bendahara "memodifikasi" tagihan lewat profil
 *     iuran per warga (`PUT /rt/warga/:id/profil-iuran`): tagihan yang SUDAH
 *     ADA dan BELUM teralokasi disesuaikan kembali; yang sudah teralokasi
 *     (sebagian/lunas) tidak pernah disentuh agar jejak kas tetap utuh.
 *
 * Idempoten: kombinasi `(warga, kategori, periode)` unik di DB — generate
 * ulang tidak pernah menduplikasi tagihan (dihitung `dilewati`).
 */
import type { Prisma } from "../generated/prisma/client.js";
import type { DbTransaksi } from "./db.js";

const r2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** Default `pengaturan_rt` (§6.4.3) bila baris pengaturan belum pernah dibuat. */
export const PENGATURAN_IURAN_DASAR = { modeAlokasi: "gabungan", tenggatHari: 10, dendaAktif: false } as const;

/**
 * Tenggat tagihan satu periode: `min(tenggat_hari, hari_akhir_bulan)` sehingga
 * bulan pendek (Feb) tidak pernah melewati akhir bulan (§6.4.3).
 */
export function tenggatPeriode(periode: string, tenggatHari: number): Date {
  const [tahun, bulan] = periode.split("-").map(Number);
  const hariAkhirBulan = new Date(Date.UTC(tahun, bulan, 0)).getUTCDate();
  const hari = Math.min(Math.max(1, tenggatHari), hariAkhirBulan);
  return new Date(Date.UTC(tahun, bulan - 1, hari));
}

export interface OpsiGenerateTagihan {
  /**
   * Sinkronkan tagihan periode ini yang BELUM teralokasi dengan profil iuran
   * terbaru (nominal/unit per warga). Tagihan dengan `alokasi` apa pun
   * DILEWATI; nominal baru ≤ 0 menghapus tagihan (belum teralokasi) karena
   * profil menandai rumah itu memang tidak ditagihkan.
   */
  sinkronProfil?: boolean;
}

export interface HasilGeneratePeriode {
  dibuat: number;
  dilewati: number;
  /** Jumlah tagihan yang disesuaikan/dihapus oleh `sinkronProfil`. */
  sinkron: number;
}

/**
 * Generate (dan opsional sinkron) tagihan satu periode untuk SATU RT —
 * dijalankan di dalam transaksi ber-scope `rt` milik RT bersangkutan.
 *
 * Aturan (§6.4.3): warga `status_aktif` × kategori `aktif` dan bukan
 * `insidental`; nominal = `(profil.nominal_berlaku ?? kategori.nominal_default)
 * × (per_unit ? profil.jumlah_unit : 1)`; nominal ≤ 0 dilewati; tenggat =
 * `min(tenggat_hari, hari_akhir_bulan)`.
 */
export async function generateTagihanPeriode(
  tx: DbTransaksi,
  rtId: string,
  periode: string,
  opsi: OpsiGenerateTagihan = {},
): Promise<HasilGeneratePeriode> {
  const pengaturan = await tx.pengaturanRt.findUnique({
    where: { rtId },
    select: { tenggatHari: true },
  });
  const tenggatHari = pengaturan?.tenggatHari ?? PENGATURAN_IURAN_DASAR.tenggatHari;

  const warga = await tx.warga.findMany({
    where: { rtId, statusAkses: "aktif" },
    select: { id: true },
  });
  const kategori = await tx.kategoriIuran.findMany({
    where: { rtId, statusAktif: true, tipeTarif: { not: "insidental" } },
    select: { id: true, tipeTarif: true, nominalDefault: true },
  });
  const profil = await tx.profilIuranWarga.findMany({
    where: { rtId },
    select: { wargaId: true, kategoriId: true, nominalBerlaku: true, jumlahUnit: true },
  });
  const ada = await tx.tagihan.findMany({
    where: { rtId, periode },
    select: { wargaId: true, kategoriId: true },
  });

  const kunciAda = new Set(ada.map((t) => `${t.wargaId}|${t.kategoriId}`));
  const petaProfil = new Map(profil.map((p) => [`${p.wargaId}|${p.kategoriId}`, p]));
  const tenggat = tenggatPeriode(periode, tenggatHari);
  const baris: Prisma.TagihanCreateManyInput[] = [];
  let dibuat = 0;
  let dilewati = 0;

  const hitungNominal = (kunci: string, k: (typeof kategori)[number]): number => {
    const p = petaProfil.get(kunci);
    const dasar = p?.nominalBerlaku != null ? Number(p.nominalBerlaku) : Number(k.nominalDefault);
    const unit = k.tipeTarif === "per_unit" ? (p?.jumlahUnit ?? 1) : 1;
    return r2(dasar * unit);
  };

  for (const w of warga) {
    for (const k of kategori) {
      const kunci = `${w.id}|${k.id}`;
      if (kunciAda.has(kunci)) {
        dilewati += 1; // tagihan periode ini sudah ada — idempoten
        continue;
      }
      const nominal = hitungNominal(kunci, k);
      if (nominal <= 0) {
        dilewati += 1; // nominal nol = memang tidak ditagihkan
        continue;
      }
      baris.push({
        rtId,
        wargaId: w.id,
        kategoriId: k.id,
        periode,
        nominal,
        nominalAwal: nominal,
        sisa: nominal,
        tenggat,
        status: "belum_bayar",
        sumber: "bulk",
      });
      dibuat += 1;
    }
  }

  if (baris.length > 0) await tx.tagihan.createMany({ data: baris });

  let sinkron = 0;
  if (opsi.sinkronProfil) {
    const petaKategori = new Map(kategori.map((k) => [k.id, k]));
    const existing = await tx.tagihan.findMany({
      where: { rtId, periode, kategoriId: { in: [...petaKategori.keys()] } },
      select: {
        id: true,
        wargaId: true,
        kategoriId: true,
        nominal: true,
        sisa: true,
        alokasiList: { select: { id: true }, take: 1 },
      },
    });
    for (const t of existing) {
      // Sudah teralokasi (sebagian/lunas) → nominal & sisa adalah jejak kas.
      if (t.alokasiList.length > 0) continue;
      const k = petaKategori.get(t.kategoriId);
      if (!k) continue;
      const nominal = hitungNominal(`${t.wargaId}|${t.kategoriId}`, k);
      if (nominal === Number(t.nominal)) continue;
      if (nominal <= 0) {
        // Profil menolak tagihan ini (mis. unit R4 dihapus) & belum ada
        // pembayaran → tagihan dihapus supaya warga tidak ditagihkan.
        await tx.tagihan.delete({ where: { id: t.id } });
        sinkron += 1;
        continue;
      }
      await tx.tagihan.update({
        where: { id: t.id },
        data: { nominal, nominalAwal: nominal, sisa: nominal, tenggat },
      });
      sinkron += 1;
    }
  }

  return { dibuat, dilewati, sinkron };
}
