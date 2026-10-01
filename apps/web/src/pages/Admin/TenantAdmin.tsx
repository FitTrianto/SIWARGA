import { Fragment, useState } from "react";
import {
  badgePaket,
  badgeStatusTenant,
  rekapPlatform,
  Tenant,
} from "../../lib/adminData";

const langkahProvisioning: string[] = [
  "Verifikasi data RW pengaju: nama resmi, kelurahan, kota, dan jumlah RT binaan.",
  "Tentukan paket langganan awal (Free, Pro, atau Max) beserta masa uji coba.",
  "Buat akun admin tenant untuk pengurus RW sebagai pengguna pertama portal.",
  "Input struktur RT binaan beserta nama pengurus RT penanggung jawab tiap wilayah.",
  "Kirim undangan aktivasi via email/WhatsApp beserta tautan masuk portal tenant.",
  "Uji coba fungsi inti (buku kas, iuran, surat) selama masa uji coba berlangsung.",
  "Setelah pembayaran langganan terverifikasi, ubah status tenant menjadi Aktif (§8.2).",
  "Catat seluruh langkah aktivasi pada Audit Log Platform (§8.4).",
];

const keputusanTertunda = [
  {
    judul: "Impersonation / Kontrol Akses",
    prioritas: "P2",
    ket: "Menunggu keputusan produk",
  },
  {
    judul: "Tenant Merge / Split",
    prioritas: "P2",
    ket: "Menunggu keputusan produk",
  },
];

/**
 * §8.3 Aktivasi & Provisioning Tenant (P0) + section keputusan tertunda.
 * Konten di dalam <main> AdminLayout — tanpa sidebar/header sendiri.
 */
export function TenantAdmin({ tenants, onToggleStatus }: {
  tenants: Tenant[];
  onToggleStatus: (id: string) => void;
}) {
  const [idKonfirmasi, setIdKonfirmasi] = useState<string | null>(null);

  const rekap = rekapPlatform(tenants);

  const ringkasan = [
    { label: "Total Tenant", value: rekap.totalRw, icon: "domain", color: "bg-surface-container-low text-on-surface" },
    { label: "Aktif", value: rekap.perStatus.Aktif, icon: "check_circle", color: "bg-primary-container text-on-primary" },
    { label: "Nonaktif", value: rekap.perStatus.Nonaktif, icon: "block", color: "bg-error-container text-on-error" },
    { label: "Uji Coba", value: rekap.perStatus["Uji Coba"], icon: "science", color: "bg-sky-100 text-sky-800" },
  ];

  return (
    <div className="max-w-7xl mx-auto w-full space-y-6">
      {/* Judul */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div className="max-w-3xl space-y-1.5">
          <div className="inline-flex items-center gap-1.5 text-primary text-sm font-bold uppercase tracking-wider">
            <span className="material-symbols-outlined text-[16px]">domain</span>
            Aktivasi &amp; Provisioning
          </div>
          <h1 className="text-2xl lg:text-[32px] text-on-surface tracking-tight font-extrabold">
            Kelola Tenant
          </h1>
          <p className="text-sm text-on-surface-variant leading-relaxed">
            Aktifkan, nonaktifkan, dan pantau seluruh tenant RW di platform SIWARGA —
            termasuk status uji coba dan provisioning tenant baru.
          </p>
        </div>
      </div>

      {/* Kartu ringkasan */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {ringkasan.map((kpi) => (
          <div
            key={kpi.label}
            className="bg-surface-container-lowest rounded-xl p-5 shadow-sm flex flex-col justify-between"
          >
            <div className="flex items-start justify-between">
              <span className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">
                {kpi.label}
              </span>
              <div className={`w-10 h-10 rounded-full ${kpi.color} flex items-center justify-center`}>
                <span className="material-symbols-outlined text-[22px]">{kpi.icon}</span>
              </div>
            </div>
            <div className="mt-4">
              <div className="text-2xl font-extrabold text-on-surface font-mono">{kpi.value}</div>
              <div className="text-[11px] text-on-surface-variant mt-1">tenant</div>
            </div>
          </div>
        ))}
      </div>

      {/* Tabel tenant */}
      <div className="bg-surface-container-lowest rounded-xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-surface-container-high flex items-center gap-3">
          <span className="material-symbols-outlined text-primary text-[22px]">table_chart</span>
          <div>
            <h2 className="text-base font-bold text-on-surface">Daftar Tenant</h2>
            <p className="text-xs text-on-surface-variant mt-0.5">
              Klik Nonaktifkan/Aktifkan untuk mengubah status — konfirmasi muncul pada baris tenant.
            </p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-on-surface">
            <thead className="bg-surface-container-low text-xs text-on-surface-variant uppercase tracking-wider">
              <tr>
                <th className="py-3 px-4">Nama</th>
                <th className="py-3 px-4">Wilayah</th>
                <th className="py-3 px-4 text-right">RT</th>
                <th className="py-3 px-4 text-right">KK</th>
                <th className="py-3 px-4 text-right">Warga</th>
                <th className="py-3 px-4">Paket</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Admin &amp; Kontak</th>
                <th className="py-3 px-4">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-container-high">
              {tenants.map((t) => {
                const nonaktif = t.status === "Nonaktif";
                const arah = nonaktif ? "mengaktifkan" : "menonaktifkan";
                return (
                  <Fragment key={t.id}>
                    <tr className="hover:bg-surface-container-low/50 transition-colors">
                      <td className="py-4 px-4">
                        <span className="text-sm font-semibold text-on-surface">{t.nama}</span>
                        <span className="block text-[11px] text-on-surface-variant">Sejak {t.sejak}</span>
                      </td>
                      <td className="py-4 px-4">
                        <span className="text-sm text-on-surface">{t.kelurahan}</span>
                        <span className="block text-xs text-on-surface-variant">{t.kota}</span>
                      </td>
                      <td className="py-4 px-4 text-right">
                        <span className="text-sm font-mono text-on-surface">{t.jumlahRt}</span>
                      </td>
                      <td className="py-4 px-4 text-right">
                        <span className="text-sm font-mono text-on-surface">{t.jumlahKk}</span>
                      </td>
                      <td className="py-4 px-4 text-right">
                        <span className="text-sm font-mono text-on-surface">{t.jumlahWarga}</span>
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
                        <span className="text-sm font-semibold text-on-surface block">{t.admin}</span>
                        <span className="text-xs font-mono text-on-surface-variant">{t.kontak}</span>
                      </td>
                      <td className="py-4 px-4">
                        <button
                          className={`h-9 px-3 rounded-lg text-xs font-bold transition-colors inline-flex items-center gap-1.5 ${
                            nonaktif
                              ? "bg-primary-container text-on-primary hover:opacity-90"
                              : "border border-error-container text-error hover:bg-error-container/30"
                          }`}
                          onClick={() => setIdKonfirmasi(t.id)}
                        >
                          <span className="material-symbols-outlined text-[16px]">
                            {nonaktif ? "check_circle" : "block"}
                          </span>
                          {nonaktif ? "Aktifkan" : "Nonaktifkan"}
                        </button>
                      </td>
                    </tr>
                    {idKonfirmasi === t.id && (
                      <tr className="bg-error-container/30">
                        <td colSpan={9} className="px-4 py-3">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <span className="text-sm font-semibold text-on-surface inline-flex items-center gap-2">
                              <span className="material-symbols-outlined text-error text-[18px]">warning</span>
                              Yakin {arah} {t.nama}?
                            </span>
                            <div className="flex items-center gap-2">
                              <button
                                className="h-9 px-4 rounded-lg bg-error text-on-error text-xs font-bold hover:opacity-90 transition-opacity"
                                onClick={() => {
                                  onToggleStatus(t.id);
                                  setIdKonfirmasi(null);
                                }}
                              >
                                Ya
                              </button>
                              <button
                                className="h-9 px-4 rounded-lg bg-surface-container-low text-on-surface-variant text-xs font-bold hover:bg-surface-container-high transition-colors"
                                onClick={() => setIdKonfirmasi(null)}
                              >
                                Batal
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="px-6 py-3 border-t border-surface-container-high text-xs text-on-surface-variant">
          Menampilkan {tenants.length} tenant — {rekap.perStatus.Aktif} aktif,{" "}
          {rekap.perStatus.Nonaktif} nonaktif, {rekap.perStatus["Uji Coba"]} uji coba
        </div>
      </div>

      {/* Menunggu Keputusan Produk */}
      <div className="bg-surface-container-low rounded-xl p-6 shadow-sm">
        <div className="flex items-center gap-3 pb-4 mb-4 border-b border-surface-container-high">
          <div className="w-10 h-10 rounded-xl bg-surface-container-high flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-on-surface-variant text-[22px]">lock</span>
          </div>
          <div>
            <h2 className="text-base font-bold text-on-surface">Menunggu Keputusan Produk</h2>
            <p className="text-xs text-on-surface-variant mt-0.5">
              Fitur nonaktif — belum masuk rilis, menunggu arahan keputusan produk.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {keputusanTertunda.map((k) => (
            <div
              key={k.judul}
              className="bg-surface-container-lowest rounded-xl p-5 border border-surface-container-high opacity-70"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  <span className="material-symbols-outlined text-on-surface-variant text-[22px] shrink-0">
                    lock
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-sm font-bold text-on-surface">{k.judul}</h3>
                    <span className="inline-flex items-center mt-1.5 px-2 py-0.5 rounded-full bg-surface-container-high text-on-surface-variant text-[10px] font-bold uppercase tracking-wider">
                      Prioritas {k.prioritas}
                    </span>
                  </div>
                </div>
                <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-surface-container-high text-on-surface-variant text-[11px] font-bold shrink-0">
                  {k.ket}
                </span>
              </div>
              <button
                disabled
                className="mt-4 h-10 px-4 rounded-xl bg-surface-container-high text-on-surface-variant text-sm font-semibold opacity-60 cursor-not-allowed inline-flex items-center gap-2"
              >
                <span className="material-symbols-outlined text-[18px]">schedule</span>
                Segera
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Catatan provisioning */}
      <div className="bg-surface-container-lowest rounded-xl p-6 shadow-sm">
        <div className="flex items-center justify-between pb-4 mb-4 border-b border-surface-container-high">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-primary text-[22px]">manufacturing</span>
            <div>
              <h2 className="text-base font-bold text-on-surface">Catatan Provisioning Tenant Baru</h2>
              <p className="text-xs text-on-surface-variant mt-0.5">
                Ringkasan langkah aktivasi tenant dari pendaftaran hingga berstatus Aktif (§8.3).
              </p>
            </div>
          </div>
        </div>
        <ol className="space-y-3">
          {langkahProvisioning.map((langkah, i) => (
            <li key={langkah} className="flex items-start gap-3">
              <span className="w-7 h-7 rounded-full bg-tertiary-container text-on-tertiary text-xs font-extrabold font-mono flex items-center justify-center shrink-0">
                {i + 1}
              </span>
              <span className="text-sm text-on-surface leading-relaxed pt-0.5">{langkah}</span>
            </li>
          ))}
        </ol>
        <div className="mt-5 pt-4 border-t border-surface-container-high flex items-start gap-3">
          <span className="material-symbols-outlined text-on-surface-variant text-[20px] shrink-0">info</span>
          <p className="text-xs text-on-surface-variant leading-relaxed">
            Penonaktifan tenant tidak menghapus data — seluruh buku kas, iuran, dan dokumen
            tetap tersimpan dan dapat diaktifkan kembali kapan pun oleh System Admin.
          </p>
        </div>
      </div>
    </div>
  );
}
