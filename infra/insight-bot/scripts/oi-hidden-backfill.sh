#!/bin/bash
# IB-144 (design V45, V47) — the OI hidden-divergence history run on the box, with IB-116's memory guard around it,
# as a unit that writes a sentinel (no agent waits by hand: check-wait.sh polls it).
#
#   oi-hidden-backfill.sh --dry-run|--write          (on the box, as root; run it as a systemd unit:)
#   systemd-run --unit ib144-dry-run --collect /opt/insight-bot/oi-hidden-backfill.sh --dry-run
#   systemd-run --unit ib144-write --collect /opt/insight-bot/oi-hidden-backfill.sh --write
#   (a rerun for the pairs still without a hidden-aware live control: --on-calendar '<UTC time>' on the same command)
#
# - the CLI runs inside the bot container with the IB-116 ruling's flags (heap 40, semi 1, optimize-for-size) and
#   `--kinds hidden --dump`; its own guard refuses to start below 170 MB MemAvailable and pauses below 120 MB;
# - every second: MemAvailable (host), the bot's RSS, the CLI's RSS → <out>.mem; MemAvailable < 100 MB kills the CLI;
# - --dry-run then runs V47's guard (hidden-guard.cli.js) on the dump, WITHOUT --enable: the table only;
# - files in /var/log/insight-checks/: oi-hidden-<mode>.md (the CLI's output, the guard's table, the memory minima),
#   oi-hidden-<mode>.jsonl (the dump), oi-hidden-<mode>.guard.json; LAST the sentinel oi-hidden-<mode>.done:
#   PASS (the run completed), DEFERRED:<why> (it did not start: the CLI's memory gate refused, or no memory window
#   came before WAIT_UNTIL — nothing is wrong, run it later; NO Telegram), or FAIL:<why> (it broke: the owner's
#   Telegram, checks.py's path).
#
# Env (TL ruling 2026-11-06, tl-ruling-history-runs-memory-2026-11-06.md):
#   MEM_START_FLOOR_MB=140   the CLI's start gate for THIS run (passed into the container; default 170 there)
#   WAIT_FOR_MB=<n> WAIT_UNTIL=<epoch s>   wait (every 30 s) for host MemAvailable ≥ n before starting; none by
#                                          WAIT_UNTIL → DEFERRED
set -u
MODE="${1:-}"
[ "$MODE" = "--dry-run" ] || [ "$MODE" = "--write" ] || { echo "usage: $0 --dry-run|--write"; exit 2; }
NAME="oi-hidden${MODE#-}"   # oi-hidden-dry-run | oi-hidden-write
DIR="${CHECKS_DIR:-/var/log/insight-checks}"
DEPLOY_DIR="${DEPLOY_DIR:-/opt/insight-bot}"
MEMINFO="${MEMINFO:-/proc/meminfo}"
mkdir -p "$DIR"; chmod 750 "$DIR"
rm -f "$DIR/$NAME.done"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUT="$DIR/$NAME-$STAMP.out"
MEM="$DIR/$NAME-$STAMP.mem"
MD="$DIR/$NAME.md"
B=insight-bot-insight-bot-1
CLI=dist/alerts/oi-divergence/backfill/backfill.cli.js
GUARD=dist/alerts/oi-divergence/backfill/hidden-guard.cli.js
IN_DUMP="/tmp/$NAME.jsonl"

finish() {  # $1 = verdict; the sentinel is written last, once every other file is whole
  printf '%s\n' "$1" > "$DIR/$NAME.done.tmp" && mv "$DIR/$NAME.done.tmp" "$DIR/$NAME.done"
  case "$1" in FAIL:*)
    python3 -I - "$DEPLOY_DIR" "$NAME" "$1" <<'PY' || true
import importlib.util, os, sys
spec = importlib.util.spec_from_file_location('deploy_watch', os.path.join(sys.argv[1], 'deploy-watch.py'))
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
m.send_owner('Инсайт: прогон скрытых дивергенций %s сломался: %s. Файл: /var/log/insight-checks/%s.md' % (sys.argv[2], sys.argv[3][:300], sys.argv[2]), False)
PY
  esac
  echo "$NAME → $1"
}

if [ -n "${WAIT_FOR_MB:-}" ]; then
  until [ "$(awk '/MemAvailable/{print int($2/1024)}' "$MEMINFO")" -ge "$WAIT_FOR_MB" ]; do
    if [ "$(date +%s)" -ge "${WAIT_UNTIL:-0}" ]; then
      echo "# $NAME — no MemAvailable ≥ $WAIT_FOR_MB MB window before $WAIT_UNTIL; not started" > "$MD"
      finish "DEFERRED:no MemAvailable >= $WAIT_FOR_MB MB window"; exit 3
    fi
    sleep "${WAIT_POLL_S:-30}"
  done
fi

BOTPID=$(docker inspect -f '{{.State.Pid}}' $B) || { finish "FAIL:the bot container is not running"; exit 2; }
SHA=$(docker inspect -f '{{.Config.Image}}' $B)
GATE_ENV=(); [ -n "${MEM_START_FLOOR_MB:-}" ] && GATE_ENV=(-e "MEM_START_FLOOR_MB=$MEM_START_FLOOR_MB")

docker exec ${GATE_ENV[@]+"${GATE_ENV[@]}"} $B node --max-old-space-size=40 --max-semi-space-size=1 --optimize-for-size "$CLI" "$MODE" --kinds hidden --dump "$IN_DUMP" > "$OUT" 2>&1 &
EXEC=$!
CLIPID=""
for _ in $(seq 1 "${PID_TRIES:-20}"); do
  CLIPID=$(ps -eo pid=,args= | awk -v m="$MODE" '$2 == "node" && /backfill\.cli\.js/ && /--kinds hidden/ && index($0, m) {print $1; exit}')
  [ -n "$CLIPID" ] && break
  sleep 0.5
done
echo "start $STAMP image $SHA mode $MODE exec $EXEC cli pid ${CLIPID:-?} bot pid $BOTPID" | tee "$MEM"
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
docker cp "$B:$IN_DUMP" "$DIR/$NAME.jsonl" >/dev/null 2>&1 || true
{
  echo "# $NAME — $STAMP, image $SHA"
  echo
  echo "## CLI output (exit $rc)"
  echo '```'; cat "$OUT"; echo '```'
  echo
  echo "## Memory over $(grep -c avail= "$MEM") samples"
  awk -F'[ =]' '/avail=/{a=$3; b=$5; c=$7; if (mina==""||a<mina) mina=a; if (b!="?" && b>maxb) maxb=b; if (c!="?" && c>maxc) maxc=c} END {print "min MemAvailable " mina " MB; max bot RSS " maxb " MB; max CLI RSS " maxc " MB"}' "$MEM"
  [ -n "$killed" ] && echo "KILLED for memory"
} > "$MD"
if [ -n "$killed" ]; then finish "FAIL:killed for memory (MemAvailable < 100 MB)"; exit 1; fi
if [ "$rc" -ne 0 ] && grep -q '^oi backfill failed: Error: memory gate: refused' "$OUT"; then
  # the CLI's start gate: nothing started, nothing is broken — a deferral, never the owner's Telegram (TL 2026-11-06)
  finish "DEFERRED:memory gate refused ($(grep -o 'MemAvailable [0-9]* MB < [0-9]* MB' "$OUT" | head -1))"; exit 3
fi
if [ "$rc" -ne 0 ]; then finish "FAIL:CLI exit $rc"; exit 1; fi
if [ "$MODE" = "--dry-run" ]; then
  # V47 step 3: the guard's table on the dry run's dump — NOT --enable (the TL decides the enable)
  {
    echo
    echo "## V47 guard (no --enable: nothing changed)"
    docker exec $B node "$GUARD" --dump "$IN_DUMP" --json "/tmp/$NAME.guard.json" 2>&1; echo "(guard exit $?)"
  } >> "$MD"
  docker cp "$B:/tmp/$NAME.guard.json" "$DIR/$NAME.guard.json" >/dev/null 2>&1 || true
  grep -q '^(guard exit 0)$' "$MD" || { finish "FAIL:the guard did not run (see $MD)"; exit 1; }
fi
finish PASS
