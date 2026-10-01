# @siwarga/server — Backend SIWARGA (F-1 … F-4a)

Fastify + Prisma + PostgreSQL dengan **Row-Level Security (RLS)**, **audit log**,
dan **seed**. Menutup task **B16, B17, B18** sesuai
`01. Planning/SIWARGA-Desain-DB-API-v1.md` (§3 skema, §4 aturan, §5 bentuk
respons, §6 fase).

> Kontrak respons: sukses `{ ok: true, data }` · gagal `{ ok: false, error: { code, message } }`.
> Aturan wajib: NIK tidak pernah plaintext, kas & audit *append-only*, RW agregat saja,
> `PERIODE_AKTIF = "Oktober 2026"` (`"2026-10"` di DB).

---

## Persiapan

```bash
# dari root monorepo
pnpm install

cd packages/server
cp .env.example .env          # lalu isi SESSION_SECRET & NIK_ENCRYPTION_KEY
pnpm prisma:generate          # klien Prisma 7 → src/generated/prisma
pnpm prisma:validate
```

`.env` minimal berisi:

| Variabel | Keterangan |
|---|---|
| `DATABASE_URL` | koneksi PostgreSQL (`schema=public`) |
| `SESSION_SECRET` | 32 byte acak base64 — dipakai `@fastify/cookie` |
| `NIK_ENCRYPTION_KEY` | 32 byte acak base64 — kunci AES-256-GCM NIK |
| `PORT`, `NODE_ENV` | port server & mode |

Tanpa `.env`, aplikasi tetap bisa hidup dalam mode *tanpa database*
(`status: "tanpa_database"`) — dipakai tes `app.spec.ts`.

---

## Skema & data

```bash
pnpm prisma:deploy     # jalankan semua migrasi (aman dipakai berkali-kali)
pnpm prisma:migrate    # buat migrasi baru saat skema berubah (butuh DB kosong/baru)
pnpm db:seed           # isi data contoh RT04 + RT05 (isolasi tenant) + kas + audit
```

Urutan migrasi:

1. `20260926000000_init` — 36 tabel, enum, index, FK.
2. `20260926000100_rls_dan_aturan_db` — **19 CHECK constraint** (6 di antaranya
   untuk kolom detail KK & NIK), **4 trigger** *append-only*, RLS **+ FORCE**
   pada **30 dari 36 tabel** lewat **7 kelompok policy** inti, dan **3 view
   agregat** `v_rw_*`.
3. `20260928000100_jalur_lookup_auth` — policy `p_auth_lookup_warga`
   (SELECT-saja; lookup login warga tanpa membuka tabel tenant lain).
4. `20260929000000_pin_hash_ke_password_hash` — F-2: `pin_hash` →
   `password_hash` (kata sandi sesuai PRD v2.4; akun lama tetap sah).
5. `20260929000100_jalur_lookup_token_undangan` — policy
   `p_auth_lookup_token` (SELECT-saja; cek token `<id>.<kode>` lewat RLS,
   anti-enumerasi).

Total **9 kelompok policy** = 7 inti (migrasi 2) + 2 jalur lookup RLS-saja
(migrasi 3 & 5).

Enam tabel yang **sengaja tidak** di-RLS (diisolasi lewat cek aplikasi, §4.6):
`kredensial_warga`, `sesi_login`, `percobaan_otp`, `pengguna_pengurus`,
`konten_landing`, `notifikasi_job`.

### Peran database (penting)

Row-Level Security **tidak berlaku untuk superuser** — `FORCE ROW LEVEL SECURITY`
hanya menyangkut pemilik tabel. Karena itu di produksi dipisah dua peran:

| Peran | Dipakai untuk |
|---|---|
| `siwarga_admin` (superuser) | `pnpm prisma:deploy`, `pnpm db:seed` |
| `siwarga_app` (NOSUPERUSER) | aplikasi Fastify — `DATABASE_URL` harian |

SQL sekali jalan (jalankan dengan peran admin):

```sql
CREATE ROLE siwarga_app WITH LOGIN PASSWORD '<acak>' NOSUPERUSER;
GRANT CONNECT ON DATABASE siwarga TO siwarga_app;
GRANT USAGE ON SCHEMA public TO siwarga_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO siwarga_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO siwarga_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO siwarga_app;

-- Konsistensi zona waktu (WAJIB, audit Fase 3): Prisma 7 + driver adapter pg
-- membaca timestamptz dari teks pg dan mengabaikan offset non-UTC (bagian naive
-- ditafsirkan sebagai UTC), sementara parameter Date ditulis tanpa offset lalu
-- ditafsir sesi koneksi. Dengan sesi UTC kedua arah menjadi absolut-benar di
-- mesin mana pun — dan SEMUA peran yang dipakai Prisma (admin + aplikasi +
-- peran uji) harus memakai sesi yang sama.
ALTER ROLE siwarga_app SET TimeZone TO 'UTC';
ALTER ROLE siwarga_admin SET TimeZone TO 'UTC';
```

Selama F-1 belum ada rute yang menulis ke basis data, jadi `.env` masih memakai
URL admin untuk `prisma migrate` / `db:seed`. Pemindahan `DATABASE_URL`
aplikasi ke `siwarga_app` dilakukan bersamaan dengan **F-2 (auth warga)** —
di saat setiap permintaan wajib mengawali transaksi dengan
`SET LOCAL app.scope_level` + `app.scope_id` (§4.6). Tanpa GUC itu kueri
mengembalikan **nol baris** (gagal-aman), bukan data semua tenant.

### Akun hasil seed

| Peran | Email | Kata sandi |
|---|---|---|
| Pengurus RT 004 | `rt04@siwarga.id` | `rahasia123` |
| Pengurus RW 012 | `rw012@siwarga.id` | `rahasia123` |
| System Admin | `admin@siwarga.id` | `adminrahasia` |
| Warga (Bambang) | `081234567890` | PIN `123456` |

NIK Bambang `3171058506060001` disimpan sebagai
`nik_encrypted` (AES-256-GCM) + `nik_masked` `3171-xxxx-xxxx-0001`.

---

## Menjalankan

```bash
pnpm dev           # tsx watch src/server.ts  (dari packages/server)
pnpm build && pnpm start
pnpm typecheck
```

Dari root monorepo: `pnpm dev:server`.

---

## Tes

```bash
pnpm test          # semua (10 berkas, 233 tes)
pnpm test:watch
```

Sembilan berkas pertama murni/unit (tanpa database): alokasi FIFO, status
tagihan, ledger kas, kripto NIK, PIN/argon2, token undangan, cek scope,
diff audit, dan ping Fastify.

`tests/rls-db.spec.ts` adalah **integrasi database nyata** memakai
`embedded-postgres` (cluster sementara di folder temp, port bebas dari OS):

- migrasi dijalankan `prisma migrate deploy` → memvalidasi checksum & urutan;
- **dua peran**: migrasi & seed jalan sebagai `postgres`, sedangkan **seluruh
  kueri tes jalan sebagai `siwarga_uji` (NOSUPERUSER)** — tanpa ini RLS tidak
  pernah teruji, karena superuser selalu melewati RLS (FORCE hanya menyangkut
  pemilik tabel);
- tanpa `app.scope_level` semua tabel tenant mengembalikan **0 baris**;
- RT04 tidak pernah melihat baris RT05 (baca maupun tulis);
- `INSERT` lintas tenant ditolak `42501`, `UPDATE`/`DELETE` pada tabel *append-only*
  ditolak `23001`;
- CHECK `gol_darah`/`status_kawin`/`warga_negara`/`tanggal_perkawinan`/`nik_konsisten`;
- kolom detail KK & NIK seed **paritas** dengan form *Edit Data Warga* Portal RT;
- **paritas Keputusan B**: `kategori_iuran` seed identik `kategoriIuranDefault` FE
  (nama, nominal, tipe `flat|per_unit|insidental`, sifat `wajib|opsional`, urutan)
  dan `jenis_surat` seed identik `jenisSuratOptions` FE (8 baris; `perlu_rw`
  hanya SKCK/Pindah/Nikah);
- Portal RW hanya menerima agregat (`v_rw_*`).
- **F-6 data keluarga portal warga**: `GET /warga/keluarga` ter-mask (NIK
  plaintext tak pernah keluar; urut kepala→istri→anak→lainnya) + whitelist
  `POST /warga/keluarga/:id/kontak` (zod strip key asing, HP ternormalisasi,
  beda KK → 404, no.HP kembar → 409, audit ber-diff).
- **F-5 ajuan perubahan data warga (B11/B20)** — 7 tes: `POST
  /warga/keluarga/ajuan` (guard sesi warga + zod; subjek beda KK → 404;
  duplikat subjek+jenis+`menunggu` → 409; audit `ajukan_perubahan` dengan
  `payloadSebelum` ter-mask; respon & `GET /warga/keluarga.ajuan` tanpa NIK
  plaintext) + `GET /rt/ajuan-perubahan?status=` (filter status sah, status
  tak sah → 400, baris membawa subjek + alamat KK + pengaju) + `POST
  …/:id/setujui`/`…/:id/tolak` (tanpa CSRF → 401; `tolak` tanpa catatan → 400;
  arah berlawanan → 409; idempoten `ulang: true` tanpa audit ganda; audit
  `setujui_ajuan`/`tolak_ajuan`; status **tersinkron ke portal warga** lewat
  `GET /warga/keluarga.ajuan`).
- **B13 CRUD Data Warga Portal RT** — 8 tes: `GET /rt/warga` (baris +
  `keluarga[]`, ter-mask, tanpa CSRF) + `POST /rt/warga` (1 KK + N anggota —
  payload/enum salah → 400 **tanpa baris parsial**) + `PATCH /rt/warga/:id`
  (mode patch: hanya field terkirim, `nikBaru` 16-digit, `noHp` opsional,
  label status portal terkonversi) + `DELETE /rt/warga/:id` (anggota terhapus,
  **KK kosong tetap dipertahankan**) — mutasi wajib `verifikasiCsrf` (→401),
  audit `tambah/ubah/hapus_warga`, lintas-RT → 404 (tidak pernah bocor/balik).
  Dilengkapi E2E UI Chrome CDP `e2e-b13-warga.mjs` **34/34** (alur nyata
  login RT → daftar → edit → paritas kartu Portal Warga → tambah KK → hapus →
  data kembali ke ground truth).

> **Catatan Windows:** PostgreSQL menolak berjalan dengan sesi *elevated*.
> Bila shell Anda sedang sebagai admin, `rls-db.spec.ts` otomatis menyalakan
> cluster lewat `tests/pg-broker.mjs` + `runas /trustlevel:0x20000` (token
> terbatas). Tidak ada tindakan tambahan yang perlu dilakukan.

---

## Struktur

```
prisma/
  schema.prisma            # 36 model — sumber kebenaran skema
  migrations/              # 5 migrasi: init, RLS + aturan, lookup auth,
                           #           hash→sandi, lookup token undangan
  seed.ts                  # data contoh (RT04, RT05, kategori iuran, jenis surat,
                           #                kas, audit, kredensial)
src/
  app.ts                   # Fastify: helmet, cookie, rate-limit, rute
                           # health · auth · aktivasi · iuran · kas · keluarga warga
  server.ts                # entrypoint
  config.ts                # baca .env, fallback kunci acak untuk tes
  plugins/                 # auth, scope, audit, csrf, ratelimit, errorHandler
  routes/                  # health · auth-warga · auth-pengurus · aktivasiWarga
                           # iuranWarga · iuranRt · kasRt · wargaKeluarga
                           # rtDataWarga · rtAjuanPerubahan (iuranUmum = barengan)
  services/                # alokasiFIFO, alokasiRepo, statusTagihan, kasLedger,
                           # crypto, kredensial, sesi, undanganWarga,
                           # tokenUndangan, identitasWarga, scopeCheck, db
tests/                     # 10 berkas *.spec.ts + pg-broker.mjs (token terbatas)
```
