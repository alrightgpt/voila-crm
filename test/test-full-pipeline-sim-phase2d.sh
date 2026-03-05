#!/bin/bash
#
# test/test-full-pipeline-sim-phase2d.sh
# Full-pipeline dry-run simulation regression test for Phase 2D
#
# Runs run_daily end-to-end in execute+dry-run+simulate mode with --inbox-json
# Asserts:
#   - ok=true and key fields via JSON parse
#   - Step order: intake,draft,approve,send,detect_replies,mark_no_reply,report
#   - detect_replies runs (not skipped_unsafe) when inbox_json provided
#   - pipeline.json unchanged before/after
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
RUN_DAILY="$REPO_ROOT/commands/run_daily.js"
PIPELINE="$REPO_ROOT/state/pipeline.json"

echo "=== Full Pipeline Simulation Test (Phase 2D) ==="
echo ""

# Create temp directory and setup cleanup
TMP="$(mktemp -d)"
cleanup() {
    rm -rf "$TMP"
}
trap cleanup EXIT

echo "Temp dir: $TMP"
echo ""

# Create inbox JSON fixture via heredoc
echo "Creating inbox fixture..."
cat > "$TMP/inbox.json" << 'EOF'
{
  "messages": [
    {
      "message_id": "test-reply-001",
      "in_reply_to": "sent-msg-001@example.com",
      "from_email": "test@example.com",
      "subject": "Re: Test Subject",
      "timestamp": "2026-03-04T00:00:00Z"
    }
  ]
}
EOF
echo "  Created: $TMP/inbox.json"

# Copy pipeline before for comparison
if [ -f "$PIPELINE" ]; then
    cp "$PIPELINE" "$TMP/pipeline.before.json"
    echo "  Copied pipeline to: $TMP/pipeline.before.json"
else
    echo "{}" > "$TMP/pipeline.before.json"
    echo "  No pipeline.json, created empty baseline"
fi

echo ""

# Run run_daily with execute + dry-run + simulate + inbox-json
echo "Running run_daily..."
OUT="$(node "$RUN_DAILY" --now "2026-03-04T00:00:00Z" --mode simulate --execute --dry-run --inbox-json "$TMP/inbox.json" 2>&1)"
EXIT_CODE=$?

if [ "$EXIT_CODE" -ne 0 ]; then
    echo "FAIL: run_daily exited with code $EXIT_CODE"
    echo "Output:"
    echo "$OUT"
    exit 1
fi

echo "  Exit code: $EXIT_CODE"
echo ""

# Validate JSON output
echo "Validating output..."

# Write validation script to temp file
cat > "$TMP/validate.js" << 'VALIDATE_SCRIPT'
const fs = require("fs");
const out = fs.readFileSync(0, "utf-8");
const data = JSON.parse(out);

const expectedInbox = process.argv[2];
const errors = [];

// Check ok === true
if (data.ok !== true) {
    errors.push("ok !== true (got: " + data.ok + ")");
}

// Check dry_run === true
if (data.dry_run !== true) {
    errors.push("dry_run !== true (got: " + data.dry_run + ")");
}

// Check plan_only === false
if (data.plan_only !== false) {
    errors.push("plan_only !== false (got: " + data.plan_only + ")");
}

// Check mode === "simulate"
if (data.mode !== "simulate") {
    errors.push("mode !== simulate (got: " + data.mode + ")");
}

// Check inbox_json
if (data.inbox_json !== expectedInbox) {
    errors.push("inbox_json !== expected (expected: " + expectedInbox + ", got: " + data.inbox_json + ")");
}

// Check steps array exists
if (!Array.isArray(data.steps)) {
    errors.push("steps is not an array");
} else {
    // Check step order
    const expectedNames = ["intake","draft","approve","send","detect_replies","mark_no_reply","report"];
    const actualNames = data.steps.map(s => s.name);
    
    if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
        errors.push("step names mismatch: expected " + JSON.stringify(expectedNames) + " got " + JSON.stringify(actualNames));
    }
    
    // Check detect_replies is not skipped_unsafe
    const detectStep = data.steps.find(s => s.name === "detect_replies");
    if (!detectStep) {
        errors.push("detect_replies step not found");
    } else if (detectStep.status === "skipped_unsafe") {
        errors.push("detect_replies status is skipped_unsafe (expected executed_dry_run)");
    }
}

if (errors.length > 0) {
    console.error("VALIDATION FAILED:");
    errors.forEach(e => console.error("  - " + e));
    process.exit(1);
}

console.log("  All JSON validations passed");
VALIDATE_SCRIPT

# Parse and validate with node
node "$TMP/validate.js" "$TMP/inbox.json" <<< "$OUT"

if [ $? -ne 0 ]; then
    echo "FAIL: JSON validation failed"
    echo "Output was:"
    echo "$OUT"
    exit 1
fi

echo ""

# Verify pipeline unchanged
echo "Verifying pipeline unchanged..."
if [ -f "$PIPELINE" ]; then
    if ! diff -u "$TMP/pipeline.before.json" "$PIPELINE" > /dev/null 2>&1; then
        echo "FAIL: pipeline.json was mutated!"
        diff -u "$TMP/pipeline.before.json" "$PIPELINE" || true
        exit 1
    fi
else
    # If pipeline was created (didnt exist before), check that before was empty
    BEFORE_CONTENT=$(cat "$TMP/pipeline.before.json")
    if [ "$BEFORE_CONTENT" != "{}" ]; then
        echo "FAIL: pipeline.json was created (should not exist)"
        exit 1
    fi
fi

echo "  Pipeline unchanged: OK"
echo ""

echo "=== Full Pipeline Simulation Test PASSED ==="
