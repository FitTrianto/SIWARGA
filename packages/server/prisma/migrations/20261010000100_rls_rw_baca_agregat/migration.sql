-- Batch 20 (Portal RW): sesi RW_ADMIN boleh MEMBACA (SELECT) tabel pola A
-- milik RT di bawahnya, lewat join ke tabel registry `rt` — HANYA untuk
-- agregat kependudukan/hunian per RT (§7.1: "tanpa data individu" direspons
-- API; baris individual pun tidak pernah dipilih oleh rute agregat).
--
-- Kebijakan sengaja SELECT-only: kebijakan lama `p_scope_rt` (FOR ALL — rt
-- sendiri / platform) tetap menutup INSERT/UPDATE/DELETE, sehingga sesi RW
-- TIDAK bisa menulis data anak. Tabel registry `rt` sendiri sudah terbaca
-- scope rw lewat `p_rt_registry` (migrasi 0002).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['warga', 'kartu_keluarga', 'rumah'] LOOP
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT
         USING (
           COALESCE(current_setting(''app.scope_level'', true), '''') = ''rw''
           AND EXISTS (
             SELECT 1 FROM "rt"
             WHERE "rt"."id" = %I."rt_id"
               AND "rt"."rw_id" = NULLIF(current_setting(''app.scope_id'', true), '''')::uuid
           )
         )',
      'p_rw_baca_' || t, t, t);
  END LOOP;
END $$;
