#!/bin/bash
# IB-127 — the level history run on the box, with IB-116's memory guard around it: funding-backfill.sh (IB-125,
# after liq-backfill.sh, IB-123/IB-145) with the CLI and the output names changed; the sampler, the gate, the floor and the kill are the same.
#
#   level-backfill.sh --dry-run|--write --until <ISO> [--start-floor N]   (on the box, as root)
#
# - the CLI runs inside the bot container with the IB-116 ruling's flags (heap 40, semi 1, optimize-for-size);
#   its own guard refuses to start below 170 MB MemAvailable and pauses below 120 MB (memory-guard.ts);
# - every second: MemAvailable (host), the bot's RSS, the CLI's RSS → /root/ib127-<mode>-<stamp>.mem;
# - if MemAvailable < 100 MB on any sample, the CLI is killed by PID and the output says «KILLED for memory»;
# - at the end: the CLI's output and the sampled minima / maxima (the format checks.py liq-weekly parses).
# - IB-145: --start-floor N → the CLI's start gate for this run (history-gate.sh: 140–500, default the CLI's 170),
#   passed as `docker exec -e MEM_START_FLOOR_MB=N`, never to the CLI's argv; the output says which gate the CLI
#   applied. A refusal by that gate is not a breakage: the last line is «DEFERRED:memory gate refused (…)», exit 3
#   (checks.py: DEFERRED, no Telegram).
# Run it as a systemd unit so it is not tied to an SSM session:
#   systemd-run --unit ib127-write --collect /opt/insight-bot/level-backfill.sh --write --until <first level heartbeat close>
set -u
. "$(dirname "$0")/history-gate.sh" || { echo "history-gate.sh is missing next to $0"; exit 2; }
USAGE="usage: $0 --dry-run|--write --until <ISO> [--start-floor N]"
MODE="${1:-}"
[ "$MODE" = "--dry-run" ] || [ "$MODE" = "--write" ] || { echo "$USAGE"; exit 2; }
shift
CLI_ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --start-floor) gate_floor "${2:-}" || exit 2; shift 2 ;;
    *) CLI_ARGS+=("$1"); shift ;;
  esac
done
set -- ${CLI_ARGS[@]+"${CLI_ARGS[@]}"}
DIR="${RUN_DIR:-/root}"
MEMINFO="${MEMINFO:-/proc/meminfo}"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUT=$DIR/ib127${MODE#-}-$STAMP.out
MEM=$DIR/ib127${MODE#-}-$STAMP.mem
B=insight-bot-insight-bot-1
CLI=dist/alerts/levels/backfill/level-backfill.cli.js
BOTPID=$(docker inspect -f '{{.State.Pid}}' $B) || { echo "the bot container is not running"; exit 2; }

docker exec ${GATE_ENV[@]+"${GATE_ENV[@]}"} $B node --max-old-space-size=40 --max-semi-space-size=1 --optimize-for-size "$CLI" "$MODE" "$@" > "$OUT" 2>&1 &
EXEC=$!
CLIPID=""
for _ in $(seq 1 "${PID_TRIES:-20}"); do
  CLIPID=$(ps -eo pid=,args= | awk -v m="$MODE" '$2 == "node" && /level-backfill\.cli\.js/ && index($0, m) {print $1; exit}')
  [ -n "$CLIPID" ] && break
  sleep 0.5
done
echo "start $STAMP mode $MODE args $* exec $EXEC cli pid ${CLIPID:-?} bot pid $BOTPID" | tee "$MEM"
killed=""
while kill -0 $EXEC 2>/dev/null; do
  avail=$(awk '/MemAvailable/{print int($2/1024)}' "$MEMINFO")
  bot=$(awk '/VmRSS/{print int($2/1024)}' /proc/$BOTPID/status 2>/dev/null)
  cli=$( [ -n "$CLIPID" ] && awk '/VmRSS/{print int($2/1024)}' /proc/$CLIPID/status 2>/dev/null)
  echo "$(date -u +%H:%M:%S) avail=${avail} bot=${bot:-?} cli=${cli:-?}" >> "$MEM"
  if [ -n "$avail" ] && [ "$avail" -lt 100 ] && [ -n "$CLIPID" ] && [ -z "$killed" ]; then
    kill "$CLIPID" && killed="yes"
    echo "$(date -u +%H:%M:%S) MemAvailable ${avail} MB < 100 MB — killed the CLI pid $CLIPID" | tee -a "$MEM"
  fi
  sleep "${SAMPLE_S:-1}"
done
wait $EXEC; rc=$?
echo "== CLI output (exit $rc)"; cat "$OUT"
echo "== memory over $(grep -c avail= "$MEM") samples"
awk -F'[ =]' '/avail=/{a=$3; b=$5; c=$7; if (mina==""||a<mina) mina=a; if (b!="?" && b>maxb) maxb=b; if (c!="?" && c>maxc) maxc=c} END {print "min MemAvailable " mina " MB; max bot RSS " maxb " MB; max CLI RSS " maxc " MB"}' "$MEM"
[ -n "$killed" ] && echo "KILLED for memory"
gate_report "$OUT"
echo "files: $OUT $MEM"
if [ -z "$killed" ] && [ "$rc" -ne 0 ] && why=$(gate_refused "$OUT"); then
  echo "DEFERRED:memory gate refused ($why)"; exit 3
fi
