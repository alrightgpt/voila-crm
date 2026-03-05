'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Enforce that the canonical Voila SSOT exists and matches expected markers.
 * Canonical location: <repo_root>/PROJECT_STATE.md
 *
 * Deterministic: only filesystem reads, no time, no randomness.
 * On failure: prints STRICT JSON to stdout and exits(1).
 */
function assertVoilaSSOT() {
  const repoRoot = path.resolve(__dirname, '..');
  const expectedPath = path.join(repoRoot, 'PROJECT_STATE.md');

  const required_markers = ['Canonical Architectural State', 'Voilà Automation'];

  let contents;
  try {
    contents = fs.readFileSync(expectedPath, 'utf8');
  } catch (err) {
    return failSSOT(expectedPath, required_markers, `Failed to read SSOT file: ${err.message}`);
  }

  for (const marker of required_markers) {
    if (!contents.includes(marker)) {
      return failSSOT(
        expectedPath,
        required_markers,
        `SSOT missing required marker: ${marker}`
      );
    }
  }
}

function failSSOT(expected_path, required_markers, reason) {
  const payload = {
    ok: false,
    code: 'SSOT_INVALID',
    message:
      'Voila SSOT missing or unexpected. Read PROJECT_STATE.md before running mutation commands.',
    details: {
      expected_path,
      required_markers,
      reason
    }
  };

  process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
  process.exit(1);
}

module.exports = {
  assertVoilaSSOT
};
