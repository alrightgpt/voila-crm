#!/bin/bash
#
# test/test-mark-no-reply-dry-run-nomutate.sh
# Verify that mark_no_reply.js --dry-run makes NO state changes
#
# Tests:
#   1. --dry-run does not mutate pipeline
#   2. Missing --now => INVALID_ARGS, no mutation
#   3. Missing --after-days => INVALID_ARGS, no mutation
#   4. Valid invocation produces ok=true with expected fields
#   5. Invalid --now format => INVALID_ARGS, no mutation
#   6. Invalid --after-days value => INVALID_ARGS, no mutation
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
MARK_NO_REPLY="$REPO_ROOT/commands/mark_no_reply.js"
PIPELINE_FILE="$REPO_ROOT/state/pipeline.json"

echo "=== Testing mark_no_reply.js --dry-run non-mutation ==="
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

# Helper: extract JSON from output (handles mixed stderr/stdout)
extract_json() {
    local output="$1"
    # Find line starting with { and extract from there
    echo "$output" | awk '/^{/{found=1} found{print} /^}$/{exit}'
}

# Test 1: --dry-run does not mutate pipeline
echo "Test 1: --dry-run does not mutate pipeline..."
BEFORE_HASH=$(sha256sum "$PIPELINE_FILE" | cut -d' ' -f1)
echo "  Before hash: $BEFORE_HASH"

OUTPUT=$(node "$MARK_NO_REPLY" --now "2026-03-04T00:00:00Z" --after-days 7 --dry-run 2>&1)
EXIT_CODE=$?

if [ "$EXIT_CODE" -ne 0 ]; then
    echo "FAIL: Expected exit code 0, got $EXIT_CODE"
    echo "Output: $OUTPUT"
    exit 1
fi

AFTER_HASH=$(sha256sum "$PIPELINE_FILE" | cut -d' ' -f1)
echo "  After hash:  $AFTER_HASH"

if [ "$BEFORE_HASH" != "$AFTER_HASH" ]; then
    echo "FAIL: Pipeline was mutated during --dry-run!"
    echo "  Before: $BEFORE_HASH"
    echo "  After:  $AFTER_HASH"
    exit 1
fi

echo "  Pipeline hash unchanged: PASS"
echo "PASS: Test 1"
echo ""

# Test 2: Missing --now => INVALID_ARGS, no mutation
echo "Test 2: Missing --now => INVALID_ARGS..."
BEFORE_HASH=$(sha256sum "$PIPELINE_FILE" | cut -d' ' -f1)

set +e
OUTPUT=$(node "$MARK_NO_REPLY" --after-days 7 --dry-run 2>&1)
EXIT_CODE=$?
set -e

if [ "$EXIT_CODE" -eq 0 ]; then
    echo "FAIL: Expected non-zero exit code for missing --now"
    exit 1
fi

AFTER_HASH=$(sha256sum "$PIPELINE_FILE" | cut -d' ' -f1)

if [ "$BEFORE_HASH" != "$AFTER_HASH" ]; then
    echo "FAIL: Pipeline was mutated during error case!"
    exit 1
fi

# Verify error JSON - just check that we got valid JSON with expected fields
RESULT_JSON=$(extract_json "$OUTPUT")
if [ -z "$RESULT_JSON" ]; then
    echo "FAIL: No JSON found in output"
    echo "Output: $OUTPUT"
    exit 1
fi
echo "$RESULT_JSON" | jq -e . > /dev/null || { echo "FAIL: Error output is not valid JSON"; echo "Output: $OUTPUT"; exit 1; }
assert_json_field "$RESULT_JSON" ".ok" "false"
assert_json_field "$RESULT_JSON" ".error.code" "INVALID_ARGS"

echo "  Pipeline hash unchanged: PASS"
echo "PASS: Test 2"
echo ""

# Test 3: Missing --after-days => INVALID_ARGS, no mutation
echo "Test 3: Missing --after-days => INVALID_ARGS..."
BEFORE_HASH=$(sha256sum "$PIPELINE_FILE" | cut -d' ' -f1)

set +e
OUTPUT=$(node "$MARK_NO_REPLY" --now "2026-03-04T00:00:00Z" --dry-run 2>&1)
EXIT_CODE=$?
set -e

if [ "$EXIT_CODE" -eq 0 ]; then
    echo "FAIL: Expected non-zero exit code for missing --after-days"
    exit 1
fi

AFTER_HASH=$(sha256sum "$PIPELINE_FILE" | cut -d' ' -f1)

if [ "$BEFORE_HASH" != "$AFTER_HASH" ]; then
    echo "FAIL: Pipeline was mutated during error case!"
    exit 1
fi

RESULT_JSON=$(extract_json "$OUTPUT")
if [ -z "$RESULT_JSON" ]; then
    echo "FAIL: No JSON found in output"
    echo "Output: $OUTPUT"
    exit 1
fi
echo "$RESULT_JSON" | jq -e . > /dev/null || { echo "FAIL: Error output is not valid JSON"; exit 1; }
assert_json_field "$RESULT_JSON" ".ok" "false"
assert_json_field "$RESULT_JSON" ".error.code" "INVALID_ARGS"

echo "  Pipeline hash unchanged: PASS"
echo "PASS: Test 3"
echo ""

# Test 4: Valid invocation produces ok=true with expected fields
echo "Test 4: Valid invocation produces expected fields..."
OUTPUT=$(node "$MARK_NO_REPLY" --now "2026-03-04T00:00:00Z" --after-days 7 --dry-run 2>&1)
RESULT_JSON=$(extract_json "$OUTPUT")

assert_json_field "$RESULT_JSON" ".ok" "true"
assert_json_field "$RESULT_JSON" ".now" "2026-03-04T00:00:00Z"
assert_json_field "$RESULT_JSON" ".after_days" "7"
assert_json_field "$RESULT_JSON" ".dry_run" "true"

# Check cutoff is present
CUTOFF=$(echo "$RESULT_JSON" | jq -r '.cutoff')
if [ -z "$CUTOFF" ] || [ "$CUTOFF" == "null" ]; then
    echo "FAIL: cutoff field is missing"
    exit 1
fi

# Check counters are present
PROCESSED=$(echo "$RESULT_JSON" | jq '.processed')
if [ "$PROCESSED" == "null" ]; then
    echo "FAIL: processed field is missing"
    exit 1
fi

echo "PASS: Test 4"
echo ""

# Test 5: Invalid --now format => INVALID_ARGS, no mutation
echo "Test 5: Invalid --now format => INVALID_ARGS..."
BEFORE_HASH=$(sha256sum "$PIPELINE_FILE" | cut -d' ' -f1)

set +e
OUTPUT=$(node "$MARK_NO_REPLY" --now "not-a-date" --after-days 7 --dry-run 2>&1)
EXIT_CODE=$?
set -e

if [ "$EXIT_CODE" -eq 0 ]; then
    echo "FAIL: Expected non-zero exit code for invalid --now"
    exit 1
fi

AFTER_HASH=$(sha256sum "$PIPELINE_FILE" | cut -d' ' -f1)

if [ "$BEFORE_HASH" != "$AFTER_HASH" ]; then
    echo "FAIL: Pipeline was mutated during error case!"
    exit 1
fi

RESULT_JSON=$(extract_json "$OUTPUT")
assert_json_field "$RESULT_JSON" ".ok" "false"
assert_json_field "$RESULT_JSON" ".error.code" "INVALID_ARGS"

echo "  Pipeline hash unchanged: PASS"
echo "PASS: Test 5"
echo ""

# Test 6: Invalid --after-days value => INVALID_ARGS, no mutation
echo "Test 6: Invalid --after-days value => INVALID_ARGS..."
BEFORE_HASH=$(sha256sum "$PIPELINE_FILE" | cut -d' ' -f1)

set +e
OUTPUT=$(node "$MARK_NO_REPLY" --now "2026-03-04T00:00:00Z" --after-days -5 --dry-run 2>&1)
EXIT_CODE=$?
set -e

if [ "$EXIT_CODE" -eq 0 ]; then
    echo "FAIL: Expected non-zero exit code for invalid --after-days"
    exit 1
fi

AFTER_HASH=$(sha256sum "$PIPELINE_FILE" | cut -d' ' -f1)

if [ "$BEFORE_HASH" != "$AFTER_HASH" ]; then
    echo "FAIL: Pipeline was mutated during error case!"
    exit 1
fi

RESULT_JSON=$(extract_json "$OUTPUT")
assert_json_field "$RESULT_JSON" ".ok" "false"
assert_json_field "$RESULT_JSON" ".error.code" "INVALID_ARGS"

echo "  Pipeline hash unchanged: PASS"
echo "PASS: Test 6"
echo ""

echo "=== All mark_no_reply.js --dry-run tests passed ==="
