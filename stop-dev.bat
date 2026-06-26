@echo off
REM Stop the dev backend (port 3001) and dev frontend (port 4200). Does
REM not touch Docker — the production stack (khd_faceto_app, khd_faceto_db)
REM keeps running.
setlocal
cd /d "%~dp0"

echo [dev] Stopping dev backend on port 3001 (if running)...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3001 " ^| findstr "LISTENING"') do (
  echo      -^> Stopping PID %%a
  taskkill /F /PID %%a >nul 2>&1
)

echo [dev] Stopping dev frontend on port 4200 (if running)...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":4200 " ^| findstr "LISTENING"') do (
  echo      -^> Stopping PID %%a
  taskkill /F /PID %%a >nul 2>&1
)

endlocal
