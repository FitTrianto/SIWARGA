/**
 * Pemetaan galat internal → kontrak respons API §5.0:
 *   `{ ok: false, error: { code, message } }`
 *
 * Pesan yang dikirim ke klien sengaja umum (tidak membocorkan detail SQL/stack);
 * detail lengkap tetap masuk log server.
 */
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import { Prisma } from "../generated/prisma/client.js";
import { AlokasiError } from "../services/alokasiFIFO.js";
import { KasError } from "../services/kasLedger.js";
import { KriptoError } from "../services/crypto.js";
import { KredensialError } from "../services/kredensial.js";
import { GalatTolak } from "./guard.js";
import type { KodeApi } from "../types.js";

interface Dipetakan {
  kode: KodeApi;
  status: number;
  message: string;
  detail?: unknown;
}

const STATUS: Record<KodeApi, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN_SCOPE: 403,
  VALIDATION: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  TOKEN_INVALID: 400,
  TOKEN_EXPIRED: 410,
  ACCOUNT_LOCKED: 423,
  INTERNAL: 500,
};

export function statusDariKode(kode: KodeApi): number {
  return STATUS[kode];
}

function pesanZod(err: ZodError): string {
  const pertama = err.issues[0];
  if (!pertama) return "Data tidak valid.";
  const path = pertama.path.join(".");
  return path ? `${path}: ${pertama.message}` : pertama.message;
}

export function petakanGalat(err: unknown): Dipetakan {
  if (err instanceof ZodError) {
    return {
      kode: "VALIDATION",
      status: 400,
      message: pesanZod(err),
      detail: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    };
  }

  // Guard peran (§5.0) — kode & status sudah sesuai peta di bawah
  if (err instanceof GalatTolak) {
    return { kode: err.kode, status: statusDariKode(err.kode), message: err.message };
  }

  if (err instanceof KriptoError || err instanceof KredensialError || err instanceof AlokasiError) {
    return { kode: "VALIDATION", status: 400, message: err.message };
  }
  if (err instanceof KasError) {
    // APPEND_ONLY & koreksi ganda = konflik integritas, bukan kesalahan input
    const konflik = err.kode === "APPEND_ONLY" || err.kode === "KOREKSI_TIDAK_SAH";
    return { kode: konflik ? "CONFLICT" : "VALIDATION", status: konflik ? 409 : 400, message: err.message };
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    switch (err.code) {
      case "P2002":
        return { kode: "CONFLICT", status: 409, message: "Data bentrok — nilai unik sudah dipakai." };
      case "P2025":
        return { kode: "NOT_FOUND", status: 404, message: "Data tidak ditemukan." };
      case "P2003":
        return { kode: "VALIDATION", status: 400, message: "Relasi data tidak valid." };
      case "P2023":
        return { kode: "VALIDATION", status: 400, message: "Format data tidak valid." };
      default:
        break;
    }
  }

  const fastifyErr = err as FastifyError & { statusCode?: number; rateLimit?: unknown };

  if (fastifyErr?.statusCode === 429 || fastifyErr?.rateLimit) {
    return {
      kode: "RATE_LIMITED",
      status: 429,
      message: "Terlalu banyak permintaan — coba lagi sebentar lagi.",
    };
  }

  if (typeof fastifyErr?.statusCode === "number" && fastifyErr.statusCode < 500) {
    const kode: KodeApi = fastifyErr.statusCode === 401
      ? "UNAUTHORIZED"
      : fastifyErr.statusCode === 403
        ? "FORBIDDEN_SCOPE"
        : fastifyErr.statusCode === 404
          ? "NOT_FOUND"
          : "VALIDATION";
    return { kode, status: fastifyErr.statusCode, message: fastifyErr.message || "Permintaan tidak valid." };
  }

  return {
    kode: "INTERNAL",
    status: 500,
    message: "Terjadi gangguan di server. Silakan coba lagi.",
  };
}

export function pasangErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err, req: FastifyRequest, reply: FastifyReply) => {
    const dipetakan = petakanGalat(err);

    const konteks = {
      kode: dipetakan.kode,
      status: dipetakan.status,
      method: req.method,
      url: req.url,
      requestId: req.id,
    };

    if (dipetakan.status >= 500) {
      req.log.error({ ...konteks, err }, "galat server");
    } else {
      req.log.info(konteks, "galat ditangani");
    }

    // stack trace hanya di log, tidak pernah dikirim ke klien
    void reply.status(dipetakan.status).send({
      ok: false,
      error: {
        code: dipetakan.kode,
        message: dipetakan.message,
        ...(dipetakan.detail ? { detail: dipetakan.detail } : {}),
      },
    });
  });

  app.setNotFoundHandler((req, reply) => {
    void reply.status(404).send({
      ok: false,
      error: { code: "NOT_FOUND", message: `Rute ${req.method} ${req.url} tidak ditemukan.` },
    });
  });
}
