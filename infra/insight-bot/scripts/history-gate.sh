# IB-145 — the history CLIs' START gate, shared by the box's three history runners (sourced, not run):
# box-backfill.sh (IB-116 OI), liq-backfill.sh (IB-123 liquidations), oi-hidden-backfill.sh (IB-144 OI hidden).
#
# The CLI (memory-guard.ts) refuses to START a phase below its start gate, measured after the CLI has loaded:
# 170 MB by default, per run through env MEM_START_FLOOR_MB (images from 95366a24 on; older ones ignore it).
# The pause (120 MB), the 5-min abort and the runner's 100 MB kill are NOT set here and never change.
#
#   gate_floor <N>        validate a --start-floor value; on success GATE_ENV=(-e MEM_START_FLOOR_MB=<N>) for
#                         `docker exec`, and GATE_ASK=<N>. Exit 2 + a message on a bad value.
#   gate_refused <file>   0 when the CLI's output says its start gate refused (nothing started); prints
#                         «MemAvailable X MB < Y MB». A crash, the 5-min abort or a bad env value is NOT a refusal.
#   gate_report <file>    one line: «== start gate: asked <N|default>, the CLI applied <…>» — what the CLI's own
#                         lines say it used: «140», «140 170», «old image» (a line without the floor: pre-95366a24),
#                         or «none (no gate reached)». checks.py and the .md read it: asked ≠ applied means the
#                         image did not honour the floor (not deployed).

# Never below 140 MB without a TL ruling (TL ruling 2026-11-06; RUNBOOK §9b). Lowering this constant IS that
# ruling: it goes through a reviewed commit, not a flag. 500 catches a typo (1400) that would refuse every run.
GATE_MIN_MB=140
GATE_MAX_MB=500
GATE_ENV=()
GATE_ASK=""

gate_floor() {
  local n="${1:-}"
  case "$n" in
    '' | *[!0-9]*) echo "--start-floor '$n': a whole number of MB" >&2; return 2 ;;
  esac
  if [ "$n" -lt "$GATE_MIN_MB" ] || [ "$n" -gt "$GATE_MAX_MB" ]; then
    echo "--start-floor $n: allowed ${GATE_MIN_MB}–${GATE_MAX_MB} MB (below ${GATE_MIN_MB} only by a TL ruling, as a commit to history-gate.sh)" >&2
    return 2
  fi
  GATE_ENV=(-e "MEM_START_FLOOR_MB=$n")
  GATE_ASK="$n"
}

gate_refused() {
  # new image: «… failed: Error: memory gate: refused — MemAvailable 139 MB < 140 MB — not starting …»
  # old image: «… failed: Error: memory gate: MemAvailable 139 MB < 170 MB — not starting …»
  grep -qE '^(oi|liq) backfill failed: Error: memory gate: (refused — )?MemAvailable [0-9]+ MB < [0-9]+ MB' "$1" || return 1
  grep -oE 'MemAvailable [0-9]+ MB < [0-9]+ MB' "$1" | sed -n 1p
}

gate_report() {
  local used
  used=$(awk '/memory gate: / {
      if (match($0, /start gate [0-9]+ MB/)) s = substr($0, RSTART + 11, RLENGTH - 14)
      else if (match($0, /MB < [0-9]+ MB/)) s = substr($0, RSTART + 5, RLENGTH - 8)
      else s = "old image"
      if (!(s in seen)) { seen[s] = 1; out = out (out == "" ? "" : " ") s }
    } END { print out }' "$1")
  echo "== start gate: asked ${GATE_ASK:-default}, the CLI applied ${used:-none (no gate reached)}"
}
