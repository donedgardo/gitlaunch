#!/usr/bin/env bash
# Materialise an example into a throwaway git repo so the gitlaunch-onboarding
# skill can be run against it end to end (branch, commit, PR).
#
#   ./examples/new-sandbox.sh dummy-react-app
#   ./examples/new-sandbox.sh dummy-react-app --push donedgardo/gl-sandbox-react
#   ./examples/new-sandbox.sh dummy-rust-service --push donedgardo/gl-sandbox-rust
#
# Without --push the sandbox is local only: the skill can still detect, write
# files and commit, but `gh pr create` and the deploy binding need a remote.
set -euo pipefail

example="${1:-}"
if [ -z "$example" ]; then
  echo "usage: $0 <example-dir> [--push <owner/repo>]" >&2
  exit 1
fi
shift

push_to=""
if [ "${1:-}" = "--push" ]; then
  push_to="${2:-}"
  if [ -z "$push_to" ]; then
    echo "--push needs an <owner/repo>" >&2
    exit 1
  fi
fi

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
src="$here/$example"
if [ ! -d "$src" ]; then
  echo "no such example: $src" >&2
  exit 1
fi

dest="${SANDBOX_DIR:-${TMPDIR:-/tmp}/gitlaunch-sandbox-$example-$$}"
mkdir -p "$dest"

# Copy the example without build output or installed dependencies.
tar -C "$src" \
  --exclude=node_modules --exclude=dist --exclude=target \
  -cf - . | tar -C "$dest" -xf -

cd "$dest"
git init -q -b main
git add -A
git commit -qm "Initial commit"

echo "sandbox: $dest"

if [ -n "$push_to" ]; then
  gh repo create "$push_to" --private --source=. --remote=origin --push
  echo "remote:  $(git remote get-url origin)"
else
  cat <<EOF

No remote yet. To give it one:

  cd "$dest"
  gh repo create <owner>/<repo> --private --source=. --remote=origin --push
EOF
fi
