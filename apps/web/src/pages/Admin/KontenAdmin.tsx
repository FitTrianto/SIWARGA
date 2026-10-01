import { useEffect, useState } from "react";
import { KontenLanding } from "../../lib/adminData";
import { useFlash } from "../../lib/useFlash";

/** Kelas konsisten untuk seluruh input & textarea di halaman ini. */
const kelasField =
  "w-full px-4 py-2.5 rounded-xl bg-surface-container-low text-sm text-on-surface focus:ring-2 focus:ring-primary focus:outline-none";

export function KontenAdmin({ konten, onSimpan }: {
  konten: KontenLanding;
  onSimpan: (k: KontenLanding) => void;
}) {
  const [draft, setDraft] = useState<KontenLanding>(konten);
  const [tersimpan, setTersimpan] = useState(false);
  const { flash, toast } = useFlash();

  // Sinkronkan draft dari props bila `konten` berubah (mis. setelah disimpan).
  useEffect(() => {
    setDraft(konten);
  }, [konten]);


  function ubahHero(field: keyof KontenLanding["hero"], value: string) {
    const hero = { ...draft.hero };
    hero[field] = value;
    setDraft({ ...draft, hero });
    setTersimpan(true);
  }

  function ubahFitur(index: number, field: keyof KontenLanding["fitur"][number], value: string) {
    const fitur = draft.fitur.map((item, i) => {
      if (i !== index) return item;
      const next = { ...item };
      next[field] = value;
      return next;
    });
    setDraft({ ...draft, fitur });
    setTersimpan(true);
  }

  function ubahHarga(index: number, field: keyof KontenLanding["harga"][number], value: string) {
    const harga = draft.harga.map((item, i) => {
      if (i !== index) return item;
      const next = { ...item };
      next[field] = value;
      return next;
    });
    setDraft({ ...draft, harga });
    setTersimpan(true);
  }

  function ubahPersona(index: number, field: keyof KontenLanding["persona"][number], value: string) {
    const persona = draft.persona.map((item, i) => {
      if (i !== index) return item;
      const next = { ...item };
      next[field] = value;
      return next;
    });
    setDraft({ ...draft, persona });
    setTersimpan(true);
  }

  function handleSimpan() {
    onSimpan(draft);
    setTersimpan(false);
    flash("Konten landing page berhasil disimpan");
  }

  function handleReset() {
    setDraft(konten);
    setTersimpan(false);
  }

  return (
    <div className="max-w-7xl mx-auto w-full space-y-6">
      {toast}

      {/* Judul & aksi */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div className="max-w-3xl space-y-1.5">
          <div className="inline-flex items-center gap-1.5 text-primary text-sm font-bold uppercase tracking-wider">
            <span className="material-symbols-outlined text-[16px]">edit_square</span>
            §8.2 · Kelola Konten Publik (P1)
          </div>
          <h1 className="text-2xl lg:text-[32px] text-on-surface tracking-tight font-extrabold">
            Konten Landing Page
          </h1>
          <p className="text-sm text-on-surface-variant leading-relaxed">
            Kelola informasi produk, harga, dan peta masalah per persona yang tampil di halaman publik.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 shrink-0">
          {tersimpan && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-100 text-amber-800 text-[11px] font-extrabold uppercase tracking-wider">
              <span className="material-symbols-outlined text-[14px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                warning
              </span>
              Ada perubahan belum disimpan
            </span>
          )}
          <button
            type="button"
            className="h-11 px-5 rounded-xl bg-surface-container-lowest text-on-surface text-sm shadow-sm border border-outline-variant hover:shadow-md hover:bg-surface-container-low transition-all flex items-center gap-2"
            onClick={handleReset}
          >
            <span className="material-symbols-outlined text-on-surface-variant text-[18px]">restart_alt</span>
            Reset
          </button>
          <button
            type="button"
            className="h-11 px-5 rounded-xl bg-primary text-on-primary text-sm font-bold shadow-md hover:opacity-90 active:scale-[0.98] transition-all flex items-center gap-2"
            onClick={handleSimpan}
          >
            <span className="material-symbols-outlined text-[18px]">save</span>
            Simpan Perubahan
          </button>
        </div>
      </div>

      {/* Catatan pratinjau */}
      <div className="p-4 rounded-xl bg-tertiary-container/30 border border-tertiary-container flex items-start gap-3">
        <span className="material-symbols-outlined text-tertiary text-[20px] shrink-0 mt-0.5">visibility</span>
        <p className="text-sm text-on-surface leading-relaxed">
          <b>Pratinjau singkat:</b> perubahan yang sudah disimpan langsung tampil di{" "}
          <b>Landing Page (publik)</b> tanpa proses publikasi terpisah — pastikan teks sudah sesuai
          sebelum menekan <b>Simpan Perubahan</b>.
        </p>
      </div>

      {/* Hero */}
      <section className="bg-surface-container-lowest rounded-xl p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 mb-4 border-b border-surface-container-high">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary-container flex items-center justify-center text-on-primary-container">
              <span className="material-symbols-outlined text-[22px]">campaign</span>
            </div>
            <div>
              <h2 className="text-lg font-bold text-on-surface">Hero</h2>
              <p className="text-xs text-on-surface-variant mt-0.5">
                Judul utama, badge, dan subjudul bagian atas halaman publik
              </p>
            </div>
          </div>
          <span className="text-xs font-bold text-on-surface-variant font-mono">4 field</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5 md:col-span-2">
            <label className="text-xs font-bold text-on-surface flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[14px] text-on-surface-variant">sell</span>
              Badge
            </label>
            <input
              className={kelasField}
              value={draft.hero.badge}
              onChange={(e) => ubahHero("badge", e.target.value)}
              placeholder="Teks badge kecil di atas judul"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-on-surface flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[14px] text-on-surface-variant">title</span>
              Judul Awal
            </label>
            <input
              className={kelasField}
              value={draft.hero.judulAwal}
              onChange={(e) => ubahHero("judulAwal", e.target.value)}
              placeholder="Bagian pertama judul hero"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-on-surface flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[14px] text-on-surface-variant">format_color_text</span>
              Judul Aksen
            </label>
            <input
              className={kelasField}
              value={draft.hero.judulAksen}
              onChange={(e) => ubahHero("judulAksen", e.target.value)}
              placeholder="Bagian judul yang ditonjolkan"
            />
          </div>
          <div className="flex flex-col gap-1.5 md:col-span-2">
            <label className="text-xs font-bold text-on-surface flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[14px] text-on-surface-variant">notes</span>
              Subjudul
            </label>
            <textarea
              className={kelasField}
              rows={3}
              value={draft.hero.sub}
              onChange={(e) => ubahHero("sub", e.target.value)}
              placeholder="Deskripsi singkat di bawah judul hero"
            />
          </div>
        </div>
      </section>

      {/* Info Produk / Fitur */}
      <section className="bg-surface-container-lowest rounded-xl p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 mb-4 border-b border-surface-container-high">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-secondary-container flex items-center justify-center text-on-secondary-container">
              <span className="material-symbols-outlined text-[22px]">apps</span>
            </div>
            <div>
              <h2 className="text-lg font-bold text-on-surface">Info Produk / Fitur</h2>
              <p className="text-xs text-on-surface-variant mt-0.5">
                Daftar fitur unggulan yang tampil di bagian produk Landing Page
              </p>
            </div>
          </div>
          <span className="text-xs font-bold text-on-surface-variant font-mono">{draft.fitur.length} item</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {draft.fitur.map((fitur, i) => (
            <div key={i} className="p-4 rounded-xl bg-surface-container-low space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="w-7 h-7 rounded-lg bg-primary-container text-on-primary-container font-mono text-xs font-bold flex items-center justify-center shrink-0">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider">
                  Fitur {i + 1}
                </span>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface">Judul</label>
                <input
                  className={kelasField}
                  value={fitur.judul}
                  onChange={(e) => ubahFitur(i, "judul", e.target.value)}
                  placeholder="Judul fitur"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface">Deskripsi</label>
                <textarea
                  className={kelasField}
                  rows={3}
                  value={fitur.deskripsi}
                  onChange={(e) => ubahFitur(i, "deskripsi", e.target.value)}
                  placeholder="Penjelasan singkat fitur"
                />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Harga */}
      <section className="bg-surface-container-lowest rounded-xl p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 mb-4 border-b border-surface-container-high">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-tertiary-container flex items-center justify-center text-on-tertiary">
              <span className="material-symbols-outlined text-[22px]">payments</span>
            </div>
            <div>
              <h2 className="text-lg font-bold text-on-surface">Harga</h2>
              <p className="text-xs text-on-surface-variant mt-0.5">
                Tier paket langganan yang tampil di bagian harga Landing Page
              </p>
            </div>
          </div>
          <span className="text-xs font-bold text-on-surface-variant font-mono">{draft.harga.length} tier</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {draft.harga.map((tier, i) => (
            <div key={i} className="p-4 rounded-xl bg-surface-container-low space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="w-7 h-7 rounded-lg bg-tertiary-container text-on-tertiary font-mono text-xs font-bold flex items-center justify-center shrink-0">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider">
                  Tier {i + 1}
                </span>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface">Nama</label>
                <input
                  className={kelasField}
                  value={tier.nama}
                  onChange={(e) => ubahHarga(i, "nama", e.target.value)}
                  placeholder="Nama paket"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface">Harga</label>
                <input
                  className={`${kelasField} font-mono`}
                  value={tier.harga}
                  onChange={(e) => ubahHarga(i, "harga", e.target.value)}
                  placeholder="Rp 0"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface">Satuan</label>
                <input
                  className={kelasField}
                  value={tier.satuan}
                  onChange={(e) => ubahHarga(i, "satuan", e.target.value)}
                  placeholder="/ bulan / RT"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface">Deskripsi</label>
                <input
                  className={kelasField}
                  value={tier.deskripsi}
                  onChange={(e) => ubahHarga(i, "deskripsi", e.target.value)}
                  placeholder="Penjelasan singkat tier"
                />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Peta Masalah per Persona */}
      <section className="bg-surface-container-lowest rounded-xl p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 mb-4 border-b border-surface-container-high">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-error-container/40 flex items-center justify-center text-on-error-container">
              <span className="material-symbols-outlined text-[22px]">groups</span>
            </div>
            <div>
              <h2 className="text-lg font-bold text-on-surface">Peta Masalah per Persona</h2>
              <p className="text-xs text-on-surface-variant mt-0.5">
                Masalah, solusi, dan footer untuk tiap persona pengguna SIWARGA
              </p>
            </div>
          </div>
          <span className="text-xs font-bold text-on-surface-variant font-mono">{draft.persona.length} persona</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {draft.persona.map((persona, i) => (
            <div key={i} className="p-4 rounded-xl bg-surface-container-low space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="w-7 h-7 rounded-lg bg-primary-container text-on-primary-container font-mono text-xs font-bold flex items-center justify-center shrink-0">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider">
                  Persona {i + 1}
                </span>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface">Judul</label>
                <input
                  className={kelasField}
                  value={persona.judul}
                  onChange={(e) => ubahPersona(i, "judul", e.target.value)}
                  placeholder="Nama persona"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface">Masalah</label>
                <textarea
                  className={kelasField}
                  rows={3}
                  value={persona.masalah}
                  onChange={(e) => ubahPersona(i, "masalah", e.target.value)}
                  placeholder="Keluhan khas persona"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface">Solusi</label>
                <textarea
                  className={kelasField}
                  rows={3}
                  value={persona.solusi}
                  onChange={(e) => ubahPersona(i, "solusi", e.target.value)}
                  placeholder="Bagaimana SIWARGA menyelesaikan masalah tersebut"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface">Footer</label>
                <input
                  className={kelasField}
                  value={persona.footer}
                  onChange={(e) => ubahPersona(i, "footer", e.target.value)}
                  placeholder="Teks penutup kartu persona"
                />
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
