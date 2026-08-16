#!/usr/bin/env bash
# Ship dist/dummy-rust-service to the host for an environment and restart it.
#
#   ./scripts/deploy.sh staging v0.3.1
#
# Expects DEPLOY_HOST and DEPLOY_SSH_KEY in the environment.
set -euo pipefail

target="${1:?usage: deploy.sh <staging|production> <revision>}"
revision="${2:?usage: deploy.sh <staging|production> <revision>}"

case "$target" in
staging | production) ;;
*)
  echo "unknown target: $target" >&2
  exit 1
  ;;
esac

key="$(mktemp)"
trap 'rm -f "$key"' EXIT
printf '%s\n' "$DEPLOY_SSH_KEY" >"$key"
chmod 600 "$key"

remote="deploy@${DEPLOY_HOST}"
ssh_opts=(-i "$key" -o StrictHostKeyChecking=accept-new)

echo "deploying $revision to $target ($remote)"
scp "${ssh_opts[@]}" dist/dummy-rust-service "$remote:/opt/dummy-rust-service/bin/dummy-rust-service.new"
ssh "${ssh_opts[@]}" "$remote" \
  "sudo install -m 0755 /opt/dummy-rust-service/bin/dummy-rust-service.new /opt/dummy-rust-service/bin/dummy-rust-service \
   && sudo systemctl restart dummy-rust-service@${target}"

echo "deployed $revision to $target"
