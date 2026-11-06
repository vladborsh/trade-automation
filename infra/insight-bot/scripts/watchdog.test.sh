#!/usr/bin/env bash
# Offline check of watchdog.py (IB-149, the box's metric publisher) and log-secret-scan.py. Stub `docker`, `curl` and
# `aws` on PATH stand in for the box and CloudWatch; a fake /proc/meminfo. Runs anywhere with python3 >= 3.9; no
# Docker, no network, no AWS, no waiting.
#
#   bash infra/insight-bot/scripts/watchdog.test.sh
#
# Proves: a healthy box publishes exactly the contract's 16 metrics (ib149-150-metrics-contract.md) with the right
# reading for each, in ONE put-metric-data call to namespace InsightBot; each probe that fails omits its own datums
# (never a made-up number) and counts in ProbeFailures; a stale heartbeat, a mute venue, a late or disabled OI loop
# and a stopped bot read as such; a refused PutMetricData, an exception and a missing aws all exit 0 (never affects
# the bot); --dry-run calls no aws and writes nothing. The bands' sources are pinned to the bot's code. The secret
# scan counts each kind of leak and never prints a value.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
work="$(mktemp -d)"
main_pid=$$
cleanup() { # a pipeline subshell that dies (set -e) must not delete the work dir under the running suite
  [ "$(exec sh -c 'echo $PPID')" = "$main_pid" ] && [ -z "${KEEP:-}" ] && rm -rf "$work"; return 0
}
trap cleanup EXIT; [ -n "${KEEP:-}" ] && echo "work dir: $work"
fail=0
check() { if eval "$2"; then echo "ok   - $1"; else echo "FAIL - $1"; fail=1; fi; }

mkdir -p "$work/bin"
# docker: every answer is a file in $FX; an absent file is a failed command
cat >"$work/bin/docker" <<'STUB'
#!/usr/bin/env bash
echo "docker $*" >>"$FX/calls"
ans() { [ -f "$FX/$1" ] && cat "$FX/$1" || exit 1; }
case "$1 $2" in
  "compose ps") case "$4" in insight-bot) ans bot_id ;; postgres) ans pg_id ;; esac ;;
  "inspect --format") ans inspect ;;
  "stats --no-stream") ans stats ;;
  exec\ *) ans psql ;;
  logs\ *) ans logs ;;
  *) exit 1 ;;
esac
STUB
cat >"$work/bin/curl" <<'STUB'
#!/usr/bin/env bash
echo "curl $*" >>"$FX/calls"
for a in "$@"; do case "$a" in
  */metrics) [ -f "$FX/metrics" ] && cat "$FX/metrics" && exit 0; exit 7 ;;
  */healthz) cat "$FX/healthz"; exit 0 ;;
esac; done
exit 1
STUB
cat >"$work/bin/aws" <<'STUB'
#!/usr/bin/env bash
echo "aws $*" >>"$FX/aws-calls"
for a in "$@"; do case "$a" in file://*) cp "${a#file://}" "$FX/aws-batch.json" ;; esac; done
rc="$(cat "$FX/aws-rc" 2>/dev/null || echo 0)"
[ "$rc" = 0 ] || echo "An error occurred (AccessDenied) when calling the PutMetricData operation" >&2
exit "$rc"
STUB
chmod +x "$work/bin/"*

# a healthy box, as of the moment `box` runs; a case then edits $FX
box() { # $1 = case name
  FX="$work/$1"; rm -rf "$FX"; mkdir -p "$FX"; local now; now=$(date +%s); echo "$now" >"$FX/now"
  echo bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb >"$FX/bot_id"
  echo pppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppp >"$FX/pg_id"
  echo 'running|2|172.18.0.3 ' >"$FX/inspect"
  printf 'bbbbbbbbbbbb|151.2MiB / 1.8GiB\npppppppppppp|270MiB / 1.8GiB\n' >"$FX/stats"
  printf 'h|binance:forceOrder|%d\nh|bybit:allLiquidation|%d\nh|okx:liquidation-orders|%d\np|binance|35\np|bybit|12\n' \
    $((now - 20)) $((now - 25)) $((now - 30)) >"$FX/psql"
  local close=$(( (now - 400) / 900 * 900 ))
  python3 -I -c 'import sys,time; c=int(sys.argv[1]); t=lambda e: time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime(e))
print("{\"level\":30,\"msg\":\"oi alerts 15m @%s: 5 coins, 0 found (late 0), sent 0, skipped 0, controls 1, near-misses 0\"}" % t(c - 900))
print("{\"level\":30,\"msg\":\"oi alerts 1h @%s: 5 coins, 0 found (late 0), sent 0, skipped 0, controls 1, near-misses 0\"}" % t(c + 300))
print("{\"level\":30,\"msg\":\"oi alerts 15m @%s: 5 coins, 0 found (late 0), sent 0, skipped 0, controls 1, near-misses 0\"}" % t(c))' "$close" >"$FX/logs"
  echo "$close" >"$FX/close"
  printf '# HELP ib_binance_weight_used_1m x\nib_binance_weight_used_1m 27\nib_process_memory_bytes 1\n' >"$FX/metrics"
  echo 200 >"$FX/healthz"
  printf 'MemTotal: 948000 kB\nMemAvailable: 204800 kB\nSwapTotal: 2097148 kB\nSwapFree: 1892348 kB\n' >"$FX/meminfo"
  echo full >"$FX/monitoring-variant"
  printf "OI_ALERTS_LOOP_ENABLED='true'\nTELEGRAM_BOT_TOKEN='123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'\n" >"$FX/env"
}
publish() { # [--dry-run]; env: FX. Records the clock around the run: ages are bounded by it, never by a later `date`
  set +e
  date +%s >"$FX/t0"
  PATH="$work/bin:$PATH" FX="$FX" DEPLOY_DIR="$FX" WATCH_ENV_FILE="$FX/env" WATCH_MEMINFO="$FX/meminfo" \
    WATCH_HEALTHZ_URL=https://site.example/healthz WATCHDOG_LOG_DIR="$FX/log" \
    python3 -I "$HERE/watchdog.py" publish "$@" </dev/null >"$FX/stdout" 2>"$FX/stderr"
  echo $? >"$FX/exit"
  echo $(( $(date +%s) + 1 )) >"$FX/t1"
  set -e
}
# age_ok <value> <age at box time> <ref epoch file>: value ∈ [ref + age − box now … t1 − box now + age]
age_ok() { between "$1" $(( $(cat "$FX/t0") - $(cat "$FX/now") + $2 )) $(( $(cat "$FX/t1") - $(cat "$FX/now") + $2 )); }
# m <metric> [dim value] → the published value ('' when absent)
m() {
  python3 -I - "$FX/aws-batch.json" "$@" <<'PY'
import json, sys
b = json.load(open(sys.argv[1])); name = sys.argv[2]; dim = sys.argv[3] if len(sys.argv) > 3 else None
v = [d['Value'] for d in b if d['MetricName'] == name and (dim is None or any(x['Value'] == dim for x in d.get('Dimensions', [])))]
print(v[0] if len(v) == 1 else ('' if not v else 'MANY'))
PY
}
count() { python3 -I -c 'import json,sys; print(len(json.load(open(sys.argv[1]))))' "$FX/aws-batch.json"; }
between() { [ -n "$1" ] && python3 -I -c 'import sys; v,a,b=map(float,sys.argv[1:]); sys.exit(0 if a<=v<=b else 1)' "$1" "$2" "$3"; }

# ---------------------------------------------------------------------------------------------- a healthy box
box healthy; publish
check "healthy: exit 0, one aws call" '[ "$(cat "$FX/exit")" = 0 ] && [ "$(wc -l <"$FX/aws-calls" | tr -d " ")" = 1 ]'
check "  … put-metric-data, namespace InsightBot, region ap-northeast-1" \
  'grep -q "^aws cloudwatch put-metric-data --region ap-northeast-1 --namespace InsightBot --metric-data file://" "$FX/aws-calls"'
check "  … exactly the contract's 16 metrics" '[ "$(count)" = 16 ]'
check "  … the contract's names, dimensions and units, nothing else" "python3 -I - '$FX/aws-batch.json' <<'PY'
import json, sys
got = sorted((d['MetricName'], tuple((x['Name'], x['Value']) for x in d.get('Dimensions', [])), d['Unit']) for d in json.load(open(sys.argv[1])))
want = sorted([('PublisherAlive', (), 'Count'), ('ProbeFailures', (), 'Count'), ('MemAvailableMB', (), 'Megabytes'),
    ('SwapUsedMB', (), 'Megabytes'), ('ContainerRssMB', (('Container', 'bot'),), 'Megabytes'),
    ('ContainerRssMB', (('Container', 'postgres'),), 'Megabytes'), ('BotRestartCount', (), 'Count'), ('HealthzOk', (), 'Count'),
    ('OiEvalAgeSec', (), 'Seconds'), ('BinanceWeight1m', (), 'Count')]
    + [('LiqHeartbeatAgeSec', (('Venue', v),), 'Seconds') for v in ('binance', 'bybit', 'okx')]
    + [('LiqPrintsPerMin', (('Venue', v),), 'Count') for v in ('binance', 'bybit', 'okx')])
assert got == want, (got, want)
PY"
check "  … every datum carries the tick's timestamp" "python3 -I -c 'import json,sys; b=json.load(open(sys.argv[1])); assert len({d[\"Timestamp\"] for d in b})==1' '$FX/aws-batch.json'"
check "PublisherAlive 1, ProbeFailures 0" '[ "$(m PublisherAlive)" = 1 ] && [ "$(m ProbeFailures)" = 0 ]'
check "MemAvailableMB 200, SwapUsedMB 200 (from meminfo kB)" '[ "$(m MemAvailableMB)" = 200 ] && [ "$(m SwapUsedMB)" = 200 ]'
check "ContainerRssMB bot 151.2, postgres 270.0" '[ "$(m ContainerRssMB bot)" = 151.2 ] && [ "$(m ContainerRssMB postgres)" = 270.0 ]'
check "BotRestartCount 2, HealthzOk 1" '[ "$(m BotRestartCount)" = 2 ] && [ "$(m HealthzOk)" = 1 ]'
check "LiqHeartbeatAgeSec binance ≈20, bybit ≈25, okx ≈30" \
  'age_ok "$(m LiqHeartbeatAgeSec binance)" 20 && age_ok "$(m LiqHeartbeatAgeSec bybit)" 25 && age_ok "$(m LiqHeartbeatAgeSec okx)" 30'
check "LiqPrintsPerMin binance 7.0 (35 rows / 5 min), bybit 2.4, okx 0.0 (no rows = a real 0)" \
  '[ "$(m LiqPrintsPerMin binance)" = 7.0 ] && [ "$(m LiqPrintsPerMin bybit)" = 2.4 ] && [ "$(m LiqPrintsPerMin okx)" = 0.0 ]'
check "OiEvalAgeSec = now − the newest 15m close (a newer 1h line does not count)" \
  'age_ok "$(m OiEvalAgeSec)" $(( $(cat "$FX/now") - $(cat "$FX/close") ))'
check "BinanceWeight1m 27.0, read from the bot's /metrics on its container IP" \
  '[ "$(m BinanceWeight1m)" = 27.0 ] && grep -q "curl -sS --max-time 5 http://172.18.0.3:3005/metrics" "$FX/calls"'
check "the prints window is ts in [now−360, now−60) in the SQL" \
  "grep -q \"liquidations where venue in ('binance', 'bybit', 'okx') and ts >= to_timestamp\" '$FX/calls'"
check "no venue host is ever contacted (weight 0)" '! grep -Eqi "binance\.com|bybit\.com|okx\.com" "$FX/calls"'
check "last.json written: result ok, the batch, the footprint" \
  "python3 -I -c 'import json,sys; d=json.load(open(sys.argv[1])); assert d[\"result\"]==\"ok\" and len(d[\"batch\"])==16 and d[\"footprint\"][\"seconds\"]>=0 and d[\"venue_weight_per_min\"]==0' '$FX/log/last.json'"
check "the journal line says full: 16 datums, ok" 'grep -q "watchdog: full: 16 datums, put-metric-data ok$" "$FX/stdout"'

# ---------------------------------------------------------------------------------------------- the variant (IB-150 tofu)
box minimal; echo minimal >"$FX/monitoring-variant"; publish
check "minimal: exactly 9 datums — PublisherAlive, ProbeFailures, MemAvailableMB, SwapUsedMB, HealthzOk, LiqHeartbeatAgeSec×3, OiEvalAgeSec" \
  "python3 -I -c 'import json,sys; n=sorted(d[\"MetricName\"] for d in json.load(open(sys.argv[1]))); assert n==sorted([\"PublisherAlive\",\"ProbeFailures\",\"MemAvailableMB\",\"SwapUsedMB\",\"HealthzOk\",\"OiEvalAgeSec\"]+[\"LiqHeartbeatAgeSec\"]*3), n' '$FX/aws-batch.json'"
check "  … the other 7 are on the journal line, with their readings" \
  'grep -q "watchdog: minimal: 9 datums, put-metric-data ok; not published: ContainerRssMB{bot}=151.2 ContainerRssMB{postgres}=270.0 BotRestartCount=2 LiqPrintsPerMin{binance}=7.0 LiqPrintsPerMin{bybit}=2.4 LiqPrintsPerMin{okx}=0.0 BinanceWeight1m=27.0$" "$FX/stdout"'
check "  … and last.json keeps them (log_only), variant minimal" \
  "python3 -I -c 'import json,sys; d=json.load(open(sys.argv[1])); assert d[\"variant\"]==\"minimal\" and len(d[\"log_only\"])==7 and len(d[\"batch\"])==9' '$FX/log/last.json'"
box no-variant; rm "$FX/monitoring-variant"; publish
check "no variant file → minimal (tofu's default)" '[ "$(count)" = 9 ] && grep -q "watchdog: minimal:" "$FX/stdout"'
box odd-variant; echo FULL >"$FX/monitoring-variant"; publish
check "an unknown word → minimal" '[ "$(count)" = 9 ]'

# ---------------------------------------------------------------------------------------------- readings that go bad
box stale; now=$(cat "$FX/now"); sed -i.bak "s/^h|bybit:allLiquidation|.*/h|bybit:allLiquidation|$((now - 600))/" "$FX/psql"; publish
check "stale bybit heartbeat → LiqHeartbeatAgeSec bybit ≈600, the others fresh" \
  'age_ok "$(m LiqHeartbeatAgeSec bybit)" 600 && age_ok "$(m LiqHeartbeatAgeSec binance)" 20'
box no-row; sed -i.bak '/okx:liquidation-orders/d' "$FX/psql"; publish
check "no heartbeat row for okx → its age omitted (not 0), ProbeFailures 0" \
  '[ -z "$(m LiqHeartbeatAgeSec okx)" ] && [ "$(count)" = 15 ] && [ "$(m ProbeFailures)" = 0 ]'
box psql-down; rm "$FX/psql"; publish
check "psql fails → no Liq datums at all, ProbeFailures 1, PublisherAlive 1" \
  '[ -z "$(m LiqHeartbeatAgeSec binance)" ] && [ -z "$(m LiqPrintsPerMin binance)" ] && [ "$(count)" = 10 ] && [ "$(m ProbeFailures)" = 1 ] && [ "$(m PublisherAlive)" = 1 ]'
box bot-down; echo 'exited|2|' >"$FX/inspect"; echo 502 >"$FX/healthz"; publish
check "bot exited → HealthzOk 0, no BinanceWeight1m, OI age still read from its log, ProbeFailures 1 (metrics)" \
  '[ "$(m HealthzOk)" = 0 ] && [ -z "$(m BinanceWeight1m)" ] && [ -n "$(m OiEvalAgeSec)" ] && [ "$(m ProbeFailures)" = 1 ]'
box bot-missing; : >"$FX/bot_id"; publish
check "no bot container → HealthzOk still read; no restarts/weight/OI; failures: inspect, stats, logs, metrics" \
  '[ -n "$(m HealthzOk)" ] && [ -z "$(m BotRestartCount)" ] && [ -z "$(m BinanceWeight1m)" ] && [ -z "$(m OiEvalAgeSec)" ] && [ "$(m ProbeFailures)" = 4 ]'
box healthz-502; echo 502 >"$FX/healthz"; publish
check "healthz 502 → HealthzOk 0, ProbeFailures 0 (the reading, not a failed probe)" '[ "$(m HealthzOk)" = 0 ] && [ "$(m ProbeFailures)" = 0 ]'
box oi-silent; grep -v '15m' "$FX/logs" >"$FX/l"; mv "$FX/l" "$FX/logs"; publish
check "no 15m OI line in the 35-min lookback → OiEvalAgeSec 2100 (the floor)" '[ "$(m OiEvalAgeSec)" = 2100 ]'
check "  … the log is read --since now − 2100" "grep -Eq 'docker logs --since [0-9]+ b' '$FX/calls'"
box oi-off; sed -i.bak "s/OI_ALERTS_LOOP_ENABLED='true'/OI_ALERTS_LOOP_ENABLED='false'/" "$FX/env"; publish
check "OI loop off in .env → no OiEvalAgeSec, and the log is not read" '[ -z "$(m OiEvalAgeSec)" ] && ! grep -q "docker logs" "$FX/calls"'
box mem; printf 'MemAvailable: 112640 kB\nSwapTotal: 2097148 kB\nSwapFree: 1048572 kB\n' >"$FX/meminfo"; publish
check "memory low / swap high read as such: 110 MB, 1024 MB" '[ "$(m MemAvailableMB)" = 110 ] && [ "$(m SwapUsedMB)" = 1024 ]'
box meminfo-gone; rm "$FX/meminfo"; publish
check "meminfo unreadable → no memory datums, ProbeFailures 1" '[ -z "$(m MemAvailableMB)" ] && [ "$(m ProbeFailures)" = 1 ]'
box stats-gone; rm "$FX/stats"; publish
check "docker stats fails → no ContainerRssMB, ProbeFailures 1" '[ -z "$(m ContainerRssMB bot)" ] && [ "$(m ProbeFailures)" = 1 ]'

# ---------------------------------------------------------------------------------------------- never affects the bot
box refused; echo 254 >"$FX/aws-rc"; publish
check "PutMetricData refused (no IAM yet) → exit 0, logged, last.json says so" \
  '[ "$(cat "$FX/exit")" = 0 ] && grep -q "put-metric-data rc 254: An error occurred (AccessDenied)" "$FX/stdout" && grep -q "AccessDenied" "$FX/log/last.json"'
box no-aws; WATCHDOG_AWS="$work/no-such-aws" publish
check "no aws binary → exit 0, logged" '[ "$(cat "$FX/exit")" = 0 ] && grep -q "put-metric-data FileNotFoundError" "$FX/stdout"'
box crash; echo 'running|x|1.2.3.4 ' >"$FX/inspect"; publish
check "an exception in a tick → exit 0, nothing published (the dead-man sees it), logged" \
  '[ "$(cat "$FX/exit")" = 0 ] && [ ! -e "$FX/aws-calls" ] && grep -q "tick failed, nothing published: ValueError" "$FX/stdout"'
box dry; publish --dry-run
check "--dry-run: no aws call, no files, the batch printed" \
  '[ ! -e "$FX/aws-calls" ] && [ ! -e "$FX/log" ] && grep -q "\"MetricName\": \"PublisherAlive\"" "$FX/stdout" && grep -q "\"namespace\": \"InsightBot\"" "$FX/stdout"'
check "no output anywhere carries the .env's bot token" '! cat "$work"/*/stdout "$work"/*/stderr "$work"/*/log/* 2>/dev/null | grep -q "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"'

# ---------------------------------------------------------------------------------------------- pinned to the source
BOT="$REPO/apps/insight-bot/src"
check "heartbeat staleness source: STALE_AFTER_MS = HEARTBEAT_MS 30_000 × 4 (the contract's 120 s band)" \
  'grep -q "^export const HEARTBEAT_MS = 30_000;" "$BOT/collectors/uptime/uptime.recorder.ts" && grep -q "^export const STALE_AFTER_MS = HEARTBEAT_MS \* 4;" "$BOT/collectors/uptime/uptime.recorder.ts"'
check "stream ids = the collectors' heartbeat ids" \
  'grep -q "BINANCE_LIQUIDATION_STREAM = '"'"'binance:forceOrder'"'"'" "$BOT/collectors/uptime/liquidation-streams.ts" && grep -q "STREAM_LIQUIDATION = '"'"'bybit:allLiquidation'"'"'" "$BOT/collectors/bybit/bybit-collector.ts" && grep -q "STREAM_LIQUIDATION = '"'"'okx:liquidation-orders'"'"'" "$BOT/collectors/okx/okx-collector.ts"'
check "the bot's documented OI line parses as a 15m close (deploy-watch's OI_LINE)" "python3 -I - '$HERE' '$BOT/delivery/oi-alerts.service.ts' <<'PY'
import importlib.util, re, sys
spec = importlib.util.spec_from_file_location('dw', sys.argv[1] + '/deploy-watch.py'); dw = importlib.util.module_from_spec(spec); spec.loader.exec_module(dw)
line = re.search(r'«(oi alerts 15m @[^»]+)»', open(sys.argv[2]).read()).group(1)
assert [o['tf'] for o in dw.scan_log('{\"level\":30,\"msg\":\"%s\"}' % line)['oi']] == ['15m']
PY"
check "the weight gauge name = the bot's" 'grep -q "name: '"'"'ib_binance_weight_used_1m'"'"'" "$BOT/ops/metrics.service.ts"'
check "the bot listens on 3005 (compose PORT)" "grep -q \"PORT: '3005'\" '$HERE/../compose/docker-compose.yml'"
UNIT="$HERE/../systemd"
check "systemd: every 5 min, the synced path, publish" \
  'grep -q "^OnCalendar=\*:0/5:30$" "$UNIT/insight-watchdog.timer" && grep -q "^ExecStart=/usr/bin/python3 -I /opt/insight-bot/watchdog.py publish$" "$UNIT/insight-watchdog.service"'
check "sync-box carries watchdog.py, both units, the awslogs override (inert name) and the scanner" \
  '( for s in "scripts/watchdog.py:/opt/insight-bot/watchdog.py:0755" "systemd/insight-watchdog.service:" "systemd/insight-watchdog.timer:" "compose/logging-awslogs.yml:/opt/insight-bot/logging-awslogs.yml:0644" "scripts/log-secret-scan.py:/opt/insight-bot/log-secret-scan.py:0755"; do grep -qF "$s" "$HERE/sync-box.sh" || exit 1; done ) && ! grep -q "docker-compose.override" "$HERE/sync-box.sh"'
check "awslogs override: three groups, non-blocking, no create-group" \
  'f="$HERE/../compose/logging-awslogs.yml"; grep -q "awslogs-group: /insight-bot/bot$" "$f" && grep -q "awslogs-group: /insight-bot/postgres$" "$f" && grep -q "awslogs-group: /insight-bot/caddy$" "$f" && grep -q "mode: non-blocking" "$f" && grep -q "awslogs-create-group: '"'"'false'"'"'" "$f"'

# ---------------------------------------------------------------------------------------------- the secret scan
S="$work/scan"; mkdir -p "$S/logs"
printf "TELEGRAM_BOT_TOKEN='987654321:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'\nPOSTGRES_PASSWORD='pg-pass-value-xyz'\nWEB_BASE_URL='https://x'\nSHORT_KEY='abc'\n" >"$S/.env"
printf "TUNNEL_TOKEN='cf-tunnel-token-value-123'\n" >"$S/cloudflared.env"
scan() { set +e; DEPLOY_DIR="$S" SECRET_SCAN_LOGS_DIR="$S/logs" python3 -I "$HERE/log-secret-scan.py" >"$S/out" 2>&1; echo $? >"$S/exit"; set -e; }
printf '{"level":30,"msg":"ok"}\ncookie ib_session=[Redacted]\n' >"$S/logs/insight-bot.log"; : >"$S/logs/postgres.log"; : >"$S/logs/caddy.log"
scan
check "secret scan, clean logs → exit 0, TOTAL 0, 3 secret-named keys (short and non-secret keys skipped)" \
  '[ "$(cat "$S/exit")" = 0 ] && grep -q "^TOTAL 0$" "$S/out" && grep -q "3 secret-named keys" "$S/out" && ! grep -q "WEB_BASE_URL\|SHORT_KEY" "$S/out"'
printf 'sent with 987654321:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB\nib_session=abcdef123\n' >"$S/logs/insight-bot.log"
printf 'password pg-pass-value-xyz and postgres://insight:pw@postgres:5432/x\n' >"$S/logs/postgres.log"
printf 'tok cf-tunnel-token-value-123 AKIAABCDEFGHIJKLMNOP 111111111:CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC\n' >"$S/logs/caddy.log"
scan
check "secret scan, leaks → exit 1, each counted where it is" "python3 -I - '$S/out' <<'PY'
import sys
rows = [l.strip().strip('|').split('|') for l in open(sys.argv[1]).read().splitlines() if l.startswith('|') and not l.startswith('|---')]
head = [h.strip() for h in rows[0]]; t = {r[0].strip(): dict(zip(head, [x.strip() for x in r])) for r in rows[1:]}
assert t['insight-bot']['value:TELEGRAM_BOT_TOKEN'] == '1' and t['insight-bot']['bot_token'] == '1' and t['insight-bot']['ib_session'] == '1', t
assert t['postgres']['value:POSTGRES_PASSWORD'] == '1' and t['postgres']['pg_url_pass'] == '1', t
assert t['caddy']['value:TUNNEL_TOKEN'] == '1' and t['caddy']['aws_key'] == '1' and t['caddy']['bot_token'] == '1', t
PY
[ \"\$(cat '$S/exit')\" = 1 ]"
check "secret scan never prints a value" '! grep -q "BBBBBBBB\|pg-pass-value\|cf-tunnel-token\|AKIAABCD\|abcdef123" "$S/out"'

echo
[ "$fail" -eq 0 ] && echo "watchdog.test.sh: all passed" || { echo "watchdog.test.sh: FAILURES"; exit 1; }
