#!/usr/bin/env bash
# Keeps ops/monitor.sh running. Restarts it 30 s after it exits.
# Start once, in the background:  (nohup ops/keepalive.sh >> /tmp/levelai-monitor-keepalive.log 2>&1 &)
cd "$(dirname "$0")/.."
while true; do
  echo "$(date '+%H:%M:%S') starting ops/monitor.sh"
  ./ops/monitor.sh
  echo "$(date '+%H:%M:%S') ops/monitor.sh exited ($?); restarting in 30 s"
  sleep 30
done
