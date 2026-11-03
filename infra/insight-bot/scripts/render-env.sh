#!/usr/bin/env bash
# Renders /opt/insight-bot/.env from SSM SecureStrings (design §7: secrets never in the image or
# the repo). Root-only, 0600. Run by the deploy step before `docker compose up`.
#
#   render-env.sh            # uses the defaults baked in by user_data
#
# Every /insight-bot/* parameter goes into the app's .env EXCEPT the Cloudflare tunnel token
# (member-access design M4, IB-074): /insight-bot/CF_TUNNEL_TOKEN is written to a separate
# root-only cloudflared.env as TUNNEL_TOKEN, which only the cloudflared container reads. The Node
# process has no reason to know it. cloudflared.env is always written (empty of a token when the
# parameter does not exist yet) so `docker compose up` works before the owner creates the tunnel;
# cloudflared then restarts until the token is in SSM and deploy.sh is re-run.
#
# /insight-bot/SITE_ADDRESS (https-without-domain H4, written by tofu) goes only to caddy.env, the
# file the caddy container reads: Caddy needs the site name, the app does not. caddy.env is always
# written too, empty when the parameter does not exist.
#
# Values are never echoed: the script prints parameter NAMES and a count, nothing else.
set -euo pipefail

REGION="${AWS_REGION:-ap-northeast-1}"
PREFIX="${SSM_PREFIX:-/insight-bot}"
TARGET="${ENV_FILE:-/opt/insight-bot/.env}"
CF_TARGET="${CF_ENV_FILE:-/opt/insight-bot/cloudflared.env}"
CADDY_TARGET="${CADDY_ENV_FILE:-/opt/insight-bot/caddy.env}"

umask 077
tmp="$(mktemp "${TARGET}.XXXXXX")"
cf_tmp="$(mktemp "${CF_TARGET}.XXXXXX")"
caddy_tmp="$(mktemp "${CADDY_TARGET}.XXXXXX")"
trap 'rm -f "$tmp" "$cf_tmp" "$caddy_tmp"' EXIT

echo "# rendered from SSM ${PREFIX} at $(date -u +%FT%TZ) — do not edit by hand" >"$tmp"
echo "# rendered from SSM ${PREFIX}/CF_TUNNEL_TOKEN at $(date -u +%FT%TZ) — do not edit by hand" >"$cf_tmp"
echo "# rendered from SSM ${PREFIX}/SITE_ADDRESS at $(date -u +%FT%TZ) — do not edit by hand" >"$caddy_tmp"

count=0
cf_count=0
caddy_count=0
while read -r name value; do
  [ -z "$name" ] && continue
  key="${name##*/}"
  # Values can contain anything; single-quote and escape embedded quotes.
  escaped=${value//\'/\'\\\'\'}
  if [ "$key" = "CF_TUNNEL_TOKEN" ]; then
    # cloudflared reads its token from TUNNEL_TOKEN; never into the app's .env.
    printf "TUNNEL_TOKEN='%s'\n" "$escaped" >>"$cf_tmp"
    cf_count=$((cf_count + 1))
    echo "  ${key} -> $(basename "$CF_TARGET")" >&2
    continue
  fi
  if [ "$key" = "SITE_ADDRESS" ]; then
    # Caddy's site name; the app has no use for it.
    printf "SITE_ADDRESS='%s'\n" "$escaped" >>"$caddy_tmp"
    caddy_count=$((caddy_count + 1))
    echo "  ${key} -> $(basename "$CADDY_TARGET")" >&2
    continue
  fi
  printf "%s='%s'\n" "$key" "$escaped" >>"$tmp"
  count=$((count + 1))
  echo "  ${key}" >&2
done < <(aws ssm get-parameters-by-path \
  --region "$REGION" \
  --path "$PREFIX" \
  --with-decryption \
  --recursive \
  --query 'Parameters[].[Name,Value]' \
  --output text)

if [ "$count" -eq 0 ]; then
  echo "render-env.sh: no parameters under ${PREFIX} — refusing to write an empty .env" >&2
  exit 1
fi

chmod 600 "$tmp" "$cf_tmp" "$caddy_tmp"
mv "$tmp" "$TARGET"
mv "$cf_tmp" "$CF_TARGET"
mv "$caddy_tmp" "$CADDY_TARGET"
trap - EXIT
echo "render-env.sh: wrote ${count} keys to ${TARGET}" >&2
if [ "$cf_count" -eq 0 ]; then
  echo "render-env.sh: no ${PREFIX}/CF_TUNNEL_TOKEN — ${CF_TARGET} has no token, cloudflared will not connect" >&2
else
  echo "render-env.sh: wrote the tunnel token to ${CF_TARGET}" >&2
fi
if [ "$caddy_count" -eq 0 ]; then
  echo "render-env.sh: no ${PREFIX}/SITE_ADDRESS — ${CADDY_TARGET} is empty, caddy has no site to serve" >&2
fi
