#!/usr/bin/env bash
# Offline check of sync-box.sh (IB-146): a stub `aws` plays SSM by running each command's lines with the
# real bash/base64/sha256sum against a fake box root (paths /opt/insight-bot and /etc/systemd/system are
# rewritten under it; systemctl is a stub). No AWS.
#
#   bash infra/insight-bot/scripts/sync-box.test.sh
#
# The sync runs from a throwaway git repo holding a copy of infra/insight-bot's synced files, so a file can
# be made larger than one SSM command without touching this checkout. Asserts:
#   - a file whose base64 is past the 90 000 limit syncs in parts and its sha256 on the box is the source's;
#   - every other file lands byte-identical, SYNCED-FROM is the commit, systemd is reloaded;
#   - every SSM command stays under the 97 KB cap;
#   - a failed part, a part corrupted in transit, and a .new changed between staging and install each
#     install nothing (the box's files, SYNCED-FROM unchanged; no install command for the first two);
#   - a dirty tree is refused before any SSM call.
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)" # infra/insight-bot
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
fail=0
check() { if eval "$2"; then echo "ok   - $1"; else echo "FAIL - $1"; fail=1; fi; }
sha() { python3 -I -c 'import hashlib,sys; print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest())' "$1"; }

# --- the repo the sync runs from: every source sync-box.sh names, copied
repo="$work/repo/infra/insight-bot"
mkdir -p "$repo/scripts"
cp "$HERE/scripts/sync-box.sh" "$repo/scripts/"
srcs="$(sed -n 's/^  "\([^:]*\):\/.*/\1/p' "$HERE/scripts/sync-box.sh")"
for s in $srcs; do mkdir -p "$repo/$(dirname "$s")"; cp "$HERE/$s" "$repo/$s"; done
nsrc="$(echo "$srcs" | wc -l | tr -d ' ')"
# checks.py made bigger than one SSM command: ~40 KB of comment lines on top of the real file
python3 -I -c '
import sys
with open(sys.argv[1], "a") as f:
    for i in range(800): f.write("# IB-146 padding line %04d: sync-box.test.sh needs this file past one SSM command\n" % i)
' "$repo/scripts/checks.py"
big_b64="$(base64 <"$repo/scripts/checks.py" | tr -d '\n' | wc -c | tr -d ' ')"
git -C "$work/repo" init -q
git -C "$work/repo" -c user.name=t -c user.email=t@t add -A
git -C "$work/repo" -c user.name=t -c user.email=t@t commit -qm fixture
commit="$(git -C "$work/repo" rev-parse HEAD)"

# --- the stub aws
mkdir -p "$work/bin" "$work/ssm"
cat >"$work/bin/aws" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
sub="$1 $2"; shift 2
comment="" params="" cid="" query=""
while [ $# -gt 0 ]; do
  case "$1" in
    --comment) comment="$2"; shift 2 ;;
    --parameters) params="${2#file://}"; shift 2 ;;
    --command-id) cid="$2"; shift 2 ;;
    --query) query="$2"; shift 2 ;;
    *) shift ;;
  esac
done
case "$sub" in
  "ssm send-command")
    cid="c$(ls "$STUB_SSM" | wc -l | tr -d ' ')-$RANDOM"
    mkdir "$STUB_SSM/$cid"
    printf '%s\n' "$comment" >"$STUB_SSM/$cid/comment"
    cp "$params" "$STUB_SSM/$cid/params.json"
    wc -c <"$params" | tr -d ' ' >"$STUB_SSM/$cid/bytes"
    status=Success
    if [ -n "${STUB_FAIL_COMMENT:-}" ] && [[ "$comment" == *"$STUB_FAIL_COMMENT"* ]]; then
      status=Failed # SSM never ran it (the instance dropped the command)
    else
      if [ -n "${STUB_TAMPER_BEFORE_INSTALL:-}" ] && [[ "$comment" == *" install" ]]; then
        echo tampered >>"$STUB_ROOT$STUB_TAMPER_BEFORE_INSTALL"
      fi
      python3 -I - "$STUB_SSM/$cid/params.json" "$STUB_ROOT" "$comment" "${STUB_CORRUPT_COMMENT:-}" >"$STUB_SSM/$cid/script.sh" <<'PY'
import json, re, sys
cmds = json.load(open(sys.argv[1]))["commands"]
root, comment, corrupt = sys.argv[2], sys.argv[3], sys.argv[4]
out = []
for c in cmds:
    if corrupt and corrupt in comment and c.startswith("echo ") and ".part-" in c:
        # one base64 character changed in transit: still valid base64, different bytes
        k = 15
        c = c[:k] + ("B" if c[k] != "B" else "C") + c[k + 1:]
    c = c.replace("/opt/insight-bot", root + "/opt/insight-bot").replace("/etc/systemd/system", root + "/etc/systemd/system")
    out.append(c)
print("\n".join(out))
PY
      if bash "$STUB_SSM/$cid/script.sh" >"$STUB_SSM/$cid/out" 2>"$STUB_SSM/$cid/err"; then :; else status=Failed; fi
    fi
    echo "$status" >"$STUB_SSM/$cid/status"
    echo "$cid" ;;
  "ssm wait") exit 0 ;;
  "ssm get-command-invocation")
    if [ "$query" = Status ]; then cat "$STUB_SSM/$cid/status"
    else printf '%s\t%s\t%s\n' "$(cat "$STUB_SSM/$cid/status")" "$(cat "$STUB_SSM/$cid/out" 2>/dev/null)" "$(cat "$STUB_SSM/$cid/err" 2>/dev/null)"; fi ;;
  *) echo "stub aws: unexpected $sub" >&2; exit 2 ;;
esac
STUB
printf '#!/usr/bin/env bash\necho "$*" >>"$STUB_ROOT/systemctl.log"\n' >"$work/bin/systemctl"
chmod +x "$work/bin/aws" "$work/bin/systemctl"

# A fresh box root holding the OLD version of every destination, so "installed nothing" is observable.
new_box() {
  rm -rf "$work/box" "$work/ssm"; mkdir -p "$work/box/opt/insight-bot" "$work/box/etc/systemd/system" "$work/ssm"
  for d in $(sed -n 's/^  "[^:]*:\([^:]*\):.*/\1/p' "$repo/scripts/sync-box.sh"); do echo "old $d" >"$work/box$d"; done
  echo old-commit >"$work/box/opt/insight-bot/SYNCED-FROM"
}
untouched() { # every destination still holds its old content, and SYNCED-FROM is the old commit
  local d
  for d in $(sed -n 's/^  "[^:]*:\([^:]*\):.*/\1/p' "$repo/scripts/sync-box.sh"); do
    [ "$(cat "$work/box$d")" = "old $d" ] || return 1
  done
  [ "$(cat "$work/box/opt/insight-bot/SYNCED-FROM")" = old-commit ]
}
sync() { # extra env assignments as args → exit code in $rc, output in $work/out
  rc=0
  env PATH="$work/bin:$PATH" STUB_SSM="$work/ssm" STUB_ROOT="$work/box" "$@" \
    bash "$repo/scripts/sync-box.sh" i-0123456789abcdef0 >"$work/out" 2>&1 || rc=$?
}
installs_sent() { grep -l ' install$' "$work"/ssm/*/comment 2>/dev/null | wc -l | tr -d ' '; }

echo "# fixture: $nsrc files; checks.py base64 = $big_b64 B (limit 90000)"
check "the fixture's checks.py is past one SSM command" '[ "$big_b64" -gt 90000 ]'

# 1. a clean sync, real chunk size
new_box; sync
check "sync exits 0" '[ "$rc" -eq 0 ]'
same=0
for f in $(sed -n 's/^  "\([^:]*\):\([^:]*\):.*/\1:\2/p' "$repo/scripts/sync-box.sh"); do
  [ "$(sha "$repo/${f%%:*}")" = "$(sha "$work/box${f#*:}")" ] && same=$((same + 1))
done
check "all $nsrc files land with the source's sha256 (got $same)" '[ "$same" -eq "$nsrc" ]'
check "checks.py went in 2 parts" '[ "$(grep -l "stage checks.py part" "$work"/ssm/*/comment | wc -l | tr -d " ")" -eq 2 ]'
check "a file that fits is still one command ($nsrc files + 1 extra part + 1 install)" '[ "$(ls "$work/ssm" | wc -l | tr -d " ")" -eq $((nsrc + 2)) ]'
max_bytes="$(cat "$work"/ssm/*/bytes | sort -n | tail -1)"
check "every SSM command is under 97 KB (largest $max_bytes B)" '[ "$max_bytes" -lt 97000 ]'
check "SYNCED-FROM is the commit" '[ "$(cat "$work/box/opt/insight-bot/SYNCED-FROM")" = "$commit" ]'
check "systemd reloaded" 'grep -qx daemon-reload "$work/box/systemctl.log"'
check "no .new or .part-* left behind" '[ -z "$(find "$work/box" -name "*.new" -o -name "*.part-*")" ]'
check "modes kept (checks.py 0755, history-gate.sh 0644)" '[ -x "$work/box/opt/insight-bot/checks.py" ] && [ ! -x "$work/box/opt/insight-bot/history-gate.sh" ]'

# 2. small parts: the same bytes in many pieces
new_box; sync SYNC_BOX_CHUNK_B64=7000
check "chunk 7000: exits 0, checks.py in $(( (big_b64 + 6999) / 7000 )) parts, sha256 matches" \
  '[ "$rc" -eq 0 ] && [ "$(grep -l "stage checks.py part" "$work"/ssm/*/comment | wc -l | tr -d " ")" -eq $(( (big_b64 + 6999) / 7000 )) ] && [ "$(sha "$repo/scripts/checks.py")" = "$(sha "$work/box/opt/insight-bot/checks.py")" ]'

# 3. a failed part installs nothing
new_box; sync STUB_FAIL_COMMENT="stage checks.py part 2/2"
check "failed part: exit 1, says nothing installed" '[ "$rc" -eq 1 ] && grep -q "part 2/2 failed; nothing installed" "$work/out"'
check "failed part: the box's files and SYNCED-FROM unchanged" 'untouched'
check "failed part: no install command sent" '[ "$(installs_sent)" -eq 0 ]'

# 4. a part corrupted in transit: the sha256 check refuses it
new_box; sync STUB_CORRUPT_COMMENT="stage checks.py part 1/2"
check "corrupt part: exit 1, the box said sha256 mismatch" '[ "$rc" -eq 1 ] && grep -q "sha256 mismatch" "$work"/ssm/*/err'
check "corrupt part: the box's files unchanged, no install command" 'untouched && [ "$(installs_sent)" -eq 0 ]'

# 5. a .new changed after staging: the install command re-checks every file before installing any
new_box; sync STUB_TAMPER_BEFORE_INSTALL=/opt/insight-bot/backup.sh.new
check "tampered .new: exit 1, the box's files and SYNCED-FROM unchanged" '[ "$rc" -eq 1 ] && untouched'

# 6. a dirty tree is refused before any SSM call
new_box; echo "# dirty" >>"$repo/scripts/deploy.sh"; sync
check "dirty tree: exit 1, no SSM command" '[ "$rc" -eq 1 ] && [ -z "$(ls "$work/ssm")" ] && untouched'
git -C "$work/repo" checkout -q -- .

# 7. a chunk size past one command is refused
new_box; sync SYNC_BOX_CHUNK_B64=95000
check "chunk 95000 refused before any SSM command" '[ "$rc" -eq 1 ] && [ -z "$(ls "$work/ssm")" ]'

[ "$fail" -eq 0 ] && echo "sync-box.test.sh: all passed" || { echo "sync-box.test.sh: FAILED"; exit 1; }
