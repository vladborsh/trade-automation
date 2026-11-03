#!/usr/bin/env bash
# Offline check of render-env.sh (IB-074): a stub `aws` stands in for SSM, so this runs anywhere
# without AWS credentials.
#
#   bash infra/insight-bot/scripts/render-env.test.sh
#
# Asserts: the tunnel token lands in cloudflared.env as TUNNEL_TOKEN and NOT in the app's .env;
# every other parameter lands in .env; both files are 0600; a missing token still writes a
# tokenless cloudflared.env (so `docker compose up` works before the tunnel exists).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
fail=0
check() { if eval "$2"; then echo "ok   - $1"; else echo "FAIL - $1"; fail=1; fi; }

mkdir -p "$work/bin"
cat >"$work/bin/aws" <<'STUB'
#!/usr/bin/env bash
# get-parameters-by-path --output text: one "Name<TAB>Value" line per parameter.
cat "$STUB_PARAMS"
STUB
chmod +x "$work/bin/aws"

run() { # $1 = params file, $2 = output dir
  PATH="$work/bin:$PATH" STUB_PARAMS="$1" ENV_FILE="$2/.env" CF_ENV_FILE="$2/cloudflared.env" CADDY_ENV_FILE="$2/caddy.env" \
    bash "$HERE/render-env.sh" 2>"$2/stderr"
}
mode() { stat -f '%Lp' "$1" 2>/dev/null || stat -c '%a' "$1"; }

# --- with a tunnel token ---------------------------------------------------------------------
mkdir -p "$work/a"
printf '%s\t%s\n' \
  /insight-bot/POSTGRES_PASSWORD "pw'with quote" \
  /insight-bot/CF_TUNNEL_TOKEN eyJfake-tunnel-token \
  /insight-bot/WEB_BASE_URL https://example.org \
  /insight-bot/WEB_COOKIE_SECURE true \
  /insight-bot/SITE_ADDRESS 1-2-3-4.sslip.io >"$work/a/params"
run "$work/a/params" "$work/a"

check "token is in cloudflared.env as TUNNEL_TOKEN" \
  "grep -qx \"TUNNEL_TOKEN='eyJfake-tunnel-token'\" '$work/a/cloudflared.env'"
check "token value is nowhere in the app .env" "! grep -q 'eyJfake-tunnel-token' '$work/a/.env'"
check "no CF_TUNNEL_TOKEN / TUNNEL_TOKEN key in the app .env" "! grep -qE '^(CF_)?TUNNEL_TOKEN=' '$work/a/.env'"
check "other keys are in the app .env" \
  "grep -qx \"WEB_BASE_URL='https://example.org'\" '$work/a/.env' && grep -qx \"WEB_COOKIE_SECURE='true'\" '$work/a/.env'"
check "embedded quote still escaped" "grep -qx \"POSTGRES_PASSWORD='pw'\\\\\\\\''with quote'\" '$work/a/.env'"
check "app .env is 0600" "[ \"\$(mode '$work/a/.env')\" = 600 ]"
check "cloudflared.env is 0600" "[ \"\$(mode '$work/a/cloudflared.env')\" = 600 ]"
check "SITE_ADDRESS is in caddy.env (IB-082)" "grep -qx \"SITE_ADDRESS='1-2-3-4.sslip.io'\" '$work/a/caddy.env'"
check "SITE_ADDRESS is not in the app .env" "! grep -q 'SITE_ADDRESS' '$work/a/.env'"
check "caddy.env is 0600" "[ \"\$(mode '$work/a/caddy.env')\" = 600 ]"
check "stderr never prints the token value" "! grep -q 'eyJfake-tunnel-token' '$work/a/stderr'"

# --- without a tunnel token ------------------------------------------------------------------
mkdir -p "$work/b"
printf '%s\t%s\n' /insight-bot/POSTGRES_PASSWORD pw >"$work/b/params"
run "$work/b/params" "$work/b"
check "cloudflared.env exists without a token" "[ -f '$work/b/cloudflared.env' ] && ! grep -q '^TUNNEL_TOKEN=' '$work/b/cloudflared.env'"
check "missing token is reported" "grep -q 'no /insight-bot/CF_TUNNEL_TOKEN' '$work/b/stderr'"
check "caddy.env exists without SITE_ADDRESS" "[ -f '$work/b/caddy.env' ] && ! grep -q '^SITE_ADDRESS=' '$work/b/caddy.env'"
check "missing SITE_ADDRESS is reported" "grep -q 'no /insight-bot/SITE_ADDRESS' '$work/b/stderr'"

[ "$fail" -eq 0 ] && echo "render-env.test.sh: all passed" || { echo "render-env.test.sh: FAILED"; exit 1; }
