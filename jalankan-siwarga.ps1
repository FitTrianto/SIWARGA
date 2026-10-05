#Requires -Version 5.1
<#
  SIWARGA - menyalakan / mematikan stack pengembangan lokal (PostgreSQL + API + frontend).

  Pemakaian (dari folder monorepo, atau klik ganda berkas .cmd):
    .\jalankan-siwarga.ps1                nyalakan yang belum hidup, lalu verifikasi
    .\jalankan-siwarga.ps1 -Status        cek saja, tidak mengubah apa pun
    .\jalankan-siwarga.ps1 -Stop          matikan API & frontend (PostgreSQL tetap hidup)
    .\jalankan-siwarga.ps1 -Stop -StopDb  ... plus cluster PostgreSQL

  Catatan penting:
  - Kunci dev SESSION_SECRET / NIK_ENCRYPTION_KEY disamakan PERSIS dengan
    packages/server/scripts/dev-stack.mjs, supaya data ter-encrypt di database
    tetap terbaca setiap kali script ini dijalankan.
  - Data PostgreSQL persisten (packages/server/.data-dev) dan TIDAK PERNAH
    dihapus oleh script ini. Ingin data dari nol?  pnpm dev:stack -- --reset
  - Log tiap proses ada di folder logs\ (di-ignore git).
#>
param(
  [switch]$Stop,
  [switch]$StopDb,
  [switch]$Status
)

$ErrorActionPreference = "Stop"

$Akar = $PSScriptRoot
$DirLog = Join-Path $Akar "logs"
if (-not (Test-Path $DirLog)) { New-Item -ItemType Directory -Path $DirLog | Out-Null }

$PORT_PG = 55432
$PORT_API = 3000
$PORT_VITE = 5173

# Kunci dev tetap - HARUS identik dengan KUNCI_SESI / KUNCI_NIK di
# packages/server/scripts/dev-stack.mjs, agar NIK terenkripsi lama tetap terbaca.
$KUNCI_SESI = "EYtobB70g8xjLV4h3zZLkfGf0VCnZctBpDYb8TDNVbo="
$KUNCI_NIK = "y+IGjpYzJ/UlpojGmwi1gypJE5rqVaKjr8j1wgOXIfY="
$URL_ADMIN = "postgresql://postgres:siwarga@127.0.0.1:$PORT_PG/siwarga_dev"
$URL_APP = "postgresql://siwarga_app:siwarga@127.0.0.1:$PORT_PG/siwarga_dev"

function Test-PortOpen([int]$Port) {
  $klien = New-Object System.Net.Sockets.TcpClient
  try {
    $klien.Connect("127.0.0.1", $Port)
    $klien.Close()
    return $true
  } catch {
    return $false
  }
}

function Start-Detached([string]$Perintah, [string]$NamaLog) {
  $pathLog = Join-Path $DirLog $NamaLog
  $arg = '/c ' + $Perintah + ' > "' + $pathLog + '" 2>&1'
  Start-Process -FilePath $env:ComSpec -ArgumentList $arg -WorkingDirectory $Akar -WindowStyle Hidden | Out-Null
}

function Wait-Port([int]$Port, [int]$BatasDetik) {
  $batas = (Get-Date).AddSeconds($BatasDetik)
  while ((Get-Date) -lt $batas) {
    if (Test-PortOpen $Port) { return $true }
    Start-Sleep -Milliseconds 500
  }
  return $false
}

$script:GalatHttp = ""
function Wait-Http([string]$Url, [int]$BatasDetik) {
  $mulai = Get-Date
  $batas = $mulai.AddSeconds($BatasDetik)
  $percobaan = 0
  $script:GalatHttp = ""
  while ((Get-Date) -lt $batas) {
    $percobaan++
    try {
      $res = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
      if ($res.StatusCode -ge 200 -and $res.StatusCode -lt 400) {
        Write-Host ("                 -> siap dalam {0:N0} detik" -f ((Get-Date) - $mulai).TotalSeconds)
        return $res
      }
      $script:GalatHttp = "HTTP " + $res.StatusCode
    } catch {
      $script:GalatHttp = $_.Exception.Message
    }
    if ($percobaan % 20 -eq 0) {
      Write-Host ("                 ... menunggu kesiapan ({0:N0} detik berlalu)" -f ((Get-Date) - $mulai).TotalSeconds)
    }
    Start-Sleep -Milliseconds 500
  }
  return $null
}

function Show-Status {
  $pg = Test-PortOpen $PORT_PG
  $api = Test-PortOpen $PORT_API
  $vite = Test-PortOpen $PORT_VITE

  Write-Host ""
  Write-Host "STATUS STACK SIWARGA"
  Write-Host ("  PostgreSQL  :{0,-6} {1}" -f $PORT_PG, $(if ($pg) { "HIDUP" } else { "mati" }))
  Write-Host ("  Backend API :{0,-6} {1}" -f $PORT_API, $(if ($api) { "HIDUP" } else { "mati" }))
  Write-Host ("  Frontend    :{0,-6} {1}" -f $PORT_VITE, $(if ($vite) { "HIDUP" } else { "mati" }))

  if ($api) {
    try {
      $h = Invoke-WebRequest -Uri "http://127.0.0.1:$PORT_API/api/v1/health" -UseBasicParsing -TimeoutSec 3
      $j = $h.Content | ConvertFrom-Json
      Write-Host ("                 -> {0}, database {1}, migrasi: {2} diterapkan / {3} gagal" -f `
        $j.data.status, $j.data.database, $j.data.migrasi.diterapkan, $j.data.migrasi.gagal)
    } catch {
      Write-Host "                 -> port terbuka, /api/v1/health belum terbaca"
    }
  }
  if ($vite) {
    $hal = $null
    for ($coba = 1; $coba -le 3 -and -not $hal; $coba++) {
      try {
        $hal = Invoke-WebRequest -Uri "http://127.0.0.1:$PORT_VITE" -UseBasicParsing -TimeoutSec 3
      } catch {
        $hal = $null
        Start-Sleep -Seconds 1 # Vite kadang restart singkat saat optimasi dependensi
      }
    }
    if ($hal) {
      Write-Host ("                 -> HTTP {0}" -f $hal.StatusCode)
    } else {
      Write-Host "                 -> port terbuka, halaman belum terbaca"
    }
  }
  Write-Host ""
  return @{ pg = $pg; api = $api; vite = $vite }
}

function Start-Stack {
  Write-Host "SIWARGA - menyalakan stack pengembangan..."

  # --- 1. PostgreSQL -------------------------------------------------------
  $dbBaruMulai = $false
  if (Test-PortOpen $PORT_PG) {
    Write-Host "[1/3] PostgreSQL sudah hidup - dilewati."
  } else {
    Write-Host "[1/3] Menyalakan PostgreSQL (log: logs\db.log)..."
    Start-Detached "node packages\server\scripts\dev-stack.mjs --db-only" "db.log"
    if (-not (Wait-Port $PORT_PG 120)) {
      Write-Host "[GAGAL] PostgreSQL tidak hidup dalam 120 detik. Cek logs\db.log" -ForegroundColor Red
      exit 1
    }
    $dbBaruMulai = $true
    Write-Host "[OK] PostgreSQL hidup."
  }

  # --- 2. migrasi schema (bila DB berjalan dari luar, dev-stack belum jalan) --
  if ($dbBaruMulai) {
    Write-Host "[2/3] Migrasi & seed dijalankan dev-stack - dilewati."
  } else {
    $prisma = Join-Path $Akar "packages\server\node_modules\prisma\build\index.js"
    if (Test-Path $prisma) {
      Write-Host "[2/3] Memastikan migrasi terbaru (prisma migrate deploy)..."
      $env:NODE_ENV = "development"
      $env:DATABASE_URL = $URL_ADMIN
      $kode = 1
      try {
        Push-Location (Join-Path $Akar "packages\server")
        try {
          & node $prisma migrate deploy
          $kode = $LASTEXITCODE
        } finally {
          Pop-Location
        }
      } catch {
        Write-Host ("[PERINGATAN] migrasi dilewati: " + $_.Exception.Message) -ForegroundColor Yellow
      }
      if ($kode -ne 0) {
        Write-Host ("[PERINGATAN] prisma migrate deploy keluar dengan kode $kode - migrasi tidak terverifikasi.") -ForegroundColor Yellow
      }
    } else {
      Write-Host "[2/3] Prisma tidak ditemukan - dilewati."
    }
  }

  # --- 3. Backend API ------------------------------------------------------
  if (Test-PortOpen $PORT_API) {
    Write-Host "[3/3] Backend API sudah hidup - dilewati."
  } else {
    Write-Host "[3/3] Menyalakan Backend API (log: logs\api.log)..."
    if (Remove-ZombieRantai 'watch src/server\.ts') {
      Write-Host "[..] membersihkan sisa rantai proses API lama (berkas log terkunci)."
    }
    $env:NODE_ENV = "development"
    $env:HOST = "127.0.0.1"
    $env:PORT = [string]$PORT_API
    $env:DATABASE_URL = $URL_APP
    $env:SESSION_SECRET = $KUNCI_SESI
    $env:NIK_ENCRYPTION_KEY = $KUNCI_NIK
    $env:AUTH_RATE_LIMIT_PER_MENIT = "60"
    $env:PERIODE_AKTIF = "2026-10"
    Start-Detached "pnpm dev:server" "api.log"
    if (-not (Wait-Http "http://127.0.0.1:$PORT_API/api/v1/health" 150)) {
      Write-Host ("[GAGAL] Backend API tidak sehat dalam 150 detik. Galat terakhir: " + $script:GalatHttp) -ForegroundColor Red
      Write-Host "       Cek logs\api.log" -ForegroundColor Red
      exit 1
    }
    Write-Host "[OK] Backend API sehat."
  }

  # --- 4. Frontend Vite ----------------------------------------------------
  if (Test-PortOpen $PORT_VITE) {
    Write-Host "[4/4] Frontend sudah hidup - dilewati."
  } else {
    Write-Host "[4/4] Menyalakan frontend Vite (log: logs\vite.log)..."
    if (Remove-ZombieRantai '(@siwarga/web|bin[\\/]vite\.js)') {
      Write-Host "[..] membersihkan sisa rantai proses frontend lama (berkas log terkunci)."
    }
    Start-Detached "pnpm dev" "vite.log"
    if (-not (Wait-Http "http://127.0.0.1:$PORT_VITE" 90)) {
      Write-Host ("[GAGAL] Frontend tidak menjawab dalam 90 detik. Galat terakhir: " + $script:GalatHttp) -ForegroundColor Red
      Write-Host "       Cek logs\vite.log" -ForegroundColor Red
      exit 1
    }
    Write-Host "[OK] Frontend hidup."
  }

  $null = Show-Status
  Write-Host "Aplikasi : http://localhost:5173"
  Write-Host "Akun demo: Warga 081234567890 / WargaDev2026"
  Write-Host "           RT    rt04@siwarga.id / rahasia123"
  Write-Host "           RW    rw012@siwarga.id / rahasia123"
  Write-Host "Berhenti : .\jalankan-siwarga.ps1 -Stop   (DB: tambah -StopDb)"
}

<#
  Matikan SELURUH rantai proses sebuah PID: naik ke induk selama masih
  node.exe/cmd.exe (pnpm -> tsx watch -> server, atau vite), lalu taskkill /T
  dari puncaknya. Tanpa ini, membunuh hanya proses pendengar port menyisakan
  induk (tsx watch/pnpm/cmd) yang mengunci berkas log dan menggagalkan
  start berikutnya secara diam-diam.
#>
function Stop-Rantai([int]$ProsesId) {
  $kini = $ProsesId
  for ($i = 0; $i -lt 15; $i++) {
    $p = Get-CimInstance Win32_Process -Filter "ProcessId=$kini" -ErrorAction SilentlyContinue
    if (-not $p) { return $false }
    $induk = Get-CimInstance Win32_Process -Filter "ProcessId=$($p.ParentProcessId)" -ErrorAction SilentlyContinue
    # Induk asli selalu lebih tua; induk "baru lahir" = hasil PID dipakai ulang - jangan ikut.
    if ($induk -and $induk.Name -match '^(node|cmd)\.exe$' -and $induk.CreationDate -le $p.CreationDate) {
      $kini = $induk.ProcessId
    } else {
      break
    }
  }
  & taskkill /PID $kini /T /F 2>&1 | Out-Null
  return $true
}

# Sisa rantai (zombie): node milik API/frontend yang masih hidup padahal port sudah mati.
function Remove-ZombieRantai([string]$Pola) {
  $ada = $false
  $daftar = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue
  foreach ($p in $daftar) {
    if ($p.CommandLine -and $p.CommandLine -match $Pola) {
      $ada = $true
      $null = Stop-Rantai $p.ProcessId
    }
  }
  return $ada
}

function Stop-ProsesPort([int]$Port) {
  $kon = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if (-not $kon) { return $false }
  return (Stop-Rantai $kon.OwningProcess)
}

function Stop-Stack {
  Write-Host "SIWARGA - mematikan stack..."

  if (Stop-ProsesPort $PORT_API) {
    Write-Host "[OK] Backend API (:$PORT_API) dimatikan."
  } else {
    Write-Host "[..] Backend API tidak sedang berjalan."
  }

  if (Stop-ProsesPort $PORT_VITE) {
    Write-Host "[OK] Frontend (:$PORT_VITE) dimatikan."
  } else {
    Write-Host "[..] Frontend tidak sedang berjalan."
  }

  # Rantai zombie (induk pnpm/tsx/vite yang port-nya sudah mati) ikut dibersihkan.
  if (Remove-ZombieRantai 'watch src/server\.ts') {
    Write-Host "[OK] membersihkan sisa rantai proses API."
  }
  if (Remove-ZombieRantai '(@siwarga/web|bin[\\/]vite\.js)') {
    Write-Host "[OK] membersihkan sisa rantai proses frontend."
  }

  if (-not $StopDb) {
    Write-Host "[..] PostgreSQL (:$PORT_PG) tetap HIDUP. Ingin ikut dimatikan? tambah -StopDb"
    $null = Show-Status
    return
  }

  # Mekanisme halus dev-stack: tulis berkas berhenti yang dipantau broker cluster.
  $berkasBerhenti = Join-Path $env:TEMP "siwarga-dev-pg-stop.txt"
  try {
    [System.IO.File]::WriteAllText($berkasBerhenti, "1")
  } catch {
    Write-Host ("[PERINGATAN] gagal menulis berkas berhenti: " + $_.Exception.Message) -ForegroundColor Yellow
  }
  $batas = (Get-Date).AddSeconds(15)
  while ((Get-Date) -lt $batas -and (Test-PortOpen $PORT_PG)) {
    Start-Sleep -Milliseconds 500
  }

  if (Test-PortOpen $PORT_PG) {
    Write-Host "[..] Cluster belum berhenti sendiri - paksa (taskkill)..."
    $null = Stop-ProsesPort $PORT_PG
    Start-Sleep -Seconds 2
  }

  # Sisa induk dev-stack --db-only (bila masih ada) ikut dimatikan.
  try {
    Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
      Where-Object { $_.CommandLine -match 'dev-stack\.mjs' -and $_.CommandLine -match 'db-only' } |
      ForEach-Object { & taskkill /PID $_.ProcessId /T /F 2>&1 | Out-Null }
  } catch { } # tidak ada sisa - tidak masalah

  try { Remove-Item $berkasBerhenti -Force -ErrorAction SilentlyContinue } catch { }

  if (Test-PortOpen $PORT_PG) {
    Write-Host "[GAGAL] PostgreSQL masih hidup. Cek proses postgres.exe manual." -ForegroundColor Red
  } else {
    Write-Host "[OK] PostgreSQL (:$PORT_PG) dimatikan. Data tersimpan di packages/server/.data-dev"
  }
  $null = Show-Status
}

# --- jalur utama ------------------------------------------------------------
if ($Stop) {
  Stop-Stack
} elseif ($Status) {
  $null = Show-Status
} else {
  Start-Stack
}
