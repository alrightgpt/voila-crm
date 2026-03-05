#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"
TMP="test/tmp_phase_attach"
mkdir -p "$TMP"
cleanup(){ rm -rf "$TMP"; }
trap cleanup EXIT

OUT="$TMP/out"
mkdir -p "$OUT"

# Create plan and receipt
PLAN="$TMP/plan.json"
cat>"$PLAN"<<'EOF'
{"run_id":"DEMO_ATTACH","phase_id":"PHASE_1","phase_index":1,"repo_root":"/voila","prompt":"test","next_phase_id":"PHASE_2"}
EOF
node scripts/phase_runner.js --plan "$PLAN" --out-dir "$OUT" --now "2026-03-05T12:00:00Z">/dev/null

RECEIPT="$OUT/DEMO_ATTACH.PHASE_1.json"
[ -f "$RECEIPT" ]||{ echo "FAIL: receipt not found";exit 1; }

# Create executor result
RESULT="$TMP/result.json"
cat>"$RESULT"<<'EOF'
{"ok":true,"note":"hello"}
EOF

# Run phase_attach
./scripts/phase_attach.sh --receipt "$RECEIPT" --result "$RESULT" --now "2026-03-05T12:01:00Z">"$TMP/out.json"
[ $? -eq 0 ]||{ echo "FAIL: exit code";exit 1; }

# Assertions
grep -q 'EXECUTOR_RESULT_ATTACHED' "$RECEIPT"||{ echo "FAIL: status not attached";exit 1; }
grep -q '"note": "hello"' "$RECEIPT"||{ echo "FAIL: note not found";exit 1; }

echo "PASS"
