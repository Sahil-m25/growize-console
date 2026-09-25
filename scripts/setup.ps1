# One-time setup on Windows. Safe to re-run. See scripts/setup.sh for what each step is for.
Set-Location (Split-Path -Parent $PSScriptRoot)
Push-Location console; npm ci --no-audit --no-fund; npx --yes playwright install chromium; Pop-Location
if (-not (Get-Command graphify -ErrorAction SilentlyContinue)) { pip install graphifyy }
if (Get-Command graphify -ErrorAction SilentlyContinue) { graphify extract . --out tools/graphify }
if ($env:TYPESAFE_API_KEY -or (Test-Path .typesafe-key)) { "TypeSafe key present" } else { "!! no TypeSafe key: put it in .typesafe-key (never commit it)" }
