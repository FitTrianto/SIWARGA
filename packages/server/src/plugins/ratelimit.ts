/**
 * Rate limit — PRD §14.1: `POST /auth/**` maksimal 10 req/menit/IP.
 *
 * Default global yang longgar dipasang sebagai jaring pengaman untuk seluruh
 * rute; rute auth memakai `batasAuth` yang jauh lebih ketat.
 */
import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";
import { config } from "../config.js";

/** Default keseluruhan: 300 req/menit/IP — cukup untuk UI normal. */
export const BATAS_UMUM = {
  max: 300,
  timeWindow: "1 minute",
} as const;

/** Khusus rute auth (§14.1): 10 req/menit/IP. */
export const batasAuth = {
  rateLimit: {
    max: config.authRateLimitPerMenit,
    timeWindow: "1 minute",
  },
} as const;

export async function pasangRateLimit(app: FastifyInstance): Promise<void> {
  await app.register(rateLimit, {
    global: true,
    max: BATAS_UMUM.max,
    timeWindow: BATAS_UMUM.timeWindow,
    // IP asli; `trustProxy` = false sehingga X-Forwarded-For dari klien
    // manapun tidak dipercaya (anti-spoofing rate limit)
    keyGenerator: (req) => req.ipAsli || req.ip,
    errorResponseBuilder: (req, context) => ({
      ok: false,
      error: {
        code: "RATE_LIMITED",
        message: `Terlalu banyak permintaan — batas ${context.max} per ${context.after}.`,
      },
    }),
  });
}
