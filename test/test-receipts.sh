#!/bin/bash
#
# Voilà Receipt Verification Tests
# Tests receipt generation for in-scope commands
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$REPO_ROOT"

echo "=== Verifying mutation receipts for in-scope commands ==="

# Track test results
PASSED=0
FAILED=0
FAILURES=()

# Test that invalid args + --receipt creates valid receipt
test_error_receipt() {
  local cmd="$1"
  local name="$2"
  local args="$3"
  local receipt_path="/tmp/voila-receipt-${name}.json"

  echo -n "Testing $name with invalid args + receipt... "

  # Run command with receipt path
  node "$REPO_ROOT/commands/$cmd" $args --receipt "$receipt_path" 2>/dev/null || true

  # Check receipt file exists
  if [ ! -f "$receipt_path" ]; then
    echo "FAIL: receipt file not created"
    FAILED=$((FAILED + 1))
    FAILURES+=("$name: receipt file not created")
    return 1
  fi

  # Validate receipt is valid JSON
  if ! cat "$receipt_path" | jq . > /dev/null 2>&1; then
    echo "FAIL: invalid receipt JSON"
    FAILED=$((FAILED + 1))
    FAILURES+=("$name: invalid receipt JSON")
    rm -f "$receipt_path"
    return 1
  fi

  # Check receipt structure
  local ok=$(cat "$receipt_path" | jq -r '.ok')
  local command=$(cat "$receipt_path" | jq -r '.command')
  local stdout_ok=$(cat "$receipt_path" | jq -r '.stdout_json.ok')

  if [ "$ok" != "false" ]; then
    echo "FAIL: receipt.ok should be false for error case"
    FAILED=$((FAILED + 1))
    FAILURES+=("$name: receipt.ok should be false")
    rm -f "$receipt_path"
    return 1
  fi

  if [ "$stdout_ok" != "false" ]; then
    echo "FAIL: receipt.stdout_json.ok should be false for error case"
    FAILED=$((FAILED + 1))
    FAILURES+=("$name: receipt.stdout_json.ok should be false")
    rm -f "$receipt_path"
    return 1
  fi

  echo "PASS"
  PASSED=$((PASSED + 1))
  rm -f "$receipt_path"
  return 0
}

echo ""
echo "Testing error receipts (invalid args + --receipt):"
echo ""

# Test each in-scope command with invalid arguments
test_error_receipt "intake.js" "intake" ""
test_error_receipt "draft.js" "draft" ""
test_error_receipt "approve.js" "approve" ""
test_error_receipt "send.js" "send" ""
test_error_receipt "mark_replied.js" "mark_replied" ""
test_error_receipt "mark_no_reply.js" "mark_no_reply" ""

echo ""
echo "=== Summary ==="
echo "PASSED: $PASSED"
echo "FAILED: $FAILED"

if [ $FAILED -gt 0 ]; then
  echo ""
  echo "Failures:"
  for failure in "${FAILURES[@]}"; do
    echo "  - $failure"
  done
  exit 1
else
  echo "All receipt tests passed!"
  exit 0
fi
