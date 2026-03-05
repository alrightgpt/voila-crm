#!/bin/bash
#
# test/test-run-daily-scaffold.sh
# Deterministic tests for run_daily.js scaffold
#
# Tests:
#   1. Valid invocation with all args
#   2. Valid invocation with minimal args
#   3. Missing --now argument (should fail)
#   4. Invalid ISO8601 format (should fail)
#   5. Invalid mode value (should fail)
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
RUN_DAILY="$REPO_ROOT/commands/run_daily.js"

echo "=== Testing run_daily.js scaffold ==="
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
        exit 1
    fi
}

# Test 1: Valid invocation with all args
echo "Test 1: Valid invocation with all args..."
OUTPUT=$(node "$RUN_DAILY" --now "2026-03-04T00:00:00Z" --mode simulate --dry-run 2>&1)
EXIT_CODE=$?

if [ "$EXIT_CODE" -ne 0 ]; then
    echo "FAIL: Expected exit code 0, got $EXIT_CODE"
    echo "Output: $OUTPUT"
    exit 1
fi

# Validate JSON output
echo "$OUTPUT" | jq -e . > /dev/null || { echo "FAIL: Output is not valid JSON"; exit 1; }

assert_json_field "$OUTPUT" ".ok" "true"
assert_json_field "$OUTPUT" ".command" "run_daily"
assert_json_field "$OUTPUT" ".now" "2026-03-04T00:00:00Z"
assert_json_field "$OUTPUT" ".mode" "simulate"
assert_json_field "$OUTPUT" ".dry_run" "true"

# Validate steps_planned array
STEPS_COUNT=$(echo "$OUTPUT" | jq '.steps_planned | length')
if [ "$STEPS_COUNT" -ne 7 ]; then
    echo "FAIL: Expected 7 steps_planned, got $STEPS_COUNT"
    exit 1
fi

# Validate fixed order of steps
EXPECTED_STEPS='["intake","draft","approve","send","detect_replies","mark_no_reply","report"]'
ACTUAL_STEPS=$(echo "$OUTPUT" | jq -c '[.steps_planned[].name]')
if [ "$ACTUAL_STEPS" != "$EXPECTED_STEPS" ]; then
    echo "FAIL: Steps order mismatch"
    echo "Expected: $EXPECTED_STEPS"
    echo "Actual: $ACTUAL_STEPS"
    exit 1
fi

echo "PASS: Test 1"
echo ""

# Test 2: Valid invocation with minimal args (defaults)
echo "Test 2: Valid invocation with minimal args..."
OUTPUT=$(node "$RUN_DAILY" --now "2026-03-04T12:30:00Z" 2>&1)
EXIT_CODE=$?

if [ "$EXIT_CODE" -ne 0 ]; then
    echo "FAIL: Expected exit code 0, got $EXIT_CODE"
    exit 1
fi

echo "$OUTPUT" | jq -e . > /dev/null || { echo "FAIL: Output is not valid JSON"; exit 1; }
assert_json_field "$OUTPUT" ".ok" "true"
assert_json_field "$OUTPUT" ".mode" "simulate"
assert_json_field "$OUTPUT" ".dry_run" "false"

echo "PASS: Test 2"
echo ""

# Test 3: Missing --now argument (should fail with exit code 2)
echo "Test 3: Missing --now argument..."
set +e
OUTPUT=$(node "$RUN_DAILY" --dry-run 2>&1)
EXIT_CODE=$?
set -e

if [ "$EXIT_CODE" -ne 2 ]; then
    echo "FAIL: Expected exit code 2, got $EXIT_CODE"
    echo "Output: $OUTPUT"
    exit 1
fi

echo "$OUTPUT" | jq -e . > /dev/null || { echo "FAIL: Output is not valid JSON"; exit 1; }
assert_json_field "$OUTPUT" ".ok" "false"
assert_json_field "$OUTPUT" ".code" "INVALID_ARGS"

echo "PASS: Test 3"
echo ""

# Test 4: Invalid ISO8601 format (should fail with exit code 2)
echo "Test 4: Invalid ISO8601 format..."
set +e
OUTPUT=$(node "$RUN_DAILY" --now "not-a-date" --dry-run 2>&1)
EXIT_CODE=$?
set -e

if [ "$EXIT_CODE" -ne 2 ]; then
    echo "FAIL: Expected exit code 2, got $EXIT_CODE"
    exit 1
fi

echo "$OUTPUT" | jq -e . > /dev/null || { echo "FAIL: Output is not valid JSON"; exit 1; }
assert_json_field "$OUTPUT" ".ok" "false"
assert_json_field "$OUTPUT" ".code" "INVALID_ARGS"
assert_json_field "$OUTPUT" ".details.field" "now"

echo "PASS: Test 4"
echo ""

# Test 5: Invalid mode value (should fail with exit code 2)
echo "Test 5: Invalid mode value..."
set +e
OUTPUT=$(node "$RUN_DAILY" --now "2026-03-04T00:00:00Z" --mode invalid_mode 2>&1)
EXIT_CODE=$?
set -e

if [ "$EXIT_CODE" -ne 2 ]; then
    echo "FAIL: Expected exit code 2, got $EXIT_CODE"
    exit 1
fi

echo "$OUTPUT" | jq -e . > /dev/null || { echo "FAIL: Output is not valid JSON"; exit 1; }
assert_json_field "$OUTPUT" ".ok" "false"
assert_json_field "$OUTPUT" ".code" "INVALID_ARGS"
assert_json_field "$OUTPUT" ".details.field" "mode"

echo "PASS: Test 5"
echo ""

echo "=== All tests passed ==="
