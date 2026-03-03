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

# Get the first lead ID from pipeline (any state, for tests that check early preflight gates)
get_first_lead_id() {
  node -e "
    const pipeline = require('./state/pipeline.json');
    if (pipeline.leads.length === 0) {
      console.error('No leads found');
      process.exit(1);
    }
    console.log(pipeline.leads[0].id);
  "
}

# Get the first PENDING_SEND lead ID from pipeline
get_first_pending_lead_id() {
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
# TEST 1: Preflight-only passes NO_INSTALL_ARTIFACTS check when clean
# ===================================================================
log_test "Preflight-only passes NO_INSTALL_ARTIFACTS check when no artifacts exist"

# Create a minimal test lead in PENDING_SEND state
cp state/pipeline.json state/pipeline.json.test-backup
TEST_LEAD_ID="00000000-0000-0000-0000-000000000000"

# Create a minimal PENDING_SEND lead
node -e "
  const pipeline = require('./state/pipeline.json');
  pipeline.leads.unshift({
    id: '$TEST_LEAD_ID',
    state: 'PENDING_SEND',
    imported_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
    raw_data: { name: 'Preflight Test', email: 'test@example.com' },
    draft: { subject: 'Test', body_text: 'Test body' },
    send_status: null,
    history: []
  });
  fs.writeFileSync('state/pipeline.json', JSON.stringify(pipeline, null, 2));
"

setup_test_env

RESULT=$(node commands/send.js --lead "$TEST_LEAD_ID" --mode send_if_enabled --preflight-only 2>/dev/null)

# Restore original pipeline
mv state/pipeline.json.test-backup state/pipeline.json

if echo "$RESULT" | grep -q '"ok": true' && \
   echo "$RESULT" | grep -q '"name": "NO_INSTALL_ARTIFACTS"'; then
  log_pass "Preflight-only includes NO_INSTALL_ARTIFACTS check and passes when clean"
else
  log_fail "Preflight-only did not include or pass NO_INSTALL_ARTIFACTS check"
  echo "Output: $RESULT"
fi

cleanup_test_env

# Clean up backup file if it exists
rm -f state/pipeline.json.test-backup

# ===================================================================
# TEST 2: Preflight-only fails NO_INSTALL_ARTIFACTS check when artifact exists
# ===================================================================
log_test "Preflight-only fails NO_INSTALL_ARTIFACTS check when artifact exists"

# Create sentinel artifact
echo "{}" > .package-lock.json

RESULT=$(node commands/send.js --lead "$(get_first_lead_id)" --mode send_if_enabled --preflight-only 2>/dev/null || echo "")

# Clean up sentinel artifact
rm -f .package-lock.json

if echo "$RESULT" | grep -q '"ok": false' && \
   echo "$RESULT" | grep -q '"failed_check": "NO_INSTALL_ARTIFACTS"' && \
   echo "$RESULT" | grep -q '"\.package-lock\.json"'; then
  log_pass "Preflight-only fails with NO_INSTALL_ARTIFACTS when artifact present"
else
  log_fail "Preflight-only did not detect install artifact properly"
  echo "Output: $RESULT"
fi

# ===================================================================
# TEST 3: Preflight-only returns ok when templates unchanged and env present
# ===================================================================
log_test "Preflight-only returns ok when templates unchanged and env present"

setup_test_env

# Check if we have a PENDING_SEND lead; if not, skip this test
if ! get_first_pending_lead_id >/dev/null 2>&1; then
  echo -e "${YELLOW}⊘ SKIP: No PENDING_SEND leads available${NC}"
  cleanup_test_env
else
  LEAD_ID=$(get_first_pending_lead_id)

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
fi

# ===================================================================
# TEST 4: Preflight-only fails if templates dir has local changes
# ===================================================================
log_test "Preflight-only fails if templates dir has local changes"

setup_test_env

# Check if we have a PENDING_SEND lead; if not, skip this test
if ! get_first_pending_lead_id >/dev/null 2>&1; then
  echo -e "${YELLOW}⊘ SKIP: No PENDING_SEND leads available${NC}"
  cleanup_test_env
else
  LEAD_ID=$(get_first_pending_lead_id)

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
fi

# ===================================================================
# TEST 5: Running preflight does not modify pipeline/config
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
# TEST 6: Preflight-only fails when SMTP env is missing
# ===================================================================
log_test "Preflight-only fails when SMTP env is missing"

# Ensure env vars are NOT set
cleanup_test_env

# Check if we have a PENDING_SEND lead; if not, skip this test
if ! get_first_pending_lead_id >/dev/null 2>&1; then
  echo -e "${YELLOW}⊘ SKIP: No PENDING_SEND leads available${NC}"
else
  LEAD_ID=$(get_first_pending_lead_id)

  RESULT=$(node commands/send.js --lead "$LEAD_ID" --mode send_if_enabled --preflight-only 2>/dev/null)

  if echo "$RESULT" | grep -q '"ok": false' && \
     echo "$RESULT" | grep -q '"failed_check": "SMTP_ENV"'; then
    log_pass "Preflight-only fails when SMTP env is missing"
  else
    log_fail "Preflight-only did not detect missing SMTP env"
    echo "Output: $RESULT"
  fi
fi

# ===================================================================
# TEST 7: Preflight-only fails when lead is not in PENDING_SEND state
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
# TEST 8: Preflight-only fails when config.send_enabled is not boolean
# ===================================================================
log_test "Preflight-only fails when config.send_enabled is not boolean"

setup_test_env

# Check if we have a PENDING_SEND lead; if not, skip this test
if ! get_first_pending_lead_id >/dev/null 2>&1; then
  echo -e "${YELLOW}⊘ SKIP: No PENDING_SEND leads available${NC}"
  cleanup_test_env
else
  # Backup original config
  cp config.json config.json.backup

  # Set send_enabled to a non-boolean value (string)
  node -e "
    const config = require('./config.json');
    config.send_enabled = 'true'; // String, not boolean
    fs.writeFileSync('config.json', JSON.stringify(config, null, 2));
  "

  LEAD_ID=$(get_first_pending_lead_id)

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
fi

# ===================================================================
# TEST 9: Verify test artifacts are cleaned up after tests
# ===================================================================
log_test "Verify test artifacts are cleaned up after tests"

# Restore any test artifacts to original state
git checkout state/pipeline.json 2>/dev/null || true
rm -f state/pipeline.json.test-backup 2>/dev/null || true

# Check for any untracked files or modified files other than expected test files
GIT_STATUS=$(git status --porcelain)

# Filter out expected test file modifications (commands/send.js, lib/preflight.js, test/test-preflight-gate.sh)
UNEXPECTED_CHANGES=$(echo "$GIT_STATUS" | grep -v -E "^ ?M? (commands/send\.js|lib/preflight\.js|test/test-preflight-gate\.sh)$" || echo "")

if [ -z "$UNEXPECTED_CHANGES" ]; then
  log_pass "Test artifacts cleaned up after all tests"
else
  log_fail "Unexpected changes remain after tests"
  echo "Unexpected changes:"
  echo "$UNEXPECTED_CHANGES"
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
