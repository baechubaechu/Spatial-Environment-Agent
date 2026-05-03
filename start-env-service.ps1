$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "[1/3] Next.js dev server should be running (e.g. :3001 — see repo root .env.local EVENT_BRIDGE_BASE_URL)"
Write-Host "[2/3] Env: repo root .env.local / .env is loaded automatically by the service"
Write-Host "[3/3] Start FastAPI environment service on :8000 (uses global python -m pip if you ran: pip install -r requirements.txt)"
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
