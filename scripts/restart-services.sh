#!/bin/bash
# Restart all Spectral Soundworks services
# Usage: bash scripts/restart-services.sh
set -e

SUPERVISOR_CONF="/etc/zo/supervisord-user.conf"
CTL="supervisorctl -c $SUPERVISOR_CONF"

echo "=== Restarting Spectral Soundworks stack ==="

restart_svc() {
  local name="$1"
  local status
  status=$($CTL status "$name" 2>/dev/null | awk '{print $2}')
  
  echo -n "[$name] "
  if [ "$status" = "RUNNING" ]; then
    $CTL restart "$name" >/dev/null 2>&1 && echo "restarted" || echo "FAILED"
  elif [ "$status" = "FATAL" ] || [ "$status" = "STOPPED" ]; then
    echo "not running (was $status) — starting..."
    $CTL start "$name" >/dev/null 2>&1 && echo "started" || echo "FAILED to start"
  else
    echo "skipping (status: $status)"
  fi
}

restart_svc "spectral-postgres"
sleep 2

restart_svc "spectral-soundworks"
sleep 4

restart_svc "email-reply-poller" || true

echo ""
echo "=== Health check ==="
curl -s -o /dev/null -w "App (Zo fallback): HTTP %{http_code}\n" https://spectral-soundworks-kkkkrash.zocomputer.io
echo ""
echo "Service status:"
$CTL status spectral-postgres spectral-soundworks email-reply-poller 2>/dev/null
echo ""
echo "Done."