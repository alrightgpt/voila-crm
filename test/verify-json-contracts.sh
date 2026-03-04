#!/bin/bash
#
# Voilà JSON Contract Verification
# Tests that all commands output valid JSON contracts
#

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$REPO_ROOT"

echo "=== Verifying JSON contracts for all commands ==="

# Track test results
PASSED=0
FAILED=0
FAILURES=()

# Helper to test a command with invalid args
test_command_error() {
  local cmd="$1"
  local name="$2"
  local args="$3"

  echo -n "Testing $name with invalid args... "

  # Run command and capture output
  output=$(node "$REPO_ROOT/commands/$cmd" $args 2>/dev/null)
  exit_code=$?

  # Should exit with non-zero
  if [ $exit_code -eq 0 ]; then
    echo "FAIL: exited with 0"
    FAILED=$((FAILED + 1))
    FAILURES+=("$name: should exit with non-zero")
    return 1
  fi

  # Should output valid JSON
  if ! echo "$output" | jq . > /dev/null 2>&1; then
    echo "FAIL: invalid JSON"
    echo "Output: $output"
    FAILED=$((FAILED + 1))
    FAILURES+=("$name: invalid JSON output")
    return 1
  fi

  # Should have ok: false
  if ! echo "$output" | jq -e '.ok == false' > /dev/null 2>&1; then
    echo "FAIL: missing ok: false"
    echo "Output: $output"
    FAILED=$((FAILED + 1))
    FAILURES+=("$name: missing ok: false")
    return 1
  fi

  # Should have error.code
  if ! echo "$output" | jq -e '.error.code' > /dev/null 2>&1; then
    echo "FAIL: missing error.code"
    echo "Output: $output"
    FAILED=$((FAILED + 1))
    FAILURES+=("$name: missing error.code")
    return 1
  fi

  # Should have error.message
  if ! echo "$output" | jq -e '.error.message' > /dev/null 2>&1; then
    echo "FAIL: missing error.message"
    echo "Output: $output"
    FAILED=$((FAILED + 1))
    FAILURES+=("$name: missing error.message")
    return 1
  fi

  echo "PASS"
  PASSED=$((PASSED + 1))
  return 0
}

echo ""
echo "Testing error contracts (invalid args):"
echo ""

# Test each command with invalid arguments
test_command_error "approve.js" "approve" ""
test_command_error "detect_replies.js" "detect_replies" ""
test_command_error "draft.js" "draft" ""
test_command_error "intake.js" "intake" ""
test_command_error "mark_no_reply.js" "mark_no_reply" ""
test_command_error "mark_replied.js" "mark_replied" ""
test_command_error "send.js" "send" ""
test_command_error "snapshot_scrape.js" "snapshot_scrape" ""
test_command_error "test_smtp.js" "test_smtp" ""

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
  echo "All tests passed!"
  exit 0
fi
