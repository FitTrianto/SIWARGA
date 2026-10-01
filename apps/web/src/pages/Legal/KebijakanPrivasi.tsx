import type { ReactNode } from "react";
import { LegalShell } from "./LegalShell";

interface HalamanProps {
  onBack: () => void;
  onNavigate: (page: string) => void;
}

const daftarIsi = [
  "Dasar Hukum dan Komitmen",
  "Data yang Kami Proses",
  "Tujuan Pemrosesan",
  "Enkripsi dan Masking",
  "Siapa yang Dapat Mengakses",
  "Log Audit dan Ketertelusuran",
  "Token, OTP, dan Tautan Sekali Pakai",
  "Hak Anda sebagai Subjek Data",
  "Retensi dan Penghapusan",
  "Penyimpanan dan Perubahan Kebijakan",
  "Kontak dan Pengaduan",
];

function Bagian({ nomor, judul, children }: { nomor: number; judul: string; children: ReactNode }) {
  return (
    <section id={`bab-${nomor}`} className="scroll-mt-28">
      <h2 className="flex items-baseline gap-3 text-lg sm:text-xl font-extrabold text-slate-900 mb-3">
        <span className="font-mono text-emerald-700 text-sm shrink-0">{nomor}.</span>
        {judul}
      </h2>
      <div className="space-y-3 text-sm sm:text-base text-slate-600 leading-relaxed pl-0 sm:pl-8">{children}</div>
    </section>
  );
}

export function KebijakanPrivasiPage({ onBack, onNavigate }: HalamanProps) {
  return (
    <LegalShell
      aktif="privasi"
      judul="Kebijakan Privasi"
      meta="Berlaku sejak 26 September 2026 · Versi 1.0 · Selaras dengan UU No. 27 Tahun 2022 tentang Pelindungan Data Pribadi"
      onBack={onBack}
      onNavigate={onNavigate}
    >
      <nav aria-label="Daftar isi" className="rounded-xl bg-emerald-50/70 border border-emerald-900/10 p-4 sm:p-5">
        <p className="text-xs font-bold uppercase tracking-widest text-emerald-800 mb-3">Daftar Isi</p>
        <ol className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
          {daftarIsi.map((judul, i) => (
            <li key={judul}>
              <a
                className="text-sm text-slate-600 hover:text-emerald-800 hover:underline transition-colors"
                href={`#bab-${i + 1}`}
              >
                {i + 1}. {judul}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <Bagian nomor={1} judul="Dasar Hukum dan Komitmen">
        <p>
          SIWARGA memproses data pribadi penduduk RT/RW berdasarkan UU No. 27 Tahun 2022 tentang
          Pelindungan Data Pribadi dan peraturan pelaksanaannya, dalam rangka penyelenggaraan tata kelola
          lingkungan yang menjadi fungsi pengurus RT/RW.
        </p>
        <p>
          Kami berkomitmen memproses data secara sah, terbatas pada tujuan yang diberitahukan, tidak
          berlebihan, akurat, dan tidak melampaui keperluan layanan. Data pribadi tidak pernah dijual,
          disewakan, atau dibagikan kepada pihak ketiga untuk keperluan pemasaran.
        </p>
      </Bagian>

      <Bagian nomor={2} judul="Data yang Kami Proses">
        <ul className="list-disc pl-5 space-y-1.5">
          <li>
            <strong>Data identitas</strong> — nama, NIK, nomor kartu keluarga, tanggal lahir, jenis
            kelamin, agama, pekerjaan, alamat, dan hubungan keluarga.
          </li>
          <li>
            <strong>Data kontak</strong> — nomor WhatsApp dan surel yang dipakai untuk undangan, notifikasi,
            dan pemulihan akun.
          </li>
          <li>
            <strong>Data transaksi</strong> — nominal iuran, riwayat pembayaran, dan catatan kas RT/RW.
          </li>
          <li>
            <strong>Dokumen dan layanan surat</strong> — permintaan surat pengantar, dokumen pendukung,
            serta tanda tangan QR pengurus.
          </li>
          <li>
            <strong>Data perangkat dan log</strong> — waktu akses, peran yang masuk, dan tindakan terhadap
            data sensitif yang tercatat pada log audit.
          </li>
        </ul>
        <p>
          Kami tidak meminta salinan KTP atau dokumen identitas lain diunggah ke platform; cukup data
          kependudukan yang diisi sesuai kartu keluarga dan diverifikasi pengurus.
        </p>
      </Bagian>

      <Bagian nomor={3} judul="Tujuan Pemrosesan">
        <ul className="list-disc pl-5 space-y-1.5">
          <li>Menyelenggarakan layanan tata kelola RT/RW: pendataan, iuran, surat, dan laporan.</li>
          <li>Memverifikasi identitas warga terhadap data kependudukan setempat.</li>
          <li>Mengirim notifikasi layanan melalui WhatsApp dan surel — undangan, status surat, pengingat iuran.</li>
          <li>Menjaga keamanan platform dan mendeteksi penyalahgunaan akun.</li>
          <li>Memenuhi kewajiban pencatatan dan pelaporan yang ditetapkan pengurus dan peraturan.</li>
        </ul>
      </Bagian>

      <Bagian nomor={4} judul="Enkripsi dan Masking">
        <ul className="list-disc pl-5 space-y-1.5">
          <li>
            NIK dan data sensitif lain disimpan dalam bentuk terenkripsi AES-256 di penyimpanan server.
          </li>
          <li>
            NIK, nomor kartu keluarga, dan nomor kontak ditampilkan <em>masked</em> di seluruh antarmuka —
            misalnya{" "}
            <span className="font-mono text-xs">3171-xxxx-xxxx-0004</span> — sehingga data penuh tidak
            terlihat di layar, tangkapan layar, maupun halaman cetak biasa.
          </li>
          <li>
            Kata sandi disimpan ter-hash (argon2id); tidak ada pihak mana pun — termasuk pengurus —
            yang dapat melihat kata sandi Anda.
          </li>
          <li>Koneksi antara perangkat dan server dialiri melalui HTTPS.</li>
        </ul>
      </Bagian>

      <Bagian nomor={5} judul="Siapa yang Dapat Mengakses">
        <p>Akses mengikuti prinsip hak minimum, dibedakan per peran:</p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>
            <strong>Anda (Warga)</strong> — data keluarga Anda sendiri dan informasi publik lingkungan.
          </li>
          <li>
            <strong>Pengurus RT</strong> — data warga dalam lingkup RT-nya untuk keperluan verifikasi dan
            pelayanan.
          </li>
          <li>
            <strong>Pengurus RW</strong> — data agregat per RT (rekap iuran, jumlah warga, status surat);
            tidak berwenang membuka data per-individu lintas RT.
          </li>
          <li>
            <strong>System Admin</strong> — metadata tenant, langganan, dan kesehatan layanan; tidak
            memegang akses terhadap data pribadi warga.
          </li>
        </ul>
        <p>
          Data tidak dibagikan kepada pihak luar selain jika diwajibkan peraturan perundang-undangan atau
          atas permintaan resmi aparat yang sah.
        </p>
      </Bagian>

      <Bagian nomor={6} judul="Log Audit dan Ketertelusuran">
        <p>
          Setiap akses terhadap data sensitif tercatat dalam log audit: siapa mengakses, data apa, kapan,
          dan untuk tujuan apa. Log ini dapat ditinjau Pengurus RT dan System Admin untuk mendeteksi akses
          yang tidak wajar, serta menjadi bukti ketertelusuran sebagaimana diamanatkan UU PDP.
        </p>
      </Bagian>

      <Bagian nomor={7} judul="Token, OTP, dan Tautan Sekali Pakai">
        <p>
          Tautan undangan dan kode OTP dirancang sekali pakai dan berlaku terbatas: setiap warga menerima
          token tersendiri, kode disimpan dalam bentuk ter-hash, dan tautan kedaluwarsa otomatis. Proses
          pengiriman berjalan lewat antrean notifikasi agar trafik massal saat onboarding tidak
          mengorbankan keamanan. Jangan meneruskan tautan atau kode OTP kepada siapa pun.
        </p>
      </Bagian>

      <Bagian nomor={8} judul="Hak Anda sebagai Subjek Data">
        <p>Berdasarkan UU PDP, Anda berhak:</p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>memperoleh kejelasan tentang data apa tentang Anda yang kami proses;</li>
          <li>memperbaiki data yang tidak akurat melalui formulir perbaikan data di Portal Warga;</li>
          <li>
            menghapus data yang tidak lagi diperlukan — tersedia sebagai fitur Hapus Data dengan token
            konfirmasi agar penghapusan tidak dilakukan tanpa sengaja;
          </li>
          <li>menarik persetujuan yang pernah diberikan dan mengajukan keberatan terhadap pemrosesan;</li>
          <li>mengajukan gugatan ganti rugi bila Anda dirugikan oleh pemrosesan yang melanggar hukum.</li>
        </ul>
        <p>
          Permintaan akses, koreksi, dan penghapusan diajukan lewat Portal Warga dan diverifikasi Pengurus
          RT sebelum dilaksanakan, agar penghapusan tidak mengorbankan kewajiban pencatatan yang diwajibkan
          hukum.
        </p>
      </Bagian>

      <Bagian nomor={9} judul="Retensi dan Penghapusan">
        <p>
          Data disimpan selama akun aktif dan selama jangka pencatatan yang diwajibkan peraturan
          kependudukan dan tata kelola. Setelah akun ditutup atau permintaan penghapusan disetujui, data
          yang tidak lagi wajib disimpan dihapus dari sistem aktif; catatan yang wajib tersimpan tetap
          disimpan terenkripsi dan dibatasi aksesnya sesuai keperluan hukum saja.
        </p>
      </Bagian>

      <Bagian nomor={10} judul="Penyimpanan dan Perubahan Kebijakan">
        <p>
          Server dan pusat data berlokasi di Indonesia. Perubahan kebijakan yang bersifat material
          diumumkan melalui kanal resmi dalam produk sebelum berlaku, disertai tanggal revisi pada bagian
          atas halaman ini.
        </p>
      </Bagian>

      <Bagian nomor={11} judul="Kontak dan Pengaduan">
        <p>
          Pertanyaan dan permintaan terkait data pribadi disampaikan kepada Pengurus RT melalui Portal
          Warga. Bila merasa hak Anda dilanggar, Anda berhak mengadukan masalah tersebut kepada lembaga
          pengawas pelindungan data pribadi sesuai ketentuan UU PDP. Ketentuan penggunaan platform
          dijelaskan dalam{" "}
          <button
            type="button"
            className="font-bold text-emerald-800 hover:underline"
            onClick={() => onNavigate("syarat-ketentuan")}
          >
            Syarat &amp; Ketentuan
          </button>
          .
        </p>
      </Bagian>
    </LegalShell>
  );
}
