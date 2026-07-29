#!/bin/bash

# Usage: ./scripts/add-private-key.sh path/to/private-key.pem
#
# Reads a GitHub App private key, escapes its newlines so it survives as a
# single .env value, and writes it to GH_APP_PRIVATE_KEY — replacing any
# entry already there.

set -euo pipefail

if [ -z "${1:-}" ]; then
  echo "Usage: $0 <path-to-pem-file>"
  exit 1
fi

PEM_FILE="$1"

if [ ! -f "$PEM_FILE" ]; then
  echo "Error: File '$PEM_FILE' not found"
  exit 1
fi

ENV_FILE=".env"

# Convert newlines to \n
PRIVATE_KEY=$(awk '{printf "%s\\n", $0}' "$PEM_FILE" | sed 's/\\n$//')

# .env is about to hold a private key, so create it unreadable to anyone else.
if [ ! -e "$ENV_FILE" ]; then
  (umask 077 && : > "$ENV_FILE")
fi

# Drop any existing entry, then append the new one.
#
# This goes through a temp file rather than `sed -i` because in-place editing
# is not portable: BSD sed (macOS) requires a backup suffix argument, while GNU
# sed only accepts one attached to the flag. `sed -i ''` works on macOS and, on
# Linux, makes GNU sed read '' as the script and the pattern as a filename.
TMP_FILE=$(mktemp "${ENV_FILE}.XXXXXX")  # mktemp creates it 0600
trap 'rm -f "$TMP_FILE"' EXIT

# grep exits 1 when nothing matches, which is fine here — it just means .env
# had no other lines. Any higher exit status is a real error worth failing on.
grep -v "^GH_APP_PRIVATE_KEY=" "$ENV_FILE" > "$TMP_FILE" || [ $? -eq 1 ]

echo "GH_APP_PRIVATE_KEY=\"$PRIVATE_KEY\"" >> "$TMP_FILE"

# Copy back through the original file so its permissions and inode survive,
# rather than moving the temp file over it.
cat "$TMP_FILE" > "$ENV_FILE"

echo "Private key added to $ENV_FILE"
