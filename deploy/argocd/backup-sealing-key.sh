#!/usr/bin/env bash
#
# Print the sealing keys to stdout. Redirect somewhere private, off this box.
#
#   deploy/argocd/backup-sealing-key.sh > ~/gitlaunch-sealing-key.yaml
#
# This is the single point of failure in the whole arrangement, and it is the
# honest cost of keeping secrets in git rather than in an external store: the
# private key lives only in the cluster, so `kind delete cluster` destroys the
# ability to decrypt every SealedSecret in this repo. The ciphertext survives in
# git and becomes worthless.
#
# Restore into a rebuilt cluster BEFORE syncing anything:
#
#   kubectl apply -f ~/gitlaunch-sealing-key.yaml
#   kubectl delete pod -n kube-system -l name=sealed-secrets-controller
#
# The controller only loads keys at startup, hence the delete.
#
# The controller also mints a fresh key every 30 days and keeps the old ones for
# decryption, so this backup goes stale for NEW secrets. Re-run it after
# rotating anything, or on whatever cadence you would otherwise forget.
set -euo pipefail

CONTROLLER_NS="${SEALED_SECRETS_NAMESPACE:-kube-system}"

if [[ -t 1 ]]; then
  echo "refusing to print private keys to a terminal — redirect to a file:" >&2
  echo "  $0 > ~/gitlaunch-sealing-key.yaml" >&2
  exit 1
fi

kubectl get secret -n "$CONTROLLER_NS" \
  -l sealedsecrets.bitnami.com/sealed-secrets-key \
  -o yaml
