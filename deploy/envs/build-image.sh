#!/usr/bin/env bash
#
# Build the app image under an immutable, traceable tag and load it into the
# kind cluster.
#
#   deploy/envs/build-image.sh              # tag from HEAD
#   deploy/envs/build-image.sh --print-tag  # just echo the tag it would build
#
# The tag is `sha-<short commit>`, and nothing ever rebuilds an existing tag.
# That is what makes `git revert` on an environment's values.yaml an actual
# rollback: the old tag still names the old bits. A moving tag like `latest`
# turns rollback into a no-op that looks like it worked.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

IMAGE_REPO="${IMAGE_REPO:-gitlaunch}"
KIND_CLUSTER="${KIND_CLUSTER:-lab}"
ALLOW_DIRTY="${ALLOW_DIRTY:-0}"

# Only files the Dockerfile actually COPYs affect the image. A tag claiming to
# be commit X must have been built from commit X, so refuse to guess when any
# of them are uncommitted.
BUILD_INPUTS=(package.json yarn.lock tsconfig.json src @types tailwind.config.js Dockerfile)

REVISION="$(git rev-parse HEAD)"
TAG="sha-$(git rev-parse --short HEAD)"

if [[ "${1:-}" == "--print-tag" ]]; then
  echo "$IMAGE_REPO:$TAG"
  exit 0
fi

if [[ -n "$(git status --porcelain -- "${BUILD_INPUTS[@]}")" && "$ALLOW_DIRTY" != "1" ]]; then
  echo "error: uncommitted changes to files that go into the image:" >&2
  git status --short -- "${BUILD_INPUTS[@]}" >&2
  echo "Commit them first, or set ALLOW_DIRTY=1 to build an untraceable tag." >&2
  exit 1
fi

if docker image inspect "$IMAGE_REPO:$TAG" >/dev/null 2>&1; then
  echo "==> $IMAGE_REPO:$TAG already built — not rebuilding (tags are immutable)"
else
  echo "==> building $IMAGE_REPO:$TAG"
  # Labels are the only provenance a locally built image carries; without them
  # a running pod cannot be traced back to a commit.
  docker build \
    --label "org.opencontainers.image.revision=$REVISION" \
    --label "org.opencontainers.image.source=https://github.com/donedgardo/launchpad" \
    -t "$IMAGE_REPO:$TAG" \
    "$REPO_ROOT"
fi

echo "==> loading into kind cluster '$KIND_CLUSTER'"
kind load docker-image "$IMAGE_REPO:$TAG" --name "$KIND_CLUSTER"

echo
echo "Built and loaded: $IMAGE_REPO:$TAG"
echo "Point an environment at it by setting image.tag in deploy/envs/<env>/values.yaml,"
echo "then: deploy/envs/apply.sh <env>"
