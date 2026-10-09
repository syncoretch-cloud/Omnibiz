@echo off
rem Starts the OmniBiz server on http://localhost:4000 (output goes to server\data\server.log).
cd /d "%~dp0..\server"
if not exist data mkdir data
echo [%date% %time%] starting OmniBiz server >> data\server.log
node --disable-warning=ExperimentalWarning src\index.ts >> data\server.log 2>&1
