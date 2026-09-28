#!/usr/bin/env bash
# Renders /opt/insight-bot/.env from SSM SecureStrings (design §7: secrets never in the image or
# the repo). Root-only, 0600. Run by the deploy step before `docker compose up`.
#
#   render-env.sh            # uses the defaults baked in by user_data
#
# Values are never echoed: the script prints parameter NAMES and a count, nothing else.
set -euo pipefail

REGION="${AWS_REGION:-ap-northeast-1}"
PREFIX="${SSM_PREFIX:-/insight-bot}"
TARGET="${ENV_FILE:-/opt/insight-bot/.env}"

umask 077
tmp="$(mktemp "${TARGET}.XXXXXX")"
trap 'rm -f "$tmp"' EXIT

echo "# rendered from SSM ${PREFIX} at $(date -u +%FT%TZ) — do not edit by hand" >"$tmp"

count=0
while read -r name value; do
  [ -z "$name" ] && continue
  key="${name##*/}"
  # Values can contain anything; single-quote and escape embedded quotes.
  escaped=${value//\'/\'\\\'\'}
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

chmod 600 "$tmp"
mv "$tmp" "$TARGET"
trap - EXIT
echo "render-env.sh: wrote ${count} keys to ${TARGET}" >&2
