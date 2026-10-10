-- Batch 21 (Portal RW · agregat iuran §7.2): sesi RW_ADMIN boleh MEMBACA
-- (SELECT) `tagihan` & `keringanan` milik RT di bawahnya, lewat join ke tabel
-- registry `rt` — HANYA untuk agregat kepatuhan/penerimaan/subsidi per RT
-- (respons API berisi hitungan & nominal agregat saja, tanpa wargaId/nama/NIK
-- sesuai §6.4.10 & §7.2).
--
-- Sengaja TIDAK memakai view `v_rw_iuran_agregat`: view tersebut dibuat tanpa
-- `security_invoker` (mode definer, owner postgres) sehingga membaca agregat
-- lintas tenant tanpa filter scope. Rute menghitung langsung dari `tagihan` /
-- `keringanan` dengan lapis: join `rt.rw_id` + kebijakan RLS ini.
--
-- Kebijakan SELECT-only: kebijakan lama `p_scope_rt` (FOR ALL — rt sendiri /
-- platform) tetap menutup INSERT/UPDATE/DELETE, sehingga sesi RW TIDAK bisa
-- menulis tagihan/keringanan anak. Tabel registry `rt` sudah terbaca scope rw
-- lewat `p_rt_registry` (migrasi 0002); `warga`/`kartu_keluarga`/`rumah`
-- dibuka Batch 20 (migrasi 20261010000100).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tagihan', 'keringanan'] LOOP
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
