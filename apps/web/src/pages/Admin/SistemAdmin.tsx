import { LayananSistem, MetrikSistem, badgeStatusLayanan } from "../../lib/adminData";

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

export function SistemAdmin({ layanan, metrik }: {
  layanan: LayananSistem[];
  metrik: MetrikSistem;
}) {
  const ringkasStatus = (["Sehat", "Degradasi", "Gangguan"] as const).map((s) => ({
    status: s,
    jumlah: layanan.filter((l) => l.status === s).length,
  }));

  const kartuMetrik = [
    {
      label: "Uptime 30 Hari",
      nilai: `${metrik.uptime30Hari.toFixed(2)}%`,
      ikon: "health_and_safety",
      catatan: "Ketersediaan platform",
      kecil: false,
    },
    {
      label: "Pengguna Aktif Hari Ini",
      nilai: metrik.penggunaAktifHariIni.toLocaleString("id-ID"),
      ikon: "group",
      catatan: "Login 24 jam terakhir",
      kecil: false,
    },
    {
      label: "Antrean Notifikasi",
      nilai: metrik.antreanNotifikasi.toLocaleString("id-ID"),
      ikon: "notifications_active",
      catatan: "Pesan menunggu dikirim",
      kecil: false,
    },
    {
      label: "Ukuran Basis Data",
      nilai: metrik.ukuranBasisData,
      ikon: "database",
      catatan: "Data seluruh tenant",
      kecil: false,
    },
    {
      label: "Backup Terakhir",
      nilai: metrik.backupTerakhir,
      ikon: "backup",
      catatan: "Backup harian otomatis",
      kecil: true,
    },
  ];

  const sumberDaya = [
    { label: "CPU", ikon: "memory", nilai: metrik.cpu },
    { label: "Memori", ikon: "developer_board", nilai: metrik.memori },
    { label: "Penyimpanan", ikon: "storage", nilai: metrik.penyimpanan },
  ];

  return (
    <div className="max-w-7xl mx-auto w-full space-y-6">
      {/* 1. Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl lg:text-3xl font-extrabold tracking-tight text-on-surface">Kesehatan Sistem</h1>
          <p className="text-sm text-on-surface-variant mt-1 max-w-2xl">
            Pemantauan ketersediaan layanan, beban infrastruktur, dan status backup platform SIWARGA
            — seluruh komponen lintas-tenant dalam satu tampilan (§8.5).
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {ringkasStatus.map((r) => (
            <span
              key={r.status}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold ${badgeStatusLayanan(r.status)}`}
            >
              <span className="font-mono">{r.jumlah}</span>
              {r.status}
            </span>
          ))}
        </div>
      </div>

      {/* 2. Kartu Metrik Sistem */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        {kartuMetrik.map((k) => (
          <div key={k.label} className="bg-surface-container-lowest rounded-xl p-5 shadow-sm flex flex-col justify-between">
            <div className="flex items-start justify-between gap-2">
              <span className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider leading-tight">
                {k.label}
              </span>
              <div className="w-10 h-10 rounded-full bg-tertiary-container flex items-center justify-center text-on-tertiary shrink-0">
                <span className="material-symbols-outlined text-[22px]">{k.ikon}</span>
              </div>
            </div>
            <div className="mt-4">
              <div
                className={`font-extrabold text-on-surface font-mono leading-snug break-words ${
                  k.kecil ? "text-base" : "text-2xl"
                }`}
              >
                {k.nilai}
              </div>
              <div className="text-xs text-on-surface-variant mt-1">{k.catatan}</div>
            </div>
          </div>
        ))}
      </div>

      {/* 3. Progress Bar CPU / Memori / Penyimpanan */}
      <section className="bg-surface-container-lowest rounded-xl p-6 shadow-sm">
        <div className="flex items-center justify-between pb-4 mb-5 border-b border-surface-container-high">
          <div>
            <h2 className="text-lg font-bold text-on-surface">Beban Infrastruktur</h2>
            <p className="text-xs text-on-surface-variant mt-0.5">
              Ambang normal ≤ 60%, waspada ≤ 85%, kritis &gt; 85%
            </p>
          </div>
          <span className="material-symbols-outlined text-primary text-[24px]">speed</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {sumberDaya.map((s) => (
            <div key={s.label}>
              <div className="flex items-center justify-between gap-3 mb-2">
                <div className="flex items-center gap-2 text-sm font-bold text-on-surface">
                  <span className="material-symbols-outlined text-[20px] text-on-surface-variant">{s.ikon}</span>
                  {s.label}
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-lg font-extrabold font-mono text-on-surface">{s.nilai}%</span>
                  <span className={`text-[11px] font-bold ${teksBeban(s.nilai)}`}>{labelBeban(s.nilai)}</span>
                </div>
              </div>
              <div className="w-full bg-surface-container-high h-3 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${warnaBeban(s.nilai)}`}
                  style={{ width: `${s.nilai}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 4. Tabel Kesehatan Layanan */}
      <section className="bg-surface-container-lowest rounded-xl p-6 shadow-sm">
        <div className="flex items-center justify-between pb-4 mb-4 border-b border-surface-container-high">
          <div>
            <h2 className="text-lg font-bold text-on-surface">Daftar Layanan</h2>
            <p className="text-xs text-on-surface-variant mt-0.5">
              Status, uptime 30 hari, latensi rata-rata, dan catatan operasional tiap komponen
            </p>
          </div>
          <span className="material-symbols-outlined text-primary text-[24px]">dns</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[760px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-on-surface-variant border-b border-surface-container-high">
                <th className="py-2.5 pr-3 font-bold">Layanan</th>
                <th className="py-2.5 px-3 font-bold">Status</th>
                <th className="py-2.5 px-3 font-bold text-right">Uptime</th>
                <th className="py-2.5 px-3 font-bold text-right">Latensi</th>
                <th className="py-2.5 pl-3 font-bold">Catatan</th>
              </tr>
            </thead>
            <tbody>
              {layanan.map((l) => (
                <tr
                  key={l.id}
                  className="border-b border-surface-container-high last:border-0 hover:bg-surface-container-low transition-colors align-top"
                >
                  <td className="py-3 pr-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-surface-container-high flex items-center justify-center shrink-0">
                        <span className="material-symbols-outlined text-on-surface-variant text-[16px]">lan</span>
                      </div>
                      <span className="font-bold text-on-surface">{l.nama}</span>
                    </div>
                  </td>
                  <td className="py-3 px-3">
                    <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold whitespace-nowrap ${badgeStatusLayanan(l.status)}`}>
                      {l.status}
                    </span>
                  </td>
                  <td className="py-3 px-3 text-right font-mono font-semibold text-on-surface whitespace-nowrap">
                    {l.uptime.toFixed(2)}%
                  </td>
                  <td className="py-3 px-3 text-right font-mono text-on-surface whitespace-nowrap">
                    {l.latensi} ms
                  </td>
                  <td className="py-3 pl-3 text-xs text-on-surface-variant leading-relaxed">{l.catatan}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-[11px] text-on-surface-variant mt-4 pt-4 border-t border-surface-container-high">
          Pembaruan metrik setiap 60 detik &bull; Backup harian terjadwal pukul 03.00 WIB &bull; Insiden tercatat otomatis
          pada Audit Log Platform.
        </p>
      </section>
    </div>
  );
}
