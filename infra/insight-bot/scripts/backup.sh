#!/usr/bin/env bash
# Daily backup (design §7): pg_dump -Fc of the insight database → s3://<bucket>/pg_dump/<date>.dump
# Run by insight-bot-backup.timer at 01:00 UTC. Exit non-zero on any failure so the timer's unit
# shows failed and the next /health read explains itself.
set -euo pipefail

DIR=/opt/insight-bot
REGION="${AWS_REGION:-ap-northeast-1}"
BUCKET="$(cat "$DIR/backup-bucket")"
STAMP="$(date -u +%Y-%m-%dT%H%M%SZ)"
FILE="/tmp/insight-${STAMP}.dump"

trap 'rm -f "$FILE"' EXIT

cd "$DIR"
echo "==> pg_dump ${STAMP}"
# -Fc: custom format, restorable with pg_restore, compressed. Runs inside the postgres container so
# the client version always matches the server.
docker compose exec -T postgres pg_dump -U insight -d insight -Fc >"$FILE"

size=$(stat -c %s "$FILE")
if [ "$size" -lt 1000 ]; then
  echo "backup.sh: dump is only ${size} bytes — refusing to upload" >&2
  exit 1
fi

echo "==> uploading $((size / 1024 / 1024)) MiB to s3://${BUCKET}/pg_dump/${STAMP}.dump"
aws s3 cp "$FILE" "s3://${BUCKET}/pg_dump/${STAMP}.dump" --region "$REGION" --only-show-errors

echo "backup.sh: ok ${STAMP} (${size} bytes)"
