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
  "compose/Caddyfile:/opt/insight-bot/Caddyfile:0644"
  "scripts/render-env.sh:/opt/insight-bot/render-env.sh:0755"
  "scripts/deploy.sh:/opt/insight-bot/deploy.sh:0755"
  "scripts/deploy-watch.py:/opt/insight-bot/deploy-watch.py:0755"
  "scripts/checks.py:/opt/insight-bot/checks.py:0755"
  "scripts/backup.sh:/opt/insight-bot/backup.sh:0755"
  "scripts/restore.sh:/opt/insight-bot/restore.sh:0755"
  "scripts/liq-backfill.sh:/opt/insight-bot/liq-backfill.sh:0755"
  "scripts/oi-hidden-backfill.sh:/opt/insight-bot/oi-hidden-backfill.sh:0755"
  "systemd/insight-bot-backup.service:/etc/systemd/system/insight-bot-backup.service:0644"
  "systemd/insight-bot-backup.timer:/etc/systemd/system/insight-bot-backup.timer:0644"
)

# SSM caps one command at 97 KB (parameters + document), and the files together are past it (IB-140's
# checks.py). So each file is STAGED by its own command as <dst>.new, and one last command installs them
# all, reloads systemd and writes SYNCED-FROM: a failed stage leaves the box's files as they were.
params="$(mktemp)"
trap 'rm -f "$params"' EXIT

ssm_run() { # $1 = comment; the commands JSON is in $params → prints the output; fails unless Success
  local cid status
  cid="$(aws ssm send-command --region "$REGION" --instance-ids "$INSTANCE" \
    --document-name AWS-RunShellScript --comment "$1" \
    --parameters "file://$params" --query Command.CommandId --output text)"
  aws ssm wait command-executed --region "$REGION" --command-id "$cid" --instance-id "$INSTANCE" || true
  aws ssm get-command-invocation --region "$REGION" --command-id "$cid" --instance-id "$INSTANCE" \
    --query '[Status,StandardOutputContent,StandardErrorContent]' --output text
  status="$(aws ssm get-command-invocation --region "$REGION" --command-id "$cid" --instance-id "$INSTANCE" --query Status --output text)"
  test "$status" = Success
}

echo "==> syncing ${#FILES[@]} files from ${COMMIT:0:12} to ${INSTANCE}"
installs=()
for f in "${FILES[@]}"; do
  IFS=: read -r src dst mode <<<"$f"
  b64="$(base64 <"$HERE/$src" | tr -d '\n')"
  if [ "${#b64}" -gt 90000 ]; then
    echo "sync-box.sh: $src is too large for one SSM command (${#b64} B base64)" >&2
    exit 1
  fi
  python3 -I -c 'import json,sys; print(json.dumps({"commands": ["set -euo pipefail", "echo %s | base64 -d > %s.new && echo staged %s" % (sys.argv[1], sys.argv[2], sys.argv[2])]}))' \
    "$b64" "$dst" >"$params"
  ssm_run "sync-box ${COMMIT:0:12} stage $(basename "$dst")" >/dev/null || { echo "sync-box.sh: staging $dst failed; nothing installed" >&2; exit 1; }
  installs+=("install -m $mode $dst.new $dst && rm -f $dst.new && echo synced $dst")
done
python3 -I -c '
import json, sys
commit, cmds = sys.argv[1], sys.argv[2:]
print(json.dumps({"commands": ["set -euo pipefail"] + cmds + ["systemctl daemon-reload", "echo %s > /opt/insight-bot/SYNCED-FROM" % commit]}))
' "$COMMIT" "${installs[@]}" >"$params"
ssm_run "sync-box ${COMMIT:0:12} install"
