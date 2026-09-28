#!/usr/bin/env bash
# What `ssm send-command` runs on the box (design §7 deploy path). Idempotent.
#
#   deploy.sh <image-tag>     # e.g. deploy.sh sha-9f2c1ab   (default: latest)
#
# 1. render /opt/insight-bot/.env from SSM   2. log in to ECR   3. pull   4. up -d   5. health check
set -euo pipefail

TAG="${1:-latest}"
REGION="${AWS_REGION:-ap-northeast-1}"
DIR=/opt/insight-bot
REPO_URL="$(cat "$DIR/ecr-repo-url")"

cd "$DIR"

echo "==> rendering .env from SSM"
AWS_REGION="$REGION" "$DIR/render-env.sh"

echo "==> ECR login"
aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "${REPO_URL%%/*}"

echo "==> pulling ${REPO_URL}:${TAG}"
IMAGE="${REPO_URL}:${TAG}"
grep -q '^IMAGE=' "$DIR/.env" && sed -i '/^IMAGE=/d' "$DIR/.env"
printf "IMAGE='%s'\n" "$IMAGE" >>"$DIR/.env"
docker compose pull

echo "==> starting"
docker compose up -d --remove-orphans

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
