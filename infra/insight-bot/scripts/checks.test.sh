#!/usr/bin/env bash
# Offline check of checks.py (IB-140): fake gathered inputs (CHECKS_FAKE_INPUT) stand in for the box and a
# stub `curl` for Telegram. Runs anywhere with python3 >= 3.9; no Docker, no systemd, no network.
#
#   bash infra/insight-bot/scripts/checks.test.sh
#
# Each check: PASS on a healthy input; FLAG exactly past a band edge and not on it; FAIL when the check
# breaks (an input missing, run before its window closed). FAIL — and only FAIL — sends one Telegram
# message; the token is on curl's stdin only, never in argv, stdout, stderr or the files. The sentinel
# holds the verdict and is written last.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
CHECKS="$HERE/checks.py"
work="$(mktemp -d)"
trap '[ -n "${KEEP:-}" ] || rm -rf "$work"' EXIT; [ -n "${KEEP:-}" ] && echo "work dir: $work"
fail=0
check() { if eval "$2"; then echo "ok   - $1"; else echo "FAIL - $1"; fail=1; fi; }

TOKEN='987654:FAKE-checks_token-never-printed'
mkdir -p "$work/bin"
cat >"$work/bin/curl" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$STUB_CURL_ARGS"
cat >>"$STUB_CURL_STDIN"
echo '{"ok":true,"result":{}}'
STUB
chmod +x "$work/bin/curl"
printf "POSTGRES_PASSWORD='x'\nTELEGRAM_BOT_TOKEN='%s'\nTELEGRAM_SERVICE_CHAT_ID='-1001'\n" "$TOKEN" >"$work/env"

# v28 input: a healthy live day (the shape v28_gather returns), then the case's edits (python statements on `d`).
v28_input() { # $1 = case, $2 = python edits
  python3 -I - "$work/$1.json" "$2" <<'PY'
import json, sys
path, edits = sys.argv[1], sys.argv[2]
d = {'from': '2026-11-04T21:41:43Z', 'to': '2026-11-05T21:41:43Z', 'now': '2026-11-05T21:45:01Z',
     'controls': [['live', 'pivot', '15m', '75'], ['live', 'pivot', '1h', '19'], ['live', 'pivot', '4h', '5'],
                  ['live', 'random', '15m', '10'], ['live', 'random', '1h', '10'], ['live', 'random', '4h', '10'],
                  ['backfill', 'pivot', '15m', '1448']],
     'near': [['live', 'k', '15m', '4', '2.1'], ['live', 'price_line', '1h', '1', '0.1'], ['backfill', 'k', '15m', '88', '2.2']],
     'alerts': [['live', '1', '0', '1']],
     # source, win, rows, measured, failing, overdue, measured_in_window, ambiguous, entry≠t0, min(measured_at)
     'paths': [['live', '4h', '130', '115', '0', '0', '115', '0', '0', '1793843000'],
               ['live', '24h', '130', '0', '0', '0', '0', '0', '0', ''],
               ['live', '72h', '130', '0', '0', '0', '0', '0', '0', ''],
               ['backfill', '24h', '2566', '2508', '0', '49', '7384', '0', '0', '1793843000']],
     'sizes': [['oi_divergence_paths', '1200000', '8000']],
     'builds': [['4e405719ea49', '1793828503'], ['d8a0cdc19b6d', '1793835367']],
     'sar': [{'t': 1793829000 + 600 * i, 'avail': 240 - i % 7, 'swap': 80 + i % 5} for i in range(140)],
     'weight_now': 1.0}
exec(edits)
with open(path, 'w') as f:
    json.dump(d, f)
PY
}

run() { # $1 = check, $2 = case → exit code in $work/<case>.rc; outputs in $work/out-<case>
  local out="$work/out-$2"
  : >"$work/curl-args"; : >"$work/curl-stdin"
  set +e
  PATH="$work/bin:$PATH" CHECKS_DIR="$out" CHECKS_FAKE_INPUT="$work/$2.json" WATCH_ENV_FILE="$work/env" \
    STUB_CURL_ARGS="$work/curl-args" STUB_CURL_STDIN="$work/curl-stdin" \
    python3 -I "$CHECKS" run "$1" >"$work/$2.stdout" 2>"$work/$2.stderr"
  echo $? >"$work/$2.rc"
  set -e
}
verdict() { cat "$work/out-$1/$2.done"; }
sent() { grep -c sendMessage "$work/curl-stdin" || true; }

# ------------------------------------------------------------------------------------------------ v28
v28_input pass ''
run v28 pass
check 'v28 healthy day → PASS, exit 0' '[ "$(verdict pass v28)" = PASS ] && [ "$(cat $work/pass.rc)" = 0 ]'
check 'v28 PASS sends nothing' '[ "$(sent)" = 0 ]'
check 'v28 writes json, md and the sentinel' '[ -s $work/out-pass/v28.json ] && [ -s $work/out-pass/v28.md ] && [ -s $work/out-pass/v28.done ]'
check 'v28 backfill rows are left out of the bands (pivot 99 live, not 1547)' \
  'python3 -c "import json;d=json.load(open(\"$work/out-pass/v28.json\"));r={x[\"figure\"]:x[\"value\"] for x in d[\"result\"][\"rows\"]};assert r[\"pivot_controls\"]==99,r"'
check 'v28 day-1 path weight band is the 4h share (115/day ≈ 0.08/min inside 0.04–0.159)' \
  'grep -q "| path_weight_per_min | 0.08 | 0.04–0.159 | ok |" $work/out-pass/v28.md'

v28_input pivot200 "d['controls'][0][3] = '176'"   # 176+19+5 = 200: on the edge
run v28 pivot200
check 'v28 pivot controls exactly 200 (2× V28) → still PASS' '[ "$(verdict pivot200 v28)" = PASS ]'
v28_input pivot201 "d['controls'][0][3] = '177'"
run v28 pivot201
check 'v28 pivot controls 201 → FLAG:pivot_controls, nothing sent' '[ "$(verdict pivot201 v28)" = FLAG:pivot_controls ] && [ "$(sent)" = 0 ] && [ "$(cat $work/pivot201.rc)" = 0 ]'
v28_input pivot49 "d['controls'][0][3] = '25'"
run v28 pivot49
check 'v28 pivot controls 49 (below half) → FLAG' '[ "$(verdict pivot49 v28)" = FLAG:pivot_controls ]'

v28_input near0 "d['near'] = [x for x in d['near'] if x[0] != 'live']"
run v28 near0
check 'v28 0 near-misses → FLAG and a note that 0 needs explaining' \
  '[ "$(verdict near0 v28)" = FLAG:near_misses ] && grep -q "0 near-misses needs explaining" $work/out-near0/v28.md'
v28_input rnd33 "d['controls'][3][3] = '13'"
run v28 rnd33
check 'v28 random controls 33 → FLAG; 31 → PASS with the midnight note' '[ "$(verdict rnd33 v28)" = FLAG:random_controls ]'
v28_input rnd31 "d['controls'][3][3] = '11'"
run v28 rnd31
check 'v28 random 31 → PASS, the note names the UTC-date hashing' '[ "$(verdict rnd31 v28)" = PASS ] && grep -q "hashed by UTC date" $work/out-rnd31/v28.md'
v28_input mem "d['sar'][50]['avail'] = 99; d['sar'][60]['swap'] = 501; d['paths'][0][5] = '2'"
run v28 mem
check 'v28 memory < 100 MB, swap > 500 MB, overdue paths → each FLAGged' \
  '[ "$(verdict mem v28)" = FLAG:paths_overdue,mem_available_min_mb,swap_used_max_mb ]'
v28_input bytes "d['sizes'][0][1] = str(301 * 8000)"
run v28 bytes
check 'v28 301 B/row → FLAG:path_bytes_per_row' '[ "$(verdict bytes v28)" = FLAG:path_bytes_per_row ]'

v28_input early "d['now'] = '2026-11-05T21:40:00Z'"
run v28 early
check 'v28 run before the window closes → FAIL, exit 1, one Telegram message' \
  '[ "$(verdict early v28 | cut -c1-5)" = FAIL: ] && [ "$(cat $work/early.rc)" = 1 ] && [ "$(sent)" = 1 ]'
check 'v28 FAIL message names the check and the file' 'grep -q "v28" $work/curl-args'
v28_input broken "del d['paths']"
run v28 broken
check 'v28 a missing input (a bug or a failed query) → FAIL, not a crash without files' \
  '[ "$(verdict broken v28)" = "FAIL:KeyError: '"'"'paths'"'"'" ] && [ -s $work/out-broken/v28.md ]'

# ------------------------------------------------------------------------------------- the token, usage
check 'the token is on curl stdin (sent at all)' 'grep -q "$TOKEN" $work/curl-stdin'
check 'the token is never in argv, stdout, stderr or any file' \
  '! grep -rq "$TOKEN" $work/curl-args $work/*.stdout $work/*.stderr $work/out-*'
check 'usage error → exit 2' '[ "$(python3 -I "$CHECKS" run nope 2>/dev/null; echo $?)" = 2 ]'

if [ "$fail" = 0 ]; then echo "checks.test.sh: all passed"; else echo "checks.test.sh: FAILURES"; exit 1; fi
