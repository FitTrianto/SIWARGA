/**
 * Portal RW — Batch 20 (fondasi: identitas + agregat kependudukan/hunian §7.1)
 * + Batch 21 (agregat iuran per RT §7.2).
 *
 *   GET /rw/profil        wajibRw — identitas RW login dari DB (bukan konstanta
 *                         FE "RW 012 / Melati"): kode RW, kelurahan/kecamatan,
 *                         nama Ketua RW, pengurus RW, daftar RT di bawahnya.
 *   GET /rw/agregat/warga wajibRw — jumlah KK & warga AKTIF per RT + total
 *                         (agregat saja — tanpa nama/NIK, sesuai privasi §7.1).
 *   GET /rw/agregat/hunian wajibRw — jumlah rumah, terisi & kosong per RT.
 *   GET /rw/agregat/iuran wajibRw — kepatuhan (lunas ÷ tagihan), penerimaan,
 *                         tunggakan & subsidi per RT untuk satu periode
 *                         (`?periode=YYYY-MM`, default bulan berjalan).
 *
 * Sebelum Batch 20 tidak ada satu pun rute `/rw/**`: portal RW (FE) sepenuhnya
 * memakai data contoh (`rtAgregatDefault` 8 RT angka karangan). Kini baris
 * agregat datang dari `rt` (registry) + hitung agregat tabel pola A yang
 * dibuka lewat kebijakan SELECT rw-join (migrasi 20261010000100 &
 * 20261010000200).
 *
 * Keamanan (§4.6 + §7.1/privasi PDP):
 *   • Scope SELALU dari `request.pemohon` (level rw) — ID RW tidak datang
 *     dari query/body klien.
 *   • RLS: baris `rt` di luar RW tidak terbaca (`p_rt_registry`); tabel
 *     `warga`/`kartu_keluarga`/`rumah`/`tagihan`/`keringanan` hanya terbaca
 *     untuk RT di bawah RW ini (SELECT-only — tulis tetap tertutup
 *     `p_scope_rt`).
 *   • Respons agregat hanya berisi HITUNGAN & nominal per RT — tidak ada
 *     nama, NIK, alamat, maupun ID warga pada keluaran rute ini.
 *   • Agregat iuran dihitung LANGSUNG dari `tagihan`/`keringanan` (join
 *     `rt.rw_id` + RLS), bukan view `v_rw_iuran_agregat` yang mode definer-nya
 *     membaca agregat lintas tenant tanpa filter scope.
 */
import type { FastifyPluginAsync } from "fastify";
import { GalatTolak, wajibRw } from "../plugins/guard.js";
import { denganScopeRequest } from "../plugins/scope.js";

interface BarisHitungRt {
  rtId: string;
  kodeRt: string;
  kk: number;
  warga: number;
}

interface BarisHunianRt {
  rtId: string;
  kodeRt: string;
  total: number;
  kosong: number;
}

interface BarisIuranRt {
  rtId: string;
  kodeRt: string;
  jumlahTagihan: number;
  jumlahLunas: number;
  terbayar: number;
  sisa: number;
  subsidiJumlah: number;
  subsidiNominal: number;
}

/** Kunci periode bulan berjalan pada waktu SERVER (format `YYYY-MM`). */
function periodeSekarang(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Kepatuhan 1 desimal: lunas ÷ tagihan terbit × 100 (0 bila belum ada tagihan). */
function hitungKepatuhan(lunas: number, tagihan: number): number {
  return tagihan > 0 ? Math.round((lunas / tagihan) * 1000) / 10 : 0;
}

export const ruteRwPortal: FastifyPluginAsync = async (app) => {
  /**
   * Identitas RW login untuk tampilan portal. `kota` tidak ada di tabel
   * wilayah — diambil dari baris pendaftaran mandiri milik RT mana pun di
   * bawah RW ini (kota yang sama untuk satu komplek); semua null → null.
   */
  app.get("/rw/profil", async (req, reply) => {
    const { rwId } = wajibRw(req);
    const rw = await denganScopeRequest(req, (tx) =>
      tx.rw.findUnique({
        where: { id: rwId },
        select: {
          kodeRw: true,
          namaKetua: true,
          kelurahan: { select: { nama: true, kecamatan: { select: { nama: true } } } },
          pengurusList: {
            select: { id: true, nama: true, jabatan: true, email: true },
            orderBy: { createdAt: "asc" },
          },
          rts: {
            select: {
              id: true,
              kodeRt: true,
              perumahan: true,
              pendaftaran: { select: { kota: true } },
            },
            orderBy: { kodeRt: "asc" },
          },
        },
      }),
    );
    if (!rw) throw new GalatTolak("NOT_FOUND", "Data RW tidak ditemukan.");
    const kota = rw.rts.map((r) => r.pendaftaran?.kota ?? null).find((k) => k) ?? null;
    return reply.ok({
      rw: {
        kodeRw: rw.kodeRw,
        namaKetua: rw.namaKetua,
        kelurahan: rw.kelurahan.nama,
        kecamatan: rw.kelurahan.kecamatan.nama,
        kota,
        pengurus: rw.pengurusList.map((p) => ({
          id: p.id,
          nama: p.nama,
          jabatan: String(p.jabatan),
          email: p.email,
        })),
        rts: rw.rts.map((r) => ({
          id: r.id,
          kodeRt: r.kodeRt,
          perumahan: r.perumahan,
        })),
      },
    });
  });

  /**
   * Agregat kependudukan per RT (§7.1) — jumlah KK & warga AKTIF. RT tanpa
   * data tetap muncul dengan 0 (jujur — bukan disembunyikan). Hitung pakai
   * sub-kueri skalar supaya tidak terjadi perkalian silang baris.
   */
  app.get("/rw/agregat/warga", async (req, reply) => {
    const { rwId } = wajibRw(req);
    const baris = await denganScopeRequest(req, (tx) =>
      tx.$queryRaw<BarisHitungRt[]>`
        SELECT r.id::text AS "rtId",
               r.kode_rt AS "kodeRt",
               (SELECT COUNT(*) FROM kartu_keluarga k WHERE k.rt_id = r.id)::int AS kk,
               (SELECT COUNT(*) FROM warga w WHERE w.rt_id = r.id AND w.is_active)::int AS warga
          FROM rt r
         WHERE r.rw_id = ${rwId}
         ORDER BY r.kode_rt`,
    );
    return reply.ok({
      baris,
      total: {
        kk: baris.reduce((s, b) => s + b.kk, 0),
        warga: baris.reduce((s, b) => s + b.warga, 0),
      },
    });
  });

  /**
   * Agregat hunian per RT (§7.1) — total rumah & unit kosong (`status_huni =
   * 'kos'`); terisi = total − kosong. `status_huni` lain (milik/sewa/kontrak)
   * dihitung terisi.
   */
  app.get("/rw/agregat/hunian", async (req, reply) => {
    const { rwId } = wajibRw(req);
    const baris = await denganScopeRequest(req, (tx) =>
      tx.$queryRaw<BarisHunianRt[]>`
        SELECT r.id::text AS "rtId",
               r.kode_rt AS "kodeRt",
               (SELECT COUNT(*) FROM rumah h WHERE h.rt_id = r.id)::int AS total,
               (SELECT COUNT(*) FROM rumah h WHERE h.rt_id = r.id AND h.status_huni = 'kos')::int AS kosong
          FROM rt r
         WHERE r.rw_id = ${rwId}
         ORDER BY r.kode_rt`,
    );
    return reply.ok({
      baris: baris.map((b) => ({ ...b, terisi: b.total - b.kosong })),
      total: {
        total: baris.reduce((s, b) => s + b.total, 0),
        terisi: baris.reduce((s, b) => s + (b.total - b.kosong), 0),
        kosong: baris.reduce((s, b) => s + b.kosong, 0),
      },
    });
  });

  /**
   * Batch 21 · agregat IURAN per RT (§7.2) — kepatuhan (tagihan `lunas` ÷
   * tagihan terbit, 1 desimal), penerimaan (`nominal_awal − sisa`), sisa/
   * tunggakan, dan subsidi (keringanan `aktif` + `disetujui` yang mencakup
   * periode, dihitung unik per warga). Hanya hitungan & nominal agregat —
   * tanpa nama/NIK/wargaId pada respons (§6.4.10, §7.2).
   *
   * `?periode=YYYY-MM` (default = bulan berjalan server); nilai tidak valid →
   * VALIDATION 400 — bukan baris nol yang menyamar sebagai "lunas bulan ini".
   * Filter scope berlapis ganda: join `rt.rw_id` + kebijakan RLS SELECT
   * rw-join (migrasi 20261010000200); tabel `tagihan`/`keringanan` tetap
   * tertutup tulis bagi sesi RW.
   */
  app.get("/rw/agregat/iuran", async (req, reply) => {
    const { rwId } = wajibRw(req);
    const kueri = req.query as { periode?: string };
    const periode = kueri.periode ?? periodeSekarang();
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periode)) {
      throw new GalatTolak("VALIDATION", "Parameter periode harus berformat YYYY-MM (contoh: 2026-10).");
    }

    const baris = await denganScopeRequest(req, (tx) =>
      tx.$queryRaw<BarisIuranRt[]>`
        SELECT r.id::text AS "rtId",
               r.kode_rt AS "kodeRt",
               COUNT(t.id)::int AS "jumlahTagihan",
               COUNT(t.id) FILTER (WHERE t.status = 'lunas')::int AS "jumlahLunas",
               COALESCE(SUM(t.nominal_awal - t.sisa), 0)::float AS "terbayar",
               COALESCE(SUM(t.sisa), 0)::float AS "sisa",
               COALESCE(MAX(s.jumlah), 0)::int AS "subsidiJumlah",
               COALESCE(MAX(s.nominal), 0)::float AS "subsidiNominal"
          FROM rt r
          LEFT JOIN tagihan t
                 ON t.rt_id = r.id AND t.periode = ${periode}
          LEFT JOIN (
                 SELECT k.rt_id,
                        COUNT(DISTINCT k.warga_id)::int AS jumlah,
                        SUM(k.nominal_keringanan)::float AS nominal
                   FROM keringanan k
                  WHERE k.status = 'aktif'
                    AND k.status_approval = 'disetujui'
                    AND k.periode_mulai <= ${periode}
                    AND (k.periode_sampai IS NULL OR k.periode_sampai >= ${periode})
                  GROUP BY k.rt_id
               ) s ON s.rt_id = r.id
         WHERE r.rw_id = ${rwId}
         GROUP BY r.id, r.kode_rt
         ORDER BY r.kode_rt`,
    );

    const lapor = baris.map((b) => ({ ...b, kepatuhan: hitungKepatuhan(b.jumlahLunas, b.jumlahTagihan) }));
    const totalTagihan = lapor.reduce((s, b) => s + b.jumlahTagihan, 0);
    const totalLunas = lapor.reduce((s, b) => s + b.jumlahLunas, 0);
    return reply.ok({
      periode,
      baris: lapor,
      total: {
        jumlahTagihan: totalTagihan,
        jumlahLunas: totalLunas,
        kepatuhan: hitungKepatuhan(totalLunas, totalTagihan),
        terbayar: lapor.reduce((s, b) => s + b.terbayar, 0),
        sisa: lapor.reduce((s, b) => s + b.sisa, 0),
        subsidiJumlah: lapor.reduce((s, b) => s + b.subsidiJumlah, 0),
        subsidiNominal: lapor.reduce((s, b) => s + b.subsidiNominal, 0),
      },
    });
  });
};
