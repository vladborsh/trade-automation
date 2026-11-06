#!/bin/bash
# IB-116 — run the OI history backfill CLI on the box with a 1 s memory sampler (TL ruling, option A).
# usage (on the box, as root): box-backfill.sh --dry-run|--write [--start-floor N]
# - the CLI runs inside the bot container with the ruling's flags (109 MB peak measured on Linux);
# - every second: MemAvailable (host), the bot's RSS (its main process), the CLI's RSS → /root/ib116-<mode>-<stamp>.mem;
# - if MemAvailable < 100 MB on any sample, the CLI is killed by PID (TL: stop and tell);
# - at the end: the CLI's output and the sampled minima / maxima (the format checks.py backfill-rerun parses);
# - IB-145: --start-floor N → the CLI's start gate for this run (history-gate.sh: 140–500, default the CLI's 170),
#   passed as `docker exec -e MEM_START_FLOOR_MB=N`; the output says which gate the CLI applied. A refusal by that
#   gate is not a breakage: the last line is «DEFERRED:memory gate refused (…)» and the exit code 3 (checks.py:
#   DEFERRED, no Telegram).
set -u
. "$(dirname "$0")/history-gate.sh" || { echo "history-gate.sh is missing next to $0"; exit 2; }
USAGE="usage: $0 --dry-run|--write [--start-floor N]"
MODE="${1:-}"
[ "$MODE" = "--dry-run" ] || [ "$MODE" = "--write" ] || { echo "$USAGE"; exit 2; }
shift
while [ $# -gt 0 ]; do
  case "$1" in
    --start-floor) gate_floor "${2:-}" || exit 2; shift 2 ;;
    *) echo "$USAGE"; exit 2 ;;
  esac
done
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
DIR="${RUN_DIR:-/root}"
MEMINFO="${MEMINFO:-/proc/meminfo}"
OUT=$DIR/ib116${MODE#-}-$STAMP.out
MEM=$DIR/ib116${MODE#-}-$STAMP.mem
B=insight-bot-insight-bot-1
BOTPID=$(docker inspect -f '{{.State.Pid}}' $B) || { echo "the bot container is not running"; exit 2; }

docker exec ${GATE_ENV[@]+"${GATE_ENV[@]}"} $B node --max-old-space-size=40 --max-semi-space-size=1 --optimize-for-size \
  dist/alerts/oi-divergence/backfill/backfill.cli.js "$MODE" > "$OUT" 2>&1 &
EXEC=$!
CLIPID=""
for _ in $(seq 1 "${PID_TRIES:-20}"); do
  CLIPID=$(ps -eo pid=,args= | awk -v m="$MODE" '$2 == "node" && /backfill\.cli\.js/ && index($0, m) {print $1; exit}')
  [ -n "$CLIPID" ] && break
  sleep 0.5
done
echo "start $STAMP mode $MODE exec $EXEC cli pid ${CLIPID:-?} bot pid $BOTPID" | tee "$MEM"
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
