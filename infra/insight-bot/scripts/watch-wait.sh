#!/usr/bin/env bash
# IB-139 — the dev-side waiter for the post-deploy watch. Run it in the BACKGROUND right after the deploy
# (Claude Code: Bash with run_in_background, then go back to the next task; the exit is the notification).
# It polls the watch's json on the box over SSM — no pgrep, no process matching — until there is a verdict.
#
#   infra/insight-bot/scripts/watch-wait.sh sha-<12> [<instance-id>]
#
# Exit 0  CLEAN        — the only verdict a task may be marked «deployed … watch clean» from
# Exit 1  ALARM:<why>  — printed as soon as an alarm appears (the watch keeps running; the owner already
#                        has the Telegram message); also ALARM:watch_lost when there is no verdict 40 min
#                        after the deploy started (box reboot, the unit killed or stopped, never launched)
# Exit 3  SUPERSEDED   — a newer deploy took over; wait for that one instead
# Exit 2  usage / AWS error
# One SSM call every POLL_S (120 s): ~20 calls over a watch. Uses AWS profile `insight-bot` unless set.
set -euo pipefail

export AWS_PROFILE="${AWS_PROFILE:-insight-bot}"
REGION="${AWS_REGION:-ap-northeast-1}"
POLL_S="${POLL_S:-120}"
LOST_AFTER_S="${LOST_AFTER_S:-2400}" # 40 min after the deploy start

TAG="${1:-}"
case "$TAG" in sha-[0-9a-f]*) SHA="${TAG#sha-}" ;; *) echo "usage: watch-wait.sh sha-<12> [<instance-id>]" >&2; exit 2 ;; esac
INSTANCE="${2:-$(aws ec2 describe-instances --region "$REGION" \
  --filters Name=tag:Name,Values=insight-bot Name=instance-state-name,Values=running \
  --query 'Reservations[0].Instances[0].InstanceId' --output text)}"
case "$INSTANCE" in i-*) ;; *) echo "watch-wait.sh: no running insight-bot instance found" >&2; exit 2 ;; esac

JSON="/var/log/insight-watch/${SHA}.json"
MD="/var/log/insight-watch/${SHA}.md"
# On the box: a one-line summary of the json, or {"missing":true}. jq is on AL2023.
REMOTE="if [ -f $JSON ]; then jq -c '{verdict, state, alarms: [.alarms[] | .reason + \" — \" + .detail], warnings, samples: (.samples | length), deploy_start, rollback}' $JSON; else echo '{\"missing\":true}'; fi"

ssm() { # $1 = shell command on the box → its stdout
  local cid params
  params="$(python3 -I -c 'import json,sys; print(json.dumps({"commands": [sys.argv[1]]}))' "$1")"
  cid="$(aws ssm send-command --region "$REGION" --instance-ids "$INSTANCE" --document-name AWS-RunShellScript \
    --comment "watch-wait ${SHA}" --parameters "$params" --query Command.CommandId --output text)"
  aws ssm wait command-executed --region "$REGION" --command-id "$cid" --instance-id "$INSTANCE" 2>/dev/null || true
  aws ssm get-command-invocation --region "$REGION" --command-id "$cid" --instance-id "$INSTANCE" \
    --query StandardOutputContent --output text
}

started="$(date +%s)"
echo "watch-wait: ${TAG} on ${INSTANCE}, polling ${JSON} every ${POLL_S} s"
while :; do
  line="$(ssm "$REMOTE" | awk 'NF { l = $0 } END { print l }')"
  now="$(date +%s)"
  read -r verdict alarms deploy_start <<<"$(python3 -I -c '
import calendar, json, sys, time
try:
    d = json.loads(sys.argv[1])
except ValueError:
    d = {"missing": True}
ds = d.get("deploy_start")
ep = calendar.timegm(time.strptime(ds, "%Y-%m-%dT%H:%M:%SZ")) if ds else 0
print(d.get("verdict") or "-", len(d.get("alarms") or []), ep)' "$line")"
  echo "$(date -u +%H:%M:%S) ${line}"
  base="${deploy_start:-0}"; [ "$base" -gt 0 ] || base="$started"
  if [ "$verdict" = CLEAN ]; then
    echo "watch-wait: CLEAN — ${JSON}"; ssm "cat $MD"; exit 0
  elif [ "$verdict" = SUPERSEDED ]; then
    echo "watch-wait: SUPERSEDED — a newer deploy's watch took over"; exit 3
  elif [ "$verdict" != - ] || [ "$alarms" -gt 0 ]; then
    echo "watch-wait: ${verdict/#-/ALARM (watch still running)} — the owner has the Telegram message; the TL decides on the rollback"
    ssm "cat $MD"; exit 1
  elif [ $((now - base)) -ge "$LOST_AFTER_S" ]; then
    echo "watch-wait: ALARM:watch_lost — no verdict $(((now - base) / 60)) min after the deploy (${JSON} $( [ "$line" = '{"missing":true}' ] && echo 'never written' || echo 'stopped mid-way'))"
    exit 1
  fi
  sleep "$POLL_S"
done
