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
     # IB-BUG-047: live random per (symbol, tf, UTC day of the bar); the window straddles 11-04 and 11-05
     'random_days': [[s, tf, day, '1'] for s in ('BNBUSDT', 'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'TRXUSDT')
                     for tf in ('15m', '1h', '4h') for day in ('2026-11-04', '2026-11-05')],
     'near': [['live', 'k', '15m', '4', '2.1'], ['live', 'price_line', '1h', '1', '0.1'], ['backfill', 'k', '15m', '88', '2.2']],
     'alerts': [['live', '1', '0', '1']],
     # source, win, rows, measured, failing, overdue, measured_in_window, ambiguous, entry≠t0, min(measured_at)
     'paths': [['live', '4h', '130', '115', '0', '0', '115', '0', '0', '1793843000'],
               ['live', '24h', '130', '0', '0', '0', '0', '0', '0', ''],
               ['live', '72h', '130', '0', '0', '0', '0', '0', '0', ''],
               ['backfill', '24h', '2566', '2508', '0', '49', '7384', '0', '0', '1793843000']],
     'sizes': [['oi_divergence_paths', '1200000', '8000', '1000000']],  # 150 B/row total, 125 heap
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
# IB-BUG-047: the window's random total is not a band (it straddles two UTC days); >2 per (coin, TF, day) is
v28_input rnd39 "d['random_days'] = [[s, tf, day, '2'] for s in ('BNBUSDT', 'BTCUSDT', 'ETHUSDT') for tf in ('15m', '1h', '4h') for day in ('2026-11-04', '2026-11-05')] + [['SOLUSDT', '4h', '2026-11-04', '1'], ['TRXUSDT', '4h', '2026-11-04', '1'], ['SOLUSDT', '1h', '2026-11-05', '1']]"
run v28 rnd39
check 'v28 39 random in the window, none above 2 a UTC day (the 2026-11-05 shape) → PASS, the total a note' \
  '[ "$(verdict rnd39 v28)" = PASS ] && grep -q "random controls in the window: 39" $work/out-rnd39/v28.md && grep -q "| random_over_2_per_utc_day | 0 | 0–0 | ok |" $work/out-rnd39/v28.md'
v28_input rnd-redraw "d['random_days'][4][3] = '3'"
run v28 rnd-redraw
check 'v28 a (coin, TF, UTC day) with 3 — the re-draw signature → FLAG, the pair and day named' \
  '[ "$(verdict rnd-redraw v28)" = FLAG:random_over_2_per_utc_day ] && grep -q "BNBUSDT 4h on 2026-11-04 has 3" $work/out-rnd-redraw/v28.md'
v28_input mem "d['sar'][50]['avail'] = 99; d['sar'][60]['swap'] = 501; d['paths'][0][5] = '2'"
run v28 mem
check 'v28 memory < 100 MB, swap > 500 MB, overdue paths → each FLAGged' \
  '[ "$(verdict mem v28)" = FLAG:paths_overdue,mem_available_min_mb,swap_used_max_mb ]'
v28_input bytes "d['sizes'][0][1] = str(346 * 8000)"
run v28 bytes
check 'v28 all-in 346 B/row (band 86–345), heap 125 → FLAG names the all-in figure only' '[ "$(verdict bytes v28)" = FLAG:path_bytes_per_row ] && grep -q "recheck at ≈ 50 k rows" $work/out-bytes/v28.md'

v28_input heap "d['sizes'][0][1] = str(345 * 8000); d['sizes'][0][3] = str(301 * 8000)"
run v28 heap
check 'v28 heap 301 B/row (band 75–300), all-in 345 → FLAG names the heap figure only' '[ "$(verdict heap v28)" = FLAG:path_heap_bytes_per_row ]'
check 'v28 the md shows the path-weight formula' 'grep -q "E = (1 100/8 subjects/day)" $work/out-pass/v28.md'

v28_input early "d['now'] = '2026-11-05T21:40:00Z'"
run v28 early
check 'v28 run before the window closes → FAIL, exit 1, one Telegram message' \
  '[ "$(verdict early v28 | cut -c1-5)" = FAIL: ] && [ "$(cat $work/early.rc)" = 1 ] && [ "$(sent)" = 1 ]'
check 'v28 FAIL message names the check and the file' 'grep -q "v28" $work/curl-args'
v28_input broken "del d['paths']"
run v28 broken
check 'v28 a missing input (a bug or a failed query) → FAIL, not a crash without files' \
  '[ "$(verdict broken v28)" = "FAIL:KeyError: '"'"'paths'"'"'" ] && [ -s $work/out-broken/v28.md ]'

# --------------------------------------------------------------------------------------------- cap-24h
fixture() { # $1 = case, $2 = python building `d` (json-dumped to $work/<case>.json)
  python3 -I - "$work/$1.json" "$2" <<'PY'
import json, sys
path, code = sys.argv[1], sys.argv[2]
ns = {}
exec(code, ns)
with open(path, 'w') as f:
    json.dump(ns['d'], f)
PY
}
CAP='
NOW = 1793929500  # 2026-11-06T13:45:00Z
FROM = NOW - 86400
def iso(t):
    import time; return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t))
rows = [[str(FROM + 300 + 600 * i), "t"] for i in range(144)]
def mk(rows, first_btc=FROM - 1000):
    return {"now": iso(NOW), "from": iso(FROM), "rows": rows,
            "size": [["49152", str(len(rows) + 20), str(FROM - 9000), rows[-1][0], str(len(rows)), str(first_btc)]]}
'
fixture cap-pass "$CAP
d = mk(rows)"
run cap-24h cap-pass
check 'cap-24h 144 rows, no gap, shares on every row → PASS, nothing sent' '[ "$(verdict cap-pass cap-24h)" = PASS ] && [ "$(sent)" = 0 ]'
check 'cap-24h notes the table size and rows' 'grep -q "table: 49152 B, 164 rows" $work/out-cap-pass/cap-24h.md'
fixture cap-72 "$CAP
d = mk([[str(FROM + 600 + 1200 * i), 't'] for i in range(72)])"
run cap-24h cap-72
check 'cap-24h 72 rows, 20-min spacing (half of 144, on the edge) → PASS' '[ "$(verdict cap-72 cap-24h)" = PASS ]'
fixture cap-gap "$CAP
d = mk(rows[:50] + rows[53:])"
run cap-24h cap-gap
check 'cap-24h 40 min without a row → FLAG:gaps_over_30_min, the gap named' \
  '[ "$(verdict cap-gap cap-24h)" = FLAG:gaps_over_30_min ] && grep -q "(40 min)" $work/out-cap-gap/cap-24h.md'
fixture cap-30 "$CAP
d = mk(rows[:50] + rows[52:])"
run cap-24h cap-30
check 'cap-24h exactly 30 min without a row → PASS (the band is «over 30»)' '[ "$(verdict cap-30 cap-24h)" = PASS ]'
fixture cap-null "$CAP
rows[100][1] = 'f'
d = mk(rows)"
run cap-24h cap-null
check 'cap-24h a null btc_pct after the first share row → FLAG:btc_pct_null_after_030' '[ "$(verdict cap-null cap-24h)" = FLAG:btc_pct_null_after_030 ]'
fixture cap-pre030 "$CAP
rows[0][1] = 'f'
d = mk(rows, first_btc=int(rows[1][0]))"
run cap-24h cap-pre030
check 'cap-24h nulls BEFORE the first share row (pre-030) are not flagged' '[ "$(verdict cap-pre030 cap-24h)" = PASS ]'
fixture cap-broken "d = {'now': '2026-11-06T13:45:00Z', 'from': '2026-11-05T13:45:00Z', 'rows': []}"
run cap-24h cap-broken
check 'cap-24h a missing size query → FAIL, one message' '[ "$(verdict cap-broken cap-24h | cut -c1-5)" = FAIL: ] && [ "$(sent)" = 1 ]'

# ------------------------------------------------------------------------------------ first-live-alert
ALERT='
d = {"now": "2026-11-05T16:15:00Z", "eligible": [["1"]], "link": "https://x/instrument/BTCUSDT?at=1793893500&tf=15m", "link_code": 200,
     "alert": [["7", "BTCUSDT", "15m", "bear", "1793893500", "1793894400", "1793894802", "1", "f", "caa595788ec0"]]}
'
fixture fla-pending 'd = {"now": "2026-11-05T15:00:00Z", "alert": [], "eligible": [["1"]], "link_code": None}'
run first-live-alert fla-pending
check 'first-live-alert none yet → PENDING: files, NO sentinel, nothing sent, exit 0' \
  '[ ! -e $work/out-fla-pending/first-live-alert.done ] && grep -q "\"verdict\": \"PENDING\"" $work/out-fla-pending/first-live-alert.json && [ "$(sent)" = 0 ] && [ "$(cat $work/fla-pending.rc)" = 0 ]'
fixture fla-pass "$ALERT"
run first-live-alert fla-pass
check 'first-live-alert found → PASS with the facts; the owner is NOT told' \
  '[ "$(verdict fla-pass first-live-alert)" = PASS ] && [ "$(sent)" = 0 ] && grep -q "\"fire_after_confirm_s\": 402" $work/out-fla-pass/first-live-alert.json && grep -q "\"recipients\": 1" $work/out-fla-pass/first-live-alert.json'
fixture fla-over "$ALERT
d['alert'][0][7] = '2'"
run first-live-alert fla-over
check 'first-live-alert sent to more than are eligible → FLAG:recipients_le_eligible (not sent to the owner)' \
  '[ "$(verdict fla-over first-live-alert)" = FLAG:recipients_le_eligible ] && [ "$(sent)" = 0 ]'
fixture fla-link "$ALERT
d['link_code'] = 502"
run first-live-alert fla-link
check 'first-live-alert link answering 502 → FLAG:link_http' '[ "$(verdict fla-link first-live-alert)" = FLAG:link_http ]'

# ------------------------------------------------------------------------------------ first-live-liq (IB-143)
LIQMSG='
d = {"now": "2026-11-06T02:00:00Z", "eligible": [["1"]], "link": "https://x/instrument/BTCUSDT?at=1793921000&tf=5m", "link_code": 200,
     "msg": [["130", "event", "BTCUSDT", "1793921180", "1793921187", "1", "f", "da9ed8899f2f", "BTCUSDT", "1793921000123", "2", "12500000"]]}
'
fixture fll-pending 'd = {"now": "2026-11-06T01:00:00Z", "msg": [], "eligible": [["1"]], "link_code": None}'
run first-live-liq fll-pending
check 'first-live-liq none yet → PENDING: no sentinel, nothing sent, exit 0' \
  '[ ! -e $work/out-fll-pending/first-live-liq.done ] && grep -q "\"verdict\": \"PENDING\"" $work/out-fll-pending/first-live-liq.json && [ "$(sent)" = 0 ] && [ "$(cat $work/fll-pending.rc)" = 0 ]'
fixture fll-pass "$LIQMSG"
run first-live-liq fll-pass
check 'first-live-liq the owner only, 7 s after S, link 200 → PASS with the facts; the owner is NOT told' \
  '[ "$(verdict fll-pass first-live-liq)" = PASS ] && [ "$(sent)" = 0 ] && grep -q "\"fired_after_moment_s\": 7" $work/out-fll-pass/first-live-liq.json && grep -q "\"coins\": 2" $work/out-fll-pass/first-live-liq.json'
fixture fll-two "$LIQMSG
d['msg'][0][5] = '2'; d['eligible'] = [['2']]"
run first-live-liq fll-two
check 'first-live-liq sent to 2 (not owner-only) → FLAG:recipients,liq_alerts_users' '[ "$(verdict fll-two first-live-liq)" = FLAG:recipients,liq_alerts_users ]'
fixture fll-slow "$LIQMSG
d['msg'][0][4] = '1793921250'; d['link_code'] = 502"
run first-live-liq fll-slow
check 'first-live-liq 70 s after S and a 502 link → FLAG:fired_after_moment_s,link_http' '[ "$(verdict fll-slow first-live-liq)" = FLAG:fired_after_moment_s,link_http ]'

# ------------------------------------------------------------------------------------ oi-4h-first-eval
# IB-141 batch 3: the lines are the bot's own shape, as pinned by apps/insight-bot/test/delivery/oi-alerts-log-line.spec.ts.
OI4H='
d = {"now": "2026-11-06T00:20:00Z", "boot": "2026-11-05T22:40:00Z", "settings": [["6", "2", None]],
     "lines": ["oi alerts 4h @2026-11-05T20:00:00.000Z: 5 coins, 0 found (late 0), sent 0, skipped 0, controls 0, near-misses 0",
               "oi alerts 4h @2026-11-06T00:00:00.000Z: 5 coins, 1 found (late 0), sent 1, skipped 0, controls 2, near-misses 1"],
     "warns": [],
     "rows": [["alert", "401", "6", "2", None], ["control", "9001", "6", "2", None], ["near_miss", "77", "6", "2", None]]}
'
fixture o4-pass "$OI4H"
run oi-4h-first-eval o4-pass
check 'oi-4h-first-eval two clean 4h evaluations, every row 6/2 → PASS, nothing sent' \
  '[ "$(verdict o4-pass oi-4h-first-eval)" = PASS ] && [ "$(sent)" = 0 ] && grep -q "\"close\": \"2026-11-06T00:00:00.000Z\"" $work/out-o4-pass/oi-4h-first-eval.json'
fixture o4-norows "$OI4H
d['rows'] = []"
run oi-4h-first-eval o4-norows
check 'oi-4h-first-eval no 4h row journalled → PASS with a note (a quiet evaluation writes nothing)' \
  '[ "$(verdict o4-norows oi-4h-first-eval)" = PASS ] && grep -q "no 4h row journalled since boot" $work/out-o4-norows/oi-4h-first-eval.md'
fixture o4-oldrow "$OI4H
d['rows'].append(['control', '9002', '6', '6', None])"
run oi-4h-first-eval o4-oldrow
check 'oi-4h-first-eval one row still 6/6 → FLAG:rows_4h_not_6_2, named in the notes' \
  '[ "$(verdict o4-oldrow oi-4h-first-eval)" = FLAG:rows_4h_not_6_2 ] && grep -q "control #9002 nLeft=6 nRight=6" $work/out-o4-oldrow/oi-4h-first-eval.md'
fixture o4-legacy "$OI4H
d['rows'].append(['alert', '402', None, None, '6'])"
run oi-4h-first-eval o4-legacy
check 'oi-4h-first-eval a row in the old n shape (pre-032 code still running) → FLAG:rows_4h_not_6_2' \
  '[ "$(verdict o4-legacy oi-4h-first-eval)" = FLAG:rows_4h_not_6_2 ]'
fixture o4-settings "$OI4H
d['settings'] = [['6', '6', None]]"
run oi-4h-first-eval o4-settings
check 'oi-4h-first-eval alert_settings 4h 6/6 (an owner value, or 032 not applied) → FLAG:settings_4h_6_2' \
  '[ "$(verdict o4-settings oi-4h-first-eval)" = FLAG:settings_4h_6_2 ]'
fixture o4-nolines "$OI4H
d['lines'] = []"
run oi-4h-first-eval o4-nolines
check 'oi-4h-first-eval no 4h evaluation line since boot → FLAG:eval_lines_4h' \
  '[ "$(verdict o4-nolines oi-4h-first-eval)" = FLAG:eval_lines_4h ]'
fixture o4-failed "$OI4H
d['lines'][1] += ', failed TRXUSDT'
d['warns'] = ['oi alerts TRXUSDT 4h: boom']"
run oi-4h-first-eval o4-failed
check 'oi-4h-first-eval a failed coin and its warning → FLAG:evals_with_failed_coins,coin_warnings_4h, the warning quoted' \
  '[ "$(verdict o4-failed oi-4h-first-eval)" = FLAG:evals_with_failed_coins,coin_warnings_4h ] && grep -q "warning: oi alerts TRXUSDT 4h: boom" $work/out-o4-failed/oi-4h-first-eval.md && [ "$(sent)" = 0 ]'
fixture o4-broken 'd = {"now": "2026-11-06T00:20:00Z", "boot": "x", "lines": [], "warns": [], "rows": []}'
run oi-4h-first-eval o4-broken
check 'oi-4h-first-eval an input missing → FAIL, one message' '[ "$(verdict o4-broken oi-4h-first-eval | cut -c1-5)" = FAIL: ] && [ "$(sent)" = 1 ]'
check 'oi-4h-first-eval matches the line the bot spec pins (oi-alerts-log-line.spec.ts), quiet and busy' "python3 -I - '$CHECKS' '$HERE/../../../apps/insight-bot/test/delivery/oi-alerts-log-line.spec.ts' <<'PY'
import importlib.util, re, sys
spec = importlib.util.spec_from_file_location('c', sys.argv[1]); c = importlib.util.module_from_spec(spec); spec.loader.exec_module(c)
pinned = re.findall(r\"'(oi alerts (?:15m|1h|4h) @[^']+)'\", open(sys.argv[2], encoding='utf-8').read())
assert len(pinned) == 2, pinned
for line in pinned:
    m = re.search(c.OI_4H_LINE, line.replace(' 15m @', ' 4h @').replace(' 1h @', ' 4h @'))
    assert m and m.group(6) is not None, line
assert re.search(c.OI_4H_LINE, pinned[1].replace(' 1h @', ' 4h @')).group(8) == 'TRXUSDT'
PY"

# -------------------------------------------------------------------------------------- backfill-rerun
BF='
counts = [["alerts", "54"], ["controls", "2424"], ["near_misses", "88"], ["paths", "7698"], ["paths_open", "314"]]
after = [["alerts", "54"], ["controls", "2424"], ["near_misses", "88"], ["paths", "7698"], ["paths_open", "0"]]
out = ("start 20261107T220500Z mode --write\n== CLI output (exit 0)\n"
       "paths: measured 314, failed 0, weight 790, 1500 s; left 0 (the last window closes -)\n"
       "== memory over 1500 samples\nmin MemAvailable 150 MB; max bot RSS 120 MB; max CLI RSS 90 MB\nfiles: /root/x.out /root/x.mem\n")
d = {"started": "2026-11-07T22:05:00Z", "before": counts, "after": after, "rc": 0, "output": out}
'
fixture bf-pass "$BF"
run backfill-rerun bf-pass
check 'backfill-rerun 0 new rows, 314 measured, 0 failed, 0 left, 790 weight, 150 MB → PASS' '[ "$(verdict bf-pass backfill-rerun)" = PASS ] && [ "$(sent)" = 0 ]'
fixture bf-new "$BF
d['after'][1][1] = '2427'"
run backfill-rerun bf-new
check 'backfill-rerun 3 new controls (once-keys broken) → FLAG:new_rows' '[ "$(verdict bf-new backfill-rerun)" = FLAG:new_rows ]'
fixture bf-many "$BF
d['output'] = out.replace('measured 314', 'measured 629')"
run backfill-rerun bf-many
check 'backfill-rerun 629 measured (> 2× of 314) → FLAG; 628 → PASS' '[ "$(verdict bf-many backfill-rerun)" = FLAG:paths_measured ]'
fixture bf-628 "$BF
d['output'] = out.replace('measured 314', 'measured 628')"
run backfill-rerun bf-628
check 'backfill-rerun 628 measured → PASS' '[ "$(verdict bf-628 backfill-rerun)" = PASS ]'
fixture bf-open "$BF
d['after'][4][1] = '2'"
run backfill-rerun bf-open
check 'backfill-rerun 2 windows still open → FLAG:paths_left_open' '[ "$(verdict bf-open backfill-rerun)" = FLAG:paths_left_open ]'
fixture bf-killed "$BF
d['output'] = out + 'KILLED for memory\n'"
run backfill-rerun bf-killed
check 'backfill-rerun killed for memory → FAIL, the owner told once' '[ "$(verdict bf-killed backfill-rerun | cut -c1-5)" = FAIL: ] && [ "$(sent)" = 1 ] && grep -q "100 MB" $work/out-bf-killed/backfill-rerun.md'
fixture bf-exit "$BF
d['output'] = out.replace('(exit 0)', '(exit 1)')"
run backfill-rerun bf-exit
check 'backfill-rerun CLI exit 1 → FAIL' '[ "$(verdict bf-exit backfill-rerun)" = "FAIL:box-backfill.sh exit 0, CLI exit 1" ]'

# ------------------------------------------------------------------------------------------ liq-weekly
LIQ='
import json
row = lambda sym, k, thr, n, cont: {"symbol": sym, "multiplier": k, "thresholdUsd": thr, "alerts": n, "longs": n - n // 3, "shorts": n // 3,
                                     "continuations": cont, "withGap": 0, "notCollected": 0, "perWeek": n, "continuationsPerWeek": cont}
table = [row(s, k, t * k, n, c) for k, scale in ((0.5, 2), (1, 1), (2, 0.5)) for s, t, n, c in
         (("BTCUSDT", 5e6, int(28 * scale), 24), ("ETHUSDT", 3e6, int(29 * scale), 25), ("TRXUSDT", 3e5, 0, 0))]
summary = {"mode": "write", "from": "2026-11-04T00:00:00.000Z", "until": "2026-11-05T16:59:34.379Z", "countsTo": "2026-11-11T00:00:00.000Z",
           "days": 7, "written": {"alerts": 25}, "table": table}
out = ("start 20261111T003000Z mode --write\n== CLI output (exit 0)\n"
       "write ×1: 4851 ticks over (…]; new rows: alerts 0, continuations 0, controls 0; 24739 reads, at most 2074 prints held\n"
       "paths: measured 120, failed 0, weight 600, 180 s; left 0\n"
       "LIQ_HISTORY_JSON " + json.dumps(summary) + "\n"
       "== memory over 900 samples\nmin MemAvailable 140 MB; max bot RSS 120 MB; max CLI RSS 100 MB\nfiles: /root/x.out /root/x.mem\n")
d = {"started": "2026-11-11T00:30:00Z", "counts_to": "2026-11-11T00:00:00Z", "rc": 0, "output": out}
'
fixture liq-pass "$LIQ"
run liq-weekly liq-pass
check 'liq-weekly a clean week → PASS, nothing sent, the weekly table in the .md' \
  '[ "$(verdict liq-pass liq-weekly)" = PASS ] && [ "$(sent)" = 0 ] && grep -q "| BTCUSDT | \$2,500,000 | 56 | \$5,000,000 | 28 (19/9) | 24 | \$10,000,000 | 14 |" $work/out-liq-pass/liq-weekly.md'
fixture liq-new "$LIQ
d['output'] = out.replace('controls 0;', 'controls 2;')"
run liq-weekly liq-new
check 'liq-weekly a rerun that wrote rows (once-keys broken) → FLAG:new_rows' '[ "$(verdict liq-new liq-weekly)" = FLAG:new_rows ] && [ "$(sent)" = 0 ]'
fixture liq-ev0 "$LIQ
d['output'] = out.replace('controls 0;', 'controls 0, events 0;')"
run liq-weekly liq-ev0
check 'liq-weekly an IB-143 CLI line with «events 0» → PASS' '[ "$(verdict liq-ev0 liq-weekly)" = PASS ]'
fixture liq-ev "$LIQ
d['output'] = out.replace('controls 0;', 'controls 0, events 3;')"
run liq-weekly liq-ev
check 'liq-weekly a rerun that wrote only event rows (IB-143 once-keys broken) → FLAG:new_rows' '[ "$(verdict liq-ev liq-weekly)" = FLAG:new_rows ]'
fixture liq-short "$LIQ
d['output'] = out.replace('\"days\": 7', '\"days\": 6.8')"
run liq-weekly liq-short
check 'liq-weekly 6.8 days counted → FLAG:days_counted; 6.9 → PASS' '[ "$(verdict liq-short liq-weekly)" = FLAG:days_counted ]'
fixture liq-69 "$LIQ
d['output'] = out.replace('\"days\": 7', '\"days\": 6.9')"
run liq-weekly liq-69
check 'liq-weekly 6.9 days → PASS' '[ "$(verdict liq-69 liq-weekly)" = PASS ]'
fixture liq-paths "$LIQ
d['output'] = out.replace('failed 0', 'failed 3').replace('left 0', 'left 3')"
run liq-weekly liq-paths
check 'liq-weekly 3 failed / open path windows → FLAG (a finding, not FAIL)' '[ "$(verdict liq-paths liq-weekly)" = FLAG:paths_failed,paths_left_open ] && [ "$(sent)" = 0 ]'
fixture liq-killed "$LIQ
d['output'] = out + 'KILLED for memory\n'"
run liq-weekly liq-killed
check 'liq-weekly killed for memory → FAIL, the owner told once' '[ "$(verdict liq-killed liq-weekly | cut -c1-5)" = FAIL: ] && [ "$(sent)" = 1 ]'
fixture liq-exit "$LIQ
d['output'] = out.replace('(exit 0)', '(exit 1)')"
run liq-weekly liq-exit
check 'liq-weekly CLI exit 1 → FAIL' '[ "$(verdict liq-exit liq-weekly)" = "FAIL:liq-backfill.sh exit 0, CLI exit 1" ] && [ "$(sent)" = 1 ]'
fixture liq-nojson "$LIQ
d['output'] = '\n'.join(l for l in out.split('\n') if not l.startswith('LIQ_HISTORY_JSON'))"
run liq-weekly liq-nojson
check 'liq-weekly no summary line → FAIL' '[ "$(verdict liq-nojson liq-weekly | cut -c1-5)" = FAIL: ]'

# ---------------------------------------------------------------------------------- random-controls-day
# IB-BUG-047: the previous UTC day, exactly enabled coins × 3 × 2. $1 = case, $2 = python edits on `d`.
rcd_input() {
  python3 -I - "$work/$1.json" "$2" <<'PY'
import json, sys
path, edits = sys.argv[1], sys.argv[2]
coins = ('BNBUSDT', 'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'TRXUSDT')
d = {'now': '2026-11-06T00:30:01Z', 'day': '2026-11-05',
     'coins': [[c, '1793000000'] for c in coins],  # all added long before the day
     'counts': [[c, tf, '2', '03:00 17:00'] for c in coins for tf in ('15m', '1h', '4h')]}
exec(edits)
with open(path, 'w') as f:
    json.dump(d, f)
PY
}
rcd_day() { python3 -I -c 'import importlib.util,sys;s=importlib.util.spec_from_file_location("c",sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);print(m.rcd_day(m.epoch(sys.argv[2])))' "$CHECKS" "$1"; }
check 'random-controls-day the timer at 00:30 UTC checks the PREVIOUS UTC day; 23:59:59 still the day before it' \
  '[ "$(rcd_day 2026-11-06T00:30:00Z)" = 2026-11-05 ] && [ "$(rcd_day 2026-11-06T00:00:00Z)" = 2026-11-05 ] && [ "$(rcd_day 2026-11-05T23:59:59Z)" = 2026-11-04 ] && [ "$(rcd_day 2027-01-01T00:30:00Z)" = 2026-12-31 ]'
rcd_input rcd-pass ''
run random-controls-day rcd-pass
check 'random-controls-day 5 coins × 3 × 2 = 30 → PASS, exit 0, nothing sent' \
  '[ "$(verdict rcd-pass random-controls-day)" = PASS ] && [ "$(cat $work/rcd-pass.rc)" = 0 ] && [ "$(sent)" = 0 ] && grep -q "| random_controls | 30 | 30–30 | ok |" $work/out-rcd-pass/random-controls-day.md'
rcd_input rcd-lost "d['counts'][4][2] = '1'"
run random-controls-day rcd-lost
check 'random-controls-day a pick LOST (BTCUSDT 1h has 1) → FLAG naming the total and that pair, nothing sent' \
  '[ "$(verdict rcd-lost random-controls-day)" = FLAG:random_controls,BTCUSDT/1h ] && [ "$(sent)" = 0 ] && grep -q "a pick lost for good" $work/out-rcd-lost/random-controls-day.md'
rcd_input rcd-absent "d['counts'] = [r for r in d['counts'] if (r[0], r[1]) != ('TRXUSDT', '4h')]"
run random-controls-day rcd-absent
check 'random-controls-day a pair with NO row at all counts as 0 → FLAG names it' \
  '[ "$(verdict rcd-absent random-controls-day)" = FLAG:random_controls,TRXUSDT/4h ] && grep -qF "| TRXUSDT/4h | 0 | 2–2 | **FLAG** |" $work/out-rcd-absent/random-controls-day.md'
rcd_input rcd-swap "d['counts'][0][2] = '1'; d['counts'][14][2] = '3'"
run random-controls-day rcd-swap
check 'random-controls-day one lost + one extra: the total still 30, the two pairs named (a total alone would pass)' \
  '[ "$(verdict rcd-swap random-controls-day)" = FLAG:BNBUSDT/15m,TRXUSDT/4h ]'
rcd_input rcd-added "d['coins'].append(['DOGEUSDT', '1794000000'])"
run random-controls-day rcd-added
check 'random-controls-day a coin enabled mid-day → its 3 pairs FLAGged, the note says fewer is expected' \
  '[ "$(verdict rcd-added random-controls-day)" = FLAG:random_controls,DOGEUSDT/15m,DOGEUSDT/1h,DOGEUSDT/4h ] && grep -q "DOGEUSDT was added to alert_symbols at" $work/out-rcd-added/random-controls-day.md'
rcd_input rcd-disabled "d['coins'] = d['coins'][:4]"
run random-controls-day rcd-disabled
check 'random-controls-day rows for a coin disabled since → its pairs still checked, the note says so' \
  '[ "$(verdict rcd-disabled random-controls-day)" = FLAG:random_controls ] && grep -q "TRXUSDT is not enabled now" $work/out-rcd-disabled/random-controls-day.md'
rcd_input rcd-edge "d['now'] = '2026-11-06T00:07:00Z'"
run random-controls-day rcd-edge
check 'random-controls-day exactly 00:07 after the day (its last pick recorded ≈ 00:06) → runs, PASS' '[ "$(verdict rcd-edge random-controls-day)" = PASS ]'
rcd_input rcd-early "d['now'] = '2026-11-06T00:06:59Z'"
run random-controls-day rcd-early
check 'random-controls-day a second earlier → FAIL (the day is not settled), one message' \
  '[ "$(verdict rcd-early random-controls-day | cut -c1-5)" = FAIL: ] && [ "$(sent)" = 1 ]'

# ------------------------------------------------------------------------------------- the token, usage
check 'the token is on curl stdin (sent at all)' 'grep -q "$TOKEN" $work/curl-stdin'
check 'the token is never in argv, stdout, stderr or any file' \
  '! grep -rq "$TOKEN" $work/curl-args $work/*.stdout $work/*.stderr $work/out-*'
check 'usage error → exit 2' '[ "$(python3 -I "$CHECKS" run nope 2>/dev/null; echo $?)" = 2 ]'

if [ "$fail" = 0 ]; then echo "checks.test.sh: all passed"; else echo "checks.test.sh: FAILURES"; exit 1; fi
