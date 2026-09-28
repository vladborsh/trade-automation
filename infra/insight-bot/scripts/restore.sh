#!/usr/bin/env bash
# The restore drill (design §7: documented and run once before the cluster is accepted).
#
#   restore.sh                      # list what is in the bucket
#   restore.sh <key> --into-check   # restore into database `insight_restore_check` and count rows
#   restore.sh <key> --into-live    # DESTRUCTIVE: drop and recreate `insight` from the dump
#
# The drill is the --into-check form: it proves the dump is restorable without touching live data.
set -euo pipefail

DIR=/opt/insight-bot
REGION="${AWS_REGION:-ap-northeast-1}"
BUCKET="$(cat "$DIR/backup-bucket")"
KEY="${1:-}"
MODE="${2:-}"

cd "$DIR"

if [ -z "$KEY" ]; then
  echo "Dumps in s3://${BUCKET}/pg_dump/ (newest last):"
  aws s3 ls "s3://${BUCKET}/pg_dump/" --region "$REGION"
  exit 0
fi

FILE="/tmp/$(basename "$KEY")"
trap 'rm -f "$FILE"' EXIT
echo "==> downloading ${KEY}"
aws s3 cp "s3://${BUCKET}/${KEY#s3://${BUCKET}/}" "$FILE" --region "$REGION" --only-show-errors

case "$MODE" in
  --into-check)
    TARGET=insight_restore_check
    echo "==> restoring into ${TARGET} (live database untouched)"
    docker compose exec -T postgres psql -U insight -d postgres -c "DROP DATABASE IF EXISTS ${TARGET};"
    docker compose exec -T postgres psql -U insight -d postgres -c "CREATE DATABASE ${TARGET};"
    docker compose exec -T postgres pg_restore -U insight -d "${TARGET}" --no-owner <"$FILE"
    echo "==> row counts in ${TARGET}:"
    docker compose exec -T postgres psql -U insight -d "${TARGET}" -c \
      "select relname, n_live_tup from pg_stat_user_tables order by n_live_tup desc limit 15;"
    echo "restore.sh: drill ok — drop it with: docker compose exec -T postgres psql -U insight -d postgres -c 'DROP DATABASE ${TARGET};'"
    ;;
  --into-live)
    echo "!! This replaces the live database. Stopping insight-bot first."
    read -r -p "Type 'restore live' to continue: " confirm
    [ "$confirm" = "restore live" ] || { echo "aborted"; exit 1; }
    docker compose stop insight-bot
    docker compose exec -T postgres psql -U insight -d postgres -c "DROP DATABASE IF EXISTS insight;"
    docker compose exec -T postgres psql -U insight -d postgres -c "CREATE DATABASE insight;"
    docker compose exec -T postgres pg_restore -U insight -d insight --no-owner <"$FILE"
    docker compose start insight-bot
    echo "restore.sh: live database restored from ${KEY}"
    ;;
  *)
    echo "usage: restore.sh <key> --into-check | --into-live" >&2
    exit 2
    ;;
esac
