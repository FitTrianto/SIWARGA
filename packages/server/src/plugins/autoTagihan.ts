/**
 * Pemeriksa tagihan bulanan OTOMATIS — PRD §6.4.3 (iuran tergenerate tiap
 * bulan tanpa klik tombol).
 *
 * Dijalankan:
 *   • saat server `onReady` — tagihan periode berjalan langsung lengkap;
 *   • setiap 6 jam — menutup kasus server hidup melewati pergantian bulan
 *     (rotasi `config.periodeAktif` mengikuti bulan berjalan bila env
 *     `PERIODE_AKTIF` tidak dikunci).
 *
 * Kebenaran & keamanan:
 *   • NON-TEST + `DATABASE_URL` tersedia saja — tes tidak pernah memicu
 *     generate sendiri (hitungan fixture tetap deterministik);
 *   • idempoten: kombinasi `(warga, kategori, periode)` unik — interval
 *     berikutnya hanya menambah tagihan yang belum ada (dihitung `dilewati`);
 *   • SETIAP kueri ber-scope (`platform` untuk mendaftar RT, `rt` untuk
 *     generate + audit) karena tabel memakai `FORCE ROW LEVEL SECURITY`;
 *   • audit ditulis HANYA bila ada tagihan baru — tidak membanjiri
 *     `audit_log` tiap interval; actor memakai UUID sistem + `actorRole:
 *     "sistem"` (`audit_log.actor_id` tanpa FK).
 *
 * Tombol manual `POST /rt/iuran/tagihan/generate` tetap ada untuk bendahara
 * (sinkron profil / periode lampau) — pemeriksa ini hanya melengkapi.
 */
import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { catatAudit } from "./audit.js";
import { databaseTersedia, denganScope } from "../services/db.js";
import { PENGATURAN_IURAN_DASAR, generateTagihanPeriode } from "../services/generateTagihan.js";

/** Interval pemeriksaan (6 jam). */
const JEDA_MILI = 6 * 60 * 60 * 1000;
/** UUID tetap untuk actor sistem — `audit_log.actor_id` tidak ber-FK. */
const AKTOR_SISTEM = "00000000-0000-0000-0000-000000000000";

/**
 * Batch 15 — alasan generate otomatis DILEWATI untuk satu RT (`null` = boleh
 * generate). Murni tanpa DB supaya bisa diuji langsung (tes 15B):
 *
 *   • `mode-manual`  — RT memilih tagihan manual lewat tombol Portal RT;
 *   • `belum-hari`   — hari berjalan (Asia/Jakarta) belum sampai `hari_generate`;
 *   • `tutup-buku`   — buku aktif dan periode berjalan SETELAH periode tutup
 *                      ("tak mengulang ke bulan berikutnya").
 */
export function blokadeAutoTagihan(opsi: {
  mode: "otomatis" | "manual";
  hari: number;
  /** Tanggal bulan berjalan di Asia/Jakarta (1–31). */
  tanggalHariIni: number;
  periode: string;
  tutup: { periodeTertutup: string; dibukaKembaliPada: Date | null } | null;
}): { alasan: "mode-manual" } | { alasan: "belum-hari"; hari: number } | { alasan: "tutup-buku"; periodeTertutup: string } | null {
  if (opsi.mode === "manual") return { alasan: "mode-manual" };
  if (opsi.tanggalHariIni < opsi.hari) return { alasan: "belum-hari", hari: opsi.hari };
  if (opsi.tutup && !opsi.tutup.dibukaKembaliPada && opsi.periode > opsi.tutup.periodeTertutup)
    return { alasan: "tutup-buku", periodeTertutup: opsi.tutup.periodeTertutup };
  return null;
}

/**
 * Tanggal bulan berjalan di zona Asia/Jakarta — acuan "tanggal disetting"
 * `pengaturan_rt.hari_generate` (server boleh berjalan di zona lain; tanggal
 * warga/RT tetap WIB).
 */
export function tanggalJakarta(): number {
  const bagian = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Jakarta", day: "numeric" }).formatToParts(new Date());
  return Number(bagian.find((p) => p.type === "day")?.value ?? "1");
}

export async function pasangAutoTagihan(app: FastifyInstance): Promise<void> {
  if (config.isTest || !databaseTersedia()) return;

  const periode = () => config.periodeAktif; // dibaca tiap jalan — ikut rotasi bulan

  const jalan = async (): Promise<void> => {
    let rts: Array<{ id: string }> = [];
    try {
      rts = await denganScope("platform", null, (tx) => tx.rt.findMany({ select: { id: true } }));
    } catch (e) {
      app.log.warn({ e }, "[auto-tagihan] gagal mendaftar RT — percobaan berikutnya di interval");
      return;
    }

    for (const rt of rts) {
      const p = periode();
      try {
        // Batch 15 — gerbang per RT sebelum generate: mode manual, hari
        // disetting (Asia/Jakarta), dan tutup buku aktif. Dilewati tanpa
        // audit (bukan peristiwa) — cukup log debug agar tidak membanjiri.
        const blokade = await denganScope("rt", rt.id, async (tx) => {
          const pengaturan = await tx.pengaturanRt.findUnique({
            where: { rtId: rt.id },
            select: { modeTagihan: true, hariGenerate: true },
          });
          const tutup = await tx.tutupBukuIuran.findUnique({ where: { rtId: rt.id } });
          return blokadeAutoTagihan({
            mode: pengaturan?.modeTagihan ?? PENGATURAN_IURAN_DASAR.modeTagihan,
            hari: pengaturan?.hariGenerate ?? PENGATURAN_IURAN_DASAR.hariGenerate,
            tanggalHariIni: tanggalJakarta(),
            periode: p,
            tutup,
          });
        });
        if (blokade) {
          app.log.debug({ rtId: rt.id, ...blokade }, "[auto-tagihan] generate dilewati (gerbang batch 15)");
          continue;
        }
        const hasil = await denganScope("rt", rt.id, (tx) =>
          generateTagihanPeriode(tx, rt.id, p),
        );
        if (hasil.dibuat > 0) {
          await denganScope("rt", rt.id, (tx) =>
            catatAudit(
              {
                scopeLevel: "rt",
                scopeId: rt.id,
                actorId: AKTOR_SISTEM,
                actorRole: "sistem",
                portal: "rt",
                modul: "iuran",
                aksi: "generate_tagihan",
                aksiBadge: "Otomatis",
                entitas: "tagihan",
                sesudah: { periode: p, dibuat: hasil.dibuat, dilewati: hasil.dilewati, otomatis: true },
                ringkasan: `Generate tagihan otomatis ${p}: ${hasil.dibuat} dibuat, ${hasil.dilewati} dilewati`,
              },
              tx,
            ),
          );
          app.log.info(
            { rtId: rt.id, periode: p, ...hasil },
            "[auto-tagihan] tagihan periode berjalan dibuat otomatis",
          );
        }
      } catch (e) {
        // Satu RT gagal (mis. belum dimigrasi) tidak menghentikan RT lain.
        app.log.error({ e, rtId: rt.id }, "[auto-tagihan] gagal generate untuk satu RT");
      }
    }
  };

  let timer: NodeJS.Timeout | null = null;
  app.addHook("onReady", async () => {
    await jalan();
    timer = setInterval(() => void jalan(), JEDA_MILI);
    timer.unref?.();
  });
  app.addHook("onClose", async () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  });
}
