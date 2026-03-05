#!/bin/bash
#
# test/test-run-daily-golden-stable.sh
# Golden snapshot regression test for run_daily (stable-fields mode)
#
# Runs run_daily deterministically, normalizes output to stable fields,
# and compares against committed golden file.
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
RUN_DAILY="$REPO_ROOT/commands/run_daily.js"
GOLDEN="$REPO_ROOT/test/golden/run_daily_phase2d_stable.json"

echo "=== Golden Snapshot Test (run_daily Phase 2D stable) ==="
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

# Run run_daily with fixed args
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

# Normalize output to stable fields
echo "Normalizing output..."

cat > "$TMP/normalize.js" << 'NORMALIZE_SCRIPT'
const fs = require("fs");

function sortKeys(obj) {
    if (Array.isArray(obj)) {
        return obj.map(sortKeys);
    }
    if (obj !== null && typeof obj === "object") {
        const sorted = {};
        Object.keys(obj).sort().forEach(key => {
            sorted[key] = sortKeys(obj[key]);
        });
        return sorted;
    }
    return obj;
}

function normalize(data) {
    // Normalize inbox_json path to stable placeholder
    const normalizedInboxJson = data.inbox_json ? "<INBOX_JSON_PATH>" : null;
    
    return {
        ok: data.ok,
        command: data.command,
        now: data.now,
        mode: data.mode,
        dry_run: data.dry_run,
        plan_only: data.plan_only,
        after_days: data.after_days,
        inbox_json: normalizedInboxJson,
        steps: data.steps.map(s => ({
            name: s.name,
            status: s.status,
            supports_dry_run: s.supports_dry_run,
            exit_code: s.exit_code,
            reason: s.reason ?? null,
            ok_json_parse: s.ok_json_parse,
            ok: s.ok ?? null,
            // Keep only shallow info from output_json
            output: s.output_json ? {
                ok: s.output_json.ok,
                command: s.output_json.command,
                error: s.output_json.error ? { code: s.output_json.error.code } : null
            } : null
        })),
        summary: data.summary ?? null
    };
}

const stdin = fs.readFileSync(0, "utf-8");
const data = JSON.parse(stdin);
const normalized = sortKeys(normalize(data));
console.log(JSON.stringify(normalized, null, 2));
NORMALIZE_SCRIPT

echo "$OUT" | node "$TMP/normalize.js" > "$TMP/actual.json"
echo "  Normalized output written to: $TMP/actual.json"
echo ""

# Compare to golden file
echo "Comparing to golden file..."
if [ ! -f "$GOLDEN" ]; then
    echo "FAIL: Golden file not found: $GOLDEN"
    echo "Creating golden file from actual output..."
    mkdir -p "$(dirname "$GOLDEN")"
    cp "$TMP/actual.json" "$GOLDEN"
    echo "  Created: $GOLDEN"
    echo "  Re-run the test to verify"
    exit 1
fi

if diff -u "$GOLDEN" "$TMP/actual.json"; then
    echo "  PASS: Output matches golden file"
else
    echo ""
    echo "FAIL: Output does not match golden file"
    echo "  Golden: $GOLDEN"
    echo "  Actual: $TMP/actual.json"
    echo ""
    echo "To update golden file:"
    echo "  cp $TMP/actual.json $GOLDEN"
    exit 1
fi

echo ""
echo "=== Golden Snapshot Test PASSED ==="
