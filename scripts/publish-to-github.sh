#!/usr/bin/env bash
# Run once after: gh auth login
set -euo pipefail
cd "$(dirname "$0")/.."

REPO="${1:-sencerhan/bitkurus-ledger-verifier}"

if ! gh auth status >/dev/null 2>&1; then
  echo "Önce: gh auth login"
  exit 1
fi

if git remote get-url origin >/dev/null 2>&1; then
  echo "origin zaten var: $(git remote get-url origin)"
else
  gh repo create "$REPO" --public \
    --description "Fast public auditor for BitKuruş ledger exports and federation nodes" \
    --source=. --remote=origin
fi

git push -u origin main
echo "Yayınlandı: https://github.com/${REPO}"
