#!/usr/bin/env node
/**
 * SIWARGA — pengaktif stack pengembangan (TANPA berkas `.env`).
 *
 * Menyalakan seluruh tumpukan lokal dalam satu perintah:
 *   1. PostgreSQL tertanam (`embedded-postgres`) di `packages/server/.data-dev`
 *      — data persisten, aman dijalankan berulang.
 *   2. `prisma migrate deploy` (jalur produksi) + peran aplikasi NOSUPERUSER
 *      `siwarga_app` (agar RLS benar-benar menegak) + `tsx prisma/seed.ts`.
 *   3. Backend Fastify di `http://127.0.0.1:3000` dengan env inline.
 *
 * Pemakaian (dari monorepo root):
 *   pnpm dev:stack              → nyalakan DB + API
 *   pnpm dev:stack -- --reset    → hapus data dev lama, lalu nyalakan dari nol
 *   pnpm dev:stack -- --db-only  → hanya DB (API dijalankan sendiri di terminal lain)
 *   pnpm dev                    → frontend Vite :5173 (proxy /api → :3000)
 *
 * Catatan Windows: sesi admin MENOLAK menjalankan binary PostgreSQL
 * ("Execution of PostgreSQL by a user with administrative permissions is not
 * permitted"), sehingga proses DB dijalankan lewat `runas /trustlevel:0x20000`
 * (token terbatas) — skrip ini memanggil dirinya sendiri dengan mode `--broker`
 * dan berkomunikasi lewat berkas status/berhenti.
 *
 * Berhenti: tekan Ctrl+C (API & cluster ikut dimatikan; data tetap tersimpan).
 */
import { spawn, execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";

const { Client } = pg;

// ---------------------------------------------------------------------------
// Mode broker (dipanggil ulang oleh diri sendiri lewat runas, token terbatas)
// ---------------------------------------------------------------------------
const argumen = process.argv.slice(2);

if (argumen[0] === "--broker") {
  const [, dirDb, port, berkasStatus, berkasBerhenti, dbName, sandi] = argumen;
  const tulis = (t) => {
    try {
      appendFileSync(berkasStatus, `${t}\n`);
    } catch {
      /* berkas dibuang penguji — abaikan */
    }
  };
  writeFileSync(berkasStatus, `MULAI pid=${process.pid}\n`);

  const pgTertanam = new EmbeddedPostgres({
    databaseDir: dirDb,
    user: "postgres",
    password: sandi,
    port: Number(port),
    persistent: true, // data dev bertahan antar sesi
    initdbFlags: ["--locale=C"],
    postgresFlags: [
      "-c", "shared_buffers=64MB",
      "-c", "effective_cache_size=128MB",
      "-c", "work_mem=2MB",
      "-c", "max_connections=50",
    ],
    onLog: () => undefined,
    onError: (m) => tulis(`[pg] ${String(m).trim().split("\n").slice(0, 3).join(" | ")}`),
  });

  try {
    if (!existsSync(join(dirDb, "PG_VERSION"))) await pgTertanam.initialise();
    await pgTertanam.start();
    await buatDatabaseBilaBelum(pgTertanam, dbName, port, "postgres", sandi);
    tulis(`READY pid=${process.pid}`);
  } catch (err) {
    tulis(`GAGAL ${String(err?.stack ?? err).split("\n").slice(0, 8).join(" | ")}`);
    process.exit(1);
  }

  for (;;) {
    await new Promise((r) => setTimeout(r, 300));
    if (existsSync(berkasBerhenti)) break;
  }

  tulis("MENGHENTIKAN");
  try {
    await pgTertanam.stop(); // persistent:true → data TIDAK ikut terhapus
    tulis("STOPPED");
    process.exit(0);
  } catch (err) {
    tulis(`GAGAL-STOP ${err?.message ?? String(err)}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Mode utama
// ---------------------------------------------------------------------------

const DIR_SERVER = fileURLToPath(new URL("../", import.meta.url));
const PRISMA = join(DIR_SERVER, "node_modules", "prisma", "build", "index.js");
const TSX = join(DIR_SERVER, "node_modules", "tsx", "dist", "cli.mjs");
const SKRIP_INI = fileURLToPath(import.meta.url);

/** Lokasi data cluster dev — persisten, bisa dihapus dengan `--reset`. */
const DIR_DATA = join(DIR_SERVER, ".data-dev");
const DB_NAME = "siwarga_dev";
const PERAN_APP = "siwarga_app";
const SANDI = "siwarga";
const PORT_PG = Number(process.env.DEV_PG_PORT ?? 55432);
const PORT_API = Number(process.env.PORT ?? 3000);

/** Kunci dev tetap (bukan acak) supaya data ter-encrypt tetap terbaca antar restart. */
const KUNCI_SESI = "EYtobB70g8xjLV4h3zZLkfGf0VCnZctBpDYb8TDNVbo=";
const KUNCI_NIK = "y+IGjpYzJ/UlpojGmwi1gypJE5rqVaKjr8j1wgOXIfY=";

const URL_ADMIN = `postgresql://postgres:${SANDI}@127.0.0.1:${PORT_PG}/${DB_NAME}`;
const URL_APP = `postgresql://${PERAN_APP}:${SANDI}@127.0.0.1:${PORT_PG}/${DB_NAME}`;

const berkasStatus = join(tmpdir(), "siwarga-dev-pg-status.txt");
const berkasBerhenti = join(tmpdir(), "siwarga-dev-pg-stop.txt");

const reset = argumen.includes("--reset");
const dbSaja = argumen.includes("--db-only");

const catat = (...args) => console.log("[dev-stack]", ...args);
const langkah = (n, total, pesan) => console.log(`\n[dev-stack] (${n}/${total}) ${pesan}`);

function sesiElevated() {
  if (process.platform !== "win32") return false;
  try {
    return /High Mandatory Level/.test(execFileSync("whoami", ["/groups"], { encoding: "utf8" }));
  } catch {
    return false;
  }
}

function portDipakai(port) {
  return new Promise((selesai) => {
    const s = createServer();
    s.once("error", () => selesai(true));
    s.listen(port, "127.0.0.1", () => s.close(() => selesai(false)));
  });
}

async function tungguStatus(berkas, pola, batasMs) {
  const akhir = Date.now() + batasMs;
  for (;;) {
    let isi = "";
    try {
      isi = readFileSync(berkas, "utf8");
    } catch {
      isi = "";
    }
    if (pola.test(isi)) return isi;
    if (Date.now() >= akhir) return isi || "(berkas status tidak pernah terbentuk)";
    await new Promise((r) => setTimeout(r, 300));
  }
}

/** Jalankan skrip Node dengan env persis seperti jalur produksi. */
function jalankanSkrip(skrip, argumenSkrip, env) {
  return new Promise((selesai, gagal) => {
    const anak = spawn(process.execPath, [skrip, ...argumenSkrip], {
      cwd: DIR_SERVER,
      shell: false,
      stdio: ["ignore", "inherit", "inherit"],
      env: { ...process.env, ...env },
    });
    anak.on("error", gagal);
    anak.on("exit", (kode) =>
      kode === 0 ? selesai() : gagal(new Error(`${skrip} ${argumenSkrip.join(" ")} → keluar ${kode}`)),
    );
  });
}

async function buatDatabaseBilaBelum(pgTertanam, dbName, port, user, sandi) {
  const klien = new Client({
    connectionString: `postgresql://${user}:${sandi}@127.0.0.1:${port}/postgres`,
  });
  await klien.connect();
  try {
    const r = await klien.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
    if (r.rowCount === 0) await klien.query(`CREATE DATABASE "${dbName}"`);
  } finally {
    await klien.end();
  }
}

/**
 * Peran aplikasi NOSUPERUSER + hak akses. Superuser SELALU melewati RLS, jadi
 * backend wajib memakai peran ini agar isolasi tenant benar-benar diuji.
 */
async function siapkanPeranAplikasi() {
  const klien = new Client({ connectionString: URL_ADMIN });
  await klien.connect();
  try {
    await klien.query(
      `DO $body$
       BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${PERAN_APP}') THEN
           EXECUTE 'CREATE ROLE ${PERAN_APP} WITH LOGIN PASSWORD ''${SANDI}'' NOSUPERUSER';
         END IF;
         -- Audit Fase 3 — sesi UTC untuk SEMUA peran: Prisma 7 + adapter-pg membaca
         -- timestamptz dari teks pg dan mengabaikan offset non-UTC; tanpa ini nilai
         -- yang ditulis server (now()) terbaca +7 jam oleh Prisma di mesin WIB.
         EXECUTE 'ALTER ROLE ${PERAN_APP} SET TimeZone TO ''UTC''';
         EXECUTE 'ALTER ROLE postgres SET TimeZone TO ''UTC''';
       END $body$;`,
    );
    await klien.query(`GRANT CONNECT ON DATABASE "${DB_NAME}" TO ${PERAN_APP}`);
    await klien.query(`GRANT USAGE ON SCHEMA public TO ${PERAN_APP}`);
    await klien.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${PERAN_APP}`,
    );
    await klien.query(`GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO ${PERAN_APP}`);
    await klien.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${PERAN_APP}`,
    );
  } finally {
    await klien.end();
  }
}

function sehat(url, batasMs) {
  const akhir = Date.now() + batasMs;
  return (async () => {
    for (;;) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
        if (res.ok) return true;
      } catch {
        /* belum siap */
      }
      if (Date.now() >= akhir) return false;
      await new Promise((r) => setTimeout(r, 500));
    }
  })();
}

// --- proses ----------------------------------------------------------------

let pgProses = null; // broker (mode elevated)
let pgLangsung = null; // EmbeddedPostgres in-process (mode non-elevated)
let anakApi = null;
let sedangMati = false;

async function matikan(sinyal) {
  if (sedangMati) return;
  sedangMati = true;
  console.log(`\n[dev-stack] mematikan… (${sinyal})`);

  if (anakApi && !anakApi.killed) {
    if (process.platform === "win32") {
      try {
        execFileSync("taskkill", ["/PID", String(anakApi.pid), "/T", "/F"], { stdio: "ignore" });
      } catch {
        /* sudah mati */
      }
    } else {
      anakApi.kill("SIGTERM");
    }
  }

  try {
    if (pgProses) {
      writeFileSync(berkasBerhenti, "1");
      await tungguStatus(berkasStatus, /STOPPED|GAGAL-STOP/, 20_000);
    } else if (pgLangsung) {
      await pgLangsung.stop();
    }
  } catch (err) {
    console.error("[dev-stack] gagal mematikan PostgreSQL:", err?.message ?? err);
  }

  console.log("[dev-stack] berhenti. Jalankan lagi dengan `pnpm dev:stack`.");
  process.exit(0);
}

process.on("SIGINT", () => void matikan("SIGINT"));
process.on("SIGTERM", () => void matikan("SIGTERM"));

async function main() {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║  SIWARGA — stack pengembangan (DB + backend)            ║");
  console.log("╚══════════════════════════════════════════════════════════╝");

  // 1. bersihkan data lama bila diminta
  if (reset) {
    langkah(1, 5, "menghapus data dev lama (--reset)");
    for (const b of [DIR_DATA, berkasStatus, berkasBerhenti]) {
      rmSync(b, { recursive: true, force: true });
    }
  }

  if (await portDipakai(PORT_PG)) {
    throw new Error(
      `Port PostgreSQL ${PORT_PG} sudah dipakai proses lain. ` +
        `Matikan prosesnya atau jalankan ulang dengan DEV_PG_PORT=<port lain>.`,
    );
  }

  // 2. nyalakan cluster
  langkah(2, 5, `menyalakan PostgreSQL (port ${PORT_PG}, data: ${DIR_DATA.replace(DIR_SERVER, "packages/server")})`);
  const elevated = sesiElevated();
  if (elevated) {
    catat("sesi Windows admin terdeteksi → cluster dijalankan dengan token terbatas (runas)");
    writeFileSync(berkasStatus, "");
    rmSync(berkasBerhenti, { force: true });
    const perintah =
      `node "${SKRIP_INI}" --broker "${DIR_DATA}" ${PORT_PG} "${berkasStatus}" ` +
      `"${berkasBerhenti}" ${DB_NAME} ${SANDI}`;
    pgProses = spawn("runas", ["/trustlevel:0x20000", perintah], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let pesanRunas = "";
    pgProses.stdout?.on("data", (d) => (pesanRunas += d.toString()));
    pgProses.stderr?.on("data", (d) => (pesanRunas += d.toString()));
    const isi = await tungguStatus(berkasStatus, /READY |GAGAL /, 60_000);
    if (!/READY /.test(isi)) {
      throw new Error(
        `PostgreSQL (token terbatas) tidak siap dalam 60 detik.\n` +
          `--- keluaran runas ---\n${pesanRunas}\n--- berkas status ---\n${isi}`,
      );
    }
  } else {
    pgLangsung = new EmbeddedPostgres({
      databaseDir: DIR_DATA,
      user: "postgres",
      password: SANDI,
      port: PORT_PG,
      persistent: true,
      initdbFlags: ["--locale=C"],
      postgresFlags: [
        "-c", "shared_buffers=64MB",
        "-c", "effective_cache_size=128MB",
        "-c", "work_mem=2MB",
        "-c", "max_connections=50",
      ],
      onLog: () => undefined,
      onError: () => undefined,
    });
    if (!existsSync(join(DIR_DATA, "PG_VERSION"))) await pgLangsung.initialise();
    await pgLangsung.start();
    await buatDatabaseBilaBelum(pgLangsung, DB_NAME, PORT_PG, "postgres", SANDI);
  }
  catat("PostgreSQL siap.");

  const envAlat = {
    NODE_ENV: "development",
    DATABASE_URL: URL_ADMIN, // superuser: jalur yang sama dengan `prisma migrate deploy`
    NIK_ENCRYPTION_KEY: KUNCI_NIK,
    SESSION_SECRET: KUNCI_SESI,
  };

  // 3. migrasi (jalur produksi, mencatat checksum ke _prisma_migrations)
  langkah(3, 5, "prisma migrate deploy");
  await jalankanSkrip(PRISMA, ["migrate", "deploy"], envAlat);

  // 4. peran aplikasi NOSUPERUSER + seed
  langkah(4, 5, `membuat peran aplikasi '${PERAN_APP}' (NOSUPERUSER → RLS menegak) + seed`);
  await siapkanPeranAplikasi();
  await jalankanSkrip(TSX, ["prisma/seed.ts"], envAlat);
  catat("migrasi & seed selesai.");

  if (dbSaja) {
    console.log(`
╔══════════════════════════════════════════════════════════╗
║  DB siap — jalankan backend di terminal lain:            ║
║                                                          ║
║  set NODE_ENV=development                                ║
║  set DATABASE_URL=${URL_APP.padEnd(46)}║
║  set SESSION_SECRET=${KUNCI_SESI.padEnd(43)}║
║  set NIK_ENCRYPTION_KEY=${KUNCI_NIK.padEnd(38)}║
║  pnpm dev:server                                         ║
║                                                          ║
║  Ctrl+C pada proses ini akan mematikan cluster.          ║
╚══════════════════════════════════════════════════════════╝`);
    return; // tetap hidup sampai SIGINT
  }

  // 5. backend
  langkah(5, 5, `menyalakan backend Fastify di http://127.0.0.1:${PORT_API}`);
  anakApi = spawn(process.execPath, [TSX, "src/server.ts"], {
    cwd: DIR_SERVER,
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_ENV: "development",
      HOST: "127.0.0.1",
      PORT: String(PORT_API),
      DATABASE_URL: URL_APP, // peran NOSUPERUSER → RLS benar-benar menegak
      SESSION_SECRET: KUNCI_SESI,
      NIK_ENCRYPTION_KEY: KUNCI_NIK,
      AUTH_RATE_LIMIT_PER_MENIT: "60", // nyaman untuk pengujian manual
      PERIODE_AKTIF: "2026-10",
    },
  });
  anakApi.on("exit", (kode) => {
    if (!sedangMati) {
      console.error(`[dev-stack] backend keluar dengan kode ${kode}`);
      void matikan("api-mati");
    }
  });

  const ok = await sehat(`http://127.0.0.1:${PORT_API}/api/v1/health`, 30_000);
  if (!ok) throw new Error("Backend tidak menjawab /api/v1/health dalam 30 detik.");

  console.log(`
╔══════════════════════════════════════════════════════════╗
║  STACK SIWARGA SIAP                                      ║
║                                                          ║
║  Backend API : http://127.0.0.1:${String(PORT_API).padEnd(25)}║
║  Data        : packages/server/.data-dev (persisten)     ║
║                                                          ║
║  Jalankan frontend di terminal lain:  pnpm dev           ║
║  → http://localhost:5173                                 ║
║                                                          ║
║  Akun demo:                                              ║
║  • Warga 081234567890  / WargaDev2026                    ║
║  • RT    rt04@siwarga.id / rahasia123                    ║
║  • RW    rw012@siwarga.id / rahasia123                   ║
║  • Admin admin@siwarga.id / adminrahasia                 ║
║                                                          ║
║  Berhenti: Ctrl+C (data tetap tersimpan)                 ║
╚══════════════════════════════════════════════════════════╝`);
}

main().catch(async (err) => {
  console.error("\n[dev-stack] GAGAL:", err?.message ?? err);
  await matikan("gagal");
  process.exit(1);
});
