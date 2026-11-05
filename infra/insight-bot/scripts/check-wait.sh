#!/usr/bin/env bash
# IB-140 — the dev-side waiter for a scheduled box check (checks.py). Run it in the BACKGROUND (Claude Code:
# Bash with run_in_background) and go back to work; its exit is the notification. It polls the check's
# sentinel on the box over SSM — no pgrep, no process matching — until there is a verdict.
#
#   infra/insight-bot/scripts/check-wait.sh <name> [<not-before-epoch>] [<instance-id>]
#
# <not-before-epoch>: a sentinel older than this is a PREVIOUS run's and is ignored (default: now).
# Exit 0 PASS · 1 FLAG:… · 4 FAIL:… (the owner already has the Telegram message) · 2 usage / AWS error
# · 5 LOST: no verdict LOST_AFTER_S after <not-before-epoch> + the check's own schedule (pass DEADLINE_EPOCH).
# One SSM call every POLL_S (300 s). Uses AWS profile `insight-bot` unless set.
set -euo pipefail

export AWS_PROFILE="${AWS_PROFILE:-insight-bot}"
REGION="${AWS_REGION:-ap-northeast-1}"
POLL_S="${POLL_S:-300}"
NAME="${1:-}"
case "$NAME" in [a-z0-9-]*) ;; *) echo "usage: check-wait.sh <name> [<not-before-epoch>] [<instance-id>]" >&2; exit 2 ;; esac
NOT_BEFORE="${2:-$(date +%s)}"
DEADLINE="${DEADLINE_EPOCH:-$((NOT_BEFORE + 3600))}"
INSTANCE="${3:-$(aws ec2 describe-instances --region "$REGION" \
  --filters Name=tag:Name,Values=insight-bot Name=instance-state-name,Values=running \
  --query 'Reservations[0].Instances[0].InstanceId' --output text)}"
case "$INSTANCE" in i-*) ;; *) echo "check-wait.sh: no running insight-bot instance found" >&2; exit 2 ;; esac

F="/var/log/insight-checks/${NAME}.done"
REMOTE="if [ -f $F ]; then echo \"\$(stat -c %Y $F) \$(head -c 300 $F)\"; else echo '0 -'; fi"

ssm() {
  local cid params
  params="$(python3 -I -c 'import json,sys; print(json.dumps({"commands": [sys.argv[1]]}))' "$1")"
  cid="$(aws ssm send-command --region "$REGION" --instance-ids "$INSTANCE" --document-name AWS-RunShellScript \
    --comment "check-wait ${NAME}" --parameters "$params" --query Command.CommandId --output text)"
  aws ssm wait command-executed --region "$REGION" --command-id "$cid" --instance-id "$INSTANCE" 2>/dev/null || true
  aws ssm get-command-invocation --region "$REGION" --command-id "$cid" --instance-id "$INSTANCE" \
    --query StandardOutputContent --output text
}

echo "check-wait: ${NAME} on ${INSTANCE}, sentinel ${F} newer than $(date -u -r "$NOT_BEFORE" +%FT%TZ 2>/dev/null || date -u -d "@$NOT_BEFORE" +%FT%TZ), every ${POLL_S} s"
while :; do
  read -r mtime verdict <<<"$(ssm "$REMOTE" | awk 'NF { l = $0 } END { print l }')"
  echo "$(date -u +%H:%M:%S) mtime=${mtime:-?} ${verdict:-}"
  if [ "${mtime:-0}" -ge "$NOT_BEFORE" ] 2>/dev/null; then
    echo "check-wait: ${NAME} → ${verdict} (/var/log/insight-checks/${NAME}.md)"
    case "$verdict" in PASS) exit 0 ;; FLAG:*) exit 1 ;; *) exit 4 ;; esac
  fi
  if [ "$(date +%s)" -gt "$DEADLINE" ]; then
    echo "check-wait: ${NAME} → LOST (no verdict by $(date -u -r "$DEADLINE" +%FT%TZ 2>/dev/null || echo "$DEADLINE"))"
    exit 5
  fi
  sleep "$POLL_S"
done
