import { useState } from "react";
import { tenant } from "../../lib/tenant";
import { useFlash } from "../../lib/useFlash";

interface PengaturanRWProps {
  onNavigate?: (page: string) => void;
}

export function PengaturanRW({ onNavigate }: PengaturanRWProps) {
  const { flash, toast } = useFlash();

  // Profil (read-only + modal edit)
  const [profil, setProfil] = useState({
    nama: "H. Subaidi",
    jabatan: "Ketua RW",
    kontak: "0812-8877-6655",
  });
  const [showEditProfil, setShowEditProfil] = useState(false);
  const [editProfil, setEditProfil] = useState(profil);

  // Keamanan
  const [showGantiPassword, setShowGantiPassword] = useState(false);
  const [formPassword, setFormPassword] = useState({ baru: "", konfirmasi: "" });

  // Preferensi notifikasi
  const [notif, setNotif] = useState({
    suratMenungguRw: true,
    permintaanAksesBaru: true,
    ringkasanKasMingguan: false,
  });


  function handleSimpanProfil(e: React.FormEvent) {
    e.preventDefault();
    if (!editProfil.nama.trim()) {
      flash("Nama wajib diisi");
      return;
    }
    if (!editProfil.jabatan.trim()) {
      flash("Jabatan wajib diisi");
      return;
    }
    if (!editProfil.kontak.trim()) {
      flash("Kontak wajib diisi");
      return;
    }
    setProfil({
      nama: editProfil.nama.trim(),
      jabatan: editProfil.jabatan.trim(),
      kontak: editProfil.kontak.trim(),
    });
    setShowEditProfil(false);
    flash("Profil RW berhasil disimpan");
  }

  function handleGantiPassword(e: React.FormEvent) {
    e.preventDefault();
    if (formPassword.baru.length < 8) {
      flash("Password baru minimal 8 karakter.");
      return;
    }
    if (formPassword.baru !== formPassword.konfirmasi) {
      flash("Konfirmasi password tidak sama dengan password baru.");
      return;
    }
    flash("Password berhasil diperbarui");
    setShowGantiPassword(false);
    setFormPassword({ baru: "", konfirmasi: "" });
  }

  function toggleNotif(key: keyof typeof notif, label: string) {
    const next = !notif[key];
    setNotif({ ...notif, [key]: next });
    flash(`${label} ${next ? "diaktifkan" : "dinonaktifkan"}.`);
  }

  const notifItems: { key: keyof typeof notif; icon: string; label: string; desc: string }[] = [
    {
      key: "suratMenungguRw",
      icon: "description",
      label: "Notifikasi Surat Menunggu RW",
      desc: "Beri tahu saat ada surat dari RT yang menunggu verifikasi tingkat RW.",
    },
    {
      key: "permintaanAksesBaru",
      icon: "admin_panel_settings",
      label: "Permintaan Akses Baru",
      desc: "Beri tahu saat ada perubahan status permintaan akses detail warga.",
    },
    {
      key: "ringkasanKasMingguan",
      icon: "account_balance",
      label: "Ringkasan Kas Mingguan",
      desc: "Ringkasan pemasukan & pengelolaan kas RW setiap pekan via email.",
    },
  ];

  const kebijakan = [
    {
      icon: "payments",
      teks: (
        <>
          <span className="font-bold text-error">Data iuran individu tertutup permanen bagi RW</span> — hanya data agregat per RT yang dapat dilihat (§7.2).
        </>
      ),
    },
    {
      icon: "admin_panel_settings",
      teks: (
        <>
          Akses detail warga melalui <span className="font-semibold">approval RT</span> atau mode <span className="font-semibold">direct dengan justifikasi ≥ 20 karakter</span>.
        </>
      ),
    },
    {
      icon: "shield",
      teks: (
        <>
          <span className="font-semibold">Seluruh akses tercatat di audit log</span> — approval maupun direct (§7.5).
        </>
      ),
    },
  ];

  return (
    <div className="max-w-7xl mx-auto w-full space-y-6">
      {toast}

      <div className="flex items-center gap-1.5 text-sm text-on-surface-variant">
        <button type="button" className="hover:text-primary transition-colors flex items-center gap-1" onClick={() => onNavigate?.("dashboard-rw")}><span className="material-symbols-outlined text-[16px]">home</span>
          Portal RW
        </button>
        <span className="material-symbols-outlined text-[14px]">chevron_right</span>
        <span className="font-bold text-on-surface">Pengaturan</span>
      </div>

      <div className="max-w-3xl space-y-1.5">
        <div className="inline-flex items-center gap-1.5 text-primary text-sm font-bold uppercase tracking-wider">
          <span className="material-symbols-outlined text-[16px]">settings</span>
          Pengaturan & Konfigurasi
        </div>
        <h1 className="text-2xl lg:text-[32px] text-on-surface tracking-tight font-extrabold">
          Pengaturan {tenant.rwFull}
        </h1>
      </div>

      {/* Kartu Profil */}
      <section className="bg-surface-container-lowest rounded-xl p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 mb-4 border-b border-surface-container-high">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary-container flex items-center justify-center text-on-primary-container">
              <span className="material-symbols-outlined text-[22px]">badge</span>
            </div>
            <div>
              <h2 className="text-lg font-bold text-on-surface">Profil RW</h2>
              <p className="text-xs text-on-surface-variant mt-0.5">Informasi dasar pengurus {tenant.rwFull}</p>
            </div>
          </div>
          <button
            type="button"
            className="h-10 px-4 rounded-xl bg-primary text-on-primary text-xs font-bold shadow-md hover:bg-primary-container active:scale-[0.98] transition-all flex items-center gap-1.5"
            onClick={() => { setEditProfil(profil); setShowEditProfil(true); }}
          >
            <span className="material-symbols-outlined text-[16px]">edit</span>
            Edit Profil
          </button>
        </div>
        <div className="flex items-start gap-4">
          <div className="w-14 h-14 rounded-full bg-secondary-container text-on-secondary-container flex items-center justify-center font-extrabold text-lg shrink-0">
            {profil.nama.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 flex-1 min-w-0">
            <div className="p-3 rounded-xl bg-surface-container-low">
              <div className="text-[11px] text-on-surface-variant uppercase tracking-wider font-semibold">Nama</div>
              <div className="text-sm font-bold text-on-surface mt-0.5">{profil.nama}</div>
            </div>
            <div className="p-3 rounded-xl bg-surface-container-low">
              <div className="text-[11px] text-on-surface-variant uppercase tracking-wider font-semibold">Jabatan</div>
              <div className="text-sm font-bold text-on-surface mt-0.5">{profil.jabatan}</div>
            </div>
            <div className="p-3 rounded-xl bg-surface-container-low">
              <div className="text-[11px] text-on-surface-variant uppercase tracking-wider font-semibold">Kontak</div>
              <div className="text-sm font-bold text-on-surface font-mono mt-0.5">{profil.kontak}</div>
            </div>
            <div className="p-3 rounded-xl bg-surface-container-low sm:col-span-3">
              <div className="text-[11px] text-on-surface-variant uppercase tracking-wider font-semibold">Wilayah</div>
              <div className="text-sm font-bold text-on-surface mt-0.5">{tenant.rwFull} {tenant.perumahan}</div>
            </div>
          </div>
        </div>
      </section>

      {/* Kartu Kebijakan Akses & Privasi */}
      <section className="bg-surface-container-lowest rounded-xl p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 mb-4 border-b border-surface-container-high">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-error-container/30 flex items-center justify-center text-error">
              <span className="material-symbols-outlined text-[22px]">gavel</span>
            </div>
            <div>
              <h2 className="text-lg font-bold text-on-surface">Kebijakan Akses & Privasi</h2>
              <p className="text-xs text-on-surface-variant mt-0.5">Berlaku permanen — tidak dapat dimatikan</p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-error-container/30 text-error text-[11px] font-extrabold uppercase tracking-wider">
            <span className="material-symbols-outlined text-[14px]" style={{ fontVariationSettings: "'FILL' 1" }}>lock</span>
            Non-aktifkan
          </span>
        </div>
        <div className="space-y-3">
          {kebijakan.map((k, i) => (
            <div key={i} className="p-4 rounded-xl bg-surface-container-low flex items-start gap-3">
              <span className="material-symbols-outlined text-error text-[20px] shrink-0 mt-0.5">{k.icon}</span>
              <p className="text-sm text-on-surface leading-relaxed">{k.teks}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Kartu Keamanan */}
      <section className="bg-surface-container-lowest rounded-xl p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 mb-4 border-b border-surface-container-high">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary-container flex items-center justify-center text-on-primary-container">
              <span className="material-symbols-outlined text-[22px]">password</span>
            </div>
            <div>
              <h2 className="text-lg font-bold text-on-surface">Keamanan</h2>
              <p className="text-xs text-on-surface-variant mt-0.5">Kelola keamanan akun pengurus RW</p>
            </div>
          </div>
          <button
            type="button"
            className="h-10 px-4 rounded-xl bg-primary text-on-primary text-xs font-bold shadow-md hover:bg-primary-container active:scale-[0.98] transition-all flex items-center gap-1.5"
            onClick={() => { setFormPassword({ baru: "", konfirmasi: "" }); setShowGantiPassword(true); }}
          >
            <span className="material-symbols-outlined text-[16px]">key</span>
            Ganti Password
          </button>
        </div>
        <div className="p-4 rounded-xl bg-surface-container-low flex items-start gap-3">
          <span className="material-symbols-outlined text-primary text-[20px] shrink-0 mt-0.5">verified_user</span>
          <p className="text-sm text-on-surface-variant leading-relaxed">
            Gunakan password minimal 8 karakter. Perubahan password langsung berlaku untuk seluruh sesi Portal RW.
          </p>
        </div>
      </section>

      {/* Kartu Preferensi Notifikasi */}
      <section className="bg-surface-container-lowest rounded-xl p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 mb-4 border-b border-surface-container-high">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-secondary-container flex items-center justify-center text-on-secondary-container">
              <span className="material-symbols-outlined text-[22px]">notifications</span>
            </div>
            <div>
              <h2 className="text-lg font-bold text-on-surface">Preferensi Notifikasi</h2>
              <p className="text-xs text-on-surface-variant mt-0.5">Atur pemberitahuan yang diterima pengurus RW</p>
            </div>
          </div>
        </div>
        <div className="space-y-3">
          {notifItems.map((item) => (
            <div key={item.key} className="flex items-center justify-between p-4 rounded-xl bg-surface-container-low gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <span className="material-symbols-outlined text-primary text-[22px] shrink-0">{item.icon}</span>
                <div className="min-w-0">
                  <div className="text-sm font-bold text-on-surface">{item.label}</div>
                  <div className="text-xs text-on-surface-variant">{item.desc}</div>
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  checked={notif[item.key]}
                  onChange={() => toggleNotif(item.key, item.label)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-surface-container-high peer-focus:ring-2 peer-focus:ring-primary rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-on-surface-variant after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary peer-checked:after:bg-on-primary" />
              </label>
            </div>
          ))}
        </div>
      </section>

      {/* Modal Edit Profil */}
      {showEditProfil && (
        <div className="fixed inset-0 z-50 bg-on-background/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md mx-4 sm:mx-auto rounded-2xl bg-surface-container-lowest shadow-2xl p-6 flex flex-col gap-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary-container flex items-center justify-center text-on-primary-container">
                  <span className="material-symbols-outlined text-[22px]">edit</span>
                </div>
                <div>
                  <h3 className="text-base font-bold text-on-surface">Edit Profil RW</h3>
                  <p className="text-xs text-on-surface-variant">Perbarui data profil pengurus {tenant.rwFull}</p>
                </div>
              </div>
              <button
                className="w-8 h-8 rounded-lg bg-surface-container flex items-center justify-center text-on-surface-variant hover:text-on-surface"
                onClick={() => setShowEditProfil(false)}
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <form onSubmit={handleSimpanProfil} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[16px] text-on-surface-variant">person</span>
                  Nama
                </label>
                <input
                  className="w-full h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all"
                  placeholder="Masukkan nama lengkap"
                  value={editProfil.nama}
                  onChange={(e) => setEditProfil({ ...editProfil, nama: e.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[16px] text-on-surface-variant">workspace_premium</span>
                  Jabatan
                </label>
                <input
                  className="w-full h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all"
                  placeholder="Masukkan jabatan"
                  value={editProfil.jabatan}
                  onChange={(e) => setEditProfil({ ...editProfil, jabatan: e.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[16px] text-on-surface-variant">call</span>
                  Kontak
                </label>
                <input
                  className="w-full h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface font-mono focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all"
                  placeholder="Nomor telepon / WA"
                  value={editProfil.kontak}
                  onChange={(e) => setEditProfil({ ...editProfil, kontak: e.target.value })}
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2 border-t border-surface-container-high">
                <button
                  type="button"
                  className="h-11 px-4 rounded-xl text-on-surface-variant text-sm hover:bg-surface-container-high transition-colors"
                  onClick={() => setShowEditProfil(false)}
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="h-11 px-6 rounded-xl bg-primary text-on-primary text-sm font-bold shadow-md hover:bg-primary-container active:scale-[0.98] transition-all flex items-center gap-2"
                >
                  <span className="material-symbols-outlined text-[18px]">save</span>
                  Simpan Profil
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Ganti Password */}
      {showGantiPassword && (
        <div className="fixed inset-0 z-50 bg-on-background/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md mx-4 sm:mx-auto rounded-2xl bg-surface-container-lowest shadow-2xl p-6 flex flex-col gap-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary-container flex items-center justify-center text-on-primary-container">
                  <span className="material-symbols-outlined text-[22px]">password</span>
                </div>
                <div>
                  <h3 className="text-base font-bold text-on-surface">Ganti Password</h3>
                  <p className="text-xs text-on-surface-variant">Perbarui password akun Ketua RW</p>
                </div>
              </div>
              <button
                className="w-8 h-8 rounded-lg bg-surface-container flex items-center justify-center text-on-surface-variant hover:text-on-surface"
                onClick={() => setShowGantiPassword(false)}
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <form onSubmit={handleGantiPassword} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[16px] text-on-surface-variant">lock</span>
                  Password Baru
                </label>
                <input
                  className="w-full h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all"
                  type="password"
                  placeholder="Minimal 8 karakter"
                  value={formPassword.baru}
                  onChange={(e) => setFormPassword({ ...formPassword, baru: e.target.value })}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[16px] text-on-surface-variant">verified</span>
                  Konfirmasi Password Baru
                </label>
                <input
                  className="w-full h-11 px-4 rounded-xl bg-surface-container-low text-sm text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:outline-none transition-all"
                  type="password"
                  placeholder="Ulangi password baru"
                  value={formPassword.konfirmasi}
                  onChange={(e) => setFormPassword({ ...formPassword, konfirmasi: e.target.value })}
                />
              </div>

              <p className="text-[11px] text-on-surface-variant">
                Password baru dan konfirmasi wajib minimal 8 karakter dan harus sama.
              </p>

              <div className="flex items-center justify-end gap-3 pt-2 border-t border-surface-container-high">
                <button
                  type="button"
                  className="h-11 px-4 rounded-xl text-on-surface-variant text-sm hover:bg-surface-container-high transition-colors"
                  onClick={() => setShowGantiPassword(false)}
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="h-11 px-6 rounded-xl bg-primary text-on-primary text-sm font-bold shadow-md hover:bg-primary-container active:scale-[0.98] transition-all flex items-center gap-2"
                >
                  <span className="material-symbols-outlined text-[18px]">save</span>
                  Simpan Password
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
