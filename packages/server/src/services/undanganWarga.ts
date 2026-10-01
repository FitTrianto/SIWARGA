/**
 * Lookup token undangan untuk rute PUBLIK aktivasi — F-2 (task B1, §5.1/§4.2).
 *
 * Tautan undangan membawa SATU paket rahasia `<id>.<kode>`:
 *   • `id` (uuid) menempatkan baris lewat index PK — tanpa pembacaan massal;
 *   • `kode` (10 karakter tanpa huruf/angka mudah tertukar) diverifikasi
 *     argon2id terhadap `kode_hash` — kode asli TIDAK PERNAH disimpan;
 *   • keduanya dirangkai dalam satu path sehingga membuka tautan = membawa
 *     kredensial lengkap; kehilangan satu bagian = tautan mati.
 *
 * Menggantikan konfirmasi 4 digit terakhir no. HP (PRD §5.5 versi lama); alur
 * baru berakhir pada pembuatan kata sandi (keputusan produk Fase 3).
 *
 * Karena `token_undangan` ber-RLS `p_scope_rt` + FORCE, pembacaan awal memakai
 * `denganScopeAuth()` — GUC 'auth' hanya membuka SELECT sangat sempit
 * (migrasi 20260929000100) dan selalu men-target satu baris by id.
 */
import { denganScope, denganScopeAuth } from "./db.js";
import {
  PANJANG_KODE,
  cocokkanKodeUndangan,
  verifikasiToken,
  type TokenUndangan,
} from "./tokenUndangan.js";

/** uuid v4 kasar — dipakai untuk memisahkan `<id>.<kode>` & validasi path RT. */
export const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Baris `token_undangan` + field identitas yang dibutuhkan rute. */
export interface TokenUndanganBaris extends TokenUndangan {
  id: string;
  rtId: string;
  wargaId: string;
  dibuatOleh: string;
  kirimKeNomor: string | null;
}

/** Kolom warga minimal untuk alur aktivasi (§5.1) — tanpa NIK maupun kontak sensitif. */export interface WargaAktivasi {
  id: string;
  rtId: string;
  nama: string;
  noHp: string | null;
  statusAkses: string;
  isActive: boolean;
  rumahId: string | null;
  kkId: string;
}

/**
 * Hasil cek token. Sejak task B6 SEMUA varian (kecuali "token tak dikenal
 * sama sekali") ikut membawa baris `token_undangan` miliknya — rute aktivasi
 * membutuhkannya untuk MENCATAT setiap percobaan (lihat `catatPercobaan`) dan
 * untuk membaca `rt_id` pemilik saat menulis ke scope yang benar (§4.6).
 */
export type HasilCekAktivasi =
  | { hasil: "tidak_ditemukan"; token?: TokenUndanganBaris }
  | { hasil: "kedaluwarsa"; token: TokenUndanganBaris }
  | { hasil: "sudah_dipakai"; token: TokenUndanganBaris }
  | { hasil: "dicabut"; token: TokenUndanganBaris }
  | { hasil: "sah"; token: TokenUndanganBaris; warga: WargaAktivasi };

/** Pisahkan token URL `<id>.<kode>`; format lain → null (tidak ditemukan). */
export function uraikanToken(token: string): { id: string; kode: string } | null {
  const bersih = token.trim();
  const batas = bersih.lastIndexOf(".");
  if (batas <= 0 || batas === bersih.length - 1) return null;
  const id = bersih.slice(0, batas);
  const kode = bersih.slice(batas + 1);
  if (!RE_UUID.test(id)) return null;
  if (kode.length !== PANJANG_KODE || /[^A-Za-z0-9]/.test(kode)) return null;
  return { id, kode };
}

/** Kolom JSON `percobaan_aktivasi` → array aman (bila korup, anggap kosong). */
export function daftarPercobaan(nilai: unknown): TokenUndangan["percobaanAktivasi"] {
  return Array.isArray(nilai)
    ? (nilai as unknown as TokenUndangan["percobaanAktivasi"])
    : [];
}

/** Baris mentah → `TokenUndanganBaris` (dipakai untuk hasil cek non-`sah`). */
function barisToken(row: unknown): TokenUndanganBaris {
  const r = row as TokenUndanganBaris;
  return {
    id: r.id,
    rtId: r.rtId,
    wargaId: r.wargaId,
    dibuatOleh: r.dibuatOleh,
    kirimKeNomor: r.kirimKeNomor,
    status: r.status,
    kedaluwarsaPada: r.kedaluwarsaPada,
    dipakaiPada: r.dipakaiPada,
    dicabutPada: r.dicabutPada,
    percobaanAktivasi: daftarPercobaan(r.percobaanAktivasi),
  };
}

/**
 * Cek satu token untuk rute publik. Urutan keamanan:
 *   uraikan → lookup by id (scope 'auth') → verifikasi kode (argon2id)
 *   → evaluasi status (kedaluwarsa/pakai/cabut) → baca warga.
 *
 * Kode SALAH sengaja menghasilkan `tidak_ditemukan` — tidak dibedakan dari
 * token tak dikenal (anti-enumerasi; `id` tanpa `kode` tidak pernah valid).
 */
export async function cariTokenAktivasi(token: string): Promise<HasilCekAktivasi> {
  const terurai = uraikanToken(token);
  if (!terurai) return { hasil: "tidak_ditemukan" };

  return denganScopeAuth(async (tx) => {
    const row = await tx.tokenUndangan.findUnique({ where: { id: terurai.id } });
    if (!row) return { hasil: "tidak_ditemukan" };
    // Kode salah → tetap `tidak_ditemukan` bagi klien (anti-enumerasi), tapi
    // barisnya ikut dibawa agar percobaan bisa dicatat (task B6).
    if (!(await cocokkanKodeUndangan(row.kodeHash, terurai.kode))) {
      return { hasil: "tidak_ditemukan", token: barisToken(row) };
    }
    const percobaan = daftarPercobaan(row.percobaanAktivasi);
    const nilai = verifikasiToken({
      status: row.status,
      kedaluwarsaPada: row.kedaluwarsaPada,
      dipakaiPada: row.dipakaiPada,
      dicabutPada: row.dicabutPada,
      percobaanAktivasi: percobaan,
    });
    if (nilai.hasil !== "sah") return { ...nilai, token: barisToken(row) };

    const warga = await tx.warga.findUnique({
      where: { id: row.wargaId },
      select: {
        id: true,
        rtId: true,
        nama: true,
        noHp: true,
        statusAkses: true,
        isActive: true,
        rumahId: true,
        kkId: true,
      },
    });
    if (!warga) return { hasil: "tidak_ditemukan", token: barisToken(row) };

    return {
      hasil: "sah" as const,
      token: {
        id: row.id,
        rtId: row.rtId,
        wargaId: row.wargaId,
        dibuatOleh: row.dibuatOleh,
        kirimKeNomor: row.kirimKeNomor,
        status: row.status,
        kedaluwarsaPada: row.kedaluwarsaPada,
        dipakaiPada: row.dipakaiPada,
        dicabutPada: row.dicabutPada,
        percobaanAktivasi: percobaan,
      },
      warga,
    };
  });
}

export interface DetailUndanganPublik {
  nama: string;
  alamat: string;
  dikirimOleh: string;
  /** ISO 8601 — diformat FE menjadi "01 Okt 2026". */
  berlakuSampai: string;
}

/**
 * Detail untuk GET publik (§5.1): nama, alamat, pengirim, s/d berlaku.
 * Alamat & pengirim dibaca lewat scope RT milik token tsb — setelah `rtId`
 * diketahui, RLS penuh kembali berlaku (§4.6); no. HP TIDAK ikut dikirim
 * (data minimization — konfirmasi nomor sudah tidak dipakai).
 */
export async function detailUndanganDari(
  cek: Extract<HasilCekAktivasi, { hasil: "sah" }>,
): Promise<DetailUndanganPublik> {
  const alamatDanPengirim = await denganScope("rt", cek.warga.rtId, async (tx) => {
    const rumah = cek.warga.rumahId
      ? await tx.rumah.findUnique({ where: { id: cek.warga.rumahId }, select: { alamatPendek: true } })
      : null;
    const kk = await tx.kartuKeluarga.findUnique({
      where: { id: cek.warga.kkId },
      select: { alamat: true },
    });
    const pengurus = await tx.pengurusRt.findUnique({
      where: { id: cek.token.dibuatOleh },
      select: { nama: true },
    });
    return {
      alamat: rumah?.alamatPendek ?? kk?.alamat ?? "-",
      dikirimOleh: pengurus?.nama ?? "Pengurus RT",
    };
  });

  return {
    nama: cek.warga.nama,
    alamat: alamatDanPengirim.alamat,
    dikirimOleh: alamatDanPengirim.dikirimOleh,
    berlakuSampai: cek.token.kedaluwarsaPada.toISOString(),
  };
}
