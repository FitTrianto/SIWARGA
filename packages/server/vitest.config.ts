import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.spec.ts"],
    // Uji argon2id (19 MiB) + startup Fastify butuh waktu lebih dari default
    testTimeout: 30_000,
    hookTimeout: 180_000,
    // Satu proses agar test integrasi DB embedded tidak berebut RAM
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    reporters: ["default"],
    sequence: { concurrent: false },
  },
});
