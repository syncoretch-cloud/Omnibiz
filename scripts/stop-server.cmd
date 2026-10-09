@echo off
rem Stops whatever OmniBiz server is listening on port 4000.
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 4000 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force; Write-Host ('Stopped OmniBiz server (process ' + $_.OwningProcess + ')') }"
