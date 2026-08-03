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

echo "==> $ENV_NAME -> namespace $NAMESPACE (context: $(kubectl config current-context))"

# --install so a deleted environment comes back from git alone; the release name
# is the same in every namespace because the namespace is what separates them.
helm upgrade --install gitlaunch "$CHART" \
  --namespace "$NAMESPACE" \
  --create-namespace \
  --values "$VALUES" \
  --wait \
  --timeout 5m \
  "$@"
