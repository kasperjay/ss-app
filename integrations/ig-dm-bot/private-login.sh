#!/bin/bash
set -euo pipefail
umask 077
export DISPLAY=:88
pids=()
cleanup() { kill "${pids[@]}" 2>/dev/null || true; }
trap cleanup EXIT
trap 'exit 0' TERM INT
Xvfb :88 -screen 0 1280x900x24 -nolisten tcp &
pids+=($!)
for attempt in {1..50}; do
  if xdpyinfo -display :88 >/dev/null 2>&1; then break; fi
  sleep 0.1
done
node src/private-login.js &
pids+=($!)
wait -n
