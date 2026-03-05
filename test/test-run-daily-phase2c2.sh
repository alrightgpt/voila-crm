#!/bin/bash
#
# test/test-run-daily-phase2c2.sh
# Tests for run_daily.js Phase 2C-2 (send step executes in dry-run mode)
#
# Tests:
#   1. --execute --dry-run executes send step with correct args
#   2. send step has required fields and parsed output_json
#   3. Other steps remain skipped_unsafe/missing
#   4. Overall ok=true with summary
#   5. Phase 2B tests still pass (backward compat)
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
RUN_DAILY="$REPO_ROOT/commands/run_daily.js"

echo "=== Testing run_daily.js Phase 2C-2 ==="
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

# Test 1: --execute --dry-run executes send step with correct args
echo "Test 1: --execute --dry-run executes send step..."
OUTPUT=$(node "$RUN_DAILY" --now "2026-03-04T00:00:00Z" --execute --dry-run --mode simulate 2>&1)
EXIT_CODE=$?

if [ "$EXIT_CODE" -ne 0 ]; then
    echo "FAIL: Expected exit code 0, got $EXIT_CODE"
    echo "Output: $OUTPUT"
    exit 1
fi

# Validate JSON output
echo "$OUTPUT" | jq -e . > /dev/null || { echo "FAIL: Output is not valid JSON"; exit 1; }

assert_json_field "$OUTPUT" ".ok" "true"
assert_json_field "$OUTPUT" ".dry_run" "true"
assert_json_field "$OUTPUT" ".plan_only" "false"

# Check send step
SEND_STATUS=$(echo "$OUTPUT" | jq -r '.steps[] | select(.name=="send") | .status')
if [ "$SEND_STATUS" != "executed_dry_run" ]; then
    echo "FAIL: Expected send status 'executed_dry_run', got '$SEND_STATUS'"
    exit 1
fi

echo "PASS: Test 1"
echo ""

# Test 2: send step has required fields and parsed output_json
echo "Test 2: send step has required fields..."
SEND_STEP=$(echo "$OUTPUT" | jq '.steps[] | select(.name=="send")')

# Check required fields
SUPPORTS_DRY_RUN=$(echo "$SEND_STEP" | jq -r '.supports_dry_run')
if [ "$SUPPORTS_DRY_RUN" != "true" ]; then
    echo "FAIL: send supports_dry_run should be true"
    exit 1
fi

EXIT_CODE_VAL=$(echo "$SEND_STEP" | jq '.exit_code')
if [ "$EXIT_CODE_VAL" == "null" ]; then
    echo "FAIL: send exit_code is missing"
    exit 1
fi

OK_JSON_PARSE=$(echo "$SEND_STEP" | jq -r '.ok_json_parse')
if [ "$OK_JSON_PARSE" != "true" ]; then
    echo "FAIL: send ok_json_parse should be true (send returns JSON)"
    exit 1
fi

OUTPUT_JSON=$(echo "$SEND_STEP" | jq '.output_json')
if [ "$OUTPUT_JSON" == "null" ]; then
    echo "FAIL: send output_json is missing"
    exit 1
fi

# Check cmd array
CMD=$(echo "$SEND_STEP" | jq -c '.cmd')
if [ "$CMD" == "null" ] || [ -z "$CMD" ]; then
    echo "FAIL: send cmd is missing"
    exit 1
fi

# Verify cmd contains expected args
if [[ ! "$CMD" == *"--all"* ]]; then
    echo "FAIL: send cmd should contain --all"
    exit 1
fi

if [[ ! "$CMD" == *"--dry-run"* ]]; then
    echo "FAIL: send cmd should contain --dry-run"
    exit 1
fi

if [[ ! "$CMD" == *"simulate"* ]]; then
    echo "FAIL: send cmd should contain simulate mode"
    exit 1
fi

echo "PASS: Test 2"
echo ""

# Test 3: Other steps remain skipped_unsafe/missing
echo "Test 3: Other steps remain skipped_unsafe/missing..."

INTAKE_STATUS=$(echo "$OUTPUT" | jq -r '.steps[] | select(.name=="intake") | .status')
if [ "$INTAKE_STATUS" != "skipped_unsafe" ]; then
    echo "FAIL: Expected intake status 'skipped_unsafe', got '$INTAKE_STATUS'"
    exit 1
fi

DRAFT_STATUS=$(echo "$OUTPUT" | jq -r '.steps[] | select(.name=="draft") | .status')
if [ "$DRAFT_STATUS" != "skipped_unsafe" ]; then
    echo "FAIL: Expected draft status 'skipped_unsafe', got '$DRAFT_STATUS'"
    exit 1
fi

REPORT_STATUS=$(echo "$OUTPUT" | jq -r '.steps[] | select(.name=="report") | .status')
if [ "$REPORT_STATUS" != "missing" ]; then
    echo "FAIL: Expected report status 'missing', got '$REPORT_STATUS'"
    exit 1
fi

echo "PASS: Test 3"
echo ""

# Test 4: Overall ok=true with summary
echo "Test 4: Overall ok=true with summary..."

assert_json_field "$OUTPUT" ".summary.total" "7"

# Check that summary has required fields
EXECUTED=$(echo "$OUTPUT" | jq '.summary.executed')
if [ "$EXECUTED" -lt 1 ]; then
    echo "FAIL: summary.executed should be at least 1"
    exit 1
fi

SKIPPED_UNSAFE=$(echo "$OUTPUT" | jq '.summary.skipped_unsafe')
if [ "$SKIPPED_UNSAFE" -lt 1 ]; then
    echo "FAIL: summary.skipped_unsafe should be at least 1"
    exit 1
fi

echo "PASS: Test 4"
echo ""

# Test 5: Deterministic step ordering
echo "Test 5: Deterministic step ordering..."
EXPECTED_NAMES='["intake","draft","approve","send","detect_replies","mark_no_reply","report"]'
ACTUAL_NAMES=$(echo "$OUTPUT" | jq -c '[.steps[].name]')
if [ "$ACTUAL_NAMES" != "$EXPECTED_NAMES" ]; then
    echo "FAIL: Step names mismatch"
    echo "Expected: $EXPECTED_NAMES"
    echo "Actual: $ACTUAL_NAMES"
    exit 1
fi

echo "PASS: Test 5"
echo ""

echo "=== All Phase 2C-2 tests passed ==="
