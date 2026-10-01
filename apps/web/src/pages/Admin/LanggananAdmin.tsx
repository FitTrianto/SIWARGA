import { useState } from "react";
import {
  badgePaket,
  badgeStatusTenant,
  badgeStatusTransaksi,
  rekapPlatform,
  rekapTransaksi,
  StatusTransaksi,
  Tenant,
  TransaksiLangganan,
} from "../../lib/adminData";
import { formatRupiah, PaketLangganan, paketInfo } from "../../lib/shared";

type FilterStatus = "Semua" | StatusTransaksi;

/**
 * §8.2 Status Langganan (P0) + §8.3 pemantauan transaksi platform (P0).
 * Konten di dalam <main> AdminLayout — tanpa sidebar/header sendiri.
 */
export function LanggananAdmin({ tenants, transaksi }: {
  tenants: Tenant[];
  transaksi: TransaksiLangganan[];
}) {
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("Semua");
  const [search, setSearch] = useState("");

  const rekap = rekapPlatform(tenants);
  const rekapTx = rekapTransaksi(transaksi);
  const daftarPaket: PaketLangganan[] = ["Free", "Pro", "Max"];

  const filtered = transaksi.filter((tx) => {
    const matchStatus = filterStatus === "Semua" || tx.status === filterStatus;
    const q = search.trim().toLowerCase();
    const matchSearch =
      q === "" ||
      tx.invoice.toLowerCase().includes(q) ||
      tx.tenantNama.toLowerCase().includes(q);
    return matchStatus && matchSearch;
  });

  return (
    <div className="max-w-7xl mx-auto w-full space-y-6">
      {/* Judul & subjudul */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div className="max-w-3xl space-y-1.5">
          <div className="inline-flex items-center gap-1.5 text-primary text-sm font-bold uppercase tracking-wider">
            <span className="material-symbols-outlined text-[16px]">workspace_premium</span>
            Langganan &amp; Pembayaran Platform
          </div>
          <h1 className="text-2xl lg:text-[32px] text-on-surface tracking-tight font-extrabold">
            Status Langganan
          </h1>
          <p className="text-sm text-on-surface-variant leading-relaxed">
            Pantau status langganan seluruh tenant beserta transaksi pembayaran paket
            Free, Pro, dan Max — sekaligus tunggakan yang per ditindaklanjuti.
          </p>
        </div>
      </div>

      {/* 3 kartu paket */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {daftarPaket.map((p) => (
          <div
            key={p}
            className="bg-surface-container-lowest rounded-xl p-5 shadow-sm flex flex-col justify-between"
          >
            <div className="flex items-start justify-between">
              <span
                className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold ${badgePaket(p)}`}
              >
                Paket {p}
              </span>
              <div className="w-10 h-10 rounded-full bg-surface-container-low flex items-center justify-center">
                <span className="material-symbols-outlined text-on-surface-variant text-[22px]">
                  workspace_premium
                </span>
              </div>
            </div>
            <div className="mt-4">
              <div className="text-2xl font-extrabold font-mono text-on-surface">
                {rekap.perPaket[p]}
              </div>
              <div className="text-[11px] text-on-surface-variant mt-1">
                tenant memakai paket ini
              </div>
              <div className="mt-3 pt-3 border-t border-surface-container-high flex items-baseline gap-1">
                <span className="text-sm font-bold font-mono text-tertiary">
                  {formatRupiah(paketInfo[p].harga)}
                </span>
                <span className="text-[11px] text-on-surface-variant">
                  / {paketInfo[p].per}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Kartu rekap transaksi */}
      <div className="bg-surface-container-lowest rounded-xl p-5 shadow-sm">
        <div className="flex items-center justify-between pb-4 mb-4 border-b border-surface-container-high">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-primary text-[22px]">payments</span>
            <div>
              <h2 className="text-base font-bold text-on-surface">Rekap Transaksi Langganan</h2>
              <p className="text-xs text-on-surface-variant mt-0.5">
                Agregat seluruh transaksi langganan platform — {transaksi.length} transaksi tercatat.
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="p-4 rounded-xl bg-primary-container/40">
            <div className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">
              Total Pemasukan (Lunas)
            </div>
            <div className="mt-2 text-2xl font-extrabold font-mono text-secondary">
              {formatRupiah(rekapTx.pemasukan)}
            </div>
            <div className="text-[11px] text-on-surface-variant mt-1">
              Dari {rekapTx.lunas} transaksi berstatus Lunas
            </div>
          </div>
          <div className="p-4 rounded-xl bg-surface-container-low">
            <div className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">
              Total Tertunggak
            </div>
            <div className="mt-2 text-2xl font-extrabold font-mono text-on-surface">
              {formatRupiah(rekapTx.tertunggak)}
            </div>
            <div className="text-[11px] text-on-surface-variant mt-1">
              Transaksi Menunggu + Gagal
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 mt-4">
          <div className="flex items-center justify-between p-3 rounded-xl bg-surface-container-low">
            <span className="text-xs font-semibold text-on-surface-variant">Lunas</span>
            <span className="text-sm font-extrabold font-mono text-on-surface">{rekapTx.lunas}</span>
          </div>
          <div className="flex items-center justify-between p-3 rounded-xl bg-surface-container-low">
            <span className="text-xs font-semibold text-on-surface-variant">Menunggu</span>
            <span className="text-sm font-extrabold font-mono text-on-surface">{rekapTx.menunggu}</span>
          </div>
          <div className="flex items-center justify-between p-3 rounded-xl bg-surface-container-low">
            <span className="text-xs font-semibold text-on-surface-variant">Gagal</span>
            <span className="text-sm font-extrabold font-mono text-on-surface">{rekapTx.gagal}</span>
          </div>
        </div>
      </div>

      {/* Tabel transaksi langganan */}
      <div className="bg-surface-container-lowest rounded-xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-surface-container-high flex flex-col md:flex-row md:items-center gap-3">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-primary text-[22px]">receipt_long</span>
            <div>
              <h2 className="text-base font-bold text-on-surface">Transaksi Langganan</h2>
              <p className="text-xs text-on-surface-variant mt-0.5">
                Pemantauan pembayaran paket seluruh tenant (§8.3).
              </p>
            </div>
          </div>
          <div className="flex-1" />
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 material-symbols-outlined text-on-surface-variant text-[20px]">
                search
              </span>
              <input
                className="w-full h-11 pl-11 pr-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-tertiary focus:outline-none transition-all"
                placeholder="Cari invoice / tenant..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <select
              className="h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-tertiary focus:outline-none transition-all"
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as FilterStatus)}
            >
              <option value="Semua">Semua Status</option>
              <option value="Lunas">Lunas</option>
              <option value="Menunggu">Menunggu</option>
              <option value="Gagal">Gagal</option>
            </select>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-on-surface">
            <thead className="bg-surface-container-low text-xs text-on-surface-variant uppercase tracking-wider">
              <tr>
                <th className="py-3 px-4">Invoice</th>
                <th className="py-3 px-4">Tanggal</th>
                <th className="py-3 px-4">Tenant</th>
                <th className="py-3 px-4">Paket</th>
                <th className="py-3 px-4">Metode</th>
                <th className="py-3 px-4 text-right">Nominal</th>
                <th className="py-3 px-4">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-container-high">
              {filtered.map((tx) => (
                <tr key={tx.id} className="hover:bg-surface-container-low/50 transition-colors">
                  <td className="py-4 px-4">
                    <span className="text-sm font-semibold font-mono text-on-surface whitespace-nowrap">
                      {tx.invoice}
                    </span>
                  </td>
                  <td className="py-4 px-4">
                    <span className="text-xs text-on-surface-variant whitespace-nowrap">{tx.tanggal}</span>
                  </td>
                  <td className="py-4 px-4">
                    <span className="text-sm font-semibold text-on-surface">{tx.tenantNama}</span>
                  </td>
                  <td className="py-4 px-4">
                    <span
                      className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold ${badgePaket(tx.paket)}`}
                    >
                      {tx.paket}
                    </span>
                  </td>
                  <td className="py-4 px-4">
                    <span className="text-sm text-on-surface">{tx.metode}</span>
                  </td>
                  <td className="py-4 px-4 text-right">
                    <span className="text-sm font-bold font-mono text-on-surface">
                      {formatRupiah(tx.nominal)}
                    </span>
                  </td>
                  <td className="py-4 px-4">
                    <span
                      className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold ${badgeStatusTransaksi(tx.status)}`}
                    >
                      {tx.status}
                    </span>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-on-surface-variant text-sm">
                    Tidak ada transaksi yang cocok dengan filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="px-6 py-3 border-t border-surface-container-high text-xs text-on-surface-variant">
          Menampilkan {filtered.length} dari {transaksi.length} transaksi
          {filterStatus !== "Semua" && <> — status: {filterStatus}</>}
        </div>
      </div>

      {/* Tabel status langganan per tenant */}
      <div className="bg-surface-container-lowest rounded-xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-surface-container-high flex items-center gap-3">
          <span className="material-symbols-outlined text-primary text-[22px]">apartment</span>
          <div>
            <h2 className="text-base font-bold text-on-surface">Status Langganan per Tenant</h2>
            <p className="text-xs text-on-surface-variant mt-0.5">
              Status langganan aktif tiap RW beserta pengurus penanggung jawab.
            </p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-on-surface">
            <thead className="bg-surface-container-low text-xs text-on-surface-variant uppercase tracking-wider">
              <tr>
                <th className="py-3 px-4">Tenant</th>
                <th className="py-3 px-4">Wilayah</th>
                <th className="py-3 px-4">Paket</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Sejak</th>
                <th className="py-3 px-4">Admin</th>
                <th className="py-3 px-4">Kontak</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-container-high">
              {tenants.map((t) => (
                <tr key={t.id} className="hover:bg-surface-container-low/50 transition-colors">
                  <td className="py-4 px-4">
                    <span className="text-sm font-semibold text-on-surface">{t.nama}</span>
                  </td>
                  <td className="py-4 px-4">
                    <span className="text-sm text-on-surface">{t.kelurahan}</span>
                    <span className="block text-xs text-on-surface-variant">{t.kota}</span>
                  </td>
                  <td className="py-4 px-4">
                    <span
                      className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold ${badgePaket(t.paket)}`}
                    >
                      {t.paket}
                    </span>
                  </td>
                  <td className="py-4 px-4">
                    <span
                      className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold ${badgeStatusTenant(t.status)}`}
                    >
                      {t.status}
                    </span>
                  </td>
                  <td className="py-4 px-4">
                    <span className="text-xs text-on-surface-variant whitespace-nowrap">{t.sejak}</span>
                  </td>
                  <td className="py-4 px-4">
                    <span className="text-sm text-on-surface">{t.admin}</span>
                  </td>
                  <td className="py-4 px-4">
                    <span className="text-xs font-mono text-on-surface-variant whitespace-nowrap">
                      {t.kontak}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-6 py-3 border-t border-surface-container-high text-xs text-on-surface-variant">
          Menampilkan {tenants.length} tenant — sumber: rekapPlatform(tenants)
        </div>
      </div>
    </div>
  );
}
