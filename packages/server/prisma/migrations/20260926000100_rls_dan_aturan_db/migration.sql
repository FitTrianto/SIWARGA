-- =============================================================================
-- SIWARGA — Migrasi 0002: RLS multi-tenant, aturan integritas DB, audit append-only
-- Acuan: `01. Planning/SIWARGA-Desain-DB-API-v1.md` §4.5, §4.6, §6.5, §7.2, §14
--
-- Bagian:
--   A. CHECK constraint yang tidak bisa diekspresikan di schema.prisma
--   B. Trigger append-only (buku kas, audit_log, mutasi saldo)
--   C. Row-Level Security + FORCE (defense in depth bersama cek scope aplikasi)
--   D. View agregat untuk Portal RW (RW hanya boleh melihat agregat, §7.2)
--
-- Kontrak scope (dipakai aplikasi, lihat src/plugins/scope.ts):
--   SET LOCAL app.scope_level = 'rt' | 'rw' | 'platform';
--   SET LOCAL app.scope_id    = '<uuid tenant>';
--   Kedua GUC dibaca dengan current_setting(..., true) sehingga NULL bila tidak
--   diset — keadaan default-nya AMAN: baris tidak terlihat sama sekali.
--   Pengecualian: kunci otorisasi (sesi, kredensial, OTP, akun pengurus,
--   notifikasi_job, konten_landing) sengaja TIDAK di-RLS karena diakses lewat
--   token/id subjek, bukan pemindaian tenant — isolasinya ditangani aplikasi.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A. CHECK constraint
-- -----------------------------------------------------------------------------

-- §14 / B17: NIK hanya boleh tersimpan ter-encryption + ter-mask; keduanya
-- harus ada bersamaan (tidak boleh ada NIK plaintext maupun mask sebagian).
ALTER TABLE "warga"
  ADD CONSTRAINT "warga_nik_konsisten"
    CHECK (("nik_encrypted" IS NULL) = ("nik_masked" IS NULL)),
  ADD CONSTRAINT "warga_nik_masked_tersembunyi"
    CHECK (
      "nik_masked" IS NULL
      OR "nik_masked" ~ '^[0-9]{4}-?[xX*]{4}-?[xX*]{4}-?[0-9]{4}$'
    );

-- Enam kolom detail KK (tempat lahir, pendidikan, gol. darah, status kawin,
-- tanggal perkawinan, warga negara) meniru isian form "Edit Data Warga" di
-- Portal RT. Nilai yang dikendalikan opsi divalidasi di sini agar FE dan DB
-- tidak pernah berbeda isi. NULL = belum diisi (bukan kesalahan).
ALTER TABLE "warga"
  ADD CONSTRAINT "warga_gol_darah_valid"
    CHECK ("gol_darah" IS NULL OR "gol_darah" IN ('A', 'B', 'AB', 'O')),
  ADD CONSTRAINT "warga_status_kawin_valid"
    CHECK (
      "status_kawin" IS NULL
      OR "status_kawin" IN ('Belum Menikah', 'Menikah', 'Cerai Hidup', 'Cerai Mati')
    ),
  ADD CONSTRAINT "warga_warga_negara_valid"
    CHECK ("warga_negara" IS NULL OR "warga_negara" IN ('WNI', 'WNA')),
  -- Tanggal perkawinan tanpa status perkawinan = data tidak konsisten
  ADD CONSTRAINT "warga_tgl_kawin_konsisten"
    CHECK ("tanggal_perkawinan" IS NULL OR "status_kawin" IS NOT NULL);

-- §6.4.4: nominal pembayaran harus positif
ALTER TABLE "pembayaran"
  ADD CONSTRAINT "pembayaran_nominal_positif" CHECK ("nominal" > 0);

-- §6.4.5: nominal alokasi harus positif
ALTER TABLE "alokasi_pembayaran"
  ADD CONSTRAINT "alokasi_nominal_positif" CHECK ("nominal_dialokasikan" > 0);

-- §6.4.3: konsistensi nominal tagihan
ALTER TABLE "tagihan"
  ADD CONSTRAINT "tagihan_nominal_konsisten"
    CHECK (
      "nominal" >= 0
      AND "nominal_awal" >= 0
      AND "sisa" >= 0
      AND "sisa" <= "nominal_awal"
    );

-- §6.4.7: status turunan harus konsisten dengan sisa
ALTER TABLE "tagihan"
  ADD CONSTRAINT "tagihan_status_sisa"
    CHECK (
      ("status" = 'lunas' AND "sisa" = 0)
      OR ("status" = 'sebagian' AND "sisa" > 0 AND "sisa" < "nominal_awal")
      OR ("status" = 'belum_bayar' AND "sisa" = "nominal_awal")
    );

-- §6.4.6: saldo lebih bayar selalu positif
ALTER TABLE "mutasi_saldo_warga"
  ADD CONSTRAINT "mutasi_nominal_positif" CHECK ("nominal" > 0);

-- §6.5: buku kas nominal selalu positif (arah ditentukan kolom `arah`)
ALTER TABLE "kas_entry"
  ADD CONSTRAINT "kas_nominal_positif" CHECK ("nominal" > 0);

-- §6.5: rantai saldo harus tertutup per entri
ALTER TABLE "kas_entry"
  ADD CONSTRAINT "kas_arah_konsisten"
    CHECK (
      ("tipe" <> 'pembalik')
      OR ("reversal_of_id" IS NOT NULL AND "arah" IN ('positif', 'negatif'))
    );

-- §6.5: tutup buku harus seimbang
ALTER TABLE "tutup_buku_kas"
  ADD CONSTRAINT "tutup_buku_seimbang"
    CHECK (abs("saldo_awal" + "total_masuk" - "total_keluar" - "saldo_akhir") < 0.01);

-- §14.1 / B4: token sekali pakai — status aktif_dipakai wajib punya waktu pakai
ALTER TABLE "token_undangan"
  ADD CONSTRAINT "token_aktif_punya_dipakai_pada"
    CHECK ("status" <> 'aktif_dipakai' OR "dipakai_pada" IS NOT NULL);

-- §14.1: token yang sudah dipakai/dicabut tidak boleh kembali 'menunggu'
ALTER TABLE "token_undangan"
  ADD CONSTRAINT "token_irreversible"
    CHECK ("status" NOT IN ('aktif_dipakai', 'dicabut') OR "dipakai_pada" IS NOT NULL OR "dicabut_pada" IS NOT NULL);

-- §7.5 (A22): mode 'direct' wajib justifikasi minimal 20 karakter
ALTER TABLE "permintaan_akses_detail"
  ADD CONSTRAINT "akses_direct_perlu_justifikasi"
    CHECK ("mode" <> 'direct' OR length(coalesce("justifikasi", '')) >= 20);

-- §5.6 / §14.1: pembatasan percobaan PIN
ALTER TABLE "kredensial_warga"
  ADD CONSTRAINT "kredensial_gagal_wajar" CHECK ("gagal_berturut" >= 0 AND "gagal_berturut" <= 100);

-- §5.5: percobaan OTP tidak boleh melewati batas
ALTER TABLE "percobaan_otp"
  ADD CONSTRAINT "otp_percobaan_wajar" CHECK ("jumlah_percobaan" <= "max");

-- -----------------------------------------------------------------------------
-- B. Trigger append-only
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_tolak_perubahan() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Tabel % bersifat append-only — % ditolak (%.%)',
    TG_TABLE_NAME, TG_OP, current_user, session_user
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

-- §6.5 (B8): koreksi kas = entri pembalik, bukan UPDATE/DELETE
CREATE TRIGGER trg_kas_entry_append_only
  BEFORE UPDATE OR DELETE ON "kas_entry"
  FOR EACH ROW EXECUTE FUNCTION fn_tolak_perubahan();

-- §14 (B15): audit_log tidak pernah diubah/dihapus siapa pun
CREATE TRIGGER trg_audit_log_append_only
  BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION fn_tolak_perubahan();

-- §6.4.2: saldo kumulatif warga juga append-only (rantai saldo_sesudah)
CREATE TRIGGER trg_mutasi_saldo_append_only
  BEFORE UPDATE OR DELETE ON "mutasi_saldo_warga"
  FOR EACH ROW EXECUTE FUNCTION fn_tolak_perubahan();

-- Alokasi pembayaran idempoten lewat hash unique — baris tidak boleh diedit
CREATE TRIGGER trg_alokasi_append_only
  BEFORE UPDATE OR DELETE ON "alokasi_pembayaran"
  FOR EACH ROW EXECUTE FUNCTION fn_tolak_perubahan();

-- -----------------------------------------------------------------------------
-- C. Row-Level Security
-- -----------------------------------------------------------------------------

-- Pola A: tabel bertenant dengan kolom rt_id
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'pengurus_rt', 'pengaturan_rt', 'rumah', 'kartu_keluarga', 'warga',
    'perubahan_data_warga', 'token_undangan', 'kategori_iuran',
    'profil_iuran_warga', 'tagihan', 'pembayaran', 'alokasi_pembayaran',
    'mutasi_saldo_warga', 'keringanan', 'jenis_surat', 'surat',
    'langganan', 'impor_data'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY p_scope_rt ON %I FOR ALL
         USING (
           COALESCE(current_setting(''app.scope_level'', true), '''') = ''platform''
           OR (
             COALESCE(current_setting(''app.scope_level'', true), '''') = ''rt''
             AND %I."rt_id" = NULLIF(current_setting(''app.scope_id'', true), '''')::uuid
           )
         )
         WITH CHECK (
           COALESCE(current_setting(''app.scope_level'', true), '''') = ''platform''
           OR (
             COALESCE(current_setting(''app.scope_level'', true), '''') = ''rt''
             AND %I."rt_id" = NULLIF(current_setting(''app.scope_id'', true), '''')::uuid
           )
         )', t, t, t);
  END LOOP;
END $$;

-- Pola B: tabel dengan scope_level + scope_id (kas, approval, tutup buku, audit)
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['kas_entry', 'approval_kas', 'tutup_buku_kas', 'audit_log'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY p_scope_level ON %I FOR ALL
         USING (
           COALESCE(current_setting(''app.scope_level'', true), '''') = ''platform''
           OR (
             %I."scope_level"::text = COALESCE(current_setting(''app.scope_level'', true), '''')
             AND %I."scope_id" = NULLIF(current_setting(''app.scope_id'', true), '''')::uuid
           )
         )
         WITH CHECK (
           COALESCE(current_setting(''app.scope_level'', true), '''') = ''platform''
           OR (
             %I."scope_level"::text = COALESCE(current_setting(''app.scope_level'', true), '''')
             AND %I."scope_id" = NULLIF(current_setting(''app.scope_id'', true), '''')::uuid
           )
         )', t, t, t, t, t);
  END LOOP;
END $$;

-- Pola C: tabel bertenant dengan kolom rw_id
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['pengurus_rw', 'pengaturan_rw', 'permintaan_akses_detail'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY p_scope_rw ON %I FOR ALL
         USING (
           COALESCE(current_setting(''app.scope_level'', true), '''') = ''platform''
           OR (
             COALESCE(current_setting(''app.scope_level'', true), '''') = ''rw''
             AND %I."rw_id" = NULLIF(current_setting(''app.scope_id'', true), '''')::uuid
           )
         )
         WITH CHECK (
           COALESCE(current_setting(''app.scope_level'', true), '''') = ''platform''
           OR (
             COALESCE(current_setting(''app.scope_level'', true), '''') = ''rw''
             AND %I."rw_id" = NULLIF(current_setting(''app.scope_id'', true), '''')::uuid
           )
         )', t, t, t);
  END LOOP;
END $$;

-- Registrasi tenant: RT melihat dirinya + RW-nya; RW melihat RT di bawahnya.
ALTER TABLE "rt" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rt" FORCE ROW LEVEL SECURITY;
CREATE POLICY p_rt_registry ON "rt" FOR ALL
  USING (
    COALESCE(current_setting('app.scope_level', true), '') = 'platform'
    OR (
      COALESCE(current_setting('app.scope_level', true), '') = 'rt'
      AND "rt"."id" = NULLIF(current_setting('app.scope_id', true), '')::uuid
    )
    OR (
      COALESCE(current_setting('app.scope_level', true), '') = 'rw'
      AND "rt"."rw_id" = NULLIF(current_setting('app.scope_id', true), '')::uuid
    )
  )
  WITH CHECK (
    COALESCE(current_setting('app.scope_level', true), '') = 'platform'
    OR (
      COALESCE(current_setting('app.scope_level', true), '') = 'rt'
      AND "rt"."id" = NULLIF(current_setting('app.scope_id', true), '')::uuid
    )
    OR (
      COALESCE(current_setting('app.scope_level', true), '') = 'rw'
      AND "rt"."rw_id" = NULLIF(current_setting('app.scope_id', true), '')::uuid
    )
  );

ALTER TABLE "rw" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rw" FORCE ROW LEVEL SECURITY;
CREATE POLICY p_rw_registry ON "rw" FOR ALL
  USING (
    COALESCE(current_setting('app.scope_level', true), '') = 'platform'
    OR (
      COALESCE(current_setting('app.scope_level', true), '') = 'rw'
      AND "rw"."id" = NULLIF(current_setting('app.scope_id', true), '')::uuid
    )
    -- RT tetap perlu membaca induk RW-nya (kop surat, kontak ketua RW)
    OR (
      COALESCE(current_setting('app.scope_level', true), '') = 'rt'
      AND "rw"."id" = (
        SELECT r."rw_id" FROM "rt" r
        WHERE r."id" = NULLIF(current_setting('app.scope_id', true), '')::uuid
      )
    )
  )
  WITH CHECK (
    COALESCE(current_setting('app.scope_level', true), '') = 'platform'
    OR (
      COALESCE(current_setting('app.scope_level', true), '') = 'rw'
      AND "rw"."id" = NULLIF(current_setting('app.scope_id', true), '')::uuid
    )
  );

-- Data wilayah: baca-saja untuk scope yang sudah teridentifikasi, tulis platform.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['kecamatan', 'kelurahan'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY p_wilayah_baca ON %I FOR SELECT
         USING (NULLIF(current_setting(''app.scope_level'', true), '''') IS NOT NULL)', t);
    EXECUTE format(
      'CREATE POLICY p_wilayah_tulis ON %I FOR ALL
         USING (COALESCE(current_setting(''app.scope_level'', true), '''') = ''platform'')
         WITH CHECK (COALESCE(current_setting(''app.scope_level'', true), '''') = ''platform'')', t);
  END LOOP;
END $$;

-- Transaksi langganan mengikuti scope RT pemilik langganannya
ALTER TABLE "transaksi_langganan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "transaksi_langganan" FORCE ROW LEVEL SECURITY;
CREATE POLICY p_scope_langganan ON "transaksi_langganan" FOR ALL
  USING (
    COALESCE(current_setting('app.scope_level', true), '') = 'platform'
    OR (
      COALESCE(current_setting('app.scope_level', true), '') = 'rt'
      AND "transaksi_langganan"."langganan_id" IN (
        SELECT l."id" FROM "langganan" l
        WHERE l."rt_id" = NULLIF(current_setting('app.scope_id', true), '')::uuid
      )
    )
  )
  WITH CHECK (
    COALESCE(current_setting('app.scope_level', true), '') = 'platform'
    OR (
      COALESCE(current_setting('app.scope_level', true), '') = 'rt'
      AND "transaksi_langganan"."langganan_id" IN (
        SELECT l."id" FROM "langganan" l
        WHERE l."rt_id" = NULLIF(current_setting('app.scope_id', true), '')::uuid
      )
    )
  );

-- -----------------------------------------------------------------------------
-- D. View agregat Portal RW (§7.2 — RW TIDAK PERNAH membaca baris per-warga)
--
-- View sengaja dibuat sebagai perhitungan agregat milik aplikasi; aksesnya
-- HANYA lewat endpoint /rw/* yang memverifikasi rw_id secara eksplisit di
-- lapisan aplikasi (cek scope ganda: RLS + aplikasi, §4.6).
-- -----------------------------------------------------------------------------

CREATE OR REPLACE VIEW "v_rw_iuran_agregat" AS
SELECT
  t."rt_id"                                        AS rt_id,
  t."periode"                                      AS periode,
  count(*)                                         AS jumlah_tagihan,
  count(*) FILTER (WHERE t."status" = 'lunas')     AS jumlah_lunas,
  count(*) FILTER (WHERE t."status" = 'sebagian')  AS jumlah_sebagian,
  count(*) FILTER (WHERE t."status" = 'belum_bayar') AS jumlah_belum_bayar,
  sum(t."nominal_awal")                            AS total_nominal_awal,
  sum(t."nominal_awal" - t."sisa")                 AS total_terbayar,
  sum(t."sisa")                                    AS total_sisa
FROM "tagihan" t
GROUP BY t."rt_id", t."periode";

CREATE OR REPLACE VIEW "v_rw_kas_agregat" AS
SELECT
  k."scope_level"  AS scope_level,
  k."scope_id"     AS scope_id,
  k."tanggal"      AS tanggal,
  sum(k."nominal") FILTER (WHERE k."tipe" = 'masuk'    AND k."arah" = 'positif') AS total_masuk,
  sum(k."nominal") FILTER (WHERE k."tipe" = 'keluar'   AND k."arah" = 'negatif') AS total_keluar,
  sum(k."nominal") FILTER (WHERE k."tipe" = 'pembalik' AND k."arah" = 'positif') AS pembalik_masuk,
  sum(k."nominal") FILTER (WHERE k."tipe" = 'pembalik' AND k."arah" = 'negatif') AS pembalik_keluar
FROM "kas_entry" k
GROUP BY k."scope_level", k."scope_id", k."tanggal";

CREATE OR REPLACE VIEW "v_rw_warga_agregat" AS
SELECT
  w."rt_id"                                              AS rt_id,
  count(*)                                               AS jumlah_warga,
  count(*) FILTER (WHERE w."status_akses" = 'aktif')     AS jumlah_teraktivasi,
  count(*) FILTER (WHERE w."status_akses" IN ('belum_diundang', 'menunggu_aktivasi')) AS jumlah_belum_aktif,
  count(*) FILTER (WHERE w."hubungan" = 'kepala')        AS jumlah_kepala_keluarga
FROM "warga" w
WHERE w."status_demografis" = 'aktif'
GROUP BY w."rt_id";
