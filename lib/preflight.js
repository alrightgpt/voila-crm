/**
 * Voilà Preflight Gate
 * Pure function for deterministic pre-flight validation before dangerous operations
 *
 * @param {Object} params - Preflight parameters
 * @param {Object|null} params.lead - Lead object (may be null/undefined)
 * @param {string} params.mode - Execution mode: 'simulate' | 'send_if_enabled'
 * @param {Object} params.config - Config object (must contain send_enabled)
 * @param {Object} params.env - Environment variables object (e.g., process.env)
 * @param {Object} params.execSync - execSync function from child_process (for testing)
 * @returns {Object} Preflight result: { ok:boolean, preflight:object } | { ok:boolean, error:object }
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * Get execSync function (allow override for testing)
 */
function getExecSync(customExecSync) {
  return customExecSync || execSync;
}

/**
 * Check for install artifacts in the repository
 * @param {string} repoRoot - Path to repository root
 * @returns {Object} { ok:boolean, details:object|null }
 */
function checkInstallArtifacts(repoRoot) {
  const artifacts = [
    'node_modules/',
    'package-lock.json',
    '.package-lock.json',
    'pnpm-lock.yaml',
    'yarn.lock',
    '.pnp.cjs',
    '.pnp.data.json'
  ];

  const details = {
    artifacts: artifacts
      .map(artifactPath => ({
        path: artifactPath,
        exists: fs.existsSync(path.join(repoRoot, artifactPath))
      }))
      .sort((a, b) => a.path.localeCompare(b.path))
  };

  const anyExist = details.artifacts.some(a => a.exists);

  return {
    ok: !anyExist,
    details: anyExist ? details : null
  };
}

/**
 * Check if templates directory has any git changes
 * @param {string} templatesDir - Path to templates directory
 * @param {Function} execSyncFn - execSync function
 * @returns {boolean} true if templates are immutable (no changes), false otherwise
 */
function areTemplatesImmutable(templatesDir, execSyncFn) {
  try {
    // Get the project root (skills/voila) - __dirname is in lib/, so go up one level
    const projectRoot = path.dirname(__dirname);

    // Check for any changes in templates directory
    const result = execSyncFn(
      `git diff --name-only -- "${templatesDir}"`,
      { encoding: 'utf-8', cwd: projectRoot }
    );

    // Any output means there are changes
    return result.trim().length === 0;
  } catch (error) {
    // If git command fails (e.g., not a git repo), treat as unsafe
    return false;
  }
}

function runPreflight({ lead, mode, config, env, execSync: customExecSync }) {
  const execSyncFn = getExecSync(customExecSync);
  const checks = [];
  const templatesDir = path.join(__dirname, '../templates');

  // Check 0: NO_INSTALL_ARTIFACTS - no lockfiles or node_modules should exist
  const repoRoot = path.resolve(__dirname, '..');
  const installArtifactsCheck = checkInstallArtifacts(repoRoot);
  checks.push({
    name: 'NO_INSTALL_ARTIFACTS',
    ok: installArtifactsCheck.ok,
    details: installArtifactsCheck.details
  });

  if (!installArtifactsCheck.ok) {
    return {
      ok: false,
      error: {
        code: 'PREFLIGHT_FAILED',
        failed_check: 'NO_INSTALL_ARTIFACTS',
        message: 'Install artifacts detected in repository',
        details: installArtifactsCheck.details
      }
    };
  }

  // Check 1: SEND_ENABLED_TYPE - config.send_enabled must be boolean
  const isSendEnabledBoolean = typeof config.send_enabled === 'boolean';
  checks.push({
    name: 'SEND_ENABLED_TYPE',
    ok: isSendEnabledBoolean
  });

  if (!isSendEnabledBoolean) {
    return {
      ok: false,
      error: {
        code: 'PREFLIGHT_FAILED',
        failed_check: 'SEND_ENABLED_TYPE',
        message: 'config.send_enabled must be a boolean value',
        details: {
          actual_type: typeof config.send_enabled
        }
      }
    };
  }

  // Check 2: LEAD_STATE - lead must be in PENDING_SEND state
  const isLeadPending = lead != null && lead.state === 'PENDING_SEND';
  const leadStateCheck = {
    name: 'LEAD_STATE',
    ok: isLeadPending
  };

  if (isLeadPending) {
    leadStateCheck.details = { state: lead.state };
  } else {
    leadStateCheck.details = {
      state: lead?.state ?? null,
      reason: lead == null ? 'lead not found' : 'lead not in PENDING_SEND state'
    };
  }

  checks.push(leadStateCheck);

  if (!isLeadPending) {
    return {
      ok: false,
      error: {
        code: 'PREFLIGHT_FAILED',
        failed_check: 'LEAD_STATE',
        message: 'Lead must be in PENDING_SEND state to send',
        details: leadStateCheck.details
      }
    };
  }

  // Check 3: SMTP_ENV - SMTP environment variables must be present
  const requiredSmtpVars = [
    'VOILA_SMTP_HOST',
    'VOILA_SMTP_PORT',
    'VOILA_SMTP_USER',
    'VOILA_SMTP_PASS',
    'VOILA_FROM_NAME',
    'VOILA_FROM_EMAIL'
  ];

  const missingSmtpVars = requiredSmtpVars.filter(key => {
    return env[key] === undefined || env[key] === '';
  });

  const smtpEnvOk = missingSmtpVars.length === 0;
  const smtpCheck = {
    name: 'SMTP_ENV',
    ok: smtpEnvOk
  };

  if (!smtpEnvOk) {
    smtpCheck.details = { missing: missingSmtpVars };
  }

  checks.push(smtpCheck);

  if (!smtpEnvOk) {
    return {
      ok: false,
      error: {
        code: 'PREFLIGHT_FAILED',
        failed_check: 'SMTP_ENV',
        message: 'Missing required SMTP environment variables',
        details: smtpCheck.details
      }
    };
  }

  // Check 4: TEMPLATES_IMMUTABLE - templates directory must have no git diff
  const templatesImmutable = areTemplatesImmutable(templatesDir, execSyncFn);
  const templatesCheck = {
    name: 'TEMPLATES_IMMUTABLE',
    ok: templatesImmutable
  };

  checks.push(templatesCheck);

  if (!templatesImmutable) {
    return {
      ok: false,
      error: {
        code: 'PREFLIGHT_FAILED',
        failed_check: 'TEMPLATES_IMMUTABLE',
        message: 'Templates directory has uncommitted changes',
        details: {
          templates_dir: templatesDir
        }
      }
    };
  }

  // All checks passed
  return {
    ok: true,
    preflight: {
      checks
    }
  };
}

module.exports = {
  runPreflight
};
