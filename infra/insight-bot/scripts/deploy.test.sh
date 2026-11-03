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
chmod +x "$work/bin/aws" "$work/bin/docker" "$work/bin/sleep"

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

run() { # $1 = case name, $2 = app mode or "none"
  local dir="$work/$1"
  mkdir -p "$dir/box/pgdata"
  printf '#!/usr/bin/env bash\necho "POSTGRES_PASSWORD=x" >"$DEPLOY_DIR/.env"\n' >"$dir/box/render-env.sh"; chmod +x "$dir/box/render-env.sh"
  : >"$dir/requests"; : >"$dir/probes"
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
    bash "$HERE/deploy.sh" sha-0123456789ab >"$dir/out" 2>&1
  echo $? >"$dir/exit"
  set -e
  if [ -n "$server_pid" ]; then kill "$server_pid" 2>/dev/null || true; wait "$server_pid" 2>/dev/null || true; server_pid=""; fi
}

run healthy new
check "healthy: /healthz 200 → exit 0" "[ \"\$(cat '$work/healthy/exit')\" = 0 ]"
check "healthy: prints 'healthy on'" "grep -q 'deploy.sh: healthy on .*insight-bot:sha-0123456789ab' '$work/healthy/out'"
check "healthy: probed /healthz only, never /health" \
  "grep -qx '/healthz' '$work/healthy/requests' && ! grep -qx '/health' '$work/healthy/requests'"
check "healthy: the probe text names /healthz" "grep -q '127.0.0.1:3005/healthz\"' '$work/healthy/probes'"

run lost-route lost-route
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

[ "$fail" -eq 0 ] && echo "deploy.test.sh: all passed" || { echo "deploy.test.sh: FAILED"; exit 1; }
