# The one command (Windows). Runs rounds until the queue (and the next queue) is finished.
#   powershell -ExecutionPolicy Bypass -File autopilot\run.ps1              # IR console, then the IM portal
#   powershell -ExecutionPolicy Bypass -File autopilot\run.ps1 -Queue im
# Stop at any time: create the file autopilot\STOP (or Ctrl+C). Run the same command again to resume.
param([string]$Queue = "console", [int]$MaxRounds = 500)
Set-Location (Split-Path -Parent $PSScriptRoot)
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $OutputEncoding = [System.Text.Encoding]::UTF8
New-Item -ItemType Directory -Force autopilot\logs | Out-Null
node autopilot/make-queue.mjs console | Out-Null
node autopilot/notify.mjs ":rocket: *Autopilot started* on $env:COMPUTERNAME - queue $Queue. It runs round the clock until everything is built."
$round = 0; $waited = $false
while ($round -lt $MaxRounds) {
  node autopilot/next.mjs $Queue --check; $code = $LASTEXITCODE
  if ($code -eq 3) { "STOP file present - stopping."; node autopilot/notify.mjs ":octagonal_sign: Autopilot stopped (STOP file)."; break }
  if ($code -eq 1) {
    $next = node -e "console.log(require('./autopilot/$Queue/queue.json').next_queue||'')"
    if ($next) { "$Queue finished - moving on to $next"; $Queue = $next; continue }
    "All queues finished."; node autopilot/notify.mjs ":tada: *Everything is built.* Testing phase starts - see autopilot/status.json and the workbooks."; break
  }
  if ($code -eq 2) {
    "$(Get-Date -Format s) only waiting on people (see autopilot\$Queue\BLOCKED.md) - checking again in 30 min"
    if (-not $waited) { node autopilot/notify.mjs ":raised_hand: *Autopilot is waiting on you* - only items in autopilot/$Queue/BLOCKED.md are left before the next story. Tick them and it carries on." }
    $waited = $true; Start-Sleep 1800; continue
  }
  $waited = $false
  $round++; $log = "autopilot\logs\$(Get-Date -Format yyyyMMdd).log"
  "=== $(Get-Date -Format s) round $round queue $Queue" | Tee-Object -FilePath $log -Append
  # the prompt goes in on stdin: passed as an argument, PowerShell split it at the first quote
  $prompt = (Get-Content autopilot\PROMPT.md -Raw).Replace("{{QUEUE}}", $Queue)
  $prompt | claude -p --permission-mode acceptEdits --max-turns 300 --output-format text 2>&1 | Tee-Object -FilePath $log -Append
  if ($LASTEXITCODE -ne 0) { "claude exited $LASTEXITCODE (limit or error) - pausing 15 min" | Tee-Object -FilePath $log -Append; Start-Sleep 900 }
  node autopilot/status.mjs
  # (delivery workbook for the console queue is not configured in pm/plan_config.py yet)
  Start-Sleep 5
}
