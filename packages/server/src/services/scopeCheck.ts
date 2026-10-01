/**
 * Cek scope eksplisit di lapisan aplikasi — PRD §4.1, §12.2, §7.2 · aturan §4.6.
 *
 * Row-Level Security sudah membatasi baris yang terbaca, tetapi PRD mencatat
 * celah lama pada `rumah.routes.ts` & `rw-access.routes.ts` yang mengandalkan
 * RLS saja. Karena itu setiap endpoint juga menjalankan pemeriksaan ini
 * (defense in depth: RLS + cek eksplisit).
 *
 * Aturan Portal RW (§7.2): RW hanya melihat AGREGAT. Fungsi ini menolak akses RW
 * ke baris per-warga/per-RT — meskipun barisnya sendiri punya kolom `rt_id`.
 */

export type LevelScope = "rt" | "rw" | "platform";

export interface Pemohon {
  level: LevelScope;
  /** rt_id / rw_id sesuai `level`; platform boleh apa pun */
  id: string | null;
}

export interface TargetBaris {
  /** baris bertenant RT (tagihan, warga, surat, ...) */
  rtId?: string | null;
  /** baris bertenant RW (pengurus_rw, permintaan akses detail, ...) */
  rwId?: string | null;
  /** baris dengan scope polimorfik (kas_entry, audit_log, tutup_buku_kas) */
  scopeLevel?: LevelScope | null;
  scopeId?: string | null;
}

export type HasilCek = { ok: true } | { ok: false; kode: "FORBIDDEN_SCOPE"; alasan: string };

const OK: HasilCek = { ok: true };

function ditolak(alasan: string): HasilCek {
  return { ok: false, kode: "FORBIDDEN_SCOPE", alasan };
}

export function cekScope(pemohon: Pemohon, target: TargetBaris): HasilCek {
  // Platform admin boleh mengakses seluruh scope.
  if (pemohon.level === "platform") return OK;
  if (!pemohon.id) return ditolak("Identitas pemohon tidak memiliki scope.");

  if (pemohon.level === "rt") {
    if (target.scopeLevel && target.scopeLevel !== "rt") {
      return ditolak("Scope baris bukan level RT.");
    }
    if (target.scopeId !== undefined && target.scopeId !== null) {
      return target.scopeId === pemohon.id ? OK : ditolak("Scope ID tidak cocok dengan RT pemohon.");
    }
    if (target.rtId !== undefined) {
      return target.rtId === pemohon.id ? OK : ditolak("Baris dimiliki RT lain.");
    }
    if (target.rwId !== undefined && target.rwId !== null) {
      // RT boleh membaca induk RW-nya (kop surat/kontak) — diverifikasi terpisah
      // oleh cekIndukRw() karena membutuhkan lookup rw_id milik RT.
      return ditolak("Baris bertenant RW — gunakan cekIndukRw().");
    }
    return OK;
  }

  // level === 'rw'
  if (target.rtId !== undefined && target.rtId !== null) {
    return ditolak("Portal RW hanya menerima data agregat per RT, bukan baris per warga (§7.2).");
  }
  if (target.scopeLevel === "rt") {
    return ditolak("Portal RW tidak memiliki akses baca ke scope RT (§7.2).");
  }
  if (target.scopeId !== undefined && target.scopeId !== null) {
    return target.scopeId === pemohon.id ? OK : ditolak("Scope ID tidak cocok dengan RW pemohon.");
  }
  if (target.rwId !== undefined && target.rwId !== null) {
    return target.rwId === pemohon.id ? OK : ditolak("Baris dimiliki RW lain.");
  }
  return OK;
}

/** Guard untuk query agregat: RW wajib melewatkan filter `rt_id` miliknya sendiri. */
export function wajibFilterRw(pemohon: Pemohon): HasilCek {
  if (pemohon.level === "platform") return OK;
  if (pemohon.level === "rw" && pemohon.id) return OK;
  return ditolak("Hanya Portal RW / platform yang boleh memanggil agregat RW.");
}

/**
 * Kontrak pemakaian di route handler (F-2 ke atas):
 *
 *   const hasil = cekScope(req.pemohon, { rtId: baris.rtId });
 *   if (!hasil.ok) return reply.okError(hasil);
 *
 * Seluruh keputusan di atas dibuat SEBELUM query, bukan sesudah — sehingga
 * kebocoran baris lintas-tenant tertangkap lebih dini oleh RLS.
 */
