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
#
# This is the shortcut, not the source of truth. The image an environment is
# meant to run is the one CI publishes to GHCR, tagged `sha-<full commit>`;
# what this builds is the same Dockerfile under a short tag, side-loaded into
# kind so `pullPolicy: IfNotPresent` finds it without a registry round trip.
# The two tag widths can therefore never collide, and a `docker images` listing
# says plainly which of the two is running. Nothing here ever pushes: publishing
# under our name is CI's job, from a commit that passed the quality gates.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

# shellcheck source=lib.sh
source "$REPO_ROOT/deploy/envs/lib.sh"

# Registry-qualified, matching `image.repository` in the environment values. A
# bare `gitlaunch` was a name only this laptop could resolve, so an environment
# using it could not be running the artifact we ship.
IMAGE_REPO="${IMAGE_REPO:-$REGISTRY_IMAGE}"
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
    --label "org.opencontainers.image.source=$SOURCE_URL" \
    -t "$IMAGE_REPO:$TAG" \
    "$REPO_ROOT"
fi

echo "==> loading into kind cluster '$KIND_CLUSTER'"
kind load docker-image "$IMAGE_REPO:$TAG" --name "$KIND_CLUSTER"

echo
echo "Built and loaded: $IMAGE_REPO:$TAG"
echo "Point an environment at it by setting image.tag in deploy/envs/<env>/values.yaml,"
echo "then: deploy/envs/apply.sh <env>"
