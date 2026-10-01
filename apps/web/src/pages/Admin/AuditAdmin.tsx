import { useState } from "react";
import {
  AuditPlatform,
  KategoriAuditPlatform,
  badgeKategoriAudit,
  catatanLabel,
} from "../../lib/adminData";

const daftarKategori: KategoriAuditPlatform[] = [
  "akses",
  "tenant",
  "langganan",
  "konten",
  "sistem",
];

type FilterKategori = KategoriAuditPlatform | "semua";

export function AuditAdmin({ entries }: { entries: AuditPlatform[] }) {
  const [filterKategori, setFilterKategori] = useState<FilterKategori>("semua");
  const [pencarian, setPencarian] = useState("");

  const hasil = entries.filter((row) => {
    const cocokKategori = filterKategori === "semua" || row.kategori === filterKategori;
    const q = pencarian.trim().toLowerCase();
    const cocokTeks =
      q === "" ||
      row.aktor.toLowerCase().includes(q) ||
      row.aksi.toLowerCase().includes(q) ||
      row.target.toLowerCase().includes(q);
    return cocokKategori && cocokTeks;
  });

  return (
    <div className="max-w-7xl mx-auto w-full space-y-6">
      {/* Judul */}
      <div className="max-w-3xl space-y-1.5">
        <div className="inline-flex items-center gap-1.5 text-primary text-sm font-bold uppercase tracking-wider">
          <span className="material-symbols-outlined text-[16px]">policy</span>
          §8.4 · Audit &amp; Kepatuhan (P0)
        </div>
        <h1 className="text-2xl lg:text-[32px] text-on-surface tracking-tight font-extrabold">
          Audit Log Platform
        </h1>
        <p className="text-sm text-on-surface-variant leading-relaxed">
          Rekam jejak lintas-tenant System Admin: akses & identitas, kelola tenant, langganan,
          konten, dan sistem — satu log permanen untuk seluruh platform SIWARGA.
        </p>
      </div>

      {/* Filter kategori + pencarian */}
      <div className="flex flex-col lg:flex-row items-stretch lg:items-center gap-3 p-4 rounded-xl bg-surface-container-lowest shadow-sm">
        <div className="relative lg:w-64 shrink-0">
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 material-symbols-outlined text-on-surface-variant text-[20px]">
            filter_alt
          </span>
          <select
            className="w-full h-11 pl-11 pr-10 rounded-xl bg-surface-container-low text-sm text-on-surface focus:ring-2 focus:ring-primary focus:outline-none appearance-none cursor-pointer"
            value={filterKategori}
            onChange={(e) => setFilterKategori(e.target.value as FilterKategori)}
            aria-label="Filter kategori audit"
          >
            <option value="semua">Semua kategori</option>
            {daftarKategori.map((k) => (
              <option key={k} value={k}>
                {catatanLabel(k)}
              </option>
            ))}
          </select>
          <span className="absolute right-3.5 top-1/2 -translate-y-1/2 material-symbols-outlined text-on-surface-variant text-[18px] pointer-events-none">
            expand_more
          </span>
        </div>

        <div className="relative flex-1">
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 material-symbols-outlined text-on-surface-variant text-[20px]">
            search
          </span>
          <input
            className="w-full h-11 pl-11 pr-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:ring-2 focus:ring-primary focus:outline-none transition-all"
            placeholder="Cari aktor, aksi, atau target..."
            value={pencarian}
            onChange={(e) => setPencarian(e.target.value)}
          />
        </div>

        <span className="text-xs text-on-surface-variant font-semibold lg:shrink-0 text-right">
          Menampilkan <b className="font-mono text-on-surface">{hasil.length}</b> dari{" "}
          <b className="font-mono text-on-surface">{entries.length}</b> entri
        </span>
      </div>

      {/* Tabel log */}
      <div className="bg-surface-container-lowest rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-on-surface">
            <thead className="bg-surface-container-low text-xs text-on-surface-variant uppercase tracking-wider">
              <tr>
                <th className="py-3 px-4">Waktu</th>
                <th className="py-3 px-4">Aktor</th>
                <th className="py-3 px-4">Aksi</th>
                <th className="py-3 px-4">Target</th>
                <th className="py-3 px-4">Kategori</th>
                <th className="py-3 px-4">IP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-container-high">
              {hasil.map((row) => (
                <tr key={row.id} className="hover:bg-surface-container-low/50 transition-colors">
                  <td className="py-4 px-4">
                    <span className="text-xs font-mono text-on-surface-variant whitespace-nowrap">
                      {row.waktu}
                    </span>
                  </td>
                  <td className="py-4 px-4">
                    <span className="text-sm font-semibold text-on-surface">{row.aktor}</span>
                  </td>
                  <td className="py-4 px-4">
                    <span className="text-sm text-on-surface">{row.aksi}</span>
                  </td>
                  <td className="py-4 px-4">
                    <span className="text-sm text-on-surface">{row.target}</span>
                  </td>
                  <td className="py-4 px-4">
                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold whitespace-nowrap ${badgeKategoriAudit(
                        row.kategori
                      )}`}
                    >
                      <span className="w-2 h-2 rounded-full bg-current opacity-60" />
                      {catatanLabel(row.kategori)}
                    </span>
                  </td>
                  <td className="py-4 px-4">
                    <span className="text-xs font-mono text-on-surface-variant">{row.ipAddress}</span>
                  </td>
                </tr>
              ))}
              {hasil.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-on-surface-variant text-sm">
                    Tidak ada log yang cocok dengan filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="px-6 py-3 border-t border-surface-container-high text-xs text-on-surface-variant">
          Log bersifat <b>append-only</b> — tidak dapat diubah atau dihapus (§8.4).
        </div>
      </div>

      {/* Kepatuhan & Keputusan Tertunda */}
      <section className="bg-surface-container-lowest rounded-xl p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 mb-4 border-b border-surface-container-high">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-error-container/40 flex items-center justify-center text-on-error-container">
              <span className="material-symbols-outlined text-[22px]">gavel</span>
            </div>
            <div>
              <h2 className="text-lg font-bold text-on-surface">Kepatuhan &amp; Keputusan Tertunda</h2>
              <p className="text-xs text-on-surface-variant mt-0.5">
                Kewajiban hukum dan keputusan produk yang menunggu tindak lanjut
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Peringatan: Right-to-Erasure */}
          <div className="p-5 rounded-xl bg-amber-100 border border-amber-300 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="material-symbols-outlined text-amber-800 text-[22px] shrink-0"
                  style={{ fontVariationSettings: "'FILL' 1" }}
                >
                  delete_forever
                </span>
                <h3 className="text-sm font-extrabold text-amber-900 uppercase tracking-wider">
                  Right-to-Erasure (UU PDP)
                </h3>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-error-container text-on-error text-[11px] font-extrabold">
                  P1
                </span>
                <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-amber-800 text-amber-50 text-[11px] font-extrabold">
                  Menunggu keputusan produk
                </span>
              </div>
            </div>
            <p className="text-sm text-amber-900 leading-relaxed">
              Permintaan hak penghapusan data subjek (data warga) belum memiliki alur produk
              final: verifikasi identitas pemohon, cakupan penghapusan antar-tenant, dan retensi
              backup masih ditentukan.
            </p>
            <div className="p-3 rounded-lg bg-amber-50 border border-amber-200">
              <p className="text-xs text-amber-900 leading-relaxed">
                <b>Catatan risiko:</b> Risiko kepatuhan hukum bila ditunda — permintaan
                penghapusan data warga perlu alur verifikasi &amp; retensi backup.
              </p>
            </div>
          </div>

          {/* Catatan kepatuhan statis */}
          <div className="p-5 rounded-xl bg-surface-container-low border border-surface-container-high space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="material-symbols-outlined text-primary text-[22px] shrink-0">history</span>
                <h3 className="text-sm font-extrabold text-on-surface uppercase tracking-wider">
                  Catatan Kepatuhan Log
                </h3>
              </div>
              <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-primary-container text-on-primary text-[11px] font-extrabold">
                Aktif
              </span>
            </div>
            <p className="text-sm text-on-surface leading-relaxed">
              Seluruh entri audit log platform bersifat <b>append-only</b> — tidak dapat diubah,
              dipindahtangani, maupun dihapus oleh aktor mana pun, termasuk System Admin.
            </p>
            <p className="text-sm text-on-surface-variant leading-relaxed">
              Retensi penyimpanan log dan data pribadi mengikuti ketentuan{" "}
              <b>UU PDP No. 27/2022</b> beserta peraturan pelaksananya.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
