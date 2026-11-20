@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Setup-Backup.ps1"
if errorlevel 1 echo Setup did not complete. Review the message above.
pause
