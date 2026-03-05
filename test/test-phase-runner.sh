#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"
TMP="test/tmp_phase_runner_v3"
mkdir -p "$TMP"
cleanup(){ rm -rf "$TMP" runs; }
trap cleanup EXIT

echo "Test 1: create with default out dir"
P="$TMP/p.json"
cat>"$P"<<'EOF'
{"run_id":"r","phase_id":"P1","phase_index":1,"repo_root":"/voila","prompt":"p","next_phase_id":"P2"}
EOF
node scripts/phase_runner.js --plan "$P" --now "2026-03-05T12:00:00Z">/dev/null
[ -f "runs/phases/r.P1.json" ]||{ echo "FAIL";exit 1; }
grep -q '"phase_index": 1' "runs/phases/r.P1.json"||{ echo "FAIL";exit 1; }
echo "PASS"

echo "Test 2: full flow"
O="$TMP/o"
mkdir -p "$O"
cat>"$TMP/p1"<<'EOF'
{"run_id":"run","phase_id":"A","phase_index":1,"repo_root":"/v","prompt":"a","next_phase_id":"B"}
EOF
node scripts/phase_runner.js --plan "$TMP/p1" --out-dir "$O" --now "2026-03-05T12:00:00Z">/dev/null
cat>"$TMP/p2"<<'EOF'
{"run_id":"run","phase_id":"B","phase_index":2,"repo_root":"/v","prompt":"b","next_phase_id":"C"}
EOF
node scripts/phase_runner.js --plan "$TMP/p2" --out-dir "$O" --now "2026-03-05T12:01:00Z">/dev/null
echo '{"ok":true}'>"$TMP/e.json"
node scripts/phase_runner.js --receipt "$O/run.B.json" --append-result "$TMP/e.json" --now "2026-03-05T12:02:00Z">/dev/null
grep -q 'EXECUTOR_RESULT_ATTACHED' "$O/run.B.json"||{ echo "FAIL";exit 1; }
node scripts/phase_runner.js --receipt "$O/run.B.json" --print-next>"$TMP/pn.json"
grep -q '"next_phase_id": "C"' "$TMP/pn.json"||{ echo "FAIL";exit 1; }
node scripts/phase_runner.js --resume run --dir "$O">"$TMP/r.json"
grep -q '"current_phase_index": 2' "$TMP/r.json"||{ echo "FAIL";exit 1; }
grep -q '"prompt": "b"' "$TMP/r.json"||{ echo "FAIL";exit 1; }
echo "PASS"

echo "Test 3: resume not found"
node scripts/phase_runner.js --resume xxx --dir "$O">"$TMP/err.json" 2>&1||true
grep -q '"ok": false' "$TMP/err.json"||{ echo "FAIL";exit 1; }
echo "PASS"

echo "All tests passed"
