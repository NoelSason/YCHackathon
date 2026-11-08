#!/usr/bin/env bash
# Take replay snapshots of the live activity log at set Pacific times, for the stage's fallback
# (./demo.sh --replay <file> shows them under a purple "Replay of the recorded run" banner).
#
#   demo/snapshot-schedule.sh                 # today's (or tomorrow's) 08:00 and 10:30
#   demo/snapshot-schedule.sh 08:00 10:30     # same, times given explicitly (24-hour, PT)
#
# Start it once, in the background, and leave it:
#   (nohup demo/snapshot-schedule.sh > "${TMPDIR:-/tmp}/levelai-snapshots.log" 2>&1 &)
# Each file lands in demo/data/run-<UTC time>.jsonl. The newest one is the one to replay.
# It exits after the last time. A time that has already passed today is taken tomorrow.
set -uo pipefail
cd "$(dirname "$0")/.."
TIMES=("$@")
[ ${#TIMES[@]} -eq 0 ] && TIMES=("08:00" "10:30")

for t in "${TIMES[@]}"; do
  now=$(date +%s)
  target=$(TZ=America/Los_Angeles date -j -f "%Y-%m-%d %H:%M:%S" "$(TZ=America/Los_Angeles date +%Y-%m-%d) ${t}:00" +%s)
  [ "$target" -le "$now" ] && target=$((target + 86400))
  echo "$(date '+%a %H:%M:%S') next snapshot at $(TZ=America/Los_Angeles date -r "$target" '+%a %H:%M') PT"
  # Sleep in short steps so a laptop that slept still fires soon after it wakes.
  while [ "$(date +%s)" -lt "$target" ]; do sleep 30; done
  for attempt in 1 2 3; do
    if npm --prefix demo run --silent snapshot; then break; fi
    echo "$(date '+%H:%M:%S') snapshot attempt $attempt failed; retrying in 60 s"
    sleep 60
  done
done
echo "$(date '+%a %H:%M:%S') done"
