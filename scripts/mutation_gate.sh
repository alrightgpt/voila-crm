#!/bin/bash
#
# scripts/mutation_gate.sh
# Runs mutation budget check for the voila repository
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

echo "=== Mutation Budget Gate ==="
echo ""

cd "$REPO_ROOT"

node commands/check_mutation_budget.js \
  --max-files 3 \
  --max-lines 200 \
  --deny-prefix templates/ \
  --deny-prefix pipeline.json \
  --deny-prefix PROJECT_STATE.md

echo ""
echo "Mutation budget OK"
