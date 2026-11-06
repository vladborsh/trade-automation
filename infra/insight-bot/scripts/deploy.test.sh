#!/usr/bin/env bash
# Offline check of deploy.sh's health wait (WD-011): stub `aws`/`docker`/`sleep` stand in for the
# box, and the probe deploy.sh hands to `docker compose exec` is run by the real `node` against a
# local server playing the app. Runs anywhere with node >= 18 (fetch); no AWS, no Docker.
#
#   bash infra/insight-bot/scripts/deploy.test.sh
#
# Asserts that deploy.sh reports HEALTHY (exit 0) when /healthz answers 200, and UNHEALTHY (exit 1,
# "did not answer") when /healthz is a 404 even if /health answers 200 (the image lost the route;
# /health is the SPA now), when it is a 500, and when nothing listens. Also that it probes
# /healthz and nothing else, and that a rollback to a pre-WD-011 image (whose SPA fallback answers
# /healthz with index.html) still counts as healthy.
#
# IB-139: that a healthy deploy launches the watch through WATCH_LAUNCHER with the exact line (unit
# name, the previous tag read from .env BEFORE render-env rewrites it, the deploy start) and sends
# nothing; that a running watch is marked superseded and stopped by unit name first; that a failed
# deploy sends the owner exactly one message carrying the rollback command, with the token only on
# curl's stdin — never in its argv, deploy.sh's output, or the launch line.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"
server_pid=""
cleanup() { [ -n "$server_pid" ] && kill "$server_pid" 2>/dev/null || true; rm -rf "$work"; }
trap cleanup EXIT
fail=0
check() { if eval "$2"; then echo "ok   - $1"; else echo "FAIL - $1"; fail=1; fi; }

mkdir -p "$work/bin"
cat >"$work/bin/aws" <<'STUB'
#!/usr/bin/env bash
case "$*" in
  *get-caller-identity*) echo 123456789012 ;;
  *get-login-password*) echo not-a-password ;;
esac
STUB
# `docker compose exec -T insight-bot node -e <probe>` runs the probe with the real node, pointed at
# the fake app; every other docker call succeeds silently.
cat >"$work/bin/docker" <<'STUB'
#!/usr/bin/env bash
if [ "${1:-}" = compose ] && [ "${2:-}" = exec ] && [ "${4:-}" = caddy ]; then
  # IB-142: `docker compose exec -T caddy caddy reload …` — the args and the Caddyfile on stdin are recorded
  echo "$*" >>"$STUB_CADDY"
  cat >>"$STUB_CADDY"
  [ "${STUB_CADDY_RELOAD:-ok}" = ok ]
  exit
fi
if [ "${1:-}" = compose ] && [ "${2:-}" = exec ]; then
  shift 2
  while [ "$1" != node ]; do shift; done
  shift # node
  [ "$1" = -e ] && shift
  probe="${1//127.0.0.1:3005/127.0.0.1:${STUB_PORT}}"
  echo "$1" >>"$STUB_PROBES"
  exec node -e "$probe"
fi
[ "${1:-}" = login ] && cat >/dev/null # docker login reads the password from stdin
exit 0
STUB
printf '#!/usr/bin/env bash\nexit 0\n' >"$work/bin/sleep"
# IB-139 stubs: curl (the Telegram send), systemctl (one running watch when STUB_ACTIVE_WATCH is set),
# and the WATCH_LAUNCHER that stands in for systemd-run.
cat >"$work/bin/curl" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$STUB_CURL_ARGS"
cat >>"$STUB_CURL_STDIN"
echo '{"ok":true,"result":{}}'
STUB
cat >"$work/bin/systemctl" <<'STUB'
#!/usr/bin/env bash
echo "systemctl $*" >>"$STUB_LAUNCH"
if [ "${1:-}" = list-units ] && [ -n "${STUB_ACTIVE_WATCH:-}" ]; then
  echo "${STUB_ACTIVE_WATCH} loaded active running /usr/bin/python3 -I /opt/insight-bot/deploy-watch.py"
fi
exit 0
STUB
cat >"$work/launcher" <<'STUB'
#!/usr/bin/env bash
echo "LAUNCH $*" >>"$STUB_LAUNCH"
STUB
chmod +x "$work/bin/aws" "$work/bin/docker" "$work/bin/sleep" "$work/bin/curl" "$work/bin/systemctl" "$work/launcher"
TOKEN='123456:FAKE-token_never-printed'

# The fake app. MODE: new (WD-011+), lost-route, error, old (pre-WD-011 image with the SPA bundle).
cat >"$work/app.js" <<'APP'
const http = require('node:http');
const fs = require('node:fs');
const [mode, portFile, logFile] = process.argv.slice(2);
const html = (res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html>'); };
http.createServer((req, res) => {
  fs.appendFileSync(logFile, `${req.url}\n`);
  if (req.url === '/healthz') {
    if (mode === 'new') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"status":"ok"}'); }
    if (mode === 'error') { res.writeHead(500); return res.end(); }
    if (mode === 'old') return html(res); // the SPA fallback answered it before WD-011
    res.writeHead(404); return res.end('{"message":"Cannot GET /healthz"}');
  }
  if (req.url === '/health') return html(res); // the dashboard's page since WD-011
  res.writeHead(404); res.end();
}).listen(0, '127.0.0.1', function () { fs.writeFileSync(portFile, String(this.address().port)); });
APP

run() { # $1 = case name, $2 = app mode or "none", $3 = previous IMAGE in .env (optional), $4 = a running watch unit (optional)
  # IB-142: CADDY=ok|fail → the box has caddy.env with SITE_ADDRESS (caddy runs) and the reload succeeds or fails
  local dir="$work/$1"
  mkdir -p "$dir/box/pgdata"
  : >"$dir/caddy"
  if [ -n "${CADDY:-}" ]; then
    echo "SITE_ADDRESS='1-2-3-4.sslip.io'" >"$dir/box/caddy.env"
    printf '{$SITE_ADDRESS} {\n\tencode zstd gzip\n}\n' >"$dir/box/Caddyfile"
  fi
  # like the real one: rewrites .env from SSM, so IMAGE= is gone after it
  cat >"$dir/box/render-env.sh" <<RENDER
#!/usr/bin/env bash
printf "POSTGRES_PASSWORD='x'\nTELEGRAM_BOT_TOKEN='${TOKEN}'\nTELEGRAM_SERVICE_CHAT_ID='-1001'\n" >"\$DEPLOY_DIR/.env"
RENDER
  chmod +x "$dir/box/render-env.sh"
  [ -n "${3:-}" ] && printf "POSTGRES_PASSWORD='x'\nIMAGE='%s'\n" "$3" >"$dir/box/.env"
  cp "$HERE/deploy-watch.py" "$dir/box/deploy-watch.py"
  : >"$dir/requests"; : >"$dir/probes"; : >"$dir/curl-args"; : >"$dir/curl-stdin"; : >"$dir/launch"
  local port
  if [ "$2" = none ]; then
    port=$(node -e 'const s=require("net").createServer().listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')
  else
    node "$work/app.js" "$2" "$dir/port" "$dir/requests" & server_pid=$!
    for _ in $(seq 1 50); do [ -s "$dir/port" ] && break; command sleep 0.1; done
    port="$(cat "$dir/port")"
  fi
  set +e
  PATH="$work/bin:$PATH" DEPLOY_DIR="$dir/box" STUB_PORT="$port" STUB_PROBES="$dir/probes" \
    STUB_CURL_ARGS="$dir/curl-args" STUB_CURL_STDIN="$dir/curl-stdin" STUB_LAUNCH="$dir/launch" \
    STUB_ACTIVE_WATCH="${4:-}" STUB_CADDY="$dir/caddy" STUB_CADDY_RELOAD="${CADDY:-ok}" WATCH_LAUNCHER="$work/launcher" WATCH_DIR="$dir/watch" \
    bash "$HERE/deploy.sh" sha-0123456789ab >"$dir/out" 2>&1
  echo $? >"$dir/exit"
  set -e
  if [ -n "$server_pid" ]; then kill "$server_pid" 2>/dev/null || true; wait "$server_pid" 2>/dev/null || true; server_pid=""; fi
}

PREV=123456789012.dkr.ecr.ap-northeast-1.amazonaws.com/insight-bot:sha-aaaaaaaaaaaa
run healthy new "$PREV"
check "healthy: /healthz 200 → exit 0" "[ \"\$(cat '$work/healthy/exit')\" = 0 ]"
check "healthy: prints 'healthy on'" "grep -q 'deploy.sh: healthy on .*insight-bot:sha-0123456789ab' '$work/healthy/out'"
check "healthy: probed /healthz only, never /health" \
  "grep -qx '/healthz' '$work/healthy/requests' && ! grep -qx '/health' '$work/healthy/requests'"
check "healthy: the probe text names /healthz" "grep -q '127.0.0.1:3005/healthz\"' '$work/healthy/probes'"

check "healthy: launches the watch with the exact line (previous tag read before render-env)" \
  "grep -qxF \"LAUNCH --unit insight-watch-0123456789ab --collect --quiet -p MemoryMax=128M -p Nice=10 --setenv=DEPLOY_DIR=$work/healthy/box --setenv=WATCH_DIR=$work/healthy/watch /usr/bin/python3 -I $work/healthy/box/deploy-watch.py watch --tag sha-0123456789ab --prev sha-aaaaaaaaaaaa --deploy-start \" <(sed -E 's/[0-9]+$//' '$work/healthy/launch')"
check "healthy: the deploy start is an epoch" "grep -qE -- '--deploy-start [0-9]{10}$' '$work/healthy/launch'"
check "healthy: launched once, after 'healthy on'" \
  "[ \"\$(grep -c '^LAUNCH' '$work/healthy/launch')\" = 1 ] && grep -q 'starting the 30-min watch insight-watch-0123456789ab' '$work/healthy/out'"
check "healthy: no running watch → nothing stopped, no marker" \
  "! grep -q 'systemctl stop' '$work/healthy/launch' && [ ! -d '$work/healthy/watch' ]"
check "healthy: no Telegram message" "[ ! -s '$work/healthy/curl-args' ]"

run supersede new "$PREV" insight-watch-bbbbbbbbbbbb.service
check "supersede: the running watch gets a marker naming the new tag" \
  "[ \"\$(cat '$work/supersede/watch/bbbbbbbbbbbb.superseded-by')\" = sha-0123456789ab ]"
check "supersede: stopped by unit name, before the new launch" \
  "[ \"\$(grep -n -e 'systemctl stop insight-watch-bbbbbbbbbbbb.service' -e '^LAUNCH' '$work/supersede/launch' | cut -d: -f1 | tr '\n' ' ')\" = '2 3 ' ]"

run first-deploy new
check "no IMAGE in .env before (first deploy): --prev unknown" "grep -q -- '--prev unknown ' '$work/first-deploy/launch'"

run lost-route lost-route "$PREV"
check "route lost: no watch launched" "! grep -q '^LAUNCH' '$work/lost-route/launch'"
check "route lost: exactly one message to the owner" "[ \"\$(wc -l <'$work/lost-route/curl-args' | tr -d ' ')\" = 1 ]"
check "route lost: the message says what failed and the rollback command" \
  "grep -q 'не удалась (/healthz did not answer within 150 s)' '$work/lost-route/curl-args' && grep -q 'Команда отката: /opt/insight-bot/deploy.sh sha-aaaaaaaaaaaa' '$work/lost-route/curl-args'"
check "route lost: the token is on curl's stdin only" \
  "grep -qF '$TOKEN' '$work/lost-route/curl-stdin' && ! grep -qF '$TOKEN' '$work/lost-route/curl-args' && ! grep -qF '$TOKEN' '$work/lost-route/out'"
check "route lost: still exit 1 (the message does not mask the failure)" "[ \"\$(cat '$work/lost-route/exit')\" = 1 ]"
check "route lost (/healthz 404, /health 200): exit 1" "[ \"\$(cat '$work/lost-route/exit')\" = 1 ]"
check "route lost: says /healthz did not answer" "grep -q '/healthz did not answer within 150 s' '$work/lost-route/out'"
check "route lost: retried 30 times" "[ \"\$(grep -cx '/healthz' '$work/lost-route/requests')\" = 30 ]"

run error error
check "/healthz 500: exit 1" "[ \"\$(cat '$work/error/exit')\" = 1 ]"

run down none
check "nothing listening: exit 1" "[ \"\$(cat '$work/down/exit')\" = 1 ]"
check "nothing listening: says /healthz did not answer" "grep -q '/healthz did not answer' '$work/down/out'"

run rollback old
check "rollback to a pre-WD-011 image (SPA answers /healthz): still healthy" "[ \"\$(cat '$work/rollback/exit')\" = 0 ]"

check "no caddy.env (caddy not run): no reload" "[ ! -s '$work/healthy/caddy' ] && ! grep -q 'caddy reload' '$work/healthy/out'"

# IB-142: with caddy running, the synced Caddyfile goes to `caddy reload` on stdin (the container's own copy is
# the old inode), before the health wait; a reload Caddy refuses fails the deploy: no watch, one message.
CADDY=ok run caddy-reload new "$PREV"
check "caddy: reload through compose exec, config on stdin, caddyfile adapter" \
  "grep -qxF 'compose exec -T caddy caddy reload --config /dev/stdin --adapter caddyfile' '$work/caddy-reload/caddy'"
check "caddy: the box's Caddyfile is what went in" "grep -qF 'encode zstd gzip' '$work/caddy-reload/caddy'"
check "caddy: reloaded once, then healthy and watched" \
  "[ \"\$(grep -c 'caddy reload' '$work/caddy-reload/caddy')\" = 1 ] && [ \"\$(cat '$work/caddy-reload/exit')\" = 0 ] && grep -q '^LAUNCH' '$work/caddy-reload/launch'"
check "caddy: the reload comes before the health wait" \
  "[ \"\$(grep -n -e '==> caddy reload' -e '==> waiting for /healthz' '$work/caddy-reload/out' | cut -d: -f2 | tr '\n' '|')\" = '==> caddy reload (the synced Caddyfile, graceful)|==> waiting for /healthz|' ]"
CADDY=fail run caddy-refused new "$PREV"
check "caddy refused: 3 tries, exit 1, no watch" \
  "[ \"\$(grep -c 'caddy reload' '$work/caddy-refused/caddy')\" = 3 ] && [ \"\$(cat '$work/caddy-refused/exit')\" = 1 ] && ! grep -q '^LAUNCH' '$work/caddy-refused/launch'"
check "caddy refused: one message naming the step" \
  "[ \"\$(wc -l <'$work/caddy-refused/curl-args' | tr -d ' ')\" = 1 ] && grep -q 'caddy reload (Caddy keeps serving its previous config)' '$work/caddy-refused/curl-args'"

check "no case printed the token" "! grep -rqF '$TOKEN' $work/*/out $work/*/launch $work/*/curl-args"

[ "$fail" -eq 0 ] && echo "deploy.test.sh: all passed" || { echo "deploy.test.sh: FAILED"; exit 1; }
