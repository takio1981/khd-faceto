@echo off
REM ===================================================================
REM  Dev mode (like "ng serve"): run the backend on the host with
REM  hot-reload (ts-node-dev), on a port separate from the production
REM  Docker app (3001 vs 3000) so both can run side by side. Connects
REM  straight to the same khd_faceto_db Docker container production
REM  uses (published on localhost:3307) - no separate DB to manage.
REM  Frontend (frontend/public) is served live by Express — just edit
REM  and refresh the browser, no rebuild/restart needed.
REM ===================================================================
setlocal
cd /d "%~dp0"

echo ===================================================
echo   KHD-FACETO - DEVELOPMENT MODE
echo ===================================================
echo.

if not exist .env (
  echo [dev] Missing .env in project root. Copy .env.example to .env first.
  exit /b 1
)

REM --- [0/3] Kill any stale dev server still holding the dev port ---
echo [0/3] Closing previous dev server (port 3001)...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3001 " ^| findstr "LISTENING"') do (
  echo      -^> Stopping previous dev server ^(PID: %%a^)
  taskkill /F /PID %%a >nul 2>&1
)
echo.

REM --- [1/3] Make sure khd_faceto_db (production DB container) is up ---
echo [1/3] Checking khd_faceto_db (Docker)...
docker ps --filter "name=khd_faceto_db" --filter "status=running" --format "{{.Names}}" | findstr /i "khd_faceto_db" >nul
if errorlevel 1 (
  echo [dev] khd_faceto_db is not running.
  echo       Start it with: docker compose up -d mariadb   (or build-prod.bat)
  exit /b 1
)
echo       khd_faceto_db is running.
echo.

REM --- [2/3] Backend deps ---
cd backend
if not exist node_modules (
  echo [2/3] Installing backend dependencies...
  call npm install
  if errorlevel 1 exit /b 1
) else (
  echo [2/3] Backend dependencies already installed.
)
echo.

REM --- [3/3] Start backend with hot-reload ---
REM Override only what differs from the production .env. dotenv does not
REM overwrite vars already set in process.env, so JWT_SECRET, FACE_*,
REM COMPANY_NAME, etc. still come from the root .env.
set NODE_ENV=development
REM Different host port than the production app container (3000), so dev
REM and prod can run at the same time without a port conflict.
set PORT=3001
REM khd_faceto_db's port published to the host as 3307 (see
REM docker-compose.yml) - NOT 3306, because this machine has a native
REM MariaDB Windows service already bound to 3306 that would otherwise
REM silently swallow the connection instead of the Docker container.
REM 127.0.0.1 instead of "localhost" - on Windows/Docker Desktop,
REM "localhost" can resolve to ::1 first and intermittently fail to reach
REM the container's published port, causing spurious DB connect retries.
set DB_HOST=127.0.0.1
set DB_PORT=3307

echo ===================================================
echo   Dev server : http://localhost:3001   (ts-node-dev, auto-reload)
echo   Docker prod: http://localhost:3000   (untouched)
echo   Database   : khd_faceto_db (shared with production — same data)
echo.
echo   Edit backend/src/*.ts or frontend/public/* and the change applies
echo   on save (backend restarts itself / just refresh the browser).
echo   Press Ctrl+C to stop.
echo ===================================================
echo.
call npm run dev

endlocal
