#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"
TMP="test/tmp_phase_plan"
mkdir -p "$TMP"
cleanup(){ rm -rf "$TMP"; }
trap cleanup EXIT

# Test 1: basic plan generation
echo "Test 1: basic plan"
PROMPT="$TMP/prompt.txt"
printf "Hello world" > "$PROMPT"
node scripts/phase_plan.js \
  --run-id TEST_PLAN \
  --phase-id PHASE_1 \
  --phase-index 1 \
  --next-phase-id PHASE_2 \
  --prompt-file "$PROMPT" \
  --repo-root /voila > "$TMP/out.json"
[ $? -eq 0 ]||{ echo "FAIL: exit code";exit 1; }
grep -q '"run_id": "TEST_PLAN"' "$TMP/out.json"||{ echo "FAIL: run_id";exit 1; }
grep -q '"phase_id": "PHASE_1"' "$TMP/out.json"||{ echo "FAIL: phase_id";exit 1; }
grep -q '"phase_index": 1' "$TMP/out.json"||{ echo "FAIL: phase_index";exit 1; }
grep -q '"next_phase_id": "PHASE_2"' "$TMP/out.json"||{ echo "FAIL: next_phase_id";exit 1; }
grep -q '"prompt": "Hello world"' "$TMP/out.json"||{ echo "FAIL: prompt";exit 1; }
echo "PASS"

# Test 2: next_phase_id none
echo "Test 2: next_phase_id none"
node scripts/phase_plan.js \
  --run-id TEST_PLAN \
  --phase-id PHASE_1 \
  --phase-index 1 \
  --next-phase-id none \
  --prompt-file "$PROMPT" \
  --repo-root /voila > "$TMP/out2.json"
grep -q '"next_phase_id": "none"' "$TMP/out2.json"||{ echo "FAIL: next_phase_id";exit 1; }
echo "PASS"

echo "All tests passed"
