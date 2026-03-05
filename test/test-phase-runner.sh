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
