@echo off
rem SIWARGA - matikan API & frontend (PostgreSQL tetap hidup; tambah -StopDb utk ikut DB)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0jalankan-siwarga.ps1" -Stop %*
echo.
pause
