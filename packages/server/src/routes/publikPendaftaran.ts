/**
 * Pendaftaran mandiri RT — PRD §9.5 (Fase 5, SEBAGIAN: tanpa payment gateway).
 *
 *   POST /publik/pendaftaran  PUBLIK — formulir Landing Page → baris antrean +
 *                             token aktivasi `<pendaftaran_id>.<kode>`
 *   POST /publik/aktivasi     PUBLIK — tautan aktivasi → PROVISIONING TENANT
 *                             (kecamatan→kelurahan→rw→rt + langganan +
 *                             pengurus ketua + akun pengurus) + sesi langsung
 *
 * Kejujuran (instruksi "tanpa data palsu"):
 *   • formulir benar-benar disimpan ke `pendaftaran_rt` — tombol kirim tidak
 *     pernah menampilkan sukses simulasi;
 *   • TANPA gateway WhatsApp: tautan aktivasi DIKEMBALIKAN pada respons dan
 *     ditampilkan formulir — tidak ada janji "dikirim via WhatsApp" yang tak
 *     bisa ditepati.
 *
 * Keamanan (mengikuti pola aktivasi warga §5.1/§14.1):
 *   • token URL = `<pendaftaran_id>.<kode>`; kode hanya hidup sebagai hash
 *     argon2id, lookup by id + verifikasi hash — kode asli tak pernah disimpan;
 *   • single-use IRREVERSIBEL: transisi ditutup dengan
 *     `updateMany({status:'menunggu_aktivasi'})` sehingga balapan paralel hanya
 *     menghasilkan satu pemenang; berlaku 24 jam (`kedaluwarsaDari`);
 *   • seluruh penulisan provisioning berjalan DALAM transaksi scope
 *     `platform` — RLS registry (migrasi 0002) hanya mengabulkan tulis wilayah
 *     pada level `platform`; galat di tengah transaksi me-ROLLBACK semuanya
 *     (tak ada tenant setengah jadi);
 *   • kode wilayah resmi Kemendagri TIDAK diketahui pendaftar mandiri → kolom
 *     `kecamatan.kode`, `kelurahan.kode_kemendagri`, `rt.kode_wilayah` dibiarkan
 *     NULL (deviasi terdokumentasi — diisi ulang lewat impor data wilayah);
 *   • `kota` hanya hidup di `pendaftaran_rt` — hierarki wilayah skema ini tak
 *     punya kolom kota (deviasi terdokumentasi).
 */
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { catatAudit } from "../plugins/audit.js";
import { NAMA_COOKIE_SESI, opsiCookieSesi } from "../plugins/auth.js";
import { tanamCookieCsrf } from "../plugins/csrf.js";
import { GalatTolak } from "../plugins/guard.js";
import { batasAuth } from "../plugins/ratelimit.js";
import { db, denganScope, type DbTransaksi } from "../services/db.js";
import {
  PANJANG_KATA_SANDI_MAX,
  formatKataSandiValid,
  hashKataSandi,
} from "../services/kredensial.js";
import { buatSesi } from "../services/sesi.js";
import {
  buatKodeUndangan,
  cocokkanKodeUndangan,
  hashKodeUndangan,
  kedaluwarsaDari,
} from "../services/tokenUndangan.js";
import { RE_UUID } from "../services/undanganWarga.js";

const PESAN_TIDAK_AKTIVASI =
  "Tautan aktivasi tidak ditemukan atau tidak berlaku — daftarkan RT kembali untuk mendapat tautan baru.";
const PESAN_KEDALUWARSA =
  "Tautan aktivasi sudah kedaluwarsa (berlaku 24 jam) — daftarkan RT kembali untuk mendapat tautan baru.";
const PESAN_SUDAH_AKTIF =
  "Pendaftaran sudah diaktivasi — silakan login dengan email yang Anda daftarkan.";
const PESAN_RT_SUDAH_TERDAFTAR =
  "RT ini sudah terdaftar — silakan login dengan akun pengurus yang sudah ada, atau hubungi kami bila ini keliru.";

const skemaPendaftaran = z.object({
  namaKetua: z.string().trim().min(3, "Nama ketua/admin RT wajib minimal 3 karakter.").max(120),
  whatsapp: z
    .string()
    .trim()
    .regex(/^\d{10,13}$/, "Nomor WhatsApp harus 10–13 digit angka."),
  rt: z.string().trim().regex(/^\d{1,3}$/, "Nomor RT harus 1–3 digit angka."),
  rw: z.string().trim().regex(/^\d{1,3}$/, "Nomor RW harus 1–3 digit angka."),
  kecamatan: z.string().trim().min(3, "Nama kecamatan wajib minimal 3 karakter.").max(120),
  kelurahan: z.string().trim().min(3, "Nama kelurahan wajib minimal 3 karakter.").max(120),
  kota: z.string().trim().min(2, "Nama kota wajib minimal 2 karakter.").max(80),
  paket: z.enum(["pro_trial", "free"]),
  // Dipastikan `=== true` di handler (pola persetujuan B14).
  setuju: z.boolean().optional(),
});

const skemaAktivasi = z.object({
  token: z.string().trim().min(8).max(160),
  email: z
    .string()
    .trim()
    .min(5)
    .max(160)
    .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Format email tidak valid."),
  password: z.string().max(PANJANG_KATA_SANDI_MAX, `Kata sandi maksimal ${PANJANG_KATA_SANDI_MAX} karakter.`),
  konfirmasiPassword: z.string().min(1, "Ulangi kata sandi wajib diisi."),
});

function uaDari(req: FastifyRequest): string | null {
  const ua = req.headers["user-agent"];
  return (Array.isArray(ua) ? ua[0] : ua) ?? null;
}

function tolakTautan(reply: FastifyReply): FastifyReply {
  return reply.gagal("NOT_FOUND", PESAN_TIDAK_AKTIVASI);
}

/** Cari entri wilayah tanpa memperhatikan besar-kecil huruf — tidak ketemu → buat. */
async function cariAtauBuatKecamatan(tx: DbTransaksi, nama: string): Promise<string> {
  const ada = await tx.kecamatan.findFirst({
    where: { nama: { equals: nama, mode: "insensitive" } },
    select: { id: true },
  });
  if (ada) return ada.id;
  return (await tx.kecamatan.create({ data: { nama } })).id;
}

async function cariAtauBuatKelurahan(
  tx: DbTransaksi,
  kecamatanId: string,
  nama: string,
): Promise<string> {
  const ada = await tx.kelurahan.findFirst({
    where: { kecamatanId, nama: { equals: nama, mode: "insensitive" } },
    select: { id: true },
  });
  if (ada) return ada.id;
  return (await tx.kelurahan.create({ data: { kecamatanId, nama } })).id;
}

export const rutePublikPendaftaran: FastifyPluginAsync = async (app) => {
  // -------------------------------------------------------------------------
  // PUBLIK — formulir Landing Page: simpan antrean + terbitkan token aktivasi
  // -------------------------------------------------------------------------
  app.post("/publik/pendaftaran", { config: batasAuth }, async (req, reply) => {
    const hasil = skemaPendaftaran.safeParse(req.body);
    if (!hasil.success) {
      const pesan = hasil.error.issues[0]?.message;
      return reply.gagal(
        "VALIDATION",
        pesan ?? "Lengkapi seluruh kolom wajib dengan format yang benar (RT/RW angka, WhatsApp 10–13 digit).",
      );
    }
    if (hasil.data.setuju !== true) {
      return reply.gagal(
        "VALIDATION",
        "Persetujuan Ketentuan Layanan & kepatuhan UU PDP wajib dicentang.",
      );
    }
    const d = hasil.data;

    const kode = buatKodeUndangan();
    const kodeHash = await hashKodeUndangan(kode);
    const kini = new Date();
    const ua = uaDari(req);

    // Pendaftaran ulang untuk RT/kelurahan yang sama MEMBUANG antrean lama yang
    // masih menunggu → satu RT hanya punya SATU tautan hidup (tautan lama hangus).
    const baris = await denganScope("platform", null, async (tx) => {
      await tx.pendaftaranRt.deleteMany({
        where: {
          status: "menunggu_aktivasi",
          kecamatan: d.kecamatan,
          kelurahan: d.kelurahan,
          kodeRt: d.rt,
          kodeRw: d.rw,
        },
      });
      const dibuat = await tx.pendaftaranRt.create({
        data: {
          namaKetua: d.namaKetua,
          whatsapp: d.whatsapp,
          kodeRt: d.rt,
          kodeRw: d.rw,
          kecamatan: d.kecamatan,
          kelurahan: d.kelurahan,
          kota: d.kota,
          paket: d.paket === "pro_trial" ? "pro" : "free",
          setujuPdp: true,
          status: "menunggu_aktivasi",
          kodeHash,
          kedaluwarsaPada: kedaluwarsaDari(kini),
          ip: req.ipAsli,
        },
      });
      await catatAudit(
        {
          scopeLevel: "platform",
          scopeId: null,
          actorId: dibuat.id,
          actorRole: "sistem",
          portal: "publik",
          modul: "pendaftaran",
          aksi: "daftar_rt",
          aksiBadge: "Menunggu Aktivasi",
          ringkasan: `Pendaftaran mandiri (tanpa akun): RT ${d.rt}/RW ${d.rw}, Kel. ${d.kelurahan}, Kec. ${d.kecamatan}, ${d.kota} — paket ${d.paket}`,
          ip: req.ipAsli,
          userAgent: ua,
        },
        tx,
      );
      return dibuat;
    });

    return reply.ok({
      pendaftaranId: baris.id,
      token: `${baris.id}.${kode}`,
      kedaluwarsaPada: baris.kedaluwarsaPada.toISOString(),
    });
  });

  // -------------------------------------------------------------------------
  // PUBLIK — aktivasi: tautan sah → provisioning tenant + akun + sesi
  // -------------------------------------------------------------------------
  app.post("/publik/aktivasi", { config: batasAuth }, async (req, reply) => {
    const hasil = skemaAktivasi.safeParse(req.body);
    if (!hasil.success) {
      const pesan = hasil.error.issues[0]?.message;
      return reply.gagal("VALIDATION", pesan ?? "Email dan kata sandi tidak valid.");
    }
    const { token, password, konfirmasiPassword } = hasil.data;
    const email = hasil.data.email.toLowerCase();

    const titik = token.lastIndexOf(".");
    if (titik < 1) return tolakTautan(reply);
    const idPendaftaran = token.slice(0, titik);
    const kode = token.slice(titik + 1);
    if (!RE_UUID.test(idPendaftaran) || !kode || kode.length > 64) return tolakTautan(reply);

    const baris = await db().pendaftaranRt.findUnique({ where: { id: idPendaftaran } });
    if (!baris) return tolakTautan(reply);
    if (baris.status === "aktif") return reply.gagal("CONFLICT", PESAN_SUDAH_AKTIF);
    if (baris.status === "kedaluwarsa" || baris.kedaluwarsaPada.getTime() < Date.now()) {
      // Penandaan kedaluwarsa bersifat best effort — kegagalan tidak mengubah jawaban.
      await db()
        .pendaftaranRt.updateMany({
          where: { id: baris.id, status: "menunggu_aktivasi" },
          data: { status: "kedaluwarsa" },
        })
        .catch(() => undefined);
      return reply.gagal("TOKEN_EXPIRED", PESAN_KEDALUWARSA);
    }
    if (!(await cocokkanKodeUndangan(baris.kodeHash, kode))) return tolakTautan(reply);

    if (!formatKataSandiValid(password)) {
      return reply.gagal(
        "VALIDATION",
        "Kata sandi minimal 8 karakter dan bukan kata sandi yang sangat umum.",
      );
    }
    if (password !== konfirmasiPassword) {
      return reply.gagal("VALIDATION", "Ulangi kata sandi tidak sama.");
    }

    const kini = new Date();
    const ua = uaDari(req);
    const hashBaru = await hashKataSandi(password);
    const paket = baris.paket; // enum langganan: free | pro | max
    const ujiCoba = paket !== "free";
    const aktifSampai = (() => {
      if (!ujiCoba) return null;
      const d = new Date(kini);
      d.setUTCDate(d.getUTCDate() + 30);
      return d;
    })();

    let hasilTx: { penggunaId: string; nama: string } | "balapan";
    try {
      hasilTx = await denganScope("platform", null, async (tx) => {
        // 1. Transisi IRREVERSIBEL single-use — balapan paralel: satu pemenang.
        const transisi = await tx.pendaftaranRt.updateMany({
          where: { id: baris.id, status: "menunggu_aktivasi" },
          data: { status: "aktif", dipakaiPada: kini },
        });
        if (transisi.count !== 1) return "balapan" as const;

        // 2. Email akun harus unik seluruh platform.
        const emailSudah = await tx.penggunaPengurus.findUnique({
          where: { email },
          select: { id: true },
        });
        if (emailSudah) {
          throw new GalatTolak(
            "CONFLICT",
            "Email sudah terdaftar — gunakan email lain atau login bila akun Anda sudah aktif.",
          );
        }

        // 3. Hierarki wilayah: temukan atau buat dari nama formulir (tanpa kode resmi).
        const kecamatanId = await cariAtauBuatKecamatan(tx, baris.kecamatan);
        const kelurahanId = await cariAtauBuatKelurahan(tx, kecamatanId, baris.kelurahan);
        const rwAda = await tx.rw.findFirst({
          where: { kelurahanId, kodeRw: baris.kodeRw },
          select: { id: true },
        });
        const rw =
          rwAda ?? (await tx.rw.create({ data: { kelurahanId, kodeRw: baris.kodeRw } }));

        // 4. RT: sudah ada + sudah punya pengurus → ditolak (terdaftar ganda).
        const statusRt = ujiCoba ? ("uji_coba" as const) : ("aktif" as const);
        let rt = await tx.rt.findFirst({ where: { rwId: rw.id, kodeRt: baris.kodeRt } });
        if (rt) {
          const pengurusAda = await tx.pengurusRt.findFirst({
            where: { rtId: rt.id },
            select: { id: true },
          });
          if (pengurusAda) throw new GalatTolak("CONFLICT", PESAN_RT_SUDAH_TERDAFTAR);
          rt = await tx.rt.update({
            where: { id: rt.id },
            data: { kelurahanId, status: statusRt },
          });
        } else {
          rt = await tx.rt.create({
            data: { rwId: rw.id, kodeRt: baris.kodeRt, kelurahanId, status: statusRt },
          });
        }

        // 5. Kelengkapan tenant: langganan (paket dipilih) + pengaturan default.
        await tx.langganan.upsert({
          where: { rtId: rt.id },
          create: {
            rtId: rt.id,
            paket,
            mulai: kini,
            aktifSampai,
            status: ujiCoba ? "uji_coba" : "aktif",
            metodeBayar: "belum",
          },
          update: {
            paket,
            mulai: kini,
            aktifSampai,
            status: ujiCoba ? "uji_coba" : "aktif",
            metodeBayar: "belum",
          },
        });
        await tx.pengaturanRt.upsert({
          where: { rtId: rt.id },
          create: { rtId: rt.id },
          update: {},
        });

        // 6. Pengurus ketua + akun login (sandi sudah di-hash argon2id).
        const pengurus = await tx.pengurusRt.create({
          data: {
            rtId: rt.id,
            nama: baris.namaKetua,
            jabatan: "ketua",
            email,
            noHp: baris.whatsapp,
          },
        });
        const pengguna = await tx.penggunaPengurus.create({
          data: {
            peran: "rt_admin",
            rtId: rt.id,
            email,
            noHp: baris.whatsapp,
            passwordHash: hashBaru,
            status: "active",
          },
        });
        await tx.rt.update({ where: { id: rt.id }, data: { ketuaRtId: pengurus.id } });
        await tx.pendaftaranRt.update({ where: { id: baris.id }, data: { rtId: rt.id } });

        await catatAudit(
          {
            scopeLevel: "rt",
            scopeId: rt.id,
            actorId: pengguna.id,
            actorRole: "rt_admin",
            portal: "rt",
            modul: "auth",
            aksi: "aktivasi_pendaftaran",
            aksiBadge: "Berhasil",
            ringkasan: `Aktivasi akun mandiri: ${baris.namaKetua} — RT ${baris.kodeRt}/RW ${baris.kodeRw}, Kel. ${baris.kelurahan}, Kec. ${baris.kecamatan}`,
            ip: req.ipAsli,
            userAgent: ua,
          },
          tx,
        );
        return { penggunaId: pengguna.id, nama: baris.namaKetua };
      });
    } catch (err) {
      // Balapan unik (email/RT sama persis di detik yang sama) → konflik jujur.
      const prisma = err as { code?: string; meta?: { target?: unknown } };
      if (prisma.code === "P2002") {
        const target = String(prisma.meta?.target ?? "");
        return reply.gagal(
          "CONFLICT",
          target.includes("email")
            ? "Email sudah terdaftar — gunakan email lain."
            : PESAN_RT_SUDAH_TERDAFTAR,
        );
      }
      throw err; // GalatTolak diteruskan ke errorHandler (409 dsb.)
    }

    if (hasilTx === "balapan") {
      return reply.gagal("TOKEN_INVALID", "Tautan sudah dipakai — silakan login.");
    }

    // Akun aktif → sesi dipasang persis seperti login (langsung masuk portal RT).
    await db().penggunaPengurus.update({
      where: { id: hasilTx.penggunaId },
      data: { lastLoginAt: new Date() },
    });
    const sesi = await buatSesi({
      subjekId: hasilTx.penggunaId,
      peran: "rt_admin",
      ip: req.ipAsli,
      infoPerangkat: ua,
    });
    reply.setCookie(NAMA_COOKIE_SESI, sesi.sid, opsiCookieSesi(sesi.maxAgeDetik));
    tanamCookieCsrf(reply, sesi.sid, sesi.maxAgeDetik);

    return reply.ok({ peran: "rt_admin" as const, nama: hasilTx.nama, email });
  });
};
