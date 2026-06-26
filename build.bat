@echo off
REM ===================================================================
REM  Production build + deploy: only run this once dev.bat testing is
REM  done and bugs are fixed. Builds the backend Docker image fresh
REM  (which also compiles the Angular frontend inside the same
REM  multi-stage build - see backend/Dockerfile) and brings up the full
REM  production stack (app + mariadb) defined in docker-compose.yml.
REM ===================================================================
setlocal
cd /d "%~dp0"

echo ===================================================
echo   KHD-FACETO - PRODUCTION BUILD ^& DEPLOY
echo ===================================================
echo.

if not exist .env (
  echo [ERROR] .env file not found.
  echo         Copy .env.example to .env first.
  exit /b 1
)

docker info >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Docker Desktop is not running.
  echo         Please start Docker Desktop and try again.
  exit /b 1
)

echo [1/3] Building production image...
docker compose build
if errorlevel 1 (
  echo [FAIL] Build failed.
  exit /b 1
)
echo       Image built.
echo.

echo [2/3] Starting production stack...
docker compose up -d --wait
if errorlevel 1 (
  echo [FAIL] Failed to start production stack.
  echo.
  echo --- app logs ---
  docker compose logs --tail=30 app
  exit /b 1
)
echo       Stack started.
echo.

echo [3/3] Verifying containers...
docker compose ps
echo.
echo ===================================================
echo   DEPLOY SUCCESSFUL
echo.
echo   App (this PC)     : http://localhost:3000
echo   App (LAN/mobile)  : https://^<SERVER_LAN_IP from .env^>:3443
echo   Logs   : docker compose logs -f app
echo   Status : docker compose ps
echo ===================================================
echo.

endlocal
