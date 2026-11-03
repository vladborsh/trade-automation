#!/usr/bin/env bash
# What `ssm send-command` runs on the box (design §7 deploy path; ECR design E5, E10). Idempotent.
#
#   deploy.sh                 # deploys the tag in SSM /insight-bot/IMAGE_TAG
#   deploy.sh sha-9f2c1ab4d0e1 # deploys this tag instead (a rollback, or a test)
#
# 1. render /opt/insight-bot/.env from SSM   2. log in to ECR with the instance role   3. pull
# 4. up -d   5. health check (GET /healthz from inside the app container)
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

ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
REGISTRY="${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com"
IMAGE="${REGISTRY}/insight-bot:${TAG}"

cd "$DIR"

echo "==> rendering .env from SSM"
AWS_REGION="$REGION" "$DIR/render-env.sh"

# The bind-mounted parent of Postgres's data dir must be traversable by the postgres user, or the
# container restart-loops on "mkdir: Permission denied" (found at the first deploy, IB-083). Boxes
# bootstrapped before that fix have it 0700; this heals them, and is a no-op afterwards.
chmod 0711 "$DIR/pgdata"

echo "==> registry login (${REGISTRY}, instance role)"
aws ecr get-login-password --region "$REGION" | docker login "$REGISTRY" --username AWS --password-stdin >/dev/null

echo "==> pulling ${IMAGE}"
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
docker compose ${PROFILES[@]+"${PROFILES[@]}"} up -d "${SERVICES[@]}"

# WD-011: the liveness probe is /healthz ({"status":"ok"}). /health is now the dashboard's page and
# would answer 200 with index.html. Only r.ok is checked, not the body, so a rollback to an image
# from before WD-011 still passes: on such an image /healthz is answered by the SPA fallback with
# 200, which proves exactly what the old /health check proved (the process is serving). On a
# WD-011+ image, a /healthz route that went missing is a 404 (it is excluded from the SPA fallback),
# so this check fails. Proved both ways by scripts/deploy.test.sh.
echo "==> waiting for /healthz"
for _ in $(seq 1 30); do
  if docker compose exec -T insight-bot node -e 'fetch("http://127.0.0.1:3005/healthz").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))' 2>/dev/null; then
    echo "deploy.sh: healthy on ${IMAGE}"
    docker image prune -f >/dev/null || true
    exit 0
  fi
  sleep 5
done

echo "deploy.sh: /healthz did not answer within 150 s — see 'docker compose logs insight-bot'" >&2
exit 1
