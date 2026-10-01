/**
 * Broker PostgreSQL untuk sesi Windows yang ELEVATED.
 *
 * PostgreSQL menolak dijalankan oleh user admin:
 *   "Execution of PostgreSQL by a user with administrative permissions is not
 *    permitted. The server must be started under an unprivileged user ID..."
 *
 * Karena itu tes `rls-db.spec.ts` memanggil skrip ini lewat
 * `runas /trustlevel:0x20000` (token terbatas, tanpa hak admin), lalu berkomunikasi
 * lewat dua berkas: berkas status (broker → tes) dan berkas perintah berhenti
 * (tes → broker). Keluaran `runas` sendiri tidak bisa diandalkan untuk dialirkan,
 * sehingga semua umpan balik ditulis ke berkas status.
 *
 * Pemakaian:
 *   node pg-broker.mjs <dirDb> <port> <berkasStatus> <berkasBerhenti> <dbName> <password>
 */
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import EmbeddedPostgres from "embedded-postgres";

const [dirDb, port, berkasStatus, berkasBerhenti, dbName, password] = process.argv.slice(2);

if (!dirDb || !port || !berkasStatus || !berkasBerhenti || !dbName) {
  console.error("argumen tidak lengkap");
  process.exit(2);
}

const tulis = (t) => {
  try {
    appendFileSync(berkasStatus, `${t}\n`);
  } catch {
    /* berkas/ folder sudah dihapus oleh penguji — abaikan */
  }
};

writeFileSync(berkasStatus, `MULAI pid=${process.pid}\n`);

const pg = new EmbeddedPostgres({
  databaseDir: dirDb,
  user: "postgres",
  password,
  port: Number(port),
  persistent: false,
  initdbFlags: ["--locale=C"],
  // Sama dengan konfigurasi di rls-db.spec.ts — RAM mesin uji terbatas.
  postgresFlags: [
    "-c", "shared_buffers=32MB",
    "-c", "effective_cache_size=64MB",
    "-c", "work_mem=1MB",
    "-c", "max_connections=50",
  ],
  onLog: () => undefined,
  onError: (m) => tulis(`[pg] ${String(m).trim().split("\n").slice(0, 3).join(" | ")}`),
});

try {
  if (!existsSync(join(dirDb, "PG_VERSION"))) await pg.initialise();
  await pg.start();
  await pg.createDatabase(dbName);
  tulis(`READY pid=${process.pid}`);
} catch (err) {
  tulis(`GAGAL ${String(err?.stack ?? err).split("\n").slice(0, 8).join(" | ")}`);
  process.exit(1);
}

// Siaga sampai tes meminta berhenti.
for (;;) {
  await new Promise((r) => setTimeout(r, 200));
  if (existsSync(berkasBerhenti)) break;
}

tulis("MENGHENTIKAN");
try {
  await pg.stop(); // persistent:false → folder data ikut terhapus
  tulis("STOPPED");
  process.exit(0);
} catch (err) {
  tulis(`GAGAL-STOP ${err?.message ?? String(err)}`);
  process.exit(1);
}
