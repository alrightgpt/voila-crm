#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SSOT="$ROOT/PROJECT_STATE.md"
BAK="$ROOT/PROJECT_STATE.md.bak"

cleanup() {
  if [[ -f "$BAK" ]]; then
    mv -f "$BAK" "$SSOT"
  fi
}
trap cleanup EXIT

if [[ ! -f "$SSOT" ]]; then
  echo "Expected SSOT missing at $SSOT" >&2
  exit 2
fi

# Temporarily remove SSOT
mv -f "$SSOT" "$BAK"

# Run a mutation command and assert strict JSON error + nonzero exit.
set +e
OUT="$(node "$ROOT/commands/intake.js" 2>/dev/null)"
EC=$?
set -e

if [[ "$EC" -eq 0 ]]; then
  echo "Expected non-zero exit when SSOT is missing" >&2
  echo "stdout: $OUT" >&2
  exit 1
fi

node -e 'const fs=require("fs"); const s=fs.readFileSync(0,"utf8"); const j=JSON.parse(s); if(j.code!=="SSOT_INVALID") { console.error("Expected code SSOT_INVALID, got:", j.code); process.exit(1); }' <<<"$OUT" >/dev/null

echo "SSOT enforcement test passed"
