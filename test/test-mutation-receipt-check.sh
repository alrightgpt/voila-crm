#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

OUTPUT=$(./scripts/mutation_receipt_check.sh)
EXIT_CODE=$?

if [ "$EXIT_CODE" -ne 0 ]; then
    echo "FAIL: Expected exit code 0, got $EXIT_CODE"
    exit 1
fi

if ! echo "$OUTPUT" | grep -q '"ok": true'; then
    echo "FAIL: Expected stdout to contain '\"ok\": true'"
    exit 1
fi

echo "PASS"
