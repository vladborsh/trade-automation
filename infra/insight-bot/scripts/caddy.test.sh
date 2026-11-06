#!/usr/bin/env bash
# IB-142 — the box's Caddyfile, run in the box's own Caddy image (the digest pinned in compose/docker-compose.yml),
# in front of a local fake app. Needs Docker and node >= 23.8 (zlib zstd); no AWS, no box.
#
#   bash infra/insight-bot/scripts/caddy.test.sh
#
# Asserts that compression stays on: API JSON and the JS bundle come back zstd for a browser's Accept-Encoding,
# gzip for gzip-only, identity with no Accept-Encoding, and decode to the app's exact bytes; the app's headers
# (Cache-Control: immutable) pass through; /healthz still answers {"status":"ok"}; /metrics is still Caddy's
# 404 and never reaches the app; a streamed answer (SSE, chunked JSON) still reaches the client before the
# app finishes it. And that deploy.sh's apply path works: `caddy reload --config /dev/stdin` from the previous
# Caddyfile (no encode) to this one leaves no gap (every request is a 200, save a rare reset of one in flight at the
# reload instant — see the reload case), and a Caddyfile that does not adapt is refused while the old config serves.
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)" # infra/insight-bot
command -v docker >/dev/null && docker info >/dev/null 2>&1 || { echo "caddy.test.sh: needs a running Docker" >&2; exit 2; }
node -e 'process.exit(require("zlib").createZstdDecompress ? 0 : 1)' || { echo "caddy.test.sh: needs node with zlib zstd (>= 23.8)" >&2; exit 2; }
IMAGE="$(sed -n 's/^ *image: \(caddy:[^ ]*\)$/\1/p' "$HERE/compose/docker-compose.yml")"
case "$IMAGE" in caddy:*@sha256:*) ;; *) echo "caddy.test.sh: no pinned caddy image in docker-compose.yml" >&2; exit 2 ;; esac

work="$(mktemp -d)"
name="caddy-test-$$"
app_pid=""
cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; [ -n "$app_pid" ] && { kill "$app_pid"; wait "$app_pid"; } 2>/dev/null || true; rm -rf "$work"; }
trap cleanup EXIT
fail=0
check() { if eval "$2"; then echo "ok   - $1"; else echo "FAIL - $1"; fail=1; fi; }

# The fake app: big JSON (the /kpis shape), a JS bundle with the app's immutable Cache-Control, /healthz, a
# /metrics that must never be reached, and two streams that finish 2 s after their first write.
cat >"$work/app.js" <<'APP'
const http = require('node:http');
const fs = require('node:fs');
const [portFile, logFile] = process.argv.slice(2);
const json = JSON.stringify({ history: Array.from({ length: 2016 }, (_, i) => ({ time: 1793000000 + i * 600, value: 56 + Math.sin(i) * 3.123456789 })) });
const js = 'export function f(a){return a.map(x=>x*2)}\n'.repeat(3000);
http.createServer((req, res) => {
  fs.appendFileSync(logFile, `${req.url}\n`);
  if (req.url === '/healthz') { res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' }); return res.end('{"status":"ok"}'); }
  if (req.url === '/metrics') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ib_binance_weight_used_1m 1\n'); }
  if (req.url === '/main-TEST.js') {
    res.writeHead(200, { 'content-type': 'application/javascript; charset=UTF-8', 'cache-control': 'public, max-age=31536000, immutable' });
    return res.end(js);
  }
  if (req.url === '/sse' || req.url === '/chunked') {
    res.writeHead(200, { 'content-type': req.url === '/sse' ? 'text/event-stream' : 'application/json' });
    res.write(req.url === '/sse' ? 'data: first\n\n' : '[' + '1,'.repeat(400));
    return setTimeout(() => res.end(req.url === '/sse' ? 'data: last\n\n' : '1]'), 2000);
  }
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
  res.end(json);
}).listen(0, '0.0.0.0', function () {
  fs.writeFileSync(`${portFile}.json`, json); fs.writeFileSync(`${portFile}.js`, js);
  fs.writeFileSync(portFile, String(this.address().port));
});
APP
: >"$work/requests"
node "$work/app.js" "$work/port" "$work/requests" & app_pid=$!
for _ in $(seq 1 50); do [ -s "$work/port" ] && break; sleep 0.1; done
app_port="$(cat "$work/port")"

# The client: one request, decoded the way a browser does; prints status, encoding, bytes on the wire,
# sha256 of the decoded body, Cache-Control, and ms to the first decoded byte / to the end.
cat >"$work/get.js" <<'GET'
const http = require('node:http'); const zlib = require('node:zlib'); const crypto = require('node:crypto');
const [port, path, ae] = process.argv.slice(2);
const t0 = Date.now();
const headers = ae ? { 'accept-encoding': ae } : {};
http.get({ host: '127.0.0.1', port, path, headers }, (r) => {
  const enc = r.headers['content-encoding'] || 'identity';
  let wire = 0; r.on('data', (c) => { wire += c.length; });
  const dec = enc === 'gzip' ? zlib.createGunzip() : enc === 'zstd' ? zlib.createZstdDecompress() : null;
  const s = dec ? r.pipe(dec) : r; const h = crypto.createHash('sha256'); let first = -1;
  s.on('data', (c) => { if (first < 0) first = Date.now() - t0; h.update(c); });
  s.on('end', () => console.log([r.statusCode, enc, wire, h.digest('hex'), (r.headers['cache-control'] || '-').replace(/\s+/g, ''), first, Date.now() - t0].join(' ')));
}).on('error', (e) => { console.log('ERR ' + e.code); });
GET
sha() { node -e 'process.stdout.write(require("crypto").createHash("sha256").update(require("fs").readFileSync(process.argv[1])).digest("hex"))' "$1"; }
JSON_SHA="$(sha "$work/port.json")"; JS_SHA="$(sha "$work/port.js")"
get() { node "$work/get.js" "$caddy_port" "$1" "${2:-}"; }
field() { echo "$1" | cut -d' ' -f"$2"; }
CHROME='gzip, deflate, br, zstd'

# Caddy reads only SITE_ADDRESS and UPSTREAM from its env; http on :8080 here, so no certificate is involved.
cp "$HERE/compose/Caddyfile" "$work/Caddyfile"
grep -v '^\s*encode ' "$HERE/compose/Caddyfile" >"$work/Caddyfile.plain" # the box before IB-142
docker run -d --name "$name" -p 127.0.0.1::8080 --add-host=host.docker.internal:host-gateway \
  -e SITE_ADDRESS='http://:8080' -e UPSTREAM="host.docker.internal:${app_port}" \
  -v "$work/Caddyfile.plain:/etc/caddy/Caddyfile:ro" "$IMAGE" >/dev/null
caddy_port="$(docker port "$name" 8080/tcp | head -n 1 | sed 's/.*://')"
for _ in $(seq 1 50); do [ "$(field "$(get /healthz)" 1)" = 200 ] && break; sleep 0.2; done

before="$(get /api/web/market/kpis "$CHROME")"
check "before (no encode): the JSON is identity — the control: this test can tell the two apart" "[ '$(field "$before" 2)' = identity ]"

reload() { docker exec -i "$name" caddy reload --config /dev/stdin --adapter caddyfile <"$1" >/dev/null 2>&1; }
check "reload to the repo's Caddyfile (deploy.sh's command)" "reload '$work/Caddyfile'"

r="$(get /api/web/market/kpis "$CHROME")"
check "API JSON, browser Accept-Encoding: zstd, decodes to the app's bytes, smaller on the wire" \
  "[ '$(field "$r" 1) $(field "$r" 2) $(field "$r" 4)' = '200 zstd $JSON_SHA' ] && [ $(field "$r" 3) -lt $(( $(wc -c <"$work/port.json") / 2 )) ]"
r="$(get /api/web/market/kpis gzip)"
check "API JSON, gzip only: gzip, same bytes" "[ '$(field "$r" 2) $(field "$r" 4)' = 'gzip $JSON_SHA' ]"
r="$(get /api/web/market/kpis)"
check "API JSON, no Accept-Encoding: identity, same bytes" "[ '$(field "$r" 2) $(field "$r" 4)' = 'identity $JSON_SHA' ]"
r="$(get /main-TEST.js "$CHROME")"
check "JS bundle: zstd, same bytes, Cache-Control immutable kept" \
  "[ '$(field "$r" 2) $(field "$r" 4)' = 'zstd $JS_SHA' ] && [ '$(field "$r" 5)' = 'public,max-age=31536000,immutable' ]"
r="$(get /healthz "$CHROME")"
check "/healthz: 200 and the exact {\"status\":\"ok\"}" \
  "[ '$(field "$r" 1) $(field "$r" 4)' = \"200 \$(printf '{\"status\":\"ok\"}' | shasum -a 256 | cut -c1-64)\" ]"
: >"$work/requests"
r="$(get /metrics "$CHROME")"
check "/metrics: Caddy's 404, the app never asked" "[ '$(field "$r" 1)' = 404 ] && ! grep -q '^/metrics' '$work/requests'"
for p in /sse /chunked; do
  r="$(get "$p" "$CHROME")"
  check "$p: compressed and still streamed (first byte < 1 s, end ≥ 2 s)" \
    "[ '$(field "$r" 2)' = zstd ] && [ $(field "$r" 6) -ge 0 ] && [ $(field "$r" 6) -lt 1000 ] && [ $(field "$r" 7) -ge 1900 ]"
done

# No gap: requests in flight while the config flips plain → encode ten times. A restart refuses every request for
# seconds (ECONNREFUSED) or answers 502; a reload does neither. But it is not perfect: measured 2026-11-06, a request
# whose connection is open at the instant of a reload is occasionally RESET (ECONNRESET) — 3 of 2700 requests over 240
# reloads, both through Docker Desktop's port proxy and container-to-container, 0 of 2700 with no reload (dev-3
# IB-142 report). So: no status but 200, no error but a reset, at most 3 resets in 200; the counts are printed always.
( for _ in $(seq 1 200); do get /api/web/market/kpis gzip | cut -d" " -f1-2; done >"$work/codes" ) & loop=$!
reloads=0
for _ in 1 2 3 4 5; do
  reload "$work/Caddyfile.plain" && reloads=$((reloads + 1))
  reload "$work/Caddyfile" && reloads=$((reloads + 1))
done
wait "$loop"
echo "     answers during the reloads: $(sed 's/^200 .*/200/' "$work/codes" | sort | uniq -c | tr -s ' \n' ' ')"
resets="$(grep -c '^ERR ECONNRESET$' "$work/codes" || true)"
check "10 reloads under load: all 10 accepted" "[ $reloads = 10 ]"
check "10 reloads under load: 200 answers, every one a 200 or a reset (no 502, no refused connection)" \
  "[ \"\$(wc -l <'$work/codes' | tr -d ' ')\" = 200 ] && ! grep -qv -e '^200 ' -e '^ERR ECONNRESET\$' '$work/codes'"
check "10 reloads under load: at most 3 resets in 200 ($resets)" "[ $resets -le 3 ]"

printf '{$SITE_ADDRESS} {\n\tnot_a_directive\n}\n' >"$work/Caddyfile.bad"
check "a Caddyfile that does not adapt: reload refused" "! reload '$work/Caddyfile.bad'"
r="$(get /api/web/market/kpis "$CHROME")"
check "… and the running config still serves, compressed" "[ '$(field "$r" 1) $(field "$r" 2)' = '200 zstd' ]"

[ "$fail" -eq 0 ] && echo "caddy.test.sh: all passed" || { echo "caddy.test.sh: FAILED"; exit 1; }
