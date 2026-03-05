#!/bin/bash
# test/test-mutation-budget.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
CHECK_CMD="$REPO_ROOT/commands/check_mutation_budget.js"

assert_contains() {
  local haystack="$1"
  local needle="$2"
  echo "$haystack" | grep -q "$needle"
}

cleanup() {
  rm -f "$REPO_ROOT/tmp_mutation_budget_test.txt" 2>/dev/null || true
  rm -f "$REPO_ROOT/templates/tmp_test.txt" 2>/dev/null || true
  rm -f "$REPO_ROOT/commands/tmp_test.txt" 2>/dev/null || true
}
trap cleanup EXIT

# Test 1
echo "Test 1: clean tree"
OUT="$(node "$CHECK_CMD" --max-files 0 --max-lines 0 --allow-prefix test/test-mutation-budget.sh 2>&1)"
EC=$?
if [ "$EC" -ne 0 ]; then echo "FAIL"; exit 1; fi
assert_contains "$OUT" '"ok": true'

# Test 2
echo "Test 2: under budget"
echo "x" > "$REPO_ROOT/tmp_mutation_budget_test.txt"
OUT="$(node "$CHECK_CMD" --max-files 10 --max-lines 1000 2>&1)"
EC=$?
rm -f "$REPO_ROOT/tmp_mutation_budget_test.txt"
if [ "$EC" -ne 0 ]; then echo "FAIL"; exit 1; fi
assert_contains "$OUT" '"ok": true'

# Test 3
echo "Test 3: exceed max-files"
echo "x" > "$REPO_ROOT/tmp_mutation_budget_test.txt"
set +e
OUT="$(node "$CHECK_CMD" --max-files 0 --max-lines 100 --allow-prefix test/test-mutation-budget.sh 2>&1)"
EC=$?
set -e
rm -f "$REPO_ROOT/tmp_mutation_budget_test.txt"
if [ "$EC" -eq 0 ]; then echo "FAIL"; exit 1; fi
assert_contains "$OUT" 'TOO_MANY_FILES'

# Test 4
echo "Test 4: deny prefix"
mkdir -p "$REPO_ROOT/templates"
echo "x" > "$REPO_ROOT/templates/tmp_test.txt"
set +e
OUT="$(node "$CHECK_CMD" --max-files 10 --max-lines 100 --allow-prefix test/test-mutation-budget.sh 2>&1)"
EC=$?
set -e
rm -f "$REPO_ROOT/templates/tmp_test.txt"
if [ "$EC" -eq 0 ]; then echo "FAIL"; exit 1; fi
assert_contains "$OUT" 'DENY_PREFIX_VIOLATION'

# Test 5
echo "Test 5: allow prefix"
echo "x" > "$REPO_ROOT/commands/tmp_test.txt"
set +e
OUT="$(node "$CHECK_CMD" --max-files 10 --max-lines 100 --allow-prefix commands/ --allow-prefix test/test-mutation-budget.sh 2>&1)"
EC=$?
set -e
rm -f "$REPO_ROOT/commands/tmp_test.txt"
if [ "$EC" -ne 0 ]; then echo "FAIL"; exit 1; fi
assert_contains "$OUT" '"ok": true'

echo "All tests passed"
