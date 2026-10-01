import {
  Tenant,
  TransaksiLangganan,
  LayananSistem,
  MetrikSistem,
  rekapPlatform,
  rekapTransaksi,
  badgeStatusLayanan,
  badgePaket,
  badgeStatusTenant,
} from "../../lib/adminData";
import { formatRupiah } from "../../lib/shared";

// — Parsing tanggal pendek "12 Jan 2025" untuk mengurutkan tenant terbaru —
const BULAN_PENDEK: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, Mei: 4, Jun: 5,
  Jul: 6, Agu: 7, Sep: 8, Okt: 9, Nov: 10, Des: 11,
};

function waktuSejak(sejak: string): number {
  const [tgl, bulan, tahun] = sejak.split(" ");
  const idxBulan = BULAN_PENDEK[bulan];
  if (idxBulan === undefined || !tgl || !tahun) return 0;
  return new Date(Number(tahun), idxBulan, Number(tgl)).getTime();
}

/** Warna bar beban: ≤60% primary, ≤85% amber, >85% error. */
function warnaBeban(nilai: number): string {
  if (nilai <= 60) return "bg-primary";
  if (nilai <= 85) return "bg-amber-500";
  return "bg-error";
}

function teksBeban(nilai: number): string {
  if (nilai <= 60) return "text-primary";
  if (nilai <= 85) return "text-amber-600";
  return "text-error";
}

function labelBeban(nilai: number): string {
  if (nilai <= 60) return "Normal";
  if (nilai <= 85) return "Waspada";
  return "Kritis";
}

export function DashboardAdmin({ onNavigate, tenants, transaksi, layanan, metrik }: {
  onNavigate?: (page: string) => void;
  tenants: Tenant[];
  transaksi: TransaksiLangganan[];
  layanan: LayananSistem[];
  metrik: MetrikSistem;
}) {
  const rekap = rekapPlatform(tenants);
  const ringkasTx = rekapTransaksi(transaksi);

  // 5 tenant dengan tanggal bergabung paling baru.
  const tenantTerbaru = [...tenants]
    .sort((a, b) => waktuSejak(b.sejak) - waktuSejak(a.sejak))
    .slice(0, 5);

  const daftarPaket = (["Free", "Pro", "Max"] as const).map((p) => ({
    paket: p,
    jumlah: rekap.perPaket[p],
  }));

  const daftarStatus = (["Aktif", "Nonaktif", "Uji Coba", "Menunggu Pembayaran"] as const).map((s) => ({
    status: s,
    jumlah: rekap.perStatus[s],
  }));

  const sumberDaya = [
    { label: "CPU", ikon: "memory", nilai: metrik.cpu },
    { label: "Memori", ikon: "developer_board", nilai: metrik.memori },
    { label: "Penyimpanan", ikon: "storage", nilai: metrik.penyimpanan },
  ];

  const kpiPlatform = [
    { label: "Total RW", nilai: rekap.totalRw, ikon: "apartment", catatan: "Tenant terdaftar lintas wilayah" },
    { label: "Total RT", nilai: rekap.totalRt, ikon: "location_city", catatan: "Rukun tetangga binaan" },
    { label: "Total KK", nilai: rekap.totalKk, ikon: "home", catatan: "Kepala keluarga terdaftar" },
    { label: "Total Warga", nilai: rekap.totalWarga, ikon: "groups", catatan: "Jiwa terlayani platform" },
  ];

  return (
    <div className="max-w-7xl mx-auto w-full space-y-6">
      {/* 1. Header Judul */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl lg:text-3xl font-extrabold tracking-tight text-on-surface">Monitoring Platform</h1>
          <p className="text-sm text-on-surface-variant mt-1 max-w-2xl">
            Ringkasan operasional lintas-tenant: sebaran paket langganan, transaksi, dan kesehatan
            layanan platform SIWARGA — dipantau dari satu konsol System Admin.
          </p>
        </div>
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-secondary-container/40 text-on-secondary-container text-xs font-semibold shrink-0">
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-secondary opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-secondary" />
          </span>
          Pemantauan Real-Time &bull; {rekap.totalRw} Tenant Dipantau
        </div>
      </div>

      {/* 2. KPI Platform (§8.1) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpiPlatform.map((k) => (
          <div key={k.label} className="bg-surface-container-lowest rounded-xl p-5 shadow-sm flex flex-col justify-between">
            <div className="flex items-start justify-between">
              <span className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">{k.label}</span>
              <div className="w-10 h-10 rounded-full bg-primary-container flex items-center justify-center text-on-primary">
                <span className="material-symbols-outlined text-[22px]">{k.ikon}</span>
              </div>
            </div>
            <div className="mt-4">
              <div className="text-2xl font-extrabold text-on-surface font-mono">{k.nilai.toLocaleString("id-ID")}</div>
              <div className="text-xs text-on-surface-variant mt-1">{k.catatan}</div>
            </div>
          </div>
        ))}
      </div>

      {/* 3. Distribusi Paket + Status Tenant + Ringkasan Transaksi */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
        {/* Distribusi Paket */}
        <section className="bg-surface-container-lowest rounded-xl p-6 shadow-sm">
          <div className="flex items-center justify-between pb-4 mb-4 border-b border-surface-container-high">
            <div>
              <h2 className="text-lg font-bold text-on-surface">Distribusi Paket</h2>
              <p className="text-xs text-on-surface-variant mt-0.5">Sebaran langganan seluruh tenant</p>
            </div>
            <span className="material-symbols-outlined text-primary text-[24px]">workspace_premium</span>
          </div>
          <div className="space-y-3">
            {daftarPaket.map((p) => (
              <div key={p.paket} className="flex items-center justify-between gap-3">
                <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${badgePaket(p.paket)}`}>
                  {p.paket}
                </span>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-lg font-extrabold font-mono text-on-surface">{p.jumlah}</span>
                  <span className="text-[11px] text-on-surface-variant">tenant</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Status Tenant */}
        <section className="bg-surface-container-lowest rounded-xl p-6 shadow-sm">
          <div className="flex items-center justify-between pb-4 mb-4 border-b border-surface-container-high">
            <div>
              <h2 className="text-lg font-bold text-on-surface">Status Tenant</h2>
              <p className="text-xs text-on-surface-variant mt-0.5">Aktivasi &amp; masa uji coba wilayah</p>
            </div>
            <span className="material-symbols-outlined text-primary text-[24px]">domain</span>
          </div>
          <div className="space-y-3">
            {daftarStatus.map((s) => (
              <div key={s.status} className="flex items-center justify-between gap-3">
                <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${badgeStatusTenant(s.status)}`}>
                  {s.status}
                </span>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-lg font-extrabold font-mono text-on-surface">{s.jumlah}</span>
                  <span className="text-[11px] text-on-surface-variant">tenant</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Ringkasan Transaksi */}
        <section className="bg-surface-container-lowest rounded-xl p-6 shadow-sm md:col-span-2 lg:col-span-1">
          <div className="flex items-center justify-between pb-4 mb-4 border-b border-surface-container-high">
            <div>
              <h2 className="text-lg font-bold text-on-surface">Ringkasan Transaksi</h2>
              <p className="text-xs text-on-surface-variant mt-0.5">Pembayaran langganan paket</p>
            </div>
            <span className="material-symbols-outlined text-primary text-[24px]">payments</span>
          </div>
          <div className="flex items-center gap-3 p-4 rounded-xl bg-primary-container/30 border border-primary/15">
            <div className="w-10 h-10 rounded-lg bg-primary flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-on-primary text-[22px]">account_balance</span>
            </div>
            <div className="min-w-0">
              <div className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider">Pemasukan Terealisasi</div>
              <div className="text-xl font-extrabold text-on-surface font-mono truncate">{formatRupiah(ringkasTx.pemasukan)}</div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 mt-3">
            <div className="p-4 rounded-xl bg-surface-container-low border border-surface-container-high">
              <div className="flex items-center gap-1.5 text-on-surface-variant">
                <span className="material-symbols-outlined text-[16px]">schedule</span>
                <span className="text-[11px] font-semibold uppercase tracking-wider">Menunggu</span>
              </div>
              <div className="text-xl font-extrabold font-mono text-amber-700 mt-1">{ringkasTx.menunggu}</div>
              <div className="text-[11px] text-on-surface-variant mt-0.5">transaksi</div>
            </div>
            <div className="p-4 rounded-xl bg-surface-container-low border border-surface-container-high">
              <div className="flex items-center gap-1.5 text-on-surface-variant">
                <span className="material-symbols-outlined text-[16px]">error</span>
                <span className="text-[11px] font-semibold uppercase tracking-wider">Gagal</span>
              </div>
              <div className="text-xl font-extrabold font-mono text-error mt-1">{ringkasTx.gagal}</div>
              <div className="text-[11px] text-on-surface-variant mt-0.5">transaksi</div>
            </div>
          </div>
        </section>
      </div>

      {/* 4. Kesehatan Singkat (ringkas §8.5) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Daftar layanan */}
        <section className="lg:col-span-7 bg-surface-container-lowest rounded-xl p-6 shadow-sm">
          <div className="flex items-center justify-between pb-4 mb-4 border-b border-surface-container-high">
            <div>
              <h2 className="text-lg font-bold text-on-surface">Kesehatan Layanan</h2>
              <p className="text-xs text-on-surface-variant mt-0.5">Status &amp; uptime 30 hari tiap komponen sistem</p>
            </div>
            <span className="material-symbols-outlined text-primary text-[24px]">health_and_safety</span>
          </div>
          <div>
            {layanan.map((l) => (
              <div
                key={l.id}
                className="flex items-center justify-between gap-3 py-3 border-b border-surface-container-high last:border-0 hover:bg-surface-container-low transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-lg bg-surface-container-high flex items-center justify-center shrink-0">
                    <span className="material-symbols-outlined text-on-surface-variant text-[18px]">dns</span>
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-on-surface truncate">{l.nama}</div>
                    <div className="text-[11px] text-on-surface-variant">
                      Latensi <span className="font-mono">{l.latensi}</span> ms
                    </div>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${badgeStatusLayanan(l.status)}`}>
                    {l.status}
                  </span>
                  <span className="text-[11px] font-extrabold font-mono text-on-surface">{l.uptime.toFixed(2)}%</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Beban infrastruktur */}
        <section className="lg:col-span-5 bg-surface-container-lowest rounded-xl p-6 shadow-sm">
          <div className="flex items-center justify-between pb-4 mb-4 border-b border-surface-container-high">
            <div>
              <h2 className="text-lg font-bold text-on-surface">Beban Sistem</h2>
              <p className="text-xs text-on-surface-variant mt-0.5">Utilisasi rata-rata infrastruktur platform</p>
            </div>
            <div className="text-right">
              <div className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider">Uptime 30 Hari</div>
              <div className="text-lg font-extrabold font-mono text-primary">{metrik.uptime30Hari.toFixed(2)}%</div>
            </div>
          </div>
          <div className="space-y-5 pt-1">
            {sumberDaya.map((s) => (
              <div key={s.label}>
                <div className="flex items-center justify-between gap-3 mb-1.5">
                  <div className="flex items-center gap-2 text-sm font-semibold text-on-surface">
                    <span className="material-symbols-outlined text-[18px] text-on-surface-variant">{s.ikon}</span>
                    {s.label}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-extrabold font-mono text-on-surface">{s.nilai}%</span>
                    <span className={`text-[11px] font-bold ${teksBeban(s.nilai)}`}>{labelBeban(s.nilai)}</span>
                  </div>
                </div>
                <div className="w-full bg-surface-container-high h-2.5 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${warnaBeban(s.nilai)}`}
                    style={{ width: `${s.nilai}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-on-surface-variant mt-5 pt-4 border-t border-surface-container-high">
            Ambang normal ≤ 60%, waspada ≤ 85%, kritis &gt; 85%. Detail lengkap tersedia di halaman Kesehatan Sistem.
          </p>
        </section>
      </div>

      {/* 5. Tabel 5 Tenant Terbaru + Aksi */}
      <section className="bg-surface-container-lowest rounded-xl p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 mb-4 border-b border-surface-container-high gap-3">
          <div>
            <h2 className="text-lg font-bold text-on-surface">Tenant Terbaru</h2>
            <p className="text-xs text-on-surface-variant mt-0.5">5 tenant dengan tanggal bergabung paling baru</p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 min-h-[44px] rounded-xl bg-primary hover:bg-primary-container text-on-primary text-sm font-bold transition-all shrink-0"
              onClick={() => onNavigate?.("tenant-admin")}
            >
              <span className="material-symbols-outlined text-[18px]">domain</span>
              Kelola Tenant
            </button>
            <button
              type="button"
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 min-h-[44px] rounded-xl bg-surface-container-lowest border border-surface-container-high text-on-surface text-sm font-bold shadow-sm hover:bg-surface-container-high transition-all shrink-0"
              onClick={() => onNavigate?.("audit-admin")}
            >
              <span className="material-symbols-outlined text-[18px]">policy</span>
              Lihat Audit Log
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[600px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-on-surface-variant border-b border-surface-container-high">
                <th className="py-2.5 pr-3 font-bold">Tenant</th>
                <th className="py-2.5 px-3 font-bold">Kota</th>
                <th className="py-2.5 px-3 font-bold">Paket</th>
                <th className="py-2.5 px-3 font-bold">Status</th>
                <th className="py-2.5 pl-3 font-bold text-right">Warga</th>
              </tr>
            </thead>
            <tbody>
              {tenantTerbaru.map((t) => (
                <tr
                  key={t.id}
                  className="border-b border-surface-container-high last:border-0 hover:bg-surface-container-low transition-colors"
                >
                  <td className="py-3 pr-3">
                    <div className="font-bold text-on-surface">{t.nama}</div>
                    <div className="text-[11px] text-on-surface-variant mt-0.5">
                      Sejak <span className="font-mono">{t.sejak}</span> &bull; {t.admin}
                    </div>
                  </td>
                  <td className="py-3 px-3 text-on-surface-variant">{t.kota}</td>
                  <td className="py-3 px-3">
                    <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${badgePaket(t.paket)}`}>
                      {t.paket}
                    </span>
                  </td>
                  <td className="py-3 px-3">
                    <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${badgeStatusTenant(t.status)}`}>
                      {t.status}
                    </span>
                  </td>
                  <td className="py-3 pl-3 text-right font-mono font-semibold text-on-surface">
                    {t.jumlahWarga.toLocaleString("id-ID")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
