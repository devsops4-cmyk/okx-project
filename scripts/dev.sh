#!/usr/bin/env bash
#
# Start both Sable dev servers together:
#   - agent backend  → http://localhost:8787  (chat + swap live here)
#   - frontend (Vite) → http://localhost:5173
#
# Run from the repo root via `npm run dev`. Press Ctrl-C to stop both.
# Dependencies must already be installed in agent/ and frontend/ (npm install).
#
# Why this exists: the frontend and backend are separate processes. Running only
# the frontend (plain `vite`, or the .claude/launch.json preview) leaves nothing
# at :8787, so every /api call fails in the browser with "Failed to fetch".
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Tear down the whole job on Ctrl-C or when either server exits. `kill 0` signals
# every process in this script's process group — the two `npm run dev` and their
# tsx/vite children — so nothing is left holding :8787 or :5173. (Ctrl-C already
# signals the group directly; this also covers the "a server crashed" path.)
trap 'trap - INT TERM EXIT; echo; echo "[dev] stopping both servers…"; kill 0 2>/dev/null; exit 0' INT TERM EXIT

echo "[dev] Sable — starting agent backend + frontend (Ctrl-C stops both)"
echo "[dev] backend  → http://localhost:8787"
echo "[dev] frontend → http://localhost:5173"

( cd "$ROOT/agent" && exec npm run dev ) &
( cd "$ROOT/frontend" && exec npm run dev ) &

# Return as soon as either server exits, then the trap tears the other one down.
wait -n 2>/dev/null || wait
