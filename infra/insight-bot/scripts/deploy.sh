#!/usr/bin/env bash
# What `ssm send-command` runs on the box (design §7 deploy path; ECR design E5, E10). Idempotent.
#
#   deploy.sh                 # deploys the tag in SSM /insight-bot/IMAGE_TAG
#   deploy.sh sha-9f2c1ab4d0e1 # deploys this tag instead (a rollback, or a test)
#
# 1. render /opt/insight-bot/.env from SSM   2. log in to ECR with the instance role   3. pull
# 4. up -d   5. health check (GET /healthz from inside the app container)
# 6. IB-139: start the 30-min post-deploy watch (deploy-watch.py) as a transient systemd unit, after
#    stopping (SUPERSEDED) any watch still running. A deploy that fails tells the owner once instead.
#
# The image lives in the private ECR repository `insight-bot` in this account and region. Its URL
# is derived here (account + region), not stored anywhere, and the tag is never `latest`: tags are
# immutable `sha-<12>` (E2), so the tag in a deploy log names exactly one image.
set -euo pipefail

REGION="${AWS_REGION:-ap-northeast-1}"
PREFIX="${SSM_PREFIX:-/insight-bot}"
DIR="${DEPLOY_DIR:-/opt/insight-bot}" # overridden only by scripts/deploy.test.sh

TAG="${1:-}"
if [ -z "$TAG" ]; then
  TAG="$(aws ssm get-parameter --region "$REGION" --name "${PREFIX}/IMAGE_TAG" \
    --query Parameter.Value --output text 2>/dev/null || true)"
fi
case "$TAG" in
  sha-*) ;;
  *)
    echo "deploy.sh: refusing image tag '${TAG}' — give sha-<commit> or set ${PREFIX}/IMAGE_TAG (never latest)" >&2
    exit 2
    ;;
esac

SHORT="${TAG#sha-}"
DEPLOY_START="$(date +%s)"
WATCH_SCRIPT="${WATCH_SCRIPT:-$DIR/deploy-watch.py}"
WATCH_DIR="${WATCH_DIR:-/var/log/insight-watch}"

# IB-139 (Architect gap 3): the rollback target is the tag running BEFORE this deploy. render-env.sh
# rewrites .env from SSM, which drops IMAGE=, so it is read here, first. The watch and the failure
# message carry it as the exact rollback command; nothing here ever runs it.
PREV_IMAGE="$(sed -n "s/^IMAGE='\(.*\)'$/\1/p" "$DIR/.env" 2>/dev/null | tail -n 1 || true)"
PREV_TAG="${PREV_IMAGE##*:}"
case "$PREV_TAG" in sha-*) ;; *) PREV_TAG=unknown ;; esac

# IB-139 (Architect gap 5): a deploy that fails after this point — /healthz never answering above all —
# sends the owner ONE message (operator chat), because nobody is watching then. Never masks the exit code.
STEP="AWS identity (sts)"
notify_failed() {
  local rc=$?
  if [ "$rc" -ne 0 ] && [ -f "$WATCH_SCRIPT" ]; then
    python3 -I "$WATCH_SCRIPT" notify-failed --tag "$TAG" --prev "$PREV_TAG" --step "$STEP" || true
  fi
  exit "$rc"
}
trap notify_failed EXIT

ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
REGISTRY="${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com"
IMAGE="${REGISTRY}/insight-bot:${TAG}"

cd "$DIR"

echo "==> rendering .env from SSM"
STEP="render .env from SSM"
AWS_REGION="$REGION" "$DIR/render-env.sh"

# The bind-mounted parent of Postgres's data dir must be traversable by the postgres user, or the
# container restart-loops on "mkdir: Permission denied" (found at the first deploy, IB-083). Boxes
# bootstrapped before that fix have it 0700; this heals them, and is a no-op afterwards.
chmod 0711 "$DIR/pgdata"

echo "==> registry login (${REGISTRY}, instance role)"
STEP="ECR login"
aws ecr get-login-password --region "$REGION" | docker login "$REGISTRY" --username AWS --password-stdin >/dev/null

echo "==> pulling ${IMAGE}"
STEP="pull ${TAG}"
grep -q '^IMAGE=' "$DIR/.env" && sed -i '/^IMAGE=/d' "$DIR/.env"
printf "IMAGE='%s'\n" "$IMAGE" >>"$DIR/.env"

# Caddy (https-without-domain H1) runs once tofu has written /insight-bot/SITE_ADDRESS; before that
# it would have no site to serve. cloudflared is dormant behind the `tunnel` profile (H9).
SERVICES=(postgres insight-bot)
PROFILES=()
if grep -q '^SITE_ADDRESS=' "$DIR/caddy.env" 2>/dev/null; then
  SERVICES+=(caddy)
fi
if grep -q '^TUNNEL_TOKEN=' "$DIR/cloudflared.env" 2>/dev/null; then
  SERVICES+=(cloudflared)
  PROFILES=(--profile tunnel)
fi
docker compose ${PROFILES[@]+"${PROFILES[@]}"} pull "${SERVICES[@]}"

echo "==> starting: ${SERVICES[*]}"
STEP="docker compose up"
docker compose ${PROFILES[@]+"${PROFILES[@]}"} up -d "${SERVICES[@]}"

# IB-142: apply the Caddyfile sync-box installed, with no downtime. `up -d` does not recreate caddy for a
# Caddyfile edit (the compose file is unchanged), and the container bind-mounts that ONE file: sync-box's
# `install` gives it a new inode, so /etc/caddy/Caddyfile inside the container is still the OLD file
# (IB-BUG-031 needed --force-recreate, seconds without https). So the host file goes in on stdin: a graceful
# reload — in-flight requests finish, nothing is dropped — and a no-op when the config is unchanged. A
# Caddyfile that does not adapt is refused by Caddy, which keeps serving the old config; the deploy then
# fails here and the owner is told. A fresh container may not have its admin endpoint up yet: 3 tries.
if [[ " ${SERVICES[*]} " == *" caddy "* ]]; then
  echo "==> caddy reload (the synced Caddyfile, graceful)"
  STEP="caddy reload (Caddy keeps serving its previous config)"
  for try in 1 2 3; do
    if docker compose exec -T caddy caddy reload --config /dev/stdin --adapter caddyfile <"$DIR/Caddyfile"; then
      break
    fi
    [ "$try" -lt 3 ] || exit 1
    sleep 2
  done
fi

# IB-139: one watch at a time. A running one is told it was superseded (the marker file), then stopped
# by unit name; it writes SUPERSEDED itself. WATCH_LAUNCHER is the test seam (deploy.test.sh has no
# systemd): it replaces systemd-run and receives the exact launch line.
start_watch() {
  local unit old
  for unit in $(systemctl list-units --plain --no-legend --state=active 'insight-watch-*' 2>/dev/null | awk '{print $1}'); do
    old="${unit#insight-watch-}"
    old="${old%.service}"
    mkdir -p "$WATCH_DIR"
    echo "$TAG" >"$WATCH_DIR/${old}.superseded-by"
    echo "==> superseding the running watch ${unit}"
    systemctl stop "$unit" || true
  done
  echo "==> starting the 30-min watch insight-watch-${SHORT} (verdict in ${WATCH_DIR}/${SHORT}.json)"
  ${WATCH_LAUNCHER:-systemd-run} --unit "insight-watch-${SHORT}" --collect --quiet \
    -p MemoryMax=128M -p Nice=10 --setenv=DEPLOY_DIR="$DIR" --setenv=WATCH_DIR="$WATCH_DIR" \
    /usr/bin/python3 -I "$WATCH_SCRIPT" watch --tag "$TAG" --prev "$PREV_TAG" --deploy-start "$DEPLOY_START" ||
    echo "deploy.sh: WARNING — the watch did not start; this deploy is unwatched (the waiter will say watch_lost)" >&2
}

# WD-011: the liveness probe is /healthz ({"status":"ok"}). /health is now the dashboard's page and
# would answer 200 with index.html. Only r.ok is checked, not the body, so a rollback to an image
# from before WD-011 still passes: on such an image /healthz is answered by the SPA fallback with
# 200, which proves exactly what the old /health check proved (the process is serving). On a
# WD-011+ image, a /healthz route that went missing is a 404 (it is excluded from the SPA fallback),
# so this check fails. Proved both ways by scripts/deploy.test.sh.
echo "==> waiting for /healthz"
STEP="/healthz did not answer within 150 s"
for _ in $(seq 1 30); do
  if docker compose exec -T insight-bot node -e 'fetch("http://127.0.0.1:3005/healthz").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))' 2>/dev/null; then
    echo "deploy.sh: healthy on ${IMAGE}"
    docker image prune -f >/dev/null || true
    STEP="done"
    start_watch
    exit 0
  fi
  sleep 5
done

echo "deploy.sh: /healthz did not answer within 150 s — see 'docker compose logs insight-bot'" >&2
exit 1
