#!/bin/bash
# Voilà Preflight Gate Tests
# Deterministic shell tests for preflight functionality
# Run from: /home/yucky/.openclaw/workspace/skills/voila

set -e

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counters
PASSED=0
FAILED=0

# Test helper functions
log_test() {
  echo -e "${YELLOW}TEST: $1${NC}"
}

log_pass() {
  echo -e "${GREEN}✓ PASS: $1${NC}"
  PASSED=$((PASSED + 1))
}

log_fail() {
  echo -e "${RED}✗ FAIL: $1${NC}"
  FAILED=$((FAILED + 1))
}

# Get the first lead ID from pipeline
get_first_lead_id() {
  node -e "
    const pipeline = require('./state/pipeline.json');
    const pendingLeads = pipeline.leads.filter(l => l.state === 'PENDING_SEND');
    if (pendingLeads.length === 0) {
      console.error('No PENDING_SEND leads found');
      process.exit(1);
    }
    console.log(pendingLeads[0].id);
  "
}

# Set up test environment with SMTP env vars
setup_test_env() {
  export VOILA_SMTP_HOST="smtp.example.com"
  export VOILA_SMTP_PORT="587"
  export VOILA_SMTP_USER="test@example.com"
  export VOILA_SMTP_PASS="testpass123"
  export VOILA_FROM_NAME="Test Sender"
  export VOILA_FROM_EMAIL="test@example.com"
}

# Clean up test environment
cleanup_test_env() {
  unset VOILA_SMTP_HOST
  unset VOILA_SMTP_PORT
  unset VOILA_SMTP_USER
  unset VOILA_SMTP_PASS
  unset VOILA_FROM_NAME
  unset VOILA_FROM_EMAIL
}

# Change to project root
cd /home/yucky/.openclaw/workspace/skills/voila

echo "==================================================================="
echo "Voilà Preflight Gate Tests"
echo "==================================================================="
echo ""

# Store initial pipeline state
PIPELINE_BEFORE=$(sha256sum state/pipeline.json | awk '{print $1}')

# ===================================================================
# TEST 1: Preflight-only returns ok when templates unchanged and env present
# ===================================================================
log_test "Preflight-only returns ok when templates unchanged and env present"

setup_test_env
LEAD_ID=$(get_first_lead_id)

RESULT=$(node commands/send.js --lead "$LEAD_ID" --mode send_if_enabled --preflight-only 2>/dev/null)

if echo "$RESULT" | grep -q '"ok": true' && \
   echo "$RESULT" | grep -q '"name": "SEND_ENABLED_TYPE"' && \
   echo "$RESULT" | grep -q '"name": "LEAD_STATE"' && \
   echo "$RESULT" | grep -q '"name": "SMTP_ENV"' && \
   echo "$RESULT" | grep -q '"name": "TEMPLATES_IMMUTABLE"'; then
  log_pass "Preflight-only returns ok with all checks when templates unchanged and env present"
else
  log_fail "Preflight-only did not return expected ok result"
  echo "Output: $RESULT"
fi

cleanup_test_env

# ===================================================================
# TEST 2: Preflight-only fails if templates dir has local changes
# ===================================================================
log_test "Preflight-only fails if templates dir has local changes"

setup_test_env
LEAD_ID=$(get_first_lead_id)

# Create a temporary change in templates directory by modifying an existing file
cp templates/independent.txt templates/independent.txt.backup
echo "" >> templates/independent.txt

RESULT=$(node commands/send.js --lead "$LEAD_ID" --mode send_if_enabled --preflight-only 2>/dev/null)

# Clean up the change
mv templates/independent.txt.backup templates/independent.txt

if echo "$RESULT" | grep -q '"ok": false' && \
   echo "$RESULT" | grep -q '"failed_check": "TEMPLATES_IMMUTABLE"'; then
  log_pass "Preflight-only fails when templates dir has changes"
else
  log_fail "Preflight-only did not detect templates changes"
  echo "Output: $RESULT"
fi

cleanup_test_env

# ===================================================================
# TEST 3: Running preflight does not modify pipeline/config
# ===================================================================
log_test "Running preflight does not modify pipeline/config"

setup_test_env
LEAD_ID=$(get_first_lead_id)

# Get pipeline SHA256 before
PIPELINE_SHA_BEFORE=$(sha256sum state/pipeline.json | awk '{print $1}')
CONFIG_SHA_BEFORE=$(sha256sum config.json | awk '{print $1}')

# Run preflight-only (this should NOT modify anything)
node commands/send.js --lead "$LEAD_ID" --mode send_if_enabled --preflight-only > /dev/null 2>&1

# Get pipeline SHA256 after
PIPELINE_SHA_AFTER=$(sha256sum state/pipeline.json | awk '{print $1}')
CONFIG_SHA_AFTER=$(sha256sum config.json | awk '{print $1}')

if [ "$PIPELINE_SHA_BEFORE" = "$PIPELINE_SHA_AFTER" ] && \
   [ "$CONFIG_SHA_BEFORE" = "$CONFIG_SHA_AFTER" ]; then
  log_pass "Preflight does not modify pipeline or config"
else
  log_fail "Preflight modified pipeline or config"
  echo "Pipeline before: $PIPELINE_SHA_BEFORE"
  echo "Pipeline after: $PIPELINE_SHA_AFTER"
  echo "Config before: $CONFIG_SHA_BEFORE"
  echo "Config after: $CONFIG_SHA_AFTER"
fi

cleanup_test_env

# ===================================================================
# TEST 4: Preflight-only fails when SMTP env is missing
# ===================================================================
log_test "Preflight-only fails when SMTP env is missing"

# Ensure env vars are NOT set
cleanup_test_env
LEAD_ID=$(get_first_lead_id)

RESULT=$(node commands/send.js --lead "$LEAD_ID" --mode send_if_enabled --preflight-only 2>/dev/null)

if echo "$RESULT" | grep -q '"ok": false' && \
   echo "$RESULT" | grep -q '"failed_check": "SMTP_ENV"'; then
  log_pass "Preflight-only fails when SMTP env is missing"
else
  log_fail "Preflight-only did not detect missing SMTP env"
  echo "Output: $RESULT"
fi

# ===================================================================
# TEST 5: Preflight-only fails when lead is not in PENDING_SEND state
# ===================================================================
log_test "Preflight-only fails when lead is not in PENDING_SEND state"

setup_test_env

# Find a lead that's NOT in PENDING_SEND state
LEAD_ID=$(node -e "
  const pipeline = require('./state/pipeline.json');
  const nonPendingLeads = pipeline.leads.filter(l => l.state !== 'PENDING_SEND');
  if (nonPendingLeads.length === 0) {
    console.error('No non-PENDING_SEND leads found');
    process.exit(1);
  }
  console.log(nonPendingLeads[0].id);
" 2>/dev/null || echo "")

if [ -n "$LEAD_ID" ]; then
  RESULT=$(node commands/send.js --lead "$LEAD_ID" --mode send_if_enabled --preflight-only 2>/dev/null)

  if echo "$RESULT" | grep -q '"ok": false' && \
     echo "$RESULT" | grep -q '"failed_check": "LEAD_STATE"'; then
    log_pass "Preflight-only fails when lead is not in PENDING_SEND state"
  else
    log_fail "Preflight-only did not detect non-PENDING_SEND lead"
    echo "Output: $RESULT"
  fi
else
  echo -e "${YELLOW}⊘ SKIP: No non-PENDING_SEND leads available${NC}"
fi

cleanup_test_env

# ===================================================================
# TEST 6: Preflight-only fails when config.send_enabled is not boolean
# ===================================================================
log_test "Preflight-only fails when config.send_enabled is not boolean"

setup_test_env

# Backup original config
cp config.json config.json.backup

# Set send_enabled to a non-boolean value (string)
node -e "
  const config = require('./config.json');
  config.send_enabled = 'true'; // String, not boolean
  fs.writeFileSync('config.json', JSON.stringify(config, null, 2));
"

LEAD_ID=$(get_first_lead_id)

RESULT=$(node commands/send.js --lead "$LEAD_ID" --mode send_if_enabled --preflight-only 2>/dev/null)

# Restore original config
mv config.json.backup config.json

if echo "$RESULT" | grep -q '"ok": false' && \
   echo "$RESULT" | grep -q '"failed_check": "SEND_ENABLED_TYPE"'; then
  log_pass "Preflight-only fails when config.send_enabled is not boolean"
else
  log_fail "Preflight-only did not detect non-boolean send_enabled"
  echo "Output: $RESULT"
fi

cleanup_test_env

# ===================================================================
# FINAL VERIFICATION: Ensure git tree is clean
# ===================================================================
log_test "Verify git tree is clean after tests"

GIT_STATUS=$(git status --porcelain)

if [ -z "$GIT_STATUS" ]; then
  log_pass "Git tree is clean after all tests"
else
  log_fail "Git tree is not clean after tests"
  echo "Git status:"
  echo "$GIT_STATUS"
fi

# ===================================================================
# SUMMARY
# ===================================================================
echo ""
echo "==================================================================="
echo "Test Summary"
echo "==================================================================="
echo "Passed: $PASSED"
echo "Failed: $FAILED"
echo "Total:  $((PASSED + FAILED))"
echo "==================================================================="

if [ $FAILED -eq 0 ]; then
  echo -e "${GREEN}All tests passed!${NC}"
  exit 0
else
  echo -e "${RED}Some tests failed!${NC}"
  exit 1
fi
