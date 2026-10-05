@echo off
rem SIWARGA - nyalakan stack pengembangan (PostgreSQL + API + frontend)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0jalankan-siwarga.ps1" %*
echo.
pause
