#!/usr/bin/env bash
#
# Shared facts about our environments, sourced by apply.sh and seal.sh.
#
# The namespace mapping lives here rather than in each script because sealing a
# secret into the wrong namespace fails silently: SealedSecrets are sealed with
# `strict` scope, which binds the ciphertext to one namespace AND one name. A
# manifest sealed for the wrong namespace is not rejected at apply time — the
# controller simply never produces a Secret, and the first symptom is a pod
# stuck waiting for one. Two copies of this `case` drifting apart is exactly the
# bug that would cause.

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# Names of the externally-managed Secrets. These deliberately do NOT match the
# names the chart used to render (`gitlaunch`, `gitlaunch-mongodb`): during the
# migration Helm prunes the Secrets it owned, and reusing those names would have
# Helm deleting resources the SealedSecret controller had just created.
APP_SECRET_NAME="gitlaunch-app-secrets"
MONGODB_SECRET_NAME="gitlaunch-mongodb-secrets"

# The GHCR pull credential. Referenced by `imagePullSecrets` in every
# environment's values.yaml, because the package inherits `private` from the
# repository — see deploy/envs/README.md.
REGISTRY_SECRET_NAME="gitlaunch-ghcr-secrets"

# Where the release image lives, and who to authenticate to it as. The registry
# host has to agree with the `image.repository` prefix in the values files or the
# kubelet finds no matching credential and reports the pull as unauthorized.
REGISTRY_HOST="ghcr.io"
REGISTRY_IMAGE="$REGISTRY_HOST/donedgardo/gitlaunch"

# What `org.opencontainers.image.source` gets stamped with locally, matching the
# label CI derives from `github.repository`. It is how GHCR knows which
# repository a package belongs to, and therefore who is allowed to pull it — the
# package is named gitlaunch and the repository launchpad, so nothing else links
# them. A locally built image is never pushed, but it carries the same label so
# a pod's provenance reads the same wherever the image came from.
SOURCE_URL="https://github.com/donedgardo/gitlaunch"

# Namespace for an environment. Fails loudly on an unknown name so a typo
# cannot quietly target the default namespace.
env_namespace() {
  case "${1:-}" in
    local)  echo gitlaunch-local ;;
    onprem) echo onprem ;;
    *)
      echo "unknown environment '${1:-}' (expected: local, onprem)" >&2
      return 64
      ;;
  esac
}

env_values_file() {
  echo "$REPO_ROOT/deploy/envs/$1/values.yaml"
}

env_secrets_dir() {
  echo "$REPO_ROOT/deploy/envs/$1/secrets"
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 && return 0
  echo "error: '$1' is not installed. $2" >&2
  return 127
}
