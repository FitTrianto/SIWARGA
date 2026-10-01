-- Kebijakan autentikasi Fase 3: login Portal Warga memakai KATA SANDI (min 8),
-- bukan PIN 6-digit (PRD v2.4 §5.5 tidak berlaku untuk aspek ini — keputusan
-- pemilik produk). Kolomnya hanya berganti nama; isi (hash argon2id) tetap sama,
-- sehingga akun yang sudah ada TIDAK perlu ganti kredensial.
ALTER TABLE "kredensial_warga" RENAME COLUMN "pin_hash" TO "password_hash";
