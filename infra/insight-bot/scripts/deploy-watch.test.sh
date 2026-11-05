#!/usr/bin/env bash
# Offline check of deploy-watch.py (IB-139): fake samples (WATCH_FAKE_SAMPLES) stand in for the box and a
# stub `curl` for Telegram. Runs anywhere with python3 >= 3.9; no Docker, no systemd, no network.
#
#   bash infra/insight-bot/scripts/deploy-watch.test.sh
#
# Every alarm rule fires when it should and stays silent at its boundary (MemAvailable < 100 MB on one
# sample → no; on two ADJACENT → yes; on two with a good one between → no; exactly 100 → no; swap 500
# → no, 501 → yes; /healthz the same as memory); one message per reason per deploy; nothing sent on
# CLEAN; SUPERSEDED wins over an alarm already sent (which stays sent); a watch stopped any other way
# leaves no verdict; the files are written at every sample; the token is on curl's stdin only — never
# in argv, stdout, stderr (the systemd journal is exactly those two) or the files. An over-send and a
# missing owed OI evaluation are alarms (TL review); error lines and the Σ sent mismatch are warnings only;
# the OI-loop expectation covers only closes inside the window plus the lag.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
WATCH="$HERE/deploy-watch.py"
work="$(mktemp -d)"
trap '[ -n "${KEEP:-}" ] || rm -rf "$work"' EXIT; [ -n "${KEEP:-}" ] && echo "work dir: $work"
fail=0
check() { if eval "$2"; then echo "ok   - $1"; else echo "FAIL - $1"; fail=1; fi; }

TOKEN='987654:FAKE-watch_token-never-printed'
SHA=0123456789ab
mkdir -p "$work/bin"
cat >"$work/bin/curl" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$STUB_CURL_ARGS"
cat >>"$STUB_CURL_STDIN"
echo '{"ok":true,"result":{}}'
STUB
chmod +x "$work/bin/curl"
printf "POSTGRES_PASSWORD='x'\nTELEGRAM_BOT_TOKEN='%s'\nTELEGRAM_SERVICE_CHAT_ID='-1001'\n" "$TOKEN" >"$work/env"

# Seven samples: a healthy box, then the case's overrides. `boot` is 2 min before now, so the OI loop
# owes exactly its boot evaluations (15m/1h/4h) once the lag has passed — the fixtures log them.
fixtures() { # $1 = case name, $2 = JSON: a list of 7 objects of overrides (path.with.dots: value)
  python3 -I - "$1" "$2" "$work" "$SHA" <<'PY'
import json, sys, time
name, overrides, work, sha = sys.argv[1], json.loads(sys.argv[2]), sys.argv[3], sys.argv[4]
now = time.time(); boot = now - 3600  # booted an hour ago: its boot evaluations and the closes since are owed
started = time.strftime('%Y-%m-%dT%H:%M:%S.000000000Z', time.gmtime(boot))
def expected():
    out = []
    for tf, sec in (('15m', 900), ('1h', 3600), ('4h', 14400)):
        c = int((boot - 360) // sec) * sec
        while c + 360 <= now - 300 + 120 or c == int((boot - 360) // sec) * sec:
            out.append((tf, c)); c += sec
    return out
oi = [{'tf': tf, 'bar_close': c, 'found': 0, 'sent': 0, 'at': c + 400} for tf, c in expected()]
def base():
    return {'bot': {'id': 'aaaaaaaaaaaa', 'restarts': 0, 'oom': False, 'state': 'running', 'started_at': started, 'started_epoch': boot},
            'mem': {'available_mb': 220, 'swap_mb': 100}, 'rss_mib': {'bot': 150.0, 'postgres': 270.0},
            'log': {'errors': 0, 'first_errors': [], 'cookie_lines': 0, 'oi': [dict(o) for o in oi]},
            'weight_1m': 25.0, 'build_sha': sha, 'healthz': {'ok': True, 'code': 200, 'url': 'https://x/healthz'},
            'db': {'eligible': 2, 'alerts': [], 'last_fired': None}, 'errors': []}
samples = []
for o in overrides:
    s = base()
    for path, v in o.items():
        d, keys = s, path.split('.')
        for k in keys[:-1]: d = d[k]
        d[keys[-1]] = v
    samples.append(s)
json.dump(samples, open('%s/%s.samples.json' % (work, name), 'w'))
PY
}

watch() { # $1 = case name; runs the watch to the end (interval 0) with the case's fixtures
  local d="$work/$1"
  mkdir -p "$d"; : >"$d/curl-args"; : >"$d/curl-stdin"
  set +e
  PATH="$work/bin:$PATH" WATCH_FAKE_SAMPLES="$work/$1.samples.json" WATCH_INTERVAL=0 WATCH_DIR="$d/out" \
    WATCH_ENV_FILE="$work/env" DEPLOY_DIR="$d" STUB_CURL_ARGS="$d/curl-args" STUB_CURL_STDIN="$d/curl-stdin" \
    python3 -I "$WATCH" watch --tag "sha-$SHA" --prev sha-aaaaaaaaaaaa --deploy-start "$(date +%s)" </dev/null >"$d/stdout" 2>"$d/stderr"
  echo $? >"$d/exit"
  set -e
}
verdict() { python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1]))["verdict"])' "$work/$1/out/$SHA.json"; }
sends() { wc -l <"$work/$1/curl-args" | tr -d ' '; }
case_is() { # $1 = name, $2 = overrides, $3 = expected verdict, $4 = expected messages
  fixtures "$1" "$2"
  watch "$1"
  check "$1: verdict $3" "[ \"\$(verdict '$1')\" = '$3' ]"
  check "$1: $4 message(s)" "[ \"\$(sends '$1')\" = '$4' ]"
}
G='{}'
seven() { python3 -I -c 'import sys; print("[" + ",".join(sys.argv[1:]) + "]")' "$@"; }

case_is clean "$(seven "$G" "$G" "$G" "$G" "$G" "$G" "$G")" CLEAN 0
check "clean: exit 0, 7 rows in the table" "[ \"\$(cat '$work/clean/exit')\" = 0 ] && [ \"\$(grep -c '^| [0-9][0-9]:' '$work/clean/out/$SHA.md')\" = 7 ]"
check "clean: no warnings (every owed OI evaluation was logged)" "grep -q '\"warnings\": \\[\\]' '$work/clean/out/$SHA.json'"
check "clean: footprint recorded" "grep -q 'max_rss_kb_self' '$work/clean/out/$SHA.json' && grep -q '^Footprint: max RSS' '$work/clean/out/$SHA.md'"

L='{"mem.available_mb": 99}'
H='{"mem.available_mb": 100}'
case_is mem-one "$(seven "$G" "$G" "$L" "$G" "$G" "$G" "$G")" CLEAN 0
case_is mem-two-adjacent "$(seven "$G" "$L" "$L" "$G" "$G" "$G" "$G")" ALARM:memory_low 1
check "mem-two-adjacent: the message names both figures and the rollback command" \
  "grep -q 'свободной памяти 99 и 99 МБ два замера подряд' '$work/mem-two-adjacent/curl-args' && grep -q 'Команда отката: /opt/insight-bot/deploy.sh sha-aaaaaaaaaaaa' '$work/mem-two-adjacent/curl-args'"
check "mem-two-adjacent: fired at t=10 (the second low sample), not t=5" "grep -q '\"sample\": 2' '$work/mem-two-adjacent/out/$SHA.json'"
case_is mem-two-apart "$(seven "$L" "$G" "$L" "$G" "$L" "$G" "$L")" CLEAN 0
case_is mem-exactly-100 "$(seven "$H" "$H" "$H" "$H" "$H" "$H" "$H")" CLEAN 0
case_is mem-low-throughout "$(seven "$L" "$L" "$L" "$L" "$L" "$L" "$L")" ALARM:memory_low 1

case_is swap-500 "$(seven "$G" '{"mem.swap_mb": 500}' "$G" "$G" "$G" "$G" "$G")" CLEAN 0
case_is swap-501 "$(seven "$G" '{"mem.swap_mb": 501}' "$G" "$G" "$G" "$G" "$G")" ALARM:swap_high 1

R='{"bot.restarts": 1, "bot.started_at": "2026-11-05T14:30:00.000000000Z"}'
case_is restart "$(seven "$G" "$G" "$R" "$R" "$R" "$R" "$R")" ALARM:restart 1
case_is oom "$(seven "$G" "$G" "$G" '{"bot.oom": true}' "$G" "$G" "$G")" ALARM:oom 1
case_is exited "$(seven "$G" "$G" "$G" "$G" '{"bot.state": "exited"}' "$G" "$G")" ALARM:container_not_running 1
case_is new-container "$(seven "$G" "$G" "$G" '{"bot.id": "bbbbbbbbbbbb"}' "$G" "$G" "$G")" ALARM:restart 1

F='{"healthz.ok": false, "healthz.code": 502}'
case_is healthz-one "$(seven "$G" "$G" "$G" "$F" "$G" "$G" "$G")" CLEAN 0
case_is healthz-two-adjacent "$(seven "$G" "$G" "$F" "$F" "$G" "$G" "$G")" ALARM:healthz_failed 1
case_is healthz-two-apart "$(seven "$F" "$G" "$F" "$G" "$F" "$G" "$F")" CLEAN 0
case_is healthz-unknown "$(seven '{"healthz.ok": null}' '{"healthz.ok": null}' "$G" "$G" "$G" "$G" "$G")" CLEAN 0

case_is cookie "$(seven "$G" "$G" "$G" "$G" "$G" "$G" '{"log.cookie_lines": 1}')" ALARM:raw_cookie 1
case_is build-sha "$(seven '{"build_sha": "ffffffffffff"}' "$G" "$G" "$G" "$G" "$G" "$G")" ALARM:build_sha_mismatch 1
case_is build-sha-missing "$(seven '{"build_sha": ""}' "$G" "$G" "$G" "$G" "$G" "$G")" ALARM:build_sha_mismatch 1

case_is two-reasons "$(seven "$G" '{"mem.swap_mb": 600}' '{"mem.swap_mb": 600, "mem.available_mb": 90}' '{"mem.available_mb": 90}' "$G" "$G" "$G")" ALARM:swap_high,memory_low 2

# Error lines and the Σ sent mismatch: warnings in the files, never an alarm, never a message.
case_is warnings "$(seven "$G" "$G" "$G" "$G" "$G" "$G" '{"log.errors": 2, "log.first_errors": ["boom", "bang"], "db.eligible": 2, "db.alerts": [{"id": 7, "recipients": 2}], "db.last_fired": 1}')" CLEAN 0
check "warnings: error lines and Σ sent mismatch listed; recipients == eligible is no over-send" \
  "grep -q 'error_lines: 2 (first: boom | bang)' '$work/warnings/out/$SHA.md' && grep -q 'Σ recipients 2 ≠ Σ «sent» 0' '$work/warnings/out/$SHA.md'"

# alert_oversend: recipients > eligible members → ALARM; == is the boundary (the warnings case above).
O='{"db.eligible": 1, "db.alerts": [{"id": 7, "recipients": 2}], "db.last_fired": 1}'
case_is oversend "$(seven "$G" "$G" "$G" "$O" "$O" "$O" "$O")" ALARM:alert_oversend 1
check "oversend: the message names the alert, both figures and the opt-out caveat" \
  "grep -q '№7 — 2; подписано 1' '$work/oversend/curl-args' && grep -q 'Если кто-то отписался за эти полчаса, тревога ложная' '$work/oversend/curl-args'"

# oi_loop_missing: an owed evaluation line absent → ALARM (once, though it stays missing).
case_is oi-missing "$(seven "$G" "$G" "$G" '{"log.oi": []}' '{"log.oi": []}' '{"log.oi": []}' '{"log.oi": []}')" ALARM:oi_loop_missing 1
check "oi-missing: the message names the owed evaluations" "grep -q 'цикл OI-сигналов молчит: нет проверки 15m за' '$work/oi-missing/curl-args' && grep -q '4h за' '$work/oi-missing/curl-args'"
check "oi-missing: OI_ALERTS_LOOP_ENABLED=false owes nothing → CLEAN" "[ \"\$(fixtures oi-off '[{\"log.oi\": []}, {\"log.oi\": []}, {}, {}, {}, {}, {}]'; d='$work/oi-off'; mkdir -p \$d; \
  printf \"OI_ALERTS_LOOP_ENABLED='false'\\n\" >\$d/env; PATH='$work/bin':\$PATH WATCH_FAKE_SAMPLES='$work/oi-off.samples.json' WATCH_INTERVAL=0 WATCH_DIR=\$d/out \
  WATCH_ENV_FILE=\$d/env DEPLOY_DIR=\$d STUB_CURL_ARGS=\$d/curl-args STUB_CURL_STDIN=\$d/curl-stdin python3 -I '$WATCH' watch --tag sha-$SHA </dev/null >/dev/null 2>&1; \
  python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1]))[\"verdict\"])' \$d/out/$SHA.json)\" = CLEAN ]"
check "oi-missing boundary (pure): boot 14:13:13, the 14:30 line absent → silent at 14:40:59, ALARM at 14:41:00; no 4h close owed" "[ \"\$(python3 -I - '$WATCH' <<'PY'
import importlib.util, sys
from datetime import datetime, timezone
spec = importlib.util.spec_from_file_location('w', sys.argv[1]); w = importlib.util.module_from_spec(spec); spec.loader.exec_module(w)
T = lambda h, m, s=0: datetime(2026, 11, 5, h, m, s, tzinfo=timezone.utc).timestamp()
boot = T(14, 13, 13)
oi = [{'tf': tf, 'bar_close': int(c), 'found': 0, 'sent': 0, 'at': None} for tf, c in (('15m', T(14, 0)), ('15m', T(14, 15)), ('1h', T(14, 0)), ('4h', T(12, 0)))]
s = [{'bot': {'id': 'a', 'state': 'running', 'restarts': 0, 'started_at': 'x', 'started_epoch': boot}, 'log': {'oi': oi, 'cookie_lines': 0}}]
print(sorted(w.alarms_at(s, 0, 'x', T(14, 40, 59)).keys() - {'build_sha_mismatch'}), sorted(w.alarms_at(s, 0, 'x', T(14, 41)).keys() - {'build_sha_mismatch'}))
PY
)\" = \"[] ['oi_loop_missing']\" ]"
case_is send-in-flight "$(seven "$G" "$G" "$G" "$G" "$G" "$G" '{"db.alerts": [{"id": 8, "recipients": 1}], "db.last_fired": 9999999999}')" CLEAN 0
check "send-in-flight: an alert newer than the last evaluation line is not a mismatch yet" "! grep -q 'oi_sent_mismatch' '$work/send-in-flight/out/$SHA.json'"

# The OI-loop expectation (gap 9): only closes whose evaluation + lag fall inside the window, plus the boot one.
check "OI expectation: boot 14:13:13, 30 min later → 15m 14:00/14:15/14:30, 1h 14:00, 4h 12:00 — no 4h close owed" "[ \"\$(python3 -I - '$WATCH' <<'PY'
import importlib.util, sys
from datetime import datetime, timezone
spec = importlib.util.spec_from_file_location('w', sys.argv[1]); w = importlib.util.module_from_spec(spec); spec.loader.exec_module(w)
boot = datetime(2026, 11, 5, 14, 13, 13, tzinfo=timezone.utc).timestamp()
print(' '.join('%s@%s' % (tf, w.utc(c)[11:16]) for tf, c in w.expected_evaluations(boot, boot + 1800)))
PY
)\" = '15m@14:00 15m@14:15 15m@14:30 1h@14:00 4h@12:00' ]"
check "OI expectation: the 14:30 close is owed only once its evaluation (14:36) + lag (5 min) has passed" "[ \"\$(python3 -I - '$WATCH' <<'PY'
import importlib.util, sys
from datetime import datetime, timezone
spec = importlib.util.spec_from_file_location('w', sys.argv[1]); w = importlib.util.module_from_spec(spec); spec.loader.exec_module(w)
boot = datetime(2026, 11, 5, 14, 13, 13, tzinfo=timezone.utc).timestamp()
t = datetime(2026, 11, 5, 14, 41, 0, tzinfo=timezone.utc).timestamp()
print(sum(1 for tf, c in w.expected_evaluations(boot, t - 1) if tf == '15m'), sum(1 for tf, c in w.expected_evaluations(boot, t) if tf == '15m'))
PY
)\" = '2 3' ]"

# SUPERSEDED, and «stopped» without a verdict: a slow watch (2 s between samples), signalled after its first sample.
slow() { # $1 = case name, $2 = overrides, $3 = write the marker first (yes|no)
  fixtures "$1" "$2"
  local d="$work/$1"
  mkdir -p "$d/out"; : >"$d/curl-args"; : >"$d/curl-stdin"
  PATH="$work/bin:$PATH" WATCH_FAKE_SAMPLES="$work/$1.samples.json" WATCH_INTERVAL=2 WATCH_DIR="$d/out" \
    WATCH_ENV_FILE="$work/env" DEPLOY_DIR="$d" STUB_CURL_ARGS="$d/curl-args" STUB_CURL_STDIN="$d/curl-stdin" \
    python3 -I "$WATCH" watch --tag "sha-$SHA" --prev sha-aaaaaaaaaaaa </dev/null >"$d/stdout" 2>"$d/stderr" &
  local pid=$!
  for _ in $(seq 1 50); do grep -q '"i": 0' "$d/out/$SHA.json" 2>/dev/null && break; sleep 0.1; done
  cp "$d/out/$SHA.json" "$d/after-first.json"
  [ "$3" = yes ] && echo sha-fedcba987654 >"$d/out/$SHA.superseded-by"
  kill -TERM "$pid"; wait "$pid" || true
}
slow superseded "$(seven '{"mem.swap_mb": 600}' "$G" "$G" "$G" "$G" "$G" "$G")" yes
check "files are written at every sample: after the first, 1 sample and no verdict" \
  "grep -q '\"verdict\": null' '$work/superseded/after-first.json' && [ \"\$(grep -c '\"i\": ' '$work/superseded/after-first.json')\" = 1 ]"
check "superseded: verdict SUPERSEDED although an alarm was pending" "[ \"\$(verdict superseded)\" = SUPERSEDED ]"
check "superseded: the alarm already sent stays sent (1 message, listed in the file)" \
  "[ \"\$(sends superseded)\" = 1 ] && grep -q '\"reason\": \"swap_high\"' '$work/superseded/out/$SHA.json'"
slow stopped "$(seven "$G" "$G" "$G" "$G" "$G" "$G" "$G")" no
check "stopped without a marker: no verdict (the waiter calls it watch_lost), state stopped" \
  "[ \"\$(verdict stopped)\" = None ] && grep -q '\"state\": \"stopped\"' '$work/stopped/out/$SHA.json'"

# The token: on curl's stdin only.
check "token: on curl's stdin (the -K config) in every case that sent" "grep -qF 'bot$TOKEN/sendMessage' '$work/mem-two-adjacent/curl-stdin'"
check "token: never in curl's argv, stdout, stderr or the files of any case" \
  "! grep -rqF '$TOKEN' $work/*/curl-args $work/*/stdout $work/*/stderr $work/*/out"
check "dry run: prints the message, never reads the token, never calls curl" "[ \"\$(PATH=\"$work/bin:\$PATH\" STUB_CURL_ARGS='$work/dry-args' \
  WATCH_ENV_FILE=/nonexistent python3 -I '$WATCH' notify-failed --tag sha-$SHA --prev sha-aaaaaaaaaaaa --step test --dry-run | grep -c 'would send')\" = 1 ] && [ ! -e '$work/dry-args' ]"
check "a telegram failure is logged with the token replaced" "[ \"\$(printf '#!/usr/bin/env bash\\ncat >/dev/null; echo \"curl: (6) $TOKEN\" >&2; exit 6\\n' >'$work/bin2-curl'; \
  mkdir -p '$work/bin2'; mv '$work/bin2-curl' '$work/bin2/curl'; chmod +x '$work/bin2/curl'; \
  PATH=\"$work/bin2:\$PATH\" WATCH_ENV_FILE='$work/env' python3 -I '$WATCH' notify-failed --tag sha-$SHA --prev unknown --step test 2>&1 | grep -c '<token>')\" = 1 ]"

# watch-wait.sh, the dev-side waiter: a stub `aws` answers every poll with the case's json line.
cat >"$work/bin/aws" <<'STUB'
#!/usr/bin/env bash
case "$*" in
  *send-command*) echo cmd-1 ;;
  *get-command-invocation*) case "$*" in *cat\ /var/log*) echo '# the md' ;; *) printf '%s\n\n' "$STUB_LINE" ;; esac ;; # --output text ends with a blank line
esac
STUB
printf '#!/usr/bin/env bash\nexit 0\n' >"$work/bin/sleep"
chmod +x "$work/bin/aws" "$work/bin/sleep"
waiter() { # $1 = json line, $2 = LOST_AFTER_S → "<exit> <last line>"
  set +e
  out="$(PATH="$work/bin:$PATH" STUB_LINE="$1" LOST_AFTER_S="$2" POLL_S=0 bash "$HERE/watch-wait.sh" "sha-$SHA" i-0123 2>&1 </dev/null)"
  echo "$? $(printf '%s\n' "$out" | grep '^watch-wait: ' | tail -n 1)"
  set -e
}
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
OLD="$(date -u -r $(( $(date +%s) - 2401 )) +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d @$(( $(date +%s) - 2401 )) +%Y-%m-%dT%H:%M:%SZ)"
check "waiter: CLEAN → exit 0" "[ \"\$(waiter '{\"verdict\":\"CLEAN\",\"alarms\":[],\"deploy_start\":\"$NOW\"}' 2400 | cut -c1)\" = 0 ]"
check "waiter: an alarm while the watch still runs → exit 1 at once" \
  "waiter '{\"verdict\":null,\"alarms\":[\"swap_high — x\"],\"deploy_start\":\"$NOW\"}' 2400 | grep -q '^1 watch-wait: ALARM (watch still running)'"
check "waiter: SUPERSEDED → exit 3" "[ \"\$(waiter '{\"verdict\":\"SUPERSEDED\",\"alarms\":[],\"deploy_start\":\"$NOW\"}' 2400 | cut -c1)\" = 3 ]"
check "waiter: no file 40 min on → ALARM:watch_lost, never written" "waiter '{\"missing\":true}' 0 | grep -q '^1 watch-wait: ALARM:watch_lost .*never written'"
check "waiter: running, no verdict, deploy started 40 min 1 s ago → ALARM:watch_lost, stopped mid-way" \
  "waiter '{\"verdict\":null,\"alarms\":[],\"samples\":3,\"deploy_start\":\"$OLD\"}' 2400 | grep -q '^1 watch-wait: ALARM:watch_lost .*stopped mid-way'"

[ "$fail" -eq 0 ] && echo "deploy-watch.test.sh: all passed" || { echo "deploy-watch.test.sh: FAILED"; exit 1; }
