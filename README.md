# SIWARGA Monorepo — Portal Warga

Frontend **Portal Warga/RT/RW/Admin** + backend **Fastify + Prisma + PostgreSQL**.
Menggunakan **pnpm workspaces**, **React + Vite**, dan **Tailwind CSS**.

## Struktur

```
siwarga-monorepo/
├── packages/
│   ├── ui/              # Design system bersama: preset Tailwind SIWARGA + komponen
│   └── server/          # Backend Fastify (API /api/v1) + skema Prisma + migrasi + seed
└── apps/
    └── web/             # Aplikasi Portal Warga (React + Vite)
```

## Prasyarat

- [Node.js](https://nodejs.org) >= 18
- [pnpm](https://pnpm.io) >= 9 (`corepack enable` atau `npm i -g pnpm`)
- Tidak perlu instalasi PostgreSQL — database tertanam (`embedded-postgres`)
  dijalankan otomatis oleh skrip dev stack.

## Menyalankan aplikasi (pengaktifan)

Buka **dua terminal** di folder `siwarga-monorepo`:

```bash
pnpm install            # sekali saja — memasang dependensi

# Terminal 1 — database + backend API (http://127.0.0.1:3000)
pnpm dev:stack

# Terminal 2 — frontend Vite (http://localhost:5173)
pnpm dev
```

Lalu buka **http://localhost:5173**.

Urutan yang dikerjakan `pnpm dev:stack` (tanpa berkas `.env` — semua env inline):

1. menyalakan PostgreSQL tertanam di `packages/server/.data-dev` (port **55432**, data persisten);
2. `prisma migrate deploy` (jalur produksi);
3. membuat peran aplikasi `siwarga_app` (**NOSUPERUSER** → Row-Level Security benar-benar menegak)
   + menyetel sesi `TimeZone = UTC` untuk semua peran (konsistensi timestamp Prisma — audit Fase 3);
4. `tsx prisma/seed.ts` (data contoh: RT 004, RT 005, warga, iuran Oktober 2026, kas);
5. menyalakan backend Fastify, memverifikasi `/api/v1/health`.

### Akun contoh

| Peran | Identitas | Kata sandi |
|---|---|---|
| Warga | `081234567890` (Bambang Supriyanto, B4 No.12) | `WargaDev2026` |
| Warga | `081234567894` (Ahmad, aktif) | `WargaDev2026` |
| Pengurus RT | `rt04@siwarga.id` | `rahasia123` |
| Pengurus RW | `rw012@siwarga.id` | `rahasia123` |
| Admin platform | `admin@siwarga.id` | `adminrahasia` |

> Login Portal Warga memakai **kata sandi minimal 8 karakter** — bukan PIN 6 digit
> (keputusan Fase 3; lihat `01. Planning/SIWARGA-Desain-DB-API-v1.md` §5.1).
> Tiga kali salah berturut-turut mengunci akun 15 menit (`ACCOUNT_LOCKED`).

Selain akun di atas, seed menyiapkan alur **undangan → aktivasi**:

- **Maya Sari** (`081234567893`) berstatus `menunggu_aktivasi` — seed
  **mencetak tautan aktivasi** berformat `http://localhost:5173/undangan/<id>.<kode>`
  ke konsol (kode asli tak pernah disimpan, jadi tautan lama selalu diganti saat
  seed dijalankan ulang). Buka tautan itu → buat kata sandi → otomatis masuk Portal Warga.
- **Hendra Kusuma** (`081234567892`) juga `menunggu_aktivasi` — bisa diundang
  ulang dari Portal RT (tombol **Undangan** di Data Warga).
- **Zahra Aini** (`081234567895`) `belum_diundang` — titik awal penerbitan undangan dari RT.

### Opsi & penghentian

```bash
pnpm dev:stack -- --reset     # hapus data dev lama, mulai dari nol
pnpm dev:stack -- --db-only   # hanya nyalakan database (backend dijalankan terminal lain)
Ctrl+C                        # berhenti — data di .data-dev tetap tersimpan
```

Bila port database terpakai: `set DEV_PG_PORT=55433` (PowerShell: `$env:DEV_PG_PORT=55433`)
sebelum `pnpm dev:stack`.

### Memeriksa kesehatan

```bash
curl http://127.0.0.1:3000/api/v1/health   # backend: status, migrasi, koneksi DB
curl http://localhost:5173/api/v1/health    # lewat proxy Vite — membuktikan FE ↔ API terhubung
```

Frontend berjalan **mode demo** (data seed di memori) bila backend mati —
login tetap bisa dibuka, tetapi perubahan tidak tersimpan. Nyalakan
`pnpm dev:stack` agar seluruh alur memakai data nyata. Modul yang sudah
**API-first** (fallback otomatis ke mode demo bila `OFFLINE`): auth warga &
pengurus, undangan/aktivasi, serta **iuran** (riwayat & tagihan warga,
pengajuan bukti, antrean & verifikasi RT — F-6).

## Perintah lain

```bash
pnpm build        # TypeScript check + production build
pnpm typecheck    # Type check semua package
pnpm preview      # Preview production build
```

## Desain

Semua token desain SIWARGA (warna Material, tipografi Plus Jakarta Sans, spasi) didefinisikan sekali
di `packages/ui/preset.js` dan dipakai sebagai Tailwind `preset` oleh `apps/web`.
## Publikasi — GitHub Pages (build tanpa backend)

Setiap push ke `main` menjalankan `.github/workflows/pages.yml` yang membangun
`apps/web` menjadi situs statis di **https://fittriano.github.io/SIWARGA/**:

| Sakelar build | Nilai | Arti |
|---|---|---|
| `VITE_BASE` | `/SIWARGA/` | Base path Vite (URL publik = sub-path repo) |
| `VITE_KONSOL_ADMIN` | `off` | **Konsol sysadmin tidak dipublikasikan** (portal belum berautentikasi — keputusan 1 Okt 2026): path `/admin` dan seluruh halamannya diredirect ke halaman awal |
| `VITE_BACKEND` | `off` | Tanpa backend → tiap pemanggilan API langsung `OFFLINE` → portal berjalan **penuh mode demo** (data seed di memori; perubahan tak tersimpan) |

Deep link (`/undangan/<token>`, `/q/<token>`) didukung lewat salinan
`index.html` → `404.html` (GitHub Pages tidak punya aturan SPA). Build lokal
(`pnpm build`) TIDAK memakai sakelar di atas → perilaku development
(backend + RLS) tidak berubah.

Reproduksi build Pages secara lokal:

```powershell
$env:VITE_BASE="/SIWARGA/"; $env:VITE_KONSOL_ADMIN="off"; $env:VITE_BACKEND="off"
pnpm --filter @siwarga/web build
```
