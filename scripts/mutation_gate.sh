#!/bin/bash
#
# scripts/mutation_gate.sh
# Manual mutation gate that matches scripts/hooks/pre-commit logic.
#

set -euo pipefail

echo "Running mutation budget check..."

# Get repo root from git (works for both regular repos and submodules)
REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

# Collect changed + untracked files (match pre-commit hook exactly)
CHANGED=$(git diff --cached --name-only || true)
UNTRACKED=$(git status --porcelain | grep '^??' | cut -c4- || true)

ALL_PATHS=$(printf "%s\n%s\n" "$CHANGED" "$UNTRACKED" | grep -v '^$' || true)

DOCS_ONLY=true
TESTS_ONLY=true

# If there are no changed paths, disable special budgets
if [ -z "${ALL_PATHS:-}" ]; then
  DOCS_ONLY=false
  TESTS_ONLY=false
else
  while IFS= read -r path || [ -n "$path" ]; do

    # Skip empty lines defensively
    [ -z "$path" ] && continue

    if [[ "$path" != docs/* ]]; then
      DOCS_ONLY=false
    fi

    if [[ "$path" != test/* ]]; then
      TESTS_ONLY=false
    fi

  done <<< "$ALL_PATHS"
fi

if [ "$DOCS_ONLY" = true ]; then
  MAX_LINES=800
  echo "Budget mode: docs budget (--max-lines 800)"
elif [ "$TESTS_ONLY" = true ]; then
  MAX_LINES=600
  echo "Budget mode: test budget (--max-lines 600)"
else
  MAX_LINES=200
  echo "Budget mode: default budget (--max-lines 200)"
fi

node commands/check_mutation_budget.js \
  --max-files 3 \
  --max-lines "$MAX_LINES" \
  --deny-prefix templates/ \
  --deny-prefix pipeline.json \
  --deny-prefix PROJECT_STATE.md

echo "Mutation budget OK"
