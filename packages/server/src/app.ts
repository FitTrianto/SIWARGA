/**
 * Perakitan instance Fastify — PRD §12.1 (task B16).
 *
 * Urutan pemasangan penting:
 *   1. dekorator reply (ok/gagal)  → dipakai error handler & semua route
 *   2. error handler               → supaya galat plugin sebelumnya ikut tertangkap
 *   3. security headers + cookie
 *   4. rate limit
 *   5. pasangAuth → pasangScope  → request.sesi / request.pemohon tersedia
 *   6. route
 */
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import { config } from "./config.js";
import { pasangAuth } from "./plugins/auth.js";
import { pasangAutoTagihan } from "./plugins/autoTagihan.js";
import { pasangErrorHandler, statusDariKode } from "./plugins/errorHandler.js";
import { pasangRateLimit } from "./plugins/ratelimit.js";
import { pasangScope } from "./plugins/scope.js";
import { ruteAktivasiWarga } from "./routes/aktivasiWarga.js";
import { ruteAuthPengurus } from "./routes/auth-pengurus.js";
import { ruteAuthWarga } from "./routes/auth-warga.js";
import { ruteHealth } from "./routes/health.js";
import { ruteIuranRt } from "./routes/iuranRt.js";
import { ruteIuranWarga } from "./routes/iuranWarga.js";
import { ruteImporWarga } from "./routes/rtImporWarga.js";
import { ruteKasRt } from "./routes/kasRt.js";
import { rutePublikPendaftaran } from "./routes/publikPendaftaran.js";
import { ruteRtAjuanPerubahan } from "./routes/rtAjuanPerubahan.js";
import { ruteRtDataWarga } from "./routes/rtDataWarga.js";
import { ruteRtHunian } from "./routes/rtHunian.js";
import { ruteRtSurat } from "./routes/rtSurat.js";
import { ruteWargaKeluarga } from "./routes/wargaKeluarga.js";
import { ruteWargaHunian } from "./routes/wargaHunian.js";
import type { KodeApi } from "./types.js";

export const PREFIX_API = "/api/v1";

export async function buatAplikasi(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: config.isTest
      ? false
      : {
          level: process.env.LOG_LEVEL ?? "info",
          // body berisi NIK/No.KK → jangan pernah masuk log
          redact: ["req.headers.cookie", "req.headers.authorization", "body.nik", "body.password"],
        },
    genReqId: () => randomUUID(),
    trustProxy: false,
    disableRequestLogging: config.isTest,
    bodyLimit: 1_048_576, // 1 MiB — cukup untuk payload JSON, tolak bomb
  });

  app.decorateReply("ok", function (this: FastifyReply, data: unknown) {
    return this.send({ ok: true, data });
  });

  app.decorateReply(
    "gagal",
    function (this: FastifyReply, kode: KodeApi, message: string, detail?: unknown) {
      return this.status(statusDariKode(kode)).send({
        ok: false,
        error: { code: kode, message, ...(detail !== undefined ? { detail } : {}) },
      });
    },
  );

  pasangErrorHandler(app);

  await app.register(helmet);
  await app.register(cookie, {
    secret: config.sessionSecret,
    parseOptions: { path: "/" },
  });
  await pasangRateLimit(app);
  // 5. sesi & scope: dipanggil LANGSUNG (bukan `app.register()`) — tanpa
  //    `fastify-plugin`, register membuat konteks terenkapsulasi sehingga hook
  //    `onRequest` & dekorator tidak pernah dilihat route di instance induk.
  //    Urutan wajib sesudah cookie (sudah di-await) supaya parser cookie lebih
  //    dahulu mengisi `req.cookies` sebelum sesi diverifikasi.
  await pasangAuth(app);
  await pasangScope(app);
  await app.register(ruteHealth, { prefix: PREFIX_API });
  // F-2: sesi & login (cookie `sid` httpOnly + CSRF pengurus, §5.1/§5.2)
  await app.register(ruteAuthWarga, { prefix: PREFIX_API });
  await app.register(ruteAuthPengurus, { prefix: PREFIX_API });
  // F-2: aktivasi undangan (rute PUBLIK /auth/warga/undangan/* + terbit RT, §5.1/§5.2)
  await app.register(ruteAktivasiWarga, { prefix: PREFIX_API });
  // §9.5: pendaftaran mandiri Landing Page (rute PUBLIK /publik/* — Batch 17)
  await app.register(rutePublikPendaftaran, { prefix: PREFIX_API });
  // F-3: modul iuran (tagihan/riwayat/bukti warga + verifikasi RT → kas, §5.3/§5.4)
  await app.register(ruteIuranWarga, { prefix: PREFIX_API });
  await app.register(ruteIuranRt, { prefix: PREFIX_API });
  // F-4: kas append-only (buku kas, catat manual, jurnal pembalik — §5.4/§6.5)
  await app.register(ruteKasRt, { prefix: PREFIX_API });
  // F-6: data keluarga portal warga (baca KK + simpan kontak langsung — §5.3,
  // deviasi terdokumentasi atas jalur ajuan B11, lihat routes/wargaKeluarga.ts)
  await app.register(ruteWargaKeluarga, { prefix: PREFIX_API });
  await app.register(ruteWargaHunian, { prefix: PREFIX_API });

  // F-5 · B11/B20: antrean & verifikasi ajuan perubahan data warga (Portal RT)
  await app.register(ruteRtAjuanPerubahan, { prefix: PREFIX_API });

  // B13 · spesifikasi §5.4: CRUD Data Warga Portal RT (GET/POST/PATCH/DELETE
  // `/rt/warga`) — sumber kebenaran bersama Portal RT ↔ Portal Warga
  await app.register(ruteRtDataWarga, { prefix: PREFIX_API });

  // §5.4 · Data Hunian Portal RT (GET/POST `/rt/hunian`) — prasyarat link
  // rumah & Status Hunian (§6.1/§6.3); sebelumnya hanya state demo FE
  await app.register(ruteRtHunian, { prefix: PREFIX_API });

  // B12 · persuratan resmi & verifikasi publik (§6.6): kop pengaturan RT,
  // antrian/penerbitan surat, ajukan surat warga, dan cek QR `/q/:token`
  await app.register(ruteRtSurat, { prefix: PREFIX_API });

  // A10 · §9.1(6) Migrasi Data: impor CSV/XLSX warga → `impor_data` (§5.4)
  await app.register(ruteImporWarga, { prefix: PREFIX_API });

  // Iuran · §6.4.3: generate tagihan bulanan OTOMATIS saat start + interval
  // 6 jam (idempoten; dilewati pada mode test agar fixture tes deterministik).
  await pasangAutoTagihan(app);

  await app.ready();
  return app;
}
