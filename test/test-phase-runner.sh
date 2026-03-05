#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

TMP_DIR="test/tmp_phase_runner"
mkdir -p "$TMP_DIR"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

PLAN_FILE="$TMP_DIR/plan.json"
OUT_DIR="$TMP_DIR/out"

cat > "$PLAN_FILE" <<'EOF'
{
  "run_id": "test-run-001",
  "phase_id": "TEST_PHASE",
  "repo_root": "/home/yucky/.openclaw/workspace/skills/voila",
  "prompt": "Test prompt for phase runner",
  "next_phase_id": "NEXT_PHASE"
}
EOF

node scripts/phase_runner.js \
  --plan "$PLAN_FILE" \
  --out-dir "$OUT_DIR" \
  --now "2026-03-05T12:00:00Z" > "$TMP_DIR/result.json"

EXIT_CODE=$?

if [ "$EXIT_CODE" -ne 0 ]; then
  echo "FAIL: Expected exit code 0, got $EXIT_CODE"
  exit 1
fi

RECEIPT_FILE="$OUT_DIR/test-run-001.TEST_PHASE.json"

if [ ! -f "$RECEIPT_FILE" ]; then
  echo "FAIL: Receipt file not found at $RECEIPT_FILE"
  exit 1
fi

if ! grep -q '"ok": true' "$RECEIPT_FILE"; then
  echo "FAIL: Receipt does not contain ok: true"
  exit 1
fi

if ! grep -q 'READY_FOR_EXECUTOR' "$RECEIPT_FILE"; then
  echo "FAIL: Receipt does not contain status READY_FOR_EXECUTOR"
  exit 1
fi

if ! grep -q '"run_id": "test-run-001"' "$RECEIPT_FILE"; then
  echo "FAIL: Receipt does not contain expected run_id"
  exit 1
fi

if ! grep -q '"phase_id": "TEST_PHASE"' "$RECEIPT_FILE"; then
  echo "FAIL: Receipt does not contain expected phase_id"
  exit 1
fi

echo "PASS"

# Test 2: append result mode
echo "Test 2: append result"

EXEC_RESULT="$TMP_DIR/exec_result.json"
cat > "$EXEC_RESULT" <<'EOF'
{
  "ok": true,
  "note": "hi"
}
EOF

node scripts/phase_runner.js \
  --receipt "$RECEIPT_FILE" \
  --append-result "$EXEC_RESULT" \
  --now "2026-03-05T12:01:00Z" > "$TMP_DIR/append_result.json"

if [ $? -ne 0 ]; then
  echo "FAIL: append result exit code"
  exit 1
fi

if ! grep -q 'EXECUTOR_RESULT_ATTACHED' "$RECEIPT_FILE"; then
  echo "FAIL: Receipt does not contain EXECUTOR_RESULT_ATTACHED"
  exit 1
fi

if ! grep -q '"note": "hi"' "$RECEIPT_FILE"; then
  echo "FAIL: Receipt does not contain executor_result.note"
  exit 1
fi

echo "PASS"

# Test 3: print next mode
echo "Test 3: print next"

node scripts/phase_runner.js \
  --receipt "$RECEIPT_FILE" \
  --print-next > "$TMP_DIR/print_next.json"

if [ $? -ne 0 ]; then
  echo "FAIL: print next exit code"
  exit 1
fi

if ! grep -q '"ok": true' "$TMP_DIR/print_next.json"; then
  echo "FAIL: print-next output missing ok: true"
  exit 1
fi

if ! grep -q '"next_phase_id": "NEXT_PHASE"' "$TMP_DIR/print_next.json"; then
  echo "FAIL: print-next output missing expected next_phase_id"
  exit 1
fi

if ! grep -q '"prompt":' "$TMP_DIR/print_next.json"; then
  echo "FAIL: print-next output missing prompt"
  exit 1
fi

echo "PASS"
