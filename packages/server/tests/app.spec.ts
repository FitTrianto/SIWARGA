/**
 * B16/B18 — Perakitan Fastify & kontrak respons API (PRD §5.0, §12.1).
 *
 * F-1 hanya menyediakan /health, tetapi kontraknya sudah dijaga sejak awal:
 *   • sukses  → { ok: true, data }
 *   • gagal   → { ok: false, error: { code, message } }
 *   • 404 tidak pernah membalas HTML bawaan
 *   • header keamanan (helmet) selalu terpasang
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PREFIX_API, buatAplikasi } from "../src/app.js";
import { config } from "../src/config.js";
import { BATAS_UMUM, batasAuth } from "../src/plugins/ratelimit.js";
import { statusDariKode } from "../src/plugins/errorHandler.js";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;

beforeAll(async () => {
  app = await buatAplikasi();
});

afterAll(async () => {
  await app.close();
});

describe("GET /api/v1/health", () => {
  it("membalas envelope { ok: true, data } dengan status sehat-menurut-kondisi", async () => {
    const res = await app.inject({ method: "GET", url: `${PREFIX_API}/health` });
    expect(res.statusCode).toBe(200);

    const body = res.json() as {
      ok: boolean;
      data: Record<string, unknown>;
    };
    expect(body.ok).toBe(true);
    expect(body.data).toBeDefined();

    const data = body.data;
    expect(data.versi).toBe("0.1.0");
    expect(data.env).toBe(config.env);
    expect(typeof data.uptimeDetik).toBe("number");
    expect(Number.isNaN(Date.parse(String(data.waktu)))).toBe(false);
  });

  it("tanpa DATABASE_URL → status 'tanpa_database' (bukan error)", async () => {
    // Tidak ada `.env` di lingkungan test, jadi kasus ini deterministik.
    expect(process.env.DATABASE_URL).toBeUndefined();

    const res = await app.inject({ method: "GET", url: `${PREFIX_API}/health` });
    const { data } = res.json() as { data: { status: string; database: string; migrasi: unknown } };

    expect(data.status).toBe("tanpa_database");
    expect(data.database).toBe("belum_dikonfigurasi");
    expect(data.migrasi).toBeNull(); // tanpa DB tidak ada info migrasi
  });

  it("tetap memuat header keamanan helmet", async () => {
    const res = await app.inject({ method: "GET", url: `${PREFIX_API}/health` });
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBeDefined();
    expect(res.headers["content-security-policy"]).toBeDefined();
  });
});

describe("kontrak error §5.0", () => {
  it("rute tak dikenal → 404 dengan { ok:false, error:{ code:'NOT_FOUND' } }", async () => {
    const res = await app.inject({ method: "GET", url: `${PREFIX_API}/tidak-ada` });
    expect(res.statusCode).toBe(404);

    const body = res.json() as {
      ok: boolean;
      error: { code: string; message: string };
      data?: unknown;
    };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("NOT_FOUND");
    expect(body.error.message).toContain("/api/v1/tidak-ada");
    expect(body.data).toBeUndefined();
  });

  it("di luar prefix API pun tetap JSON, bukan halaman 404 HTML", async () => {
    const res = await app.inject({ method: "GET", url: "/halaman-tidak-ada" });
    expect(res.statusCode).toBe(404);
    expect(res.headers["content-type"]).toContain("application/json");
    expect((res.json() as { ok: boolean }).ok).toBe(false);
  });

  it("metode yang tidak didukung tetap membalas kontrak error", async () => {
    const res = await app.inject({ method: "POST", url: `${PREFIX_API}/health` });
    expect(res.statusCode).toBe(404);
    const body = res.json() as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("pemetaan kode → status HTTP konsisten dengan §5.0", () => {
    expect(statusDariKode("UNAUTHORIZED")).toBe(401);
    expect(statusDariKode("FORBIDDEN_SCOPE")).toBe(403);
    expect(statusDariKode("VALIDATION")).toBe(400);
    expect(statusDariKode("NOT_FOUND")).toBe(404);
    expect(statusDariKode("CONFLICT")).toBe(409);
    expect(statusDariKode("RATE_LIMITED")).toBe(429);
    expect(statusDariKode("TOKEN_INVALID")).toBe(400);
    expect(statusDariKode("TOKEN_EXPIRED")).toBe(410);
    expect(statusDariKode("ACCOUNT_LOCKED")).toBe(423);
  });
});

describe("rate limit (§14.1)", () => {
  it("rute auth = 10 permintaan/menit/IP dan global = 300/menit", () => {
    expect(batasAuth.rateLimit.max).toBe(10);
    expect(batasAuth.rateLimit.timeWindow).toBe("1 minute");
    expect(BATAS_UMUM.max).toBe(300);
    // konfigurasi sistem mendukung angka tersebut
    expect(config.authRateLimitPerMenit).toBe(10);
  });
});
