#!/usr/bin/env bash
#
# Install the two controllers our environments need into the kind `lab` cluster,
# then register the Applications.
#
#   deploy/argocd/bootstrap.sh                 # install everything
#   deploy/argocd/bootstrap.sh --revision <br> # track a branch instead of main
#
# This is bootstrap, so it is imperative on purpose: it is the code that runs
# before there is a reconciler to run anything. Everything it installs is
# either upstream (pinned below) or generated from a credential that must not be
# committed. Our own desired state lives in applications/ and is declarative.
set -euo pipefail

# Pinned rather than "latest": an unpinned bootstrap means the cluster you get
# depends on the day you ran it, which is the property GitOps exists to remove.
ARGOCD_VERSION="${ARGOCD_VERSION:-v2.13.2}"
SEALED_SECRETS_VERSION="${SEALED_SECRETS_VERSION:-v0.27.1}"

REVISION="main"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --revision) REVISION="${2:?--revision needs a branch or tag}"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 64 ;;
  esac
done

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT_ENVS="$(cd "$HERE/../envs" && pwd)"
CONTEXT="${KUBE_CONTEXT:-kind-lab}"
kubectl config use-context "$CONTEXT" >/dev/null

echo "==> context: $CONTEXT"

# ---------------------------------------------------------------------------
# 1. Sealed Secrets, before Argo CD.
#
# Argo CD will try to sync Applications the moment they exist, and those
# Applications contain SealedSecrets. Without the controller present the
# SealedSecret applies fine and simply never becomes a Secret, so the failure
# shows up as pods that cannot start rather than as anything mentioning secrets.
# ---------------------------------------------------------------------------
echo "==> installing sealed-secrets $SEALED_SECRETS_VERSION"
kubectl apply -f \
  "https://github.com/bitnami-labs/sealed-secrets/releases/download/${SEALED_SECRETS_VERSION}/controller.yaml"
kubectl rollout status deployment/sealed-secrets-controller -n kube-system --timeout=180s

cat <<'EOF'

    The controller just generated a private key, in-cluster, that is the ONLY
    thing that can decrypt everything under deploy/envs/*/secrets/. It is not in
    git and cannot be — that is the point. Back it up now, out of band:

      deploy/argocd/backup-sealing-key.sh > ~/gitlaunch-sealing-key.yaml

    Lose the cluster without that file and every committed SealedSecret becomes
    permanently undecryptable. See deploy/envs/README.md.

EOF

# ---------------------------------------------------------------------------
# 2. Argo CD
# ---------------------------------------------------------------------------
echo "==> installing argo cd $ARGOCD_VERSION"
kubectl create namespace argocd --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -n argocd -f \
  "https://raw.githubusercontent.com/argoproj/argo-cd/${ARGOCD_VERSION}/manifests/install.yaml"
kubectl rollout status deployment/argocd-repo-server -n argocd --timeout=300s
kubectl rollout status deployment/argocd-server      -n argocd --timeout=300s

# ---------------------------------------------------------------------------
# 3. Repository credentials.
#
# launchpad is a private repo, so Argo cannot read its own desired state until
# something hands it a credential. This is the one bootstrap secret that cannot
# be sealed into the repo: sealing it there would require Argo to already be
# able to read the repo it needs the credential to read.
# ---------------------------------------------------------------------------
if [[ -n "${GITHUB_TOKEN:-}" ]]; then
  echo "==> registering repository credentials from \$GITHUB_TOKEN"
  kubectl create secret generic launchpad-repo \
    --namespace argocd \
    --from-literal=type=git \
    --from-literal=url=https://github.com/donedgardo/gitlaunch.git \
    --from-literal=username=git \
    --from-literal=password="$GITHUB_TOKEN" \
    --dry-run=client -o yaml \
    | kubectl label --local -f - argocd.argoproj.io/secret-type=repository -o yaml \
    | kubectl apply -f -
else
  echo "!!  GITHUB_TOKEN is not set — skipping repository credentials." >&2
  echo "!!  Applications will sync-fail with a 401 until you set one and re-run:" >&2
  echo "!!    GITHUB_TOKEN=ghp_... deploy/argocd/bootstrap.sh" >&2
fi

# ---------------------------------------------------------------------------
# 4. Our Applications
#
# Refuse first if an environment has no sealed secrets committed. These
# Applications sync automatically with prune: true, and the values files they
# point at tell the chart to render no Secret. Register them against an
# environment that has not been migrated yet and the first sync deletes the
# chart-owned Secrets — including the encryption key every stored credential in
# that environment depends on — with nothing to replace them.
#
# This is the one irreversible mistake available here, so it is a hard stop
# rather than a warning.
# ---------------------------------------------------------------------------
# The check is against the REVISION Argo will fetch, not the working tree. Argo
# pulls from the remote and cannot see local files, so "I just sealed these"
# says nothing about what a sync will apply. A working-tree check would pass
# happily while Argo went off and synced a pre-migration commit.
git -C "$REPO_ROOT_ENVS" fetch --quiet origin "$REVISION" 2>/dev/null || true

for env in local onprem; do
  # --full-tree because ls-tree resolves pathspecs relative to the working
  # directory, and this runs from deploy/. Without it the path becomes
  # deploy/envs/deploy/envs/... , matches nothing, and the guard fires on a
  # correctly migrated environment — which is how this was found.
  sealed_at_revision="$(git -C "$REPO_ROOT_ENVS" ls-tree --full-tree --name-only \
    "origin/$REVISION" "deploy/envs/$env/secrets/" 2>/dev/null | grep -c '\.sealed\.yaml$' || true)"

  if [[ "${sealed_at_revision:-0}" -eq 0 ]]; then
    cat >&2 <<EOF

refusing to register applications: origin/$REVISION has no sealed secrets for '$env'.

  Argo CD fetches from the remote, so this is about what is PUSHED, not what is
  in your working tree. At origin/$REVISION there are no
  deploy/envs/$env/secrets/*.sealed.yaml files.

  Syncing that revision would apply a values.yaml from before the migration,
  which has the chart generate its own secrets — minting a fresh encryption key
  and stranding every credential already encrypted under the current one.

  Fix: commit and push the sealed secrets and the matching values.yaml, then
  re-run with --revision pointing at that branch.

  See deploy/envs/README.md#migrating-an-environment-that-is-already-running.
EOF
    exit 1
  fi
done

echo "==> registering applications (targetRevision: $REVISION)"
for f in "$HERE"/applications/*.yaml; do
  if [[ "$REVISION" == "main" ]]; then
    kubectl apply -n argocd -f "$f"
  else
    # Track a feature branch without editing the committed desired state. The
    # files say `main` because that is what they should say once this merges.
    sed "s|targetRevision: main|targetRevision: $REVISION|g" "$f" | kubectl apply -n argocd -f -
  fi
done

echo
echo "==> admin password:"
kubectl -n argocd get secret argocd-initial-admin-secret \
  -o go-template='{{index .data "password" | base64decode}}{{"\n"}}' 2>/dev/null \
  || echo "    (already rotated or deleted)"
cat <<EOF

==> UI:  kubectl port-forward svc/argocd-server -n argocd 8081:443
         https://localhost:8081  (user: admin)

Note: the kind cluster runs images side-loaded by deploy/envs/build-image.sh
with pullPolicy: Never. Argo reconciles the image TAG in git; it cannot fetch
the image. Build and load before promoting to a tag that is not on the node yet.
EOF
