#!/usr/bin/env bash
# Copy the box's own files from this checkout onto the running box over SSM.
#
#   infra/insight-bot/scripts/sync-box.sh [<instance-id>]   # default: the running instance tagged Name=insight-bot
#
# Why this exists: user_data is first-boot only and tofu ignores changes to it (main.tf), because
# an in-place user_data change stops and starts the box. So when compose/docker-compose.yml, a
# script in scripts/ or a systemd unit changes, this is how the change reaches the box. It does
# NOT deploy: run deploy.sh afterwards (RUNBOOK §3). Refuses a dirty tree, so the box always
# carries files that exist in a commit; the commit is written to /opt/insight-bot/SYNCED-FROM.
#
# Uses AWS profile `insight-bot` unless AWS_PROFILE is set.
set -euo pipefail

export AWS_PROFILE="${AWS_PROFILE:-insight-bot}"
REGION="${AWS_REGION:-ap-northeast-1}"
HERE="$(cd "$(dirname "$0")/.." && pwd)" # infra/insight-bot

if [ -n "$(git -C "$HERE" status --porcelain -- .)" ]; then
  echo "sync-box.sh: infra/insight-bot has uncommitted changes — commit first" >&2
  exit 1
fi
COMMIT="$(git -C "$HERE" rev-parse HEAD)"

INSTANCE="${1:-$(aws ec2 describe-instances --region "$REGION" \
  --filters Name=tag:Name,Values=insight-bot Name=instance-state-name,Values=running \
  --query 'Reservations[0].Instances[0].InstanceId' --output text)}"
case "$INSTANCE" in i-*) ;; *) echo "sync-box.sh: no running insight-bot instance found" >&2; exit 1 ;; esac

# source path (relative to infra/insight-bot) -> destination on the box, mode
FILES=(
  "compose/docker-compose.yml:/opt/insight-bot/docker-compose.yml:0644"
  "scripts/render-env.sh:/opt/insight-bot/render-env.sh:0755"
  "scripts/deploy.sh:/opt/insight-bot/deploy.sh:0755"
  "scripts/backup.sh:/opt/insight-bot/backup.sh:0755"
  "scripts/restore.sh:/opt/insight-bot/restore.sh:0755"
  "systemd/insight-bot-backup.service:/etc/systemd/system/insight-bot-backup.service:0644"
  "systemd/insight-bot-backup.timer:/etc/systemd/system/insight-bot-backup.timer:0644"
)

params="$(mktemp)"
trap 'rm -f "$params"' EXIT
{
  for f in "${FILES[@]}"; do
    IFS=: read -r src dst mode <<<"$f"
    printf '%s\t%s\t%s\t%s\n' "$src" "$dst" "$mode" "$(base64 <"$HERE/$src" | tr -d '\n')"
  done
} | python3 -I -c '
import json, sys
commit = sys.argv[1]
cmds = ["set -euo pipefail"]
for line in sys.stdin:
    src, dst, mode, b64 = line.rstrip("\n").split("\t")
    cmds.append(f"echo {b64} | base64 -d > {dst}.new && install -m {mode} {dst}.new {dst} && rm -f {dst}.new && echo synced {dst}")
cmds += ["systemctl daemon-reload", f"echo {commit} > /opt/insight-bot/SYNCED-FROM"]
print(json.dumps({"commands": cmds}))
' "$COMMIT" >"$params"

echo "==> syncing ${#FILES[@]} files from ${COMMIT:0:12} to ${INSTANCE}"
cid="$(aws ssm send-command --region "$REGION" --instance-ids "$INSTANCE" \
  --document-name AWS-RunShellScript --comment "sync-box ${COMMIT:0:12}" \
  --parameters "file://$params" --query Command.CommandId --output text)"
aws ssm wait command-executed --region "$REGION" --command-id "$cid" --instance-id "$INSTANCE" || true
aws ssm get-command-invocation --region "$REGION" --command-id "$cid" --instance-id "$INSTANCE" \
  --query '[Status,StandardOutputContent,StandardErrorContent]' --output text
status="$(aws ssm get-command-invocation --region "$REGION" --command-id "$cid" --instance-id "$INSTANCE" --query Status --output text)"
test "$status" = Success
