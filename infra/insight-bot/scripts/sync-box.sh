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
  "scripts/funding-backfill.sh:/opt/insight-bot/funding-backfill.sh:0755"
  "scripts/oi-hidden-backfill.sh:/opt/insight-bot/oi-hidden-backfill.sh:0755"
  "scripts/box-backfill.sh:/opt/insight-bot/box-backfill.sh:0755"
  "scripts/history-gate.sh:/opt/insight-bot/history-gate.sh:0644"
  "systemd/insight-bot-backup.service:/etc/systemd/system/insight-bot-backup.service:0644"
  "systemd/insight-bot-backup.timer:/etc/systemd/system/insight-bot-backup.timer:0644"
)

# SSM caps one command at 97 KB (parameters + document), and the files together are past it (IB-140's
# checks.py). So each file is STAGED by its own command(s) as <dst>.new, and one last command installs them
# all, reloads systemd and writes SYNCED-FROM: a failed stage leaves the box's files as they were.
# IB-146: one file can be past the cap too (checks.py reached 92 % of it). A file's base64 is cut into parts
# of at most CHUNK_B64 characters, each staged by its own command as <dst>.part-<i>; the command carrying the
# last part concatenates them, decodes to <dst>.new and refuses unless its sha256 is this checkout's. The
# install command checks every .new's sha256 again before it installs any. A file that fits is one command,
# as before. CHUNK_B64 is overridden only by sync-box.test.sh.
CHUNK_B64="${SYNC_BOX_CHUNK_B64:-90000}"
case "$CHUNK_B64" in *[!0-9]* | '' | 0*) echo "sync-box.sh: bad SYNC_BOX_CHUNK_B64" >&2; exit 1 ;; esac
[ "$CHUNK_B64" -le 90000 ] || { echo "sync-box.sh: SYNC_BOX_CHUNK_B64 is past one SSM command" >&2; exit 1; }
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

sha_check() { # $1 = path on the box, $2 = expected sha256 → a shell line that fails unless they match
  echo "test \"\$(sha256sum <$1 | cut -c1-64)\" = $2 || { echo \"sha256 mismatch: $1\" >&2; exit 1; }"
}

echo "==> syncing ${#FILES[@]} files from ${COMMIT:0:12} to ${INSTANCE}"
installs=()
checks=()
for f in "${FILES[@]}"; do
  IFS=: read -r src dst mode <<<"$f"
  sha="$(python3 -I -c 'import hashlib,sys; print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest())' "$HERE/$src")"
  b64="$(base64 <"$HERE/$src" | tr -d '\n')"
  n=$(( (${#b64} + CHUNK_B64 - 1) / CHUNK_B64 ))
  [ "$n" -ge 1 ] || n=1
  i=0
  while [ "$i" -lt "$n" ]; do
    part="${b64:$((i * CHUNK_B64)):$CHUNK_B64}"
    cmds=("set -euo pipefail")
    [ "$i" -eq 0 ] && cmds+=("rm -f $dst.new $dst.part-*")
    cmds+=("echo $part > $dst.part-$i")
    if [ $((i + 1)) -eq "$n" ]; then
      parts=""
      j=0
      while [ "$j" -lt "$n" ]; do parts="$parts $dst.part-$j"; j=$((j + 1)); done
      cmds+=("cat$parts | tr -d '\\n' | base64 -d > $dst.new" "$(sha_check "$dst.new" "$sha")" "rm -f$parts" "echo staged $dst sha256 $sha parts $n")
    fi
    python3 -I -c 'import json,sys; print(json.dumps({"commands": sys.argv[1:]}))' "${cmds[@]}" >"$params"
    if [ "$n" -eq 1 ]; then label="stage $(basename "$dst")"; else label="stage $(basename "$dst") part $((i + 1))/$n"; fi
    ssm_run "sync-box ${COMMIT:0:12} $label" >/dev/null || { echo "sync-box.sh: $label failed; nothing installed" >&2; exit 1; }
    i=$((i + 1))
  done
  checks+=("$(sha_check "$dst.new" "$sha")")
  installs+=("install -m $mode $dst.new $dst && rm -f $dst.new && echo synced $dst")
done
python3 -I -c '
import json, sys
commit, n = sys.argv[1], int(sys.argv[2])
checks, installs = sys.argv[3:3 + n], sys.argv[3 + n:]
print(json.dumps({"commands": ["set -euo pipefail"] + checks + installs + ["systemctl daemon-reload", "echo %s > /opt/insight-bot/SYNCED-FROM" % commit]}))
' "$COMMIT" "${#checks[@]}" "${checks[@]}" "${installs[@]}" >"$params"
ssm_run "sync-box ${COMMIT:0:12} install"
