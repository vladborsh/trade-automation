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

# ------------------------------------------------------------------------------------ first-live-hidden (IB-144)
HID='
d = {"now": "2026-11-06T03:00:00Z", "eligible": [["1"]], "link": "https://x/instrument/ETHUSDT?at=1793929500&tf=15m", "link_code": 200,
     "alert": [["412", "ETHUSDT", "15m", "bullish", "1793929500", "1793935800", "1793936160", "1", "f", "9c0bb1fe8b8a", "true"]]}
'
fixture flh-pending 'd = {"now": "2026-11-06T01:10:00Z", "alert": [], "eligible": [["1"]], "link_code": None}'
run first-live-hidden flh-pending
check 'first-live-hidden none yet → PENDING: no sentinel, nothing sent, exit 0' \
  '[ ! -e $work/out-flh-pending/first-live-hidden.done ] && grep -q "\"verdict\": \"PENDING\"" $work/out-flh-pending/first-live-hidden.json && [ "$(sent)" = 0 ] && [ "$(cat $work/flh-pending.rc)" = 0 ]'
fixture flh-pass "$HID"
run first-live-hidden flh-pass
check 'first-live-hidden the owner only, on time, 15m switched on, link 200 → PASS with the facts; the owner is NOT told' \
  '[ "$(verdict flh-pass first-live-hidden)" = PASS ] && [ "$(sent)" = 0 ] && grep -q "\"fire_after_confirm_s\": 360" $work/out-flh-pass/first-live-hidden.json'
fixture flh-two "$HID
d['alert'][0][7] = '2'; d['eligible'] = [['2']]"
run first-live-hidden flh-two
check 'first-live-hidden sent to 2 (not owner-only) → FLAG:recipients,oi_alerts_users' '[ "$(verdict flh-two first-live-hidden)" = FLAG:recipients,oi_alerts_users ]'
fixture flh-off "$HID
d['alert'][0][2] = '4h'; d['alert'][0][10] = 'false'"
run first-live-hidden flh-off
check 'first-live-hidden sent on a TF whose sendHidden is off (4h) → FLAG:tf_send_hidden (the gate is broken)' '[ "$(verdict flh-off first-live-hidden)" = FLAG:tf_send_hidden ]'
fixture flh-late "$HID
d['alert'][0][8] = 't'; d['link_code'] = 502"
run first-live-hidden flh-late
check 'first-live-hidden late and a 502 link → FLAG:late,link_http' '[ "$(verdict flh-late first-live-hidden)" = FLAG:late,link_http ]'

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
       "== memory over 1500 samples\nmin MemAvailable 150 MB; max bot RSS 120 MB; max CLI RSS 90 MB\n== start gate: asked 140, the CLI applied 140\nfiles: /root/x.out /root/x.mem\n")
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
       "== memory over 900 samples\nmin MemAvailable 140 MB; max bot RSS 120 MB; max CLI RSS 100 MB\n== start gate: asked 140, the CLI applied 140\nfiles: /root/x.out /root/x.mem\n")
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

# ------------------------------------------------------------------------------- oi-hidden-backfill.sh (IB-144)
# TL ruling 2026-11-06: a run that did not START (the CLI's memory gate refused, or no memory window came) is
# DEFERRED — the sentinel says so and the owner's Telegram is NOT called; a broken run is FAIL and is. A stub `docker`
# plays the container (FAKE_CLI picks the CLI's behaviour); a stub deploy-watch.py records send_owner calls.
OHB="$HERE/oi-hidden-backfill.sh"
mkdir -p "$work/ohb-bin" "$work/ohb-deploy"
cat >"$work/ohb-bin/docker" <<'STUB'
#!/usr/bin/env bash
echo "$*" >>"$OHB_DOCKER_LOG"
case "$1" in
  inspect) case "$3" in *Pid*) echo 999999 ;; *) echo 'ecr/insight-bot:sha-9c0bb1fe8b8a' ;; esac ;;
  cp) touch "$3" ;;
  compose) printf 'alerts\t54\ncontrols\t2424\nnear_misses\t88\npaths\t7698\npaths_open\t0\n' ;;   # checks.py psql (backfill-rerun)
  exec)
    case "$*" in
      *hidden-guard.cli.js*) echo '| 15m | … | **PASS** |'; exit 0 ;;
    esac
    # IB-145: the CLI as the image would run it — its gate is MEM_START_FLOOR_MB when passed (-e), else 170;
    # FAKE_CLI=old plays an image from before 95366a24, which ignores the env and does not name its floor
    all="$*"; floor=170; case "$all" in *MEM_START_FLOOR_MB=*) floor="${all#*MEM_START_FLOOR_MB=}"; floor="${floor%% *}" ;; esac
    who=oi; case "$*" in *liq-backfill.cli.js*) who=liq ;; *funding-backfill.cli.js*) who=funding ;; esac
    n=0; [ -n "${FAKE_COUNT:-}" ] && { n=$(( $(cat "$FAKE_COUNT" 2>/dev/null || echo 0) + 1 )); echo "$n" >"$FAKE_COUNT"; }
    cli="$FAKE_CLI"; [ -n "${FAKE_OK_FROM:-}" ] && [ "$n" -ge "$FAKE_OK_FROM" ] && cli=ok
    case "$cli" in
      refused) echo "$who backfill failed: Error: memory gate: refused — MemAvailable 139 MB < $floor MB — not starting the replay; run it at a quieter hour"; exit 1 ;;
      old-refused) echo "$who backfill failed: Error: memory gate: MemAvailable 150 MB < 170 MB — not starting the replay; run it at a quieter hour"; exit 1 ;;
      badenv) echo "$who backfill failed: Error: MEM_START_FLOOR_MB=$floor: a whole number of MB, at least the pause floor 120"; exit 1 ;;
      crash) echo "$who backfill failed: Error: connect ECONNREFUSED"; exit 1 ;;
      old) echo "memory gate: 258 MB available — starting the replay"; echo 'done in 3 s'; exit 0 ;;
      *) sleep "${FAKE_SLEEP:-0}"  # composition cases: a run long enough for the runner's sampler to take one sample
         echo "$who backfill: build 9c0bb1fe8b8a"; echo "memory gate: 258 MB available (start gate $floor MB) — starting the replay"
         echo "memory gate: 240 MB available (start gate $floor MB) — starting path measuring"
         [ "$who" = liq ] && { echo 'write ×1: 4851 ticks over (…]; new rows: alerts 0, continuations 0, controls 0, events 0; 24739 reads'
           echo 'LIQ_HISTORY_JSON {"mode": "write", "from": "2026-11-04T00:00:00.000Z", "until": "2026-11-05T16:59:34.379Z", "countsTo": "2026-11-11T00:00:00.000Z", "days": 7, "written": {}, "table": []}'; }
         [ "$who" = funding ] && { u="${all#*--until }"; u="${u%% *}"; echo 'write ×1: 51744 checks; new rows: enter 0, flip 0, controls 0; stale 0, insufficient 0'
           echo "FUNDING_HISTORY_JSON {\"mode\": \"write\", \"until\": \"$u\", \"written\": {}, \"table\": []}"; }
         echo 'paths: measured 314, failed 0, weight 790, 1500 s; left 0'; echo 'done in 3 s'; exit 0 ;;
    esac ;;
esac
STUB
chmod +x "$work/ohb-bin/docker"
cat >"$work/ohb-deploy/deploy-watch.py" <<'PY'
import os
def send_owner(text, dry_run):
    with open(os.environ['OHB_TG'], 'a', encoding='utf-8') as f:
        f.write(text + '\n')
    return {'ok': True}
PY
printf 'MemAvailable:     204800 kB\n' >"$work/ohb-meminfo"   # 200 MB
ohb() { # $1 = case, $2 = FAKE_CLI, then env assignments, then the mode
  local c="$1" cli="$2"; shift 2
  mkdir -p "$work/ohb-$c"
  env PATH="$work/ohb-bin:$PATH" OHB_DOCKER_LOG="$work/ohb-$c.docker" OHB_TG="$work/ohb-$c.tg" FAKE_CLI="$cli" \
    CHECKS_DIR="$work/ohb-$c" DEPLOY_DIR="$work/ohb-deploy" MEMINFO="$work/ohb-meminfo" PID_TRIES=1 SAMPLE_S=0.1 \
    "$@" >"$work/ohb-$c.stdout" 2>&1 || rc=$?
  echo "${rc:-0}" >"$work/ohb-$c.rc"; unset rc
}
ohb_v() { cat "$work/ohb-$1/oi-hidden-dry-run.done" 2>/dev/null; }
ohb ok ok bash "$OHB" --dry-run
check 'oi-hidden: a completed dry run → PASS, the guard table appended, no Telegram' \
  '[ "$(ohb_v ok)" = PASS ] && grep -q "V47 guard" $work/ohb-ok/oi-hidden-dry-run.md && [ ! -s $work/ohb-ok.tg ]'
ohb refused refused env MEM_START_FLOOR_MB=140 bash "$OHB" --dry-run
check 'oi-hidden: the CLI memory gate refused → DEFERRED:memory gate refused (MemAvailable 139 MB < 140 MB), exit 3, NO Telegram' \
  '[ "$(ohb_v refused)" = "DEFERRED:memory gate refused (MemAvailable 139 MB < 140 MB)" ] && [ "$(cat $work/ohb-refused.rc)" = 3 ] && [ ! -s $work/ohb-refused.tg ]'
check 'oi-hidden: MEM_START_FLOOR_MB reaches the container (docker exec -e), and only when set' \
  'grep -q "^exec -e MEM_START_FLOOR_MB=140 insight-bot-insight-bot-1 node" $work/ohb-refused.docker && ! grep -q "MEM_START_FLOOR_MB" $work/ohb-ok.docker'
ohb crash crash bash "$OHB" --dry-run
check 'oi-hidden: a CLI that broke → FAIL:CLI exit 1 and ONE Telegram to the owner' \
  '[ "$(ohb_v crash)" = "FAIL:CLI exit 1" ] && [ "$(wc -l <$work/ohb-crash.tg | tr -d " ")" = 1 ] && grep -q "сломался" $work/ohb-crash.tg'
ohb nowin ok env WAIT_FOR_MB=240 WAIT_UNTIL=0 bash "$OHB" --dry-run
check 'oi-hidden: no memory window before WAIT_UNTIL → DEFERRED, exit 3, the CLI never ran, NO Telegram' \
  '[ "$(ohb_v nowin)" = "DEFERRED:no MemAvailable >= 240 MB window" ] && [ "$(cat $work/ohb-nowin.rc)" = 3 ] && ! grep -q "^exec" $work/ohb-nowin.docker 2>/dev/null && [ ! -s $work/ohb-nowin.tg ]'
ohb win ok env WAIT_FOR_MB=200 WAIT_UNTIL=0 bash "$OHB" --dry-run
check 'oi-hidden: the window is there (200 MB ≥ 200) → the run starts and PASSes' '[ "$(ohb_v win)" = PASS ]'
cw="$(sed -n 's/.*case "\$verdict" in \(.*\) esac.*/\1/p' "$HERE/check-wait.sh")"
check 'check-wait.sh: DEFERRED:* exits 3 (not 4, which means «the owner already has a FAIL message»)' \
  '[ "$(verdict=DEFERRED:x; eval "case \"\$verdict\" in $cw esac" 2>/dev/null; echo $?)" = 3 ] || (verdict=DEFERRED:x; (eval "case \"\$verdict\" in $cw esac"); [ $? = 3 ])'

# ----------------------------------------------------------------- the start floor, all three runners (IB-145)
# box-backfill.sh and liq-backfill.sh take --start-floor N (history-gate.sh: 140–500), pass it as docker exec -e, report
# which gate the CLI applied, and turn a gate refusal into «DEFERRED:…», exit 3. The same stub docker plays the CLI.
BOX="$HERE/box-backfill.sh"; LIQR="$HERE/liq-backfill.sh"; FUNDR="$HERE/funding-backfill.sh"   # IB-125: the funding runner too
hr() { # $1 = case, $2 = FAKE_CLI, then the command → $work/hr-<case>.{stdout,rc,docker}
  local c="$1" cli="$2"; shift 2
  mkdir -p "$work/hr-$c"
  env PATH="$work/ohb-bin:$PATH" OHB_DOCKER_LOG="$work/hr-$c.docker" FAKE_CLI="$cli" RUN_DIR="$work/hr-$c" \
    MEMINFO="$work/ohb-meminfo" PID_TRIES=1 SAMPLE_S=0.1 "$@" >"$work/hr-$c.stdout" 2>&1 || rc=$?
  echo "${rc:-0}" >"$work/hr-$c.rc"; unset rc
}
last() { tail -1 "$work/hr-$1.stdout"; }
rc_of() { cat "$work/hr-$1.rc"; }
for r in box liq funding; do
  case $r in
    box) S="$BOX"; A=(--write) ;;
    liq) S="$LIQR"; A=(--write --until 2026-11-05T16:59:34.379Z --counts-to 2026-11-11T00:00:00Z) ;;
    funding) S="$FUNDR"; A=(--write --until 2026-11-06T22:00:00Z) ;;
  esac
  hr $r-140 ok bash "$S" "${A[@]}" --start-floor 140
  check "$r: --start-floor 140 → docker exec -e MEM_START_FLOOR_MB=140, the CLI applied 140, exit 0" \
    "grep -q '^exec -e MEM_START_FLOOR_MB=140 insight-bot-insight-bot-1 node' $work/hr-$r-140.docker && grep -qx '== start gate: asked 140, the CLI applied 140' $work/hr-$r-140.stdout && [ \$(rc_of $r-140) = 0 ]"
  hr $r-def ok bash "$S" "${A[@]}"
  check "$r: no flag → no -e, the CLI's default 170 (asked default)" \
    "! grep -q MEM_START_FLOOR_MB $work/hr-$r-def.docker && grep -qx '== start gate: asked default, the CLI applied 170' $work/hr-$r-def.stdout"
  hr $r-ref refused bash "$S" "${A[@]}" --start-floor 140
  check "$r: the gate refused → last line DEFERRED:memory gate refused (MemAvailable 139 MB < 140 MB), exit 3" \
    "[ \"\$(last $r-ref)\" = 'DEFERRED:memory gate refused (MemAvailable 139 MB < 140 MB)' ] && [ \$(rc_of $r-ref) = 3 ]"
  hr $r-old old-refused bash "$S" "${A[@]}" --start-floor 140
  check "$r: an old image refused at its 170 → DEFERRED too, and the report says it applied 170, not 140" \
    "[ \"\$(last $r-old)\" = 'DEFERRED:memory gate refused (MemAvailable 150 MB < 170 MB)' ] && grep -qx '== start gate: asked 140, the CLI applied 170' $work/hr-$r-old.stdout"
  hr $r-crash crash bash "$S" "${A[@]}" --start-floor 140
  check "$r: a crash is NOT a deferral (no DEFERRED line, the CLI's exit 1 for checks.py's FAIL)" \
    "! grep -q '^DEFERRED' $work/hr-$r-crash.stdout && grep -q '^== CLI output (exit 1)' $work/hr-$r-crash.stdout && [ \$(rc_of $r-crash) != 3 ]"
  hr $r-badenv badenv bash "$S" "${A[@]}" --start-floor 140
  check "$r: the CLI refusing the env VALUE is NOT a deferral" "! grep -q '^DEFERRED' $work/hr-$r-badenv.stdout"
  for n in 139 501 abc 1.5 ''; do
    hr $r-bad bash bash "$S" "${A[@]}" --start-floor "$n"
    check "$r: --start-floor '$n' → exit 2, the CLI never started" "[ \$(rc_of $r-bad) = 2 ] && ! grep -q '^exec' $work/hr-$r-bad.docker 2>/dev/null"
  done
  hr $r-500 ok bash "$S" "${A[@]}" --start-floor 500
  check "$r: --start-floor 500 (the top) is accepted" "grep -q 'MEM_START_FLOOR_MB=500' $work/hr-$r-500.docker"
done
check 'liq: --start-floor reaches the env, never the CLI argv; --until / --counts-to do' \
  "! grep -q -- '--start-floor' $work/hr-liq-140.docker && grep -q -- 'liq-backfill.cli.js --write --until 2026-11-05T16:59:34.379Z --counts-to 2026-11-11T00:00:00Z\$' $work/hr-liq-140.docker"
check 'funding: --start-floor reaches the env, never the CLI argv; --until does; the funding CLI is the one started' \
  "! grep -q -- '--start-floor' $work/hr-funding-140.docker && grep -q -- 'funding-backfill.cli.js --write --until 2026-11-06T22:00:00Z\$' $work/hr-funding-140.docker"
check 'box: the flag goes after the mode only; anything else → usage, exit 2' \
  "hr box-junk ok bash '$BOX' --write --bogus; [ \$(rc_of box-junk) = 2 ]"
hr box-oldok old bash "$BOX" --write --start-floor 140
check 'box: an image that ignores the env and ran → «applied old image» (checks.py FLAGs it)' \
  "grep -qx '== start gate: asked 140, the CLI applied old image' $work/hr-box-oldok.stdout"
ohb flag ok bash "$OHB" --dry-run --start-floor 150
check 'oi-hidden: --start-floor 150 → -e MEM_START_FLOOR_MB=150; the .md says the CLI applied 150' \
  'grep -q "^exec -e MEM_START_FLOOR_MB=150 " $work/ohb-flag.docker && grep -qx "== start gate: asked 150, the CLI applied 150" $work/ohb-flag/oi-hidden-dry-run.md'
ohb flagwins ok env MEM_START_FLOOR_MB=200 bash "$OHB" --dry-run --start-floor 150
check 'oi-hidden: the flag wins over env MEM_START_FLOOR_MB' 'grep -q "MEM_START_FLOOR_MB=150 " $work/ohb-flagwins.docker && ! grep -q "MEM_START_FLOOR_MB=200" $work/ohb-flagwins.docker'
ohb env90 ok env MEM_START_FLOOR_MB=90 bash "$OHB" --dry-run
check 'oi-hidden: env MEM_START_FLOOR_MB=90 → exit 2 before any docker call' '[ "$(cat $work/ohb-env90.rc)" = 2 ] && [ ! -s $work/ohb-env90.docker ]'
ohb flag139 ok bash "$OHB" --dry-run --start-floor 139
check 'oi-hidden: --start-floor 139 → exit 2 (below 140 only by a TL ruling, as a commit)' '[ "$(cat $work/ohb-flag139.rc)" = 2 ] && [ ! -s $work/ohb-flag139.docker ]'

# ------------------------------------------------------------------------------------------ funding-rerun (IB-125)
FUND='
import json
summary = {"mode": "write", "from": "2026-05-10T22:00:00.000Z", "to": "2026-11-06T16:00:00.000Z", "until": "2026-11-06T22:00:00.000Z", "days": 180,
           "written": {"alerts_enter": 26, "alerts_flip": 2, "controls_random": 1795, "controls_near_miss": 239, "paths": 6186, "paths_measured": 6186}, "table": [], "alerts": []}
def out(new=(0, 0, 0), failed=0, left=0, rc_cli=0, js=True, killed=False):
    return ("start 20261110T000000Z mode --write\n== CLI output (exit %d)\n" % rc_cli
            + "write ×1: 51744 checks; new rows: enter %d, flip %d, controls %d; stale 0, insufficient 0\n" % new
            + "paths: measured 30, failed %d, weight 80, 20 s; left %d\n" % (failed, left)
            + ("FUNDING_HISTORY_JSON " + json.dumps(summary) + "\n" if js else "")
            + "== memory over 60 samples\nmin MemAvailable 150 MB; max bot RSS 120 MB; max CLI RSS 100 MB\n"
            + ("KILLED for memory\n" if killed else "") + "== start gate: asked 140, the CLI applied 140\nfiles: /root/x.out /root/x.mem\n")
'
fixture fund-pass "$FUND
d = {'started': 'x', 'until': '2026-11-06T22:00:00.000Z', 'until_from': '/root/ib125write-1.out', 'rc': 0, 'output': out()}"
run funding-rerun fund-pass
check 'funding-rerun a clean rerun → PASS, nothing sent, the .md names the --until and where it came from' \
  '[ "$(verdict fund-pass funding-rerun)" = PASS ] && [ "$(sent)" = 0 ] && grep -q "until 2026-11-06T22:00:00.000Z, read from /root/ib125write-1.out" $work/out-fund-pass/funding-rerun.md'
fixture fund-new "$FUND
d = {'rc': 0, 'output': out(new=(0, 1, 0))}"
run funding-rerun fund-new
check 'funding-rerun a rerun that wrote a row (once-keys broken) → FLAG:new_rows, no Telegram' '[ "$(verdict fund-new funding-rerun)" = FLAG:new_rows ] && [ "$(sent)" = 0 ]'
fixture fund-paths "$FUND
d = {'rc': 0, 'output': out(failed=2, left=3)}"
run funding-rerun fund-paths
check 'funding-rerun failed / open path windows → FLAG' '[ "$(verdict fund-paths funding-rerun)" = FLAG:paths_failed,paths_left_open ] && [ "$(sent)" = 0 ]'
fixture fund-killed "$FUND
d = {'rc': 0, 'output': out(killed=True)}"
run funding-rerun fund-killed
check 'funding-rerun killed for memory → FAIL, the owner told once' '[ "$(verdict fund-killed funding-rerun | cut -c1-5)" = FAIL: ] && [ "$(sent)" = 1 ]'
fixture fund-exit "$FUND
d = {'rc': 0, 'output': out(rc_cli=1)}"
run funding-rerun fund-exit
check 'funding-rerun CLI exit 1 (a MISMATCH or a warning) → FAIL' '[ "$(verdict fund-exit funding-rerun)" = "FAIL:funding-backfill.sh exit 0, CLI exit 1" ] && [ "$(sent)" = 1 ]'
fixture fund-nojson "$FUND
d = {'rc': 0, 'output': out(js=False)}"
run funding-rerun fund-nojson
check 'funding-rerun no summary line → FAIL' '[ "$(verdict fund-nojson funding-rerun | cut -c1-5)" = FAIL: ]'
fixture fund-deferred "$FUND
d = {'rc': 3, 'tries': 6, 'output': 'start x\n== CLI output (exit 1)\nfunding backfill failed: Error: memory gate: refused — MemAvailable 139 MB < 140 MB\n== start gate: asked 140, the CLI applied 140\nDEFERRED:memory gate refused (MemAvailable 139 MB < 140 MB)\n'}"
run funding-rerun fund-deferred
check 'funding-rerun refused on all tries → DEFERRED, NO Telegram' '[ "$(verdict fund-deferred funding-rerun)" = "DEFERRED:memory gate refused (MemAvailable 139 MB < 140 MB), 6 of 6 tries" ] && [ "$(sent)" = 0 ]'

# ------------------------------------------------- checks.py: DEFERRED, the floor it asks, the retries (IB-145)
fixture bf-deferred "$BF
d['rc'] = 3; d['tries'] = 6
d['output'] = 'start x\n== CLI output (exit 1)\noi backfill failed: Error: memory gate: refused — MemAvailable 139 MB < 140 MB\n== start gate: asked 140, the CLI applied 140\nDEFERRED:memory gate refused (MemAvailable 139 MB < 140 MB)\n'"
run backfill-rerun bf-deferred
check 'backfill-rerun refused on all 6 tries → DEFERRED:…, 6 of 6 tries; exit 0; NO Telegram; the .md says how to reschedule' \
  '[ "$(verdict bf-deferred backfill-rerun)" = "DEFERRED:memory gate refused (MemAvailable 139 MB < 140 MB), 6 of 6 tries" ] && [ "$(cat $work/bf-deferred.rc)" = 0 ] && [ "$(sent)" = 0 ] && grep -q "Did not start" $work/out-bf-deferred/backfill-rerun.md && grep -q "checks.py schedule backfill-rerun" $work/out-bf-deferred/backfill-rerun.md'
fixture bf-def-old "$BF
d['rc'] = 3
d['output'] = '== CLI output (exit 1)\n== start gate: asked 140, the CLI applied 170\nDEFERRED:memory gate refused (MemAvailable 150 MB < 170 MB)\n'"
run backfill-rerun bf-def-old
check 'backfill-rerun deferred under an image that ignored the floor → the verdict names it' \
  'verdict bf-def-old backfill-rerun | grep -q "the image ignored the floor: asked 140, applied 170"'
fixture bf-rc3 "$BF
d['rc'] = 3"
run backfill-rerun bf-rc3
check 'backfill-rerun exit 3 with no DEFERRED line → FAIL (an exit code alone is not a deferral)' '[ "$(verdict bf-rc3 backfill-rerun)" = "FAIL:box-backfill.sh exit 3, CLI exit 0" ] && [ "$(sent)" = 1 ]'
fixture bf-line1 "$BF
d['rc'] = 1
d['output'] = '== CLI output (exit 1)\n== start gate: asked 140, the CLI applied 140\nDEFERRED:memory gate refused (MemAvailable 139 MB < 140 MB)\n'"
run backfill-rerun bf-line1
check 'backfill-rerun a DEFERRED line but exit 1 → FAIL (the line alone is not a deferral), one Telegram' '[ "$(verdict bf-line1 backfill-rerun)" = "FAIL:box-backfill.sh exit 1, CLI exit 1" ] && [ "$(sent)" = 1 ]'
fixture bf-ignored "$BF
d['output'] = out.replace('the CLI applied 140', 'the CLI applied old image')"
run backfill-rerun bf-ignored
check 'backfill-rerun an image that ignored the floor → FLAG:start_floor_ignored (silent)' '[ "$(verdict bf-ignored backfill-rerun)" = FLAG:start_floor_ignored ] && [ "$(sent)" = 0 ]'
fixture bf-nogate "$BF
d['output'] = out.replace('== start gate: asked 140, the CLI applied 140\n', '')"
run backfill-rerun bf-nogate
check 'backfill-rerun output without «== start gate:» (an old runner) → FAIL' '[ "$(verdict bf-nogate backfill-rerun)" = "FAIL:box-backfill.sh output has no «== start gate:» line" ]'
fixture liq-deferred "$LIQ
d['rc'] = 3; d['tries'] = 6
d['output'] = '== CLI output (exit 1)\n== start gate: asked 140, the CLI applied 140\nDEFERRED:memory gate refused (MemAvailable 139 MB < 140 MB)\n'"
run liq-weekly liq-deferred
check 'liq-weekly refused on all tries → DEFERRED, NO Telegram' '[ "$(verdict liq-deferred liq-weekly | cut -c1-9)" = DEFERRED: ] && [ "$(sent)" = 0 ]'
fixture liq-ignored "$LIQ
d['output'] = out.replace('the CLI applied 140', 'the CLI applied 170')"
run liq-weekly liq-ignored
check 'liq-weekly the CLI applied 170 when 140 was asked → FLAG:start_floor_ignored' '[ "$(verdict liq-ignored liq-weekly)" = FLAG:start_floor_ignored ]'

# the retry loop and the backup window: checks.py imported, a stub runner, a fake clock and sleep
cat >"$work/stub-runner.sh" <<'STUB'
#!/usr/bin/env bash
echo "$*" >>"$STUB_RUNNER_LOG"
n=$(( $(wc -l <"$STUB_RUNNER_LOG") ))
if [ "$n" -lt "${OK_FROM:-999}" ]; then echo "DEFERRED:memory gate refused (MemAvailable 139 MB < 140 MB)"; exit 3; fi
[ -n "${CRASH:-}" ] && { echo crash; exit 1; }
echo "ran"; exit 0
STUB
pyc() { python3 -I - "$CHECKS" "$work" "$@" <<'PY'
import importlib.util, os, sys
spec = importlib.util.spec_from_file_location('c', sys.argv[1]); c = importlib.util.module_from_spec(spec); spec.loader.exec_module(c)
work, case = sys.argv[2], sys.argv[3]
log = os.path.join(work, 'runner-%s.log' % case); os.environ['STUB_RUNNER_LOG'] = log
open(log, 'w').close()
slept = []
noon = 1793966400.0  # 2026-11-07T12:00:00Z
if case == 'third':
    os.environ['OK_FROM'] = '3'
    r = c.history_run(os.path.join(work, 'stub-runner.sh'), ['--write'], sleep=slept.append, now=lambda: noon)
    args = open(log).read().splitlines()
    assert (r['rc'], r['tries'], slept) == (0, 3, [1800, 1800]), (r, slept)
    assert args == ['--write --start-floor 140'] * 3, args
elif case == 'never':
    r = c.history_run(os.path.join(work, 'stub-runner.sh'), ['--write'], sleep=slept.append, now=lambda: noon)
    assert (r['rc'], r['tries'], len(slept)) == (3, 6, 5), (r, slept)
elif case == 'crash':
    os.environ['OK_FROM'] = '1'; os.environ['CRASH'] = '1'
    r = c.history_run(os.path.join(work, 'stub-runner.sh'), ['--write'], sleep=slept.append, now=lambda: noon)
    assert (r['rc'], r['tries'], slept) == (1, 1, []), (r, slept)
elif case == 'window':
    day = 1793923200  # 2026-11-07T00:00:00Z
    got = [c.backup_quiet_wait(day + s) for s in (54 * 60 + 59, 55 * 60, 3600, 89 * 60 + 59, 90 * 60, 22 * 3600 + 300)]
    assert got == [0, 35 * 60, 30 * 60, 1, 0, 0], got
    os.environ['OK_FROM'] = '1'
    r = c.history_run(os.path.join(work, 'stub-runner.sh'), ['--write'], sleep=slept.append, now=lambda: day + 3600 + 20)
    assert slept == [30 * 60 - 20] and r['waits'] and r['rc'] == 0, (slept, r)
print('ok')
PY
}
check 'history_run: refused twice then started → 3 tries, 30 min apart, every try asks --start-floor 140' '[ "$(pyc third | tail -1)" = ok ]'
check 'history_run: refused on every try → 6 tries (5 waits), rc 3' '[ "$(pyc never | tail -1)" = ok ]'
check 'history_run: a crash is not retried' '[ "$(pyc crash | tail -1)" = ok ]'
check 'history_run: no try starts 00:55–01:30 UTC (the pg_dump); 00:54:59 and 01:30:00 start at once' '[ "$(pyc window | tail -1)" = ok ]'
check 'the backup window follows the backup timer: insight-bot-backup.timer is 01:00:00 UTC, checks.py BACKUP_UTC_S = 3600' \
  "grep -qx 'OnCalendar=\*-\*-\* 01:00:00 UTC' '$HERE/../systemd/insight-bot-backup.timer' && grep -q '^BACKUP_UTC_S = 3600 ' '$CHECKS'"

# composition: checks.py → the REAL runner → the stub CLI (no CHECKS_FAKE_INPUT); a fake clock at noon UTC
compose_run() { # $1 = check, $2 = case, $3 = FAKE_CLI, $4 = runner, then extra env
  local name="$1" c="$2" cli="$3" runner="$4"; shift 4
  mkdir -p "$work/cr-$c"; : >"$work/curl-stdin"
  env PATH="$work/ohb-bin:$work/bin:$PATH" OHB_DOCKER_LOG="$work/cr-$c.docker" FAKE_CLI="$cli" RUN_DIR="$work/cr-$c" \
    MEMINFO="$work/ohb-meminfo" PID_TRIES=1 SAMPLE_S=0.1 CHECKS_DIR="$work/cr-$c" DEPLOY_DIR="$work/cr-$c" WATCH_ENV_FILE="$work/env" \
    STUB_CURL_ARGS="$work/curl-args" STUB_CURL_STDIN="$work/curl-stdin" CHECKS_DEFER_WAIT_S=0 CHECKS_FAKE_NOW=1793966400 FAKE_SLEEP=1.2 \
    CHECKS_BACKFILL_SCRIPT="$BOX" CHECKS_LIQ_SCRIPT="$LIQR" CHECKS_FUNDING_SCRIPT="$FUNDR" CHECKS_FUNDING_RUN_DIR="$work/cr-$c" "$@" python3 -I "$CHECKS" run "$name" >"$work/cr-$c.stdout" 2>&1 || true
  cat "$work/cr-$c/$name.done" 2>/dev/null
}
check 'backfill-rerun → box-backfill.sh, gate refused on every try → DEFERRED, 6 docker execs, NO Telegram' \
  '[ "$(compose_run backfill-rerun bfr refused x)" = "DEFERRED:memory gate refused (MemAvailable 139 MB < 140 MB), 6 of 6 tries" ] && [ "$(grep -c "^exec -e MEM_START_FLOOR_MB=140 " $work/cr-bfr.docker)" = 6 ] && [ "$(sent)" = 0 ]'
check 'backfill-rerun → box-backfill.sh, refused twice then ran → PASS, 3 execs at 140' \
  '[ "$(compose_run backfill-rerun bfok refused x FAKE_COUNT=$work/cr-bfok.n FAKE_OK_FROM=3)" = PASS ] && [ "$(grep -c "^exec -e MEM_START_FLOOR_MB=140 " $work/cr-bfok.docker)" = 3 ]'
check 'liq-weekly → liq-backfill.sh, refused on every try → DEFERRED, NO Telegram' \
  '[ "$(compose_run liq-weekly lqr refused x | cut -c1-9)" = DEFERRED: ] && [ "$(sent)" = 0 ]'
check 'liq-weekly → liq-backfill.sh, started at 140 → PASS, the .md names the gate it applied' \
  'v=$(compose_run liq-weekly lqok ok x); [ "$v" = PASS ] && grep -q "start gate: asked 140 MB, the CLI applied 140" $work/cr-lqok/liq-weekly.md'
check 'liq-weekly → a crashed CLI is still FAIL and ONE Telegram' \
  '[ "$(compose_run liq-weekly lqc crash x | cut -c1-5)" = FAIL: ] && [ "$(sent)" = 1 ]'

# funding-rerun reads --until from the newest completed WRITE's output in the run dir; a dry run or a broken write is not one
fwrite() { # $1 = case dir, $2 = stamp, $3 = mode, $4 = until
  mkdir -p "$work/cr-$1"; printf '== CLI output (exit 0)\nFUNDING_HISTORY_JSON {"mode": "%s", "until": "%s"}\n' "$3" "$4" >"$work/cr-$1/ib125write-$2.out"
}
fwrite fuok 20261106T220000Z write 2026-11-06T21:55:00.000Z
fwrite fuok 20261107T010000Z write 2026-11-06T22:05:00.000Z
fwrite fuok 20261107T020000Z dry-run 2026-11-06T23:00:00.000Z
printf 'funding backfill failed: Error: boom\n' >"$work/cr-fuok/ib125write-20261107T030000Z.out"
check 'funding-rerun → funding-backfill.sh with the --until of the newest completed write (not a dry run, not a crash) → PASS' \
  'v=$(compose_run funding-rerun fuok ok x); [ "$v" = PASS ] && grep -q -- "funding-backfill.cli.js --write --until 2026-11-06T22:05:00.000Z\$" $work/cr-fuok.docker'
check 'funding-rerun with no completed write on the box → FAIL before any docker exec, ONE Telegram' \
  '[ "$(compose_run funding-rerun funone ok x | cut -c1-5)" = FAIL: ] && [ ! -s $work/cr-funone.docker ] && [ "$(sent)" = 1 ] && grep -q "no completed funding write" $work/cr-funone/funding-rerun.md'
fwrite fudef 20261106T220000Z write 2026-11-06T22:05:00.000Z
check 'funding-rerun → refused on every try → DEFERRED, NO Telegram' \
  '[ "$(compose_run funding-rerun fudef refused x | cut -c1-9)" = DEFERRED: ] && [ "$(sent)" = 0 ]'

if [ "$fail" = 0 ]; then echo "checks.test.sh: all passed"; else echo "checks.test.sh: FAILURES"; exit 1; fi
