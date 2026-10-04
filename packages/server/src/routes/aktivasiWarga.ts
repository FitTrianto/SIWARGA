/**
 * Aktivasi Portal Warga lewat undangan — F-2 (task B1/B4/B5/B6, §5.1/§5.2/§5.4).
 *
 *   GET    /auth/warga/undangan/:token            PUBLIK — detail undangan
 *   POST   /auth/warga/undangan/:token/aktivasi   PUBLIK — buat kata sandi → sesi
 *   POST   /rt/warga/:id/undangan                 RT     — terbitkan token baru
 *   POST   /rt/undangan/:id/kirim-ulang           RT     — cabut lama + terbit baru (B5)
 *   DELETE /rt/undangan/:id                       RT     — cabut undangan (B5)
 *   GET    /rt/undangan/inspeksi                  RT     — token multi-perangkat (B6)
 *
 * KEBIJAKAN (Fase 3): aktivasi berakhir dengan pembuatan KATA SANDI (min 8,
 * NIST SP 800-63B), menggantikan konfirmasi 4 digit → PIN 6 digit (PRD v2.4
 * §5.5 versi lama — lihat catatan keputusan §5.1).
 *
 * Keamanan yang ditegakkan:
 *   • token URL = `<id>.<kode>`; lookup by id + verifikasi kode argon2id
 *     (kode asli tak pernah disimpan — §14.1), status dinilai murni via
 *     `verifikasiToken()`; token single-use IRREVERSIBEL (§4.2) — transisi
 *     ditutup dengan `updateMany({status:'menunggu'})` agar balapan dua
 *     aktivasi paralel hanya menghasilkan satu pemenang;
 *   • `consent !== true` ditolak (B14); kata sandi divalidasi kebijakan
 *     Fase 3 (min 8, tolak kata sandi umum) lalu di-hash argon2id;
 *   • `device_hash` dihitung server dari User-Agent + IP (bukan dipercaya
 *     dari klien); SETIAP percobaan — termasuk yang ditolak (badan tidak
 *     valid, token kedaluwarsa/sudah dipakai/dicabut, balapan transisi) —
 *     menulis satu entri `{ waktu, deviceHash, ip, hasil }` ke
 *     `token_undangan.percobaan_aktivasi` (B6); perangkat berbeda pada token
 *     sama → `notifikasi_job` ke pengurus RT pemilik (B6);
 *   • aktivasi mencabut seluruh sesi lama warga lalu menanam cookie sesi
 *     baru — status `warga.status_akses` berubah `menunggu_aktivasi → aktif`
 *     (§6.3) dan audit `aktivasi_undangan` tercatat di scope RT pemilik;
 *   • rute `/rt/**` dijaga `wajibRt` + `verifikasiCsrf`, scope SELALU dari
 *     sesi (§4.6) — id/no. HP hanya memilih warga DALAM RT tersebut.
 */
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { catatAudit } from "../plugins/audit.js";
import { NAMA_COOKIE_SESI, opsiCookieSesi } from "../plugins/auth.js";
import { tanamCookieCsrf, verifikasiCsrf } from "../plugins/csrf.js";
import { GalatTolak, wajibRt } from "../plugins/guard.js";
import { batasAuth } from "../plugins/ratelimit.js";
import { denganScopeRequest } from "../plugins/scope.js";
import { denganScope, type DbTransaksi } from "../services/db.js";
import { normalisasiNoHp } from "../services/identitasWarga.js";
import {
  PANJANG_KATA_SANDI_MAX,
  PANJANG_KATA_SANDI_MIN,
  formatKataSandiValid,
  hashKataSandi,
} from "../services/kredensial.js";
import { buatSesi, cabutSesiSubjek } from "../services/sesi.js";
import {
  buatKodeUndangan,
  entriPercobaan,
  hashKodeUndangan,
  hashPerangkat,
  perangkatBaruTerdeteksi,
  tokenBaru,
  type PercobaanAktivasi,
} from "../services/tokenUndangan.js";
import {
  RE_UUID,
  cariTokenAktivasi,
  daftarPercobaan,
  detailUndanganDari,
  type HasilCekAktivasi,
  type TokenUndanganBaris,
} from "../services/undanganWarga.js";
import { pengurusAktif, skemaId } from "./iuranUmum.js";

const PESAN_TIDAK_DITEMUKAN =
  "Undangan tidak ditemukan — pastikan Anda membuka link/QR terbaru dari Pengurus RT.";

/** Batas entri `percobaan_aktivasi` yang disimpan per token (B6). */
const BATAS_PERCOBAAN = 20;

/** Kode error API untuk penolakan token (§5.0). */
type KodeTolak = "TOKEN_EXPIRED" | "TOKEN_INVALID" | "NOT_FOUND";

const skemaToken = z.object({ token: z.string().trim().min(1).max(120) });

const skemaAktivasi = z.object({
  // Kebijakan Fase 3: kata sandi, bukan PIN 6-digit (NIST SP 800-63B).
  password: z
    .string()
    .max(PANJANG_KATA_SANDI_MAX, `Kata sandi maksimal ${PANJANG_KATA_SANDI_MAX} karakter.`),
  konfirmasiPassword: z.string().min(1, "Ulangi kata sandi wajib diisi."),
  // B14 — persetujuan dipastikan `=== true` di handler (bukan sekadar ada).
  consent: z.boolean().optional(),
});

const skemaWargaUndangan = z.object({ id: z.string().trim().min(3).max(64) });

/** `noHpBaru` opsional untuk kirim-ulang — 10–13 digit (B5, §5.4). */
const skemaKirimUlang = z.object({
  noHpBaru: z
    .string()
    .trim()
    .regex(/^\d{10,13}$/, "No. HP baru harus 10–13 digit angka.")
    .optional(),
});

/**
 * Target `PATCH /rt/warga/:id/akses` (B5). Menerima `statusAkses` (konvensi
 * kode) maupun `status_akses` (tulisan §5.4 dokumen desain) — keduanya sama.
 */
const skemaAkses = z.object({
  statusAkses: z.enum(["dinonaktifkan", "aktif"]).optional(),
  status_akses: z.enum(["dinonaktifkan", "aktif"]).optional(),
});

/** Petakan hasil cek token → respons penolakan konstan (§5.1). */
function infoTolakToken(cek: HasilCekAktivasi): { kode: KodeTolak; pesan: string } {
  switch (cek.hasil) {
    case "kedaluwarsa":
      return {
        kode: "TOKEN_EXPIRED",
        pesan: "Masa berlaku undangan sudah berakhir — minta undangan baru dari Pengurus RT.",
      };
    case "sudah_dipakai":
      return {
        kode: "TOKEN_INVALID",
        pesan: "Undangan sudah pernah dipakai — silakan login bila portal Anda sudah aktif.",
      };
    case "dicabut":
      return { kode: "TOKEN_INVALID", pesan: "Undangan telah dicabut oleh Pengurus RT." };
    default:
      return { kode: "NOT_FOUND", pesan: PESAN_TIDAK_DITEMUKAN };
  }
}

function tolakToken(reply: FastifyReply, cek: HasilCekAktivasi): FastifyReply {
  const { kode, pesan } = infoTolakToken(cek);
  return reply.gagal(kode, pesan);
}

function uaDari(req: FastifyRequest): string | null {
  const ua = req.headers["user-agent"];
  return (Array.isArray(ua) ? ua[0] : ua) ?? null;
}

/**
 * B6 — kabarkan temuan perangkat berbeda ke pengurus RT pemilik token lewat
 * antrian `notifikasi_job` (tipe `aktivasi`). Dibuat DALAM transaksi pemanggil
 * supaya penulisan entri percobaan dan kabar tidak pernah berjauhan.
 * Selalu best effort: kegagalan notifikasi tidak boleh menjatuhkan aktivasi.
 */
async function kabarPerangkatBerbeda(
  tx: DbTransaksi,
  token: TokenUndanganBaris,
  entri: PercobaanAktivasi,
  warga?: { id: string; nama: string },
): Promise<void> {
  try {
    const pengurus = await tx.pengurusRt.findUnique({
      where: { id: token.dibuatOleh },
      select: { noHp: true },
    });
    if (!pengurus?.noHp) return;
    const nama =
      warga?.nama ??
      (await tx.warga.findUnique({ where: { id: token.wargaId }, select: { nama: true } }))?.nama;
    await tx.notifikasiJob.create({
      data: {
        tipe: "aktivasi",
        tujuan: pengurus.noHp,
        payload: {
          wargaId: token.wargaId,
          namaWarga: nama ?? "Warga",
          tokenId: token.id,
          temuan: "perangkat_berbeda",
          deviceHash: entri.deviceHash,
          hasil: entri.hasil ?? "berhasil",
          waktu: entri.waktu,
        },
      },
    });
  } catch {
    /* best effort — antrian notifikasi bukan prasyarat respons */
  }
}

/**
 * B6 — tulis SATU entri percobaan yang ditolak ke `percobaan_aktivasi`.
 *
 * Pembacaan ulang baris dilakukan DI DALAM transaksi scope RT pemilik agar
 * entri yang ditulis selalu bersandar pada daftar terkini (menang kalah
 * balapan pun tidak saling menimpa) — lalu entri disimpan + kabar perangkat
 * berbeda bila `device_hash` berbeda dari entri sebelumnya.
 * Selalu best effort: kegagalan menulis tidak boleh menggagalkan respons.
 */
async function catatPercobaanDitolak(
  token: TokenUndanganBaris | undefined,
  entri: PercobaanAktivasi,
): Promise<void> {
  if (!token) return; // token tak dikenal → tak ada baris yang bisa dicatat
  try {
    await denganScope("rt", token.rtId, async (tx) => {
      const baris = await tx.tokenUndangan.findUnique({ where: { id: token.id } });
      if (!baris) return;
      const lama = daftarPercobaan(baris.percobaanAktivasi);
      const perangkatBaru = perangkatBaruTerdeteksi(
        {
          status: baris.status,
          kedaluwarsaPada: baris.kedaluwarsaPada,
          dipakaiPada: baris.dipakaiPada,
          dicabutPada: baris.dicabutPada,
          percobaanAktivasi: lama,
        },
        entri.deviceHash,
      );
      const daftar = [...lama, entri].slice(-BATAS_PERCOBAAN);
      await tx.tokenUndangan.update({
        where: { id: token.id },
        data: { percobaanAktivasi: daftar as object },
      });
      if (perangkatBaru) await kabarPerangkatBerbeda(tx, token, entri);
    });
  } catch {
    /* best effort — pencatatan tidak boleh menjatuhkan respons aktivasi */
  }
}

export const ruteAktivasiWarga: FastifyPluginAsync = async (app) => {
  // -------------------------------------------------------------------------
  // PUBLIK — detail undangan untuk halaman /undangan/<token>
  // -------------------------------------------------------------------------
  app.get("/auth/warga/undangan/:token", { config: batasAuth }, async (req, reply) => {
    const p = skemaToken.safeParse(req.params);
    if (!p.success) return reply.gagal("NOT_FOUND", PESAN_TIDAK_DITEMUKAN);

    const cek = await cariTokenAktivasi(p.data.token);
    if (cek.hasil !== "sah") return tolakToken(reply, cek);

    return reply.ok(await detailUndanganDari(cek));
  });

  // -------------------------------------------------------------------------
  // PUBLIK — aktivasi: buat kata sandi → token dipakai → sesi warga
  // -------------------------------------------------------------------------
  app.post("/auth/warga/undangan/:token/aktivasi", { config: batasAuth }, async (req, reply) => {
    const p = skemaToken.safeParse(req.params);
    if (!p.success) return reply.gagal("NOT_FOUND", PESAN_TIDAK_DITEMUKAN);

    // B6 — baris token dicari SEBELUM badan divalidasi: setiap permintaan yang
    // mengenai satu baris token meninggalkan tepat SATU entri percobaan,
    // berapa pun isinya. Hasil selalu sama bagi klien (anti-enumerasi).
    const cek = await cariTokenAktivasi(p.data.token);
    const ua = uaDari(req);
    const deviceHash = hashPerangkat(ua ?? "", req.ipAsli ?? null);
    const kini = new Date();
    const entri = (hasil: string) => entriPercobaan({ deviceHash, ip: req.ipAsli, now: kini, hasil });

    if (cek.hasil !== "sah") {
      await catatPercobaanDitolak(cek.token, entri(cek.hasil));
      return tolakToken(reply, cek);
    }

    const tolakValidasi = async (pesan: string): Promise<FastifyReply> => {
      await catatPercobaanDitolak(cek.token, entri("gagal_validasi"));
      return reply.gagal("VALIDATION", pesan);
    };
    const b = skemaAktivasi.safeParse(req.body);
    if (!b.success) {
      return tolakValidasi(`Kata sandi wajib diisi (minimal ${PANJANG_KATA_SANDI_MIN} karakter).`);
    }
    if (b.data.consent !== true) {
      return tolakValidasi("Persetujuan Syarat & Ketentuan dan Kebijakan Privasi wajib dicentang.");
    }
    const { password } = b.data;
    if (!formatKataSandiValid(password)) {
      return tolakValidasi(
        `Kata sandi minimal ${PANJANG_KATA_SANDI_MIN} karakter dan bukan kata sandi yang sangat umum.`,
      );
    }
    if (password !== b.data.konfirmasiPassword) {
      return tolakValidasi("Ulangi kata sandi tidak sama.");
    }

    if (cek.warga.statusAkses === "aktif") {
      await catatPercobaanDitolak(cek.token, entri("sudah_aktif"));
      return reply.gagal(
        "TOKEN_INVALID",
        "Portal sudah aktif — silakan login dengan No. HP dan kata sandi Anda.",
      );
    }
    if (!cek.warga.isActive) {
      await catatPercobaanDitolak(cek.token, entri("warga_nonaktif"));
      return reply.gagal("TOKEN_INVALID", "Akun warga tidak aktif — hubungi Pengurus RT.");
    }
    if (!cek.warga.noHp) {
      await catatPercobaanDitolak(cek.token, entri("data_tidak_lengkap"));
      return reply.gagal(
        "TOKEN_INVALID",
        "Data no. HP warga belum lengkap — hubungi Pengurus RT untuk melengkapi data.",
      );
    }

    const perangkatBaru = perangkatBaruTerdeteksi(cek.token, deviceHash);
    const entriBerhasil = entri("berhasil");
    const hashBaru = await hashKataSandi(password);

    const hasilTransisi = await denganScope("rt", cek.warga.rtId, async (tx) => {
      // Transisi IRREVERSIBEL dengan syarat status — balapan paralel hanya
      // memunculkan satu pemenang; yang kalah tidak menyentuh baris apa pun.
      // Entri percobaan BERHASIL ikut ditulis di sini supaya atomik dengan
      // penandaan `aktif_dipakai` (B6).
      const percobaan = [
        ...daftarPercobaan(cek.token.percobaanAktivasi),
        entriBerhasil,
      ].slice(-BATAS_PERCOBAAN);
      const transisi = await tx.tokenUndangan.updateMany({
        where: { id: cek.token.id, status: "menunggu" },
        data: {
          status: "aktif_dipakai",
          dipakaiPada: kini,
          percobaanAktivasi: percobaan as object,
        },
      });
      if (transisi.count !== 1) return "balapan" as const;

      await tx.warga.update({ where: { id: cek.warga.id }, data: { statusAkses: "aktif" } });
      await tx.kredensialWarga.upsert({
        where: { wargaId: cek.warga.id },
        create: { wargaId: cek.warga.id, passwordHash: hashBaru, gagalBerturut: 0, dikunciSampai: null },
        update: { passwordHash: hashBaru, gagalBerturut: 0, dikunciSampai: null },
      });

      // B6 — perangkat berbeda pada token sama: catat + notifikasi ke RT.
      if (perangkatBaru) {
        await kabarPerangkatBerbeda(
          tx,
          cek.token,
          entriBerhasil,
          { id: cek.warga.id, nama: cek.warga.nama },
        );
      }

      await catatAudit(
        {
          scopeLevel: "rt",
          scopeId: cek.warga.rtId,
          actorId: cek.warga.id,
          actorRole: "warga",
          portal: "warga",
          modul: "auth",
          aksi: "aktivasi_undangan",
          aksiBadge: "Berhasil",
          ringkasan: `Aktivasi portal via undangan: ${cek.warga.nama}`,
          ip: req.ipAsli,
          userAgent: ua,
        },
        tx,
      );
      return "berhasil" as const;
    });

    if (hasilTransisi !== "berhasil") {
      // Kalah balapan: baris sudah terpakai pihak lain — tetap dicatat (B6).
      await catatPercobaanDitolak(cek.token, entri("balapan"));
      return reply.gagal("TOKEN_INVALID", "Undangan sudah dipakai — silakan login.");
    }

    // Kredensial berubah → sesi lama warga ikut hangus (B5), lalu tanam sesi baru.
    await cabutSesiSubjek(cek.warga.id, "warga");
    const sesi = await buatSesi({
      subjekId: cek.warga.id,
      peran: "warga",
      ip: req.ipAsli,
      infoPerangkat: ua,
    });
    reply.setCookie(NAMA_COOKIE_SESI, sesi.sid, opsiCookieSesi(sesi.maxAgeDetik));
    tanamCookieCsrf(reply, sesi.sid, sesi.maxAgeDetik);

    return reply.ok({ peran: "warga" as const, nama: cek.warga.nama });
  });

  // -------------------------------------------------------------------------
  // RT — terbitkan undangan (task B4): `<id>.<kode>` baru, token lama dicabut
  // -------------------------------------------------------------------------
  app.post(
    "/rt/warga/:id/undangan",
    { preHandler: verifikasiCsrf, config: batasAuth },
    async (req, reply) => {
      const { rtId, sesi } = wajibRt(req);

      const p = skemaWargaUndangan.safeParse(req.params);
      if (!p.success) return reply.gagal("VALIDATION", "Parameter warga tidak valid.");
      const kunci = p.data.id;

      // Penerima dipilih di DALAM RT sesi ini: uuid id warga ATAU no. HP
      // (keduanya terbatas scope RT — penyusupan id RT lintas tenant mustahil §4.6).
      const warga = await denganScopeRequest(req, (tx) =>
        tx.warga.findFirst({
          where: RE_UUID.test(kunci) ? { id: kunci, rtId } : { rtId, noHp: normalisasiNoHp(kunci) },
          select: {
            id: true,
            nama: true,
            noHp: true,
            statusAkses: true,
            isActive: true,
            rumahId: true,
            kkId: true,
          },
        }),
      );
      if (!warga) return reply.gagal("NOT_FOUND", "Warga tidak ditemukan di Data Warga RT.");
      if (!warga.isActive) {
        return reply.gagal("CONFLICT", `${warga.nama} berstatus non-aktif — aktifkan dulu datanya.`);
      }
      if (warga.statusAkses === "aktif") {
        return reply.gagal("CONFLICT", `${warga.nama} sudah aktif portalnya — tidak perlu undangan baru.`);
      }
      if (warga.statusAkses === "dinonaktifkan") {
        // Kewenangan pengurus RT (Okt 2026): status portal hanya boleh diubah
        // MENJADI nonaktif — menerbitkan undangan justru mengubahnya kembali
        // ke `menunggu_aktivasi` (jalan memutar mengaktifkan portal).
        return reply.gagal(
          "CONFLICT",
          `${warga.nama} berstatus Dinonaktifkan — Portal RT hanya dapat mengubah status portal menjadi nonaktif.`,
        );
      }
      if (!warga.noHp) {
        return reply.gagal(
          "VALIDATION",
          `${warga.nama} belum punya no. HP — wajib diisi dulu di Data Warga (syarat login).`,
        );
      }
      // §6.3 — prasyarat data lengkap. Spesifikasi §5.2 awal menulis "500";
      // kondisi ini adalah kesalahan input yang bisa diperbaiki pengurus, jadi
      // dipakai VALIDATION (400) — koreksi tercatat pada §5.2.
      if (!warga.rumahId || !warga.kkId) {
        return reply.gagal(
          "VALIDATION",
          `Data ${warga.nama} belum lengkap (rumah/KK) — lengkapi dulu di Data Warga.`,
        );
      }

      const kode = buatKodeUndangan();
      const hasil = await denganScopeRequest(req, async (tx) => {
        const akunPengurus = await pengurusAktif(tx, rtId, sesi.subjekId);

        // Satu undangan aktif per warga: token 'menunggu' lama dicabut lebih
        // dahulu — kode lama tak pernah disimpan sehingga penerbitan ulang
        // SELALU menghasilkan tautan baru (§4.2; kirim-ulang = terbit ulang).
        await tx.tokenUndangan.updateMany({
          where: { rtId, wargaId: warga.id, status: "menunggu" },
          data: { status: "dicabut", dicabutOleh: akunPengurus, dicabutPada: new Date() },
        });

        const baru = tokenBaru(new Date());
        const dibuat = await tx.tokenUndangan.create({
          data: {
            rtId,
            wargaId: warga.id,
            kodeHash: await hashKodeUndangan(kode),
            status: baru.status,
            dibuatOleh: akunPengurus,
            kedaluwarsaPada: baru.kedaluwarsaPada,
            kirimKeNomor: warga.noHp,
          },
        });
        // §6.3 — status akses mengikuti penerbitan undangan.
        await tx.warga.update({ where: { id: warga.id }, data: { statusAkses: "menunggu_aktivasi" } });

        const rumah = warga.rumahId
          ? await tx.rumah.findUnique({ where: { id: warga.rumahId }, select: { alamatPendek: true } })
          : null;
        const pengurus = await tx.pengurusRt.findUnique({
          where: { id: akunPengurus },
          select: { nama: true },
        });

        await catatAudit(
          {
            scopeLevel: "rt",
            scopeId: rtId,
            actorId: sesi.subjekId,
            actorRole: "rt_admin",
            portal: "rt",
            modul: "auth",
            aksi: "kirim_undangan",
            aksiBadge: "Terbit",
            ringkasan: `Undangan portal untuk ${warga.nama}`,
            ip: req.ipAsli,
            userAgent: uaDari(req),
          },
          tx,
        );

        return {
          id: dibuat.id,
          alamat: rumah?.alamatPendek ?? "-",
          dikirimOleh: pengurus?.nama ?? "Pengurus RT",
          berlakuSampai: dibuat.kedaluwarsaPada.toISOString(),
        };
      });

      return reply.ok({
        id: hasil.id,
        token: `${hasil.id}.${kode}`,
        nama: warga.nama,
        alamat: hasil.alamat,
        dikirimOleh: hasil.dikirimOleh,
        berlakuSampai: hasil.berlakuSampai,
        noWa: warga.noHp,
      });
    },
  );

  // -------------------------------------------------------------------------
  // RT — kirim ulang undangan (task B5, §5.4)
  //
  // "Verifikasi no. HP baru dulu → token lama → dicabut, token baru terbit."
  // Urutan yang ditegakkan:
  //   1. token harus berada di scope RT sesi (lintas RT → 404);
  //   2. token `aktif_dipakai` / warga `aktif` → 409 (tak ada yang dikirim ulang);
  //   3. no. HP efektif (opsional `noHpBaru`, 10–13 digit ternormalisasi) &
  //      data rumah/KK warga wajib lengkap — VALIDATION 400;
  //   4. transaksi: token 'menunggu' → `dicabut`, token BARU terbit dengan kode
  //      segar (kode lama tak pernah disimpan), `status_akses` →
  //      `menunggu_aktivasi`, no. HP diperbarui bila berubah, audit TUNGGAL
  //      `kirim_ulang_undangan` (sebelum/sesudah no. HP bila berubah).
  // -------------------------------------------------------------------------
  app.post(
    "/rt/undangan/:id/kirim-ulang",
    { preHandler: verifikasiCsrf, config: batasAuth },
    async (req, reply) => {
      const { rtId, sesi } = wajibRt(req);
      const { id } = z.object({ id: skemaId }).parse(req.params);
      const body = skemaKirimUlang.parse(req.body ?? {});
      const noHpBaru = body.noHpBaru ? normalisasiNoHp(body.noHpBaru) : null;
      const kode = buatKodeUndangan();

      const hasil = await denganScopeRequest(req, async (tx) => {
        const token = await tx.tokenUndangan.findFirst({
          where: { id, rtId },
          select: {
            id: true,
            status: true,
            wargaId: true,
            warga: {
              select: {
                id: true,
                nama: true,
                noHp: true,
                statusAkses: true,
                isActive: true,
                rumahId: true,
                kkId: true,
              },
            },
          },
        });
        // ID asing / lintas RT → NOT_FOUND (404): keberadaan baris tidak bocor.
        if (!token) throw new GalatTolak("NOT_FOUND", "Undangan tidak ditemukan.");
        const warga = token.warga;
        if (token.status === "aktif_dipakai") {
          throw new GalatTolak(
            "CONFLICT",
            "Undangan sudah dipakai dan bersifat permanen — gunakan Nonaktifkan Akses bila perlu menonaktifkan portal.",
          );
        }
        if (warga.statusAkses === "aktif") {
          throw new GalatTolak("CONFLICT", `${warga.nama} sudah aktif portalnya — tidak perlu undangan ulang.`);
        }
        if (warga.statusAkses === "dinonaktifkan") {
          // Kewenangan pengurus RT (Okt 2026) — lihat catatan di
          // `POST /rt/warga/:id/undangan`: undangan tak dipakai memutar
          // mengaktifkan portal yang sudah dinonaktifkan.
          throw new GalatTolak(
            "CONFLICT",
            `${warga.nama} berstatus Dinonaktifkan — Portal RT hanya dapat mengubah status portal menjadi nonaktif.`,
          );
        }
        if (!warga.isActive) {
          throw new GalatTolak("CONFLICT", `${warga.nama} berstatus non-aktif — aktifkan dulu datanya.`);
        }
        // No. HP efektif: nomor baru bila dikirim, andai tidak pakai nomor lama.
        const noHp = noHpBaru ?? warga.noHp;
        if (!noHp) {
          throw new GalatTolak(
            "VALIDATION",
            `${warga.nama} belum punya no. HP — kirim ulang dengan noHpBaru (10–13 digit).`,
          );
        }
        if (!warga.rumahId || !warga.kkId) {
          throw new GalatTolak(
            "VALIDATION",
            `Data ${warga.nama} belum lengkap (rumah/KK) — lengkapi dulu di Data Warga.`,
          );
        }

        const oleh = await pengurusAktif(tx, rtId, sesi.subjekId);
        const kini = new Date();

        // Token 'menunggu' lama (termasuk baris yang sedang diminta) → dicabut;
        // kode asli tidak pernah tersimpan sehingga penerbitan ulang selalu
        // menghasilkan tautan segar (§4.2).
        await tx.tokenUndangan.updateMany({
          where: { rtId, wargaId: warga.id, status: "menunggu" },
          data: { status: "dicabut", dicabutOleh: oleh, dicabutPada: kini },
        });

        const kodeHash = await hashKodeUndangan(kode);
        const baru = tokenBaru(kini);
        const dibuat = await tx.tokenUndangan.create({
          data: {
            rtId,
            wargaId: warga.id,
            kodeHash,
            status: baru.status,
            dibuatOleh: oleh,
            kedaluwarsaPada: baru.kedaluwarsaPada,
            kirimKeNomor: noHp,
          },
        });

        const noHpBerubah = noHp !== warga.noHp;
        // §6.3 — status akses mengikuti penerbitan undangan; no. HP diperbarui
        // bila diganti (bentrok dengan warga lain → P2002 → 409, transaksi batal).
        await tx.warga.update({
          where: { id: warga.id },
          data: {
            statusAkses: "menunggu_aktivasi",
            ...(noHpBerubah ? { noHp } : {}),
          },
        });

        const rumah = warga.rumahId
          ? await tx.rumah.findUnique({ where: { id: warga.rumahId }, select: { alamatPendek: true } })
          : null;
        const pengurus = await tx.pengurusRt.findUnique({
          where: { id: oleh },
          select: { nama: true },
        });

        await catatAudit(
          {
            scopeLevel: "rt",
            scopeId: rtId,
            actorId: sesi.subjekId,
            actorRole: "rt_admin",
            portal: "rt",
            modul: "auth",
            aksi: "kirim_ulang_undangan",
            aksiBadge: "Terbit",
            entitas: "token_undangan",
            entitasId: dibuat.id,
            ...(noHpBerubah ? { sebelum: { noHp: warga.noHp }, sesudah: { noHp } } : {}),
            ringkasan: noHpBerubah
              ? `Kirim ulang undangan ${warga.nama} — no. HP diperbarui`
              : `Kirim ulang undangan portal untuk ${warga.nama}`,
            ip: req.ipAsli,
            userAgent: uaDari(req),
          },
          tx,
        );

        return {
          id: dibuat.id,
          nama: warga.nama,
          alamat: rumah?.alamatPendek ?? "-",
          dikirimOleh: pengurus?.nama ?? "Pengurus RT",
          berlakuSampai: dibuat.kedaluwarsaPada.toISOString(),
          noWa: noHp,
        };
      });

      return reply.ok({ ...hasil, token: `${hasil.id}.${kode}` });
    },
  );

  // -------------------------------------------------------------------------
  // RT — cabut undangan (task B5, §5.4)
  //
  // Idempoten: baris yang SUDAH `dicabut` membalas `{ ulang: true }` tanpa
  // audit ganda. `aktif_dipakai` → 409 (irreversible §4.2 — arahkan ke
  // Nonaktifkan Akses). Setelah dicabut & tak ada token 'menunggu' tersisa,
  // `status_akses` `menunggu_aktivasi` → `belum_diundang` (§6.3).
  // -------------------------------------------------------------------------
  app.delete(
    "/rt/undangan/:id",
    { preHandler: verifikasiCsrf, config: batasAuth },
    async (req, reply) => {
      const { rtId, sesi } = wajibRt(req);
      const { id } = z.object({ id: skemaId }).parse(req.params);

      const hasil = await denganScopeRequest(req, async (tx) => {
        const token = await tx.tokenUndangan.findFirst({
          where: { id, rtId },
          select: {
            id: true,
            status: true,
            wargaId: true,
            warga: { select: { nama: true, statusAkses: true } },
          },
        });
        if (!token) throw new GalatTolak("NOT_FOUND", "Undangan tidak ditemukan.");
        if (token.status === "aktif_dipakai") {
          throw new GalatTolak(
            "CONFLICT",
            "Undangan sudah dipakai dan tidak bisa dicabut — gunakan Nonaktifkan Akses bila perlu.",
          );
        }
        if (token.status === "dicabut") return { id: token.id, ulang: true }; // idempoten

        const oleh = await pengurusAktif(tx, rtId, sesi.subjekId);
        await tx.tokenUndangan.update({
          where: { id: token.id },
          data: { status: "dicabut", dicabutOleh: oleh, dicabutPada: new Date() },
        });

        // §6.3 — tak ada undangan tersisa → warga kembali 'belum_diundang'.
        const sisaMenunggu = await tx.tokenUndangan.count({
          where: { wargaId: token.wargaId, status: "menunggu" },
        });
        const sebelum = token.warga.statusAkses;
        const sesudah = sisaMenunggu === 0 && sebelum === "menunggu_aktivasi" ? "belum_diundang" : sebelum;
        if (sesudah !== sebelum) {
          await tx.warga.update({ where: { id: token.wargaId }, data: { statusAkses: sesudah } });
        }

        await catatAudit(
          {
            scopeLevel: "rt",
            scopeId: rtId,
            actorId: sesi.subjekId,
            actorRole: "rt_admin",
            portal: "rt",
            modul: "auth",
            aksi: "cabut_undangan",
            aksiBadge: "Cabut",
            entitas: "token_undangan",
            entitasId: token.id,
            sebelum: { statusUndangan: token.status, statusAkses: sebelum },
            sesudah: { statusUndangan: "dicabut", statusAkses: sesudah },
            ringkasan: `Cabut undangan portal ${token.warga.nama}`,
            ip: req.ipAsli,
            userAgent: uaDari(req),
          },
          tx,
        );

        return { id: token.id, ulang: false };
      });

      return reply.ok(hasil);
    },
  );

  // -------------------------------------------------------------------------
  // RT — daftar undangan (tambahan Okt 2026; kontrak §5.4 kini memuat endpoint
  // ini di samping terbit/kirim-ulang/cabut/inspeksi)
  //
  // FE butuh sumber status token SEBENARNYA setelah muat ulang halaman: baris
  // "Undangan Dikirim" yang tokennya lewat 24 jam harus tampil "Kedaluwarsa"
  // (§4.2 — kedaluwarsa boleh dibuat token baru), dan aksi Cabut/Kirim Ulang
  // harus menemukan token UUID server. Sebelumnya FE memasangkan token lewat
  // daftar lokal yang kosong setelah F5 → Cabut tidak berdaya dan kedaluwarsa
  // tak pernah terlihat. Kode asli TIDAK pernah disimpan (§5.1) sehingga
  // daftar ini tidak mengembalikan tautan lama — hanya metadata + status.
  // -------------------------------------------------------------------------
  app.get("/rt/undangan", async (req, reply) => {
    const { rtId } = wajibRt(req);

    const daftar = await denganScopeRequest(req, async (tx) => {
      const baris = await tx.tokenUndangan.findMany({
        where: { rtId, status: { not: "dicabut" } },
        orderBy: { dibuatPada: "desc" },
        take: 500,
        select: {
          id: true,
          status: true,
          dibuatPada: true,
          kedaluwarsaPada: true,
          dibuatOleh: true,
          kirimKeNomor: true,
          warga: {
            select: {
              id: true,
              nama: true,
              noHp: true,
              isActive: true,
              rumah: { select: { alamatPendek: true } },
            },
          },
        },
      });

      const pengurusIds = [...new Set(baris.map((b) => b.dibuatOleh))];
      const pengurus = pengurusIds.length
        ? await tx.pengurusRt.findMany({
            where: { id: { in: pengurusIds } },
            select: { id: true, nama: true },
          })
        : [];
      const namaOleh = new Map(pengurus.map((p) => [p.id, p.nama]));

      const kini = Date.now();
      return baris
        .filter((b) => b.warga.isActive)
        .map((b) => {
          // Status efektif: kedaluwarsa dihitung dari waktu (§4.2), bukan hanya
          // nilai tersimpan — token boleh saja masih berlabel `menunggu`.
          const kedaluwarsa =
            b.status === "kedaluwarsa" ||
            (b.status === "menunggu" && b.kedaluwarsaPada.getTime() <= kini);
          return {
            id: b.id,
            wargaId: b.warga.id,
            nama: b.warga.nama,
            noWa: b.warga.noHp ?? b.kirimKeNomor ?? "",
            alamat: b.warga.rumah?.alamatPendek ?? "-",
            status:
              b.status === "aktif_dipakai" ? "aktif_dipakai" : kedaluwarsa ? "kedaluwarsa" : "menunggu",
            dibuatPada: b.dibuatPada.toISOString(),
            kedaluwarsaPada: b.kedaluwarsaPada.toISOString(),
            dikirimOleh: namaOleh.get(b.dibuatOleh) ?? "Pengurus RT",
          };
        });
    });

    return reply.ok({ undangan: daftar });
  });

  // -------------------------------------------------------------------------
  // RT — inspeksi undangan (task B6, §5.4)
  //
  // Token dengan >1 `device_hash` berarti ada lebih dari satu perangkat yang
  // menyentuh tautan yang sama → daftar "perlu perhatian" untuk kotak masuk
  // keamanan Data Warga RT. Baca saja (tanpa CSRF), seluruh baris dibatasi
  // scope RT sesi (§4.6).
  // -------------------------------------------------------------------------
  app.get("/rt/undangan/inspeksi", async (req, reply) => {
    const { rtId } = wajibRt(req);

    const daftar = await denganScopeRequest(req, async (tx) => {
      const baris = await tx.tokenUndangan.findMany({
        where: { rtId },
        orderBy: { dibuatPada: "desc" },
        take: 500,
        select: {
          id: true,
          status: true,
          dibuatPada: true,
          kedaluwarsaPada: true,
          dipakaiPada: true,
          kirimKeNomor: true,
          percobaanAktivasi: true,
          warga: { select: { id: true, nama: true, statusAkses: true } },
        },
      });

      const temuan: Array<Record<string, unknown>> = [];
      for (const t of baris) {
        const percobaan = daftarPercobaan(t.percobaanAktivasi);
        const perangkat = new Set(percobaan.map((p) => p.deviceHash));
        if (perangkat.size <= 1) continue; // satu perangkat = tak mencurigakan
        temuan.push({
          id: t.id,
          status: t.status,
          wargaId: t.warga.id,
          nama: t.warga.nama,
          statusAkses: t.warga.statusAkses,
          noHp: t.kirimKeNomor,
          dibuatPada: t.dibuatPada.toISOString(),
          berlakuSampai: t.kedaluwarsaPada.toISOString(),
          dipakaiPada: t.dipakaiPada?.toISOString() ?? null,
          jumlahPercobaan: percobaan.length,
          jumlahPerangkat: perangkat.size,
          percobaan: percobaan.map((p) => ({
            waktu: p.waktu,
            deviceHash: p.deviceHash,
            ip: p.ip,
            hasil: p.hasil ?? null,
          })),
        });
      }
      return temuan;
    });

    return reply.ok({ daftar });
  });
};
