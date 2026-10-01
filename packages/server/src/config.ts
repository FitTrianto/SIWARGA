/**
 * Konfigurasi runtime SIWARGA server.
 *
 * Semua env divalidasi sekali di startup (fail-fast): nilai yang salah lebih
 * baik menghentikan proses daripada menghasilkan kredensial lemah diam-diam.
 * Salin `.env.example` → `.env` untuk pengaturan lokal.
 */
import "dotenv/config";
import { randomBytes } from "node:crypto";
import { z } from "zod";

const skemaEnv = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().min(1).default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  /** Tidak wajib di lingkungan tanpa database (mis. menjalankan test unit). */
  DATABASE_URL: z.string().min(1).optional(),
  /** >= 32 karakter — dipakai menandatangani token sesi/CSRF. */
  SESSION_SECRET: z.string().min(32).optional(),
  /** Base64 32 byte — kunci AES-256-GCM untuk NIK & data sensitif (§14/B17). */
  NIK_ENCRYPTION_KEY: z.string().optional(),
  /** Idle timeout sesi warga (§17.2, usulan 30 menit). */
  SESSION_IDLE_DETIK: z.coerce.number().int().positive().default(1800),
  /** Rate limit rute auth (§14.1: 10 req/menit/IP). */
  AUTH_RATE_LIMIT_PER_MENIT: z.coerce.number().int().positive().default(10),
  /** Periode iuran berjalan 'YYYY-MM' — PRD menetapkan Oktober 2026. */
  PERIODE_AKTIF: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "harus format YYYY-MM, mis. 2026-10")
    .default("2026-10"),
});

const hasilParse = skemaEnv.safeParse(process.env);

if (!hasilParse.success) {
  const detail = hasilParse.error.issues
    .map((i) => `  • ${i.path.join(".")}: ${i.message}`)
    .join("\n");
  throw new Error(`Environment tidak valid:\n${detail}`);
}

const env = hasilParse.success ? hasilParse.data : (undefined as never);

function kunciBase64(nama: string, panjangByte: number): Buffer {
  const nilai = env[nama as "SESSION_SECRET" | "NIK_ENCRYPTION_KEY"];
  if (nilai) {
    const buf = Buffer.from(nilai, "base64");
    // tolak base64 yang tidak valid (Buffer.from tidak pernah melempar)
    if (buf.length !== panjangByte || Buffer.from(nilai, "base64").toString("base64").replace(/=+$/, "") !== nilai.replace(/=+$/, "")) {
      throw new Error(
        `${nama} harus tepat ${panjangByte} byte base64. Buat dengan:\n` +
          `  node -e "console.log(require('crypto').randomBytes(${panjangByte}).toString('base64'))"`,
      );
    }
    return buf;
  }
  if (env.NODE_ENV === "production") {
    throw new Error(
      `${nama} wajib diisi di production (tidak boleh di-generate otomatis).`,
    );
  }
  // Lingkungan dev/test tanpa .env: kunci sementara + peringatan keras,
  // karena data yang ter-encryption tidak akan bisa dibaca lagi setelah proses berakhir.
  console.warn(
    `[config] ${nama} tidak diisi — memakai kunci acak sementara untuk ${env.NODE_ENV}. ` +
      `Data ter-encryption TIDAK akan dapat dibaca kembali setelah restart. Isi .env untuk hasil permanen.`,
  );
  return randomBytes(panjangByte);
}

export const config = {
  env: env.NODE_ENV,
  isProduksi: env.NODE_ENV === "production",
  isTest: env.NODE_ENV === "test",
  host: env.HOST,
  port: env.PORT,
  databaseUrl: env.DATABASE_URL,
  sessionIdleDetik: env.SESSION_IDLE_DETIK,
  authRateLimitPerMenit: env.AUTH_RATE_LIMIT_PER_MENIT,
  /** Periode iuran berjalan 'YYYY-MM' (PERIODE_AKTIF = Oktober 2026). */
  periodeAktif: env.PERIODE_AKTIF,
  /** TTL refresh token sesi (hari) */
  refreshTtlHari: 14,
  /** Durasi penguncian akun setelah ≥3 kata sandi salah (§4.3) */
  loginLockoutMenit: 15,
  /** Maksimal percobaan kata sandi sebelum akun dikunci (§4.3) */
  loginMaksGagal: 3,
  /** Masa berlaku token undangan (§14.1) */
  undanganJam: 24,
  /** Validitas OTP (§5.5) */
  otpMenit: 5,
  sessionSecret: kunciBase64("SESSION_SECRET", 32),
  nikKey: kunciBase64("NIK_ENCRYPTION_KEY", 32),
} as const;

export type Config = typeof config;
