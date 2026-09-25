#!/usr/bin/env bash
# The one command. Runs rounds until the queue (and the next queue) is finished.
#   bash autopilot/run.sh            # IR console, then carries on into the IM portal
#   bash autopilot/run.sh im         # start at the IM portal
#   MAX_ROUNDS=40 bash autopilot/run.sh ir
# Stop at any time: create the file autopilot/STOP (or Ctrl+C). Start again with the same command; it resumes from progress.json.
set -u
cd "$(dirname "$0")/.."
Q="${1:-console}"; MAX="${MAX_ROUNDS:-500}"; ROUND=0; WAITED=0
mkdir -p autopilot/logs
node autopilot/make-queue.mjs console >/dev/null
node autopilot/notify.mjs ":rocket: *Autopilot started* on $(hostname) — queue $Q. It runs round the clock until everything is built."
while [ "$ROUND" -lt "$MAX" ]; do
  node autopilot/next.mjs "$Q" --check; code=$?
  if [ $code -eq 3 ]; then echo "STOP file present — stopping."; node autopilot/notify.mjs ":octagonal_sign: Autopilot stopped (STOP file)."; break; fi
  if [ $code -eq 1 ]; then
    NEXTQ=$(node -e "console.log(require('./autopilot/$Q/queue.json').next_queue||'')")
    if [ -n "$NEXTQ" ]; then echo "$Q finished — moving on to $NEXTQ"; Q="$NEXTQ"; continue; fi
    echo "All queues finished."; node autopilot/notify.mjs ":tada: *Everything is built.* Testing phase starts — see autopilot/status.json and the workbooks."; break
  fi
  if [ $code -eq 2 ]; then
    echo "$(date -Is) only waiting on people (see autopilot/$Q/BLOCKED.md) — checking again in 30 min"
    [ $WAITED -eq 0 ] && node autopilot/notify.mjs ":raised_hand: *Autopilot is waiting on you* — only items in autopilot/$Q/BLOCKED.md are left before the next story. Tick them and it carries on."
    WAITED=1; sleep 1800; continue
  fi
  WAITED=0
  ROUND=$((ROUND+1)); LOG="autopilot/logs/$(date +%Y%m%d).log"
  echo "=== $(date -Is) round $ROUND queue $Q" | tee -a "$LOG"
  PROMPT="$(sed "s/{{QUEUE}}/$Q/g" autopilot/PROMPT.md)"
  claude -p "$PROMPT" --permission-mode acceptEdits --max-turns 300 --output-format text 2>&1 | tee -a "$LOG"
  rc=${PIPESTATUS[0]}
  if [ $rc -ne 0 ]; then echo "claude exited $rc (limit or error) — pausing 15 min" | tee -a "$LOG"; sleep 900; fi
  node autopilot/status.mjs
  : # delivery workbook for the console queue not configured yet
  sleep 5
done
