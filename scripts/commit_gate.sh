#!/usr/bin/env bash
#
# scripts/commit_gate.sh
# Enforce pre-commit invariants and print a JSON receipt.
#

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

checks_json="[]"

add_check () {
  local name="$1"
  local passed="$2"
  local extra="${3:-}"
  if [ -n "$extra" ]; then
    checks_json="$(printf '%s' "$checks_json" | node -e '
      const fs=require("fs");
      const arr=JSON.parse(fs.readFileSync(0,"utf8"));
      const name=process.argv[1], passed=process.argv[2]==="true", extra=JSON.parse(process.argv[3]);
      arr.push({name, passed, ...extra});
      process.stdout.write(JSON.stringify(arr));
    ' "$name" "$passed" "$extra")"
  else
    checks_json="$(printf '%s' "$checks_json" | node -e '
      const fs=require("fs");
      const arr=JSON.parse(fs.readFileSync(0,"utf8"));
      const name=process.argv[1], passed=process.argv[2]==="true";
      arr.push({name, passed});
      process.stdout.write(JSON.stringify(arr));
    ' "$name" "$passed")"
  fi
}

ok=true

# Strict clean tree: no unstaged changes AND no untracked files.
if [ -n "$(git status --porcelain)" ]; then
  add_check "clean_tree" "false" '{"error":"git status --porcelain not empty"}'
  ok=false
else
  add_check "clean_tree" "true"
fi

# Mutation receipt check
if ./scripts/mutation_receipt_check.sh >/dev/null; then
  add_check "mutation_receipt_check" "true"
else
  add_check "mutation_receipt_check" "false" '{"error":"mutation_receipt_check failed"}'
  ok=false
fi

# Required tests
if bash test/test-mutation-receipt-check.sh >/dev/null; then
  add_check "test_mutation_receipt_check" "true"
else
  add_check "test_mutation_receipt_check" "false" '{"error":"test-mutation-receipt-check.sh failed"}'
  ok=false
fi

if bash test/test-mutation-budget.sh >/dev/null; then
  add_check "test_mutation_budget" "true"
else
  add_check "test_mutation_budget" "false" '{"error":"test-mutation-budget.sh failed"}'
  ok=false
fi

# Final receipt
if [ "$ok" = true ]; then
  printf '{\n  "ok": true,\n  "checks": %s\n}\n' "$checks_json"
  exit 0
fi

printf '{\n  "ok": false,\n  "checks": %s\n}\n' "$checks_json"
exit 1
