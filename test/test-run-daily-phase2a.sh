#!/bin/bash
#
# test/test-run-daily-phase2a.sh
# Tests for run_daily.js Phase 2A (CLI runner + JSON aggregation)
#
# Tests:
#   1. Valid invocation - steps array exists with correct structure
#   2. All known commands are "invoked" (they exist)
#   3. report step is "missing" (no script defined)
#   4. Each step has required fields
#   5. Missing --now returns INVALID_ARGS
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
RUN_DAILY="$REPO_ROOT/commands/run_daily.js"

echo "=== Testing run_daily.js Phase 2A ==="
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

# Test 1: Valid invocation - steps array exists
echo "Test 1: Valid invocation with steps array..."
OUTPUT=$(node "$RUN_DAILY" --now "2026-03-04T00:00:00Z" --dry-run 2>&1)
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

# Validate steps array exists and has correct length
STEPS_COUNT=$(echo "$OUTPUT" | jq '.steps | length')
if [ "$STEPS_COUNT" -ne 7 ]; then
    echo "FAIL: Expected 7 steps, got $STEPS_COUNT"
    exit 1
fi

echo "PASS: Test 1"
echo ""

# Test 2: Fixed step names in correct order
echo "Test 2: Fixed step names in correct order..."
EXPECTED_NAMES='["intake","draft","approve","send","detect_replies","mark_no_reply","report"]'
ACTUAL_NAMES=$(echo "$OUTPUT" | jq -c '[.steps[].name]')
if [ "$ACTUAL_NAMES" != "$EXPECTED_NAMES" ]; then
    echo "FAIL: Step names mismatch"
    echo "Expected: $EXPECTED_NAMES"
    echo "Actual: $ACTUAL_NAMES"
    exit 1
fi

echo "PASS: Test 2"
echo ""

# Test 3: Known commands are "invoked", report is "missing"
echo "Test 3: Known commands invoked, report missing..."

# Check intake is invoked
INTAKE_STATUS=$(echo "$OUTPUT" | jq -r '.steps[] | select(.name=="intake") | .status')
if [ "$INTAKE_STATUS" != "invoked" ]; then
    echo "FAIL: Expected intake status 'invoked', got '$INTAKE_STATUS'"
    exit 1
fi

# Check draft is invoked
DRAFT_STATUS=$(echo "$OUTPUT" | jq -r '.steps[] | select(.name=="draft") | .status')
if [ "$DRAFT_STATUS" != "invoked" ]; then
    echo "FAIL: Expected draft status 'invoked', got '$DRAFT_STATUS'"
    exit 1
fi

# Check report is missing (no script defined)
REPORT_STATUS=$(echo "$OUTPUT" | jq -r '.steps[] | select(.name=="report") | .status')
if [ "$REPORT_STATUS" != "missing" ]; then
    echo "FAIL: Expected report status 'missing', got '$REPORT_STATUS'"
    exit 1
fi

echo "PASS: Test 3"
echo ""

# Test 4: Each invoked step has required fields
echo "Test 4: Invoked steps have required fields..."
for STEP_NAME in intake draft approve send detect_replies mark_no_reply; do
    STEP_JSON=$(echo "$OUTPUT" | jq -c ".steps[] | select(.name==\"$STEP_NAME\")")
    
    # Check status
    STATUS=$(echo "$STEP_JSON" | jq -r '.status')
    if [ "$STATUS" != "invoked" ]; then
        echo "FAIL: $STEP_NAME status is not 'invoked'"
        exit 1
    fi
    
    # Check cmd array exists
    CMD=$(echo "$STEP_JSON" | jq -c '.cmd')
    if [ "$CMD" == "null" ]; then
        echo "FAIL: $STEP_NAME missing cmd field"
        exit 1
    fi
    
    # Check exit_code is a number
    EXIT_CODE_VAL=$(echo "$STEP_JSON" | jq '.exit_code')
    if [ "$EXIT_CODE_VAL" == "null" ]; then
        echo "FAIL: $STEP_NAME missing exit_code"
        exit 1
    fi
    
    # Check ok_json_parse is boolean
    OK_PARSE=$(echo "$STEP_JSON" | jq '.ok_json_parse')
    if [ "$OK_PARSE" != "true" ] && [ "$OK_PARSE" != "false" ]; then
        echo "FAIL: $STEP_NAME ok_json_parse is not boolean"
        exit 1
    fi
done

echo "PASS: Test 4"
echo ""

# Test 5: Missing --now returns INVALID_ARGS
echo "Test 5: Missing --now returns INVALID_ARGS..."
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

echo "PASS: Test 5"
echo ""

echo "=== All Phase 2A tests passed ==="
