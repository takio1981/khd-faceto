@echo off
REM Stop the dev backend (port 3001). Does not touch Docker — the
REM production stack (khd_faceto_app, khd_faceto_db) keeps running.
setlocal
cd /d "%~dp0"

echo [dev] Stopping dev backend on port 3001 (if running)...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3001 " ^| findstr "LISTENING"') do (
  echo      -^> Stopping PID %%a
  taskkill /F /PID %%a >nul 2>&1
)

endlocal
