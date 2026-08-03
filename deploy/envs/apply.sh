#!/usr/bin/env bash
#
# Stand-in reconciler: applies one environment's desired state from git.
#
#   deploy/envs/apply.sh local
#   deploy/envs/apply.sh onprem [--dry-run]
#
# This is what Argo CD or Flux replaces. Until then, running this by hand is
# what keeps the cluster equal to the repo — which also means the repo is only
# the source of truth if nobody runs `helm upgrade --set` behind its back.
set -euo pipefail

ENV_NAME="${1:-}"
shift || true

case "$ENV_NAME" in
  local)  NAMESPACE=gitlaunch-local ;;
  onprem) NAMESPACE=onprem ;;
  *)
    echo "usage: $0 <local|onprem> [extra helm args]" >&2
    exit 64
    ;;
esac

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VALUES="$REPO_ROOT/deploy/envs/$ENV_NAME/values.yaml"
CHART="$REPO_ROOT/deploy/helm/gitlaunch"

# Report to GitLaunch with the same protocol .github/workflows/deploy.yml uses,
# so these environments show up on the dashboard like any other deploy. The
# buildId is the app source commit, recovered from the image tag — the tag is
# `sha-<short>`, and the API wants the full SHA.
#
# Unset credentials mean no reporting, not a failure: applying an environment
# must not depend on a running GitLaunch.
GITLAUNCH_API_URL="${GITLAUNCH_API_URL:-https://gitlaunch.dev}"
GITLAUNCH_ENVIRONMENT="${GITLAUNCH_ENVIRONMENT:-$ENV_NAME}"

IMAGE_TAG="$(awk '/^image:/{f=1; next} f && /^  tag:/{print $2; exit}' "$VALUES")"
BUILD_ID="$(git -C "$REPO_ROOT" rev-parse "${IMAGE_TAG#sha-}" 2>/dev/null || echo "")"

report() {
  local status="$1"
  [[ -n "${GITLAUNCH_API_KEY:-}" && -n "${GITLAUNCH_SERVICE_ID:-}" && -n "$BUILD_ID" ]] || return 0
  # Never let a reporting failure decide whether the deploy succeeded.
  curl --fail-with-body -sS -X PATCH \
    "$GITLAUNCH_API_URL/api/v1/services/$GITLAUNCH_SERVICE_ID/builds/$BUILD_ID/deploy/$GITLAUNCH_ENVIRONMENT" \
    -H "Authorization: Bearer $GITLAUNCH_API_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"status\":\"$status\"}" >/dev/null || echo "warning: could not report '$status' to GitLaunch" >&2
}

echo "==> $ENV_NAME -> namespace $NAMESPACE (context: $(kubectl config current-context))"
if [[ -n "${GITLAUNCH_API_KEY:-}" && -n "${GITLAUNCH_SERVICE_ID:-}" ]]; then
  if [[ -n "$BUILD_ID" ]]; then
    echo "==> reporting build ${BUILD_ID:0:7} to $GITLAUNCH_API_URL as '$GITLAUNCH_ENVIRONMENT'"
  else
    echo "warning: image tag '$IMAGE_TAG' is not a commit this repo knows — not reporting" >&2
  fi
fi

report deploying
trap 'report error' ERR

# --install so a deleted environment comes back from git alone; the release name
# is the same in every namespace because the namespace is what separates them.
helm upgrade --install gitlaunch "$CHART" \
  --namespace "$NAMESPACE" \
  --create-namespace \
  --values "$VALUES" \
  --wait \
  --timeout 5m \
  "$@"

trap - ERR
report deployed
