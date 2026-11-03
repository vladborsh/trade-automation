#!/usr/bin/env bash
# Push one linux/arm64 insight-bot image to ECR by hand (ECR design E7). The CI workflow does the
# same thing; this is the first image and the fallback when Actions is unavailable.
#
#   infra/insight-bot/scripts/push-image.sh [<commit>]          # default: HEAD
#   LOCAL_IMAGE=<ref> infra/insight-bot/scripts/push-image.sh <commit>
#
# - Refuses a dirty working tree: what is pushed must be a commit someone can check out.
# - Builds from `git archive <commit>` in a temporary directory, so nothing untracked or ignored in
#   this checkout (node_modules, .env files, dist) can reach the image. LOCAL_IMAGE skips the build
#   and pushes an image built earlier, but only if its org.opencontainers.image.revision label is
#   exactly that commit and it is linux/arm64.
# - Tags `sha-<first 12 of the commit>` only (E2: immutable tags, no latest). Refuses when the tag
#   already exists in ECR rather than letting the push fail half way.
# - After a successful push, writes the tag to SSM /insight-bot/IMAGE_TAG (E10): the next
#   deploy.sh without an argument deploys it. It does NOT deploy.
#
# Uses AWS profile `insight-bot` unless AWS_PROFILE is set. Never prints a credential.
set -euo pipefail

export AWS_PROFILE="${AWS_PROFILE:-insight-bot}"
REGION="${AWS_REGION:-ap-northeast-1}"
REPO_NAME=insight-bot
PARAM="${SSM_PREFIX:-/insight-bot}/IMAGE_TAG"

ROOT="$(git rev-parse --show-toplevel)"
COMMIT="$(git -C "$ROOT" rev-parse --verify "${1:-HEAD}^{commit}")"
TAG="sha-${COMMIT:0:12}"

if [ -n "$(git -C "$ROOT" status --porcelain)" ]; then
  echo "push-image.sh: the working tree is dirty — commit or stash first" >&2
  exit 1
fi

ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
REGISTRY="${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com"
TARGET="${REGISTRY}/${REPO_NAME}:${TAG}"

if aws ecr describe-images --region "$REGION" --repository-name "$REPO_NAME" \
  --image-ids imageTag="$TAG" >/dev/null 2>&1; then
  echo "push-image.sh: ${TAG} is already in ECR (tags are immutable) — nothing to push" >&2
  exit 1
fi

if [ -n "${LOCAL_IMAGE:-}" ]; then
  rev="$(docker image inspect "$LOCAL_IMAGE" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')"
  if [ "$rev" != "$COMMIT" ]; then
    echo "push-image.sh: ${LOCAL_IMAGE} is labelled revision '${rev}', not ${COMMIT}" >&2
    exit 1
  fi
  SOURCE="$LOCAL_IMAGE"
else
  work="$(mktemp -d)"
  trap 'rm -rf "$work"' EXIT
  echo "==> building ${TAG} from git archive ${COMMIT} (linux/arm64)"
  git -C "$ROOT" archive "$COMMIT" | tar -x -C "$work"
  SOURCE="insight-bot:${TAG}"
  docker buildx build --platform linux/arm64 --load \
    --label "org.opencontainers.image.revision=${COMMIT}" \
    -f "$work/apps/insight-bot/Dockerfile" -t "$SOURCE" "$work"
fi

platform="$(docker image inspect "$SOURCE" --format '{{.Os}}/{{.Architecture}}')"
if [ "$platform" != "linux/arm64" ]; then
  echo "push-image.sh: ${SOURCE} is ${platform}, the box is linux/arm64" >&2
  exit 1
fi

echo "==> pushing ${TARGET}"
aws ecr get-login-password --region "$REGION" | docker login "$REGISTRY" --username AWS --password-stdin >/dev/null
docker tag "$SOURCE" "$TARGET"
docker push "$TARGET"

digest="$(aws ecr describe-images --region "$REGION" --repository-name "$REPO_NAME" \
  --image-ids imageTag="$TAG" --query 'imageDetails[0].imageDigest' --output text)"
echo "==> pushed ${TAG} (${digest})"

aws ssm put-parameter --region "$REGION" --name "$PARAM" --type String --value "$TAG" --overwrite >/dev/null
echo "==> ${PARAM} = ${TAG} (deploy.sh without an argument now deploys it)"
