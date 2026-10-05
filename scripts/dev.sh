#!/usr/bin/env bash
# One-command local development: the Go API on 127.0.0.1:8080 and the Vite dev
# server (which proxies /api) on http://localhost:5173. Ctrl-C stops both.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
bindir="$root/backend/.tmp"

for tool in go bun; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "error: '$tool' is required but was not found on PATH." >&2
    exit 1
  fi
done

mkdir -p "$bindir"

echo "building the API…"
(cd "$root/backend" && go build -o "$bindir/server" ./cmd/server)

backend_pid=""
frontend_pid=""

cleanup() {
  for pid in "$frontend_pid" "$backend_pid"; do
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  done
  for pid in "$frontend_pid" "$backend_pid"; do
    if [[ -n "$pid" ]]; then
      wait "$pid" 2>/dev/null || true
    fi
  done
}
trap cleanup EXIT INT TERM

echo "starting the API on http://127.0.0.1:8080"
(cd "$root/backend" && exec "$bindir/server") &
backend_pid=$!

# Give the API a moment so the first browser load does not race it.
sleep 0.5

echo "starting Vite on http://localhost:5173"
(cd "$root/frontend" && exec bun run dev) &
frontend_pid=$!

# The children run in the background and `wait` runs in the foreground, so the
# trap fires as soon as Ctrl-C arrives instead of after Vite exits.
# (macOS ships bash 3.2, which has no `wait -n`.)
wait "$frontend_pid"
