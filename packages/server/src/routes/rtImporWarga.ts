/**
 * Migrasi Data — impor CSV/XLSX warga (A10 · PRD §9.1(6) · spesifikasi §5.4).
 *
 *   POST /rt/warga/import   multipart (`file`, ≤5 MB, .csv/.xlsx)
 *                           → `{ id, namaFile, status, jumlahBaris, berhasil,
 *                               gagal, alasan[] }`
 *
 * Keputusan desain 1 Okt 2026 (lihat `01. Planning/SIWARGA-Laporan-Migrasi-Data.md` §2):
 *   1. Multipart nyata — kolom `impor_data.file_url` diisi PATH berkas yang
 *      benar-benar disimpan di `.data-impor/` (gitignore) sebelum transaksi;
 *      gagal menulis berkas → 500 tanpa perubahan data (file_url tidak bohong).
 *   2. Struktur salah (ekstensi/kolom wajih hilang/file kosong/melebihi cap
 *      1000 baris) → 400 TANPA jejak DB apa pun (belum ada baris tersimpan).
 *   3. Baris kotor → dicatat pada `impor_data.laporan` (nomor + nama + pesan),
 *      tidak membatalkan baris lain; NIK tak pernah masuk laporan/respons/audit.
 *   4. Dedup NIK terhadap data RT (kandidat `nik_masked` → konfirmasi `nikSama`
 *      timing-safe) → impor ulang file yang sama idempoten-secara-data:
 *      semua baris "sudah terdaftar", nol baris baru. Berbeda dari form tambah
 *      manual (yang mengizinkan NIK sama) — deviasi terdokumentasi §5 laporan.
 *   5. Transaksi tunggal `denganScopeRequest`: KK/warga/`impor_data`/audit
 *      atomik — gagal di tengah = seluruh rollback, `StatusImpor` tetap jujur
 *      (`selesai` bila ≥1 baris masuk, `gagal` bila nol — respons tetap 200
 *      agar FE dapat menampilkan alasan per baris).
 *   6. Rute ini ter-encapsulate: plugin `multipart` didaftarkan DI SINI sehingga
 *      batas 5 MB/1 file tidak melebar ke rute lain.
 */
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyPluginAsync } from "fastify";
import multipart from "@fastify/multipart";
import { config } from "../config.js";
import { catatAudit } from "../plugins/audit.js";
import { verifikasiCsrf } from "../plugins/csrf.js";
import { GalatTolak, wajibRt } from "../plugins/guard.js";
import { denganScopeRequest } from "../plugins/scope.js";
import { nikSama, sembunyikanNik } from "../services/crypto.js";
import {
  bacaBerkasImpor,
  CAP_BARIS,
  hitungHubungan,
  petakanHeader,
  validasiBaris,
  type BarisValid,
  type BarisSalah,
} from "../services/imporWarga.js";
import { pengurusAktif } from "./iuranUmum.js";

const MAKS_BERKAS = 5 * 1024 * 1024;

/** Folder berkas impor — relatif paket server (`src/` maupun `dist/` naik 2 tingkat). */
const DIR_IMPOR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", ".data-impor");

type KriptoNik = ReturnType<typeof sembunyikanNik>;
type BarisSiap = BarisValid & { kripto: KriptoNik };

export const ruteImporWarga: FastifyPluginAsync = async (app) => {
  await app.register(multipart, { limits: { fileSize: MAKS_BERKAS, files: 1, fields: 4 } });

  app.post("/rt/warga/import", { preHandler: verifikasiCsrf }, async (req, reply) => {
    const { rtId, sesi } = wajibRt(req);

    // --- 1. berkas ---------------------------------------------------------
    if (!req.isMultipart()) {
      throw new GalatTolak("VALIDATION", 'Permintaan harus multipart/form-data dengan field "file".');
    }
    const bagian = await req.file();
    if (!bagian) throw new GalatTolak('VALIDATION', 'Berkas wajib dikirim pada field "file".');
    const berkas = await bagian.toBuffer();
    if (bagian.file.truncated) throw new GalatTolak("VALIDATION", "Ukuran berkas melebihi 5 MB.");
    const namaFile = (bagian.filename ?? "").slice(0, 255);
    if (!namaFile) throw new GalatTolak("VALIDATION", "Nama berkas tidak ditemukan.");

    // --- 2. baca & validasi struktur (belum menyentuh DB) -------------------
    const rows = await bacaBerkasImpor(namaFile, berkas);
    const { data, kolom } = petakanHeader(rows);
    if (data.length === 0) throw new GalatTolak("VALIDATION", "File tidak berisi baris data.");
    if (data.length > CAP_BARIS) {
      throw new GalatTolak(
        "VALIDATION",
        `Jumlah baris ${data.length} melebihi batas ${CAP_BARIS} — impor dalam beberapa berkas.`,
      );
    }
    const { valid, salah } = validasiBaris(data, kolom);

    // --- 3. simpan berkas → `file_url` bernilai nyata -----------------------
    const id = randomUUID();
    const namaSimpan = `${id}-${namaFile.replace(/[^\w.-]+/g, "_")}`;
    const relatif = `.data-impor/${namaSimpan}`;
    try {
      await mkdir(DIR_IMPOR, { recursive: true });
      await writeFile(path.join(DIR_IMPOR, namaSimpan), berkas);
    } catch {
      throw new GalatTolak("INTERNAL", "Berkas gagal disimpan di server — impor dibatalkan tanpa perubahan data.");
    }

    // --- 4. transaksi: dedup → buat KK/warga → impor_data → audit ----------
    const hasil = await denganScopeRequest(req, async (tx) => {
      const oleh = await pengurusAktif(tx, rtId, sesi.subjekId);

      // Pra-muat warga & KK RT ini: dedup NIK & inferensi hubungan dihitung di
      // memori (RT = ratusan baris) — bukan satu query per baris.
      const [wargaLama, kkLama] = await Promise.all([
        tx.warga.findMany({
          where: { rtId },
          select: { id: true, kkId: true, hubungan: true, nikMasked: true, nikEncrypted: true },
        }),
        tx.kartuKeluarga.findMany({ where: { rtId }, select: { id: true, noKk: true, rumahId: true } }),
      ]);

      const kandidatMask = new Map<string, Uint8Array[]>();
      for (const w of wargaLama) {
        if (w.nikMasked && w.nikEncrypted) {
          const daftar = kandidatMask.get(w.nikMasked) ?? [];
          daftar.push(w.nikEncrypted);
          kandidatMask.set(w.nikMasked, daftar);
        }
      }

      const alasan: BarisSalah[] = [...salah];
      const siap: BarisSiap[] = [];
      for (const b of valid) {
        const kripto = sembunyikanNik(b.nik, config.nikKey);
        const kandidat = kandidatMask.get(kripto.nikMasked);
        if (kandidat?.some((enc) => nikSama(kripto.nikEncrypted, enc, config.nikKey))) {
          alasan.push({ nomor: b.nomor, nama: b.nama, pesan: "NIK sudah terdaftar di RT ini — baris dilewati." });
          continue;
        }
        siap.push({ ...b, kripto });
      }

      // Kelompokkan per No.KK, urut file → KK baru dibuat sekali per kelompok.
      const urutNoKk: string[] = [];
      const grup = new Map<string, BarisSiap[]>();
      for (const b of siap) {
        if (!grup.has(b.noKk)) {
          grup.set(b.noKk, []);
          urutNoKk.push(b.noKk);
        }
        grup.get(b.noKk)!.push(b);
      }
      const kkMap = new Map(kkLama.map((k) => [k.noKk, k]));
      const kepalaTersimpan = new Set(wargaLama.filter((w) => w.hubungan === "kepala").map((w) => w.kkId));

      let berhasil = 0;
      for (const noKk of urutNoKk) {
        const anggota = grup.get(noKk)!;
        const lama = kkMap.get(noKk) ?? null;
        // Inferensi hubungan (keputusan #7): KK baru tak punya anggota →
        // `hitungHubungan(.., false)`; KK lama = sudah ada kepala tersimpan?
        const punyaKepala = lama ? kepalaTersimpan.has(lama.id) : false;
        const hubungan = hitungHubungan(anggota, punyaKepala);
        const kepalaBaru =
          hubungan.indexOf("kepala") >= 0 ? anggota[hubungan.indexOf("kepala")].nama : null;

        let kkId: string;
        let rumahId: string | null;

        if (lama) {
          kkId = lama.id;
          rumahId = lama.rumahId;
        } else {
          const alamat = anggota[0].alamat;
          // Link rumah best-effort by alamat — pola identik POST /rt/warga.
          const rumah = await tx.rumah.findFirst({
            where: {
              rtId,
              OR: [
                { alamat: { equals: alamat, mode: "insensitive" } },
                { alamatPendek: { equals: alamat, mode: "insensitive" } },
              ],
            },
            select: { id: true },
          });
          const baru = await tx.kartuKeluarga.create({
            data: {
              rtId,
              noKk,
              kepalaKeluarga: kepalaBaru ?? anggota[0].nama,
              alamat,
              jumlahAnggota: anggota.length,
              rumahId: rumah?.id ?? null,
            },
            select: { id: true, noKk: true, rumahId: true },
          });
          kkId = baru.id;
          rumahId = baru.rumahId;
          kkMap.set(noKk, baru);
        }

        for (let i = 0; i < anggota.length; i++) {
          const a = anggota[i];
          await tx.warga.create({
            data: {
              rtId,
              kkId,
              rumahId,
              nama: a.nama,
              hubungan: hubungan[i],
              nikEncrypted: a.kripto.nikEncrypted,
              nikMasked: a.kripto.nikMasked,
              noHp: a.noHp,
              email: a.email,
              statusAkses: "belum_diundang",
              statusDemografis: "aktif",
            },
          });
        }

        // KK lama: jumlah_anggota digeser; meniru semantik PATCH anggota —
        // anggota baru ber-hubungan `kepala` memperbarui `kepala_keluarga`
        // (keputusan #7). KK baru sudah membawa keduanya saat CREATE.
        if (lama) {
          await tx.kartuKeluarga.update({
            where: { id: kkId },
            data: {
              jumlahAnggota: { increment: anggota.length },
              ...(kepalaBaru ? { kepalaKeluarga: kepalaBaru } : {}),
            },
          });
        }

        berhasil += anggota.length;
      }

      const statusImpor = berhasil > 0 ? "selesai" : "gagal";
      await tx.imporData.create({
        data: {
          id,
          rtId,
          fileUrl: relatif,
          namaFile,
          jumlahBaris: data.length,
          berhasil,
          gagal: alasan.length,
          laporan: { alasan },
          status: statusImpor,
          diunggahOleh: oleh,
        },
      });

      // Audit hanya berisi nama file + hitungan (tak pernah berisi baris/NIK).
      await catatAudit(
        {
          scopeLevel: "rt",
          scopeId: rtId,
          actorId: oleh,
          actorRole: "rt_admin",
          portal: "rt",
          modul: "data_warga",
          aksi: "impor_warga",
          aksiBadge: "Data Warga",
          entitas: "impor_data",
          entitasId: id,
          sesudah: { namaFile, jumlahBaris: data.length, berhasil, gagal: alasan.length, status: statusImpor },
          ringkasan: `Impor ${namaFile} — ${data.length} baris: ${berhasil} masuk, ${alasan.length} ditolak`,
          ip: req.ipAsli,
        },
        tx,
      );

      return {
        id,
        namaFile,
        status: statusImpor,
        jumlahBaris: data.length,
        berhasil,
        gagal: alasan.length,
        alasan: alasan.slice(0, 100),
      };
    });

    return reply.ok(hasil);
  });
};
