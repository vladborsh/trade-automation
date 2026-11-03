#!/usr/bin/env bash
# What `ssm send-command` runs on the box (design §7 deploy path; ECR design E5, E10). Idempotent.
#
#   deploy.sh                 # deploys the tag in SSM /insight-bot/IMAGE_TAG
#   deploy.sh sha-9f2c1ab4d0e1 # deploys this tag instead (a rollback, or a test)
#
# 1. render /opt/insight-bot/.env from SSM   2. log in to ECR with the instance role   3. pull
# 4. up -d   5. health check
#
# The image lives in the private ECR repository `insight-bot` in this account and region. Its URL
# is derived here (account + region), not stored anywhere, and the tag is never `latest`: tags are
# immutable `sha-<12>` (E2), so the tag in a deploy log names exactly one image.
set -euo pipefail

REGION="${AWS_REGION:-ap-northeast-1}"
PREFIX="${SSM_PREFIX:-/insight-bot}"
DIR=/opt/insight-bot

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

echo "==> registry login (${REGISTRY}, instance role)"
aws ecr get-login-password --region "$REGION" | docker login "$REGISTRY" --username AWS --password-stdin >/dev/null

echo "==> pulling ${IMAGE}"
grep -q '^IMAGE=' "$DIR/.env" && sed -i '/^IMAGE=/d' "$DIR/.env"
printf "IMAGE='%s'\n" "$IMAGE" >>"$DIR/.env"

# The Cloudflare tunnel runs only once its token exists (RUNBOOK §11). Without it, cloudflared
# would exit and restart for ever, so it is not started at all.
SERVICES=(postgres insight-bot)
if grep -q '^TUNNEL_TOKEN=' "$DIR/cloudflared.env" 2>/dev/null; then
  SERVICES+=(cloudflared)
fi
docker compose pull "${SERVICES[@]}"

echo "==> starting: ${SERVICES[*]}"
docker compose up -d "${SERVICES[@]}"

echo "==> waiting for /health"
for _ in $(seq 1 30); do
  if docker compose exec -T insight-bot node -e 'fetch("http://127.0.0.1:3005/health").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))' 2>/dev/null; then
    echo "deploy.sh: healthy on ${IMAGE}"
    docker image prune -f >/dev/null || true
    exit 0
  fi
  sleep 5
done

echo "deploy.sh: /health did not answer within 150 s — see 'docker compose logs insight-bot'" >&2
exit 1
