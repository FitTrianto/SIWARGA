/**
 * Pemakaian bersama rute iuran (F-3) — PRD §5.3–§5.4, aturan §4.1, §4.4, §5.0.
 *
 * Berisi potongan kecil yang harus SAMA antara Portal Warga dan Portal RT:
 * label status FE, rentang periode, pemetaan baris pembayaran, resolusi
 * `pengurus_rt.id` (target polimorfik `verified_by` / `created_by`), dan
 * pembacaan header `Idempotency-Key` (§5.0).
 */
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { GalatTolak } from "../plugins/guard.js";
import type { DbTransaksi } from "../services/db.js";
import { tanggalPendek } from "../services/alokasiRepo.js";

/** Label persis kamus FE (mock `pembayaranDefault` / `tagihanRowDefault`). */
export const LABEL_PEMBAYARAN: Record<string, string> = {
  menunggu_verifikasi: "Menunggu Verifikasi",
  lunas: "Lunas",
  ditolak: "Ditolak",
};

/**
 * Status baris Portal RT — string persis seperti nilai `TagihanRow.status` di FE
 * sehingga filter "Tertunggak"/rekap `rekapIuran()` tetap cocok tanpa konversi.
 */
export type StatusBarisRt = "Lunas" | "Sebagian" | "Belum Bayar" | "Menunggu Verifikasi";

export const skemaPeriode = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Periode harus berformat YYYY-MM, mis. 2026-10.");

/** Validasi path param UUID (berkas kolom `@db.Uuid`). */
export const skemaId = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "ID tidak valid.");

/** 'YYYY-MM' → rentang tanggal dalam bulan itu (UTC, cocok untuk kolom `@db.Date`). */
export function periodeKeRentang(periode: string): { awal: Date; akhir: Date } {
  const [tahun, bulan] = periode.split("-").map(Number);
  return {
    awal: new Date(Date.UTC(tahun, bulan - 1, 1)),
    akhir: new Date(Date.UTC(tahun, bulan, 0, 23, 59, 59, 999)),
  };
}

/** Header `Idempotency-Key` (opsional) — melempar VALIDATION bila terlalu panjang. */
export function headerIdempotensi(req: FastifyRequest): string | null {
  const mentah = req.headers["idempotency-key"];
  const nilai = (Array.isArray(mentah) ? mentah[0] : mentah)?.trim();
  if (!nilai) return null;
  if (nilai.length > 120) {
    throw new GalatTolak("VALIDATION", "Idempotency-Key maksimal 120 karakter.");
  }
  return nilai;
}

/** Bentuk baris pembayaran yang dipakai bersama oleh kedua portal. */
export interface BarisPembayaranMentah {
  id: string;
  wargaId: string;
  tanggal: Date;
  nominal: unknown;
  metode: string;
  status: string;
  catatan: string | null;
  sumber: string;
  buktiUrl: string | null;
  diajukanOleh: string;
  verifiedAt: Date | null;
  createdAt: Date;
}

/** Hasil pemetaan baris pembayaran untuk respons API. */
export interface BarisPembayaran {
  id: string;
  wargaId: string;
  /** 'YYYY-MM-DD' */
  tanggal: string;
  nominal: number;
  metode: string;
  status: string;
  statusLabel: string;
  catatan: string | null;
  bukti: string | null;
  sumber: string;
  diajukanOleh: string;
  diverifikasiPada: string | null;
  diajukanPada: string;
}

export function ringkasPembayaran(p: BarisPembayaranMentah): BarisPembayaran {
  return {
    id: p.id,
    wargaId: p.wargaId,
    tanggal: tanggalPendek(p.tanggal),
    nominal: Number(p.nominal),
    metode: p.metode,
    status: p.status,
    statusLabel: LABEL_PEMBAYARAN[p.status] ?? p.status,
    catatan: p.catatan,
    bukti: p.buktiUrl,
    sumber: p.sumber,
    diajukanOleh: p.diajukanOleh,
    diverifikasiPada: p.verifiedAt ? p.verifiedAt.toISOString() : null,
    diajukanPada: p.createdAt.toISOString(),
  };
}

/**
 * `pengurus_rt.id` milik login berjalan — target polimorfik `verified_by`
 * (pembayaran) dan `created_by` (kas). `pengguna_pengurus` tidak punya FK ke
 * `pengurus_rt`, jadi dicocokkan lewat email pada RT yang sama, lalu jatuh ke
 * ketua RT, lalu pengurus pertama RT tsb.
 */
export async function pengurusAktif(tx: DbTransaksi, rtId: string, akunId: string): Promise<string> {
  const akun = await tx.penggunaPengurus.findUnique({
    where: { id: akunId },
    select: { email: true },
  });
  if (akun) {
    const cocok = await tx.pengurusRt.findFirst({
      where: { rtId, email: akun.email },
      select: { id: true },
    });
    if (cocok) return cocok.id;
  }
  const rt = await tx.rt.findUnique({ where: { id: rtId }, select: { ketuaRtId: true } });
  if (rt?.ketuaRtId) return rt.ketuaRtId;
  const pertama = await tx.pengurusRt.findFirst({
    where: { rtId },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!pertama) {
    throw new GalatTolak("CONFLICT", "Data pengurus RT belum lengkap — hubungi admin.");
  }
  return pertama.id;
}
