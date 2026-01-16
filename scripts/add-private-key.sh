#!/bin/bash

# Usage: ./scripts/add-private-key.sh path/to/private-key.pem

set -e

if [ -z "$1" ]; then
  echo "Usage: $0 <path-to-pem-file>"
  exit 1
fi

PEM_FILE="$1"

if [ ! -f "$PEM_FILE" ]; then
  echo "Error: File '$PEM_FILE' not found"
  exit 1
fi

# Convert newlines to \n and wrap in quotes
PRIVATE_KEY=$(awk '{printf "%s\\n", $0}' "$PEM_FILE" | sed 's/\\n$//')

# Check if GITHUB_APP_PRIVATE_KEY already exists in .env
if grep -q "^GITHUB_APP_PRIVATE_KEY=" .env 2>/dev/null; then
  # Replace existing key (macOS compatible sed)
  sed -i '' '/^GITHUB_APP_PRIVATE_KEY=/d' .env
fi

# Append the new key
echo "GITHUB_APP_PRIVATE_KEY=\"$PRIVATE_KEY\"" >> .env

echo "Private key added to .env"
