@echo off
REM ===================================================================
REM  Dev mode for developers to test changes and fix bugs BEFORE running
REM  build.bat for production. Two pieces run side by side, both
REM  separate from the production Docker stack so nothing there is
REM  touched:
REM
REM    1. Backend (ts-node-dev, auto-reload) on port 3001, opened in its
REM       own window. Connects to the SAME database the production
REM       stack uses (khd_faceto_db, published on localhost:3307) - no
REM       separate dev database to manage. Also opens its own HTTPS dev
REM       cert on port 3444 (NOT 3443 - that's the production
REM       container's published HTTPS port; using a different one here
REM       avoids a port clash if both run at once).
REM
REM    2. Frontend (Angular CLI dev server, `ng serve`) on port 4200,
REM       in THIS window, with hot module reload - edit any file under
REM       frontend-ng/src and the browser updates instantly, no manual
REM       rebuild. API calls are proxied to the backend dev server above
REM       (see frontend-ng/proxy.conf.json).
REM
REM  Open http://localhost:4200 to test. Camera works there too (it's
REM  localhost). Press Ctrl+C to stop the frontend; close the backend
REM  window separately, or run stop-dev.bat.
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

REM --- [0/4] Kill any stale dev servers still holding the dev ports ---
echo [0/4] Closing previous dev servers (ports 3001, 4200)...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3001 " ^| findstr "LISTENING"') do (
  echo      -^> Stopping previous backend dev server ^(PID: %%a^)
  taskkill /F /PID %%a >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":4200 " ^| findstr "LISTENING"') do (
  echo      -^> Stopping previous frontend dev server ^(PID: %%a^)
  taskkill /F /PID %%a >nul 2>&1
)
echo.

REM --- [1/4] Make sure khd_faceto_db (production DB container) is up ---
echo [1/4] Checking khd_faceto_db (Docker)...
docker ps --filter "name=khd_faceto_db" --filter "status=running" --format "{{.Names}}" | findstr /i "khd_faceto_db" >nul
if errorlevel 1 (
  echo [dev] khd_faceto_db is not running.
  echo       Start it with: docker compose up -d mariadb   (or build.bat)
  exit /b 1
)
echo       khd_faceto_db is running.
echo.

REM --- [2/4] Backend deps ---
if not exist backend\node_modules (
  echo [2/4] Installing backend dependencies...
  pushd backend
  call npm install
  if errorlevel 1 ( popd & exit /b 1 )
  popd
) else (
  echo [2/4] Backend dependencies already installed.
)
echo.

REM --- [3/4] Frontend deps ---
if not exist frontend-ng\node_modules (
  echo [3/4] Installing frontend dependencies...
  pushd frontend-ng
  call npm install
  if errorlevel 1 ( popd & exit /b 1 )
  popd
) else (
  echo [3/4] Frontend dependencies already installed.
)
echo.

REM --- [4/4] Start backend (own window) then frontend (this window) ---
echo [4/4] Starting backend dev server in a new window...
REM Override only what differs from the production .env. dotenv does not
REM overwrite vars already set in process.env, so JWT_SECRET, FACE_*,
REM COMPANY_NAME, etc. still come from the root .env. Set here (not
REM inside the quoted /k command below) so the new window just inherits
REM them - keeps the quoting simple.
REM 127.0.0.1 instead of "localhost" - on Windows/Docker Desktop,
REM "localhost" can resolve to ::1 first and intermittently fail to reach
REM the container's published port, causing spurious DB connect retries.
set NODE_ENV=development
set PORT=3001
set HTTPS_PORT=3444
set DB_HOST=127.0.0.1
set DB_PORT=3307
set BACKEND_DIR=%~dp0backend
start "KHD-FaceTo Backend (dev, port 3001)" cmd /k "cd /d "%BACKEND_DIR%" && npm run dev"

echo.
echo ===================================================
echo   Backend (dev) : http://localhost:3001   (ts-node-dev, auto-reload)
echo   Frontend (dev) : http://localhost:4200   (ng serve, hot reload)
echo   Docker prod    : http://localhost:3000   (untouched)
echo   Database       : khd_faceto_db (shared with production - same data)
echo.
echo   Edit backend/src/*.ts or frontend-ng/src/* and the change applies
echo   live (backend restarts itself / frontend hot-reloads in browser).
echo   Press Ctrl+C here to stop the frontend dev server; close the
echo   other window (or run stop-dev.bat) to stop the backend.
echo ===================================================
echo.

cd frontend-ng
call npx ng serve --proxy-config proxy.conf.json --port 4200

endlocal
