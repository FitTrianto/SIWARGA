/**
 * B16/B17/B18 — Integrasi dengan PostgreSQL sungguhan (embedded-postgres).
 *
 * Tiga hal yang MUSTAHIL diuji tanpa database nyata:
 *   1. Row-Level Security + FORCE — koneksi tanpa scope melihat NOL baris
 *      (gagal-aman), dan RT04 tidak pernah melihat baris RT05 (isolasi tenant).
 *   2. Trigger append-only (buku kas, audit, mutasi saldo, alokasi).
 *   3. CHECK constraint buatan tangan + view agregat Portal RW.
 *
 * Migrasi & seed dijalankan lewat jalur yang SAMA dengan produksi
 * (`prisma migrate deploy` + `tsx prisma/seed.ts`), memakai URL admin
 * (superuser). Seluruh pembacaan/penulisan tes sendiri berjalan dengan peran
 * `siwarga_uji` (NOSUPERUSER) — karena superuser SELALU melewati RLS, tanpa
 * peran ini isolasi tenant tidak akan pernah benar-benar teruji. Semua baris uji
 * dibuat di dalam transaksi yang di-ROLLBACK sehingga data seed tidak tercemar.
 */
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { dekripsiNik } from "../src/services/crypto.js";

/**
 * Port & URL diisi di `beforeAll` memakai port bebas — cluster sementara tidak
 * boleh berebut port dengan sisa proses dari putaran tes sebelumnya.
 */
let PORT = 0;
const DB_NAME = "siwarga_rls_test";
/** Kunci 32 byte (base64) — sengaja diketahui tes ini agar NIK bisa dibuktikan ter-encrypt. */
const KUNCI_NIK = "y+IGjpYzJ/UlpojGmwi1gypJE5rqVaKjr8j1wgOXIfY=";
const KUNCI_SESI = "EYtobB70g8xjLV4h3zZLkfGf0VCnZctBpDYb8TDNVbo=";
/** Kata sandi cluster sementara; sama untuk peran admin & peran uji. */
const KATA_SANDI = "siwarga";
/** Peran NOSUPERUSER tempat seluruh tes berinteraksi dengan database. */
const PERAN_TES = "siwarga_uji";
/** Kata sandi Portal Warga hasil seed — login warga kini pakai kata sandi (bukan PIN). */
const SANDI_WARGA_UJI = "WargaDev2026";

const DIR_SERVER = fileURLToPath(new URL("..", import.meta.url));
const PRISMA = join(DIR_SERVER, "node_modules", "prisma", "build", "index.js");
const TSX = join(DIR_SERVER, "node_modules", "tsx", "dist", "cli.mjs");

/**
 * Dua peran, dua URL:
 *  - `URL_ADMIN` (`postgres`, superuser) → migrasi & seed. Superuser SELALU
 *    melewati RLS, jadi ini jalur yang sama dengan `prisma migrate deploy`
 *    di produksi.
 *  - `URL_TES` (`siwarga_uji`, NOSUPERUSER) → seluruh pembacaan/penulisan tes.
 *    Tanpa peran ini RLS tidak pernah teruji — inilah yang membuktikan
 *    isolasi tenant benar-benar dipegang oleh database, bukan oleh niat baik aplikasi.
 */
let URL_ADMIN = "";
let URL_TES = "";

/** Isi `PORT` (port bebas) + kedua URL — dipanggil paling awal di `beforeAll`. */
function siapkanPort(port: number): void {
  PORT = port;
  URL_ADMIN = `postgresql://postgres:${KATA_SANDI}@127.0.0.1:${PORT}/${DB_NAME}`;
  URL_TES = `postgresql://${PERAN_TES}:${KATA_SANDI}@127.0.0.1:${PORT}/${DB_NAME}`;
}

/** 6 tabel kunci otorisasi yang sengaja TIDAK di-RLS (lihat header migrasi 0002). */
const TANPA_RLS = [
  "kredensial_warga",
  "sesi_login",
  "percobaan_otp",
  "pengguna_pengurus",
  "konten_landing",
  "notifikasi_job",
].sort();

// "auth" = GUC jalur lookup login (migrasi 0003) — HANYA untuk membaca `warga`
// sebelum identitas RT diketahui; tidak pernah jadi level `pemohon` (§4.6).
type Scope = { level: "rt" | "rw" | "platform" | "auth"; id: string | null };
const PLATFORM: Scope = { level: "platform", id: null };

// ---------------------------------------------------------------------------
// Utilitas
// ---------------------------------------------------------------------------

/** Menjalankan skrip Node dengan env yang sama seperti produksi. */
function jalankanSkrip(skrip: string, argumen: string[] = []): Promise<void> {
  return new Promise((selesai, gagal) => {
    const anak = spawn(process.execPath, [skrip, ...argumen], {
      cwd: DIR_SERVER,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        NODE_ENV: "test",
        DATABASE_URL: URL_ADMIN,
        NIK_ENCRYPTION_KEY: KUNCI_NIK,
        SESSION_SECRET: KUNCI_SESI,
      },
    });
    let keluaran = "";
    anak.stdout?.on("data", (d: Buffer) => (keluaran += d.toString()));
    anak.stderr?.on("data", (d: Buffer) => (keluaran += d.toString()));
    anak.on("error", gagal);
    anak.on("exit", (kode) => {
      if (kode === 0) selesai();
      else gagal(new Error(`${skrip} ${argumen.join(" ")} → keluar ${kode}\n${keluaran}`));
    });
  });
}

async function bukaKlien(): Promise<Client> {
  const klien = new Client({ connectionString: URL_TES });
  await klien.connect();
  return klien;
}

async function pasangScope(klien: Client, scope: Scope | null): Promise<void> {
  if (!scope) return;
  await klien.query("SELECT set_config('app.scope_level', $1, true)", [scope.level]);
  await klien.query("SELECT set_config('app.scope_id', $1, true)", [scope.id ?? ""]);
}

/**
 * Menjalankan SQL di dalam satu transaksi ber-scope, persis seperti kontrak
 * §4.6 (`SET LOCAL app.scope_level` + `app.scope_id`). Bila terjadi galat,
 * transaksi di-ROLLBACK lalu galatnya dilempar kembali.
 */
async function denganScope<T>(scope: Scope | null, jalan: (c: Client) => Promise<T>): Promise<T> {
  const klien = await bukaKlien();
  try {
    await klien.query("BEGIN");
    await pasangScope(klien, scope);
    const hasil = await jalan(klien);
    await klien.query("COMMIT");
    return hasil;
  } catch (err) {
    await klien.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    await klien.end();
  }
}

/** Versi `denganScope` yang SELALU di-ROLLBACK — untuk baris uji yang tidak boleh tersimpan. */
async function dalamRollback<T>(scope: Scope | null, jalan: (c: Client) => Promise<T>): Promise<T> {
  const klien = await bukaKlien();
  try {
    await klien.query("BEGIN");
    await pasangScope(klien, scope);
    return await jalan(klien);
  } finally {
    await klien.query("ROLLBACK").catch(() => undefined);
    await klien.end();
  }
}

/** Menghitung baris yang terlihat pada scope tertentu. */
async function hitung(scope: Scope | null, sql: string, params: unknown[] = []): Promise<number> {
  const r = await denganScope(scope, (c) => c.query(sql, params));
  return Number((r.rows[0] as { n: number }).n);
}

/** Menangkap galat pg untuk diperiksa (SQLSTATE + pesan). */
async function tangkapGalat(p: Promise<unknown>): Promise<{ code: string; message: string }> {
  try {
    await p;
    throw new Error("Perintah seharusnya gagal, tetapi berhasil.");
  } catch (err) {
    const e = err as { code?: string; message?: string };
    if (typeof e.code !== "string") throw err; // galat buatan tes sendiri → lempar
    return { code: e.code, message: e.message ?? "" };
  }
}

/** Baris uji `mutasi_saldo_warga` — satu-satunya tabel append-only yang tak diisi seed. */
const SQL_BARIS_MUTASI = `
  INSERT INTO mutasi_saldo_warga (id, warga_id, rt_id, tipe, nominal, ref_type, ref_id, saldo_sesudah)
  SELECT gen_random_uuid(), w.id, w.rt_id, 'masuk', 1000.00, 'tagihan', t.id, 1000.00
    FROM warga w
    JOIN tagihan t ON t.rt_id = w.rt_id
   LIMIT 1`;

// ---------------------------------------------------------------------------
// Siklus hidup: cluster → migrasi → seed → kumpul id tenant
// ---------------------------------------------------------------------------

let server: EmbeddedPostgres | null = null;
let dirSementara = "";
let berkasStatus = "";
let berkasBerhenti = "";

let idRt04 = "";
let idRt05 = "";
let idRw = "";
let idKkRt04 = "";
let warga04 = 0;
let warga05 = 0;

beforeAll(async () => {
  dirSementara = await mkdtemp(join(tmpdir(), "siwarga-pg-"));
  berkasStatus = join(dirSementara, "pg-status.txt");
  berkasBerhenti = join(dirSementara, "pg-stop.txt");
  // Port bebas: putaran sebelumnya yang gagal berhenti tidak boleh memblokir
  // putaran berikutnya (PostgreSQL tidak bisa mengikat port yang masih terpakai).
  siapkanPort(await portBebas());

  const dirDb = join(dirSementara, "db");
  const lokal = buatServer(dirDb);

  // PostgreSQL menolak dijalankan oleh sesi Windows yang elevated
  // ("Execution of PostgreSQL by a user with administrative permissions is not
  // permitted"). Kalau sesi kita elevated, cluster diserahkan ke broker yang
  // dijalankan lewat `runas /trustlevel:0x20000` (token terbatas, tanpa admin).
  if (sesiElevated()) {
    await tahap("menyalakan PostgreSQL lewat token terbatas", () => mulaiBroker(dirDb));
  } else {
    try {
      await lokal.initialise();
      await lokal.start();
      await lokal.createDatabase(DB_NAME);
      server = lokal;
    } catch (err) {
      const galat = err instanceof Error ? err.message : String(err);
      if (process.platform !== "win32") throw new Error(`Gagal menyalankan PostgreSQL: ${galat}`);
      await tahap(
        `menyalakan PostgreSQL lewat token terbatas (cara langsung gagal: ${galat})`,
        () => mulaiBroker(join(dirSementara, "db-broker")),
      );
    }
  }

  // 1. Migrasi persis seperti produksi (mencatat checksum ke _prisma_migrations)
  await tahap("`prisma migrate deploy`", () => jalankanSkrip(PRISMA, ["migrate", "deploy"]));
  // 2. Peran uji NOSUPERUSER — inilah yang membuat RLS benar-benar menegak.
  //    Superuser (peran admin) selalu melewati RLS, walau tabelnya FORCE.
  await tahap("membuat peran uji non-superuser", buatPeranUji);
  // 3. Seed memakai peran admin (jalur yang sama dengan produksi); isinya lalu
  //    dibaca ulang lewat peran uji untuk membuktikan isolasi tenant.
  await tahap("`tsx prisma/seed.ts`", () => jalankanSkrip(TSX, ["prisma/seed.ts"]));

  // 3. Kumpulkan id tenant
  const rt = await dalamScopePlat(c => c.query("SELECT id, kode_rt FROM rt ORDER BY kode_rt"));
  const barisRt = rt.rows as Array<{ id: string; kode_rt: string }>;
  idRt04 = barisRt.find((r) => r.kode_rt === "004")?.id ?? "";
  idRt05 = barisRt.find((r) => r.kode_rt === "005")?.id ?? "";
  expect(idRt04, "RT 004 harus dibuat seed").not.toBe("");
  expect(idRt05, "RT 005 (uji isolasi tenant) harus dibuat seed").not.toBe("");

  const rw = await dalamScopePlat(c => c.query("SELECT id FROM rw LIMIT 1"));
  idRw = (rw.rows[0] as { id: string }).id;

  const kk = await denganScope({ level: "rt", id: idRt04 }, (c) =>
    c.query("SELECT id FROM kartu_keluarga WHERE rt_id = $1 ORDER BY created_at LIMIT 1", [idRt04]),
  );
  idKkRt04 = (kk.rows[0] as { id: string }).id;

  warga04 = await hitung({ level: "rt", id: idRt04 }, "SELECT count(*)::int AS n FROM warga");
  warga05 = await hitung({ level: "rt", id: idRt05 }, "SELECT count(*)::int AS n FROM warga");
}, 300_000);

/** Pemendek: kueri ber-scope platform (dipakai di dalam beforeAll & tes baca). */
function dalamScopePlat<T>(jalan: (c: Client) => Promise<T>): Promise<T> {
  return denganScope(PLATFORM, jalan);
}

// ---------------------------------------------------------------------------
// Utilitas siklus hidup (termasuk jalur token terbatas untuk Windows elevated)
// ---------------------------------------------------------------------------

/** Menamai setiap tahap agar kegagalan beforeAll selalu menyebut langkahnya. */
async function tahap<T>(nama: string, jalan: () => Promise<T>): Promise<T> {
  try {
    return await jalan();
  } catch (err) {
    const pesan = err instanceof Error ? err.message : String(err);
    const baru = new Error(`Gagal pada tahap "${nama}": ${pesan}`);
    (baru as Error & { cause?: unknown }).cause = err;
    throw baru;
  }
}

function buatServer(dirDb: string): EmbeddedPostgres {
  return new EmbeddedPostgres({
    databaseDir: dirDb,
    user: "postgres",
    password: KATA_SANDI,
    port: PORT,
    persistent: false,
    initdbFlags: ["--locale=C"],
    // Mesin uji ber RAM terbatas — batasi konsumsi memori PostgreSQL.
    postgresFlags: [
      "-c", "shared_buffers=32MB",
      "-c", "effective_cache_size=64MB",
      "-c", "work_mem=1MB",
      "-c", "max_connections=50",
    ],
    onLog: () => undefined,
    onError: () => undefined,
  });
}

/** Apakah proses ini berjalan dengan sesi Windows elevated (token admin)? */
function sesiElevated(): boolean {
  if (process.platform !== "win32") return false;
  try {
    return /High Mandatory Level/.test(execFileSync("whoami", ["/groups"], { encoding: "utf8" }));
  } catch {
    return false;
  }
}

/** Minta port IPv4 loopback yang sedang bebas dari OS. */
function portBebas(): Promise<number> {
  return new Promise((selesai, gagal) => {
    const s = createServer();
    s.once("error", gagal);
    s.listen(0, "127.0.0.1", () => {
      const alamat = s.address();
      const port = typeof alamat === "object" && alamat !== null ? alamat.port : 0;
      s.close(() => selesai(port));
    });
  });
}

/**
 * Siapa saja yang masih mendengarkan `port` tes ini. Dipakai pada penutupan
 * untuk memastikan tidak ada sisa proses PostgreSQL — putaran berikutnya harus
 * selalu mendapati port dalam keadaan bebas.
 */
function pemegangPort(port: number): number[] {
  if (port <= 0 || process.platform !== "win32") return [];
  try {
    const keluaran = execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue)` +
          `.OwningProcess | Where-Object { $_ }`,
      ],
      { encoding: "utf8" },
    );
    return [
      ...new Set(
        keluaran
          .split(/\r?\n/)
          .map((s) => Number(s.trim()))
          .filter((n) => Number.isInteger(n) && n > 0),
      ),
    ];
  } catch {
    return [];
  }
}

/**
 * Membuat peran uji NOSUPERUSER lalu memberinya hak akses pada seluruh tabel.
 * RLS hanya berlaku untuk peran yang bukan superuser; inilah alasan tes tidak
 * boleh berjalan dengan `DATABASE_URL` admin.
 */
async function buatPeranUji(): Promise<void> {
  const klien = new Client({ connectionString: URL_ADMIN });
  await klien.connect();
  try {
    await klien.query(
      `DO $body$
       BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${PERAN_TES}') THEN
           EXECUTE 'CREATE ROLE ${PERAN_TES} WITH LOGIN PASSWORD ''${KATA_SANDI}'' NOSUPERUSER';
         END IF;
         -- Audit Fase 3 — konsistensi zona waktu SEMUA peran: Prisma 7 + adapter-pg
         -- membaca timestamptz dari teks pg dan mengabaikan offset non-UTC (bagian
         -- naive dibaca sebagai UTC), sementara parameter Date ditulis sebagai dinding-UTC
         -- tanpa offset lalu ditafsir sesi sesi. Selisihnya meleset +offset sesi untuk
         -- pembacaan, -offset untuk penulisan — KUNCI: kedua peran harus memakai sesi
         -- yang sama, dan UTC membuat keduanya absolut-benar.
         EXECUTE 'ALTER ROLE ${PERAN_TES} SET TimeZone TO ''UTC''';
         EXECUTE 'ALTER ROLE postgres SET TimeZone TO ''UTC''';
       END $body$;`,
    );
    await klien.query(`GRANT CONNECT ON DATABASE "${DB_NAME}" TO ${PERAN_TES}`);
    await klien.query(`GRANT USAGE ON SCHEMA public TO ${PERAN_TES}`);
    await klien.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${PERAN_TES}`,
    );
    await klien.query(`GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO ${PERAN_TES}`);
  } finally {
    await klien.end();
  }
}

/** Polling berkas sampai memuat pola tertentu — kanal komunikasi ke broker. */
async function tungguStatus(berkas: string, pola: RegExp, batasMs: number): Promise<string> {
  const akhir = Date.now() + batasMs;
  for (;;) {
    let isi = "";
    try {
      isi = readFileSync(berkas, "utf8");
    } catch {
      isi = ""; // berkas belum terbentuk
    }
    if (pola.test(isi)) return isi;
    if (Date.now() >= akhir) return isi || "(berkas status tidak pernah terbentuk)";
    await new Promise((r) => setTimeout(r, 200));
  }
}

/**
 * Menyalakan cluster lewat broker (`tests/pg-broker.mjs`) yang dijalankan dengan
 * token terbatas. Siap/tidaknya dibaca dari berkas status, bukan dari keluaran
 * `runas` yang tidak bisa diandalkan untuk dialirkan.
 */
async function mulaiBroker(dirDb: string): Promise<void> {
  const brokerJs = fileURLToPath(new URL("./pg-broker.mjs", import.meta.url));
  const perintah =
    `node "${brokerJs}" "${dirDb}" ${PORT} "${berkasStatus}" "${berkasBerhenti}" ${DB_NAME} ${KATA_SANDI}`;

  let pesanRunas = "";
  const galatRunas: { err: Error | null } = { err: null };
  const anak = spawn("runas", ["/trustlevel:0x20000", perintah], {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  anak.stdout?.on("data", (d: Buffer) => (pesanRunas += d.toString()));
  anak.stderr?.on("data", (d: Buffer) => (pesanRunas += d.toString()));
  anak.on("error", (err: Error) => {
    galatRunas.err = err;
  });

  const isi = await tungguStatus(berkasStatus, /READY |GAGAL/, 60_000);
  if (galatRunas.err) throw new Error(`runas /trustlevel gagal: ${galatRunas.err.message}`);
  if (!/READY /.test(isi)) {
    throw new Error(
      `PostgreSQL (token terbatas) tidak siap dalam 60 detik.\n` +
        `--- keluaran runas ---\n${pesanRunas}\n--- berkas status ---\n${isi}`,
    );
  }
}

function pidDariStatus(): number {
  if (!berkasStatus || !existsSync(berkasStatus)) return 0;
  try {
    const isi = readFileSync(berkasStatus, "utf8");
    const m = /(?:READY|MULAI) pid=(\d+)/.exec(isi);
    return m ? Number(m[1]) : 0;
  } catch {
    return 0;
  }
}

function paksaMati(pid: number): void {
  if (!(pid > 0)) return;
  try {
    execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
  } catch {
    /* proses sudah mati */
  }
}

/** Tunggu sampai port tes tidak lagi didengarkan siapa pun; hasilnya sisa pemegang. */
async function tungguPortBebas(batasMs: number): Promise<number[]> {
  const akhir = Date.now() + batasMs;
  let sisa = pemegangPort(PORT);
  while (sisa.length > 0 && Date.now() < akhir) {
    await new Promise((r) => setTimeout(r, 500));
    sisa = pemegangPort(PORT);
  }
  return sisa;
}

/**
 * Berhenti lembut; bila macet, paksa proses broker beserta anaknya dimatikan.
 * Apa pun yang terjadi, port tes HARUS dibebaskan — putaran berikutnya harus
 * selalu mendapati port kosong, bukan sisa cluster yang belum mati.
 */
async function bereskanPostgres(): Promise<void> {
  const pid = pidDariStatus();
  if (pid > 0) {
    try {
      writeFileSync(berkasBerhenti, "berhenti");
    } catch {
      /* berkas sudah terhapus — biarkan taskkill yang bekerja */
    }
    const isi = await tungguStatus(berkasStatus, /STOPPED|GAGAL-STOP/, 20_000);
    if (!/STOPPED/.test(isi)) paksaMati(pid);
  } else if (server) {
    await Promise.race([server.stop(), new Promise((r) => setTimeout(r, 20_000))]).catch(() => undefined);
  }
  for (const penunggang of await tungguPortBebas(15_000)) paksaMati(penunggang);
}

afterAll(async () => {
  try {
    await bereskanPostgres();
  } finally {
    // jaring pengaman terakhir kalau hook di atas gagal di tengah jalan
    for (const penunggang of pemegangPort(PORT)) paksaMati(penunggang);
    if (dirSementara) await rm(dirSementara, { recursive: true, force: true }).catch(() => undefined);
  }
}, 120_000);

// ---------------------------------------------------------------------------
// Tes
// ---------------------------------------------------------------------------

describe("migrasi & seed", () => {
  it("seluruh migrasi (semua folder di prisma/migrations) tercatat selesai di _prisma_migrations", async () => {
    const daftarMigrasi = readdirSync(join(DIR_SERVER, "prisma", "migrations"), { withFileTypes: true }).filter(
      (entri) => entri.isDirectory(),
    ).length;
    const r = await dalamScopePlat((c) =>
      c.query(
        "SELECT count(*)::int AS n FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL",
      ),
    );
    expect(Number((r.rows[0] as { n: number }).n)).toBe(daftarMigrasi);
    expect(daftarMigrasi).toBeGreaterThanOrEqual(4);
  });

  it("seed mengisi RT04 (9 warga) + RT05 (warga uji isolasi) beserta kas & audit", async () => {
    expect(warga04).toBe(9);
    expect(warga05).toBeGreaterThanOrEqual(1);
    expect(warga04 + warga05).toBe(await hitung(PLATFORM, "SELECT count(*)::int AS n FROM warga"));
    expect(await hitung(PLATFORM, "SELECT count(*)::int AS n FROM tagihan")).toBeGreaterThan(0);
    expect(await hitung(PLATFORM, "SELECT count(*)::int AS n FROM kas_entry")).toBeGreaterThan(0);
    expect(await hitung(PLATFORM, "SELECT count(*)::int AS n FROM audit_log")).toBeGreaterThan(0);
    expect(await hitung(PLATFORM, "SELECT count(*)::int AS n FROM alokasi_pembayaran")).toBeGreaterThan(0);
  });
});

describe("gagal-aman: tanpa scope = nol baris", () => {
  it("koneksi tanpa GUC scope tidak melihat satu pun baris tenant", async () => {
    for (const tabel of ["warga", "tagihan", "pembayaran", "kas_entry", "audit_log", "kartu_keluarga", "surat"]) {
      expect(await hitung(null, `SELECT count(*)::int AS n FROM ${tabel}`), tabel).toBe(0);
    }
  });

  it("data wilayah pun butuh scope yang sudah teridentifikasi", async () => {
    expect(await hitung(null, "SELECT count(*)::int AS n FROM kecamatan")).toBe(0);
    expect(await hitung(null, "SELECT count(*)::int AS n FROM kelurahan")).toBe(0);
    expect(await hitung(PLATFORM, "SELECT count(*)::int AS n FROM kelurahan")).toBeGreaterThan(0);
  });

  it("kredensial warga sengaja dikecualikan dari RLS (diisolasi lewat cek aplikasi)", async () => {
    expect(await hitung(null, "SELECT count(*)::int AS n FROM kredensial_warga")).toBeGreaterThan(0);
  });
});

describe("Row Level Security aktif + FORCE", () => {
  it("30 dari 36 tabel di-RLS; 6 tabel kunci otorisasi sengaja dikecualikan", async () => {
    const r = await dalamScopePlat((c) =>
      c.query(
        `SELECT c.relname AS tabel, c.relrowsecurity AS rls, c.relforcerowsecurity AS force
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = current_schema()
            AND c.relkind = 'r'
            AND c.relname <> '_prisma_migrations'`,
      ),
    );
    const baris = r.rows as Array<{ tabel: string; rls: boolean; force: boolean }>;
    expect(baris).toHaveLength(36);

    const berRls = baris.filter((b) => b.rls);
    expect(berRls).toHaveLength(30);
    // FORCE wajib: tanpa FORCE, pemilik tabel bisa melewati RLS
    for (const b of berRls) expect(b.force, `${b.tabel} harus FORCE ROW LEVEL SECURITY`).toBe(true);

    expect(baris.filter((b) => !b.rls).map((b) => b.tabel).sort()).toEqual(TANPA_RLS);
  });
});

describe("isolasi tenant RT04 ↔ RT05", () => {
  const scope04: Scope = { level: "rt", id: "" };
  const scope05: Scope = { level: "rt", id: "" };

  beforeAll(() => {
    scope04.id = idRt04;
    scope05.id = idRt05;
  });

  it("RT04 hanya melihat warga miliknya sendiri", async () => {
    const n04 = await hitung(scope04, "SELECT count(*)::int AS n FROM warga");
    const n05 = await hitung(scope05, "SELECT count(*)::int AS n FROM warga");
    const total = await hitung(PLATFORM, "SELECT count(*)::int AS n FROM warga");

    expect(n04).toBe(warga04);
    expect(n05).toBe(warga05);
    expect(n04 + n05).toBe(total);
    // tidak ada satu pun baris milik tenant lain yang lolos
    expect(await hitung(scope04, "SELECT count(*)::int AS n FROM warga WHERE rt_id <> $1", [idRt04])).toBe(0);
    expect(await hitung(scope05, "SELECT count(*)::int AS n FROM warga WHERE rt_id <> $1", [idRt05])).toBe(0);
  });

  it("nama warga RT05 tidak pernah muncul dalam sesi RT04", async () => {
    const a = await denganScope(scope04, c => c.query("SELECT nama FROM warga"));
    const b = await denganScope(scope05, c => c.query("SELECT nama FROM warga"));
    const nama04 = a.rows.map((x) => (x as { nama: string }).nama);
    const nama05 = b.rows.map((x) => (x as { nama: string }).nama);

    expect(nama04).toContain("Bambang Supriyanto");
    expect(nama04).not.toContain("Rudi Setiawan");
    expect(nama05).toContain("Rudi Setiawan");
    expect(nama05).not.toContain("Bambang Supriyanto");
  });

  it("pengurus RT lain juga tidak terlihat", async () => {
    const a = await denganScope(scope04, (c) => c.query("SELECT nama FROM pengurus_rt"));
    const b = await denganScope(scope05, (c) => c.query("SELECT nama FROM pengurus_rt"));
    const nama04 = a.rows.map((x) => (x as { nama: string }).nama);
    const nama05 = b.rows.map((x) => (x as { nama: string }).nama);

    expect(nama04).toContain("Joko Santoso");
    expect(nama04).not.toContain("Budi Hartono");
    expect(nama05).toContain("Budi Hartono");
    expect(nama05).not.toContain("Joko Santoso");
  });

  it("kas, audit & tagihan RT05 tidak terlihat dari sesi RT04", async () => {
    expect(await hitung(scope04, "SELECT count(*)::int AS n FROM kas_entry WHERE scope_id <> $1", [idRt04])).toBe(0);
    expect(await hitung(scope04, "SELECT count(*)::int AS n FROM audit_log WHERE scope_id <> $1", [idRt04])).toBe(0);
    expect(await hitung(scope04, "SELECT count(*)::int AS n FROM tagihan WHERE rt_id <> $1", [idRt04])).toBe(0);
  });
});

describe("penulisan lintas tenant ditolak", () => {
  it("INSERT warga ber-rt_id milik RT05 dari sesi RT04 → 42501", async () => {
    const g = await tangkapGalat(
      denganScope({ level: "rt", id: idRt04 }, (c) =>
        c.query(
          `INSERT INTO warga (id, rt_id, kk_id, nama, updated_at)
           VALUES ($1, $2, $3, 'Penyusup', now())`,
          [randomUUID(), idRt05, idKkRt04],
        ),
      ),
    );
    expect(g.code).toBe("42501");
    expect(g.message).toMatch(/row-level security policy/);
    expect(g.message).toMatch(/warga/);
    expect(await hitung(PLATFORM, "SELECT count(*)::int AS n FROM warga WHERE nama = 'Penyusup'")).toBe(0);
  });

  it("baris RT05 tak terlihat untuk UPDATE dari sesi RT04 (0 baris terpengaruh)", async () => {
    const sasaran = (
      await denganScope({ level: "rt", id: idRt05 }, (c) => c.query("SELECT id, nama FROM warga LIMIT 1"))
    ).rows[0] as { id: string; nama: string };
    expect(sasaran, "RT05 harus punya baris warga").toBeDefined();

    const hasil = await denganScope({ level: "rt", id: idRt04 }, (c) =>
      c.query("UPDATE warga SET nama = 'Sudah Diubah' WHERE id = $1", [sasaran.id]),
    );
    // barisnya tidak lolos USING → tidak tersentuh sama sekali (bukan galat)
    expect(hasil.rowCount).toBe(0);

    const setelah = (
      await denganScope({ level: "rt", id: idRt05 }, (c) =>
        c.query("SELECT nama FROM warga WHERE id = $1", [sasaran.id]),
      )
    ).rows[0] as { nama: string };
    expect(setelah.nama).toBe(sasaran.nama);
    expect(setelah.nama).not.toBe("Sudah Diubah");
  });
});

describe("append-only (trigger fn_tolak_perubahan)", () => {
  const TABEL = ["kas_entry", "audit_log", "mutasi_saldo_warga", "alokasi_pembayaran"];

  it("trigger UPDATE/DELETE terpasang pada keempat tabel", async () => {
    const r = await dalamScopePlat((c) =>
      c.query(
        `SELECT c.relname AS tabel
           FROM pg_trigger t
           JOIN pg_class c ON c.oid = t.tgrelid
          WHERE NOT t.tgisinternal AND t.tgname LIKE 'trg_%_append_only'`,
      ),
    );
    expect((r.rows as Array<{ tabel: string }>).map((x) => x.tabel).sort()).toEqual([...TABEL].sort());
  });

  it("INSERT tetap diperbolehkan (append-only ≠ baca-saja)", async () => {
    // tiga tabel lain sudah terisi oleh seed → bukti INSERT bekerja
    expect(await hitung(PLATFORM, "SELECT count(*)::int AS n FROM kas_entry")).toBeGreaterThan(0);
    expect(await hitung(PLATFORM, "SELECT count(*)::int AS n FROM audit_log")).toBeGreaterThan(0);
    expect(await hitung(PLATFORM, "SELECT count(*)::int AS n FROM alokasi_pembayaran")).toBeGreaterThan(0);

    // mutasi_saldo_warga: buktikan INSERT sukses, lalu urungkan
    const masuk = await dalamRollback(PLATFORM, async (c) => {
      await c.query(SQL_BARIS_MUTASI);
      return c.query("SELECT count(*)::int AS n FROM mutasi_saldo_warga");
    });
    expect(Number((masuk.rows[0] as { n: number }).n)).toBeGreaterThan(0);
    expect(
      await hitung(PLATFORM, "SELECT count(*)::int AS n FROM mutasi_saldo_warga"),
    ).toBe(0); // sudah ter-ROLLBACK
  });

  for (const tabel of TABEL) {
    it(`${tabel}: UPDATE & DELETE selalu ditolak`, async () => {
      const ada = await hitung(PLATFORM, `SELECT count(*)::int AS n FROM ${tabel}`);
      const barisUji = tabel === "mutasi_saldo_warga" ? SQL_BARIS_MUTASI : null;
      if (ada === 0) expect(barisUji, `${tabel} kosong dan tak punya SQL baris uji`).not.toBeNull();

      const g1 = await tangkapGalat(
        denganScope(PLATFORM, async (c) => {
          if (ada === 0) await c.query(barisUji!);
          await c.query(`UPDATE ${tabel} SET id = id`);
        }),
      );
      expect(g1.code).toBe("23001"); // restrict_violation
      expect(g1.message).toMatch(/append-only/);
      expect(g1.message).toMatch(/UPDATE ditolak/);

      const g2 = await tangkapGalat(
        denganScope(PLATFORM, async (c) => {
          if (ada === 0) await c.query(barisUji!);
          await c.query(`DELETE FROM ${tabel} WHERE id = (SELECT id FROM ${tabel} LIMIT 1)`);
        }),
      );
      expect(g2.code).toBe("23001");
      expect(g2.message).toMatch(/append-only/);
      expect(g2.message).toMatch(/DELETE ditolak/);

      // data seed tetap utuh
      expect(await hitung(PLATFORM, `SELECT count(*)::int AS n FROM ${tabel}`)).toBe(ada);
    });
  }
});

describe("CHECK constraint detail KK & NIK", () => {
  const NILAI: Record<string, unknown> = {
    gol_darah: "Z",
    status_kawin: "Misterius",
    warga_negara: "Mars",
    nik_masked: "3171-xxxx-xxxx-0001",
  };

  function insertWarga(kolom: string): Promise<unknown> {
    return dalamRollback(PLATFORM, (c) =>
      c.query(
        `INSERT INTO warga (id, rt_id, kk_id, nama, updated_at, ${kolom})
         VALUES ($1, $2, $3, 'Uji Coba', now(), $4)`,
        [randomUUID(), idRt04, idKkRt04, NILAI[kolom]],
      ),
    );
  }

  it("gol. darah di luar A/B/AB/O ditolak", async () => {
    expect((await tangkapGalat(insertWarga("gol_darah"))).message).toMatch(/warga_gol_darah_valid/);
  });

  it("status perkawinan di luar 4 opsi FE ditolak", async () => {
    expect((await tangkapGalat(insertWarga("status_kawin"))).message).toMatch(/warga_status_kawin_valid/);
  });

  it("warga negara selain WNI/WNA ditolak", async () => {
    expect((await tangkapGalat(insertWarga("warga_negara"))).message).toMatch(/warga_warga_negara_valid/);
  });

  it("tanggal perkawinan tanpa status perkawinan ditolak", async () => {
    const g = await tangkapGalat(
      dalamRollback(PLATFORM, (c) =>
        c.query(
          `INSERT INTO warga (id, rt_id, kk_id, nama, updated_at, tanggal_perkawinan)
           VALUES ($1, $2, $3, 'Uji Coba', now(), '2010-01-01')`,
          [randomUUID(), idRt04, idKkRt04],
        ),
      ),
    );
    expect(g.message).toMatch(/warga_tgl_kawin_konsisten/);
  });

  it("NIK tidak boleh disimpan ter-mask saja (wajib berpasangan ter-encrypt)", async () => {
    expect((await tangkapGalat(insertWarga("nik_masked"))).message).toMatch(/warga_nik_konsisten/);
  });

  it("isian yang sah justru diterima", async () => {
    const id = randomUUID();
    await dalamRollback(PLATFORM, async (c) => {
      await c.query(
        `INSERT INTO warga (id, rt_id, kk_id, nama, updated_at, tempat_lahir, pendidikan, gol_darah,
                            status_kawin, tanggal_perkawinan, warga_negara)
         VALUES ($1, $2, $3, 'Uji Coba Sah', now(), 'Jakarta', 'S1', 'O', 'Menikah', '2010-01-01', 'WNI')`,
        [id, idRt04, idKkRt04],
      );
      const r = await c.query("SELECT count(*)::int AS n FROM warga WHERE id = $1", [id]);
      expect(Number((r.rows[0] as { n: number }).n)).toBe(1);
    });
    // ikut ter-ROLLBACK: tidak ada baris uji yang tertinggal
    expect(await hitung(PLATFORM, "SELECT count(*)::int AS n FROM warga WHERE id = $1", [id])).toBe(0);
  });
});

describe("paritas data seed ↔ form Edit Data Warga (Portal RT)", () => {
  it("enam kolom detail KK terisi penuh untuk seluruh warga RT04", async () => {
    const kosong = await hitung(
      { level: "rt", id: idRt04 },
      `SELECT count(*)::int AS n FROM warga
        WHERE tempat_lahir IS NULL OR pendidikan IS NULL OR gol_darah IS NULL
           OR status_kawin IS NULL OR warga_negara IS NULL`,
    );
    expect(kosong).toBe(0);
  });

  it("nilai persis mengikuti daftar opsi FE (DataWargaRT.tsx)", async () => {
    const r = await denganScope({ level: "rt", id: idRt04 }, (c) =>
      c.query(
        `SELECT nama, tempat_lahir, pendidikan, gol_darah, status_kawin,
                to_char(tanggal_perkawinan, 'YYYY-MM-DD') AS tgl_kawin, warga_negara
           FROM warga WHERE nama = 'Bambang Supriyanto'`,
      ),
    );
    expect(r.rows[0]).toEqual({
      nama: "Bambang Supriyanto",
      tempat_lahir: "Jakarta",
      pendidikan: "S1",
      gol_darah: "O",
      status_kawin: "Menikah",
      tgl_kawin: "2008-07-19",
      warga_negara: "WNI",
    });

    const takSah = await hitung(
      { level: "rt", id: idRt04 },
      `SELECT count(*)::int AS n FROM warga
        WHERE (gol_darah IS NOT NULL AND gol_darah NOT IN ('A','B','AB','O'))
           OR (status_kawin IS NOT NULL AND status_kawin NOT IN ('Belum Menikah','Menikah','Cerai Hidup','Cerai Mati'))
           OR (warga_negara IS NOT NULL AND warga_negara NOT IN ('WNI','WNA'))`,
    );
    expect(takSah).toBe(0);
  });

  it("NIK tersimpan ter-encrypt + ter-mask, tidak pernah plaintext", async () => {
    const kolomNik = await dalamScopePlat((c) =>
      c.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_name = 'warga' AND column_name IN ('nik', 'nik_plaintext', 'no_kk_plaintext')`,
      ),
    );
    expect(kolomNik.rows, "tidak boleh ada kolom NIK/No.KK plaintext").toHaveLength(0);

    const baris = await dalamScopePlat((c) =>
      c.query("SELECT nik_encrypted, nik_masked FROM warga WHERE nik_masked IS NOT NULL"),
    );
    expect(baris.rows.length).toBeGreaterThanOrEqual(10);

    const kunci = Buffer.from(KUNCI_NIK, "base64");
    for (const b of baris.rows as Array<{ nik_encrypted: Buffer; nik_masked: string }>) {
      const asli = dekripsiNik(b.nik_encrypted, kunci);
      expect(asli).toMatch(/^\d{16}$/);
      expect(asli.startsWith("317105")).toBe(true); // domisili Jakarta — sesuai seed
      expect(b.nik_masked).toBe(`${asli.slice(0, 4)}-xxxx-xxxx-${asli.slice(12)}`);
      expect(b.nik_masked).not.toContain(asli);
    }
  });
});

describe("Portal RW hanya menerima agregat (§7.2)", () => {
  const scopeRw: Scope = { level: "rw", id: "" };
  beforeAll(() => {
    scopeRw.id = idRw;
  });

  it("RW tidak melihat satu pun baris per-warga/per-RT", async () => {
    for (const tabel of ["warga", "tagihan", "pembayaran", "kas_entry", "surat", "pengurus_rt", "kartu_keluarga"]) {
      expect(await hitung(scopeRw, `SELECT count(*)::int AS n FROM ${tabel}`), tabel).toBe(0);
    }
  });

  it("RW tetap melihat RT di bawahnya, induknya, dan data wilayah", async () => {
    expect(await hitung(scopeRw, "SELECT count(*)::int AS n FROM rt")).toBeGreaterThanOrEqual(2);
    expect(await hitung(scopeRw, "SELECT count(*)::int AS n FROM rw")).toBe(1);
    expect(await hitung(scopeRw, "SELECT count(*)::int AS n FROM kelurahan")).toBeGreaterThan(0);
  });

  it("view agregat terisi tanpa membocorkan identitas warga", async () => {
    expect(await hitung(scopeRw, "SELECT count(*)::int AS n FROM v_rw_iuran_agregat")).toBeGreaterThan(0);
    expect(await hitung(scopeRw, "SELECT count(*)::int AS n FROM v_rw_kas_agregat")).toBeGreaterThan(0);
    expect(await hitung(scopeRw, "SELECT count(*)::int AS n FROM v_rw_warga_agregat")).toBeGreaterThan(0);

    const r = await denganScope(scopeRw, (c) => c.query("SELECT * FROM v_rw_iuran_agregat LIMIT 5"));
    const kolom = Object.keys((r.rows[0] ?? {}) as Record<string, unknown>);
    expect(kolom).toContain("jumlah_tagihan");
    expect(kolom).not.toContain("warga_id");
    expect(kolom).not.toContain("nama");
    expect(kolom).not.toContain("nik_masked");
  });
});

// =============================================================================
// KEPUTUSAN B — paritas SEED ↔ FORM Portal RT
//
// Daftar literal di bawah adalah penulisan ulang dari `apps/web/src/lib/shared.ts`
// (`kategoriIuranDefault`, `jenisSuratOptions`, `suratPerluRw`) — server tidak
// boleh mengimpor berkas FE, jadi kesamaannya dijaga oleh test ini. Begitu FE
// atau seed berubah sepihak, blok ini langsung gagal.
// =============================================================================
describe("paritas seed ↔ form Atur Kategori Iuran & daftar Jenis Surat", () => {
  /** = `kategoriIuranDefault` di apps/web/src/lib/shared.ts */
  const KATEGORI_FE = [
    { nama: "Keamanan & Pos Ronda", nominal: 50000, tipe: "flat", sifat: "wajib", urutan: 1 },
    { nama: "Kebersihan & Lingkungan", nominal: 45000, tipe: "flat", sifat: "wajib", urutan: 2 },
    { nama: "Dana Sosial & Kematian", nominal: 25000, tipe: "flat", sifat: "wajib", urutan: 3 },
    { nama: "Kendaraan R4 (per unit)", nominal: 25000, tipe: "per_unit", sifat: "opsional", urutan: 4 },
  ];

  /** = `jenisSuratOptions` tanpa "Surat Lainnya..." (pilihan bebas, bukan baris). */
  const JENIS_SURAT_FE = [
    { nama: "Surat Keterangan Domisili", perluRw: false },
    { nama: "Surat Keterangan Tidak Mampu", perluRw: false },
    { nama: "Surat Pengantar SKCK", perluRw: true },
    { nama: "Surat Pengantar Pindah", perluRw: true },
    { nama: "Surat Pengantar Nikah", perluRw: true },
    { nama: "Surat Keterangan Usaha", perluRw: false },
    { nama: "Surat Keterangan Kelahiran", perluRw: false },
    { nama: "Surat Keterangan Kematian", perluRw: false },
  ];

  it("kategori iuran RT004 identik dengan kategoriIuranDefault (nama, nominal, tipe, sifat, urutan)", async () => {
    const r = await denganScope({ level: "rt", id: idRt04 }, (c) =>
      c.query(
        `SELECT nama, nominal_default::float AS nominal, tipe_tarif AS tipe,
                wajib_opsional AS sifat, urutan, status_aktif AS aktif
           FROM kategori_iuran
          ORDER BY urutan`,
      ),
    );
    expect(r.rows).toEqual(KATEGORI_FE.map((k) => ({ ...k, aktif: true })));
  });

  it("nilai enum kategori persis kamus FE: flat | per_unit | insidental, wajib | opsional", async () => {
    const takSah = await hitung(
      { level: "rt", id: idRt04 },
      `SELECT count(*)::int AS n FROM kategori_iuran
        WHERE tipe_tarif NOT IN ('flat','per_unit','insidental')
           OR wajib_opsional NOT IN ('wajib','opsional')
           OR urutan < 1`,
    );
    expect(takSah).toBe(0);
  });

  it("jenis surat RT004 = jenisSuratOptions FE (8 baris, semua aktif)", async () => {
    const r = await denganScope({ level: "rt", id: idRt04 }, (c) =>
      c.query("SELECT nama, perlu_rw, aktif FROM jenis_surat"),
    );
    const baris = r.rows as Array<{ nama: string; perlu_rw: boolean; aktif: boolean }>;

    expect(baris.map((b) => b.nama).sort()).toEqual(JENIS_SURAT_FE.map((j) => j.nama).sort());
    expect(baris.every((b) => b.aktif)).toBe(true);
  });

  it("perlu_rw hanya SKCK / Pindah / Nikah — sama dengan suratPerluRw() di FE", async () => {
    const r = await denganScope({ level: "rt", id: idRt04 }, (c) =>
      c.query("SELECT nama, perlu_rw FROM jenis_surat"),
    );
    const baris = r.rows as Array<{ nama: string; perlu_rw: boolean }>;

    for (const b of baris) {
      expect(b.perlu_rw, `${b.nama} → /SKCK|Pindah|Nikah/i`).toBe(/SKCK|Pindah|Nikah/i.test(b.nama));
    }
    expect(baris.filter((b) => b.perlu_rw).map((b) => b.nama).sort()).toEqual(
      JENIS_SURAT_FE.filter((j) => j.perluRw).map((j) => j.nama).sort(),
    );
    expect(baris.filter((b) => b.perlu_rw)).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// F-2 · Jalur lookup auth (migrasi 0003) + rute sesi/login pada aplikasi nyata
// ---------------------------------------------------------------------------

const SCOPE_AUTH: Scope = { level: "auth", id: null };
const HASH_SID = (sid: string) => createHash("sha256").update(sid).digest("hex");

describe("jalur lookup auth (migrasi 0003)", () => {
  it("GUC app.scope_level='auth' membuka pembacaan warga — tanpa scope tetap nol", async () => {
    expect(await hitung(SCOPE_AUTH, "SELECT count(*)::int AS n FROM warga")).toBeGreaterThan(0);
    expect(await hitung(null, "SELECT count(*)::int AS n FROM warga")).toBe(0);
    // lookup yang sama tetap terbatas per-RT bila scope RT dipakai
    expect(
      await hitung({ level: "rt", id: idRt04 }, "SELECT count(*)::int AS n FROM warga WHERE no_hp = '081234567890'"),
    ).toBe(1);
  });

  it("jalur 'auth' TIDAK membuka tabel tenant lain", async () => {
    for (const tabel of ["tagihan", "pembayaran", "kas_entry", "audit_log", "kartu_keluarga", "surat"]) {
      expect(await hitung(SCOPE_AUTH, `SELECT count(*)::int AS n FROM ${tabel}`), tabel).toBe(0);
    }
  });

  it("policy SELECT-saja: INSERT ditolak 42501, UPDATE tak menyentuh satu baris pun", async () => {
    const g = await tangkapGalat(
      denganScope(SCOPE_AUTH, (c) =>
        c.query(
          `INSERT INTO warga (id, rt_id, kk_id, nama, updated_at)
           VALUES ($1, $2, $3, 'Penyusup Auth', now())`,
          [randomUUID(), idRt04, idKkRt04],
        ),
      ),
    );
    expect(g.code).toBe("42501");
    expect(g.message).toMatch(/row-level security policy/);
    expect(await hitung(PLATFORM, "SELECT count(*)::int AS n FROM warga WHERE nama = 'Penyusup Auth'")).toBe(0);

    // UPDATE tidak memakai policy SELECT → seluruh baris tersaring USING,
    // jadi tidak ada satu pun baris yang tersentuh (rowCount 0, bukan 42501)
    const tulis = await denganScope(SCOPE_AUTH, (c) =>
      c.query("UPDATE warga SET nama = 'Sudah Diubah Auth' WHERE no_hp = '081234567890'"),
    );
    expect(tulis.rowCount).toBe(0);
    expect(
      await hitung({ level: "rt", id: idRt04 }, "SELECT count(*)::int AS n FROM warga WHERE no_hp = '081234567890' AND nama = 'Bambang Supriyanto'"),
    ).toBe(1);
  });
});

describe("jalur lookup token undangan (migrasi 0004)", () => {
  it("GUC 'auth' membuka pembacaan token_undangan — tanpa scope tetap nol", async () => {
    expect(await hitung(SCOPE_AUTH, "SELECT count(*)::int AS n FROM token_undangan")).toBeGreaterThan(0);
    expect(await hitung(null, "SELECT count(*)::int AS n FROM token_undangan")).toBe(0);
    // scope RT tetap menyaring per wilayah — jalur auth tidak melebarkan akses
    expect(
      await hitung({ level: "rt", id: idRt04 }, "SELECT count(*)::int AS n FROM token_undangan WHERE rt_id = $1", [idRt04]),
    ).toBeGreaterThan(0);
    expect(
      await hitung({ level: "rt", id: idRt04 }, "SELECT count(*)::int AS n FROM token_undangan WHERE rt_id <> $1", [idRt04]),
    ).toBe(0);
  });

  it("policy SELECT-saja: INSERT ditolak 42501, UPDATE tak menyentuh satu baris pun", async () => {
    const baris = (
      await dalamScopePlat((c) => c.query("SELECT id, rt_id, warga_id, dibuat_oleh FROM token_undangan LIMIT 1"))
    ).rows[0] as { id: string; rt_id: string; warga_id: string; dibuat_oleh: string };

    const g = await tangkapGalat(
      denganScope(SCOPE_AUTH, (c) =>
        c.query(
          `INSERT INTO token_undangan (id, rt_id, warga_id, kode_hash, dibuat_oleh, kedaluwarsa_pada)
           VALUES ($1, $2, $3, '$argon2id$dummy', $4, now() + interval '24 hours')`,
          [randomUUID(), baris.rt_id, baris.warga_id, baris.dibuat_oleh],
        ),
      ),
    );
    expect(g.code).toBe("42501");
    expect(g.message).toMatch(/row-level security policy/);
    expect(await hitung(PLATFORM, "SELECT count(*)::int AS n FROM token_undangan WHERE id = $1", [baris.id])).toBe(1);

    const dicabutSebelum = await hitung(
      PLATFORM,
      "SELECT count(*)::int AS n FROM token_undangan WHERE status = 'dicabut'",
    );
    const tulis = await denganScope(SCOPE_AUTH, (c) =>
      c.query("UPDATE token_undangan SET status = 'dicabut'"),
    );
    expect(tulis.rowCount).toBe(0);
    // tidak ada satu pun baris yang berpindah status oleh jalur 'auth'
    expect(
      await hitung(PLATFORM, "SELECT count(*)::int AS n FROM token_undangan WHERE status = 'dicabut'"),
    ).toBe(dicabutSebelum);
  });
});

// ---------------------------------------------------------------------------
// Aplikasi Fastify di atas DB uji — dipakai BERSAMA oleh tes F-2 (auth) dan
// F-3 (API iuran). `config.ts` membaca env SEKALI saat import, jadi env wajib
// terisi LEBIH DAHULU sebelum `../src/app.js` diimpor (dynamic import) dan
// harus dikembalikan sesudahnya — `app.spec.ts` mengasumsikan
// `process.env.DATABASE_URL` undefined dan `authRateLimitPerMenit === 10`.
// ---------------------------------------------------------------------------

const envAsal: Record<string, string | undefined> = {};
let appUji: FastifyInstance | null = null;
let apiUji = "/api/v1";

/**
 * Env uji diambil DI DALAM fungsi — `URL_TES` baru terisi oleh `siapkanPort()`
 * di `beforeAll` pertama, sehingga membacanya di module scope justru menangkap
 * string kosong dan membuat validasi config melempar `DATABASE_URL: Too small`.
 */
function envUji(): Record<string, string> {
  return {
    DATABASE_URL: URL_TES, // peran uji NOSUPERUSER → RLS benar-benar menegak
    SESSION_SECRET: KUNCI_SESI,
    NIK_ENCRYPTION_KEY: KUNCI_NIK,
    AUTH_RATE_LIMIT_PER_MENIT: "1000", // uji login berulang tidak boleh kena 429
  };
}

/** Ambil nilai satu cookie dari header `set-cookie` respons inject. */
function cookieDari(res: { headers: Record<string, unknown> }, nama: string): string | null {
  const mentah = res.headers["set-cookie"];
  const daftar = Array.isArray(mentah) ? mentah : mentah ? [String(mentah)] : [];
  for (const c of daftar) {
    const m = new RegExp(`(?:^|;\\s*)${nama}=([^;]*)`).exec(c);
    if (m) return decodeURIComponent(m[1]);
  }
  return null;
}

function isi(res: { json: () => unknown }): { ok: boolean; data?: any; error?: { code: string; message: string } } {
  return res.json() as any;
}

/** Buka (atau pakai ulang) aplikasi Fastify di atas DB uji. */
async function bukaAplikasiUji(): Promise<FastifyInstance> {
  if (appUji) return appUji;
  for (const [k, v] of Object.entries(envUji())) {
    if (!(k in envAsal)) envAsal[k] = process.env[k];
    process.env[k] = v;
  }
  const modul = await import("../src/app.js");
  apiUji = modul.PREFIX_API;
  appUji = await modul.buatAplikasi();
  return appUji;
}

/** Tutup aplikasi dan kembalikan env ke kondisi semula. */
async function tutupAplikasiUji(): Promise<void> {
  if (appUji) {
    await appUji.close();
    appUji = null;
  }
  for (const [k, v] of Object.entries(envAsal)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
    delete envAsal[k];
  }
}

describe("F-2 · sesi & login (aplikasi Fastify + DB nyata)", () => {
  let app: FastifyInstance;
  let api = "/api/v1";

  beforeAll(async () => {
    app = await bukaAplikasiUji();
    api = apiUji;
  }, 60_000);

  afterAll(async () => {
    await tutupAplikasiUji();
  });

  it("login pengurus sukses → sid httpOnly + csrf_token, sesi terbaca & audit tercatat", async () => {
    const res = await app.inject({
      method: "POST",
      url: `${api}/auth/pengurus/login`,
      payload: { email: "rt04@siwarga.id", password: "rahasia123" },
    });
    expect(res.statusCode).toBe(200);
    expect(isi(res).ok).toBe(true);
    expect(isi(res).data.peran).toBe("rt_admin");

    const sid = cookieDari(res, "sid");
    expect(sid, "cookie sid wajib terpasang").toBeTruthy();
    expect(res.cookies.find((c) => c.name === "sid")?.httpOnly).toBe(true);
    expect(res.cookies.find((c) => c.name === "csrf_token")?.httpOnly).toBeFalsy();

    const sesi = await app.inject({ method: "GET", url: `${api}/auth/pengurus/sesi`, cookies: { sid: sid! } });
    expect(sesi.statusCode).toBe(200);
    expect(isi(sesi).data.peran).toBe("rt_admin");
    expect(isi(sesi).data.sisaDetik).toBeGreaterThan(0);

    // token hanya hidup sebagai SHA-256 di database
    expect(
      await hitung(PLATFORM, "SELECT count(*)::int AS n FROM sesi_login WHERE token_hash = $1", [HASH_SID(sid!)]),
    ).toBe(1);
    expect(await hitung(PLATFORM, "SELECT count(*)::int AS n FROM sesi_login WHERE token_hash = $1", [sid!])).toBe(0);
    // jejak audit wajib (§14)
    expect(
      await hitung({ level: "rt", id: idRt04 }, "SELECT count(*)::int AS n FROM audit_log WHERE aksi = 'login_pengurus'"),
    ).toBeGreaterThan(0);
  });

  it("sandi salah & email tak dikenal → 401 dengan pesan identik, tanpa cookie", async () => {
    const salah = await app.inject({
      method: "POST",
      url: `${api}/auth/pengurus/login`,
      payload: { email: "rt04@siwarga.id", password: "salahsekali" },
    });
    const asing = await app.inject({
      method: "POST",
      url: `${api}/auth/pengurus/login`,
      payload: { email: "takada@siwarga.id", password: "salahsekali" },
    });

    expect(salah.statusCode).toBe(401);
    expect(asing.statusCode).toBe(401);
    expect(isi(salah).error?.code).toBe("UNAUTHORIZED");
    expect(isi(asing).error?.message).toBe(isi(salah).error?.message);
    expect(cookieDari(salah, "sid")).toBeNull();
    expect(cookieDari(asing, "sid")).toBeNull();
  });

  it("payload tidak valid → 400 VALIDATION; sesi tanpa cookie → 401 UNAUTHORIZED", async () => {
    const pendek = await app.inject({
      method: "POST",
      url: `${api}/auth/pengurus/login`,
      payload: { email: "rt04@siwarga.id", password: "pendek" },
    });
    expect(pendek.statusCode).toBe(400);
    expect(isi(pendek).error?.code).toBe("VALIDATION");

    const tanpaCookie = await app.inject({ method: "GET", url: `${api}/auth/pengurus/sesi` });
    expect(tanpaCookie.statusCode).toBe(401);
    expect(isi(tanpaCookie).error?.code).toBe("UNAUTHORIZED");
  });

  it("logout pengurus dijaga CSRF: tanpa header ditolak, dengan token sesi hangus", async () => {
    const login = await app.inject({
      method: "POST",
      url: `${api}/auth/pengurus/login`,
      payload: { email: "rt04@siwarga.id", password: "rahasia123" },
    });
    const sid = cookieDari(login, "sid")!;
    const csrf = cookieDari(login, "csrf_token")!;
    expect(sid && csrf).toBeTruthy();

    const tanpaCsrf = await app.inject({ method: "POST", url: `${api}/auth/pengurus/logout`, cookies: { sid } });
    expect(tanpaCsrf.statusCode).toBe(401);
    expect(isi(tanpaCsrf).error?.message).toMatch(/CSRF/);

    const rusak = await app.inject({
      method: "POST",
      url: `${api}/auth/pengurus/logout`,
      cookies: { sid, csrf_token: csrf },
      headers: { "x-csrf-token": "nonce.palsu" },
    });
    expect(rusak.statusCode).toBe(401);

    const keluar = await app.inject({
      method: "POST",
      url: `${api}/auth/pengurus/logout`,
      cookies: { sid, csrf_token: csrf },
      headers: { "x-csrf-token": csrf },
    });
    expect(keluar.statusCode).toBe(200);
    expect(isi(keluar).data.keluar).toBe(true);

    const sesi = await app.inject({ method: "GET", url: `${api}/auth/pengurus/sesi`, cookies: { sid } });
    expect(sesi.statusCode).toBe(401);
    expect(
      await hitung(PLATFORM, "SELECT count(*)::int AS n FROM sesi_login WHERE token_hash = $1 AND dicabut_pada IS NULL", [HASH_SID(sid)]),
    ).toBe(0);
  });

  it("login warga (no. HP + kata sandi) sukses → profil ringkas + sesi terbaca", async () => {
    const res = await app.inject({
      method: "POST",
      url: `${api}/auth/warga/login`,
      payload: { noHp: "081234567890", password: SANDI_WARGA_UJI },
    });
    expect(res.statusCode).toBe(200);
    expect(isi(res).data.peran).toBe("warga");
    expect(isi(res).data.nama).toBe("Bambang Supriyanto");

    const sid = cookieDari(res, "sid");
    expect(sid).toBeTruthy();
    expect(res.cookies.find((c) => c.name === "sid")?.httpOnly).toBe(true);

    const sesi = await app.inject({ method: "GET", url: `${api}/auth/warga/sesi`, cookies: { sid: sid! } });
    expect(sesi.statusCode).toBe(200);
    expect(isi(sesi).data.nama).toBe("Bambang Supriyanto");
    expect(isi(sesi).data.sisaDetik).toBeGreaterThan(0);
  });

  it("kata sandi salah → 401 generik; 3x berturut → kunci 15 menit (423 ACCOUNT_LOCKED)", async () => {
    const kirim = (password: string, noHp = "081234567890") =>
      app.inject({ method: "POST", url: `${api}/auth/warga/login`, payload: { noHp, password } });

    const p1 = await kirim("SalahSekali99");
    expect(p1.statusCode).toBe(401);
    expect(isi(p1).error?.code).toBe("UNAUTHORIZED");
    expect(isi(p1).error?.message).toBe("No. HP atau kata sandi salah.");

    // nomor tidak dikenal → pesan & status persis sama (anti-enumerasi §14.1)
    const asing = await kirim("SalahSekali99", "08999999999");
    expect(asing.statusCode).toBe(401);
    expect(isi(asing).error?.message).toBe(isi(p1).error?.message);

    await kirim("SalahSekali99"); // percobaan ke-2
    await kirim("SalahSekali99"); // percobaan ke-3 → terkunci

    const terkunci = await kirim(SANDI_WARGA_UJI); // kata sandi benar pun tetap ditolak
    expect(terkunci.statusCode).toBe(423);
    expect(isi(terkunci).error?.code).toBe("ACCOUNT_LOCKED");
    expect(cookieDari(terkunci, "sid")).toBeNull();

    // pulihkan kredensial agar tahap sesudahnya tidak ikut terkunci
    await denganScope({ level: "rt", id: idRt04 }, (c) =>
      c.query(
        `UPDATE kredensial_warga SET gagal_berturut = 0, dikunci_sampai = NULL
          WHERE warga_id IN (SELECT id FROM warga WHERE no_hp = '081234567890')`,
      ),
    );
    const pulih = await kirim(SANDI_WARGA_UJI);
    expect(pulih.statusCode).toBe(200);
  });

  it("kata sandi tidak memenuhi syarat (min. 8 karakter) → 400 VALIDATION", async () => {
    const res = await app.inject({
      method: "POST",
      url: `${api}/auth/warga/login`,
      payload: { noHp: "081234567890", password: "123456" },
    });
    expect(res.statusCode).toBe(400);
    expect(isi(res).error?.code).toBe("VALIDATION");
    expect(cookieDari(res, "sid")).toBeNull();
  });

  it("akses belum aktif (menunggu_aktivasi) → 400 TOKEN_INVALID tanpa sesi", async () => {
    const res = await app.inject({
      method: "POST",
      url: `${api}/auth/warga/login`,
      payload: { noHp: "081234567892", password: SANDI_WARGA_UJI },
    });
    expect(res.statusCode).toBe(400);
    expect(isi(res).error?.code).toBe("TOKEN_INVALID");
    expect(cookieDari(res, "sid")).toBeNull();
  });

  it("menonaktifkan akses warga di tengah sesi → sesi langsung hangus (B5)", async () => {
    const login = await app.inject({
      method: "POST",
      url: `${api}/auth/warga/login`,
      payload: { noHp: "081234567890", password: SANDI_WARGA_UJI },
    });
    expect(login.statusCode).toBe(200);
    const sid = cookieDari(login, "sid")!;

    const sesiOk = await app.inject({ method: "GET", url: `${api}/auth/warga/sesi`, cookies: { sid } });
    expect(sesiOk.statusCode).toBe(200);

    await denganScope({ level: "rt", id: idRt04 }, (c) =>
      c.query("UPDATE warga SET status_akses = 'dinonaktifkan' WHERE no_hp = '081234567890'"),
    );
    try {
      const sesi = await app.inject({ method: "GET", url: `${api}/auth/warga/sesi`, cookies: { sid } });
      expect(sesi.statusCode).toBe(401);
      expect(
        await hitung(
          PLATFORM,
          "SELECT count(*)::int AS n FROM sesi_login WHERE token_hash = $1 AND dicabut_pada IS NOT NULL",
          [HASH_SID(sid)],
        ),
      ).toBe(1);
    } finally {
      await denganScope({ level: "rt", id: idRt04 }, (c) =>
        c.query("UPDATE warga SET status_akses = 'aktif' WHERE no_hp = '081234567890'"),
      );
    }

    const pulih = await app.inject({
      method: "POST",
      url: `${api}/auth/warga/login`,
      payload: { noHp: "081234567890", password: SANDI_WARGA_UJI },
    });
    expect(pulih.statusCode).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// F-2 · Undangan & aktivasi warga — rute PUBLIK /auth/warga/undangan/* (B1)
//       + penerbitan token oleh Pengurus RT (B4).
//       Menutup kasus laporan: "undangan warga belum berfungsi sehingga warga
//       belum bisa mengaktifkan portal".
//       Urutan tes berantai: terbit → GET detail → validasi → aktivasi →
//       single-use → guard → kedaluwarsa.
// ---------------------------------------------------------------------------

describe("F-2 · undangan & aktivasi warga (rute publik + RT)", () => {
  let app: FastifyInstance;
  let api = "/api/v1";
  let sidRt = "";
  let csrfRt = "";
  /** `<id>.<kode>` terbit untuk Maya Sari. */
  let tokenAktivasi = "";
  let idTokenMaya = "";

  const NOHP_MAYA = "081234567893";
  const NOHP_ZAHRA = "081234567895";
  const NOHP_BAMBANG = "081234567890";
  const SANDI_BARU = "SandiAktivasi2026";
  const sesiRt = () => ({ sid: sidRt, csrf_token: csrfRt });

  const terbitkan = (noHp: string) =>
    app.inject({
      method: "POST",
      url: `${api}/rt/warga/${noHp}/undangan`,
      cookies: sesiRt(),
      headers: { "x-csrf-token": csrfRt },
    });

  const hashKredensial = async (noHp: string): Promise<string> => {
    const baris = await dalamScopePlat((c) =>
      c.query(
        "SELECT kw.password_hash FROM kredensial_warga kw JOIN warga w ON w.id = kw.warga_id WHERE w.no_hp = $1",
        [noHp],
      ),
    );
    return (baris.rows[0] as { password_hash: string } | undefined)?.password_hash ?? "";
  };

  beforeAll(async () => {
    app = await bukaAplikasiUji();
    api = apiUji;
    const rt = await app.inject({
      method: "POST",
      url: `${api}/auth/pengurus/login`,
      payload: { email: "rt04@siwarga.id", password: "rahasia123" },
    });
    expect(rt.statusCode, "login RT04 untuk uji undangan").toBe(200);
    sidRt = cookieDari(rt, "sid")!;
    csrfRt = cookieDari(rt, "csrf_token")!;
  }, 60_000);

  afterAll(async () => {
    await tutupAplikasiUji();
  });

  it("guard zona waktu: Prisma & pg membaca timestamptz identik (sesi UTC)", async () => {
    // Audit Fase 3: Prisma 7 + adapter-pg mengabaikan offset non-UTC pada teks pg.
    // `ALTER ROLE ... SET TimeZone TO 'UTC'` (harness ini) membuat keduanya absolut-benar;
    // tes ini menahan regresi bila pernyataan itu terhapus.
    const { db } = await import("../src/services/db.js");
    const prisma = db();
    const tz = await prisma.$queryRaw<{ tz: string }[]>`SELECT current_setting('TimeZone') AS tz`;
    expect(tz[0]!.tz, "sesi koneksi Prisma").toBe("UTC");

    const rPrisma = await prisma.$queryRaw<{ n: Date; v: Date }[]>`SELECT now() AS n, now() - interval '1 hour' AS v`;
    const rPg = await dalamScopePlat((c) => c.query("SELECT now() AS n, now() - interval '1 hour' AS v"));
    for (const kolom of ["n", "v"] as const) {
      const dariPrisma = rPrisma[0]![kolom].getTime();
      const dariPg = (rPg.rows[0][kolom] as Date).getTime();
      expect(Math.abs(dariPrisma - dariPg), `selisih ${kolom}() Prisma vs pg`).toBeLessThan(2000);
    }
  });

  it("RT menerbitkan undangan → token `<id>.<kode>`, warga → menunggu_aktivasi, audit tercatat", async () => {
    const res = await terbitkan(NOHP_MAYA);
    expect(res.statusCode).toBe(200);
    const d = isi(res).data;
    expect(d.token).toMatch(/^[0-9a-f-]{36}\.[A-Z0-9]{10}$/);
    expect(d.nama).toBe("Maya Sari");
    expect(d.alamat).toBeTruthy();
    expect(d.dikirimOleh).toBeTruthy();
    expect(d.berlakuSampai).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(d.noWa).toBe(NOHP_MAYA);
    tokenAktivasi = d.token;
    idTokenMaya = d.id;

    // token tersimpan, masih 'menunggu', dan kode asli TIDAK PERNAH ada di DB
    expect(
      await hitung(
        PLATFORM,
        "SELECT count(*)::int AS n FROM token_undangan WHERE id = $1 AND status = 'menunggu'",
        [idTokenMaya],
      ),
    ).toBe(1);
    const baris = (
      await dalamScopePlat((c) => c.query("SELECT kode_hash FROM token_undangan WHERE id = $1", [idTokenMaya]))
    ).rows[0] as { kode_hash: string };
    expect(baris.kode_hash).toMatch(/^\$argon2/);
    expect(baris.kode_hash).not.toContain(tokenAktivasi.split(".")[1]);

    // §6.3 — status akses mengikuti penerbitan undangan
    expect(
      await hitung(
        { level: "rt", id: idRt04 },
        "SELECT count(*)::int AS n FROM warga WHERE no_hp = $1 AND status_akses = 'menunggu_aktivasi'",
        [NOHP_MAYA],
      ),
    ).toBe(1);
    expect(
      await hitung(
        { level: "rt", id: idRt04 },
        "SELECT count(*)::int AS n FROM audit_log WHERE aksi = 'kirim_undangan'",
      ),
    ).toBeGreaterThan(0);
  });

  it("GET publik → detail undangan; kode salah / id asing → 404; no. HP tidak ikut dikirim", async () => {
    const ok = await app.inject({ method: "GET", url: `${api}/auth/warga/undangan/${tokenAktivasi}` });
    expect(ok.statusCode).toBe(200);
    const d = isi(ok).data;
    expect(d.nama).toBe("Maya Sari");
    expect(d.alamat).toBeTruthy();
    expect(d.dikirimOleh).toBeTruthy();
    expect(d.berlakuSampai).toMatch(/^\d{4}-/);
    // data minimization — no. HP pemegang undangan tidak perlu dikirim ke klien
    expect(JSON.stringify(d)).not.toContain(NOHP_MAYA);

    const salahKode = await app.inject({
      method: "GET",
      url: `${api}/auth/warga/undangan/${idTokenMaya}.AAAAAAAAAA`,
    });
    expect(salahKode.statusCode).toBe(404);
    expect(isi(salahKode).error?.code).toBe("NOT_FOUND");

    const idAsing = await app.inject({
      method: "GET",
      url: `${api}/auth/warga/undangan/${randomUUID()}.AAAAAAAAAA`,
    });
    expect(idAsing.statusCode).toBe(404);
    expect(isi(idAsing).error?.code).toBe("NOT_FOUND");
  });

  it("aktivasi menolak consent palsu (B14), sandi lemah, dan konfirmasi beda — token tetap sah", async () => {
    const tolak = async (payload: Record<string, unknown>) => {
      const res = await app.inject({
        method: "POST",
        url: `${api}/auth/warga/undangan/${tokenAktivasi}/aktivasi`,
        payload,
      });
      expect(res.statusCode).toBe(400);
      expect(isi(res).error?.code).toBe("VALIDATION");
      return res;
    };
    await tolak({ password: SANDI_BARU, konfirmasiPassword: SANDI_BARU, consent: false });
    await tolak({ password: "123456", konfirmasiPassword: "123456", consent: true });
    await tolak({ password: SANDI_BARU, konfirmasiPassword: "Lain2026", consent: true });

    // ketiganya ditolak sebelum menyentuh apa pun — token masih menunggu
    expect(
      await hitung(
        PLATFORM,
        "SELECT count(*)::int AS n FROM token_undangan WHERE id = $1 AND status = 'menunggu'",
        [idTokenMaya],
      ),
    ).toBe(1);
    expect(
      await hitung(
        { level: "rt", id: idRt04 },
        "SELECT count(*)::int AS n FROM warga WHERE no_hp = $1 AND status_akses = 'aktif'",
        [NOHP_MAYA],
      ),
    ).toBe(0);
  });

  it("aktivasi sukses → sesi terpasang, token terpakai, kredensial aktif, audit (B1, §6.3)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `${api}/auth/warga/undangan/${tokenAktivasi}/aktivasi`,
      payload: { password: SANDI_BARU, konfirmasiPassword: SANDI_BARU, consent: true },
    });
    expect(res.statusCode).toBe(200);
    expect(isi(res).data).toEqual({ peran: "warga", nama: "Maya Sari" });
    const sid = cookieDari(res, "sid");
    expect(sid).toBeTruthy();
    expect(res.cookies.find((c) => c.name === "sid")?.httpOnly).toBe(true);

    // sesi baru langsung sah
    const sesi = await app.inject({
      method: "GET",
      url: `${api}/auth/warga/sesi`,
      cookies: { sid: sid! },
    });
    expect(sesi.statusCode).toBe(200);
    expect(isi(sesi).data.nama).toBe("Maya Sari");

    // transisi token IRREVERSIBEL + warga aktif (§6.3)
    expect(
      await hitung(
        PLATFORM,
        "SELECT count(*)::int AS n FROM token_undangan WHERE id = $1 AND status = 'aktif_dipakai' AND dipakai_pada IS NOT NULL",
        [idTokenMaya],
      ),
    ).toBe(1);
    expect(
      await hitung(
        { level: "rt", id: idRt04 },
        "SELECT count(*)::int AS n FROM warga WHERE no_hp = $1 AND status_akses = 'aktif'",
        [NOHP_MAYA],
      ),
    ).toBe(1);

    // kredensial: hash argon2id, BUKAN sandi plaintext
    const hash = await hashKredensial(NOHP_MAYA);
    expect(hash).toMatch(/^\$argon2/);
    expect(hash).not.toContain(SANDI_BARU);

    // percobaan aktivasi tercatat (dasar deteksi multi-perangkat B6)
    expect(
      await hitung(
        PLATFORM,
        "SELECT count(*)::int AS n FROM token_undangan WHERE id = $1 AND jsonb_array_length(percobaan_aktivasi) >= 1",
        [idTokenMaya],
      ),
    ).toBe(1);
    expect(
      await hitung(
        { level: "rt", id: idRt04 },
        "SELECT count(*)::int AS n FROM audit_log WHERE aksi = 'aktivasi_undangan'",
      ),
    ).toBeGreaterThan(0);
  });

  it("single-use: GET/POST ulang → 400 TOKEN_INVALID; login no. HP + sandi baru berhasil", async () => {
    const getUlang = await app.inject({
      method: "GET",
      url: `${api}/auth/warga/undangan/${tokenAktivasi}`,
    });
    expect(getUlang.statusCode).toBe(400);
    expect(isi(getUlang).error?.code).toBe("TOKEN_INVALID");

    const postUlang = await app.inject({
      method: "POST",
      url: `${api}/auth/warga/undangan/${tokenAktivasi}/aktivasi`,
      payload: { password: "CobaLagi2026", konfirmasiPassword: "CobaLagi2026", consent: true },
    });
    expect(postUlang.statusCode).toBe(400);
    expect(isi(postUlang).error?.code).toBe("TOKEN_INVALID");
    // percobaan kedua TIDAK mengubah kredensial
    expect(await hashKredensial(NOHP_MAYA)).toMatch(/^\$argon2/);
    expect(await hashKredensial(NOHP_MAYA)).not.toContain("CobaLagi2026");

    const login = await app.inject({
      method: "POST",
      url: `${api}/auth/warga/login`,
      payload: { noHp: NOHP_MAYA, password: SANDI_BARU },
    });
    expect(login.statusCode).toBe(200);

    const salah = await app.inject({
      method: "POST",
      url: `${api}/auth/warga/login`,
      payload: { noHp: NOHP_MAYA, password: "SalahSekali1" },
    });
    expect(salah.statusCode).toBe(401);
  });

  it("guard: butuh sesi RT + CSRF; warga ditolak; lintas tenant → 404; sudah aktif → 409", async () => {
    const tanpaSesi = await app.inject({
      method: "POST",
      url: `${api}/rt/warga/${NOHP_ZAHRA}/undangan`,
    });
    expect(tanpaSesi.statusCode).toBe(401);

    const tanpaCsrf = await app.inject({
      method: "POST",
      url: `${api}/rt/warga/${NOHP_ZAHRA}/undangan`,
      cookies: sesiRt(),
    });
    expect(tanpaCsrf.statusCode).toBe(401);
    expect(isi(tanpaCsrf).error?.message).toMatch(/CSRF/);

    // sesi warga tidak boleh menembus rute RT (pakai cookie CSRF miliknya sendiri)
    const loginWarga = await app.inject({
      method: "POST",
      url: `${api}/auth/warga/login`,
      payload: { noHp: NOHP_MAYA, password: SANDI_BARU },
    });
    const sidWarga = cookieDari(loginWarga, "sid")!;
    const csrfWarga = cookieDari(loginWarga, "csrf_token")!;
    const wargaKeRt = await app.inject({
      method: "POST",
      url: `${api}/rt/warga/${NOHP_ZAHRA}/undangan`,
      cookies: { sid: sidWarga, csrf_token: csrfWarga },
      headers: { "x-csrf-token": csrfWarga },
    });
    expect(wargaKeRt.statusCode).toBe(401);

    // warga RT05 tidak terlihat dari sesi RT04 (scope §4.6)
    const wargaRt05 = (
      await dalamScopePlat((c) => c.query("SELECT no_hp FROM warga WHERE rt_id = $1 LIMIT 1", [idRt05]))
    ).rows as Array<{ no_hp: string }>;
    expect(wargaRt05.length).toBeGreaterThan(0);
    const lintas = await app.inject({
      method: "POST",
      url: `${api}/rt/warga/${wargaRt05[0]!.no_hp}/undangan`,
      cookies: sesiRt(),
      headers: { "x-csrf-token": csrfRt },
    });
    expect(lintas.statusCode).toBe(404);

    // warga sudah aktif → 409 CONFLICT (tidak ada token baru)
    const aktif = await app.inject({
      method: "POST",
      url: `${api}/rt/warga/${NOHP_BAMBANG}/undangan`,
      cookies: sesiRt(),
      headers: { "x-csrf-token": csrfRt },
    });
    expect(aktif.statusCode).toBe(409);
    expect(isi(aktif).error?.code).toBe("CONFLICT");
  });

  it("token lewat 24 jam → 410 TOKEN_EXPIRED pada GET & POST (§14.1)", async () => {
    const terbit = await terbitkan(NOHP_ZAHRA);
    expect(terbit.statusCode).toBe(200);
    const d = isi(terbit).data;
    await dalamScopePlat((c) =>
      c.query("UPDATE token_undangan SET kedaluwarsa_pada = now() - interval '1 hour' WHERE id = $1", [d.id]),
    );

    const get = await app.inject({ method: "GET", url: `${api}/auth/warga/undangan/${d.token}` });
    expect(get.statusCode).toBe(410);
    expect(isi(get).error?.code).toBe("TOKEN_EXPIRED");

    const post = await app.inject({
      method: "POST",
      url: `${api}/auth/warga/undangan/${d.token}/aktivasi`,
      payload: { password: SANDI_BARU, konfirmasiPassword: SANDI_BARU, consent: true },
    });
    expect(post.statusCode).toBe(410);
    expect(isi(post).error?.code).toBe("TOKEN_EXPIRED");
    expect(
      await hitung(
        { level: "rt", id: idRt04 },
        "SELECT count(*)::int AS n FROM warga WHERE no_hp = $1 AND status_akses = 'aktif'",
        [NOHP_ZAHRA],
      ),
    ).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// B3/B5/B6 · akses & keamanan akun warga (Portal RT + Portal Warga):
//   B3 · GET /auth/warga/riwayat-login — wajibWarga, terbaru dulu, cap 20,
//        penanda sesi berjalan, tanpa kebocoran token apa pun.
//   B5 · POST /rt/undangan/:id/kirim-ulang, DELETE /rt/undangan/:id, dan
//        PATCH /rt/warga/:id/akses (cabut sesi + audit + idempoten).
//   B6 · setiap percobaan aktivasi tercatat; perangkat berbeda → notifikasi
//        `notifikasi_job` + kotak masuk GET /rt/undangan/inspeksi.
//
// Urutan tes berantai & sengaja saling memakai hasil tes sebelumnya; kondisi
// awal 3 warga yang diutak-atik dipulihkan di afterAll agar tes F-3/B sesudah
// ini tetap melihat dunia seperti seed.
// ---------------------------------------------------------------------------

describe("B3/B5/B6 · akses & keamanan akun warga", () => {
  const NOHP_BAMBANG = "081234567890";
  const NOHP_SITI = "081234567891";
  const NOHP_HENDRA = "081234567892";
  const NOHP_GANTI = "081290000101"; // no. HP pengganti uji — dipastikan belum terpakai
  const NOMOR_UJI = [NOHP_BAMBANG, NOHP_SITI, NOHP_HENDRA];
  const UUID_ASING = "00000000-0000-4000-8000-000000000000";

  let app: FastifyInstance;
  let api = "/api/v1";
  let sidRt = "";
  let csrfRt = "";
  let idBambang = "";
  let idSiti = "";
  let idHendra = "";
  /** Token Siti terbit di tes kirim-ulang, dipakai ulang oleh tes sesudahnya. */
  let tokenSiti = "";

  /** Kondisi awal warga yang diutak-atik — dipulihkan di afterAll. */
  const asalWarga = new Map<string, { status_akses: string; no_hp: string | null }>();

  const sesiRt = () => ({ sid: sidRt, csrf_token: csrfRt });
  const csrfRtHeader = () => ({ "x-csrf-token": csrfRt });

  const auditRt = (aksi: string) =>
    hitung({ level: "rt", id: idRt04 }, "SELECT count(*)::int AS n FROM audit_log WHERE aksi = $1", [aksi]);

  const statusWarga = async (id: string): Promise<string> => {
    const r = await dalamScopePlat((c) => c.query("SELECT status_akses FROM warga WHERE id = $1", [id]));
    return (r.rows[0] as { status_akses: string } | undefined)?.status_akses ?? "";
  };

  const statusToken = async (id: string): Promise<string> => {
    const r = await dalamScopePlat((c) => c.query("SELECT status FROM token_undangan WHERE id = $1", [id]));
    return (r.rows[0] as { status: string } | undefined)?.status ?? "";
  };

  const terbitkan = (kunci: string) =>
    app.inject({
      method: "POST",
      url: `${api}/rt/warga/${kunci}/undangan`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
    });

  const kirimUlang = (tokenId: string, body?: Record<string, unknown>) =>
    app.inject({
      method: "POST",
      url: `${api}/rt/undangan/${tokenId}/kirim-ulang`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
      ...(body ? { payload: body } : {}),
    });

  const cabut = (tokenId: string) =>
    app.inject({ method: "DELETE", url: `${api}/rt/undangan/${tokenId}`, cookies: sesiRt(), headers: csrfRtHeader() });

  const ubahAkses = (wargaId: string, body: Record<string, unknown>, cookies = sesiRt(), header = csrfRtHeader()) =>
    app.inject({
      method: "PATCH",
      url: `${api}/rt/warga/${wargaId}/akses`,
      cookies,
      headers: header,
      payload: body,
    });

  beforeAll(async () => {
    app = await bukaAplikasiUji();
    api = apiUji;

    const rt = await app.inject({
      method: "POST",
      url: `${api}/auth/pengurus/login`,
      payload: { email: "rt04@siwarga.id", password: "rahasia123" },
    });
    expect(rt.statusCode, "login RT04 untuk uji akses warga").toBe(200);
    sidRt = cookieDari(rt, "sid")!;
    csrfRt = cookieDari(rt, "csrf_token")!;

    // rekam id + kondisi awal ketiga warga sebelum diutak-atik
    for (const noHp of NOMOR_UJI) {
      const r = await dalamScopePlat((c) =>
        c.query("SELECT id, no_hp, status_akses FROM warga WHERE rt_id = $1 AND no_hp = $2", [idRt04, noHp]),
      );
      const b = r.rows[0] as { id: string; no_hp: string; status_akses: string } | undefined;
      expect(b, `warga ${noHp} harus dibuat seed`).toBeTruthy();
      asalWarga.set(b!.id, { status_akses: b!.status_akses, no_hp: b!.no_hp });
      if (noHp === NOHP_BAMBANG) idBambang = b!.id;
      if (noHp === NOHP_SITI) idSiti = b!.id;
      if (noHp === NOHP_HENDRA) idHendra = b!.id;
    }
    expect(idBambang && idSiti && idHendra, "ketiga id warga uji terkumpul").toBeTruthy();
  }, 60_000);

  afterAll(async () => {
    // pulihkan status akses + no. HP seperti semula (diurut id, bukan no. HP,
    // karena tes kirim-ulang sempat mengganti nomor Siti)
    for (const [id, asal] of asalWarga) {
      await dalamScopePlat((c) =>
        c.query("UPDATE warga SET status_akses = $2, no_hp = $3 WHERE id = $1", [id, asal.status_akses, asal.no_hp]),
      );
    }
    // baris sesi sintetis buangan tes ini
    await dalamScopePlat((c) =>
      c.query("DELETE FROM sesi_login WHERE info_perangkat IN ('uji-akses', 'uji-riwayat')"),
    );
    await tutupAplikasiUji();
  });

  it("guard B5/B6: tanpa sesi / sesi warga / mutasi tanpa CSRF → ditolak semua rute", async () => {
    // tanpa sesi sama sekali → preHandler CSRF menjawab 401 UNAUTHORIZED
    const tanpaSesi = await app.inject({
      method: "POST",
      url: `${api}/rt/undangan/${UUID_ASING}/kirim-ulang`,
    });
    expect(tanpaSesi.statusCode).toBe(401);
    expect(isi(tanpaSesi).error?.code).toBe("UNAUTHORIZED");

    // sesi warga sah (lengkap dengan cookie CSRF-nya sendiri) tak menembus /rt/**
    const loginWarga = await app.inject({
      method: "POST",
      url: `${api}/auth/warga/login`,
      payload: { noHp: NOHP_BAMBANG, password: SANDI_WARGA_UJI },
    });
    expect(loginWarga.statusCode, "login warga untuk uji guard").toBe(200);
    const sidWarga = cookieDari(loginWarga, "sid")!;
    const csrfWarga = cookieDari(loginWarga, "csrf_token")!;
    const sesiWarga = { sid: sidWarga, csrf_token: csrfWarga };
    const headerWarga = { "x-csrf-token": csrfWarga };

    for (const res of [
      await app.inject({
        method: "POST",
        url: `${api}/rt/undangan/${UUID_ASING}/kirim-ulang`,
        cookies: sesiWarga,
        headers: headerWarga,
      }),
      await app.inject({ method: "DELETE", url: `${api}/rt/undangan/${UUID_ASING}`, cookies: sesiWarga, headers: headerWarga }),
      await ubahAkses(UUID_ASING, { status_akses: "dinonaktifkan" }, sesiWarga, headerWarga),
      await app.inject({ method: "GET", url: `${api}/rt/undangan/inspeksi`, cookies: sesiWarga }),
    ]) {
      expect(res.statusCode, "sesi warga ditolak rute RT").toBe(401);
      expect(isi(res).error?.code).toBe("UNAUTHORIZED");
    }

    // sesi RT sah tetapi tanpa header CSRF → mutasi tetap ditolak
    const tanpaCsrf = await app.inject({
      method: "DELETE",
      url: `${api}/rt/undangan/${UUID_ASING}`,
      cookies: { sid: sidRt },
    });
    expect(tanpaCsrf.statusCode).toBe(401);
    expect(isi(tanpaCsrf).error?.message).toMatch(/CSRF/);

    const aksesTanpaCsrf = await app.inject({
      method: "PATCH",
      url: `${api}/rt/warga/${UUID_ASING}/akses`,
      cookies: { sid: sidRt },
      payload: { status_akses: "dinonaktifkan" },
    });
    expect(aksesTanpaCsrf.statusCode).toBe(401);
    expect(isi(aksesTanpaCsrf).error?.message).toMatch(/CSRF/);

    // inspeksi adalah GET (tanpa CSRF) tetapi tetap butuh sesi pengurus
    const inspeksiTanpaSesi = await app.inject({ method: "GET", url: `${api}/rt/undangan/inspeksi` });
    expect(inspeksiTanpaSesi.statusCode).toBe(401);
    expect(isi(inspeksiTanpaSesi).error?.code).toBe("UNAUTHORIZED");
  });

  it("B5 kirim-ulang: token lama dicabut, token baru terbit, no. HP diperbarui, audit tercatat", async () => {
    const sebelumAudit = await auditRt("kirim_ulang_undangan");

    // terbitkan undangan awal untuk Siti (seed: belum_diundang)
    const terbit = await terbitkan(idSiti);
    expect(terbit.statusCode, "terbit undangan Siti").toBe(200);
    const t1 = isi(terbit).data;
    expect(t1.token).toMatch(/^[0-9a-f-]{36}\.[A-Z0-9]{10}$/);
    expect(await statusWarga(idSiti)).toBe("menunggu_aktivasi");

    // (a) tanpa noHpBaru → token lama dicabut, token BARU dengan kode segar terbit
    const ulang1 = await kirimUlang(t1.id);
    expect(ulang1.statusCode).toBe(200);
    const u1 = isi(ulang1).data;
    expect(u1.id, "id token selalu baru").not.toBe(t1.id);
    expect(u1.token).toMatch(/^[0-9a-f-]{36}\.[A-Z0-9]{10}$/);
    expect(u1.nama).toBeTruthy();
    expect(u1.alamat).toBeTruthy();
    expect(u1.dikirimOleh).toBeTruthy();
    expect(u1.noWa).toBe(NOHP_SITI);
    expect(u1.berlakuSampai).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(await statusToken(t1.id)).toBe("dicabut");
    expect(await statusToken(u1.id)).toBe("menunggu");
    expect(await statusWarga(idSiti)).toBe("menunggu_aktivasi");
    expect(await auditRt("kirim_ulang_undangan")).toBe(sebelumAudit + 1);

    // (b) dengan noHpBaru → nomor warga diperbarui + jejak audit sebelum/sesudah
    expect(
      await hitung(PLATFORM, "SELECT count(*)::int AS n FROM warga WHERE no_hp = $1", [NOHP_GANTI]),
      `${NOHP_GANTI} harus belum dipakai warga mana pun`,
    ).toBe(0);

    const ulang2 = await kirimUlang(u1.id, { noHpBaru: NOHP_GANTI });
    expect(ulang2.statusCode).toBe(200);
    const u2 = isi(ulang2).data;
    expect(u2.id).not.toBe(u1.id);
    expect(u2.noWa).toBe(NOHP_GANTI);
    expect(await statusToken(u1.id)).toBe("dicabut");
    expect(
      await hitung(PLATFORM, "SELECT count(*)::int AS n FROM warga WHERE id = $1 AND no_hp = $2", [idSiti, NOHP_GANTI]),
    ).toBe(1);
    expect(await auditRt("kirim_ulang_undangan")).toBe(sebelumAudit + 2);
    const jejak = await dalamScopePlat((c) =>
      c.query(
        "SELECT sebelum, sesudah FROM audit_log WHERE aksi = 'kirim_ulang_undangan' AND entitas_id = $1 AND sebelum IS NOT NULL LIMIT 1",
        [u2.id],
      ),
    );
    expect(jejak.rows.length, "audit perubahan no. HP punya jejak sebelum/sesudah").toBe(1);
    const jejakBaris = jejak.rows[0] as { sebelum: { noHp?: string }; sesudah: { noHp?: string } };
    expect(jejakBaris.sebelum.noHp).toBe(NOHP_SITI);
    expect(jejakBaris.sesudah.noHp).toBe(NOHP_GANTI);

    tokenSiti = u2.id; // dipakai tes konflik & inspeksi berikutnya
  });

  it("B5 kirim-ulang: no. HP salah → 400, id asing/lintas RT → 404, token terpakai / warga aktif → 409", async () => {
    const buruk = await kirimUlang(tokenSiti, { noHpBaru: "123" });
    expect(buruk.statusCode).toBe(400);
    expect(isi(buruk).error?.code).toBe("VALIDATION");

    const asing = await kirimUlang(UUID_ASING);
    expect(asing.statusCode).toBe(404);
    expect(isi(asing).error?.code).toBe("NOT_FOUND");

    // token milik RT lain → 404 (scope §4.6, keberadaan baris tak bocor)
    const tokenLain = await dalamScopePlat((c) =>
      c.query("SELECT id FROM token_undangan WHERE rt_id = $1 LIMIT 1", [idRt05]),
    );
    if (tokenLain.rows.length > 0) {
      const lintas = await kirimUlang((tokenLain.rows[0] as { id: string }).id);
      expect(lintas.statusCode).toBe(404);
    }

    // token sudah terpakai → 409 permanen (arahkan ke Nonaktifkan Akses).
    // CHECK `token_aktif_punya_dipakai_pada` menuntut dipakai_pada ikut terisi.
    await dalamScopePlat((c) =>
      c.query("UPDATE token_undangan SET status = 'aktif_dipakai', dipakai_pada = now() WHERE id = $1", [tokenSiti]),
    );
    const terpakai = await kirimUlang(tokenSiti);
    expect(terpakai.statusCode).toBe(409);
    expect(isi(terpakai).error?.code).toBe("CONFLICT");
    expect(isi(terpakai).error?.message).toMatch(/Nonaktifkan Akses/);
    await dalamScopePlat((c) =>
      c.query("UPDATE token_undangan SET status = 'menunggu', dipakai_pada = NULL WHERE id = $1", [tokenSiti]),
    );

    // warga sudah aktif → 409, tidak ada undangan baru yang terbit
    await dalamScopePlat((c) => c.query("UPDATE warga SET status_akses = 'aktif' WHERE id = $1", [idSiti]));
    const aktif = await kirimUlang(tokenSiti);
    expect(aktif.statusCode).toBe(409);
    expect(isi(aktif).error?.message).toMatch(/sudah aktif/);
    await dalamScopePlat((c) => c.query("UPDATE warga SET status_akses = 'menunggu_aktivasi' WHERE id = $1", [idSiti]));

    // pemulihan untuk tes sesudahnya
    expect(await statusToken(tokenSiti)).toBe("menunggu");
    expect(await statusWarga(idSiti)).toBe("menunggu_aktivasi");
  });

  it("B5 cabut undangan: {ulang:false} → idempoten {ulang:true}, warga kembali belum_diundang, 409/404", async () => {
    const terbit = await terbitkan(idHendra);
    expect(terbit.statusCode, "terbit undangan Hendra").toBe(200);
    const t = isi(terbit).data;
    expect(await statusWarga(idHendra)).toBe("menunggu_aktivasi");

    const sebelumAudit = await auditRt("cabut_undangan");
    const cabut1 = await cabut(t.id);
    expect(cabut1.statusCode).toBe(200);
    expect(isi(cabut1).data).toEqual({ id: t.id, ulang: false });
    expect(await statusToken(t.id)).toBe("dicabut");
    // tak ada token 'menunggu' tersisa → §6.3 mengembalikan warga
    expect(await statusWarga(idHendra)).toBe("belum_diundang");
    expect(await auditRt("cabut_undangan")).toBe(sebelumAudit + 1);

    // idempoten: baris yang sudah dicabut → {ulang:true} tanpa audit ganda
    const cabut2 = await cabut(t.id);
    expect(cabut2.statusCode).toBe(200);
    expect(isi(cabut2).data).toEqual({ id: t.id, ulang: true });
    expect(await auditRt("cabut_undangan")).toBe(sebelumAudit + 1);

    // token terpakai → 409 (irreversible; pakai Nonaktifkan Akses).
    // CHECK `token_aktif_punya_dipakai_pada` menuntut dipakai_pada ikut terisi.
    await dalamScopePlat((c) =>
      c.query("UPDATE token_undangan SET status = 'aktif_dipakai', dipakai_pada = now() WHERE id = $1", [t.id]),
    );
    const terpakai = await cabut(t.id);
    expect(terpakai.statusCode).toBe(409);
    expect(isi(terpakai).error?.code).toBe("CONFLICT");
    expect(isi(terpakai).error?.message).toMatch(/Nonaktifkan Akses/);
    await dalamScopePlat((c) =>
      c.query("UPDATE token_undangan SET status = 'dicabut', dipakai_pada = NULL WHERE id = $1", [t.id]),
    );

    // id asing → 404 tanpa membocorkan keberadaan baris
    const asing = await cabut(UUID_ASING);
    expect(asing.statusCode).toBe(404);
    expect(isi(asing).error?.code).toBe("NOT_FOUND");
  });

  it("B6: tiap percobaan aktivasi tercatat, perangkat beda → notifikasi + inspeksi 2 perangkat", async () => {
    // terbitkan undangan segar untuk Siti agar kode tokennya diketahui tes ini
    const terbit = await terbitkan(idSiti);
    expect(terbit.statusCode, "terbit undangan untuk uji percobaan").toBe(200);
    const t = isi(terbit).data as { id: string; token: string };
    expect(t.token).toMatch(/^[0-9a-f-]{36}\.[A-Z0-9]{10}$/);

    const urlAktivasi = `${api}/auth/warga/undangan/${t.token}/aktivasi`;

    // percobaan 1 — kata sandi terlalu pendek, perangkat A (body ditolak VALIDATION)
    const coba1 = await app.inject({
      method: "POST",
      url: urlAktivasi,
      headers: { "user-agent": "PerangkatUjiA/1.0" },
      payload: { password: "pendek", konfirmasiPassword: "pendek", consent: true },
    });
    expect(coba1.statusCode).toBe(400);
    expect(isi(coba1).error?.code).toBe("VALIDATION");

    // percobaan 2 — persetujuan tak dicentang, perangkat B
    const coba2 = await app.inject({
      method: "POST",
      url: urlAktivasi,
      headers: { "user-agent": "PerangkatUjiB/2.0" },
      payload: { password: "SandiPanjang2026", konfirmasiPassword: "SandiPanjang2026", consent: false },
    });
    expect(coba2.statusCode).toBe(400);
    expect(isi(coba2).error?.message).toMatch(/Persetujuan/);

    // keduanya meninggalkan tepat satu entri percobaan pada baris token
    const percobaan = await dalamScopePlat((c) =>
      c.query(
        `SELECT jsonb_array_length(percobaan_aktivasi) AS n,
                (SELECT count(DISTINCT e ->> 'deviceHash') FROM jsonb_array_elements(percobaan_aktivasi) e) AS perangkat,
                (SELECT count(*) FROM jsonb_array_elements(percobaan_aktivasi) e WHERE e ->> 'hasil' = 'gagal_validasi') AS validasi
         FROM token_undangan WHERE id = $1`,
        [t.id],
      ),
    );
    // `count()` = bigint → driver pg mengirimkannya sebagai string
    const p = percobaan.rows[0] as { n: number; perangkat: string; validasi: string };
    expect(p.n).toBeGreaterThanOrEqual(2);
    expect(Number(p.perangkat), "device_hash berbeda untuk user-agent berbeda").toBeGreaterThanOrEqual(2);
    expect(Number(p.validasi), "kedua percobaan ditandai gagal_validasi").toBe(p.n);

    // perangkat berbeda pada token sama → satu baris antrian notifikasi ke RT
    const kabar = await dalamScopePlat((c) =>
      c.query(
        "SELECT tujuan FROM notifikasi_job WHERE tipe = 'aktivasi' AND payload ->> 'temuan' = 'perangkat_berbeda' AND payload ->> 'tokenId' = $1",
        [t.id],
      ),
    );
    expect(kabar.rows.length, "notifikasi perangkat berbeda harus terantre").toBeGreaterThanOrEqual(1);
    expect((kabar.rows[0] as { tujuan: string }).tujuan).toMatch(/^0\d{9,13}$/);

    // kotak masuk inspeksi: token ini muncul dengan rincian tiap percobaan
    const inspeksi = await app.inject({ method: "GET", url: `${api}/rt/undangan/inspeksi`, cookies: sesiRt() });
    expect(inspeksi.statusCode).toBe(200);
    const daftar = isi(inspeksi).data.daftar as Array<{
      id: string;
      status: string;
      wargaId: string;
      nama: string;
      statusAkses: string;
      noHp: string;
      dibuatPada: string;
      berlakuSampai: string;
      dipakaiPada: string | null;
      jumlahPercobaan: number;
      jumlahPerangkat: number;
      percobaan: Array<{ waktu: string; deviceHash: string; ip: string | null; hasil: string | null }>;
    }>;
    const milik = daftar.find((d) => d.id === t.id);
    expect(milik, "token multi-perangkat wajib muncul di inspeksi").toBeTruthy();
    expect(milik!.jumlahPerangkat).toBe(2);
    expect(milik!.jumlahPercobaan).toBe(2);
    expect(milik!.percobaan).toHaveLength(2);
    expect(milik!.status).toBe("menunggu");
    expect(milik!.nama).toBeTruthy();
    expect(milik!.wargaId).toBe(idSiti);
    expect(milik!.noHp).toBeTruthy();
    expect(milik!.dibuatPada).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(milik!.berlakuSampai).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(milik!.dipakaiPada).toBeNull();
    for (const e of milik!.percobaan) {
      expect(e.deviceHash).toMatch(/^[0-9a-f]{64}$/);
      expect(e.hasil).toBe("gagal_validasi");
      expect(e.waktu).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
    // hanya token dengan >1 perangkat yang layak masuk daftar perhatian
    expect(daftar.every((d) => d.jumlahPerangkat > 1)).toBe(true);

    // isolasi tenant: RT05 tidak melihat token (atau warga mana pun) milik RT04
    const rt05 = await app.inject({
      method: "POST",
      url: `${api}/auth/pengurus/login`,
      payload: { email: "rt05@siwarga.id", password: "rahasia123" },
    });
    expect(rt05.statusCode, "login RT05").toBe(200);
    const inspeksi05 = await app.inject({
      method: "GET",
      url: `${api}/rt/undangan/inspeksi`,
      cookies: { sid: cookieDari(rt05, "sid")! },
    });
    expect(inspeksi05.statusCode).toBe(200);
    const id05 = (isi(inspeksi05).data.daftar as Array<{ id: string }>).map((d) => d.id);
    expect(id05).not.toContain(t.id);

    const tokenRt04 = await dalamScopePlat((c) =>
      c.query("SELECT id FROM token_undangan WHERE rt_id = $1", [idRt04]),
    );
    const setRt04 = new Set(tokenRt04.rows.map((r) => (r as { id: string }).id));
    for (const id of id05) expect(setRt04.has(id), `token ${id} bukan milik RT05`).toBe(false);
  });

  it("B5 ubah akses: cabut sesi saat Nonaktifkan, idempoten, 409 panduan, 404 lintas RT, 400 skema", async () => {
    // --- 400: nilai di luar enum & body kosong (kedua tulisan skema sama)
    const salah = await ubahAkses(idSiti, { status_akses: "hancur" });
    expect(salah.statusCode).toBe(400);
    expect(isi(salah).error?.code).toBe("VALIDATION");
    const kosong = await ubahAkses(idSiti, {});
    expect(kosong.statusCode).toBe(400);
    expect(isi(kosong).error?.message).toMatch(/status_akses/);

    // --- 404: warga RT lain tidak terlihat dari sesi RT04 (scope §4.6)
    const wargaLain = await dalamScopePlat((c) =>
      c.query("SELECT id FROM warga WHERE rt_id = $1 LIMIT 1", [idRt05]),
    );
    const lintas = await ubahAkses((wargaLain.rows[0] as { id: string }).id, { status_akses: "dinonaktifkan" });
    expect(lintas.statusCode).toBe(404);
    expect(isi(lintas).error?.code).toBe("NOT_FOUND");

    // --- 409: warga belum_diundang belum punya akses untuk dinonaktifkan
    const belum = await dalamScopePlat((c) =>
      c.query(
        "SELECT id FROM warga WHERE rt_id = $1 AND status_akses = 'belum_diundang' AND is_active = true LIMIT 1",
        [idRt04],
      ),
    );
    expect(belum.rows.length, "selalu ada warga belum_diundang di seed").toBeGreaterThan(0);
    const belumUndang = await ubahAkses((belum.rows[0] as { id: string }).id, { status_akses: "dinonaktifkan" });
    expect(belumUndang.statusCode).toBe(409);
    expect(isi(belumUndang).error?.message).toMatch(/belum pernah diundang/);

    // --- Nonaktifkan Siti (menunggu_aktivasi, BELUM punya kredensial)…
    const sebelumNonaktifSiti = await auditRt("nonaktifkan_akses");
    const nonaktifSiti = await ubahAkses(idSiti, { status_akses: "dinonaktifkan" });
    expect(nonaktifSiti.statusCode).toBe(200);
    expect(isi(nonaktifSiti).data).toMatchObject({ statusAkses: "dinonaktifkan", ubah: true, sesiDicabut: 0 });
    expect(await statusWarga(idSiti)).toBe("dinonaktifkan");
    expect(await auditRt("nonaktifkan_akses")).toBe(sebelumNonaktifSiti + 1);
    // data demografis TIDAK disentuh (§6.2): baris utuh, status demografis tetap
    expect(
      await hitung(
        PLATFORM,
        "SELECT count(*)::int AS n FROM warga WHERE id = $1 AND is_active = true AND status_demografis = 'aktif'",
        [idSiti],
      ),
    ).toBe(1);
    // undangan 'menunggu' ikut dicabut agar tautan lama tak bisa menghidupkan lagi
    expect(
      await hitung(
        PLATFORM,
        "SELECT count(*)::int AS n FROM token_undangan WHERE warga_id = $1 AND status = 'menunggu'",
        [idSiti],
      ),
    ).toBe(0);

    // …lalu Aktifkan DITOLAK: kata sandi harus dibuat pemilik akun (409 + panduan)
    const aktifTanpaKred = await ubahAkses(idSiti, { status_akses: "aktif" });
    expect(aktifTanpaKred.statusCode).toBe(409);
    expect(isi(aktifTanpaKred).error?.message).toMatch(/kredensial/);
    expect(await statusWarga(idSiti)).toBe("dinonaktifkan");

    // idempoten: status sudah sama → {ubah:false} tanpa audit ganda
    const ulangNonaktif = await ubahAkses(idSiti, { status_akses: "dinonaktifkan" });
    expect(ulangNonaktif.statusCode).toBe(200);
    expect(isi(ulangNonaktif).data).toMatchObject({ statusAkses: "dinonaktifkan", ubah: false });
    expect(await auditRt("nonaktifkan_akses")).toBe(sebelumNonaktifSiti + 1);

    // --- alur utama pada Bambang (punya kredensial + sesi login aktif)
    await dalamScopePlat((c) =>
      c.query(
        `INSERT INTO sesi_login (subjek_id, peran, token_hash, refresh_hash, kedaluwarsa_pada, terakhir_aktif, info_perangkat)
         VALUES ($1, 'warga', $2, $3, now() + interval '1 hour', now(), 'uji-akses')`,
        [idBambang, HASH_SID("sid-uji-akses-1"), "refresh-uji-akses-1"],
      ),
    );
    const sebelumNonaktif = await auditRt("nonaktifkan_akses");
    const nonaktif = await ubahAkses(idBambang, { status_akses: "dinonaktifkan" });
    expect(nonaktif.statusCode).toBe(200);
    expect(isi(nonaktif).data).toMatchObject({ statusAkses: "dinonaktifkan", ubah: true });
    expect(isi(nonaktif).data.sesiDicabut).toBeGreaterThanOrEqual(1);
    expect(
      await hitung(
        PLATFORM,
        "SELECT count(*)::int AS n FROM sesi_login WHERE token_hash = $1 AND dicabut_pada IS NOT NULL",
        [HASH_SID("sid-uji-akses-1")],
      ),
      "sesi sintetis warga ikut dicabut",
    ).toBe(1);
    expect(await auditRt("nonaktifkan_akses")).toBe(sebelumNonaktif + 1);

    const ulangBambang = await ubahAkses(idBambang, { status_akses: "dinonaktifkan" });
    expect(ulangBambang.statusCode).toBe(200);
    expect(isi(ulangBambang).data).toMatchObject({ ubah: false, sesiDicabut: 0 });
    expect(await auditRt("nonaktifkan_akses")).toBe(sebelumNonaktif + 1);

    // Aktifkan kembali: Bambang punya kredensial → 200 + audit tersendiri
    const sebelumAktif = await auditRt("aktifkan_akses");
    const aktifkan = await ubahAkses(idBambang, { status_akses: "aktif" });
    expect(aktifkan.statusCode).toBe(200);
    expect(isi(aktifkan).data).toMatchObject({ statusAkses: "aktif", ubah: true, sesiDicabut: 0 });
    expect(await statusWarga(idBambang)).toBe("aktif");
    expect(await auditRt("aktifkan_akses")).toBe(sebelumAktif + 1);
  });

  it("B3 riwayat-login: terbaru dulu, sesi ini ditandai, cap 20, tanpa bocoran token, guard warga", async () => {
    // guard: tanpa sesi & sesi pengurus → ditolak `wajibWarga`
    const tanpa = await app.inject({ method: "GET", url: `${api}/auth/warga/riwayat-login` });
    expect(tanpa.statusCode).toBe(401);
    expect(isi(tanpa).error?.code).toBe("UNAUTHORIZED");
    const sesiRtGet = await app.inject({
      method: "GET",
      url: `${api}/auth/warga/riwayat-login`,
      cookies: { sid: sidRt },
    });
    expect(sesiRtGet.statusCode).toBe(401);
    expect(isi(sesiRtGet).error?.code).toBe("UNAUTHORIZED");

    // login segar (tes Nonaktifkan sebelumnya sempat mencabut sesi lama)
    const login = await app.inject({
      method: "POST",
      url: `${api}/auth/warga/login`,
      payload: { noHp: NOHP_BAMBANG, password: SANDI_WARGA_UJI },
    });
    expect(login.statusCode, "login warga untuk uji riwayat").toBe(200);
    const sid = cookieDari(login, "sid")!;

    const res = await app.inject({ method: "GET", url: `${api}/auth/warga/riwayat-login`, cookies: { sid } });
    expect(res.statusCode).toBe(200);
    const daftar = isi(res).data.daftar as Array<{
      waktu: string;
      masukPada: string;
      berlakuSampai: string;
      perangkat: string | null;
      ip: string | null;
      kota: string | null;
      sesiIni: boolean;
      dicabut: boolean;
    }>;

    // daftar = milik warga peminta sendiri, maksimal 20 baris terbaru
    const jumlah = await hitung(
      PLATFORM,
      "SELECT count(*)::int AS n FROM sesi_login WHERE subjek_id = $1 AND peran = 'warga'",
      [idBambang],
    );
    expect(daftar.length).toBe(Math.min(jumlah, 20));

    // sesi berjalan ditandai tepat satu kali
    expect(daftar.filter((d) => d.sesiIni)).toHaveLength(1);

    // urut terbaru dulu (kolom `waktu` = terakhir_aktif)
    for (let i = 1; i < daftar.length; i++) {
      expect(new Date(daftar[i]!.waktu).getTime()).toBeLessThanOrEqual(new Date(daftar[i - 1]!.waktu).getTime());
    }

    // token sesi TIDAK pernah ikut terbaca — hanya SHA-256 tersimpan di DB
    const mentah = JSON.stringify(isi(res));
    expect(mentah).not.toContain(sid);
    expect(mentah).not.toContain("token_hash");
    expect(mentah).not.toContain("refresh_hash");

    // bentuk baris untuk kartu riwayat di FE (Kategori "Login")
    for (const d of daftar) {
      expect(d.waktu).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(d.masukPada).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(d.berlakuSampai).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(typeof d.sesiIni).toBe("boolean");
      expect(typeof d.dicabut).toBe("boolean");
    }

    // cap 20: 25 sesi sintetis terbaru → daftar tetap berhenti di 20 baris
    await dalamScopePlat((c) =>
      c.query(
        `INSERT INTO sesi_login (subjek_id, peran, token_hash, refresh_hash, kedaluwarsa_pada, terakhir_aktif, info_perangkat)
         SELECT $1, 'warga', 'sid-uji-riwayat-' || i, 'refresh-uji-riwayat-' || i,
                now() + interval '1 hour', now() + (i || ' minutes')::interval, 'uji-riwayat'
         FROM generate_series(1, 25) AS i`,
        [idBambang],
      ),
    );
    const penuh = await app.inject({ method: "GET", url: `${api}/auth/warga/riwayat-login`, cookies: { sid } });
    expect(penuh.statusCode).toBe(200);
    const daftar2 = isi(penuh).data.daftar as Array<{ perangkat: string | null }>;
    expect(daftar2, "riwayat dibatasi 20 baris terbaru").toHaveLength(20);
    expect(daftar2[0]!.perangkat, "baris sintetis terbaru menempati urutan paling atas").toBe("uji-riwayat");

    await dalamScopePlat((c) => c.query("DELETE FROM sesi_login WHERE info_perangkat = 'uji-riwayat'"));
  });
});

// ---------------------------------------------------------------------------
// F-3 · API iuran — alur vertikal yang menutup lapak:
// "setelah RT verifikasi, portal warga tidak berubah lunas".
//
// Urutan tes sengaja berantai (satu transaksi bisnis utuh):
//   tagihan → ajukan bukti → antrean RT → setujui (alokasi+kas) → warga Lunas
// ---------------------------------------------------------------------------

describe("F-3 · API iuran (Portal Warga + Portal RT)", () => {
  let app: FastifyInstance;
  let api = "/api/v1";
  let sidWarga = "";
  let sidRt = "";
  let csrfRt = "";
  let idBambang = "";
  let idPembayaran = "";
  let sisaOktober = 0;
  let sisaTotal = 0;

  const sesiWarga = () => ({ sid: sidWarga });
  const sesiRt = () => ({ sid: sidRt, csrf_token: csrfRt });
  const csrfRtHeader = () => ({ "x-csrf-token": csrfRt });

  beforeAll(async () => {
    app = await bukaAplikasiUji();
    api = apiUji;

    const warga = await app.inject({
      method: "POST",
      url: `${api}/auth/warga/login`,
      payload: { noHp: "081234567890", password: SANDI_WARGA_UJI },
    });
    expect(warga.statusCode, "login warga untuk uji iuran").toBe(200);
    sidWarga = cookieDari(warga, "sid")!;

    const rt = await app.inject({
      method: "POST",
      url: `${api}/auth/pengurus/login`,
      payload: { email: "rt04@siwarga.id", password: "rahasia123" },
    });
    expect(rt.statusCode, "login RT untuk uji iuran").toBe(200);
    sidRt = cookieDari(rt, "sid")!;
    csrfRt = cookieDari(rt, "csrf_token")!;

    const baris = await dalamScopePlat((c) => c.query("SELECT id FROM warga WHERE no_hp = '081234567890'"));
    idBambang = (baris.rows[0] as { id: string }).id;
    expect(idBambang).not.toBe("");
  }, 60_000);

  afterAll(async () => {
    await tutupAplikasiUji();
  });

  it("guard peran: tanpa sesi / sesi salah portal / mutasi tanpa CSRF → ditolak", async () => {
    const tanpaRt = await app.inject({ method: "GET", url: `${api}/rt/iuran/tagihan` });
    expect(tanpaRt.statusCode).toBe(401);
    expect(isi(tanpaRt).error?.code).toBe("UNAUTHORIZED");

    const wargaKeRt = await app.inject({
      method: "GET",
      url: `${api}/rt/iuran/pembayaran`,
      cookies: sesiWarga(),
    });
    expect(wargaKeRt.statusCode).toBe(401);
    expect(isi(wargaKeRt).error?.code).toBe("UNAUTHORIZED");

    const tanpaWarga = await app.inject({ method: "GET", url: `${api}/warga/iuran/tagihan` });
    expect(tanpaWarga.statusCode).toBe(401);

    // sesi RT sah tetapi tanpa `x-csrf-token` → mutasi finansial tetap ditolak
    const tanpaCsrf = await app.inject({
      method: "POST",
      url: `${api}/rt/iuran/pembayaran`,
      cookies: sesiRt(),
      payload: { wargaId: idBambang, nominal: 1000 },
    });
    expect(tanpaCsrf.statusCode).toBe(401);
    expect(isi(tanpaCsrf).error?.message).toMatch(/CSRF/);
  });

  it("GET /warga/iuran/tagihan → tagihan Oktober sendiri + status turunan + ringkas", async () => {
    const res = await app.inject({
      method: "GET",
      url: `${api}/warga/iuran/tagihan?periode=2026-10`,
      cookies: sesiWarga(),
    });
    expect(res.statusCode).toBe(200);
    const data = isi(res).data;

    expect(data.periode).toBe("2026-10");
    expect(data.tagihan.length).toBeGreaterThan(0);
    expect(data.ringkas.totalTagihan).toBeGreaterThan(0);
    expect(data.ringkas.totalSisa).toBeGreaterThan(0);
    // Seed memuat satu bukti Bambang berstatus menunggu_verifikasi (antrean RT)
    // → status turunan periode aktif = menunggu_verifikasi, bukan belum_bayar.
    expect(data.ringkas.status).toBe("menunggu_verifikasi");

    // isolasi: tidak ada satu pun tagihan milik warga lain yang ikut terbaca
    const milikLain = await dalamScopePlat((c) =>
      c.query("SELECT id FROM tagihan WHERE periode = '2026-10' AND warga_id <> $1", [idBambang]),
    );
    const setLain = new Set(milikLain.rows.map((r) => (r as { id: string }).id));
    for (const t of data.tagihan) expect(setLain.has(t.id), `tagihan ${t.id} bukan milik warga login`).toBe(false);

    sisaOktober = data.ringkas.totalSisa;

    // total sisa SELURUH periode → dasar nominal bukti yang diajukan pada uji berikut
    const sisa = await denganScope({ level: "rt", id: idRt04 }, (c) =>
      c.query("SELECT COALESCE(SUM(sisa), 0)::float AS n FROM tagihan WHERE warga_id = $1 AND sisa > 0", [idBambang]),
    );
    sisaTotal = Number((sisa.rows[0] as { n: number }).n);
    expect(sisaTotal).toBeGreaterThan(0);
  });

  it("POST /warga/iuran/bukti → menunggu_verifikasi; sisa tagihan BELUM berkurang", async () => {
    const res = await app.inject({
      method: "POST",
      url: `${api}/warga/iuran/bukti`,
      cookies: sesiWarga(),
      headers: { "idempotency-key": "uji-bukti-0001" },
      payload: { nominal: sisaTotal, metode: "transfer", catatan: "Transfer bank", buktiUrl: "TRF-2026-0001" },
    });
    expect(res.statusCode).toBe(200);
    const pembayaran = isi(res).data.pembayaran;
    expect(pembayaran.status).toBe("menunggu_verifikasi");
    expect(pembayaran.statusLabel).toBe("Menunggu Verifikasi");
    expect(pembayaran.nominal).toBeCloseTo(sisaTotal, 2);
    expect(isi(res).data.ulang).toBe(false);
    idPembayaran = pembayaran.id;

    const tagihan = await app.inject({
      method: "GET",
      url: `${api}/warga/iuran/tagihan?periode=2026-10`,
      cookies: sesiWarga(),
    });
    const d = isi(tagihan).data;
    // 1 bukti seed + bukti yang baru diajukan test ini
    expect(d.ringkas.menungguVerifikasi).toBe(2);
    expect(d.ringkas.status).toBe("menunggu_verifikasi");
    expect(d.ringkas.totalSisa).toBeCloseTo(sisaOktober, 2);
  });

  it("Idempotency-Key yang sama tidak menggandakan pengajuan", async () => {
    const res = await app.inject({
      method: "POST",
      url: `${api}/warga/iuran/bukti`,
      cookies: sesiWarga(),
      headers: { "idempotency-key": "uji-bukti-0001" },
      payload: { nominal: sisaTotal, metode: "transfer" },
    });
    expect(res.statusCode).toBe(200);
    expect(isi(res).data.ulang).toBe(true);
    expect(isi(res).data.pembayaran.id).toBe(idPembayaran);
    expect(
      await hitung(
        { level: "rt", id: idRt04 },
        "SELECT count(*)::int AS n FROM pembayaran WHERE idempotency_key = 'uji-bukti-0001'",
      ),
    ).toBe(1);
  });

  it("GET /rt/iuran/pembayaran?status=menunggu_verifikasi → antrean memuat nama + alamat warga", async () => {
    const res = await app.inject({
      method: "GET",
      url: `${api}/rt/iuran/pembayaran?status=menunggu_verifikasi`,
      cookies: sesiRt(),
    });
    expect(res.statusCode).toBe(200);
    const data = isi(res).data;
    const baris = data.pembayaran.find((p: { id: string }) => p.id === idPembayaran);
    expect(baris, "bukti warga harus muncul di antrean RT").toBeTruthy();
    expect(baris.nama).toBe("Bambang Supriyanto");
    expect(baris.alamat).not.toBe("");
    expect(data.ringkas.menunggu).toBeGreaterThanOrEqual(1);
  });

  it("pembayaran milik RT lain tidak terlihat: setujui → 404 NOT_FOUND", async () => {
    const wargaLain = await denganScope({ level: "rt", id: idRt05 }, (c) => c.query("SELECT id FROM warga LIMIT 1"));
    const idWargaLain = (wargaLain.rows[0] as { id: string }).id;
    const idLain = randomUUID();
    await denganScope({ level: "rt", id: idRt05 }, (c) =>
      c.query(
        `INSERT INTO pembayaran (id, rt_id, warga_id, tanggal, nominal, metode, status, sumber, diajukan_oleh, created_at)
         VALUES ($1, $2, $3, now(), 25000, 'tunai', 'menunggu_verifikasi', 'bendahara', 'bendahara', now())`,
        [idLain, idRt05, idWargaLain],
      ),
    );

    try {
      const res = await app.inject({
        method: "POST",
        url: `${api}/rt/iuran/pembayaran/${idLain}/setujui`,
        cookies: sesiRt(),
        headers: csrfRtHeader(),
      });
      expect(res.statusCode).toBe(404);
      expect(isi(res).error?.code).toBe("NOT_FOUND");

      const antrean = await app.inject({
        method: "GET",
        url: `${api}/rt/iuran/pembayaran?status=menunggu_verifikasi`,
        cookies: sesiRt(),
      });
      expect(isi(antrean).data.pembayaran.some((p: { id: string }) => p.id === idLain)).toBe(false);
    } finally {
      await denganScope({ level: "rt", id: idRt05 }, (c) =>
        c.query("DELETE FROM pembayaran WHERE id = $1", [idLain]),
      );
    }
  });

  it("setujui bukti → alokasi FIFO, tagihan ludes, kas otomatis, audit tercatat", async () => {
    const kasSebelum = await hitung({ level: "rt", id: idRt04 }, "SELECT count(*)::int AS n FROM kas_entry");

    const res = await app.inject({
      method: "POST",
      url: `${api}/rt/iuran/pembayaran/${idPembayaran}/setujui`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
      payload: { catatan: "Sesuai mutasi bank." },
    });
    expect(res.statusCode).toBe(200);
    const data = isi(res).data;

    expect(data.ulang).toBe(false);
    expect(data.pembayaran.status).toBe("lunas");
    expect(data.pembayaran.statusLabel).toBe("Lunas");
    expect(data.alokasi.length).toBeGreaterThan(0);
    expect(data.totalDialokasikan).toBeCloseTo(sisaTotal, 2);
    expect(data.kelebihanBayar).toBe(0);
    expect(data.kas.saldoSesudah).toBeGreaterThan(0);

    // FIFO: periode alokasi menaik & tetap menjangkau Oktober (inti alurnya)
    const periodeAlokasi: string[] = data.alokasi.map((a: { periode: string }) => a.periode);
    expect([...periodeAlokasi].sort()).toEqual(periodeAlokasi);
    expect(periodeAlokasi).toContain("2026-10");

    expect(
      await hitung(
        { level: "rt", id: idRt04 },
        "SELECT count(*)::int AS n FROM tagihan WHERE warga_id = $1 AND sisa > 0",
        [idBambang],
      ),
    ).toBe(0);
    expect(
      await hitung(
        { level: "rt", id: idRt04 },
        "SELECT count(*)::int AS n FROM kas_entry WHERE ref_id = $1 AND sumber = 'iuran_alokasi'",
        [idPembayaran],
      ),
    ).toBe(1);
    expect(await hitung({ level: "rt", id: idRt04 }, "SELECT count(*)::int AS n FROM kas_entry")).toBe(kasSebelum + 1);
    expect(
      await hitung(
        { level: "rt", id: idRt04 },
        "SELECT count(*)::int AS n FROM audit_log WHERE aksi = 'verifikasi_pembayaran' AND entitas_id = $1",
        [idPembayaran],
      ),
    ).toBe(1);
  });

  it("proses ulang setujui → idempoten (alokasi & kas tidak bertambah)", async () => {
    const alokasiSebelum = await hitung(
      { level: "rt", id: idRt04 },
      "SELECT count(*)::int AS n FROM alokasi_pembayaran WHERE pembayaran_id = $1",
      [idPembayaran],
    );
    const kasSebelum = await hitung(
      { level: "rt", id: idRt04 },
      "SELECT count(*)::int AS n FROM kas_entry WHERE ref_id = $1",
      [idPembayaran],
    );

    const res = await app.inject({
      method: "POST",
      url: `${api}/rt/iuran/pembayaran/${idPembayaran}/setujui`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
    });
    expect(res.statusCode).toBe(200);
    expect(isi(res).data.ulang).toBe(true);
    expect(isi(res).data.alokasi).toEqual([]);

    expect(
      await hitung(
        { level: "rt", id: idRt04 },
        "SELECT count(*)::int AS n FROM alokasi_pembayaran WHERE pembayaran_id = $1",
        [idPembayaran],
      ),
    ).toBe(alokasiSebelum);
    expect(
      await hitung({ level: "rt", id: idRt04 }, "SELECT count(*)::int AS n FROM kas_entry WHERE ref_id = $1", [
        idPembayaran,
      ]),
    ).toBe(kasSebelum);
  });

  it("REGRESI BUG — sesi warga melihat tagihan LUNAS setelah RT memverifikasi", async () => {
    const tagihan = await app.inject({
      method: "GET",
      url: `${api}/warga/iuran/tagihan?periode=2026-10`,
      cookies: sesiWarga(),
    });
    expect(tagihan.statusCode).toBe(200);
    const d = isi(tagihan).data;

    expect(d.ringkas.totalSisa).toBe(0);
    expect(d.ringkas.status).toBe("lunas");
    expect(d.ringkas.label).toBe("Lunas");
    // lunas menang atas menunggu; bukti seed Bambang masih mengantre (belum
    // diproses test ini) sehingga hitungannya 1, bukan 0.
    expect(d.ringkas.menungguVerifikasi).toBe(1);
    expect(d.ringkas.totalTerbayar).toBeCloseTo(sisaOktober, 2);
    expect(d.tagihan.every((t: { status: string }) => t.status === "lunas")).toBe(true);

    // riwayat lintas sesi: baris pembayaran tsb berstatus lunas + membawa alokasi
    const riwayat = await app.inject({
      method: "GET",
      url: `${api}/warga/iuran/riwayat`,
      cookies: sesiWarga(),
    });
    expect(riwayat.statusCode).toBe(200);
    const data = isi(riwayat).data;
    expect(data.riwayat.every((p: { wargaId: string }) => p.wargaId === idBambang)).toBe(true);
    const baris = data.riwayat.find((p: { id: string }) => p.id === idPembayaran);
    expect(baris.status).toBe("lunas");
    expect(baris.statusLabel).toBe("Lunas");
    expect(baris.alokasi.length).toBeGreaterThan(0);
    expect(baris.periode).toBeTruthy();
    expect(data.ringkas.totalLunas).toBeGreaterThan(0);
  });

  it("GET /rt/iuran/tagihan → satu baris per warga ber-tagihan + rekap + filter q", async () => {
    const res = await app.inject({
      method: "GET",
      url: `${api}/rt/iuran/tagihan?periode=2026-10`,
      cookies: sesiRt(),
    });
    expect(res.statusCode).toBe(200);
    const data = isi(res).data;

    expect(data.rows.length).toBeGreaterThan(0);
    expect(data.rekap.target).toBeGreaterThan(0);

    const bambang = data.rows.find((r: { wargaId: string }) => r.wargaId === idBambang);
    expect(bambang, "baris Bambang harus tampil di dashboard RT").toBeTruthy();
    expect(bambang.status).toBe("Lunas");
    expect(bambang.sisa).toBe(0);
    expect(bambang.perKategori.length).toBeGreaterThan(0);
    expect(bambang.tanggalBayar).toBeTruthy();

    // jumlah baris = jumlah warga ber-tagihan pada periode tsb (tanpa duplikat)
    const unik = await hitung(
      { level: "rt", id: idRt04 },
      "SELECT count(DISTINCT warga_id)::int AS n FROM tagihan WHERE periode = '2026-10'",
    );
    expect(data.rows.length).toBe(unik);

    const cari = await app.inject({
      method: "GET",
      url: `${api}/rt/iuran/tagihan?periode=2026-10&q=Bambang`,
      cookies: sesiRt(),
    });
    const rows = isi(cari).data.rows;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r: { nama: string }) => /bambang/i.test(r.nama))).toBe(true);
  });

  it("GET /rt/iuran/kategori → daftar kategori RT (kolom tabel FE)", async () => {
    const res = await app.inject({ method: "GET", url: `${api}/rt/iuran/kategori`, cookies: sesiRt() });
    expect(res.statusCode).toBe(200);
    const kategori = isi(res).data.kategori;
    expect(kategori.length).toBe(4);
    expect(kategori.every((k: { id: string; nama: string; tipeTarif: string }) => k.id && k.nama && k.tipeTarif)).toBe(
      true,
    );
    // tipe persis kamus FE: flat | per_unit | insidental
    expect(kategori.map((k: { tipeTarif: string }) => k.tipeTarif).sort()).toEqual([
      "flat",
      "flat",
      "flat",
      "per_unit",
    ]);
  });

  it("tolak bukti → ditolak tanpa alokasi & tanpa kas; tagihan warga tak berubah", async () => {
    const buat = await app.inject({
      method: "POST",
      url: `${api}/warga/iuran/bukti`,
      cookies: sesiWarga(),
      payload: { nominal: 1000, catatan: "Salah nominal" },
    });
    expect(buat.statusCode).toBe(200);
    const id2 = isi(buat).data.pembayaran.id as string;

    const res = await app.inject({
      method: "POST",
      url: `${api}/rt/iuran/pembayaran/${id2}/tolak`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
      payload: { alasan: "Nominal tidak sesuai tagihan." },
    });
    expect(res.statusCode).toBe(200);
    expect(isi(res).data.pembayaran.status).toBe("ditolak");
    expect(isi(res).data.statusLabel).toBe("Ditolak");

    expect(
      await hitung(PLATFORM, "SELECT count(*)::int AS n FROM alokasi_pembayaran WHERE pembayaran_id = $1", [id2]),
    ).toBe(0);
    expect(await hitung(PLATFORM, "SELECT count(*)::int AS n FROM kas_entry WHERE ref_id = $1", [id2])).toBe(0);
    expect(
      await hitung(
        { level: "rt", id: idRt04 },
        "SELECT count(*)::int AS n FROM audit_log WHERE aksi = 'tolak_pembayaran' AND entitas_id = $1",
        [id2],
      ),
    ).toBe(1);
    expect(
      await hitung(
        { level: "rt", id: idRt04 },
        "SELECT count(*)::int AS n FROM tagihan WHERE warga_id = $1 AND sisa > 0",
        [idBambang],
      ),
    ).toBe(0);
  });

  it("catat pembayaran bendahara → langsung lunas + alokasi FIFO + kas otomatis", async () => {
    const ahmad = await dalamScopePlat((c) => c.query("SELECT id FROM warga WHERE no_hp = '081234567894'"));
    const idAhmad = (ahmad.rows[0] as { id: string }).id;
    const sisaAhmad = await denganScope({ level: "rt", id: idRt04 }, (c) =>
      c.query("SELECT COALESCE(SUM(sisa), 0)::float AS n FROM tagihan WHERE warga_id = $1 AND sisa > 0", [idAhmad]),
    );
    expect(Number((sisaAhmad.rows[0] as { n: number }).n), "warga uji harus punya tagihan terbuka").toBeGreaterThan(0);

    const res = await app.inject({
      method: "POST",
      url: `${api}/rt/iuran/pembayaran`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
      payload: { wargaId: idAhmad, nominal: 50000, metode: "tunai", catatan: "Bayar tunai di pos ronda" },
    });
    expect(res.statusCode).toBe(200);
    const data = isi(res).data;

    expect(data.pembayaran.status).toBe("lunas");
    expect(data.pembayaran.sumber).toBe("bendahara");
    expect(data.pembayaran.diajukanOleh).toBe("bendahara");
    expect(data.alokasi.length).toBeGreaterThan(0);
    expect(data.kas.saldoSesudah).toBeGreaterThan(0);
    expect(data.tagihan.length).toBeGreaterThan(0);
    expect(
      await hitung(
        { level: "rt", id: idRt04 },
        "SELECT count(*)::int AS n FROM audit_log WHERE aksi = 'catat_pembayaran' AND entitas_id = $1",
        [data.pembayaran.id],
      ),
    ).toBe(1);
  });
});

describe("F-4 · API kas append-only (Portal RT)", () => {
  let app: FastifyInstance;
  let api = "/api/v1";
  let sidRt = "";
  let csrfRt = "";
  let sidWarga = "";
  let idEntriUji = "";
  let saldoSebelum = 0;

  const sesiRt = () => ({ sid: sidRt, csrf_token: csrfRt });
  const csrfRtHeader = () => ({ "x-csrf-token": csrfRt });

  beforeAll(async () => {
    app = await bukaAplikasiUji();
    api = apiUji;

    const rt = await app.inject({
      method: "POST",
      url: `${api}/auth/pengurus/login`,
      payload: { email: "rt04@siwarga.id", password: "rahasia123" },
    });
    expect(rt.statusCode, "login RT untuk uji kas").toBe(200);
    sidRt = cookieDari(rt, "sid")!;
    csrfRt = cookieDari(rt, "csrf_token")!;

    const warga = await app.inject({
      method: "POST",
      url: `${api}/auth/warga/login`,
      payload: { noHp: "081234567890", password: SANDI_WARGA_UJI },
    });
    expect(warga.statusCode, "login warga untuk uji guard kas").toBe(200);
    sidWarga = cookieDari(warga, "sid")!;
  }, 60_000);

  afterAll(async () => {
    await tutupAplikasiUji();
  });

  it("guard: tanpa sesi / sesi warga / mutasi tanpa CSRF → ditolak", async () => {
    const tanpaSesi = await app.inject({ method: "GET", url: `${api}/rt/kas` });
    expect(tanpaSesi.statusCode).toBe(401);
    expect(isi(tanpaSesi).error?.code).toBe("UNAUTHORIZED");

    const wargaKeRt = await app.inject({
      method: "GET",
      url: `${api}/rt/kas`,
      cookies: { sid: sidWarga },
    });
    expect(wargaKeRt.statusCode).toBe(401);

    const tanpaCsrf = await app.inject({
      method: "POST",
      url: `${api}/rt/kas`,
      cookies: sesiRt(),
      payload: { tipe: "masuk", kategori: "lainnya", keterangan: "Tanpa CSRF", nominal: 1000 },
    });
    expect(tanpaCsrf.statusCode).toBe(401);
    expect(isi(tanpaCsrf).error?.message).toMatch(/CSRF/);
  });

  it("GET /rt/kas → buku kas + ringkas; rantai saldo utuh dari nol (B8)", async () => {
    const res = await app.inject({ method: "GET", url: `${api}/rt/kas`, cookies: sesiRt() });
    expect(res.statusCode).toBe(200);
    const data = isi(res).data;

    expect(data.entri.length).toBeGreaterThan(0);
    let jalan = 0;
    for (const e of data.entri as Array<{ arah: string; nominal: number; saldoSesudah: number }>) {
      jalan = Math.round((jalan + (e.arah === "positif" ? e.nominal : -e.nominal)) * 100) / 100;
      expect(e.saldoSesudah, `rantai entri ${e.arah}`).toBeCloseTo(jalan, 2);
    }
    expect(data.ringkas.saldoKini).toBeCloseTo(jalan, 2);
    expect(data.ringkas.jumlahEntri).toBe((data.entri as unknown[]).length);
    expect(data.ringkas.totalMasuk - data.ringkas.totalKeluar).toBeCloseTo(jalan, 2);

    // entri kas OTOMATIS dari verifikasi alokasi iuran (B8) ikut terbaca di buku kas
    expect(
      (data.entri as Array<{ sumber: string }>).some((e) => e.sumber === "iuran_alokasi"),
    ).toBe(true);

    saldoSebelum = data.ringkas.saldoKini;
  });

  it("POST /rt/kas → entri manual masuk, rantai saldo diperpanjang, audit tercatat", async () => {
    const res = await app.inject({
      method: "POST",
      url: `${api}/rt/kas`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
      payload: {
        tanggal: "2026-10-25",
        tipe: "masuk",
        kategori: "pemasukan_lain",
        keterangan: "Sumbangan warga taman",
        nominal: 250000,
      },
    });
    expect(res.statusCode, JSON.stringify(isi(res).error ?? {})).toBe(200);
    const entri = isi(res).data.entri;

    expect(entri.tipe).toBe("masuk");
    expect(entri.arah).toBe("positif");
    expect(entri.sumber).toBe("manual");
    expect(entri.saldoSesudah).toBeCloseTo(saldoSebelum + 250000, 2);
    idEntriUji = entri.id;

    expect(
      await hitung(
        { level: "rt", id: idRt04 },
        "SELECT count(*)::int AS n FROM audit_log WHERE aksi = 'catat_kas' AND entitas_id = $1",
        [entri.id],
      ),
    ).toBe(1);

    const ulang = await app.inject({ method: "GET", url: `${api}/rt/kas`, cookies: sesiRt() });
    const buku = isi(ulang).data;
    expect(buku.ringkas.saldoKini).toBeCloseTo(saldoSebelum + 250000, 2);
    const ekor = (buku.entri as Array<{ saldoSesudah: number }>)[
      (buku.entri as unknown[]).length - 1
    ];
    expect(ekor.saldoSesudah).toBeCloseTo(saldoSebelum + 250000, 2);
  });

  it("POST /rt/kas → validasi nominal/keterangan ditolak (VALIDATION)", async () => {
    const nol = await app.inject({
      method: "POST",
      url: `${api}/rt/kas`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
      payload: { tipe: "keluar", kategori: "operasional", keterangan: "Nol", nominal: -5 },
    });
    expect(nol.statusCode).toBe(400);
    expect(isi(nol).error?.code).toBe("VALIDATION");

    const kosong = await app.inject({
      method: "POST",
      url: `${api}/rt/kas`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
      payload: { tipe: "masuk", kategori: "lainnya", keterangan: "   ", nominal: 1000 },
    });
    expect(kosong.statusCode).toBe(400);
    expect(isi(kosong).error?.code).toBe("VALIDATION");
  });

  it("POST /rt/kas/:id/pembalik → koreksi tanpa menyentuh baris asal; dobel-balik → CONFLICT", async () => {
    const res = await app.inject({
      method: "POST",
      url: `${api}/rt/kas/${idEntriUji}/pembalik`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
      payload: { alasan: "Salah catat — sumbangan tercatat ganda" },
    });
    expect(res.statusCode, JSON.stringify(isi(res).error ?? {})).toBe(200);
    const { asal, pembalik } = isi(res).data;

    // baris asal TIDAK berubah (append-only): keterangan & rantai tetap sama
    expect(asal.keterangan).toBe("Sumbangan warga taman");
    expect(asal.saldoSesudah).toBeCloseTo(saldoSebelum + 250000, 2);
    expect(pembalik.tipe).toBe("pembalik");
    expect(pembalik.arah).toBe("negatif");
    expect(pembalik.reversalOfId).toBe(idEntriUji);
    expect(pembalik.saldoSesudah).toBeCloseTo(saldoSebelum, 2);

    const db = await denganScope({ level: "rt", id: idRt04 }, (c) =>
      c.query(
        "SELECT keterangan, saldo_sesudah::float AS saldo FROM kas_entry WHERE id = $1",
        [idEntriUji],
      ),
    );
    const baris = db.rows[0] as { keterangan: string; saldo: number };
    expect(baris.keterangan).toBe("Sumbangan warga taman");
    expect(baris.saldo).toBeCloseTo(saldoSebelum + 250000, 2);

    // koreksi ganda ditolak: baris yang sama hanya boleh dibalik sekali
    const dobel = await app.inject({
      method: "POST",
      url: `${api}/rt/kas/${idEntriUji}/pembalik`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
      payload: { alasan: "Koreksi kedua" },
    });
    expect(dobel.statusCode).toBe(409);
    expect(isi(dobel).error?.code).toBe("CONFLICT");

    // baris pembalik juga tidak boleh dibalik
    const balikPembalik = await app.inject({
      method: "POST",
      url: `${api}/rt/kas/${pembalik.id}/pembalik`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
      payload: { alasan: "Balik pembalik" },
    });
    expect(balikPembalik.statusCode).toBe(409);
    expect(isi(balikPembalik).error?.code).toBe("CONFLICT");

    expect(
      await hitung(
        { level: "rt", id: idRt04 },
        "SELECT count(*)::int AS n FROM audit_log WHERE aksi = 'koreksi_kas'",
      ),
    ).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// F-6 · Data keluarga portal warga — baca KK ter-mask + simpan kontak langsung.
// Deviasi terdokumentasi §5.3 atas jalur ajuan B11 (lihat routes/wargaKeluarga.ts).
// ---------------------------------------------------------------------------
describe("F-6 · data keluarga portal warga (GET KK + simpan kontak)", () => {
  let app: FastifyInstance;
  let api = "/api/v1";
  let sid = "";
  let sidRt = "";
  let idDiri = "";
  let idSiti = "";
  let idLuarKk = "";

  const ambilId = async (sql: string, params: unknown[]): Promise<string> => {
    const r = await denganScope(PLATFORM, (c) => c.query(sql, params));
    return String((r.rows[0] as { id: string }).id);
  };

  beforeAll(async () => {
    app = await bukaAplikasiUji();
    api = apiUji;

    const w = await app.inject({
      method: "POST",
      url: `${api}/auth/warga/login`,
      payload: { noHp: "081234567890", password: SANDI_WARGA_UJI },
    });
    expect(w.statusCode, "login Bambang (kepala KK)").toBe(200);
    sid = cookieDari(w, "sid")!;

    const rt = await app.inject({
      method: "POST",
      url: `${api}/auth/pengurus/login`,
      payload: { email: "rt04@siwarga.id", password: "rahasia123" },
    });
    expect(rt.statusCode, "login RT untuk uji guard").toBe(200);
    sidRt = cookieDari(rt, "sid")!;

    const kepala = await app.inject({ method: "GET", url: `${api}/warga/keluarga`, cookies: { sid } });
    expect(kepala.statusCode, "GET keluarga untuk kumpul id").toBe(200);
    const data = isi(kepala).data as { anggota: { id: string; hubungan: string; nama: string }[] };
    idDiri = data.anggota.find((a) => a.hubungan === "kepala")?.id ?? "";
    idSiti = data.anggota.find((a) => a.nama === "Siti Nurhaliza")?.id ?? "";
    expect(idDiri, "kepala KK ditemukan").not.toBe("");
    expect(idSiti, "istri ditemukan").not.toBe("");

    // Target lintas-KK: warga RT yang sama di luar KK sesi (Hendra dsb.)
    idLuarKk = await ambilId(
      `SELECT id FROM warga
        WHERE rt_id = (SELECT rt_id FROM warga WHERE id = $1)
          AND kk_id <> (SELECT kk_id FROM warga WHERE id = $1)
        LIMIT 1`,
      [idDiri],
    );
    expect(idLuarKk, "ada warga lain KK di RT04 (seed)").not.toBe("");
  }, 60_000);

  afterAll(async () => {
    await tutupAplikasiUji();
  });

  it("guard: tanpa sesi / sesi RT → 401; GET sukses = KK ter-mask, urut, tanpa NIK plaintext", async () => {
    const tanpa = await app.inject({ method: "GET", url: `${api}/warga/keluarga` });
    expect(tanpa.statusCode).toBe(401);
    expect(isi(tanpa).error?.code).toBe("UNAUTHORIZED");

    const sesiRt = await app.inject({
      method: "GET",
      url: `${api}/warga/keluarga`,
      cookies: { sid: sidRt },
    });
    expect(sesiRt.statusCode, "sesi RT tidak boleh membaca rute warga").toBe(401);

    const ok = await app.inject({ method: "GET", url: `${api}/warga/keluarga`, cookies: { sid } });
    expect(ok.statusCode).toBe(200);
    const data = isi(ok).data as {
      kk: { noKk: string; kepala: string; alamat: string; jumlahAnggota: number };
      anggota: {
        nama: string;
        hubungan: string;
        nikMasked: string | null;
        noHp: string | null;
        statusAkses: string;
      }[];
    };
    expect(data.kk.noKk).toBe("3171-xxxx-xxxx-0002");
    expect(data.kk.kepala).toBe("Bambang Supriyanto");
    expect(data.kk.alamat).toBe("Jl. Melati Blok B No. 12");
    expect(data.kk.jumlahAnggota).toBe(4);
    expect(data.anggota.map((a) => a.hubungan)).toEqual(["kepala", "istri", "anak", "anak"]);
    expect(data.anggota[1].nama).toBe("Siti Nurhaliza");
    expect(data.anggota[0].noHp).toBe("081234567890");
    expect(data.anggota[0].statusAkses).toBe("aktif");
    // NIK TIDAK PERNAH plaintext (§14/B17): tiap baris ter-mask + nol 16-digit
    // berurutan di seluruh payload (No.KK pun sudah ter-mask).
    for (const a of data.anggota) expect(a.nikMasked ?? "").toMatch(/x{4}/);
    expect(JSON.stringify(data)).not.toMatch(/\b\d{16}\b/);
  });

  it("simpan kontak: normalisasi no. HP, nama tak tersentuh (whitelist), audit ber-diff", async () => {
    const simpan = await app.inject({
      method: "POST",
      url: `${api}/warga/keluarga/${idSiti}/kontak`,
      cookies: { sid },
      payload: {
        noHp: "6281299988877", // 13 digit "62…" → disimpan "081299988877"
        email: "", // "" → dibersihkan (null)
        pekerjaan: "Ibu Rumah Tangga",
        agama: "Islam",
        golDarah: "A",
        statusKawin: "Menikah",
        nama: "HACKED", // di luar whitelist → di-strip zod
      },
    });
    expect(simpan.statusCode).toBe(200);
    const balas = isi(simpan).data as { anggota: { noHp: string | null; email: string | null; nama: string } };
    expect(balas.anggota.noHp).toBe("081299988877");
    expect(balas.anggota.nama).toBe("Siti Nurhaliza");

    expect(
      await hitung(
        PLATFORM,
        `SELECT count(*)::int AS n FROM warga
          WHERE id = $1 AND no_hp = '081299988877' AND email IS NULL
            AND nama = 'Siti Nurhaliza' AND pekerjaan = 'Ibu Rumah Tangga'`,
        [idSiti],
      ),
      "baris DB tersimpan persis seperti yang diminta (tanpa nama)",
    ).toBe(1);

    expect(
      await hitung(
        { level: "rt", id: idRt04 },
        `SELECT count(*)::int AS n FROM audit_log
          WHERE aksi = 'perbarui_kontak' AND entitas = 'warga'
            AND entitas_id = $1 AND actor_id = $2 AND portal = 'warga'
            AND sesudah IS NOT NULL AND sebelum IS NOT NULL`,
        [idSiti, idDiri],
      ),
      "satu baris audit ber-diff oleh warga login",
    ).toBe(1);
  });

  it("lintas-KK: ID warga lain di RT sama → NOT_FOUND 404 & baris tak tersentuh", async () => {
    const asing = await app.inject({
      method: "POST",
      url: `${api}/warga/keluarga/${idLuarKk}/kontak`,
      cookies: { sid },
      payload: { pekerjaan: "BOCOR" },
    });
    expect(asing.statusCode).toBe(404);
    expect(isi(asing).error?.code).toBe("NOT_FOUND");
    expect(
      await hitung(
        PLATFORM,
        "SELECT count(*)::int AS n FROM warga WHERE id = $1 AND (pekerjaan IS NULL OR pekerjaan <> 'BOCOR')",
        [idLuarKk],
      ),
    ).toBe(1);
  });

  it("payload tak sah (bukan enum gol/status, no. HP rusak, ID salah, body kosong) → VALIDATION 400", async () => {
    const rusak = await app.inject({
      method: "POST",
      url: `${api}/warga/keluarga/${idSiti}/kontak`,
      cookies: { sid },
      payload: { golDarah: "O (Rhesus +)", statusKawin: "Janda", noHp: "abc" },
    });
    expect(rusak.statusCode).toBe(400);
    expect(isi(rusak).error?.code).toBe("VALIDATION");

    const bukanUuid = await app.inject({
      method: "POST",
      url: `${api}/warga/keluarga/bukan-uuid/kontak`,
      cookies: { sid },
      payload: { pekerjaan: "X" },
    });
    expect(bukanUuid.statusCode).toBe(400);
    expect(isi(bukanUuid).error?.code).toBe("VALIDATION");

    const kosong = await app.inject({
      method: "POST",
      url: `${api}/warga/keluarga/${idSiti}/kontak`,
      cookies: { sid },
      payload: {},
    });
    expect(kosong.statusCode).toBe(400);
    expect(isi(kosong).error?.code).toBe("VALIDATION");

    // dua galat validasi tidak pernah menghasilkan audit
    expect(
      await hitung(
        { level: "rt", id: idRt04 },
        "SELECT count(*)::int AS n FROM audit_log WHERE aksi = 'perbarui_kontak'",
      ),
    ).toBe(1);
  });

  it("no. HP kepala keluarga (unik per RT) → CONFLICT 409, bukan 500", async () => {
    const bentrok = await app.inject({
      method: "POST",
      url: `${api}/warga/keluarga/${idSiti}/kontak`,
      cookies: { sid },
      payload: { noHp: "081234567890" },
    });
    expect(bentrok.statusCode).toBe(409);
    expect(isi(bentrok).error?.code).toBe("CONFLICT");

    expect(
      await hitung(
        PLATFORM,
        "SELECT count(*)::int AS n FROM warga WHERE id = $1 AND no_hp = '081299988877'",
        [idSiti],
      ),
      "no. HP Siti tidak berubah setelah bentrok",
    ).toBe(1);
  });
});

describe("F-6 · ajuan perubahan data warga (B11 antrean · B20 verifikasi)", () => {
  let app: FastifyInstance;
  let api = "/api/v1";
  let sid = "";
  let sidRt = "";
  let csrfRt = "";
  let idDiri = "";
  let idSiti = "";
  let idLuarKk = "";
  /** Ajuan 1 (tambah_anggota) → akan DISETUJUI; ajuan 2 (perubahan_kk) → DITOLAK. */
  let idAjuan = "";
  let idAjuan2 = "";

  const ambilId = async (sql: string, params: unknown[]): Promise<string> => {
    const r = await denganScope(PLATFORM, (c) => c.query(sql, params));
    return String((r.rows[0] as { id: string }).id);
  };

  const payloadAjuan = (jenis: string, keterangan: string) => ({
    targetWargaId: idSiti,
    jenis,
    namaAnggota: "Siti Nurhaliza",
    keterangan,
  });

  beforeAll(async () => {
    app = await bukaAplikasiUji();
    api = apiUji;

    const w = await app.inject({
      method: "POST",
      url: `${api}/auth/warga/login`,
      payload: { noHp: "081234567890", password: SANDI_WARGA_UJI },
    });
    expect(w.statusCode, "login Bambang").toBe(200);
    sid = cookieDari(w, "sid")!;

    const rt = await app.inject({
      method: "POST",
      url: `${api}/auth/pengurus/login`,
      payload: { email: "rt04@siwarga.id", password: "rahasia123" },
    });
    expect(rt.statusCode, "login RT04").toBe(200);
    sidRt = cookieDari(rt, "sid")!;
    csrfRt = cookieDari(rt, "csrf_token")!;

    const kepala = await app.inject({ method: "GET", url: `${api}/warga/keluarga`, cookies: { sid } });
    expect(kepala.statusCode).toBe(200);
    const data = isi(kepala).data as { anggota: { id: string; hubungan: string; nama: string }[] };
    idDiri = data.anggota.find((a) => a.hubungan === "kepala")?.id ?? "";
    idSiti = data.anggota.find((a) => a.nama === "Siti Nurhaliza")?.id ?? "";
    expect(idDiri, "kepala KK ditemukan").not.toBe("");
    expect(idSiti, "istri ditemukan").not.toBe("");

    idLuarKk = await ambilId(
      `SELECT id FROM warga
        WHERE rt_id = (SELECT rt_id FROM warga WHERE id = $1)
          AND kk_id <> (SELECT kk_id FROM warga WHERE id = $1)
        LIMIT 1`,
      [idDiri],
    );
    expect(idLuarKk, "ada warga lain KK di RT04 (seed)").not.toBe("");
  }, 60_000);

  afterAll(async () => {
    await tutupAplikasiUji();
  });

  it("guard: tanpa sesi / sesi RT → 401; payload ajuan tak sah → VALIDATION 400", async () => {
    const tanpa = await app.inject({
      method: "POST",
      url: `${api}/warga/keluarga/ajuan`,
      payload: payloadAjuan("tambah_anggota", "Akta kelahiran dari RS Melati — siap dijelaskan saat rapat warga."),
    });
    expect(tanpa.statusCode).toBe(401);
    expect(isi(tanpa).error?.code).toBe("UNAUTHORIZED");

    const sesiRt = await app.inject({
      method: "POST",
      url: `${api}/warga/keluarga/ajuan`,
      cookies: { sid: sidRt },
      payload: payloadAjuan("tambah_anggota", "Akta kelahiran dari RS Melati — siap dijelaskan saat rapat warga."),
    });
    expect(sesiRt.statusCode, "sesi RT tidak boleh mengajukan lewat rute warga").toBe(401);

    const jenisAsing = await app.inject({
      method: "POST",
      url: `${api}/warga/keluarga/ajuan`,
      cookies: { sid },
      payload: payloadAjuan("hantu", "Keterangan yang cukup panjang untuk lolos panjang minimum ajuan."),
    });
    expect(jenisAsing.statusCode).toBe(400);
    expect(isi(jenisAsing).error?.code).toBe("VALIDATION");

    const keteranganPendek = await app.inject({
      method: "POST",
      url: `${api}/warga/keluarga/ajuan`,
      cookies: { sid },
      payload: payloadAjuan("kontak", "pendek"),
    });
    expect(keteranganPendek.statusCode).toBe(400);

    const kosong = await app.inject({ method: "POST", url: `${api}/warga/keluarga/ajuan`, cookies: { sid }, payload: {} });
    expect(kosong.statusCode).toBe(400);

    expect(
      await hitung(
        { level: "rt", id: idRt04 },
        "SELECT count(*)::int AS n FROM audit_log WHERE aksi = 'ajukan_perubahan'",
      ),
      "galat validasi tidak pernah menghasilkan audit",
    ).toBe(0);
  });

  it("lintas-KK: target di luar KK sesi → NOT_FOUND 404 & tak ada baris ajuan", async () => {
    const asing = await app.inject({
      method: "POST",
      url: `${api}/warga/keluarga/ajuan`,
      cookies: { sid },
      payload: {
        targetWargaId: idLuarKk,
        jenis: "tambah_anggota",
        namaAnggota: "Warga Asing",
        keterangan: "Permohonan tambah anggota yang seharusnya ditolak karena beda Kartu Keluarga.",
      },
    });
    expect(asing.statusCode).toBe(404);
    expect(isi(asing).error?.code).toBe("NOT_FOUND");
    expect(
      await hitung(
        PLATFORM,
        "SELECT count(*)::int AS n FROM perubahan_data_warga WHERE rt_id = $1 AND warga_id = $2",
        [idRt04, idLuarKk],
      ),
    ).toBe(0);
  });

  it("POST ajuan sukses → menunggu + audit; GET keluarga memuat daftar ajuan (tanpa NIK plaintext)", async () => {
    const ok = await app.inject({
      method: "POST",
      url: `${api}/warga/keluarga/ajuan`,
      cookies: { sid },
      payload: payloadAjuan(
        "tambah_anggota",
        "Akta kelahiran dari RS Melati — siap dijelaskan saat rapat warga.",
      ),
    });
    expect(ok.statusCode).toBe(200);
    const balas = isi(ok).data as { ajuan: { id: string; status: string; jenis: string; namaAnggota: string | null } };
    expect(balas.ajuan.status).toBe("menunggu");
    expect(balas.ajuan.jenis).toBe("tambah_anggota");
    expect(balas.ajuan.namaAnggota).toBe("Siti Nurhaliza");
    idAjuan = balas.ajuan.id;

    expect(
      await hitung(
        PLATFORM,
        `SELECT count(*)::int AS n FROM perubahan_data_warga
          WHERE id = $1 AND status = 'menunggu' AND pengaju = 'warga'
            AND payload_sesudah->>'namaAnggota' = 'Siti Nurhaliza'`,
        [idAjuan],
      ),
      "baris ajuan tersimpan dengan payload sesudah",
    ).toBe(1);

    expect(
      await hitung(
        { level: "rt", id: idRt04 },
        `SELECT count(*)::int AS n FROM audit_log
          WHERE aksi = 'ajukan_perubahan' AND entitas = 'perubahan_data_warga'
            AND entitas_id = $1 AND actor_id = $2 AND portal = 'warga'`,
        [idAjuan, idDiri],
      ),
      "satu baris audit oleh warga login",
    ).toBe(1);

    const g = await app.inject({ method: "GET", url: `${api}/warga/keluarga`, cookies: { sid } });
    expect(g.statusCode).toBe(200);
    const isiG = isi(g).data as {
      ajuan: { id: string; status: string; keterangan: string | null; catatanVerifikasi: string | null }[];
    };
    const baris = isiG.ajuan.find((a) => a.id === idAjuan);
    expect(baris, "ajuan tampil di panel Status Pengajuan").toBeTruthy();
    expect(baris!.status).toBe("menunggu");
    expect(baris!.keterangan).toMatch(/Akta kelahiran/);
    expect(JSON.stringify(isiG.ajuan)).not.toMatch(/\b\d{16}\b/);
  });

  it("ajuan sejenis masih menunggu → CONFLICT 409; jenis lain tetap boleh", async () => {
    const dobel = await app.inject({
      method: "POST",
      url: `${api}/warga/keluarga/ajuan`,
      cookies: { sid },
      payload: payloadAjuan("tambah_anggota", "Pengajuan ganda yang harus ditolak server — antrean sejenis penuh."),
    });
    expect(dobel.statusCode).toBe(409);
    expect(isi(dobel).error?.code).toBe("CONFLICT");

    const kedua = await app.inject({
      method: "POST",
      url: `${api}/warga/keluarga/ajuan`,
      cookies: { sid },
      payload: payloadAjuan(
        "perubahan_kk",
        "Koreksi penulisan alamat sesuai surat pindah dari Disdukcapil.",
      ),
    });
    expect(kedua.statusCode, "jenis berbeda tetap diterima").toBe(200);
    idAjuan2 = (isi(kedua).data as { ajuan: { id: string } }).ajuan.id;
    expect(idAjuan2).not.toBe("");
  });

  it("antrean RT: filter status (valid & tak sah) + isi baris (subjek, alamat, pengaju)", async () => {
    const wargaKeRt = await app.inject({ method: "GET", url: `${api}/rt/ajuan-perubahan`, cookies: { sid } });
    expect(wargaKeRt.statusCode, "sesi warga tidak boleh membaca antrean RT").toBe(401);

    const menunggu = await app.inject({
      method: "GET",
      url: `${api}/rt/ajuan-perubahan?status=menunggu`,
      cookies: { sid: sidRt },
    });
    expect(menunggu.statusCode).toBe(200);
    const list = isi(menunggu).data as {
      ajuan: {
        id: string;
        status: string;
        namaWarga: string;
        alamat: string;
        pengajuNama: string | null;
        keterangan: string | null;
      }[];
    };
    const baris = list.ajuan.find((a) => a.id === idAjuan);
    expect(baris, "ajuan RT04 terlihat di antrean RT04").toBeTruthy();
    expect(baris!.namaWarga).toBe("Siti Nurhaliza");
    expect(baris!.alamat).toBe("Jl. Melati Blok B No. 12");
    expect(baris!.pengajuNama).toBe("Bambang Supriyanto");
    expect(list.ajuan.every((a) => a.status === "menunggu")).toBe(true);

    const belumDiproses = await app.inject({
      method: "GET",
      url: `${api}/rt/ajuan-perubahan?status=disetujui`,
      cookies: { sid: sidRt },
    });
    expect(
      (isi(belumDiproses).data as { ajuan: { id: string }[] }).ajuan.some((a) => a.id === idAjuan),
      "ajuan menunggu tidak muncul di filter disetujui",
    ).toBe(false);

    const bogus = await app.inject({
      method: "GET",
      url: `${api}/rt/ajuan-perubahan?status=bogus`,
      cookies: { sid: sidRt },
    });
    expect(bogus.statusCode).toBe(400);
    expect(isi(bogus).error?.code).toBe("VALIDATION");
  });

  it("setujui: tanpa CSRF → 401; sukses → disetujui + audit + tersinkron ke warga; ulang → ulang:true", async () => {
    const tanpaCsrf = await app.inject({
      method: "POST",
      url: `${api}/rt/ajuan-perubahan/${idAjuan}/setujui`,
      cookies: { sid: sidRt },
      payload: { catatan: "Tanpa token CSRF." },
    });
    expect(tanpaCsrf.statusCode).toBe(401);
    expect(isi(tanpaCsrf).error?.message).toMatch(/CSRF/);

    const ok = await app.inject({
      method: "POST",
      url: `${api}/rt/ajuan-perubahan/${idAjuan}/setujui`,
      cookies: { sid: sidRt, csrf_token: csrfRt },
      headers: { "x-csrf-token": csrfRt },
      payload: { catatan: "Akta kelahiran sesuai — dokumen DKB diperbarui." },
    });
    expect(ok.statusCode).toBe(200);
    const balas = isi(ok).data as { ulang: boolean; ajuan: { status: string; catatanVerifikasi: string | null } };
    expect(balas.ulang).toBe(false);
    expect(balas.ajuan.status).toBe("disetujui");
    expect(balas.ajuan.catatanVerifikasi).toBe("Akta kelahiran sesuai — dokumen DKB diperbarui.");

    const ulang = await app.inject({
      method: "POST",
      url: `${api}/rt/ajuan-perubahan/${idAjuan}/setujui`,
      cookies: { sid: sidRt, csrf_token: csrfRt },
      headers: { "x-csrf-token": csrfRt },
      payload: {},
    });
    expect(ulang.statusCode, "verifikasi ulang idempoten").toBe(200);
    expect((isi(ulang).data as { ulang: boolean }).ulang).toBe(true);

    expect(
      await hitung(
        { level: "rt", id: idRt04 },
        `SELECT count(*)::int AS n FROM audit_log
          WHERE aksi = 'setujui_ajuan' AND entitas = 'perubahan_data_warga' AND entitas_id = $1`,
        [idAjuan],
      ),
      "tepat satu audit setujui (ulang tidak menggandakan)",
    ).toBe(1);

    // Sinkron ke warga (B20): status + catatan terbaca di portal yang sama.
    const g = await app.inject({ method: "GET", url: `${api}/warga/keluarga`, cookies: { sid } });
    const baris = (isi(g).data as { ajuan: { id: string; status: string; catatanVerifikasi: string | null }[] }).ajuan.find(
      (a) => a.id === idAjuan,
    );
    expect(baris?.status).toBe("disetujui");
    expect(baris?.catatanVerifikasi).toBe("Akta kelahiran sesuai — dokumen DKB diperbarui.");

    // Filter antrean ikut bergeser: tak lagi "menunggu", masuk "disetujui".
    const menunggu = await app.inject({
      method: "GET",
      url: `${api}/rt/ajuan-perubahan?status=menunggu`,
      cookies: { sid: sidRt },
    });
    expect(
      (isi(menunggu).data as { ajuan: { id: string }[] }).ajuan.some((a) => a.id === idAjuan),
    ).toBe(false);
    const disetujui = await app.inject({
      method: "GET",
      url: `${api}/rt/ajuan-perubahan?status=disetujui`,
      cookies: { sid: sidRt },
    });
    expect(
      (isi(disetujui).data as { ajuan: { id: string }[] }).ajuan.some((a) => a.id === idAjuan),
    ).toBe(true);
  });

  it("tolak: catatan wajib → VALIDATION; setelah disetujui → 409; sukses → ditolak + tersinkron", async () => {
    const tanpaCatatan = await app.inject({
      method: "POST",
      url: `${api}/rt/ajuan-perubahan/${idAjuan2}/tolak`,
      cookies: { sid: sidRt, csrf_token: csrfRt },
      headers: { "x-csrf-token": csrfRt },
      payload: {},
    });
    expect(tanpaCatatan.statusCode).toBe(400);
    expect(isi(tanpaCatatan).error?.code).toBe("VALIDATION");

    const salahSudah = await app.inject({
      method: "POST",
      url: `${api}/rt/ajuan-perubahan/${idAjuan}/tolak`,
      cookies: { sid: sidRt, csrf_token: csrfRt },
      headers: { "x-csrf-token": csrfRt },
      payload: { catatan: "Tidak bisa menolak ajuan yang sudah disetujui." },
    });
    expect(salahSudah.statusCode).toBe(409);
    expect(isi(salahSudah).error?.code).toBe("CONFLICT");

    const ok = await app.inject({
      method: "POST",
      url: `${api}/rt/ajuan-perubahan/${idAjuan2}/tolak`,
      cookies: { sid: sidRt, csrf_token: csrfRt },
      headers: { "x-csrf-token": csrfRt },
      payload: { catatan: "Surat pindah asli belum dilampirkan — ajukan ulang lengkapi berkas." },
    });
    expect(ok.statusCode).toBe(200);
    expect((isi(ok).data as { ajuan: { status: string } }).ajuan.status).toBe("ditolak");

    expect(
      await hitung(
        { level: "rt", id: idRt04 },
        `SELECT count(*)::int AS n FROM audit_log
          WHERE aksi = 'tolak_ajuan' AND entitas = 'perubahan_data_warga' AND entitas_id = $1`,
        [idAjuan2],
      ),
    ).toBe(1);

    const g = await app.inject({ method: "GET", url: `${api}/warga/keluarga`, cookies: { sid } });
    const baris = (isi(g).data as { ajuan: { id: string; status: string; catatanVerifikasi: string | null }[] }).ajuan.find(
      (a) => a.id === idAjuan2,
    );
    expect(baris?.status).toBe("ditolak");
    expect(baris?.catatanVerifikasi).toMatch(/surat pindah asli/i);
  });
});

describe("B13 · CRUD Data Warga Portal RT (/rt/warga · §5.4)", () => {
  let app: FastifyInstance;
  let api = "/api/v1";
  let sidRt = "";
  let csrfRt = "";
  let sidRt05 = "";
  let csrfRt05 = "";
  let sidWarga = "";
  let idDimas = "";
  let idWargaRt05 = "";
  /** Hasil POST sukses — dipakai tes PATCH/DELETE lanjutan (urut berjalan). */
  let idKKBaru = "";
  let idUji = "";
  let idRina = "";

  const sesiRt = () => ({ sid: sidRt, csrf_token: csrfRt });
  const csrfRtHeader = () => ({ "x-csrf-token": csrfRt });

  /** ID aman: "" bila tak ada baris (bukan exception). */
  const ambilId = async (sql: string, params: unknown[]): Promise<string> => {
    const r = await denganScope(PLATFORM, (c) => c.query(sql, params));
    return r.rows[0] ? String((r.rows[0] as { id: string }).id) : "";
  };

  const payloadBaru = (lebih: Record<string, unknown> = {}) => ({
    noKk: "3171050101050077",
    alamat: "Jl. Melati Blok B No. 12", // = alamat rumah seed → link rumah best-effort
    anggota: [
      {
        nama: "Uji Cahaya Lestari",
        nik: "3171050101850001",
        hubungan: "kepala",
        jenisKelamin: "perempuan",
        agama: "Islam",
        tanggalLahir: "1985-04-10",
        pekerjaan: "Guru",
        noHp: "081299000111",
      },
      {
        nama: "Rina Handayani",
        nik: "3171050101870002",
        hubungan: "istri",
        jenisKelamin: "perempuan",
        agama: "Islam",
        tanggalLahir: "1987-12-05",
        pekerjaan: "Bidan",
        noHp: null,
      },
    ],
    ...lebih,
  });

  beforeAll(async () => {
    app = await bukaAplikasiUji();
    api = apiUji;

    const rt = await app.inject({
      method: "POST",
      url: `${api}/auth/pengurus/login`,
      payload: { email: "rt04@siwarga.id", password: "rahasia123" },
    });
    expect(rt.statusCode, "login RT04").toBe(200);
    sidRt = cookieDari(rt, "sid")!;
    csrfRt = cookieDari(rt, "csrf_token")!;

    const rt05 = await app.inject({
      method: "POST",
      url: `${api}/auth/pengurus/login`,
      payload: { email: "rt05@siwarga.id", password: "rahasia123" },
    });
    expect(rt05.statusCode, "login RT05").toBe(200);
    sidRt05 = cookieDari(rt05, "sid")!;
    csrfRt05 = cookieDari(rt05, "csrf_token")!;

    const w = await app.inject({
      method: "POST",
      url: `${api}/auth/warga/login`,
      payload: { noHp: "081234567890", password: SANDI_WARGA_UJI },
    });
    expect(w.statusCode, "login warga").toBe(200);
    sidWarga = cookieDari(w, "sid")!;

    const g = await app.inject({ method: "GET", url: `${api}/rt/warga`, cookies: { sid: sidRt } });
    expect(g.statusCode, "GET /rt/warga untuk kumpul id").toBe(200);
    const data = isi(g).data as { warga: { id: string; nama: string }[] };
    idDimas = data.warga.find((x) => x.nama === "Dimas Prasetyo")?.id ?? "";
    expect(idDimas, "Dimas Prasetyo ada di RT04 (seed)").not.toBe("");

    idWargaRt05 = await ambilId("SELECT id FROM warga WHERE rt_id <> $1 LIMIT 1", [idRt04]);
    expect(idWargaRt05, "RT luar RT04 punya warga uji").not.toBe("");
  }, 60_000);

  afterAll(async () => {
    await tutupAplikasiUji();
  });

  it("guard baca: tanpa sesi / sesi warga → 401; GET = baris + keluarga ter-mask tanpa NIK plaintext; scope RT05 terjaga", async () => {
    const tanpa = await app.inject({ method: "GET", url: `${api}/rt/warga` });
    expect(tanpa.statusCode).toBe(401);
    expect(isi(tanpa).error?.code).toBe("UNAUTHORIZED");

    const warga = await app.inject({ method: "GET", url: `${api}/rt/warga`, cookies: { sid: sidWarga } });
    expect(warga.statusCode, "sesi warga tidak boleh baca rute RT").toBe(401);

    const ok = await app.inject({ method: "GET", url: `${api}/rt/warga`, cookies: { sid: sidRt } });
    expect(ok.statusCode).toBe(200);
    const data = isi(ok).data as {
      warga: {
        id: string;
        nama: string;
        nikMasked: string | null;
        statusKawin: string | null;
        tanggalLahir: string | null;
        kk: { noKk: string; alamat: string };
      }[];
      keluarga: {
        kk: { id: string; noKk: string; kepala: string; jumlahAnggota: number };
        anggota: Record<string, unknown>[];
      }[];
    };
    expect(data.warga.length, "9 warga seed RT04").toBeGreaterThanOrEqual(9);
    expect(data.keluarga.length).toBeGreaterThanOrEqual(1);

    const dimas = data.warga.find((x) => x.nama === "Dimas Prasetyo")!;
    expect(dimas.nikMasked ?? "").toMatch(/x{4}/);
    expect(dimas.statusKawin, "status nikah Dimas = ground truth DB").toBe("Belum Menikah");
    expect(dimas.tanggalLahir).toBe("2013-11-02");
    expect(dimas.kk.noKk).toBe("3171-xxxx-xxxx-0002");

    const kkBambang = data.keluarga.find((k) => k.kk.noKk === "3171-xxxx-xxxx-0002");
    expect(kkBambang, "KK Bambang terbaca lewat rute RT").toBeTruthy();
    expect(kkBambang!.kk.kepala).toBe("Bambang Supriyanto");
    expect(kkBambang!.kk.jumlahAnggota).toBe(4);
    // 4 kolom detail ikut terpilih — form Edit tidak lagi kosong (bug F-6)
    for (const kunci of ["tempatLahir", "pendidikan", "tanggalPerkawinan", "wargaNegara"]) {
      expect(kkBambang!.anggota[0], `anggota memuat ${kunci}`).toHaveProperty(kunci);
    }
    // §14/B17: nol nilai 16-digit plaintext di seluruh payload
    expect(JSON.stringify(data)).not.toMatch(/\b\d{16}\b/);

    const r05 = await app.inject({ method: "GET", url: `${api}/rt/warga`, cookies: { sid: sidRt05 } });
    expect(r05.statusCode).toBe(200);
    const data05 = isi(r05).data as { warga: { id: string; nama: string }[] };
    expect(data05.warga.length, "RT05 punya warganya sendiri").toBeGreaterThanOrEqual(1);
    expect(data05.warga.some((x) => x.id === idDimas), "warga RT04 tak terlihat RT05").toBe(false);
    expect(data05.warga.some((x) => x.nama === "Bambang Supriyanto")).toBe(false);
  });

  it("PATCH sukses: detail KK menulis DB (bukan in-memory) + audit diff + respons keluarga terbaru", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `${api}/rt/warga/${idDimas}`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
      payload: {
        pekerjaan: "Pelajar SMA",
        agama: "Islam",
        statusKawin: "Menikah",
        tanggalPerkawinan: "2026-01-15",
      },
    });
    expect(res.statusCode).toBe(200);
    const balas = isi(res).data as {
      warga: {
        pekerjaan: string | null;
        agama: string | null;
        statusKawin: string | null;
        tanggalPerkawinan: string | null;
      };
      keluarga: {
        kk: { noKk: string };
        anggota: { nama: string; statusKawin: string | null; pekerjaan: string | null }[];
      };
    };
    expect(balas.warga.pekerjaan).toBe("Pelajar SMA");
    expect(balas.warga.statusKawin).toBe("Menikah");
    expect(balas.warga.tanggalPerkawinan).toBe("2026-01-15");
    expect(balas.keluarga.kk.noKk).toBe("3171-xxxx-xxxx-0002");
    const dimasDiKk = balas.keluarga.anggota.find((a) => a.nama === "Dimas Prasetyo");
    expect(dimasDiKk?.pekerjaan, "keluarga respons = state terbaru (paritas)").toBe("Pelajar SMA");
    expect(JSON.stringify(balas)).not.toMatch(/\b\d{16}\b/);

    expect(
      await hitung(
        PLATFORM,
        `SELECT count(*)::int AS n FROM warga
          WHERE id = $1 AND pekerjaan = 'Pelajar SMA' AND agama = 'Islam'
            AND status_kawin = 'Menikah' AND tanggal_perkawinan = '2026-01-15'`,
        [idDimas],
      ),
      "PATCH benar-benar menulis DB",
    ).toBe(1);

    expect(
      await hitung(
        { level: "rt", id: idRt04 },
        `SELECT count(*)::int AS n FROM audit_log
          WHERE aksi = 'ubah_warga' AND entitas = 'warga' AND entitas_id = $1
            AND actor_role = 'rt_admin' AND sebelum IS NOT NULL AND sesudah IS NOT NULL
            AND ringkasan LIKE '%Dimas%'`,
        [idDimas],
      ),
      "audit ber-diff oleh pengurus RT",
    ).toBeGreaterThanOrEqual(1);
  });

  it("PATCH guard: tanpa CSRF / sesi warga → 401; lintas-RT & ID asing → 404; enum/tanggal kawin/kosong → 400", async () => {
    const tanpaCsrf = await app.inject({
      method: "PATCH",
      url: `${api}/rt/warga/${idDimas}`,
      cookies: { sid: sidRt },
      payload: { pekerjaan: "Tanpa CSRF" },
    });
    expect(tanpaCsrf.statusCode).toBe(401);
    expect(isi(tanpaCsrf).error?.message).toMatch(/CSRF/);

    const sesiWarga = await app.inject({
      method: "PATCH",
      url: `${api}/rt/warga/${idDimas}`,
      cookies: { sid: sidWarga },
      payload: { pekerjaan: "BOCOR" },
    });
    expect(sesiWarga.statusCode).toBe(401);

    const lintas = await app.inject({
      method: "PATCH",
      url: `${api}/rt/warga/${idDimas}`,
      cookies: { sid: sidRt05, csrf_token: csrfRt05 },
      headers: { "x-csrf-token": csrfRt05 },
      payload: { pekerjaan: "BOCOR" },
    });
    expect(lintas.statusCode, "RT05 tak bisa mengubah warga RT04").toBe(404);
    expect(isi(lintas).error?.code).toBe("NOT_FOUND");

    const asing = await app.inject({
      method: "PATCH",
      url: `${api}/rt/warga/00000000-0000-4000-8000-000000000000`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
      payload: { pekerjaan: "X" },
    });
    expect(asing.statusCode).toBe(404);

    expect(
      await hitung(
        PLATFORM,
        "SELECT count(*)::int AS n FROM warga WHERE id = $1 AND pekerjaan <> 'BOCOR'",
        [idDimas],
      ),
      "baris Dimas tak tersentuh percobaan lintas-RT",
    ).toBe(1);

    const enumRusak = await app.inject({
      method: "PATCH",
      url: `${api}/rt/warga/${idDimas}`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
      payload: { golDarah: "P" },
    });
    expect(enumRusak.statusCode).toBe(400);
    expect(isi(enumRusak).error?.code).toBe("VALIDATION");

    // CHECK DB atas GABUNGAN payload + data lama: tanggal kawin tanpa status → 400
    const tglTanpaStatus = await app.inject({
      method: "PATCH",
      url: `${api}/rt/warga/${idDimas}`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
      payload: { statusKawin: null, tanggalPerkawinan: "2026-05-05" },
    });
    expect(tglTanpaStatus.statusCode).toBe(400);
    expect(isi(tglTanpaStatus).error?.message).toMatch(/bersama Status Perkawinan/);

    const kosong = await app.inject({
      method: "PATCH",
      url: `${api}/rt/warga/${idDimas}`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
      payload: {},
    });
    expect(kosong.statusCode).toBe(400);
    expect(isi(kosong).error?.code).toBe("VALIDATION");
  });

  it("POST buat KK + anggota: sekali kirim, NIK terenkripsi, rumah terhubung, respons ter-mask + audit", async () => {
    const tanpaCsrf = await app.inject({
      method: "POST",
      url: `${api}/rt/warga`,
      cookies: { sid: sidRt },
      payload: payloadBaru(),
    });
    expect(tanpaCsrf.statusCode).toBe(401);
    expect(isi(tanpaCsrf).error?.message).toMatch(/CSRF/);

    const res = await app.inject({
      method: "POST",
      url: `${api}/rt/warga`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
      payload: payloadBaru(),
    });
    expect(res.statusCode).toBe(200);
    const balas = isi(res).data as {
      warga: { id: string; nama: string; hubungan: string; nikMasked: string | null }[];
      keluarga: {
        kk: { id: string; noKk: string; kepala: string; jumlahAnggota: number };
        anggota: Record<string, unknown>[];
      };
    };
    expect(balas.warga.length).toBe(2);
    expect(balas.keluarga.kk.noKk).toBe("3171-xxxx-xxxx-0077");
    expect(balas.keluarga.kk.kepala).toBe("Uji Cahaya Lestari");
    expect(balas.keluarga.kk.jumlahAnggota).toBe(2);
    for (const w of balas.warga) expect(w.nikMasked ?? "").toMatch(/x{4}/);
    expect(balas.keluarga.anggota[0]).toHaveProperty("tempatLahir");
    expect(JSON.stringify(balas)).not.toMatch(/\b\d{16}\b/);

    idKKBaru = balas.keluarga.kk.id;
    idUji = balas.warga.find((w) => w.hubungan === "kepala")?.id ?? "";
    idRina = balas.warga.find((w) => w.hubungan === "istri")?.id ?? "";
    expect(idUji, "kepala KK baru teridentifikasi").not.toBe("");
    expect(idRina, "istri KK baru teridentifikasi").not.toBe("");

    expect(
      await hitung(
        PLATFORM,
        `SELECT count(*)::int AS n FROM warga
          WHERE kk_id = $1 AND rumah_id IS NOT NULL AND nik_encrypted IS NOT NULL
            AND nik_masked ~ 'x{4}'`,
        [idKKBaru],
      ),
      "2 anggota tersimpan + NIK terenkripsi + rumah terhubung",
    ).toBe(2);
    expect(
      await hitung(
        PLATFORM,
        `SELECT count(*)::int AS n FROM kartu_keluarga
          WHERE id = $1 AND rt_id = $2 AND no_kk = '3171050101050077'
            AND jumlah_anggota = 2 AND rumah_id IS NOT NULL`,
        [idKKBaru, idRt04],
      ),
    ).toBe(1);
    expect(
      await hitung(
        { level: "rt", id: idRt04 },
        `SELECT count(*)::int AS n FROM audit_log
          WHERE aksi = 'tambah_warga' AND entitas = 'kartu_keluarga' AND entitas_id = $1`,
        [idKKBaru],
      ),
    ).toBe(1);

    const g = await app.inject({ method: "GET", url: `${api}/rt/warga`, cookies: { sid: sidRt } });
    const data = isi(g).data as { keluarga: { kk: { id: string; jumlahAnggota: number } }[] };
    expect(data.keluarga.find((k) => k.kk.id === idKKBaru)?.kk.jumlahAnggota).toBe(2);
  });

  it("POST bentrok: No.KK / no. HP terdaftar → 409 dengan rollback; NIK ganda & enum rusak → 400", async () => {
    const kkBentrok = await app.inject({
      method: "POST",
      url: `${api}/rt/warga`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
      payload: payloadBaru({ noKk: "3171050101050002" }), // No.KK Bambang
    });
    expect(kkBentrok.statusCode).toBe(409);
    expect(isi(kkBentrok).error?.code).toBe("CONFLICT");

    const hpBentrok = await app.inject({
      method: "POST",
      url: `${api}/rt/warga`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
      payload: payloadBaru({
        noKk: "3171050101050078",
        anggota: [{ ...payloadBaru().anggota[0], noHp: "081234567890" }], // no. HP Bambang
      }),
    });
    expect(hpBentrok.statusCode).toBe(409);
    expect(
      await hitung(
        PLATFORM,
        "SELECT count(*)::int AS n FROM kartu_keluarga WHERE rt_id = $1 AND no_kk = '3171050101050078'",
        [idRt04],
      ),
      "transaksi rollback: KK ...0078 tidak boleh tersisa",
    ).toBe(0);

    const nikGanda = await app.inject({
      method: "POST",
      url: `${api}/rt/warga`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
      payload: payloadBaru({
        anggota: [
          { ...payloadBaru().anggota[1], nama: "Kembar Satu" },
          { ...payloadBaru().anggota[1], nama: "Kembar Dua" },
        ],
      }),
    });
    expect(nikGanda.statusCode).toBe(400);
    expect(isi(nikGanda).error?.message).toMatch(/NIK sama/);

    const enumRusak = await app.inject({
      method: "POST",
      url: `${api}/rt/warga`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
      payload: payloadBaru({ anggota: [{ ...payloadBaru().anggota[0], jenisKelamin: "wanita" }] }),
    });
    expect(enumRusak.statusCode).toBe(400);
    expect(isi(enumRusak).error?.code).toBe("VALIDATION");
  });

  it("PATCH lanjutan: hubungan→kepala ikut update KK, koreksi NIK (audit disembunyikan), No.KK pindah & bentrok 409", async () => {
    const kepalaBaru = await app.inject({
      method: "PATCH",
      url: `${api}/rt/warga/${idRina}`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
      payload: { hubungan: "kepala" },
    });
    expect(kepalaBaru.statusCode).toBe(200);
    const balasK = isi(kepalaBaru).data as { keluarga: { kk: { kepala: string } } };
    expect(balasK.keluarga.kk.kepala, "kepala keluarga ikut menunjuk warga ini").toBe("Rina Handayani");
    expect(
      await hitung(
        PLATFORM,
        "SELECT count(*)::int AS n FROM kartu_keluarga WHERE id = $1 AND kepala_keluarga = 'Rina Handayani'",
        [idKKBaru],
      ),
    ).toBe(1);

    const nikBaru = await app.inject({
      method: "PATCH",
      url: `${api}/rt/warga/${idUji}`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
      payload: { nikBaru: "3171050101770099" },
    });
    expect(nikBaru.statusCode).toBe(200);
    const balasN = isi(nikBaru).data as { warga: { nikMasked: string | null } };
    expect(balasN.warga.nikMasked ?? "").toMatch(/x{4}/);
    expect(balasN.warga.nikMasked ?? "").toMatch(/0099$/);
    expect(JSON.stringify(balasN)).not.toMatch(/\b\d{16}\b/);
    expect(
      await hitung(PLATFORM, "SELECT count(*)::int AS n FROM warga WHERE id = $1 AND nik_masked LIKE '%0099'", [idUji]),
    ).toBe(1);
    expect(
      await hitung(
        { level: "rt", id: idRt04 },
        `SELECT count(*)::int AS n FROM audit_log
          WHERE aksi = 'ubah_warga' AND entitas_id = $1
            AND sebelum->>'nik' = '(disembunyikan)' AND sesudah->>'nik' = '(diubah)'`,
        [idUji],
      ),
      "perubahan NIK tercatat audit tanpa nilai plaintext",
    ).toBe(1);

    const pindah = await app.inject({
      method: "PATCH",
      url: `${api}/rt/warga/${idUji}`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
      payload: { noKk: "3171050101050079", alamat: "Jl. Melati Blok B No. 14" },
    });
    expect(pindah.statusCode).toBe(200);
    const balasP = isi(pindah).data as { keluarga: { kk: { noKk: string; alamat: string } } };
    expect(balasP.keluarga.kk.noKk).toBe("3171-xxxx-xxxx-0079");
    expect(balasP.keluarga.kk.alamat).toBe("Jl. Melati Blok B No. 14");
    expect(
      await hitung(
        PLATFORM,
        `SELECT count(*)::int AS n FROM kartu_keluarga
          WHERE id = $1 AND no_kk = '3171050101050079' AND alamat = 'Jl. Melati Blok B No. 14'`,
        [idKKBaru],
      ),
    ).toBe(1);

    const noKkBentrok = await app.inject({
      method: "PATCH",
      url: `${api}/rt/warga/${idUji}`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
      payload: { noKk: "3171050101050002" },
    });
    expect(noKkBentrok.statusCode).toBe(409);
    expect(
      await hitung(
        PLATFORM,
        "SELECT count(*)::int AS n FROM kartu_keluarga WHERE id = $1 AND no_kk = '3171050101050079'",
        [idKKBaru],
      ),
      "No.KK tidak berubah setelah bentrok",
    ).toBe(1);
  });

  it("DELETE guard: riwayat → 409 CONFLICT; tanpa CSRF / sesi warga → 401; lintas-RT → 404", async () => {
    const idBergaji = await ambilId(
      `SELECT w.id FROM warga w
        WHERE w.rt_id = $1
          AND EXISTS (SELECT 1 FROM tagihan t WHERE t.warga_id = w.id)
        LIMIT 1`,
      [idRt04],
    );
    expect(idBergaji, "ada warga RT04 dengan tagihan (seed)").not.toBe("");

    const adaRiwayat = await app.inject({
      method: "DELETE",
      url: `${api}/rt/warga/${idBergaji}`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
    });
    expect(adaRiwayat.statusCode).toBe(409);
    expect(isi(adaRiwayat).error?.message).toMatch(/riwayat/);
    expect(await hitung(PLATFORM, "SELECT count(*)::int AS n FROM warga WHERE id = $1", [idBergaji])).toBe(1);

    const tanpaCsrf = await app.inject({
      method: "DELETE",
      url: `${api}/rt/warga/${idRina}`,
      cookies: { sid: sidRt },
    });
    expect(tanpaCsrf.statusCode).toBe(401);
    expect(isi(tanpaCsrf).error?.message).toMatch(/CSRF/);

    const sesiWarga = await app.inject({
      method: "DELETE",
      url: `${api}/rt/warga/${idRina}`,
      cookies: { sid: sidWarga },
    });
    expect(sesiWarga.statusCode).toBe(401);

    const lintas = await app.inject({
      method: "DELETE",
      url: `${api}/rt/warga/${idRina}`,
      cookies: { sid: sidRt05, csrf_token: csrfRt05 },
      headers: { "x-csrf-token": csrfRt05 },
    });
    expect(lintas.statusCode).toBe(404);
    expect(
      await hitung(PLATFORM, "SELECT count(*)::int AS n FROM warga WHERE id = $1", [idRina]),
      "baris Rina utuh setelah percobaan lintas-RT",
    ).toBe(1);
  });

  it("DELETE sukses: baris hilang, KK tetap dengan jumlah & kepala dihitung ulang (sampai kosong) + audit", async () => {
    const hapus = await app.inject({
      method: "DELETE",
      url: `${api}/rt/warga/${idRina}`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
    });
    expect(hapus.statusCode).toBe(200);
    const balas = isi(hapus).data as {
      id: string;
      keluarga: { kk: { kepala: string; jumlahAnggota: number }; anggota: { nama: string }[] };
    };
    expect(balas.id).toBe(idRina);
    expect(balas.keluarga.anggota.length).toBe(1);
    expect(balas.keluarga.kk.jumlahAnggota).toBe(1);
    expect(balas.keluarga.kk.kepala, "kepala fallback ke anggota sisa").toBe("Uji Cahaya Lestari");

    expect(await hitung(PLATFORM, "SELECT count(*)::int AS n FROM warga WHERE id = $1", [idRina])).toBe(0);
    expect(
      await hitung(
        PLATFORM,
        `SELECT count(*)::int AS n FROM kartu_keluarga
          WHERE id = $1 AND jumlah_anggota = 1 AND kepala_keluarga = 'Uji Cahaya Lestari'`,
        [idKKBaru],
      ),
    ).toBe(1);
    expect(
      await hitung(
        { level: "rt", id: idRt04 },
        `SELECT count(*)::int AS n FROM audit_log
          WHERE aksi = 'hapus_warga' AND entitas = 'warga' AND entitas_id = $1
            AND sebelum->>'nama' = 'Rina Handayani'`,
        [idRina],
      ),
    ).toBe(1);

    const terakhir = await app.inject({
      method: "DELETE",
      url: `${api}/rt/warga/${idUji}`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
    });
    expect(terakhir.statusCode).toBe(200);
    const akhir = isi(terakhir).data as {
      keluarga: { kk: { kepala: string; jumlahAnggota: number }; anggota: unknown[] };
    };
    expect(akhir.keluarga.anggota.length).toBe(0);
    expect(akhir.keluarga.kk.jumlahAnggota).toBe(0);
    expect(akhir.keluarga.kk.kepala, "kepala dikosongkan bersama anggota terakhir").toBe("");
    expect(
      await hitung(
        PLATFORM,
        `SELECT count(*)::int AS n FROM kartu_keluarga
          WHERE id = $1 AND jumlah_anggota = 0 AND kepala_keluarga = ''`,
        [idKKBaru],
      ),
      "KK kosong tetap ada (FE tak punya aksi hapus KK)",
    ).toBe(1);
    expect(await hitung(PLATFORM, "SELECT count(*)::int AS n FROM warga WHERE kk_id = $1", [idKKBaru])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// B7 · B9 · B10 — Pengaturan iuran (B7), generate tagihan bulanan (B9), dan
// dashboard "Tagihan Tercatat" beserta filternya (B10).
//
// Endpoint-nya sudah ada di `routes/iuranRt.ts`; blok ini mengunci kontraknya
// di atas PostgreSQL sungguhan: guard sesi/CSRF, validasi zod, catat audit,
// idempotensi generate, jejak tulis yang benar-benar bersih saat transaksi
// dibatalkan, serta isolasi lintas-RT untuk pengaturan, tagihan, dan profil.
// ---------------------------------------------------------------------------
describe("B7/B9/B10 · pengaturan iuran, generate tagihan & tagihan tercatat", () => {
  let app: FastifyInstance;
  let api = "/api/v1";
  let sidRt = "";
  let csrfRt = "";
  let sidRt05 = "";
  let csrfRt05 = "";
  let sidWarga = "";
  /** Warga RT04 ber-status aktif (Ahmad Fauzi) — sasaran profil iuran & generate. */
  let idAhmad = "";
  /** Kategori flat pertama & kategori per_unit milik RT04 (dari seed). */
  let idKategoriDatar = "";
  let idKategoriPerUnit = "";
  /** Fixtur lintas-RT: kategori + tagihan RT05 yang dibuat blok ini. */
  let idKategoriRt05 = "";
  let idWargaRt05 = "";

  const sesiRt = () => ({ sid: sidRt, csrf_token: csrfRt });
  const csrfRtHeader = () => ({ "x-csrf-token": csrfRt });
  const sesiRt05 = () => ({ sid: sidRt05, csrf_token: csrfRt05 });

  interface BarisDashboard {
    wargaId: string;
    nama: string;
    jumlah: number;
    sisa: number;
    keringananAktif: boolean;
    tunggakanBulan: number;
    status: string;
    perKategori: Array<{ kategoriId: string; kategori: string; nominal: number; status: string }>;
  }

  /**
   * B9 — jumlah kombinasi (warga `status_akses='aktif'` × kategori aktif
   * non-insidental) yang BELUM punya tagihan pada `periode`. Inilah angka yang
   * harus persis dilaporkan `dibuat` oleh generate, dihitung dari DB agar tes
   * tidak menggantungkan jumlah warga seed secara manual.
   */
  const kombinasiBelumAda = (periode: string): Promise<number> =>
    hitung(
      { level: "rt", id: idRt04 },
      `SELECT count(*)::int AS n
         FROM warga w
         CROSS JOIN kategori_iuran k
        WHERE w.rt_id = $1
          AND w.status_akses = 'aktif'
          AND k.rt_id = $1
          AND k.status_aktif
          AND k.tipe_tarif <> 'insidental'
          AND NOT EXISTS (
                SELECT 1 FROM tagihan t
                 WHERE t.warga_id = w.id AND t.kategori_id = k.id AND t.periode = $2)`,
      [idRt04, periode],
    );

  const tagihanPeriode = (periode: string): Promise<number> =>
    hitung(
      { level: "rt", id: idRt04 },
      "SELECT count(*)::int AS n FROM tagihan WHERE rt_id = $1 AND periode = $2",
      [idRt04, periode],
    );

  const jumlahEntriKas = (): Promise<number> =>
    hitung(
      { level: "rt", id: idRt04 },
      "SELECT count(*)::int AS n FROM kas_entry WHERE scope_level = 'rt' AND scope_id = $1",
      [idRt04],
    );

  const jumlahPembayaran = (): Promise<number> =>
    hitung({ level: "rt", id: idRt04 }, "SELECT count(*)::int AS n FROM pembayaran WHERE rt_id = $1", [idRt04]);

  beforeAll(async () => {
    app = await bukaAplikasiUji();
    api = apiUji;

    const rt = await app.inject({
      method: "POST",
      url: `${api}/auth/pengurus/login`,
      payload: { email: "rt04@siwarga.id", password: "rahasia123" },
    });
    expect(rt.statusCode, "login RT04").toBe(200);
    sidRt = cookieDari(rt, "sid")!;
    csrfRt = cookieDari(rt, "csrf_token")!;

    const rt05 = await app.inject({
      method: "POST",
      url: `${api}/auth/pengurus/login`,
      payload: { email: "rt05@siwarga.id", password: "rahasia123" },
    });
    expect(rt05.statusCode, "login RT05").toBe(200);
    sidRt05 = cookieDari(rt05, "sid")!;
    csrfRt05 = cookieDari(rt05, "csrf_token")!;

    const warga = await app.inject({
      method: "POST",
      url: `${api}/auth/warga/login`,
      payload: { noHp: "081234567894", password: SANDI_WARGA_UJI },
    });
    expect(warga.statusCode, "login warga (Ahmad Fauzi)").toBe(200);
    sidWarga = cookieDari(warga, "sid")!;

    const kategori = await app.inject({ method: "GET", url: `${api}/rt/iuran/kategori`, cookies: { sid: sidRt } });
    expect(kategori.statusCode, "GET /rt/iuran/kategori").toBe(200);
    const daftar = isi(kategori).data.kategori as Array<{ id: string; nama: string; tipeTarif: string }>;
    expect(daftar.length, "RT04 punya 4 kategori iuran seed").toBe(4);
    idKategoriDatar = daftar.find((k) => k.tipeTarif === "flat")?.id ?? "";
    idKategoriPerUnit = daftar.find((k) => k.tipeTarif === "per_unit")?.id ?? "";
    expect(idKategoriDatar && idKategoriPerUnit, "kategori flat & per_unit harus ada").not.toBe("");

    const ahmad = await dalamScopePlat((c) => c.query("SELECT id FROM warga WHERE no_hp = '081234567894'"));
    idAhmad = (ahmad.rows[0] as { id: string }).id;
    expect(idAhmad, "Ahmad Fauzi (warga aktif) harus dibuat seed").not.toBe("");

    // Fixtur RT05 — kategori + satu tagihan 2026-10. Seed sengaja hanya mengisi
    // RT04, sehingga uji lintas-RT butuh baris nyata milik RT05.
    const k05 = await dalamScopePlat((c) =>
      c.query(
        `INSERT INTO kategori_iuran
           (id, rt_id, nama, tipe_tarif, nominal_default, wajib_opsional, status_aktif, urutan, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, 'Iuran Uji RT05', 'flat', 30000, 'wajib', true, 1, now(), now())
         RETURNING id`,
        [idRt05],
      ),
    );
    idKategoriRt05 = (k05.rows[0] as { id: string }).id;

    const t05 = await dalamScopePlat((c) =>
      c.query(
        `INSERT INTO tagihan
           (id, rt_id, warga_id, kategori_id, periode, nominal, nominal_awal, sisa, tenggat, status, sumber)
         SELECT gen_random_uuid(), w.rt_id, w.id, $2, '2026-10', 30000, 30000, 30000, '2026-10-10', 'belum_bayar', 'bulk'
           FROM warga w
          WHERE w.rt_id = $1
         RETURNING warga_id`,
        [idRt05, idKategoriRt05],
      ),
    );
    idWargaRt05 = (t05.rows[0] as { warga_id: string }).warga_id;
    expect(idWargaRt05, "RT05 harus punya warga uji").not.toBe("");
  }, 60_000);

  afterAll(async () => {
    await tutupAplikasiUji();
  });

  it("guard B7/B9: tanpa sesi / sesi warga → 401; mutasi tanpa header CSRF → ditolak", async () => {
    for (const url of [
      `${api}/rt/iuran/pengaturan`,
      `${api}/rt/iuran/tagihan`,
      `${api}/rt/warga/${idAhmad}/profil-iuran`,
    ]) {
      const tanpa = await app.inject({ method: "GET", url });
      expect(tanpa.statusCode, `GET ${url} tanpa sesi`).toBe(401);
      expect(isi(tanpa).error?.code).toBe("UNAUTHORIZED");

      const sesiWarga = await app.inject({ method: "GET", url, cookies: { sid: sidWarga } });
      expect(sesiWarga.statusCode, `GET ${url} dengan sesi warga`).toBe(401);
      expect(isi(sesiWarga).error?.code).toBe("UNAUTHORIZED");
    }

    const mutasi: Array<{ method: "PATCH" | "POST" | "PUT"; url: string; payload: Record<string, unknown> }> = [
      { method: "PATCH", url: `${api}/rt/iuran/pengaturan`, payload: { tenggatHari: 15 } },
      { method: "POST", url: `${api}/rt/iuran/tagihan/generate`, payload: {} },
      {
        method: "PUT",
        url: `${api}/rt/warga/${idAhmad}/profil-iuran`,
        payload: { kategoriId: idKategoriDatar, nominalBerlaku: 1000 },
      },
    ];
    for (const m of mutasi) {
      const tanpaCsrf = await app.inject({ method: m.method, url: m.url, cookies: sesiRt(), payload: m.payload });
      expect(tanpaCsrf.statusCode, `${m.method} ${m.url} tanpa x-csrf-token`).toBe(401);
      expect(isi(tanpaCsrf).error?.message).toMatch(/CSRF/);

      const tanpaSesi = await app.inject({ method: m.method, url: m.url, payload: m.payload });
      expect(tanpaSesi.statusCode, `${m.method} ${m.url} tanpa sesi`).toBe(401);
    }

    // sesi Portal Warga tidak pernah bisa menjalankan mutasi Portal RT
    const wargaKeRt = await app.inject({
      method: "POST",
      url: `${api}/rt/iuran/tagihan/generate`,
      cookies: { sid: sidWarga },
      headers: { "x-csrf-token": "nonce.palsu" },
      payload: { periode: "2026-11" },
    });
    expect(wargaKeRt.statusCode).toBe(401);
    expect(isi(wargaKeRt).error?.code).toBe("UNAUTHORIZED");

    // tidak ada satu pun tagihan 2026-11 yang bocor dari percobaan di atas
    expect(await tagihanPeriode("2026-11")).toBe(0);
  });

  it("B7 · GET pengaturan = nilai seed; PATCH parsial tersimpan + audit ubah_pengaturan_iuran", async () => {
    const awal = await app.inject({ method: "GET", url: `${api}/rt/iuran/pengaturan`, cookies: sesiRt() });
    expect(awal.statusCode).toBe(200);
    expect(isi(awal).data).toEqual({ modeAlokasi: "gabungan", tenggatHari: 10, dendaAktif: false });

    const tenggat = await app.inject({
      method: "PATCH",
      url: `${api}/rt/iuran/pengaturan`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
      payload: { tenggatHari: 15 },
    });
    expect(tenggat.statusCode).toBe(200);
    expect(isi(tenggat).data).toEqual({ modeAlokasi: "gabungan", tenggatHari: 15, dendaAktif: false });

    const mode = await app.inject({
      method: "PATCH",
      url: `${api}/rt/iuran/pengaturan`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
      payload: { modeAlokasi: "terpisah", dendaAktif: true },
    });
    expect(mode.statusCode).toBe(200);
    expect(isi(mode).data).toEqual({ modeAlokasi: "terpisah", tenggatHari: 15, dendaAktif: true });

    const ulang = await app.inject({ method: "GET", url: `${api}/rt/iuran/pengaturan`, cookies: sesiRt() });
    expect(isi(ulang).data).toEqual({ modeAlokasi: "terpisah", tenggatHari: 15, dendaAktif: true });

    // audit: tepat dua baris, masing-masing membawa nilai sebelum & sesudah
    const audit = "SELECT count(*)::int AS n FROM audit_log WHERE aksi = 'ubah_pengaturan_iuran' AND scope_id = $1";
    expect(await hitung({ level: "rt", id: idRt04 }, audit, [idRt04])).toBe(2);
    expect(
      await hitung(
        { level: "rt", id: idRt04 },
        `${audit} AND sebelum->>'tenggatHari' = '10' AND sesudah->>'tenggatHari' = '15'`,
        [idRt04],
      ),
      "PATCH pertama mencatat nilai sebelum & sesudah",
    ).toBe(1);
    expect(
      await hitung(
        { level: "rt", id: idRt04 },
        `${audit} AND sesudah->>'modeAlokasi' = 'terpisah' AND sesudah->>'dendaAktif' = 'true'`,
        [idRt04],
      ),
      "PATCH kedua mencatat mode terpisah + denda aktif",
    ).toBe(1);

    // input tidak valid → 400 VALIDATION, tanpa jejak tulis sama sekali
    const kosong = await app.inject({
      method: "PATCH",
      url: `${api}/rt/iuran/pengaturan`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
      payload: {},
    });
    expect(kosong.statusCode).toBe(400);
    expect(isi(kosong).error?.code).toBe("VALIDATION");
    expect(isi(kosong).error?.message).toMatch(/Minimal satu pengaturan/);

    const nol = await app.inject({
      method: "PATCH",
      url: `${api}/rt/iuran/pengaturan`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
      payload: { tenggatHari: 0 },
    });
    expect(nol.statusCode).toBe(400);
    expect(isi(nol).error?.code).toBe("VALIDATION");

    const rusak = await app.inject({
      method: "PATCH",
      url: `${api}/rt/iuran/pengaturan`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
      payload: { modeAlokasi: "ngawur" },
    });
    expect(rusak.statusCode).toBe(400);
    expect(isi(rusak).error?.code).toBe("VALIDATION");

    const setelah = await app.inject({ method: "GET", url: `${api}/rt/iuran/pengaturan`, cookies: sesiRt() });
    expect(isi(setelah).data, "payload ditolak tidak mengubah pengaturan").toEqual({
      modeAlokasi: "terpisah",
      tenggatHari: 15,
      dendaAktif: true,
    });
    expect(await hitung({ level: "rt", id: idRt04 }, audit, [idRt04]), "galat validasi tidak menulis audit").toBe(2);
  });

  it("B9 · profil iuran: baca daftar kategori, override unit/nominal, tolak input salah & lintas-RT", async () => {
    const baca = await app.inject({
      method: "GET",
      url: `${api}/rt/warga/${idAhmad}/profil-iuran`,
      cookies: sesiRt(),
    });
    expect(baca.statusCode).toBe(200);
    const profil = isi(baca).data as {
      warga: { id: string; nama: string };
      baris: Array<{
        kategoriId: string;
        nama: string;
        tipeTarif: string;
        nominalDefault: number;
        nominalBerlaku: number | null;
        jumlahUnit: number;
      }>;
    };
    expect(profil.warga.id).toBe(idAhmad);
    expect(profil.baris.length, "4 kategori aktif non-insidental").toBe(4);
    expect(profil.baris.every((b) => b.nominalBerlaku === null), "belum ada override").toBe(true);
    expect(profil.baris.find((b) => b.kategoriId === idKategoriPerUnit)?.jumlahUnit).toBe(1);

    // iuran per unit (R4) — jumlah unit boleh diubah
    const unit = await app.inject({
      method: "PUT",
      url: `${api}/rt/warga/${idAhmad}/profil-iuran`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
      payload: { kategoriId: idKategoriPerUnit, jumlahUnit: 3 },
    });
    expect(unit.statusCode).toBe(200);
    expect(isi(unit).data.profil).toMatchObject({
      kategoriId: idKategoriPerUnit,
      nominalBerlaku: null,
      jumlahUnit: 3,
    });

    // kategori flat — `jumlahUnit` ditolak (hanya untuk iuran per unit / R4)
    const unitDatar = await app.inject({
      method: "PUT",
      url: `${api}/rt/warga/${idAhmad}/profil-iuran`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
      payload: { kategoriId: idKategoriDatar, jumlahUnit: 2 },
    });
    expect(unitDatar.statusCode).toBe(400);
    expect(isi(unitDatar).error?.code).toBe("VALIDATION");
    expect(isi(unitDatar).error?.message).toMatch(/per unit \(R4\)/);

    const negatif = await app.inject({
      method: "PUT",
      url: `${api}/rt/warga/${idAhmad}/profil-iuran`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
      payload: { kategoriId: idKategoriDatar, nominalBerlaku: -1 },
    });
    expect(negatif.statusCode).toBe(400);
    expect(isi(negatif).error?.code).toBe("VALIDATION");
    expect(isi(negatif).error?.message).toMatch(/negatif/);

    // override nominal pada kategori flat — disimpan & terbaca ulang
    const nominal = await app.inject({
      method: "PUT",
      url: `${api}/rt/warga/${idAhmad}/profil-iuran`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
      payload: { kategoriId: idKategoriDatar, nominalBerlaku: 30000 },
    });
    expect(nominal.statusCode).toBe(200);
    expect(isi(nominal).data.profil).toMatchObject({
      kategoriId: idKategoriDatar,
      nominalBerlaku: 30000,
      jumlahUnit: 1,
    });

    const ulang = await app.inject({
      method: "GET",
      url: `${api}/rt/warga/${idAhmad}/profil-iuran`,
      cookies: sesiRt(),
    });
    const barisUlang = isi(ulang).data.baris as Array<{
      kategoriId: string;
      nominalBerlaku: number | null;
      jumlahUnit: number;
    }>;
    expect(barisUlang.find((b) => b.kategoriId === idKategoriPerUnit)).toMatchObject({
      nominalBerlaku: null,
      jumlahUnit: 3,
    });
    expect(barisUlang.find((b) => b.kategoriId === idKategoriDatar)).toMatchObject({
      nominalBerlaku: 30000,
      jumlahUnit: 1,
    });

    // dua PUT sukses = dua baris profil & dua audit; PUT yang ditolak tidak
    // meninggalkan apa pun
    expect(
      await hitung(
        { level: "rt", id: idRt04 },
        "SELECT count(*)::int AS n FROM profil_iuran_warga WHERE warga_id = $1",
        [idAhmad],
      ),
    ).toBe(2);
    expect(
      await hitung(
        { level: "rt", id: idRt04 },
        "SELECT count(*)::int AS n FROM audit_log WHERE aksi = 'ubah_profil_iuran' AND scope_id = $1",
        [idRt04],
      ),
    ).toBe(2);

    // lintas-RT: warga RT05 tidak terlihat dari sesi RT04 → 404 tanpa tulis
    const lintasBaca = await app.inject({
      method: "GET",
      url: `${api}/rt/warga/${idWargaRt05}/profil-iuran`,
      cookies: sesiRt(),
    });
    expect(lintasBaca.statusCode).toBe(404);
    expect(isi(lintasBaca).error?.code).toBe("NOT_FOUND");

    const lintasTulis = await app.inject({
      method: "PUT",
      url: `${api}/rt/warga/${idWargaRt05}/profil-iuran`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
      payload: { kategoriId: idKategoriDatar, nominalBerlaku: 1000 },
    });
    expect(lintasTulis.statusCode).toBe(404);
    expect(
      await hitung(
        PLATFORM,
        "SELECT count(*)::int AS n FROM profil_iuran_warga WHERE warga_id = $1",
        [idWargaRt05],
      ),
      "percobaan lintas-RT tidak menulis profil",
    ).toBe(0);
  });

  it("B9 · generate tagihan: nominal ikut profil, tenggat ikut pengaturan, idempoten & audit", async () => {
    const periode = "2026-11";
    const belumAda = await kombinasiBelumAda(periode);
    expect(belumAda, "belum ada tagihan 2026-11 sebelum generate").toBeGreaterThan(0);
    expect(await tagihanPeriode(periode)).toBe(0);

    const hasil = await app.inject({
      method: "POST",
      url: `${api}/rt/iuran/tagihan/generate`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
      payload: { periode },
    });
    expect(hasil.statusCode).toBe(200);
    const data = isi(hasil).data as { dibuat: number; dilewati: number; periode: string };
    expect(data.periode).toBe(periode);
    expect(data.dibuat, "seluruh kombinasi warga×kategori belum ber-tagihan").toBe(belumAda);
    expect(data.dilewati).toBe(0);
    expect(await tagihanPeriode(periode)).toBe(data.dibuat);

    // nominal mengikuti profil iuran (B9): unit override & nominal override
    const perUnit = await denganScope({ level: "rt", id: idRt04 }, (c) =>
      c.query(
        `SELECT nominal::float AS n, to_char(tenggat, 'YYYY-MM-DD') AS tenggat
           FROM tagihan
          WHERE warga_id = $1 AND kategori_id = $2 AND periode = $3`,
        [idAhmad, idKategoriPerUnit, periode],
      ),
    );
    expect(perUnit.rows.length).toBe(1);
    expect((perUnit.rows[0] as { n: number }).n, "25.000 × 3 unit").toBe(75000);
    expect((perUnit.rows[0] as { tenggat: string }).tenggat, "tenggatHari 15 → 15 November").toBe("2026-11-15");

    const datar = await dalamScopePlat((c) =>
      c.query(
        "SELECT nominal::float AS n FROM tagihan WHERE warga_id = $1 AND kategori_id = $2 AND periode = $3",
        [idAhmad, idKategoriDatar, periode],
      ),
    );
    expect((datar.rows[0] as { n: number }).n, "nominal override 30.000 dipakai generate").toBe(30000);

    expect(
      await hitung(
        { level: "rt", id: idRt04 },
        `SELECT count(*)::int AS n FROM audit_log
          WHERE aksi = 'generate_tagihan' AND scope_id = $1
            AND sesudah->>'periode' = $2 AND sesudah->>'dibuat' = $3`,
        [idRt04, periode, String(data.dibuat)],
      ),
      "audit generate_tagihan membawa periode + jumlah dibuat",
    ).toBe(1);

    // panggilan ulang dengan periode sama → idempoten (0 dibuat, semua dilewati)
    const ulang = await app.inject({
      method: "POST",
      url: `${api}/rt/iuran/tagihan/generate`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
      payload: { periode },
    });
    expect(ulang.statusCode).toBe(200);
    // `sinkron: 0` — tanpa `sinkronProfil` tidak ada tagihan yang disentuh
    expect(isi(ulang).data).toEqual({ dibuat: 0, dilewati: belumAda, sinkron: 0, periode });
    expect(await tagihanPeriode(periode), "generate ulang tidak menduplikasi baris").toBe(data.dibuat);

    // `periode` opsional → mengikuti periode aktif sistem (2026-10)
    const belumOktober = await kombinasiBelumAda("2026-10");
    const otomatis = await app.inject({
      method: "POST",
      url: `${api}/rt/iuran/tagihan/generate`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
      payload: {},
    });
    expect(otomatis.statusCode).toBe(200);
    const dataOtomatis = isi(otomatis).data as { dibuat: number; dilewati: number; periode: string };
    expect(dataOtomatis.periode, "tanpa periode → periode aktif").toBe("2026-10");
    expect(dataOtomatis.dibuat).toBe(belumOktober);
    expect(dataOtomatis.dibuat + dataOtomatis.dilewati, "total kombinasi = warga aktif × kategori").toBe(belumAda);

    expect(
      await hitung(
        { level: "rt", id: idRt04 },
        "SELECT count(*)::int AS n FROM audit_log WHERE aksi = 'generate_tagihan' AND scope_id = $1",
        [idRt04],
      ),
      "tiga panggilan generate = tiga audit",
    ).toBe(3);
  });

  it("Iuran kondisional (money-path): RT buat → warga lihat & bayar → setujui → lunas sinkron di dua portal", async () => {
    interface GrupKondisional {
      nama: string;
      periode: string;
      total: number;
      lunas: number;
      belum: number;
      targetSemua: boolean;
      baris: Array<{ wargaId: string; nominal: number; sisa: number; status: string }>;
    }
    interface BarisKondisional {
      id: string;
      nama: string;
      periode: string;
      nominal: number;
      sisa: number;
      status: string;
    }

    const nama = "Iuran Fogging Darurat";

    // 1. RT membuat tagihan insidental untuk SATU warga (target spesifik)
    const payload = { nama, nominal: 45000, target: [idAhmad], tenggat: "2026-10-25" };
    const buat = await app.inject({
      method: "POST",
      url: `${api}/rt/iuran/kondisional`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
      payload,
    });
    expect(buat.statusCode).toBe(200);
    const hasilBuat = isi(buat).data as { kategoriId: string; periode: string; dibuat: number; target: number };
    expect(hasilBuat.periode, "tanpa periode → periode aktif 2026-10").toBe("2026-10");
    expect(hasilBuat.target).toBe(1);
    expect(hasilBuat.dibuat).toBe(1);

    // kategori dibuat sekali bertipe insidental + sifat opsional (§6.4.1)
    const kategori = await dalamScopePlat((c) =>
      c.query("SELECT tipe_tarif AS tipe, wajib_opsional AS sifat FROM kategori_iuran WHERE id = $1", [
        hasilBuat.kategoriId,
      ]),
    );
    expect((kategori.rows[0] as { tipe: string }).tipe).toBe("insidental");
    expect((kategori.rows[0] as { sifat: string }).sifat).toBe("opsional");

    // klik ulang (nama + target sama) → idempoten, tidak menggandakan tagihan
    const ulang = await app.inject({
      method: "POST",
      url: `${api}/rt/iuran/kondisional`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
      payload,
    });
    expect(ulang.statusCode).toBe(200);
    expect((isi(ulang).data as { dibuat: number }).dibuat, "createMany skipDuplicates").toBe(0);

    // guard: tanpa CSRF → ditolak; sesi warga tak bisa membuat; target lintas RT → ditolak
    const tanpaCsrf = await app.inject({
      method: "POST",
      url: `${api}/rt/iuran/kondisional`,
      cookies: sesiRt(),
      payload: { nama: "Iuran Tanpa CSRF", nominal: 1000 },
    });
    expect(tanpaCsrf.statusCode).toBe(401);

    const wargaBuat = await app.inject({
      method: "POST",
      url: `${api}/rt/iuran/kondisional`,
      cookies: { sid: sidWarga },
      headers: csrfRtHeader(),
      payload: { nama: "Iuran Warga", nominal: 1000 },
    });
    expect(wargaBuat.statusCode).toBe(401);

    const lintas = await app.inject({
      method: "POST",
      url: `${api}/rt/iuran/kondisional`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
      payload: { nama: "Iuran Lintas RT", nominal: 1000, target: [idWargaRt05] },
    });
    expect(lintas.statusCode).toBe(400);
    expect(isi(lintas).error?.code).toBe("VALIDATION");

    // 2. Portal RT melihat progres — belum lunas
    const rtSebelum = await app.inject({ method: "GET", url: `${api}/rt/iuran/kondisional`, cookies: sesiRt() });
    expect(rtSebelum.statusCode).toBe(200);
    const grupSebelum = (isi(rtSebelum).data.daftar as GrupKondisional[]).find((g) => g.nama === nama);
    expect(grupSebelum, "tagihan kondisional muncul di Portal RT").toBeTruthy();
    expect(grupSebelum!.periode).toBe("2026-10");
    expect(grupSebelum!.total).toBe(1);
    expect(grupSebelum!.lunas).toBe(0);
    expect(grupSebelum!.belum).toBe(1);
    expect(grupSebelum!.targetSemua, "target spesifik ≠ seluruh hunian").toBe(false);
    expect(grupSebelum!.baris[0].wargaId).toBe(idAhmad);
    expect(grupSebelum!.baris[0].nominal).toBe(45000);
    expect(grupSebelum!.baris[0].sisa).toBe(45000);
    expect(grupSebelum!.baris[0].status).toBe("belum_bayar");

    // RLS: RT05 tidak pernah melihat tagihan RT04; sesi warga tak bisa baca endpoint RT
    const rt05 = await app.inject({ method: "GET", url: `${api}/rt/iuran/kondisional`, cookies: sesiRt05() });
    expect(rt05.statusCode).toBe(200);
    expect((isi(rt05).data.daftar as GrupKondisional[]).some((g) => g.nama === nama)).toBe(false);

    const wargaBaca = await app.inject({
      method: "GET",
      url: `${api}/rt/iuran/kondisional`,
      cookies: { sid: sidWarga },
    });
    expect(wargaBaca.statusCode).toBe(401);

    // 3. Portal Warga melihat tagihan kondisional miliknya
    const wargaLihat = await app.inject({
      method: "GET",
      url: `${api}/warga/iuran/kondisional`,
      cookies: { sid: sidWarga },
    });
    expect(wargaLihat.statusCode).toBe(200);
    const baris = (isi(wargaLihat).data.daftar as BarisKondisional[]).find((b) => b.nama === nama);
    expect(baris, "warga target melihat tagihan kondisionalnya").toBeTruthy();
    expect(baris!.periode).toBe("2026-10");
    expect(baris!.nominal).toBe(45000);
    expect(baris!.sisa).toBe(45000);
    expect(baris!.status).toBe("belum_bayar");

    // 4. Warga ajukan bukti → menunggu_verifikasi; sisa tagihan BELUM berkurang
    const bayar = await app.inject({
      method: "POST",
      url: `${api}/warga/iuran/bukti`,
      cookies: { sid: sidWarga },
      headers: { "idempotency-key": "uji-kondisional-0001" },
      payload: { nominal: 45000, metode: "transfer", catatan: `Tagihan kondisional: ${nama}` },
    });
    expect(bayar.statusCode).toBe(200);
    const idBayar = isi(bayar).data.pembayaran.id as string;
    expect(isi(bayar).data.pembayaran.status).toBe("menunggu_verifikasi");

    const sisaSebelum = await dalamScopePlat((c) =>
      c.query("SELECT sisa::float AS sisa FROM tagihan WHERE id = $1", [baris!.id]),
    );
    expect(Number((sisaSebelum.rows[0] as { sisa: number }).sisa), "sisa tak berkurang sebelum verifikasi").toBe(
      45000,
    );

    // 5. RT setujui — mode terpisah mensyaratkan kategoriTujuan (B7)
    const kasSebelum = await jumlahEntriKas();
    const setujui = await app.inject({
      method: "POST",
      url: `${api}/rt/iuran/pembayaran/${idBayar}/setujui`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
      payload: { kategoriTujuan: hasilBuat.kategoriId },
    });
    expect(setujui.statusCode).toBe(200);

    // alokasi FIFO mengurangi sisa tagihan kondisional → lunas; kas otomatis tercatat
    const sesudah = await dalamScopePlat((c) =>
      c.query("SELECT sisa::float AS sisa FROM tagihan WHERE id = $1", [baris!.id]),
    );
    expect(Number((sesudah.rows[0] as { sisa: number }).sisa), "sisa = 0 setelah verifikasi").toBe(0);
    expect(await jumlahEntriKas(), "verifikasi menulis satu entri kas otomatis").toBe(kasSebelum + 1);

    // 6. STATUS SINKRON di dua portal: RT & warga sama-sama melihat lunas
    const rtSesudah = await app.inject({ method: "GET", url: `${api}/rt/iuran/kondisional`, cookies: sesiRt() });
    const grup = (isi(rtSesudah).data.daftar as GrupKondisional[]).find((g) => g.nama === nama);
    expect(grup!.lunas).toBe(1);
    expect(grup!.belum).toBe(0);
    expect(grup!.baris[0].status).toBe("lunas");
    expect(grup!.baris[0].sisa).toBe(0);

    const wargaSesudah = await app.inject({
      method: "GET",
      url: `${api}/warga/iuran/kondisional`,
      cookies: { sid: sidWarga },
    });
    const barisLunas = (isi(wargaSesudah).data.daftar as BarisKondisional[]).find((b) => b.nama === nama);
    expect(barisLunas!.sisa, "sisa warga ikut 0").toBe(0);
    expect(barisLunas!.status).toBe("lunas");
  });

  it("Bendahara modifikasi tagihan: sinkronProfil menyesuaikan yang belum teralokasi, tak menyentuh yang teralokasi", async () => {
    const periode = "2026-11";
    const bacaTagihan = () =>
      dalamScopePlat((c) =>
        c.query(
          "SELECT nominal::float AS nominal, sisa::float AS sisa FROM tagihan WHERE warga_id = $1 AND kategori_id = $2 AND periode = $3",
          [idAhmad, idKategoriDatar, periode],
        ),
      );

    // tagihan datar Ahmad 2026-11 sudah ada dari tes B9 (nominal profil 30.000, belum teralokasi)
    const sebelum = (await bacaTagihan()).rows[0] as { nominal: number; sisa: number };
    expect(sebelum.nominal, "nominal profil lama").toBe(30000);
    expect(sebelum.sisa).toBe(30000);

    // bendahara mengubah profil iuran: 30.000 → 45.000
    const profil = await app.inject({
      method: "PUT",
      url: `${api}/rt/warga/${idAhmad}/profil-iuran`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
      payload: { kategoriId: idKategoriDatar, nominalBerlaku: 45000 },
    });
    expect(profil.statusCode).toBe(200);

    // generate TANPA sinkronProfil → tagihan lama dibiarkan (idempoten saja)
    const tanpa = await app.inject({
      method: "POST",
      url: `${api}/rt/iuran/tagihan/generate`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
      payload: { periode },
    });
    expect(tanpa.statusCode).toBe(200);
    expect(isi(tanpa).data).toMatchObject({ dibuat: 0, sinkron: 0 });
    expect(
      ((await bacaTagihan()).rows[0] as { nominal: number }).nominal,
      "tanpa flag → tagihan tak tersentuh",
    ).toBe(30000);

    // generate DENGAN sinkronProfil → tagihan BELUM teralokasi disesuaikan profil
    const dengan = await app.inject({
      method: "POST",
      url: `${api}/rt/iuran/tagihan/generate`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
      payload: { periode, sinkronProfil: true },
    });
    expect(dengan.statusCode).toBe(200);
    const hasil = isi(dengan).data as { dibuat: number; sinkron: number; periode: string };
    expect(hasil.periode).toBe(periode);
    expect(hasil.dibuat, "idempoten — tak ada tagihan baru").toBe(0);
    expect(hasil.sinkron, "minimal tagihan Ahmad disesuaikan").toBeGreaterThanOrEqual(1);
    const disinkron = (await bacaTagihan()).rows[0] as { nominal: number; sisa: number };
    expect(disinkron.nominal, "nominal ikut profil terbaru").toBe(45000);
    expect(disinkron.sisa, "sisa ikut profil selama belum teralokasi").toBe(45000);

    // alokasi SELURUH tagihan datar Ahmad (mode terpisah → kategoriTujuan datar)
    const totalDatar = Number(
      (
        (
          await dalamScopePlat((c) =>
            c.query(
              "SELECT COALESCE(SUM(sisa), 0)::float AS n FROM tagihan WHERE warga_id = $1 AND kategori_id = $2 AND sisa > 0",
              [idAhmad, idKategoriDatar],
            ),
          )
        ).rows[0] as { n: number }
      ).n,
    );
    expect(totalDatar, "ada tagihan datar terbuka").toBeGreaterThanOrEqual(45000);

    const bayar = await app.inject({
      method: "POST",
      url: `${api}/warga/iuran/bukti`,
      cookies: { sid: sidWarga },
      headers: { "idempotency-key": "uji-sinkron-alokasi-0001" },
      payload: { nominal: totalDatar, metode: "transfer" },
    });
    expect(bayar.statusCode).toBe(200);
    const setujui = await app.inject({
      method: "POST",
      url: `${api}/rt/iuran/pembayaran/${isi(bayar).data.pembayaran.id}/setujui`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
      payload: { kategoriTujuan: idKategoriDatar },
    });
    expect(setujui.statusCode).toBe(200);
    expect(
      ((await bacaTagihan()).rows[0] as { sisa: number }).sisa,
      "alokasi melunasi tagihan datar 2026-11",
    ).toBe(0);

    // profil diubah LAGI (45.000 → 50.000) — tagihan kini BER-alokasi
    const profil2 = await app.inject({
      method: "PUT",
      url: `${api}/rt/warga/${idAhmad}/profil-iuran`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
      payload: { kategoriId: idKategoriDatar, nominalBerlaku: 50000 },
    });
    expect(profil2.statusCode).toBe(200);

    const ulang = await app.inject({
      method: "POST",
      url: `${api}/rt/iuran/tagihan/generate`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
      payload: { periode, sinkronProfil: true },
    });
    expect(ulang.statusCode).toBe(200);
    expect(
      (isi(ulang).data as { sinkron: number }).sinkron,
      "tagihan teralokasi dilewati sinkron — jejak kas utuh",
    ).toBe(0);
    const akhir = (await bacaTagihan()).rows[0] as { nominal: number; sisa: number };
    expect(akhir.nominal, "nominal TIDAK berubah meski profil 50.000").toBe(45000);
    expect(akhir.sisa).toBe(0);
  });

  it("B7 · mode terpisah: tanpa kategori tujuan ditolak tanpa jejak; dengan kategori tujuan alokasi satu kategori", async () => {
    // mode 'terpisah' diatur B7 pada tes pengaturan di atas
    const mode = await app.inject({ method: "GET", url: `${api}/rt/iuran/pengaturan`, cookies: sesiRt() });
    expect(isi(mode).data.modeAlokasi).toBe("terpisah");

    const sasaran = (
      await denganScope({ level: "rt", id: idRt04 }, (c) =>
        c.query(
          `SELECT w.id FROM warga w
             JOIN tagihan t ON t.warga_id = w.id
            WHERE w.rt_id = $1 AND t.kategori_id = $2 AND t.sisa > 0
            LIMIT 1`,
          [idRt04, idKategoriDatar],
        ),
      )
    ).rows[0] as { id: string } | undefined;
    expect(sasaran?.id, "ada warga dengan tagihan terbuka pada kategori tujuan").toBeTruthy();

    const pembayaranSebelum = await jumlahPembayaran();
    const kasSebelum = await jumlahEntriKas();
    const auditSebelum = await hitung(
      { level: "rt", id: idRt04 },
      "SELECT count(*)::int AS n FROM audit_log WHERE aksi = 'catat_pembayaran' AND scope_id = $1",
      [idRt04],
    );

    const tanpa = await app.inject({
      method: "POST",
      url: `${api}/rt/iuran/pembayaran`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
      payload: { wargaId: sasaran!.id, nominal: 20000 },
    });
    expect(tanpa.statusCode, "mode terpisah mensyaratkan kategori tujuan").toBe(400);
    expect(isi(tanpa).error?.code).toBe("VALIDATION");
    expect(isi(tanpa).error?.message).toMatch(/kategori tujuan/i);

    // transaksi dibatalkan → tidak ada baris pembayaran/alokasi/kas/audit yatim
    expect(await jumlahPembayaran(), "pembayaran gagal tidak boleh tersimpan").toBe(pembayaranSebelum);
    expect(await jumlahEntriKas(), "kas tidak boleh bergerak saat alokasi gagal").toBe(kasSebelum);
    expect(
      await hitung(
        { level: "rt", id: idRt04 },
        "SELECT count(*)::int AS n FROM audit_log WHERE aksi = 'catat_pembayaran' AND scope_id = $1",
        [idRt04],
      ),
      "audit catat_pembayaran tidak tertulis untuk transaksi gagal",
    ).toBe(auditSebelum);

    const dengan = await app.inject({
      method: "POST",
      url: `${api}/rt/iuran/pembayaran`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
      payload: { wargaId: sasaran!.id, nominal: 20000, kategoriTujuan: idKategoriDatar },
    });
    expect(dengan.statusCode).toBe(200);
    const hasil = isi(dengan).data as {
      pembayaran: { id: string };
      alokasi: Array<{ tagihanId: string; nominal: number }>;
      totalDialokasikan: number;
      kas: { saldoSesudah: number } | null;
    };
    expect(hasil.alokasi.length).toBeGreaterThan(0);
    expect(hasil.totalDialokasikan).toBeGreaterThan(0);
    expect(hasil.kas).not.toBeNull();

    // seluruh baris alokasi mengarah ke kategori tujuan — bukan campuran
    const kategoriAlokasi = await dalamScopePlat((c) =>
      c.query(
        `SELECT DISTINCT t.kategori_id AS id
           FROM alokasi_pembayaran a
           JOIN tagihan t ON t.id = a.tagihan_id
          WHERE a.pembayaran_id = $1`,
        [hasil.pembayaran.id],
      ),
    );
    expect(kategoriAlokasi.rows.length).toBe(1);
    expect((kategoriAlokasi.rows[0] as { id: string }).id).toBe(idKategoriDatar);
    expect(await jumlahPembayaran()).toBe(pembayaranSebelum + 1);
    expect(await jumlahEntriKas()).toBe(kasSebelum + 1);
    expect(
      await hitung(
        { level: "rt", id: idRt04 },
        "SELECT count(*)::int AS n FROM audit_log WHERE aksi = 'catat_pembayaran' AND entitas_id = $1",
        [hasil.pembayaran.id],
      ),
    ).toBe(1);

    // kembalikan mode gabungan untuk sisa blok
    const pulih = await app.inject({
      method: "PATCH",
      url: `${api}/rt/iuran/pengaturan`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
      payload: { modeAlokasi: "gabungan", dendaAktif: false },
    });
    expect(pulih.statusCode).toBe(200);
    expect(isi(pulih).data).toEqual({ modeAlokasi: "gabungan", tenggatHari: 15, dendaAktif: false });
  });

  it("lintas-RT: pengaturan, generate, dashboard tagihan & profil iuran tetap terisolasi", async () => {
    const awal05 = await app.inject({ method: "GET", url: `${api}/rt/iuran/pengaturan`, cookies: sesiRt05() });
    expect(isi(awal05).data, "pengaturan RT05 dari seed").toEqual({
      modeAlokasi: "terpisah",
      tenggatHari: 15,
      dendaAktif: false,
    });

    const patch05 = await app.inject({
      method: "PATCH",
      url: `${api}/rt/iuran/pengaturan`,
      cookies: sesiRt05(),
      headers: { "x-csrf-token": csrfRt05 },
      payload: { tenggatHari: 3 },
    });
    expect(patch05.statusCode).toBe(200);
    expect(isi(patch05).data).toEqual({ modeAlokasi: "terpisah", tenggatHari: 3, dendaAktif: false });

    const pengaturan04 = await app.inject({ method: "GET", url: `${api}/rt/iuran/pengaturan`, cookies: sesiRt() });
    expect(isi(pengaturan04).data, "pengaturan RT04 tak tersentuh oleh RT05").toEqual({
      modeAlokasi: "gabungan",
      tenggatHari: 15,
      dendaAktif: false,
    });

    // generate oleh RT04 tidak pernah menambah baris milik RT05
    const tagihan05 = await hitung(
      PLATFORM,
      "SELECT count(*)::int AS n FROM tagihan WHERE rt_id = $1",
      [idRt05],
    );
    const generate = await app.inject({
      method: "POST",
      url: `${api}/rt/iuran/tagihan/generate`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
      payload: { periode: "2026-11" },
    });
    expect(generate.statusCode).toBe(200);
    expect(isi(generate).data.dibuat, "generate ulang RT04 → 0 baris baru").toBe(0);
    expect(await hitung(PLATFORM, "SELECT count(*)::int AS n FROM tagihan WHERE rt_id = $1", [idRt05])).toBe(
      tagihan05,
    );

    // dashboard tagihan masing-masing RT hanya memuat warganya sendiri
    const warga05 = await dalamScopePlat((c) => c.query("SELECT id FROM warga WHERE rt_id = $1", [idRt05]));
    const setWarga05 = new Set(warga05.rows.map((r) => (r as { id: string }).id));

    const dash04 = await app.inject({ method: "GET", url: `${api}/rt/iuran/tagihan`, cookies: sesiRt() });
    const rows04 = isi(dash04).data.rows as BarisDashboard[];
    expect(rows04.length).toBeGreaterThan(0);
    expect(rows04.some((r) => setWarga05.has(r.wargaId)), "tak ada baris RT05 di sesi RT04").toBe(false);

    const dash05 = await app.inject({ method: "GET", url: `${api}/rt/iuran/tagihan`, cookies: sesiRt05() });
    expect(dash05.statusCode).toBe(200);
    const data05 = isi(dash05).data as { periode: string; rows: BarisDashboard[] };
    expect(data05.periode).toBe("2026-10");
    expect(data05.rows.length).toBeGreaterThan(0);
    expect(data05.rows.every((r) => setWarga05.has(r.wargaId))).toBe(true);
    expect(data05.rows[0].perKategori[0].kategori).toBe("Iuran Uji RT05");

    // profil iuran: RT05 membaca miliknya sendiri; RT04 sudah 404 pada tes B9
    const profil05 = await app.inject({
      method: "GET",
      url: `${api}/rt/warga/${idWargaRt05}/profil-iuran`,
      cookies: sesiRt05(),
    });
    expect(profil05.statusCode).toBe(200);
    const baris05 = isi(profil05).data.baris as Array<{ kategoriId: string; nominalDefault: number }>;
    expect(baris05.length).toBe(1);
    expect(baris05[0].kategoriId).toBe(idKategoriRt05);
    expect(baris05[0].nominalDefault).toBe(30000);
  });

  it("B10 · dashboard tagihan: filter kategori & status, pencarian menyempitkan, status sampah ditolak", async () => {
    const res = await app.inject({ method: "GET", url: `${api}/rt/iuran/tagihan`, cookies: sesiRt() });
    expect(res.statusCode).toBe(200);
    const data = isi(res).data as { periode: string; rows: BarisDashboard[]; rekap: Record<string, number> };
    expect(data.periode, "tanpa periode → periode aktif").toBe("2026-10");
    expect(data.rows.length).toBeGreaterThan(0);
    expect(data.rekap.total).toBe(data.rows.length);
    expect(data.rekap.terkumpul).toBeLessThanOrEqual(data.rekap.target);
    expect(
      data.rows.every((r) => typeof r.keringananAktif === "boolean" && Number.isInteger(r.tunggakanBulan)),
      "badge B10 selalu ber-tipe scalar",
    ).toBe(true);

    // badge tunggakan: RT04 masih punya tagihan lama belum dibayar
    expect(
      await hitung(
        { level: "rt", id: idRt04 },
        `SELECT count(*)::int AS n FROM tagihan
          WHERE rt_id = $1 AND sisa > 0 AND status = 'belum_bayar' AND periode < '2026-10'`,
        [idRt04],
      ),
    ).toBeGreaterThan(0);
    expect(data.rows.some((r) => r.tunggakanBulan > 0)).toBe(true);

    const bambang = data.rows.find((r) => /bambang/i.test(r.nama));
    expect(bambang, "baris Bambang harus tampil").toBeTruthy();
    expect(bambang!.tunggakanBulan, "tagihan Bambang lunas semua → tanpa tunggakan").toBe(0);
    expect(bambang!.keringananAktif).toBe(false);

    // filter kategori → setiap baris hanya memuat kategori tsb
    const perKategori = await app.inject({
      method: "GET",
      url: `${api}/rt/iuran/tagihan?kategori=${idKategoriDatar}`,
      cookies: sesiRt(),
    });
    expect(perKategori.statusCode).toBe(200);
    const rowsKategori = isi(perKategori).data.rows as BarisDashboard[];
    expect(rowsKategori.length).toBeGreaterThan(0);
    expect(
      rowsKategori.every(
        (r) => r.perKategori.length === 1 && r.perKategori[0].kategoriId === idKategoriDatar,
      ),
    ).toBe(true);

    // filter status → seluruh baris ber-status sama
    const belum = await app.inject({
      method: "GET",
      url: `${api}/rt/iuran/tagihan?status=${encodeURIComponent("Belum Bayar")}`,
      cookies: sesiRt(),
    });
    expect(belum.statusCode).toBe(200);
    const rowsBelum = isi(belum).data.rows as BarisDashboard[];
    expect(rowsBelum.length).toBeGreaterThan(0);
    expect(rowsBelum.every((r) => r.status === "Belum Bayar")).toBe(true);

    const lunas = await app.inject({
      method: "GET",
      url: `${api}/rt/iuran/tagihan?status=Lunas`,
      cookies: sesiRt(),
    });
    expect(lunas.statusCode).toBe(200);
    const rowsLunas = isi(lunas).data.rows as BarisDashboard[];
    expect(rowsLunas.length).toBeGreaterThan(0);
    expect(rowsLunas.every((r) => r.status === "Lunas")).toBe(true);

    const rusak = await app.inject({
      method: "GET",
      url: `${api}/rt/iuran/tagihan?status=Acak`,
      cookies: sesiRt(),
    });
    expect(rusak.statusCode).toBe(400);
    expect(isi(rusak).error?.code).toBe("VALIDATION");

    // pencarian menyempitkan hasil tanpa mengubah periode
    const cari = await app.inject({
      method: "GET",
      url: `${api}/rt/iuran/tagihan?q=Bambang`,
      cookies: sesiRt(),
    });
    expect(cari.statusCode).toBe(200);
    const rowsCari = isi(cari).data.rows as BarisDashboard[];
    expect(rowsCari.length).toBeGreaterThan(0);
    expect(rowsCari.length).toBeLessThan(data.rows.length);
    expect(rowsCari.every((r) => /bambang/i.test(r.nama))).toBe(true);
  });

  it("B10 · badge keringanan aktif muncul di baris warga dan hilang setelah dicabut", async () => {
    const barisDari = async (): Promise<BarisDashboard | undefined> => {
      const res = await app.inject({ method: "GET", url: `${api}/rt/iuran/tagihan`, cookies: sesiRt() });
      expect(res.statusCode).toBe(200);
      return (isi(res).data.rows as BarisDashboard[]).find((r) => r.wargaId === idAhmad);
    };

    const sebelum = await barisDari();
    expect(sebelum, "baris Ahmad harus tampil pada periode aktif").toBeTruthy();
    expect(sebelum!.keringananAktif).toBe(false);

    const dibuat = await dalamScopePlat((c) =>
      c.query(
        `INSERT INTO keringanan
           (id, rt_id, warga_id, kategori_id, nominal_keringanan, alasan, periode_mulai, status_approval, status)
         VALUES (gen_random_uuid(), $1, $2, $3, 10000, 'Uji B10', '2026-10', 'disetujui', 'aktif')
         RETURNING id`,
        [idRt04, idAhmad, idKategoriDatar],
      ),
    );
    const idKeringanan = (dibuat.rows[0] as { id: string }).id;

    const sesudah = await barisDari();
    expect(sesudah!.keringananAktif, "badge keringanan menyala untuk warga bersangkutan").toBe(true);
    expect(
      sesudah!.status,
      "keringanan hanya badge — status tetap diturunkan dari sisa tagihan (§4.4)",
    ).toBe(sebelum!.status);

    await dalamScopePlat((c) => c.query("DELETE FROM keringanan WHERE id = $1", [idKeringanan]));
    const hilang = await barisDari();
    expect(hilang!.keringananAktif, "badge hilang setelah keringanan dicabut").toBe(false);
  });
});

// ---------------------------------------------------------------------------
// B12 · Persuratan resmi & verifikasi QR (PRD §6.6 · P0)
//
//   • Pengaturan kop  : GET/PATCH /rt/pengaturan (whitelist, merge, audit diff)
//   • Antrian RT       : POST /rt/surat + {setujui,tolak,minta-perbaikan,terbitkan}
//   • Portal Warga    : GET/POST /warga/surat (baris milik sesi + kop unduhan)
//   • Publik (tanpa sesi): GET /publik/verifikasi-surat/:qrToken
//
// Semua `it` berjalan BERURUTAN dan berbagi state DB (tanpa rollback untuk jalur
// HTTP) — `idSuratA/tokenA/idSuratB/tokenB` dititipkan antar tes dengan sengaja:
// urutannya sendiri yang menguji alur nyata (buat → proses → terbit → verifikasi).
// Jumlah inject dijaga jauh di bawah rate limit global 300 req/menit/IP.
// ---------------------------------------------------------------------------
describe("B12 · persuratan resmi & verifikasi QR", () => {
  let app: FastifyInstance;
  let api = "/api/v1";
  let sidRt = "";
  let csrfRt = "";
  let sidRt05 = "";
  let csrfRt05 = "";
  let sidAhmad = "";
  let sidBambang = "";
  let idAhmad = "";
  let noKkAhmad = "";

  /** Hasil tes `POST /rt/surat` — dipakai tes transisi, list, warga & publik. */
  let idSuratA = "";
  let tokenA = "";
  let idSuratB = "";
  let tokenB = "";
  let idSuratWarga = "";

  const sesiRt = () => ({ sid: sidRt, csrf_token: csrfRt });
  const csrfRtHeader = () => ({ "x-csrf-token": csrfRt });

  /** Nomor surat buatan tes — unik per RT, sekaligus bahan uji auto-nomor warga. */
  const NOMOR_A = "SKD/004-012/10/2026/001";
  const NOMOR_B = "SKCK/004-012/10/2026/002";

  const KOP_BARU = {
    baris1: "PEMERINTAH KABUPATEN NUSANTARA",
    baris2: "KETUA RT 004 / RW 012 PERUMAHAN SIWARGA",
    baris3: "Jl. Melati No. 12 Telp 0812-0000-0000",
  };
  /** Hasil PATCH parsial (hanya `baris2` diganti) — jadi nilai yang tersimpan. */
  const KOP_TERSIMPAN = { ...KOP_BARU, baris2: "KETUA RT 004 / RW 012 PERUMAHAN SIWARGA (DIPERBARUI)" };

  /** Baris surat RT04 (scope RLS `rt`) — dipakai menghitung jejak pembuatan. */
  const jumlahSurat = (): Promise<number> =>
    hitung({ level: "rt", id: idRt04 }, "SELECT count(*)::int AS n FROM surat");

  /**
   * Hitung audit milik RT04 dengan kondisi SQL bebas; parameter pertama SQL
   * selalu `$1 = idRt04`, jadi kondisi menulis `$2`, `$3`, …
   */
  const hitungAudit = (kondisi: string, params: unknown[] = []): Promise<number> =>
    hitung(
      { level: "rt", id: idRt04 },
      `SELECT count(*)::int AS n FROM audit_log WHERE scope_id = $1 AND ${kondisi}`,
      [idRt04, ...params],
    );

  beforeAll(async () => {
    app = await bukaAplikasiUji();
    api = apiUji;

    const rt = await app.inject({
      method: "POST",
      url: `${api}/auth/pengurus/login`,
      payload: { email: "rt04@siwarga.id", password: "rahasia123" },
    });
    expect(rt.statusCode, "login RT04").toBe(200);
    sidRt = cookieDari(rt, "sid")!;
    csrfRt = cookieDari(rt, "csrf_token")!;

    const rt05 = await app.inject({
      method: "POST",
      url: `${api}/auth/pengurus/login`,
      payload: { email: "rt05@siwarga.id", password: "rahasia123" },
    });
    expect(rt05.statusCode, "login RT05").toBe(200);
    sidRt05 = cookieDari(rt05, "sid")!;
    csrfRt05 = cookieDari(rt05, "csrf_token")!;

    const ahmad = await app.inject({
      method: "POST",
      url: `${api}/auth/warga/login`,
      payload: { noHp: "081234567894", password: SANDI_WARGA_UJI },
    });
    expect(ahmad.statusCode, "login warga Ahmad Fauzi").toBe(200);
    sidAhmad = cookieDari(ahmad, "sid")!;

    const bambang = await app.inject({
      method: "POST",
      url: `${api}/auth/warga/login`,
      payload: { noHp: "081234567890", password: SANDI_WARGA_UJI },
    });
    expect(bambang.statusCode, "login warga Bambang Supriyanto").toBe(200);
    sidBambang = cookieDari(bambang, "sid")!;

    const baris = await dalamScopePlat((c) =>
      c.query(
        `SELECT w.id, k.no_kk
           FROM warga w
           JOIN kartu_keluarga k ON k.id = w.kk_id
          WHERE w.no_hp = '081234567894'`,
      ),
    );
    idAhmad = (baris.rows[0] as { id: string }).id;
    noKkAhmad = (baris.rows[0] as { no_kk: string }).no_kk;
    expect(idAhmad && noKkAhmad, "Ahmad Fauzi beserta KK-nya harus dibuat seed").not.toBe("");
  }, 60_000);

  afterAll(async () => {
    await tutupAplikasiUji();
  });

  it("guard B12: tanpa sesi / sesi warga → 401; mutasi RT tanpa CSRF → ditolak", async () => {
    for (const url of [`${api}/rt/pengaturan`, `${api}/rt/surat`]) {
      const tanpa = await app.inject({ method: "GET", url });
      expect(tanpa.statusCode, `GET ${url} tanpa sesi`).toBe(401);
      expect(isi(tanpa).error?.code).toBe("UNAUTHORIZED");

      const warga = await app.inject({ method: "GET", url, cookies: { sid: sidAhmad } });
      expect(warga.statusCode, `GET ${url} dengan sesi warga`).toBe(401);
      expect(isi(warga).error?.code).toBe("UNAUTHORIZED");
    }

    // rute warga tetap butuh sesi warga (bukan sesi sembarang / publik)
    const wargaTanpaSesi = await app.inject({ method: "GET", url: `${api}/warga/surat` });
    expect(wargaTanpaSesi.statusCode, "GET /warga/surat tanpa sesi").toBe(401);
    expect(isi(wargaTanpaSesi).error?.code).toBe("UNAUTHORIZED");

    // seluruh mutasi Portal RT wajib header x-csrf-token (§5.6)
    const mutasi: Array<{ method: "POST" | "PATCH"; url: string; payload: Record<string, unknown> }> = [
      { method: "PATCH", url: `${api}/rt/pengaturan`, payload: { kop: KOP_BARU } },
      {
        method: "POST",
        url: `${api}/rt/surat`,
        payload: {
          jenis: "Surat Keterangan Domisili",
          keperluan: "Uji guard tanpa CSRF",
          noSurat: "X/TANPA-CSRF",
          pemohon: "Ahmad Fauzi",
        },
      },
      {
        method: "POST",
        url: `${api}/rt/surat/00000000-0000-0000-0000-000000000000/terbitkan`,
        payload: {},
      },
      { method: "POST", url: `${api}/rt/surat/00000000-0000-0000-0000-000000000000/tolak`, payload: { catatan: "Uji guard" } },
    ];
    for (const m of mutasi) {
      const tanpaCsrf = await app.inject({ method: m.method, url: m.url, cookies: sesiRt(), payload: m.payload });
      expect(tanpaCsrf.statusCode, `${m.method} ${m.url} tanpa x-csrf-token`).toBe(401);
      expect(isi(tanpaCsrf).error?.message).toMatch(/CSRF/);
    }

    // sesi Portal Warga tidak pernah bisa menembus rute /rt/**
    const wargaKeRt = await app.inject({
      method: "POST",
      url: `${api}/rt/surat`,
      cookies: { sid: sidAhmad },
      headers: { "x-csrf-token": "nonce.palsu" },
      payload: {
        jenis: "Surat Keterangan Domisili",
        keperluan: "Uji guard sesi warga",
        noSurat: "X/WARGA",
        pemohon: "Ahmad Fauzi",
      },
    });
    expect(wargaKeRt.statusCode).toBe(401);
    expect(isi(wargaKeRt).error?.code).toBe("UNAUTHORIZED");

    expect(await jumlahSurat(), "percobaan gagal di atas tidak boleh meninggalkan baris").toBe(0);
  });

  it("B12 · GET/PATCH /rt/pengaturan: seed → simpan kop → merge parsial → audit", async () => {
    // 1. Seed RT04 menulis ARRAY (definisi field) di `template_surat` → kop masih null
    const awal = await app.inject({ method: "GET", url: `${api}/rt/pengaturan`, cookies: sesiRt() });
    expect(awal.statusCode).toBe(200);
    expect(isi(awal).data.kop, "seed berisi array, bukan kop").toBeNull();
    expect(isi(awal).data.notifikasiWaEnabled).toBe(true);

    // 2. Simpan kop penuh (wajib CSRF)
    const simpan = await app.inject({
      method: "PATCH",
      url: `${api}/rt/pengaturan`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
      payload: { kop: KOP_BARU },
    });
    expect(simpan.statusCode).toBe(200);
    expect(isi(simpan).data.kop).toEqual(KOP_BARU);

    // 3. Round-trip: GET ulang mengembalikan nilai yang sama
    const ulang = await app.inject({ method: "GET", url: `${api}/rt/pengaturan`, cookies: sesiRt() });
    expect(isi(ulang).data.kop).toEqual(KOP_BARU);

    // 4. PATCH parsial: hanya baris2 diganti → baris1 & baris3 dipertahankan
    const parsial = await app.inject({
      method: "PATCH",
      url: `${api}/rt/pengaturan`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
      payload: { kop: { baris2: KOP_TERSIMPAN.baris2 } },
    });
    expect(parsial.statusCode).toBe(200);
    expect(isi(parsial).data.kop).toEqual(KOP_TERSIMPAN);

    // 5. Isi kolom JSON tidak ada yang hilang: array seed pindah ke `daftarTemplate`
    const mentah = await dalamScopePlat((c) =>
      c.query("SELECT template_surat FROM pengaturan_rt WHERE rt_id = $1", [idRt04]),
    );
    const template = (mentah.rows[0] as { template_surat: unknown }).template_surat as Record<string, unknown>;
    expect(Array.isArray(template.daftarTemplate), "definisi field seed harus dipertahankan").toBe(true);
    expect((template.daftarTemplate as unknown[]).length, "8 jenis surat seed").toBe(8);
    expect(template.kop, "nilai tersimpan = hasil merge parsial").toEqual(KOP_TERSIMPAN);

    // 6. Input ditolak dengan 400 VALIDATION — tanpa jejak tulis
    const kosong = await app.inject({
      method: "PATCH",
      url: `${api}/rt/pengaturan`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
      payload: {},
    });
    expect(kosong.statusCode).toBe(400);
    expect(isi(kosong).error?.code).toBe("VALIDATION");
    expect(isi(kosong).error?.message).toMatch(/Minimal satu field/);

    const kopKosong = await app.inject({
      method: "PATCH",
      url: `${api}/rt/pengaturan`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
      payload: { kop: { baris1: "", baris2: "", baris3: "" } },
    });
    expect(kopKosong.statusCode).toBe(400);
    expect(isi(kopKosong).error?.code).toBe("VALIDATION");
    expect(isi(kopKosong).error?.message).toMatch(/minimal punya satu baris/);

    // field iuran dimiliki B7 (/rt/iuran/pengaturan) — tidak diterima di sini
    const iuran = await app.inject({
      method: "PATCH",
      url: `${api}/rt/pengaturan`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
      payload: { tenggatHari: 15 },
    });
    expect(iuran.statusCode, "PATCH field iuran → 400, bukan menimpa B7").toBe(400);
    expect(isi(iuran).error?.message).toMatch(/Minimal satu field/);

    // 7. RT05 tidak terpengaruh oleh perubahan RT04
    const rt05 = await app.inject({ method: "GET", url: `${api}/rt/pengaturan`, cookies: { sid: sidRt05 } });
    expect(rt05.statusCode).toBe(200);
    expect(isi(rt05).data.kop, "kop RT005 tidak boleh ikut berubah").toBeNull();

    // 8. Audit: tepat dua PATCH sukses, lengkap dengan diff sebelum & sesudah
    expect(await hitungAudit("aksi = 'ubah_pengaturan_surat'")).toBe(2);
    expect(
      await hitungAudit(
        "aksi = 'ubah_pengaturan_surat' AND sebelum->>'kop' IS NULL AND sesudah->'kop'->>'baris1' = $2",
        [KOP_BARU.baris1],
      ),
      "PATCH pertama mencatat kop null → kop tersimpan",
    ).toBe(1);
    expect(
      await hitungAudit(
        "aksi = 'ubah_pengaturan_surat' AND sesudah->'kop'->>'baris2' = $2 AND sesudah->'kop'->>'baris3' = $3",
        [KOP_TERSIMPAN.baris2, KOP_TERSIMPAN.baris3],
      ),
      "PATCH parsial mencatat nilai hasil merge",
    ).toBe(1);
  });

  it("B12 · PATCH /rt/pengaturan { profil }: persist ke baris `rt` + audit diff (kontrak §5.4)", async () => {
    // 1. GET kini memuat `profil` dari baris `rt` (sebelumnya form FE hanya lokal)
    const awal = await app.inject({ method: "GET", url: `${api}/rt/pengaturan`, cookies: sesiRt() });
    expect(awal.statusCode).toBe(200);
    const profilAwal = isi(awal).data.profil as { namaRt: string; alamat: string };
    expect(profilAwal, "GET wajib menyertakan profil RT").toBeDefined();
    expect(typeof profilAwal.namaRt).toBe("string");

    // 2. PATCH khusus profil → 200 (wajib CSRF) — tanpa menyentuh `pengaturan_rt`
    const NAMA = "Perumahan Siwarga Uji";
    const ALAMAT = "Jl. Uji Profil No. 7, RT 004 / RW 012";
    const simpan = await app.inject({
      method: "PATCH",
      url: `${api}/rt/pengaturan`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
      payload: { profil: { namaRt: NAMA, alamat: ALAMAT } },
    });
    expect(simpan.statusCode).toBe(200);
    expect(isi(simpan).data.profil).toEqual({ namaRt: NAMA, alamat: ALAMAT });
    expect(isi(simpan).data.kop, "PATCH profil tak merusak kop tersimpan").toEqual(KOP_TERSIMPAN);

    // 3. Persist benar-benar terjadi di tabel `rt` (bukan hanya respons API)
    const mentah = await dalamScopePlat((c) =>
      c.query("SELECT perumahan, alamat FROM rt WHERE id = $1", [idRt04]),
    );
    expect(mentah.rows[0]).toEqual({ perumahan: NAMA, alamat: ALAMAT });

    // 4. Round-trip GET ulang
    const ulang = await app.inject({ method: "GET", url: `${api}/rt/pengaturan`, cookies: sesiRt() });
    expect(isi(ulang).data.profil).toEqual({ namaRt: NAMA, alamat: ALAMAT });

    // 5. Validasi: nama kosong → 400 VALIDATION, tanpa tulis (baris tidak berubah)
    const kosong = await app.inject({
      method: "PATCH",
      url: `${api}/rt/pengaturan`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
      payload: { profil: { namaRt: "   ", alamat: ALAMAT } },
    });
    expect(kosong.statusCode).toBe(400);
    expect(isi(kosong).error?.code).toBe("VALIDATION");
    expect(isi(kosong).error?.message).toMatch(/Nama RT wajib diisi/);
    const sesudahTolak = await dalamScopePlat((c) =>
      c.query("SELECT perumahan FROM rt WHERE id = $1", [idRt04]),
    );
    expect(sesudahTolak.rows[0], "validasi gagal tidak boleh menulis").toEqual({ perumahan: NAMA });

    // 6. Audit: diff sebelum → sesudah pada entitas `rt`
    expect(
      await hitungAudit(
        "aksi = 'ubah_pengaturan_surat' AND entitas = 'rt'" +
          " AND sebelum->'profil'->>'namaRt' = $2 AND sesudah->'profil'->>'namaRt' = $3",
        [profilAwal.namaRt, NAMA],
      ),
      "PATCH profil mencatat diff sebelum & sesudah",
    ).toBe(1);

    // 7. Kembalikan nilai awal (idempoten untuk run berikutnya; tetap ter-audit)
    const balik = await app.inject({
      method: "PATCH",
      url: `${api}/rt/pengaturan`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
      payload: { profil: { namaRt: profilAwal.namaRt, alamat: profilAwal.alamat } },
    });
    expect(balik.statusCode).toBe(200);
    expect(isi(balik).data.profil).toEqual(profilAwal);
  });

  it("B12 · POST /rt/surat: buat baris idempoten + validasi pemohon (deviasi §5.4)", async () => {
    // pemohon tidak dikenal → VALIDATION & tidak ada baris baru
    // (warga tidak pernah dibuat diam-diam oleh endpoint ini)
    const sebelum = await jumlahSurat();
    const asing = await app.inject({
      method: "POST",
      url: `${api}/rt/surat`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
      payload: {
        jenis: "Surat Keterangan Domisili",
        keperluan: "Uji pemohon tidak dikenal",
        noSurat: "X/ASING",
        pemohon: "Tidak Ada Orang Begini",
      },
    });
    expect(asing.statusCode).toBe(400);
    expect(isi(asing).error?.code).toBe("VALIDATION");
    expect(await jumlahSurat()).toBe(sebelum);

    // nama dicocokkan tanpa peduli huruf besar/kecil → baris + qr_token terbit
    const buat = await app.inject({
      method: "POST",
      url: `${api}/rt/surat`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
      payload: {
        jenis: "Surat Keterangan Domisili",
        keperluan: "Pengantar administrasi sekolah",
        noSurat: NOMOR_A,
        pemohon: "ahmad fauzi",
      },
    });
    expect(buat.statusCode).toBe(200);
    const suratA = isi(buat).data.surat;
    expect(suratA.status, "surat baru selalu menunggu RT").toBe("menunggu_rt");
    expect(suratA.perluRw, "SKD tidak butuh persetujuan RW").toBe(false);
    expect(suratA.pemohon).toBe("Ahmad Fauzi");
    expect(suratA.noKk, "no_kk diambil dari KK pemohon").toBe(noKkAhmad);
    expect(suratA.qrToken, "token QR 48 hex → tautan /q/:token").toMatch(/^[0-9a-f]{48}$/);
    idSuratA = suratA.id;
    tokenA = suratA.qrToken;

    // idempoten (retry jaringan): nomor sama → baris sama, audit tetap tercatat
    const ulang = await app.inject({
      method: "POST",
      url: `${api}/rt/surat`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
      payload: {
        jenis: "Surat Keterangan Domisili",
        keperluan: "Pengantar administrasi sekolah",
        noSurat: NOMOR_A,
        pemohon: "ahmad fauzi",
      },
    });
    expect(ulang.statusCode).toBe(200);
    expect(isi(ulang).data.surat.id, "nomor unik per RT → baris yang sama").toBe(idSuratA);
    expect(
      await hitungAudit("aksi = 'buat_surat' AND entitas_id = $2", [idSuratA]),
      "pembuatan ulang tetap dicatat audit",
    ).toBe(2);
  });

  it("B12 · transisi status: tolak / minta-perbaikan / setujui (idempoten + 409)", async () => {
    const kirim = (aksi: string, payload: Record<string, unknown> = {}) =>
      app.inject({
        method: "POST",
        url: `${api}/rt/surat/${idSuratA}/${aksi}`,
        cookies: sesiRt(),
        headers: csrfRtHeader(),
        payload,
      });

    // — tolak: alasan wajib -----------------------------------------------
    const tanpaAlasan = await kirim("tolak");
    expect(tanpaAlasan.statusCode, "badan kosong → 400").toBe(400);
    expect(isi(tanpaAlasan).error?.code).toBe("VALIDATION");

    const alasanPendek = await kirim("tolak", { catatan: "ab" });
    expect(alasanPendek.statusCode).toBe(400);
    expect(isi(alasanPendek).error?.message).toMatch(/Alasan penolakan/);

    const tolak = await kirim("tolak", { catatan: "Berkas pendukung belum lengkap" });
    expect(tolak.statusCode).toBe(200);
    expect(isi(tolak).data).toMatchObject({ ulang: false, surat: { status: "ditolak" } });
    expect(isi(tolak).data.surat.catatan).toBe("Berkas pendukung belum lengkap");

    const tolakUlang = await kirim("tolak", { catatan: "Berkas pendukung belum lengkap" });
    expect(tolakUlang.statusCode).toBe(200);
    expect(isi(tolakUlang).data.ulang, "tolak dua kali tidak menggandakan audit").toBe(true);

    // surat ditolak tidak bisa langsung diterbitkan
    const terbitAfkir = await kirim("terbitkan");
    expect(terbitAfkir.statusCode).toBe(409);
    expect(isi(terbitAfkir).error?.code).toBe("CONFLICT");

    // — minta perbaikan (catatan opsional) ---------------------------------
    const perbaikan = await kirim("minta-perbaikan", { catatan: "Lampirkan surat domisili RT" });
    expect(perbaikan.statusCode).toBe(200);
    expect(isi(perbaikan).data).toMatchObject({ ulang: false, surat: { status: "perlu_perbaikan" } });

    const perbaikanUlang = await kirim("minta-perbaikan");
    expect(perbaikanUlang.statusCode).toBe(200);
    expect(isi(perbaikanUlang).data.ulang).toBe(true);

    // — setujui: non-RW → disetujui + terbit_pada ---------------------------
    const setujui = await kirim("setujui");
    expect(setujui.statusCode).toBe(200);
    expect(isi(setujui).data).toMatchObject({ ulang: false, surat: { status: "disetujui", perluRw: false } });
    expect(isi(setujui).data.surat.terbitPada, "terbit_pada terisi saat disetujui").toBeTruthy();

    const setujuiUlang = await kirim("setujui");
    expect(setujuiUlang.statusCode).toBe(200);
    expect(isi(setujuiUlang).data.ulang).toBe(true);

    // — surat terbit tidak bisa ditolak / diminta perbaikan ----------------
    const tolakTerbit = await kirim("tolak", { catatan: "Dicabut lagi" });
    expect(tolakTerbit.statusCode).toBe(409);
    expect(isi(tolakTerbit).error?.message).toMatch(/sudah terbit/);

    const perbaikanTerbit = await kirim("minta-perbaikan");
    expect(perbaikanTerbit.statusCode).toBe(409);
    expect(isi(perbaikanTerbit).error?.message).toMatch(/sudah terbit/);

    // — audit: satu baris per transisi nyata + diff status ------------------
    expect(await hitungAudit("aksi = 'tolak_surat' AND entitas_id = $2", [idSuratA])).toBe(1);
    expect(await hitungAudit("aksi = 'minta_perbaikan_surat' AND entitas_id = $2", [idSuratA])).toBe(1);
    expect(await hitungAudit("aksi = 'setujui_surat' AND entitas_id = $2", [idSuratA])).toBe(1);
    expect(
      await hitungAudit(
        "aksi = 'setujui_surat' AND entitas_id = $2 AND sebelum->>'status' = 'perlu_perbaikan'" +
          " AND sesudah->>'status' = 'disetujui'",
        [idSuratA],
      ),
      "audit menyimpan diff status sebelum & sesudah",
    ).toBe(1);
  });

  it("B12 · jenis butuh RW: terbitkan → menunggu_rw, terbit_pada tetap null", async () => {
    const buat = await app.inject({
      method: "POST",
      url: `${api}/rt/surat`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
      payload: {
        jenis: "Surat Pengantar SKCK",
        keperluan: "Pengantar pembuatan SKCK",
        noSurat: NOMOR_B,
        wargaId: idAhmad,
      },
    });
    expect(buat.statusCode).toBe(200);
    const suratB = isi(buat).data.surat;
    expect(suratB.perluRw, "SKCK butuh persetujuan RW").toBe(true);
    expect(suratB.status).toBe("menunggu_rt");
    idSuratB = suratB.id;
    tokenB = suratB.qrToken;

    const terbit = await app.inject({
      method: "POST",
      url: `${api}/rt/surat/${idSuratB}/terbitkan`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
      payload: {},
    });
    expect(terbit.statusCode).toBe(200);
    expect(isi(terbit).data).toMatchObject({ ulang: false, surat: { status: "menunggu_rw" } });
    expect(isi(terbit).data.surat.terbitPada, "belum terbit sampai RW menyetujui").toBeNull();

    const ulang = await app.inject({
      method: "POST",
      url: `${api}/rt/surat/${idSuratB}/terbitkan`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
      payload: {},
    });
    expect(ulang.statusCode).toBe(200);
    expect(isi(ulang).data.ulang).toBe(true);

    expect(await hitungAudit("aksi = 'terbitkan_surat' AND entitas_id = $2", [idSuratB])).toBe(1);
  });

  it("B12 · GET /rt/surat: filter status + isolasi antar RT", async () => {
    const semua = await app.inject({ method: "GET", url: `${api}/rt/surat`, cookies: sesiRt() });
    expect(semua.statusCode).toBe(200);
    const daftar = isi(semua).data.surat as Array<{ id: string }>;
    expect(daftar.map((s) => s.id)).toEqual(expect.arrayContaining([idSuratA, idSuratB]));

    const disetujui = await app.inject({ method: "GET", url: `${api}/rt/surat?status=disetujui`, cookies: sesiRt() });
    expect(disetujui.statusCode).toBe(200);
    const daftarDisetujui = isi(disetujui).data.surat as Array<{ id: string; status: string }>;
    expect(daftarDisetujui.length).toBeGreaterThan(0);
    expect(daftarDisetujui.every((s) => s.status === "disetujui")).toBe(true);
    expect(daftarDisetujui.some((s) => s.id === idSuratA)).toBe(true);

    const menungguRw = await app.inject({
      method: "GET",
      url: `${api}/rt/surat?status=menunggu_rw`,
      cookies: sesiRt(),
    });
    expect((isi(menungguRw).data.surat as Array<{ id: string }>).map((s) => s.id)).toEqual([idSuratB]);

    const rusak = await app.inject({ method: "GET", url: `${api}/rt/surat?status=Acak`, cookies: sesiRt() });
    expect(rusak.statusCode).toBe(400);
    expect(isi(rusak).error?.code).toBe("VALIDATION");

    // RT05: daftar tidak memuat satu pun baris RT04 (RLS)…
    const rt05 = await app.inject({ method: "GET", url: `${api}/rt/surat`, cookies: { sid: sidRt05 } });
    expect(rt05.statusCode).toBe(200);
    const daftar05 = isi(rt05).data.surat as Array<{ id: string }>;
    expect(daftar05.some((s) => s.id === idSuratA || s.id === idSuratB)).toBe(false);

    // …dan aksi ke baris RT04 dijawab 404 (bukan 403) — tidak membocorkan keberadaan
    const curi = await app.inject({
      method: "POST",
      url: `${api}/rt/surat/${idSuratA}/terbitkan`,
      cookies: { sid: sidRt05, csrf_token: csrfRt05 },
      headers: { "x-csrf-token": csrfRt05 },
      payload: {},
    });
    expect(curi.statusCode).toBe(404);
    expect(isi(curi).error?.code).toBe("NOT_FOUND");
  });

  it("B12 · Portal Warga: daftar milik sesi + kop RT + ajukan surat (auto nomor)", async () => {
    const daftar = await app.inject({ method: "GET", url: `${api}/warga/surat`, cookies: { sid: sidAhmad } });
    expect(daftar.statusCode).toBe(200);
    expect(isi(daftar).data.kop, "kop RT04 ikut dikirim untuk unduh PDF").toEqual(KOP_TERSIMPAN);
    const barisAhmad = isi(daftar).data.surat as Array<{ id: string; pemohon: string; noKk: string }>;
    expect(barisAhmad.length).toBeGreaterThan(0);
    expect(barisAhmad.map((s) => s.id)).toContain(idSuratA);
    expect(barisAhmad.every((s) => s.pemohon === "Ahmad Fauzi")).toBe(true);
    expect(barisAhmad.every((s) => s.noKk === noKkAhmad), "no_kk diambil dari KK pemilik sesi").toBe(true);

    // Bambang tidak melihat surat Ahmad — RLS hanya setingkat RT,
    // filter `warga_id` wajib ada di query (catatan desain endpoint)
    const bambang = await app.inject({ method: "GET", url: `${api}/warga/surat`, cookies: { sid: sidBambang } });
    expect(bambang.statusCode).toBe(200);
    const barisBambang = isi(bambang).data.surat as Array<{ id: string; pemohon: string }>;
    expect(barisBambang.some((s) => s.id === idSuratA)).toBe(false);
    expect(barisBambang.every((s) => s.pemohon !== "Ahmad Fauzi")).toBe(true);

    // ajukan surat: TANPA header CSRF (§5.6) & TANPA nomor → dihasilkan server
    const ajukan = await app.inject({
      method: "POST",
      url: `${api}/warga/surat`,
      cookies: { sid: sidAhmad },
      payload: { jenis: "Surat Pengantar Pindah", keperluan: "Pindah domisili ke luar kota" },
    });
    expect(ajukan.statusCode).toBe(200);
    const baru = isi(ajukan).data.surat;
    expect(baru.status).toBe("menunggu_rt");
    expect(baru.perluRw, "Pindah butuh persetujuan RW").toBe(true);
    expect(baru.pemohon).toBe("Ahmad Fauzi");
    expect(baru.noKk).toBe(noKkAhmad);
    expect(baru.qrToken).toMatch(/^[0-9a-f]{48}$/);
    expect(baru.noSurat, "format KODE/004-012/MM/YYYY/NNN").toMatch(/^SKP\/004-012\/\d{2}\/\d{4}\/\d{3}$/);
    expect(baru.noSurat.endsWith("/003"), "berikutnya setelah dua nomor RT di atas").toBe(true);
    idSuratWarga = baru.id;

    // keperluan terlalu pendek → 400 VALIDATION, tanpa baris baru
    const pendek = await app.inject({
      method: "POST",
      url: `${api}/warga/surat`,
      cookies: { sid: sidAhmad },
      payload: { jenis: "Surat Pengantar Pindah", keperluan: "ab" },
    });
    expect(pendek.statusCode).toBe(400);
    expect(isi(pendek).error?.code).toBe("VALIDATION");

    // audit: actor = warga sendiri, portal warga, aksi ajukan_surat
    expect(
      await hitungAudit("aksi = 'ajukan_surat' AND entitas_id = $2 AND actor_id = $3", [idSuratWarga, idAhmad]),
      "aksi warga dicatat dengan actor_id pemohon",
    ).toBe(1);
    expect(await hitungAudit("aksi = 'ajukan_surat' AND entitas_id = $2 AND portal = 'warga'", [idSuratWarga])).toBe(1);
  });

  it("B12 · verifikasi publik QR: selalu 200, anti-enumerasi, tanpa data pribadi", async () => {
    // format token salah → 200 valid:false (bukan 404 yang membuka celah enumerasi)
    const rusak = await app.inject({ method: "GET", url: `${api}/publik/verifikasi-surat/abc` });
    expect(rusak.statusCode).toBe(200);
    expect(isi(rusak).data).toEqual({ valid: false, alasan: "Token verifikasi tidak valid." });

    // format benar tapi tidak tercatat (baris contoh/demo tanpa baris server)
    const asing = await app.inject({
      method: "GET",
      url: `${api}/publik/verifikasi-surat/${randomUUID().replace(/-/g, "")}`,
    });
    expect(asing.statusCode).toBe(200);
    expect(isi(asing).data.valid, "verifikasi tidak pernah dipalsukan jadi valid").toBe(false);
    expect(isi(asing).data.alasan).toMatch(/tidak tercatat/);

    // surat belum terbit (menunggu RW) → valid:false dengan alasan status
    const belum = await app.inject({ method: "GET", url: `${api}/publik/verifikasi-surat/${tokenB}` });
    expect(belum.statusCode).toBe(200);
    expect(isi(belum).data.valid).toBe(false);
    expect(isi(belum).data.alasan).toMatch(/Menunggu RW/);

    // surat disetujui → valid:true + identitas RT, TANPA data pribadi pemohon
    const sah = await app.inject({ method: "GET", url: `${api}/publik/verifikasi-surat/${tokenA}` });
    expect(sah.statusCode).toBe(200);
    const data = isi(sah).data;
    expect(data.valid).toBe(true);
    expect(data.surat.noSurat).toBe(NOMOR_A);
    expect(data.surat.status).toBe("disetujui");
    expect(data.surat.rt.kodeRt).toBe("004");
    expect(data.surat.rt.kodeRw).toBe("012");
    expect(data.surat.terbitPada).toBeTruthy();
    for (const kunci of ["noKk", "nik", "keperluan", "wargaId", "catatan", "qrToken"]) {
      expect(Object.keys(data.surat), `field "${kunci}" tidak boleh bocor ke publik`).not.toContain(kunci);
    }
  });
});


describe("A10 · Migrasi Data — impor CSV/XLSX (/rt/warga/import · §9.1(6) · §5.4)", () => {
  let app: FastifyInstance;
  let api = "/api/v1";
  let sidRt = "";
  let csrfRt = "";
  let sidRt05 = "";
  let csrfRt05 = "";
  let sidWarga = "";

  const sesiRt = () => ({ sid: sidRt, csrf_token: csrfRt });

  /**
   * Multipart mentah (tanpa dependensi): field `file` berisi bytes — mendukung
   * teks CSV maupun buffer biner XLSX. `tanpaCsrf` sengaja membuang cookie &
   * header untuk menguji guard.
   */
  const kirim = (
    namaFile: string,
    isiBerkas: string | Buffer,
    opsi: { sid?: string; csrf?: string; tanpaCsrf?: boolean } = {},
  ) => {
    const B = `----ujiimpor${randomUUID().replace(/-/g, "").slice(0, 10)}`;
    const bagian = Buffer.isBuffer(isiBerkas) ? isiBerkas : Buffer.from(isiBerkas, "utf8");
    const payload = Buffer.concat([
      Buffer.from(
        `--${B}\r\nContent-Disposition: form-data; name="file"; filename="${namaFile}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
        "utf8",
      ),
      bagian,
      Buffer.from(`\r\n--${B}--\r\n`, "utf8"),
    ]);
    const sid = opsi.sid ?? sidRt;
    const csrf = opsi.csrf ?? csrfRt;
    return app.inject({
      method: "POST",
      url: `${api}/rt/warga/import`,
      cookies: opsi.tanpaCsrf ? { sid } : { sid, csrf_token: csrf },
      headers: {
        "content-type": `multipart/form-data; boundary=${B}`,
        ...(opsi.tanpaCsrf ? {} : { "x-csrf-token": csrf }),
      },
      payload,
    });
  };

  /** 3 baris contoh: 1 kelompok 2 anggota (inferensi kepala) + 1 KK tunggal. */
  const CSV_SUKSES = [
    "Nama,NIK,No. KK,Alamat,No. WA,Email",
    "Uji Impor Satu,3171050101990001,3171050101990010,Jl. Impor No. 1,081299000991,satu@uji.test",
    "Uji Impor Dua,3171050101990002,3171050101990010,Jl. Impor No. 1,,dua@uji.test",
    "Uji Impor Tiga,3171050101990003,3171050101990011,Jl. Impor No. 2,,",
  ].join("\r\n");

  beforeAll(async () => {
    app = await bukaAplikasiUji();
    api = apiUji;

    const rt = await app.inject({
      method: "POST",
      url: `${api}/auth/pengurus/login`,
      payload: { email: "rt04@siwarga.id", password: "rahasia123" },
    });
    expect(rt.statusCode, "login RT04").toBe(200);
    sidRt = cookieDari(rt, "sid")!;
    csrfRt = cookieDari(rt, "csrf_token")!;

    const rt05 = await app.inject({
      method: "POST",
      url: `${api}/auth/pengurus/login`,
      payload: { email: "rt05@siwarga.id", password: "rahasia123" },
    });
    expect(rt05.statusCode, "login RT05").toBe(200);
    sidRt05 = cookieDari(rt05, "sid")!;
    csrfRt05 = cookieDari(rt05, "csrf_token")!;

    const w = await app.inject({
      method: "POST",
      url: `${api}/auth/warga/login`,
      payload: { noHp: "081234567890", password: SANDI_WARGA_UJI },
    });
    expect(w.statusCode, "login warga").toBe(200);
    sidWarga = cookieDari(w, "sid")!;
  }, 60_000);

  afterAll(async () => {
    // Jejak berkas impor uji dihapus (folder & DB uji sementara dibuang
    // cluster embedded di akhir proses tes — berkasnya tidak).
    try {
      const ada = readdirSync(join(DIR_SERVER, ".data-impor")).filter((n) =>
        /(uji-sukses|uji-campuran|lintas-rt)\.csv$|uji\.xlsx$/.test(n),
      );
      await Promise.all(ada.map((n) => rm(join(DIR_SERVER, ".data-impor", n), { force: true })));
    } catch {
      /* folder mungkin belum pernah terbentuk */
    }
    await tutupAplikasiUji();
  });

  it("guard: tanpa sesi / sesi warga / tanpa CSRF → 401; struktur file salah → 400 tanpa jejak impor_data", async () => {
    const tanpa = await app.inject({ method: "POST", url: `${api}/rt/warga/import` });
    expect(tanpa.statusCode).toBe(401);
    expect(isi(tanpa).error?.code).toBe("UNAUTHORIZED");

    // sesi warga lolos CSRF (cookie+header cocok) namun ditolak wajibRt (scope)
    const warga = await kirim("uji-sukses.csv", CSV_SUKSES, { sid: sidWarga, csrf: "nonce-kebaca" });
    expect(warga.statusCode, "rute RT menolak sesi warga").toBe(401);

    const tanpaCsrf = await kirim("uji-sukses.csv", CSV_SUKSES, { tanpaCsrf: true });
    expect(tanpaCsrf.statusCode).toBe(401);
    expect(isi(tanpaCsrf).error?.message).toMatch(/CSRF/);

    // kolom wajib hilang → 400 menyebut kolomnya, TANPA baris impor_data
    const kolom = await kirim("kurang-kolom.csv", "Nama,NIK,Alamat\r\nUji,3171050101990001,Jl. X");
    expect(kolom.statusCode).toBe(400);
    expect(isi(kolom).error?.code).toBe("VALIDATION");
    expect(isi(kolom).error?.message).toMatch(/No\. KK/);
    expect(await hitung(PLATFORM, "SELECT count(*)::int AS n FROM impor_data")).toBe(0);

    // ekstensi di luar kontrak → 400
    const txt = await kirim("data.txt", "bukan csv sama sekali");
    expect(txt.statusCode).toBe(400);
    expect(isi(txt).error?.message).toMatch(/csv/i);
    expect(await hitung(PLATFORM, "SELECT count(*)::int AS n FROM impor_data")).toBe(0);
  });

  it("impor sukses CSV: warga+KK masuk, impor_data tercatat dengan berkas nyata, audit, NIK ter-encrypt", async () => {
    const res = await kirim("uji-sukses.csv", CSV_SUKSES);
    expect(res.statusCode).toBe(200);
    const d = isi(res).data as {
      status: string;
      jumlahBaris: number;
      berhasil: number;
      gagal: number;
      alasan: unknown[];
    };
    expect(d).toMatchObject({ status: "selesai", jumlahBaris: 3, berhasil: 3, gagal: 0 });
    expect(d.alasan).toEqual([]);
    // §14: payload respons tidak pernah memuat NIK plaintext
    expect(JSON.stringify(d)).not.toMatch(/\b\d{16}\b/);

    const g = await app.inject({ method: "GET", url: `${api}/rt/warga`, cookies: sesiRt() });
    expect(g.statusCode).toBe(200);
    const data = isi(g).data as {
      warga: { nama: string; nikMasked: string | null; hubungan: string; kk: { noKk: string } }[];
      keluarga: { kk: { noKk: string; kepala: string; jumlahAnggota: number } }[];
    };
    const satu = data.warga.find((x) => x.nama === "Uji Impor Satu");
    expect(satu, "baris impor terbaca via GET").toBeTruthy();
    expect(satu!.nikMasked).toMatch(/x{4}/);
    expect(JSON.stringify(data), "GET tanpa NIK plaintext").not.toMatch(/\b\d{16}\b/);

    const kk10 = data.keluarga.find((k) => k.kk.noKk === "3171-xxxx-xxxx-0010");
    expect(kk10, "KK kelompok No.KK ...0010 dibuat impor").toBeTruthy();
    expect(kk10!.kk.kepala, "inferensi: baris pertama = kepala").toBe("Uji Impor Satu");
    expect(kk10!.kk.jumlahAnggota).toBe(2);

    // NIK tersimpan ter-encrypt — dekripsi memakai kunci uji membuktikannya
    const q = await denganScope(PLATFORM, (c) =>
      c.query("SELECT nik_encrypted FROM warga WHERE rt_id = $1 AND nama = 'Uji Impor Satu'", [idRt04]),
    );
    expect(q.rows.length, "baris warga impor ada di DB").toBe(1);
    expect(dekripsiNik(q.rows[0].nik_encrypted as Uint8Array, Buffer.from(KUNCI_NIK, "base64"))).toBe(
      "3171050101990001",
    );

    // impor_data tercatat + berkas TERSIMPAN nyata (file_url tidak bohong)
    const im = await denganScope(PLATFORM, (c) =>
      c.query(
        "SELECT file_url, status, berhasil, gagal, jumlah_baris, diunggah_oleh FROM impor_data WHERE nama_file = 'uji-sukses.csv'",
      ),
    );
    expect(im.rows.length).toBe(1);
    const baris = im.rows[0] as {
      file_url: string;
      status: string;
      berhasil: number;
      gagal: number;
      jumlah_baris: number;
      diunggah_oleh: string;
    };
    expect(baris).toMatchObject({ status: "selesai", berhasil: 3, gagal: 0, jumlah_baris: 3 });
    expect(baris.file_url).toMatch(/^\.data-impor\//);
    expect(baris.diunggah_oleh, "pelaku = pengurus RT aktif").toBeTruthy();
    expect(existsSync(join(DIR_SERVER, baris.file_url)), "berkas benar-benar ada di disk").toBe(true);

    // jejak audit — antrian nama file + hitungan saja (tanpa NIK)
    expect(
      await hitung({ level: "rt", id: idRt04 }, "SELECT count(*)::int AS n FROM audit_log WHERE aksi = 'impor_warga'"),
    ).toBeGreaterThan(0);
    const au = await denganScope(PLATFORM, (c) =>
      c.query("SELECT ringkasan, sesudah FROM audit_log WHERE aksi = 'impor_warga' ORDER BY created_at DESC LIMIT 1"),
    );
    expect(JSON.stringify(au.rows), "audit tanpa NIK plaintext").not.toMatch(/\b\d{16}\b/);
    expect(String((au.rows[0] as { ringkasan: string }).ringkasan)).toMatch(/uji-sukses\.csv/);
  });

  it("impor ulang file identik → nol duplikat (dedup NIK per-RT) + status 'gagal' jujur", async () => {
    const res = await kirim("uji-sukses.csv", CSV_SUKSES);
    expect(res.statusCode).toBe(200);
    const d = isi(res).data as { status: string; berhasil: number; gagal: number; alasan: { pesan: string }[] };
    expect(d).toMatchObject({ status: "gagal", berhasil: 0, gagal: 3 });
    expect(d.alasan, "alasan per baris ikut dikirim").toHaveLength(3);
    expect(d.alasan[0].pesan).toMatch(/sudah terdaftar/);

    // nol baris ganda — jumlah "Uji Impor" di RT04 tetap 3
    expect(
      await hitung(PLATFORM, "SELECT count(*)::int AS n FROM warga WHERE rt_id = $1 AND nama LIKE 'Uji Impor%'", [
        idRt04,
      ]),
    ).toBe(3);
    // percobaan kedua tetap tercatat sebagai impor_data (jejak audit usaha impor)
    expect(
      await hitung(PLATFORM, "SELECT count(*)::int AS n FROM impor_data WHERE nama_file = 'uji-sukses.csv'"),
    ).toBe(2);
  });

  it("baris rusak dicatat per-baris tanpa membatalkan baris valid; baris baru bergabung ke KK lama", async () => {
    const csv = [
      "Nama,NIK,No. KK,Alamat,No. WA,Email",
      "Uji Impor Empat,3171050101990004,3171050101990010,Jl. Impor No. 1,,",
      "Rusak NIK,12345,3171050101990013,Jl. Rusak No. 1,,",
    ].join("\r\n");
    const res = await kirim("uji-campuran.csv", csv);
    expect(res.statusCode).toBe(200);
    const d = isi(res).data as {
      status: string;
      berhasil: number;
      gagal: number;
      alasan: { nomor: number; nama: string; pesan: string }[];
    };
    expect(d).toMatchObject({ status: "selesai", berhasil: 1, gagal: 1 });
    expect(d.alasan[0]).toMatchObject({ nomor: 3, nama: "Rusak NIK" });
    expect(d.alasan[0].pesan).toMatch(/16 digit/);

    const g = await app.inject({ method: "GET", url: `${api}/rt/warga`, cookies: sesiRt() });
    const data = isi(g).data as {
      warga: { nama: string }[];
      keluarga: { kk: { noKk: string; kepala: string; jumlahAnggota: number } }[];
    };
    expect(data.warga.some((x) => x.nama === "Uji Impor Empat"), "baris valid tetap masuk").toBe(true);
    const kk10 = data.keluarga.find((k) => k.kk.noKk === "3171-xxxx-xxxx-0010")!;
    expect(kk10.kk.kepala, "kepala lama tidak tergeser oleh anggota baru").toBe("Uji Impor Satu");
    expect(kk10.kk.jumlahAnggota, "jumlah_anggota KK lama ikut digeser").toBe(3);
  });

  it("melebihi cap 1000 baris → 400 tanpa jejak", async () => {
    const baris = ["Nama,NIK,No. KK,Alamat"];
    for (let i = 0; i < 1001; i++) baris.push(`Warga Cap ${i},1,2,3`);
    const res = await kirim("uji-cap.csv", baris.join("\r\n"));
    expect(res.statusCode).toBe(400);
    expect(isi(res).error?.message).toMatch(/melebihi/);
    expect(await hitung(PLATFORM, "SELECT count(*)::int AS n FROM impor_data WHERE nama_file = 'uji-cap.csv'")).toBe(
      0,
    );
  });

  it("dedup NIK bersifat PER-RT: RT05 boleh mengimpor NIK yang sama milik RT04, cakupan terisolasi", async () => {
    const csv = [
      "Nama,NIK,No. KK,Alamat,No. WA,Email",
      "Uji Impor Lintas,3171050101990001,3171050101990014,Jl. Lintas No. 1,,",
    ].join("\r\n");
    const res = await kirim("lintas-rt.csv", csv, { sid: sidRt05, csrf: csrfRt05 });
    expect(res.statusCode).toBe(200);
    expect(isi(res).data).toMatchObject({ status: "selesai", berhasil: 1, gagal: 0 });

    // RT04 tak tersentuh oleh impor RT05
    expect(
      await hitung(PLATFORM, "SELECT count(*)::int AS n FROM warga WHERE rt_id = $1 AND nama = 'Uji Impor Satu'", [
        idRt04,
      ]),
    ).toBe(1);

    const r05 = await app.inject({ method: "GET", url: `${api}/rt/warga`, cookies: { sid: sidRt05 } });
    const data05 = isi(r05).data as { warga: { nama: string }[] };
    expect(data05.warga.some((x) => x.nama === "Uji Impor Lintas"), "baris RT05 = milik RT05").toBe(true);
    expect(data05.warga.some((x) => x.nama === "Uji Impor Satu"), "RT05 tak melihat warga RT04").toBe(false);
  });

  it("impor XLSX (sheet pertama; sel teks & angka) sukses dengan NIK numerik ter-encrypt", async () => {
    const modul = await import("exceljs");
    const ExcelJS = modul.default;
    const buku = new ExcelJS.Workbook();
    const lembar = buku.addWorksheet("Data");
    lembar.addRow(["Nama", "NIK", "No. KK", "Alamat", "No. WA", "Email"]);
    lembar.addRow(["Uji Impor Xlsx", "3171050101990005", "3171050101990015", "Jl. Xlsx No. 9", "", ""]);
    // NIK sebagai angka — uji normalisasi sel numerik (16 digit < 2^53)
    lembar.addRow(["Uji Impor Angka", 3171050101990006, 3171050101990016, "Jl. Xlsx No. 10", "", ""]);
    const buf = Buffer.from(await buku.xlsx.writeBuffer());

    const res = await kirim("uji.xlsx", buf);
    expect(res.statusCode).toBe(200);
    expect(isi(res).data).toMatchObject({ status: "selesai", jumlahBaris: 2, berhasil: 2, gagal: 0 });

    const q = await denganScope(PLATFORM, (c) =>
      c.query("SELECT nik_encrypted FROM warga WHERE rt_id = $1 AND nama = 'Uji Impor Angka'", [idRt04]),
    );
    expect(q.rows.length, "baris XLSX numerik masuk").toBe(1);
    expect(dekripsiNik(q.rows[0].nik_encrypted as Uint8Array, Buffer.from(KUNCI_NIK, "base64"))).toBe(
      "3171050101990006",
    );
  });
});

// ---------------------------------------------------------------------------
// Data Hunian Portal RT (§5.4 · PRD §6.1) + perbaikan tautan rumah PATCH
// /rt/warga/:id.
//
// Bug "input data hunian terputus" (Okt 2026): unit baru sebelumnya hanya
// hidup di state demo FE — tak pernah masuk tabel `rumah`, hilang saat muat
// ulang, tak muncul di dropdown alamat Data Warga, dan KK pada alamat itu
// tetap `rumah_id = NULL` (Status Hunian kosong + undangan §6.3 terblokir).
// Blok ini mengunci kontrak GET/POST /rt/hunian di atas PostgreSQL sungguhan:
// guard sesi/CSRF, tulis DB + audit, unik blok/alamat per RT (409), tautan
// balik KK/warga, isolasi lintas-RT, dan re-link saat alamat warga berubah.
// ---------------------------------------------------------------------------
describe("Data Hunian Portal RT (GET/POST /rt/hunian · §5.4/§6.1)", () => {
  type BarisHunian = {
    id: string;
    kodeRumah: string;
    alamat: string;
    alamatPendek: string;
    statusHuni: string;
    unitKendaraanR4: number;
    jumlahKk: number;
    penghuni: string[];
  };

  let app: FastifyInstance;
  let api = "/api/v1";
  let sidRt = "";
  let csrfRt = "";
  let sidRt05 = "";
  let sidWarga = "";
  /** Unit hunian buatan tes POST + KK uji tertaut (urut berjalan). */
  let idHunian = "";
  let idKkUji = "";

  const sesiRt = () => ({ sid: sidRt, csrf_token: csrfRt });
  const csrfRtHeader = () => ({ "x-csrf-token": csrfRt });

  /** ID aman: "" bila tak ada baris (bukan exception) — pola B13. */
  const ambilId = async (sql: string, params: unknown[]): Promise<string> => {
    const r = await denganScope(PLATFORM, (c) => c.query(sql, params));
    return r.rows[0] ? String((r.rows[0] as { id: string }).id) : "";
  };

  beforeAll(async () => {
    app = await bukaAplikasiUji();
    api = apiUji;

    const rt = await app.inject({
      method: "POST",
      url: `${api}/auth/pengurus/login`,
      payload: { email: "rt04@siwarga.id", password: "rahasia123" },
    });
    expect(rt.statusCode, "login RT04").toBe(200);
    sidRt = cookieDari(rt, "sid")!;
    csrfRt = cookieDari(rt, "csrf_token")!;

    const rt05 = await app.inject({
      method: "POST",
      url: `${api}/auth/pengurus/login`,
      payload: { email: "rt05@siwarga.id", password: "rahasia123" },
    });
    expect(rt05.statusCode, "login RT05").toBe(200);
    sidRt05 = cookieDari(rt05, "sid")!;

    const w = await app.inject({
      method: "POST",
      url: `${api}/auth/warga/login`,
      payload: { noHp: "081234567890", password: SANDI_WARGA_UJI },
    });
    expect(w.statusCode, "login warga").toBe(200);
    sidWarga = cookieDari(w, "sid")!;
  }, 60_000);

  afterAll(async () => {
    await tutupAplikasiUji();
  });

  it("guard baca: tanpa sesi / sesi warga → 401; daftar terskop RT + turunan jumlah_kk & penghuni dari KK ter-link", async () => {
    const tanpa = await app.inject({ method: "GET", url: `${api}/rt/hunian` });
    expect(tanpa.statusCode).toBe(401);
    expect(isi(tanpa).error?.code).toBe("UNAUTHORIZED");

    const warga = await app.inject({ method: "GET", url: `${api}/rt/hunian`, cookies: { sid: sidWarga } });
    expect(warga.statusCode, "sesi warga tidak boleh baca rute RT").toBe(401);

    const ok = await app.inject({ method: "GET", url: `${api}/rt/hunian`, cookies: { sid: sidRt } });
    expect(ok.statusCode).toBe(200);
    const daftar = isi(ok).data as { hunian: BarisHunian[] };
    expect(daftar.hunian.length, "minimal rumah seed B4-12 & A1-03").toBeGreaterThanOrEqual(2);

    const b412 = daftar.hunian.find((h) => h.kodeRumah === "B4-12");
    expect(b412, "rumah seed B4-12 terbaca lewat rute baru").toBeTruthy();
    expect(b412!.alamat).toBe("Jl. Melati Blok B No. 12");
    expect(b412!.alamatPendek).toBe("Blok B4 No. 12");
    expect(b412!.statusHuni).toBe("milik");
    expect(b412!.jumlahKk, "jumlah_kk = KK ter-link (≥ 2 KK seed di alamat itu)").toBeGreaterThanOrEqual(2);
    expect(b412!.penghuni.length, "penghuni diturunkan dari kepala KK ter-link").toBe(b412!.jumlahKk);
    expect(b412!.penghuni).toContain("Bambang Supriyanto");

    // Skop lintas-RT: RT05 tidak melihat rumah RT04
    const r05 = await app.inject({ method: "GET", url: `${api}/rt/hunian`, cookies: { sid: sidRt05 } });
    expect(r05.statusCode).toBe(200);
    const daftar05 = isi(r05).data as { hunian: BarisHunian[] };
    expect(
      daftar05.hunian.some((h) => h.alamat === "Jl. Melati Blok B No. 12" || h.kodeRumah === "B4-12"),
      "rumah RT04 tidak bocor ke RT05",
    ).toBe(false);
  });

  it("POST sukses: unit masuk tabel `rumah` + tautan balik KK/warga tanpa rumah + audit", async () => {
    // 1. KK dulu pada alamat yang BELUM punya unit → rumah_id NULL (kondisi bug)
    const kkBaru = await app.inject({
      method: "POST",
      url: `${api}/rt/warga`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
      payload: {
        noKk: "3171050101050088",
        alamat: "Blok Uji No. 77",
        anggota: [
          {
            nama: "Uji Hunian Penghuni",
            nik: "3171050101800088",
            hubungan: "kepala",
            jenisKelamin: "laki_laki",
            agama: "Islam",
            tanggalLahir: "1980-05-05",
            pekerjaan: "Wiraswasta",
            noHp: "081299000888",
          },
        ],
      },
    });
    expect(kkBaru.statusCode, "POST /rt/warga (alamat baru tanpa rumah)").toBe(200);
    idKkUji = isi(kkBaru).data.keluarga.kk.id as string;
    expect(
      await hitung(PLATFORM, "SELECT count(*)::int AS n FROM kartu_keluarga WHERE id = $1 AND rumah_id IS NULL", [
        idKkUji,
      ]),
      "kondisi awal: KK belum ter-link rumah",
    ).toBe(1);

    // 2. RT menambah hunian pada alamat itu — inilah perbaikan "terputus"
    const tambah = await app.inject({
      method: "POST",
      url: `${api}/rt/hunian`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
      payload: { kodeRumah: "U77", alamat: "Blok Uji No. 77", statusHuni: "milik" },
    });
    expect(tambah.statusCode).toBe(200);
    const balas = isi(tambah).data as { hunian: BarisHunian };
    expect(balas.hunian).toMatchObject({
      kodeRumah: "U77",
      alamat: "Blok Uji No. 77",
      alamatPendek: "Blok Uji No. 77",
      statusHuni: "milik",
      jumlahKk: 1,
    });
    expect(balas.hunian.penghuni, "turunan penghuni dari KK tertaut").toEqual(["Uji Hunian Penghuni"]);
    idHunian = balas.hunian.id;

    // 3. Benar-benar tersimpan di DB (bukan state demo FE)
    expect(
      await hitung(
        PLATFORM,
        `SELECT count(*)::int AS n FROM rumah
          WHERE id = $1 AND rt_id = $2 AND kode_rumah = 'U77' AND alamat_pendek = 'Blok Uji No. 77'`,
        [idHunian, idRt04],
      ),
      "baris rumah masuk tabel",
    ).toBe(1);
    expect(
      await hitung(
        PLATFORM,
        "SELECT count(*)::int AS n FROM kartu_keluarga WHERE id = $1 AND rumah_id = $2",
        [idKkUji, idHunian],
      ),
      "tautan balik: KK ikut menunjuk rumah baru",
    ).toBe(1);
    expect(
      await hitung(PLATFORM, "SELECT count(*)::int AS n FROM warga WHERE kk_id = $1 AND rumah_id = $2", [
        idKkUji,
        idHunian,
      ]),
      "tautan balik: seluruh anggota warga ikut",
    ).toBe(1);

    // 4. Tampil di daftar GET (sumber kebenaran Data Hunian & dropdown Data Warga)
    const daftar = isi(
      await app.inject({ method: "GET", url: `${api}/rt/hunian`, cookies: { sid: sidRt } }),
    ).data as { hunian: BarisHunian[] };
    expect(daftar.hunian.some((h) => h.id === idHunian && h.jumlahKk === 1)).toBe(true);

    // 5. Audit modul data_hunian dengan ringkasan tautan
    expect(
      await hitung(
        { level: "rt", id: idRt04 },
        `SELECT count(*)::int AS n FROM audit_log
          WHERE aksi = 'tambah_hunian' AND entitas = 'rumah' AND entitas_id = $1
            AND ringkasan LIKE '%1 KK tertaut%'`,
        [idHunian],
      ),
      "audit mencatat unit baru + tautan balik",
    ).toBe(1);
  });

  it("guard & validasi POST: tanpa CSRF/sesi warga → 401; input tidak sah → 400; bentrok unik per RT → 409 tanpa jejak tulis", async () => {
    const payload = { kodeRumah: "X1", alamat: "Blok X No. 1" };

    const tanpaCsrf = await app.inject({ method: "POST", url: `${api}/rt/hunian`, cookies: sesiRt(), payload });
    expect(tanpaCsrf.statusCode).toBe(401);
    expect(isi(tanpaCsrf).error?.message).toMatch(/CSRF/);

    const palsu = await app.inject({
      method: "POST",
      url: `${api}/rt/hunian`,
      cookies: sesiRt(),
      headers: { "x-csrf-token": "nonce.palsu" },
      payload,
    });
    expect(palsu.statusCode).toBe(401);

    const warga = await app.inject({
      method: "POST",
      url: `${api}/rt/hunian`,
      cookies: { sid: sidWarga },
      headers: { "x-csrf-token": "apa-saja" },
      payload,
    });
    expect(warga.statusCode, "sesi warga tidak boleh menulis hunian").toBe(401);

    const kosong = await app.inject({
      method: "POST",
      url: `${api}/rt/hunian`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
      payload: { kodeRumah: "  ", alamat: "" },
    });
    expect(kosong.statusCode).toBe(400);
    expect(isi(kosong).error?.code).toBe("VALIDATION");

    const pendekKepanjangan = await app.inject({
      method: "POST",
      url: `${api}/rt/hunian`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
      payload: { kodeRumah: "U78", alamat: `${"A".repeat(41)}, Gang Sempit` },
    });
    expect(pendekKepanjangan.statusCode, "alamat_pendek maksimal 40 (varchar(40))").toBe(400);
    expect(isi(pendekKepanjangan).error?.message).toMatch(/40 karakter/);

    const statusSah = await app.inject({
      method: "POST",
      url: `${api}/rt/hunian`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
      payload: { kodeRumah: "U78", alamat: "Blok Uji No. 78", statusHuni: "kosong" },
    });
    expect(statusSah.statusCode, "statusHuni di luar enum PRD → tolak").toBe(400);

    const bentrokBlok = await app.inject({
      method: "POST",
      url: `${api}/rt/hunian`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
      payload: { kodeRumah: "b4-12", alamat: "Blok Baru No. 9" },
    });
    expect(bentrokBlok.statusCode, "blok unik per RT (case-insensitive) → 409").toBe(409);
    expect(isi(bentrokBlok).error?.message).toMatch(/Blok "b4-12" sudah terdaftar/);

    const bentrokAlamat = await app.inject({
      method: "POST",
      url: `${api}/rt/hunian`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
      payload: { kodeRumah: "U77X", alamat: "BLOK UJI NO. 77" },
    });
    expect(bentrokAlamat.statusCode, "alamat_pendek unik per RT → 409").toBe(409);
    expect(isi(bentrokAlamat).error?.message, "pesan membimbing ke Data Warga").toMatch(/Data Warga/);

    expect(
      await hitung(
        PLATFORM,
        `SELECT count(*)::int AS n FROM rumah
          WHERE rt_id = $1 AND kode_rumah IN ('b4-12', 'U77X', 'U78', 'X1')`,
        [idRt04],
      ),
      "tidak ada baris tersimpan dari percobaan yang ditolak",
    ).toBe(0);
  });

  it("PATCH alamat /rt/warga/:id re-link rumah seluruh anggota KK (pindah → unit baru; tanpa hunian → null; pulih → semula)", async () => {
    const idDimas = await ambilId("SELECT id FROM warga WHERE rt_id = $1 AND nama = 'Dimas Prasetyo'", [idRt04]);
    expect(idDimas, "Dimas (seed) ada").not.toBe("");
    const idKkBambang = await ambilId("SELECT kk_id AS id FROM warga WHERE id = $1", [idDimas]);
    expect(idKkBambang, "KK Dimas teridentifikasi").not.toBe("");
    expect(
      await hitung(PLATFORM, "SELECT count(*)::int AS n FROM warga WHERE id = $1 AND rumah_id IS NOT NULL", [
        idDimas,
      ]),
      "sebelum: terkait rumah seed",
    ).toBe(1);

    // Pindah ke unit hunian yang baru dibuat → seluruh anggota KK ikut
    const pindah = await app.inject({
      method: "PATCH",
      url: `${api}/rt/warga/${idDimas}`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
      payload: { alamat: "Blok Uji No. 77" },
    });
    expect(pindah.statusCode).toBe(200);
    expect(
      await hitung(
        PLATFORM,
        "SELECT count(*)::int AS n FROM warga WHERE kk_id = $1 AND rumah_id = $2",
        [idKkBambang, idHunian],
      ),
      "seluruh anggota KK menunjuk unit tujuan",
    ).toBeGreaterThanOrEqual(3);
    expect(
      await hitung(
        PLATFORM,
        "SELECT count(*)::int AS n FROM kartu_keluarga WHERE id = $1 AND rumah_id = $2",
        [idKkBambang, idHunian],
      ),
      "KK ikut menunjuk unit tujuan",
    ).toBe(1);

    // Alamat tanpa unit hunian → tautan dilepas (undangan menunggu hunian dibuat)
    const lepas = await app.inject({
      method: "PATCH",
      url: `${api}/rt/warga/${idDimas}`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
      payload: { alamat: "Gang Uji Tanpa Hunian No. 1" },
    });
    expect(lepas.statusCode).toBe(200);
    expect(
      await hitung(PLATFORM, "SELECT count(*)::int AS n FROM warga WHERE kk_id = $1 AND rumah_id IS NULL", [
        idKkBambang,
      ]),
      "alamat tanpa rumah → rumah_id null (prasyarat §6.3 terbaca jujur)",
    ).toBeGreaterThanOrEqual(3);

    // Kembali ke alamat semula → re-link rumah seed
    const pulih = await app.inject({
      method: "PATCH",
      url: `${api}/rt/warga/${idDimas}`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
      payload: { alamat: "Jl. Melati Blok B No. 12" },
    });
    expect(pulih.statusCode).toBe(200);
    const idB412 = await ambilId("SELECT id FROM rumah WHERE rt_id = $1 AND kode_rumah = 'B4-12'", [idRt04]);
    expect(idB412, "rumah seed B4-12 teridentifikasi").not.toBe("");
    expect(
      await hitung(
        PLATFORM,
        "SELECT count(*)::int AS n FROM warga WHERE kk_id = $1 AND rumah_id = $2",
        [idKkBambang, idB412],
      ),
      "pulih: kembali terkait B4-12",
    ).toBeGreaterThanOrEqual(3);
    expect(
      await hitung(
        PLATFORM,
        `SELECT count(*)::int AS n FROM kartu_keluarga
          WHERE id = $1 AND alamat = 'Jl. Melati Blok B No. 12' AND rumah_id = $2`,
        [idKkBambang, idB412],
      ),
    ).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Master kategori iuran — POST/PATCH (kontrak §5.4 baris 617 · PRD §6.4.1).
// Sebelumnya CRUD kategori hanya mengubah state demo FE: kategori baru tidak
// pernah sampai ke server, hilang saat muat ulang, dan tidak ikut pembentukan
// tagihan / dropdown alokasi yang dibaca dari server. Blok ini mengunci tulis
// DB + audit, nama unik per RT, aturan nominal, toggle nonaktif (stempel
// `dinonaktifkan_pada`), guard sesi/CSRF, dan isolasi lintas-RT.
// ---------------------------------------------------------------------------
describe("Master kategori iuran (POST/PATCH /rt/iuran/kategori · §5.4)", () => {
  let app: FastifyInstance;
  let api = "/api/v1";
  let sidRt = "";
  let csrfRt = "";
  let sidRt05 = "";
  let csrfRt05 = "";
  let sidWarga = "";
  /** Kategori buatan tes POST — dipatch lanjutan (urut berjalan). */
  let idKat = "";

  const sesiRt = () => ({ sid: sidRt, csrf_token: csrfRt });
  const csrfRtHeader = () => ({ "x-csrf-token": csrfRt });
  const sesiRt05 = () => ({ sid: sidRt05, csrf_token: csrfRt05 });

  beforeAll(async () => {
    app = await bukaAplikasiUji();
    api = apiUji;

    const rt = await app.inject({
      method: "POST",
      url: `${api}/auth/pengurus/login`,
      payload: { email: "rt04@siwarga.id", password: "rahasia123" },
    });
    expect(rt.statusCode, "login RT04").toBe(200);
    sidRt = cookieDari(rt, "sid")!;
    csrfRt = cookieDari(rt, "csrf_token")!;

    const rt05 = await app.inject({
      method: "POST",
      url: `${api}/auth/pengurus/login`,
      payload: { email: "rt05@siwarga.id", password: "rahasia123" },
    });
    expect(rt05.statusCode, "login RT05").toBe(200);
    sidRt05 = cookieDari(rt05, "sid")!;
    csrfRt05 = cookieDari(rt05, "csrf_token")!;

    const w = await app.inject({
      method: "POST",
      url: `${api}/auth/warga/login`,
      payload: { noHp: "081234567890", password: SANDI_WARGA_UJI },
    });
    expect(w.statusCode, "login warga").toBe(200);
    sidWarga = cookieDari(w, "sid")!;
  }, 60_000);

  afterAll(async () => {
    await tutupAplikasiUji();
  });

  it("POST: kategori masuk DB + urutan terakhir + terbaca GET + audit; guard & aturan nominal", async () => {
    const payload = { nama: "Kebersihan Khusus Uji", nominal: 30000, tipe: "flat", sifat: "wajib" };

    const tanpa = await app.inject({ method: "POST", url: `${api}/rt/iuran/kategori`, payload });
    expect(tanpa.statusCode).toBe(401);

    const tanpaCsrf = await app.inject({
      method: "POST",
      url: `${api}/rt/iuran/kategori`,
      cookies: sesiRt(),
      payload,
    });
    expect(tanpaCsrf.statusCode).toBe(401);
    expect(isi(tanpaCsrf).error?.message).toMatch(/CSRF/);

    const warga = await app.inject({
      method: "POST",
      url: `${api}/rt/iuran/kategori`,
      cookies: { sid: sidWarga },
      headers: { "x-csrf-token": "apa-saja" },
      payload,
    });
    expect(warga.statusCode, "sesi warga tidak boleh menulis kategori RT").toBe(401);

    const tambah = await app.inject({
      method: "POST",
      url: `${api}/rt/iuran/kategori`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
      payload,
    });
    expect(tambah.statusCode).toBe(200);
    const kategori = isi(tambah).data.kategori as {
      id: string;
      nama: string;
      tipeTarif: string;
      nominalDefault: number;
      sifat: string;
      statusAktif: boolean;
      urutan: number;
    };
    idKat = kategori.id;
    expect(kategori.nama).toBe("Kebersihan Khusus Uji");
    expect(kategori.tipeTarif).toBe("flat");
    expect(kategori.nominalDefault).toBe(30000);
    expect(kategori.sifat).toBe("wajib");
    expect(kategori.statusAktif, "status_aktif default true (skema)").toBe(true);
    expect(kategori.urutan, "urutan = terakhir (setelah 4 kategori seed RT04)").toBeGreaterThanOrEqual(5);

    expect(
      await hitung(
        PLATFORM,
        `SELECT count(*)::int AS n FROM kategori_iuran
          WHERE id = $1 AND rt_id = $2 AND tipe_tarif = 'flat' AND nominal_default = 30000
            AND wajib_opsional = 'wajib' AND status_aktif = true`,
        [idKat, idRt04],
      ),
      "baris masuk tabel kategori_iuran",
    ).toBe(1);

    const daftar = isi(
      await app.inject({ method: "GET", url: `${api}/rt/iuran/kategori`, cookies: { sid: sidRt } }),
    ).data as { kategori: { id: string; nominalDefault: number }[] };
    const baris = daftar.kategori.find((k) => k.id === idKat);
    expect(baris, "kategori baru terbaca lewat GET").toBeTruthy();
    expect(baris!.nominalDefault).toBe(30000);

    expect(
      await hitung(
        { level: "rt", id: idRt04 },
        `SELECT count(*)::int AS n FROM audit_log
          WHERE aksi = 'tambah_kategori' AND entitas = 'kategori_iuran' AND entitas_id = $1
            AND sesudah->>'nominalDefault' = '30000'`,
        [idKat],
      ),
      "audit tambah kategori dengan nilai sesudah",
    ).toBe(1);

    // Nama unik per RT — case-insensitive → 409
    const kembar = await app.inject({
      method: "POST",
      url: `${api}/rt/iuran/kategori`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
      payload: { ...payload, nama: "kebersihan khusus uji" },
    });
    expect(kembar.statusCode).toBe(409);
    expect(isi(kembar).error?.message).toMatch(/sudah terdaftar/);

    // Aturan nominal: selain `insidental` wajib > 0
    const nol = await app.inject({
      method: "POST",
      url: `${api}/rt/iuran/kategori`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
      payload: { ...payload, nama: "Uji Nominal Nol", nominal: 0 },
    });
    expect(nol.statusCode).toBe(400);
    expect(isi(nol).error?.message).toMatch(/lebih dari 0/);

    const insidental = await app.inject({
      method: "POST",
      url: `${api}/rt/iuran/kategori`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
      payload: { nama: "Santunan Kematian Uji", nominal: 0, tipe: "insidental", sifat: "opsional" },
    });
    expect(insidental.statusCode, "tipe insidental boleh nominal 0").toBe(200);

    // Field wajib hilang → 400 VALIDATION, tanpa jejak tulis
    const kurang = await app.inject({
      method: "POST",
      url: `${api}/rt/iuran/kategori`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
      payload: { nama: "Uji Kurang Field", nominal: 5000 },
    });
    expect(kurang.statusCode).toBe(400);
    expect(isi(kurang).error?.code).toBe("VALIDATION");
    expect(
      await hitung(
        PLATFORM,
        `SELECT count(*)::int AS n FROM kategori_iuran
          WHERE rt_id = $1 AND nama IN ('Uji Nominal Nol', 'Uji Kurang Field')`,
        [idRt04],
      ),
      "tidak ada baris dari percobaan yang ditolak",
    ).toBe(0);
  });

  it("PATCH: edit nama/nominal, toggle nonaktif (stempel waktu), bentrok 409, lintas-RT 404, idempoten 400", async () => {
    const ubah = await app.inject({
      method: "PATCH",
      url: `${api}/rt/iuran/kategori/${idKat}`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
      payload: { nama: "Sumbangan Renovasi Uji", nominal: 55000 },
    });
    expect(ubah.statusCode).toBe(200);
    expect(isi(ubah).data.kategori).toMatchObject({
      nama: "Sumbangan Renovasi Uji",
      nominalDefault: 55000,
      statusAktif: true,
    });

    expect(
      await hitung(
        PLATFORM,
        `SELECT count(*)::int AS n FROM kategori_iuran
          WHERE id = $1 AND nama = 'Sumbangan Renovasi Uji' AND nominal_default = 55000`,
        [idKat],
      ),
    ).toBe(1);
    expect(
      await hitung(
        { level: "rt", id: idRt04 },
        `SELECT count(*)::int AS n FROM audit_log
          WHERE aksi = 'ubah_kategori' AND entitas_id = $1
            AND sebelum->>'nominalDefault' = '30000' AND sesudah->>'nominalDefault' = '55000'`,
        [idKat],
      ),
      "audit diff sebelum & sesudah",
    ).toBe(1);

    // Nonaktif (PRD §6.4.1 "menonaktifkan, bukan hapus fisik") → stempel waktu
    const nonaktif = await app.inject({
      method: "PATCH",
      url: `${api}/rt/iuran/kategori/${idKat}`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
      payload: { statusAktif: false },
    });
    expect(nonaktif.statusCode).toBe(200);
    expect(isi(nonaktif).data.kategori.statusAktif).toBe(false);
    expect(
      await hitung(
        PLATFORM,
        "SELECT count(*)::int AS n FROM kategori_iuran WHERE id = $1 AND dinonaktifkan_pada IS NOT NULL",
        [idKat],
      ),
      "dinonaktifkan_pada diisi saat nonaktif",
    ).toBe(1);

    // Aktif kembali → stempel dibersihkan
    const aktif = await app.inject({
      method: "PATCH",
      url: `${api}/rt/iuran/kategori/${idKat}`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
      payload: { statusAktif: true },
    });
    expect(aktif.statusCode).toBe(200);
    expect(isi(aktif).data.kategori.statusAktif).toBe(true);
    expect(
      await hitung(
        PLATFORM,
        "SELECT count(*)::int AS n FROM kategori_iuran WHERE id = $1 AND dinonaktifkan_pada IS NULL",
        [idKat],
      ),
      "stempel dikosongkan saat aktif kembali",
    ).toBe(1);

    // Tanpa perubahan → 400 VALIDATION (bukan sukses kosong)
    const kosong = await app.inject({
      method: "PATCH",
      url: `${api}/rt/iuran/kategori/${idKat}`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
      payload: {},
    });
    expect(kosong.statusCode).toBe(400);
    expect(isi(kosong).error?.message).toMatch(/Tidak ada perubahan/);

    const sama = await app.inject({
      method: "PATCH",
      url: `${api}/rt/iuran/kategori/${idKat}`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
      payload: { nama: "Sumbangan Renovasi Uji" },
    });
    expect(sama.statusCode, "nilai identik → ditolak, bukan sukses palsu").toBe(400);

    // Nominal 0 pada tipe flat ditolak (aturan gabungan data lama + payload)
    const nol = await app.inject({
      method: "PATCH",
      url: `${api}/rt/iuran/kategori/${idKat}`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
      payload: { nominal: 0 },
    });
    expect(nol.statusCode).toBe(400);
    expect(isi(nol).error?.message).toMatch(/lebih dari 0/);

    // Bentrok nama dengan kategori seed RT04 → 409, baris tak berubah
    const bentrok = await app.inject({
      method: "PATCH",
      url: `${api}/rt/iuran/kategori/${idKat}`,
      cookies: sesiRt(),
      headers: csrfRtHeader(),
      payload: { nama: "Dana Sosial & Kematian" },
    });
    expect(bentrok.statusCode).toBe(409);
    expect(isi(bentrok).error?.message).toMatch(/sudah terdaftar/);

    // Lintas-RT → 404 tanpa membocorkan keberadaan baris
    const lintas = await app.inject({
      method: "PATCH",
      url: `${api}/rt/iuran/kategori/${idKat}`,
      cookies: sesiRt05(),
      headers: { "x-csrf-token": csrfRt05 },
      payload: { nominal: 1 },
    });
    expect(lintas.statusCode).toBe(404);
    expect(
      await hitung(
        PLATFORM,
        `SELECT count(*)::int AS n FROM kategori_iuran
          WHERE id = $1 AND rt_id = $2 AND nama = 'Sumbangan Renovasi Uji' AND nominal_default = 55000`,
        [idKat, idRt04],
      ),
      "baris RT04 utuh setelah percobaan lintas-RT",
    ).toBe(1);

    // Unik nama = per RT: RT05 boleh membuat nama sama
    const rt05Buat = await app.inject({
      method: "POST",
      url: `${api}/rt/iuran/kategori`,
      cookies: sesiRt05(),
      headers: { "x-csrf-token": csrfRt05 },
      payload: { nama: "Sumbangan Renovasi Uji", nominal: 55000, tipe: "flat", sifat: "wajib" },
    });
    expect(rt05Buat.statusCode, "nama kategori unik PER RT").toBe(200);
    expect(
      await hitung(
        PLATFORM,
        `SELECT count(*)::int AS n FROM kategori_iuran WHERE rt_id = $1 AND nama = 'Sumbangan Renovasi Uji'`,
        [idRt04],
      ),
      "RT04 punya tepat 1 — bukan kembar lintas-RT",
    ).toBe(1);
  });
});