#!/usr/bin/env bash
# One-time setup for a fresh clone (cloud runs and new machines). Safe to re-run.
# Installs: app dependencies, Playwright's Chromium (Jev UI runner), graphify (code map).
# Plugins ponytail, chisle and reticle come from .claude/settings.json (enabledPlugins) — Claude Code installs them.
set -eu
cd "$(dirname "$0")/.."
echo "== console: npm ci"; (cd console && npm ci --no-audit --no-fund)
echo "== playwright chromium (for pm/jev-ui-runner.mjs)"
if [ -z "${PLAYWRIGHT_BROWSERS_PATH:-}" ] || [ ! -d "${PLAYWRIGHT_BROWSERS_PATH}" ]; then (cd console && npx --yes playwright install chromium) || echo "!! playwright browser install failed"; else echo "   using preinstalled browsers at $PLAYWRIGHT_BROWSERS_PATH"; fi
echo "== graphify"
if ! command -v graphify >/dev/null; then pip install --quiet graphifyy 2>/dev/null || pip install --quiet --break-system-packages graphifyy || echo "!! graphify install failed"; fi
if command -v graphify >/dev/null; then graphify extract . --out tools/graphify || echo "!! graphify extract failed"; fi
echo "== Jev key"
if [ -n "${TYPESAFE_API_KEY:-}" ] || [ -f .typesafe-key ] || [ -n "${TS_KEY_FILE:-}" ]; then echo "   TypeSafe key present"; else echo "!! no TypeSafe key: set TYPESAFE_API_KEY (cloud secret) or put it in .typesafe-key (never commit it)"; fi
echo "setup done"
