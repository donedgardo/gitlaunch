#!/usr/bin/env bash
#
# Encrypted, versioned secrets for our own environments.
#
#   deploy/envs/seal.sh adopt  <env>              one-shot migration off chart generation
#   deploy/envs/seal.sh set    <env> app|mongodb <KEY>   set one key, value on stdin
#   deploy/envs/seal.sh verify <env>              do the committed files match the cluster?
#
# The output is committed. A SealedSecret holds ciphertext only decryptable by
# the controller's private key, which never leaves the cluster, so the config
# repo can carry secrets under the same review, history and revert as the rest
# of an environment. That is the whole reason for choosing this over pointing at
# an external store: `git revert` restores a secret to its prior VALUE, not just
# to a prior reference. See deploy/envs/README.md.
set -euo pipefail

# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

# Where bootstrap.sh installs the controller. kubeseal has to reach it to fetch
# the public key, so these must agree with deploy/argocd/bootstrap.sh.
CONTROLLER_NS="${SEALED_SECRETS_NAMESPACE:-kube-system}"
CONTROLLER_NAME="${SEALED_SECRETS_CONTROLLER:-sealed-secrets-controller}"

usage() {
  sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit 64
}

# Emit a Secret manifest whose data is copied verbatim, still base64, out of a
# Secret already in the cluster. Nothing is decoded, so no plaintext is ever
# written to disk or passed through argv where `ps` could see it.
copy_live_secret() {
  local src="$1" dest="$2" ns="$3"
  kubectl get secret "$src" -n "$ns" >/dev/null 2>&1 || {
    echo "error: Secret '$src' not found in namespace '$ns'." >&2
    echo "       adopt migrates an environment that is already running under the" >&2
    echo "       chart's generated secrets. For a brand new environment, use 'set'." >&2
    return 1
  }
  printf 'apiVersion: v1\nkind: Secret\nmetadata:\n  name: %s\n  namespace: %s\ntype: Opaque\ndata:\n' "$dest" "$ns"
  kubectl get secret "$src" -n "$ns" -o go-template='{{range $k, $v := .data}}  {{$k}}: {{$v}}
{{end}}'
}

seal() {
  kubeseal --format yaml \
    --controller-namespace "$CONTROLLER_NS" \
    --controller-name "$CONTROLLER_NAME"
}

cmd_adopt() {
  local env="${1:-}"; [[ -n "$env" ]] || usage
  local ns; ns="$(env_namespace "$env")"
  local dir; dir="$(env_secrets_dir "$env")"
  mkdir -p "$dir"

  # Order matters and is the entire point of this command. The values being
  # copied are the ones the running environment is ALREADY using: the encryption
  # key that every stored credential in this environment's MongoDB is encrypted
  # under, and the password that database was initialised with. Generating fresh
  # ones here instead would leave both unreadable. Capture first, cut over after.
  echo "==> reading live secrets from namespace $ns"
  copy_live_secret gitlaunch          "$APP_SECRET_NAME"     "$ns" | seal > "$dir/app.sealed.yaml"
  copy_live_secret gitlaunch-mongodb  "$MONGODB_SECRET_NAME" "$ns" | seal > "$dir/mongodb.sealed.yaml"

  echo "==> wrote $dir/app.sealed.yaml"
  echo "==> wrote $dir/mongodb.sealed.yaml"
  cat <<EOF

These files are ciphertext and are meant to be committed.

Next, in this order:
  1. kubectl apply -f $dir            # Secrets exist before anything needs them
  2. set secrets.existingSecret / mongodb.auth.existingSecret / autoGenerate:false
     in deploy/envs/$env/values.yaml, then deploy/envs/apply.sh $env
  3. deploy/envs/seal.sh verify $env

Step 1 before step 2: the apply in step 2 prunes the Secrets the chart used to
own, and the pods must have somewhere else to read from before that happens.
EOF
}

cmd_set() {
  local env="${1:-}" which="${2:-}" key="${3:-}"
  [[ -n "$env" && -n "$which" && -n "$key" ]] || usage
  local ns; ns="$(env_namespace "$env")"
  local dir; dir="$(env_secrets_dir "$env")"
  mkdir -p "$dir"

  local name file
  case "$which" in
    app)     name="$APP_SECRET_NAME";     file="$dir/app.sealed.yaml" ;;
    mongodb) name="$MONGODB_SECRET_NAME"; file="$dir/mongodb.sealed.yaml" ;;
    *) echo "expected 'app' or 'mongodb', got '$which'" >&2; exit 64 ;;
  esac

  # Read the value from stdin rather than an argument: arguments are visible to
  # every process on the box via `ps`, and land in shell history.
  echo "reading value for $key from stdin (ctrl-d to end, no trailing newline is added)..." >&2
  local value; value="$(cat)"
  [[ -n "$value" ]] || { echo "error: refusing to seal an empty value for $key" >&2; exit 1; }

  if [[ -f "$file" ]]; then
    # --merge-into edits the existing ciphertext in place, leaving every other
    # key's ciphertext byte-identical. Without it, resealing one key would
    # rewrite the whole file and make the diff unreviewable.
    printf '%s' "$value" | kubectl create secret generic "$name" \
      --namespace "$ns" --dry-run=client -o yaml --from-file="$key=/dev/stdin" \
      | kubeseal --format yaml \
          --controller-namespace "$CONTROLLER_NS" \
          --controller-name "$CONTROLLER_NAME" \
          --merge-into "$file"
  else
    printf '%s' "$value" | kubectl create secret generic "$name" \
      --namespace "$ns" --dry-run=client -o yaml --from-file="$key=/dev/stdin" \
      | seal > "$file"
  fi
  echo "==> $key sealed into $file"
}

# Does what is committed still match what the cluster is running? A drifted
# secret is invisible otherwise: pods keep working off the live Secret, and the
# repo quietly stops being able to rebuild the environment.
cmd_verify() {
  local env="${1:-}"; [[ -n "$env" ]] || usage
  local ns; ns="$(env_namespace "$env")"
  local dir; dir="$(env_secrets_dir "$env")"
  local rc=0

  for pair in "$APP_SECRET_NAME:app" "$MONGODB_SECRET_NAME:mongodb"; do
    local name="${pair%%:*}" label="${pair##*:}"
    local file="$dir/$label.sealed.yaml"
    if [[ ! -f "$file" ]]; then
      echo "MISSING  $file"; rc=1; continue
    fi
    if ! kubectl get secret "$name" -n "$ns" >/dev/null 2>&1; then
      echo "NOT LIVE $name in $ns — committed but never applied"; rc=1; continue
    fi
    # Compare the key SETS, not the values: this runs on a laptop and printing
    # decrypted secrets to a terminal to diff them would defeat the exercise.
    #
    # Read only the block under spec.encryptedData. Matching on indentation
    # alone would also catch `template.type`, which sits at the same depth.
    local sealed live
    sealed="$(awk '
      /^  encryptedData:/ { inblock = 1; next }
      inblock && /^    [A-Za-z0-9_.-]+:/ { sub(/:.*/, "", $1); print $1; next }
      inblock && /^[^ ]|^  [A-Za-z]/ { inblock = 0 }
    ' "$file" | sort)"
    live="$(kubectl get secret "$name" -n "$ns" -o go-template='{{range $k, $v := .data}}{{$k}}
{{end}}' | sort)"
    if [[ "$sealed" == "$live" ]]; then
      echo "OK       $name ($(echo "$live" | grep -c . ) keys)"
    else
      echo "DRIFT    $name — committed and live hold different keys"
      diff <(echo "$sealed") <(echo "$live") | sed 's/^/         /' || true
      rc=1
    fi
  done
  return $rc
}

# Resolve the subcommand before checking for tools, so `seal.sh` with no
# arguments explains itself rather than complaining about a missing binary.
case "${1:-}" in
  adopt|set|verify) ;;
  *) usage ;;
esac

require_cmd kubectl "Install it, or see deploy/argocd/bootstrap.sh."
require_cmd kubeseal "Install with: brew install kubeseal — or grab a release binary from
       https://github.com/bitnami-labs/sealed-secrets/releases and put it on PATH."

case "$1" in
  adopt)  shift; cmd_adopt  "$@" ;;
  set)    shift; cmd_set    "$@" ;;
  verify) shift; cmd_verify "$@" ;;
esac
