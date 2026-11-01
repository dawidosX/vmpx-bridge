#!/usr/bin/env bash
# Stops everything run-agents.sh started (validators, relayer, caffeinate). Databases and checkpoints stay.
source "$(dirname "$0")/lib.sh"
source "$HERE/agents-common.sh"
[ -f "$PIDFILE" ] || { echo "nic nie dziala (brak $PIDFILE)"; exit 0; }
while read -r name pid; do kill -TERM "$pid" 2>/dev/null && echo "  TERM $name ($pid)"; done < "$PIDFILE"
for _ in $(seq 1 20); do
  alive=0; while read -r _ pid; do kill -0 "$pid" 2>/dev/null && alive=1; done < "$PIDFILE"
  [ "$alive" = 0 ] && break; sleep 1
done
while read -r name pid; do kill -0 "$pid" 2>/dev/null && { kill -KILL "$pid"; echo "  KILL $name ($pid)"; }; done < "$PIDFILE"
rm -f "$PIDFILE"; echo "agents stopped"
