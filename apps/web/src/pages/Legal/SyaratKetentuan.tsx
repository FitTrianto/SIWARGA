import type { ReactNode } from "react";
import { LegalShell } from "./LegalShell";

interface HalamanProps {
  onBack: () => void;
  onNavigate: (page: string) => void;
}

const daftarIsi = [
  "Lingkup Layanan",
  "Pendaftaran & Aktivasi Akun",
  "Akun, Kata Sandi, dan Keamanan",
  "Peran dan Kewenangan Pengguna",
  "Kewajiban Warga atas Data",
  "Layanan Surat dan Tanda Tangan QR",
  "Iuran dan Transparansi Kas",
  "Pembatasan dan Penangguhan",
  "Perubahan Syarat",
  "Penyelesaian Sengketa",
  "Kontak",
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

export function SyaratKetentuanPage({ onBack, onNavigate }: HalamanProps) {
  return (
    <LegalShell
      aktif="syarat"
      judul="Syarat & Ketentuan"
      meta="Berlaku sejak 26 September 2026 · Versi 1.0 · Dipublikasikan sebelum aktivasi akun warga (consent eksplisit §9.2)"
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

      <Bagian nomor={1} judul="Lingkup Layanan">
        <p>
          SIWARGA adalah platform tata kelola digital untuk Rukun Tetangga (RT) dan Rukun Warga (RW) yang
          mencakup pendataan warga, pengelolaan iuran beserta buku kas, pengajuan surat pengantar dengan
          tanda tangan QR, laporan bulanan, dan kanal komunikasi antara pengurus dan warga.
        </p>
        <p>
          Layanan ini disediakan per-tenant: setiap RT/RW memiliki data terpisah dengan pengurus yang
          ditunjuk resmi. Penggunaan platform tunduk pada ketentuan ini dan peraturan perundang-undangan
          yang berlaku di Republik Indonesia, antara lain UU No. 27 Tahun 2022 tentang Pelindungan Data
          Pribadi.
        </p>
      </Bagian>

      <Bagian nomor={2} judul="Pendaftaran & Aktivasi Akun">
        <p>Pendaftaran akun warga dilakukan melalui salah satu jalur berikut:</p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>
            Undangan dari Pengurus RT — tautan atau QR berisi token sekali pakai yang kedaluwarsa otomatis,
            dikirim ke nomor WhatsApp terdaftar.
          </li>
          <li>
            Pendaftaran mandiri, yang tetap memerlukan verifikasi Pengurus RT berdasarkan data kependudukan
            setempat sebelum akun diaktifkan.
          </li>
          <li>
            Migrasi data oleh pengurus pada saat onboarding tenant baru, dengan daftar penduduk yang telah
            diverifikasi.
          </li>
        </ul>
        <p>
          Dengan mengaktifkan akun, Anda memberikan persetujuan eksplisit bahwa data yang Anda isi —
          termasuk nama, NIK, nomor kartu keluarga, alamat, dan nomor WhatsApp — diproses untuk keperluan
          layanan RT/RW sebagaimana dijelaskan dalam Kebijakan Privasi kami.
        </p>
      </Bagian>

      <Bagian nomor={3} judul="Akun, Kata Sandi, dan Keamanan">
        <p>
          Autentikasi memakai nomor WhatsApp terdaftar dan kata sandi minimal delapan karakter. Kata
          sandi disimpan dalam bentuk ter-hash (argon2id) — tidak pernah dalam bentuk plaintext — dan
          tidak pernah dapat dilihat kembali oleh siapa pun, termasuk pengurus.
        </p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>Anda bertanggung jawab menjaga kerahasiaan kata sandi akun Anda sendiri.</li>
          <li>
            Tiga kali memasukkan kata sandi salah berturut-turut mengunci akses sementara selama 15
            menit sebagai perlindungan akun.
          </li>
          <li>
            Pemulihan kata sandi memakai kode OTP yang harus diketik manual; jangan pernah membagikan
            kode OTP kepada pihak mana pun, termasuk yang mengaku pengurus.
          </li>
          <li>
            Segera laporkan kepada Pengurus RT bila Anda menduga akun Anda diakses pihak lain — pengurus
            dapat menangguhkan akses sambil dilakukan pemeriksaan.
          </li>
        </ul>
      </Bagian>

      <Bagian nomor={4} judul="Peran dan Kewenangan Pengguna">
        <p>Platform mengenal empat peran dengan kewenangan berbeda:</p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>
            <strong>Warga</strong> — mengelola data keluarganya, membayar iuran, mengajukan surat, dan
            melihat buku kas yang dipublikasikan.
          </li>
          <li>
            <strong>Pengurus RT</strong> — mengelola data warga dalam lingkup RT-nya, memverifikasi iuran
            dan surat, serta menandatangani surat dengan QR.
          </li>
          <li>
            <strong>Pengurus RW</strong> — memantau dan memverifikasi dalam bentuk data agregat per RT;
            tidak memiliki akses ke data per-individu lintas RT.
          </li>
          <li>
            <strong>System Admin</strong> — mengelola metadata platform dan langganan tenant tanpa
            mengakses data pribadi warga.
          </li>
        </ul>
        <p>
          Setiap akses terhadap data sensitif tercatat dalam log audit yang dapat ditinjau pengurus. Anda
          setuju tidak mencoba menembus batas peran, melakukan rekayasa akses, atau menggunakan layanan
          untuk tujuan di luar keperluan tata kelola RT/RW.
        </p>
      </Bagian>

      <Bagian nomor={5} judul="Kewajiban Warga atas Data">
        <p>
          Data yang Anda masukkan menjadi dasar verifikasi pengurus, penerbitan surat, dan perhitungan
          iuran. Karena itu Anda wajib memastikan kebenarannya dan memberi tahu pengurus bila terjadi
          perubahan — pindah alamat, tambah anggota keluarga, atau perubahan status kependudukan.
        </p>
        <p>
          NIK dan nomor kartu keluarga ditampilkan dalam bentuk masked (misalnya{" "}
          <span className="font-mono text-xs">3171-xxxx-xxxx-0004</span>) di seluruh antarmuka. Anda tidak
          diminta — dan tidak boleh — menyalin atau menyebarkan data identitas anggota keluarga lain lewat
          platform ini.
        </p>
      </Bagian>

      <Bagian nomor={6} judul="Layanan Surat dan Tanda Tangan QR">
        <p>
          Surat pengantar diajukan lewat Portal Warga, diverifikasi Pengurus RT, lalu diverifikasi Pengurus
          RW untuk jenis surat yang memerlukan tingkat RW. Tanda tangan elektronik berbasis QR merujuk pada
          identitas pengurus yang menandatangani dan tidak dapat dipalsukan dengan menyalin gambar semata.
        </p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>Pengurus berhak menolak permintaan surat yang datanya tidak dapat diverifikasi.</li>
          <li>
            Status setiap surat — diajukan, diverifikasi, ditolak, selesai — tercatat dan dapat Anda pantau
            di riwayat.
          </li>
          <li>
            Dokumen hasil ekspor bersifat resmi hanya bila diterbitkan dan ditandatangani lewat platform.
          </li>
        </ul>
      </Bagian>

      <Bagian nomor={7} judul="Iuran dan Transparansi Kas">
        <p>
          Nominal iuran ditetapkan oleh pengurus melalui musyawarah RT/RW, bukan oleh platform. Pembayaran
          dicatat oleh Bendahara dan diverifikasi Pengurus RT; konfirmasi dalam aplikasi adalah tanda bukti
          pencatatan, bukti transfer bank tetap berlaku sebagai sumber utama.
        </p>
        <p>
          Buku kas RT/RW bersifat terbuka bagi warga pada tingkat yang dipublikasikan pengurus. Laporan
          bulanan dan saldo kas dapat diunduh agar warga dapat memeriksa sendiri arus kas lingkungannya.
        </p>
      </Bagian>

      <Bagian nomor={8} judul="Pembatasan dan Penangguhan">
        <p>Pengurus atau System Admin dapat membatasi atau menangguhkan akun bila:</p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>data yang dimasukkan terbukti tidak benar dan tidak diperbaiki setelah diminta;</li>
          <li>terjadi penyalahgunaan akun atau upaya akses melampaui peran;</li>
          <li>terdapat indikasi pelanggaran hukum atau ketertiban lingkungan yang ditindaklanjuti pengurus.</li>
        </ul>
        <p>
          Anda dapat mengajukan keberatan melalui Pengurus RT. Bila akun ditangguhkan, riwayat transaksi dan
          log audit tetap disimpan sebagaimana diwajibkan hukum.
        </p>
      </Bagian>

      <Bagian nomor={9} judul="Perubahan Syarat">
        <p>
          Syarat ini dapat diperbarui mengikuti perubahan fitur atau regulasi. Perubahan material
          diumumkan lewat kanal resmi dalam produk dan berlaku sejak tanggal yang disebutkan. Kelanjutan
          penggunaan setelah perubahan berlaku berarti Anda menerima perubahan tersebut; bila tidak
          setuju, Anda dapat meminta penutupan akun melalui pengurus.
        </p>
      </Bagian>

      <Bagian nomor={10} judul="Penyelesaian Sengketa">
        <p>
          Perselisihan yang timbul dari penggunaan platform diselesaikan lebih dahulu secara musyawarah
          melalui pengurus RT/RW. Bila musyawarah tidak mencapai kata sepakat, para pihak berhak menempuh
          jalur hukum sesuai peraturan perundang-undangan Republik Indonesia.
        </p>
      </Bagian>

      <Bagian nomor={11} judul="Kontak">
        <p>
          Pertanyaan mengenai ketentuan ini dapat disampaikan kepada Pengurus RT Anda lewat Portal Warga.
          Untuk kebutuhan data pribadi — akses, koreksi, atau penghapusan — hak Anda dijelaskan dalam{" "}
          <button
            type="button"
            className="font-bold text-emerald-800 hover:underline"
            onClick={() => onNavigate("kebijakan-privasi")}
          >
            Kebijakan Privasi
          </button>
          .
        </p>
      </Bagian>
    </LegalShell>
  );
}
