#!/bin/bash
#
# test/test-mutation-budget.sh
# Tests for commands/check_mutation_budget.js
#
# Test cases:
#   1) Clean tree => ok=true with max-files=0 max-lines=0
#   2) One small change under budget => ok=true
#   3) Exceed max-files => ok=false
#   4) Touch deny-prefix => ok=false
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
CHECK_CMD="$REPO_ROOT/commands/check_mutation_budget.js"

echo "=== Testing check_mutation_budget.js ==="
echo ""

# Helper: assert JSON field value
assert_json_field() {
    local json="$1"
    local field="$2"
    local expected="$3"
    local actual
    actual=$(echo "$json" | jq -r "$field")
    if [ "$actual" != "$expected" ]; then
        echo "FAIL: Expected $field = '$expected', got '$actual'"
        echo "JSON: $json"
        return 1
    fi
}

# Helper: ensure clean tree at start (ignoring this test file and command file)
ensure_clean_tree() {
    # Remove any temp files we may have created
    rm -f "$REPO_ROOT/tmp_mutation_budget_test.txt" 2>/dev/null || true
    rm -f "$REPO_ROOT/templates/tmp_test.txt" 2>/dev/null || true
    rm -f "$REPO_ROOT/commands/tmp_test.txt" 2>/dev/null || true
    
    # Restore any modified files
    cd "$REPO_ROOT"
    git restore . 2>/dev/null || true
    cd - > /dev/null
}

# Helper: check if tree is clean (excluding the command and test file we're testing)
is_tree_clean_for_test() {
    local status
    status=$(cd "$REPO_ROOT" && git status --porcelain | grep -v 'commands/check_mutation_budget.js' | grep -v 'test/test-mutation-budget.sh' || true)
    if [ -n "$status" ]; then
        return 1
    fi
    return 0
}

# Cleanup function
cleanup() {
    cd "$REPO_ROOT"
    rm -f tmp_mutation_budget_test.txt 2>/dev/null || true
    rm -f templates/tmp_test.txt 2>/dev/null || true
    git restore . 2>/dev/null || true
    cd - > /dev/null
}
trap cleanup EXIT

# Test 1: Clean tree => ok=true with max-files=0 max-lines=0
# Note: If the command/test file are untracked, use allow-prefix to exclude them
echo "Test 1: Clean tree with max-files=0 max-lines=0..."
ensure_clean_tree

# Check if tree has only our test files (which is ok for this test)
STATUS=$(cd "$REPO_ROOT" && git status --porcelain)
if [ -z "$STATUS" ]; then
    # Truly clean tree
    OUTPUT=$(node "$CHECK_CMD" --max-files 0 --max-lines 0 2>&1)
else
    # Tree has untracked files (our new command/test), allow them
    OUTPUT=$(node "$CHECK_CMD" --max-files 0 --max-lines 0 --allow-prefix "commands/check_mutation_budget.js" --allow-prefix "test/test-mutation-budget.sh" --allow-prefix "test/golden/" 2>&1)
fi
EXIT_CODE=$?

if [ "$EXIT_CODE" -ne 0 ]; then
    echo "FAIL: Expected exit code 0 for clean tree, got $EXIT_CODE"
    echo "Output: $OUTPUT"
    exit 1
fi

assert_json_field "$OUTPUT" ".ok" "true"

echo "PASS: Test 1"
echo ""

# Test 2: One small change under budget => ok=true
echo "Test 2: One small change under budget..."
ensure_clean_tree

# Create a small temp file
echo "test content" > "$REPO_ROOT/tmp_mutation_budget_test.txt"

# Use max-files=10 to allow the new temp file + our command/test files
# Do NOT use allow-prefix here - we want to test budget, not allow-prefix
OUTPUT=$(node "$CHECK_CMD" --max-files 10 --max-lines 100 2>&1)
EXIT_CODE=$?

if [ "$EXIT_CODE" -ne 0 ]; then
    echo "FAIL: Expected exit code 0 for change under budget, got $EXIT_CODE"
    echo "Output: $OUTPUT"
    rm -f "$REPO_ROOT/tmp_mutation_budget_test.txt"
    exit 1
fi

assert_json_field "$OUTPUT" ".ok" "true"

# Clean up
rm -f "$REPO_ROOT/tmp_mutation_budget_test.txt"

echo "PASS: Test 2"
echo ""

# Test 3: Exceed max-files => ok=false, exit code 3
echo "Test 3: Exceed max-files..."
ensure_clean_tree

# Create a file but allow 0 files (excluding our command/test via allow-prefix)
echo "test1" > "$REPO_ROOT/tmp_mutation_budget_test.txt"

# Use allow-prefix to exclude our command/test files, so only the temp file counts
OUTPUT=$(node "$CHECK_CMD" --max-files 0 --max-lines 100 --allow-prefix "commands/check_mutation_budget.js" --allow-prefix "test/test-mutation-budget.sh" --allow-prefix "test/golden/" 2>&1)
EXIT_CODE=$?

if [ "$EXIT_CODE" -ne 3 ]; then
    echo "FAIL: Expected exit code 3 for too many files, got $EXIT_CODE"
    echo "Output: $OUTPUT"
    rm -f "$REPO_ROOT/tmp_mutation_budget_test.txt"
    exit 1
fi

assert_json_field "$OUTPUT" ".ok" "false"

# Check for violation code
VIOLATION_CODE=$(echo "$OUTPUT" | jq -r '.violations[0].code')
if [ "$VIOLATION_CODE" != "TOO_MANY_FILES" ]; then
    echo "FAIL: Expected violation code 'TOO_MANY_FILES', got '$VIOLATION_CODE'"
    rm -f "$REPO_ROOT/tmp_mutation_budget_test.txt"
    exit 1
fi

# Clean up
rm -f "$REPO_ROOT/tmp_mutation_budget_test.txt"

echo "PASS: Test 3"
echo ""

# Test 4: Touch deny-prefix => ok=false, exit code 4
echo "Test 4: Touch deny-prefix (templates/)..."
ensure_clean_tree

# Create a file in templates/ (protected zone)
mkdir -p "$REPO_ROOT/templates"
echo "protected" > "$REPO_ROOT/templates/tmp_test.txt"

# Deny-prefix violations happen regardless of budget or allow-prefix
OUTPUT=$(node "$CHECK_CMD" --max-files 10 --max-lines 1000 2>&1)
EXIT_CODE=$?

if [ "$EXIT_CODE" -ne 4 ]; then
    echo "FAIL: Expected exit code 4 for deny-prefix violation, got $EXIT_CODE"
    echo "Output: $OUTPUT"
    rm -f "$REPO_ROOT/templates/tmp_test.txt"
    exit 1
fi

assert_json_field "$OUTPUT" ".ok" "false"

# Check for violation code
VIOLATION_CODE=$(echo "$OUTPUT" | jq -r '.violations[0].code')
if [ "$VIOLATION_CODE" != "DENY_PREFIX_VIOLATION" ]; then
    echo "FAIL: Expected violation code 'DENY_PREFIX_VIOLATION', got '$VIOLATION_CODE'"
    rm -f "$REPO_ROOT/templates/tmp_test.txt"
    exit 1
fi

# Clean up
rm -f "$REPO_ROOT/templates/tmp_test.txt"

echo "PASS: Test 4"
echo ""

# Test 5: Allow-prefix restricts changes to allowed paths
echo "Test 5: Allow-prefix restricts changes..."
ensure_clean_tree

# Create a file in commands/ (should be allowed)
echo "test" > "$REPO_ROOT/commands/tmp_test.txt"

OUTPUT=$(node "$CHECK_CMD" --max-files 10 --max-lines 1000 --allow-prefix "commands/" 2>&1)
EXIT_CODE=$?

if [ "$EXIT_CODE" -ne 0 ]; then
    echo "FAIL: Expected exit code 0 for allowed prefix, got $EXIT_CODE"
    echo "Output: $OUTPUT"
    rm -f "$REPO_ROOT/commands/tmp_test.txt"
    exit 1
fi

assert_json_field "$OUTPUT" ".ok" "true"

# Clean up
rm -f "$REPO_ROOT/commands/tmp_test.txt"

echo "PASS: Test 5"
echo ""

# Final verification: tree must be clean (except for our test files)
echo "Verifying clean tree at end..."
ensure_clean_tree
echo "PASS: Tree is clean (excluding test files)"
echo ""

echo "=== All mutation budget tests passed ==="
