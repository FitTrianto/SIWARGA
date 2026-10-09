/**
 * Profil tenant + Audit Log Portal RT (Batch 18 — multi-tenant tampilan).
 *
 *   GET /rt/profil     wajibRt — identitas RT login dari DB, bukan konstanta FE:
 *                      kode RT/RW, perumahan, alamat, kelurahan, kecamatan,
 *                      kota (dari baris pendaftaran mandiri bila ada), nama
 *                      Ketua RW, daftar pengurus, dan ringkas langganan.
 *   GET /rt/audit-log  wajibRt — baris `audit_log` scope RT login (RLS pola B):
 *                      pemilik tenant hanya melihat aktivitas miliknya sendiri.
 *
 * Latar (laporan bug multi-tenant Okt 2026): FE portal memakai konstanta
 * `tenant` hardcode (RT 04 / RW 012 / Pulo Gadung) sehingga RT hasil
 * pendaftaran mandiri melihat identitas & jejak aktivitas milik RT lain.
 * Kedua rute ini menyediakan sumber kebenaran dari DB agar halaman portal
 * menampilkan SATU identitas milik sesi berjalan — dan KOSONG bila memang
 * belum ada data (tanpa baris contoh yang menyamar sebagai data nyata).
 *
 * Keamanan (§4.6): scope SELALU dari `request.pemohon` (hasil hook sesi);
 * ID RT tidak pernah datang dari query/body klien. `audit_log` terproteksi
 * RLS pola B (scope_level + scope_id) sehingga baris tenant lain tidak mungkin
 * ikut terbaca walau kueri lupa menyaring.
 */
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { GalatTolak, wajibRt } from "../plugins/guard.js";
import { denganScopeRequest } from "../plugins/scope.js";
import { db } from "../services/db.js";

/** Kueri pembungkus: `ambil` (1..200, default 100) untuk audit log. */
const skemaQueryAudit = z.object({
  ambil: z.coerce.number().int().min(1).max(200).optional(),
});

export const ruteProfilTenant: FastifyPluginAsync = async (app) => {
  /**
   * Identitas RT login untuk tampilan portal (header, dasbor, kop surat,
   * nomor surat). `kota` hanya hidup di baris pendaftaran mandiri (Batch 17) —
   * RT seed tanpa pendaftaran membalas `null` (FE menampilkan "—", bukan
   * kota karangan).
   */
  app.get("/rt/profil", async (req, reply) => {
    const { rtId } = wajibRt(req);
    const rt = await denganScopeRequest(req, (tx) =>
      tx.rt.findUnique({
        where: { id: rtId },
        select: {
          kodeRt: true,
          perumahan: true,
          alamat: true,
          rw: { select: { kodeRw: true, namaKetua: true } },
          kelurahan: {
            select: { nama: true, kecamatan: { select: { nama: true } } },
          },
          pendaftaran: { select: { kota: true } },
          langganan: {
            select: { paket: true, status: true, mulai: true, aktifSampai: true },
          },
          pengurusList: {
            select: { id: true, nama: true, jabatan: true, email: true },
            orderBy: { createdAt: "asc" },
          },
        },
      }),
    );
    if (!rt) throw new GalatTolak("NOT_FOUND", "Data RT tidak ditemukan.");
    return reply.ok({
      rt: {
        kodeRt: rt.kodeRt,
        kodeRw: rt.rw.kodeRw,
        perumahan: rt.perumahan,
        alamat: rt.alamat,
        kelurahan: rt.kelurahan.nama,
        kecamatan: rt.kelurahan.kecamatan.nama,
        // Kolom `kota` tidak ada di tabel wilayah — hanya tercatat pada
        // pendaftaran mandiri (deviasi terdokumentasi di desain DB/API).
        kota: rt.pendaftaran?.kota ?? null,
        ketuaRw: rt.rw.namaKetua,
        pengurus: rt.pengurusList.map((p) => ({
          id: p.id,
          nama: p.nama,
          jabatan: String(p.jabatan),
          email: p.email,
        })),
        langganan: rt.langganan
          ? {
              paket: String(rt.langganan.paket),
              status: String(rt.langganan.status),
              mulai: rt.langganan.mulai.toISOString(),
              aktifSampai: rt.langganan.aktifSampai?.toISOString() ?? null,
            }
          : null,
      },
    });
  });

  /**
   * Audit Log milik RT login — dasbor kepatuhan PDP (§7.5). Nama aktor
   * diresolusi aman: pengurus lewat email akun (tabel platform), warga lewat
   * baris `warga` dalam scope sendiri; bila tak ter-resolve, `nama` null dan
   * FE menampilkan peran + email sebagai jatuh-tampilan jujur.
   */
  app.get("/rt/audit-log", async (req, reply) => {
    const { rtId } = wajibRt(req);
    const ambil = skemaQueryAudit.parse(req.query ?? {}).ambil ?? 100;

    const hasil = await denganScopeRequest(req, async (tx) => {
      const baris = await tx.auditLog.findMany({
        where: { scopeLevel: "rt", scopeId: rtId },
        orderBy: { createdAt: "desc" },
        take: ambil,
        select: {
          id: true,
          createdAt: true,
          actorId: true,
          actorRole: true,
          portal: true,
          modul: true,
          aksi: true,
          aksiBadge: true,
          ringkasan: true,
          ip: true,
        },
      });
      if (baris.length === 0) {
        return {
          baris,
          namaPengurus: new Map<string, string>(),
          namaWarga: new Map<string, string>(),
          emailPerId: new Map<string, string>(),
        };
      }

      const akun = await db().penggunaPengurus.findMany({
        where: { id: { in: [...new Set(baris.map((b) => b.actorId))] } },
        select: { id: true, email: true },
      });
      const emailPerId = new Map(akun.map((a) => [a.id, a.email]));
      const emails = [...new Set(akun.map((a) => a.email))];
      const namaPengurus = new Map<string, string>();
      if (emails.length) {
        const pengurus = await tx.pengurusRt.findMany({
          where: { email: { in: emails } },
          select: { email: true, nama: true },
        });
        for (const p of pengurus) namaPengurus.set(p.email, p.nama);
      }
      const idWarga = [
        ...new Set(baris.filter((b) => String(b.actorRole) === "warga").map((b) => b.actorId)),
      ];
      const namaWarga = new Map<string, string>();
      if (idWarga.length) {
        const warga = await tx.warga.findMany({
          where: { id: { in: idWarga } },
          select: { id: true, nama: true },
        });
        for (const w of warga) namaWarga.set(w.id, w.nama);
      }
      return { baris, namaPengurus, namaWarga, emailPerId };
    });

    const { emailPerId } = hasil;
    return reply.ok({
      baris: hasil.baris.map((b) => {
        const peran = String(b.actorRole);
        const email = emailPerId.get(b.actorId) ?? null;
        const nama =
          peran === "warga"
            ? hasil.namaWarga.get(b.actorId) ?? null
            : email
              ? hasil.namaPengurus.get(email) ?? null
              : null;
        return {
          id: b.id,
          waktu: b.createdAt.toISOString(),
          aktor: { peran, nama, email },
          portal: String(b.portal),
          modul: b.modul,
          aksi: b.aksi,
          aksiBadge: b.aksiBadge,
          ringkasan: b.ringkasan,
          ip: b.ip ? String(b.ip) : null,
        };
      }),
    });
  });
};
