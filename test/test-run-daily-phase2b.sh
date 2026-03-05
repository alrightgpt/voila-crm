#!/bin/bash
#
# test/test-run-daily-phase2b.sh
# Tests for run_daily.js Phase 2B (execute mode gated by dry-run)
#
# Tests:
#   1. --execute without --dry-run => INVALID_ARGS, exit 2
#   2. --execute --dry-run works and produces JSON ok=true
#   3. Steps are either executed_dry_run or skipped_unsafe
#   4. Deterministic and stable ordering
#   5. plan-only mode still works (backward compat)
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
RUN_DAILY="$REPO_ROOT/commands/run_daily.js"

echo "=== Testing run_daily.js Phase 2B ==="
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

# Test 1: --execute without --dry-run => INVALID_ARGS, exit 2
echo "Test 1: --execute without --dry-run => INVALID_ARGS..."
set +e
OUTPUT=$(node "$RUN_DAILY" --now "2026-03-04T00:00:00Z" --execute 2>&1)
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

echo "PASS: Test 1"
echo ""

# Test 2: --execute --dry-run works and produces JSON ok=true
echo "Test 2: --execute --dry-run produces ok=true..."
OUTPUT=$(node "$RUN_DAILY" --now "2026-03-04T00:00:00Z" --execute --dry-run 2>&1)
EXIT_CODE=$?

if [ "$EXIT_CODE" -ne 0 ]; then
    echo "FAIL: Expected exit code 0, got $EXIT_CODE"
    echo "Output: $OUTPUT"
    exit 1
fi

echo "$OUTPUT" | jq -e . > /dev/null || { echo "FAIL: Output is not valid JSON"; exit 1; }
assert_json_field "$OUTPUT" ".ok" "true"
assert_json_field "$OUTPUT" ".plan_only" "false"
assert_json_field "$OUTPUT" ".dry_run" "true"

echo "PASS: Test 2"
echo ""

# Test 3: Steps are either executed_dry_run or skipped_unsafe
echo "Test 3: Steps are executed_dry_run or skipped_unsafe..."

# Check intake is skipped_unsafe (no dry-run support)
INTAKE_STATUS=$(echo "$OUTPUT" | jq -r '.steps[] | select(.name=="intake") | .status')
if [ "$INTAKE_STATUS" != "skipped_unsafe" ]; then
    echo "FAIL: Expected intake status 'skipped_unsafe', got '$INTAKE_STATUS'"
    exit 1
fi

# Check send is executed_dry_run (has dry-run support)
SEND_STATUS=$(echo "$OUTPUT" | jq -r '.steps[] | select(.name=="send") | .status')
if [ "$SEND_STATUS" != "executed_dry_run" ]; then
    echo "FAIL: Expected send status 'executed_dry_run', got '$SEND_STATUS'"
    exit 1
fi

# Check detect_replies is skipped_unsafe (needs --inbox-json)
DETECT_STATUS=$(echo "$OUTPUT" | jq -r '.steps[] | select(.name=="detect_replies") | .status')
if [ "$DETECT_STATUS" != "skipped_unsafe" ]; then
    echo "FAIL: Expected detect_replies status 'skipped_unsafe' (needs --inbox-json), got '$DETECT_STATUS'"
    exit 1
fi

# Check mark_no_reply is executed_dry_run (has dry-run support)
MARK_STATUS=$(echo "$OUTPUT" | jq -r '.steps[] | select(.name=="mark_no_reply") | .status')
if [ "$MARK_STATUS" != "executed_dry_run" ]; then
    echo "FAIL: Expected mark_no_reply status 'executed_dry_run', got '$MARK_STATUS'"
    exit 1
fi

# Check report is missing (no script)
REPORT_STATUS=$(echo "$OUTPUT" | jq -r '.steps[] | select(.name=="report") | .status')
if [ "$REPORT_STATUS" != "missing" ]; then
    echo "FAIL: Expected report status 'missing', got '$REPORT_STATUS'"
    exit 1
fi

echo "PASS: Test 3"
echo ""

# Test 4: Deterministic and stable ordering
echo "Test 4: Deterministic step ordering..."
EXPECTED_NAMES='["intake","draft","approve","send","detect_replies","mark_no_reply","report"]'
ACTUAL_NAMES=$(echo "$OUTPUT" | jq -c '[.steps[].name]')
if [ "$ACTUAL_NAMES" != "$EXPECTED_NAMES" ]; then
    echo "FAIL: Step names mismatch"
    echo "Expected: $EXPECTED_NAMES"
    echo "Actual: $ACTUAL_NAMES"
    exit 1
fi

echo "PASS: Test 4"
echo ""

# Test 5: plan-only mode still works (backward compat)
echo "Test 5: plan-only mode still works..."
OUTPUT=$(node "$RUN_DAILY" --now "2026-03-04T00:00:00Z" --plan-only 2>&1)
EXIT_CODE=$?

if [ "$EXIT_CODE" -ne 0 ]; then
    echo "FAIL: Expected exit code 0, got $EXIT_CODE"
    exit 1
fi

echo "$OUTPUT" | jq -e . > /dev/null || { echo "FAIL: Output is not valid JSON"; exit 1; }
assert_json_field "$OUTPUT" ".ok" "true"
assert_json_field "$OUTPUT" ".plan_only" "true"

# In plan-only mode, steps should be invoked_help
INTAKE_STATUS=$(echo "$OUTPUT" | jq -r '.steps[] | select(.name=="intake") | .status')
if [ "$INTAKE_STATUS" != "invoked_help" ]; then
    echo "FAIL: Expected intake status 'invoked_help' in plan-only mode, got '$INTAKE_STATUS'"
    exit 1
fi

echo "PASS: Test 5"
echo ""

# Test 6: skipped_unsafe steps have reason field
echo "Test 6: skipped_unsafe steps have reason field..."
REASON=$(echo "$OUTPUT" | jq -r '.steps[] | select(.name=="intake") | .reason')
if [ -z "$REASON" ] || [ "$REASON" == "null" ]; then
    # In plan-only mode, intake is invoked_help, not skipped_unsafe
    # So check in execute mode output instead
    OUTPUT_EXEC=$(node "$RUN_DAILY" --now "2026-03-04T00:00:00Z" --execute --dry-run 2>&1)
    REASON=$(echo "$OUTPUT_EXEC" | jq -r '.steps[] | select(.name=="intake") | .reason')
    if [ -z "$REASON" ] || [ "$REASON" == "null" ]; then
        echo "FAIL: skipped_unsafe step missing reason field"
        exit 1
    fi
fi

echo "PASS: Test 6"
echo ""

echo "=== All Phase 2B tests passed ==="
