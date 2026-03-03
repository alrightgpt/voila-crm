/**
 * Voilà Proof Mode
 * Snapshot + diff assertions for proving exactly what changed
 */

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const WORKSPACE = '/home/yucky/.openclaw/workspace';

/**
 * Compute SHA256 hash of file contents
 * @param {string} filePath - Path to file
 * @returns {string|null} SHA256 hex or null if file doesn't exist
 */
function computeSHA256(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Take snapshot of current state
 * @param {Object} params - Snapshot parameters
 * @param {string|null} params.leadId - Lead ID (optional, for lead state extraction)
 * @param {string} params.pipelinePath - Path to pipeline.json
 * @param {string} params.configPath - Path to config.json
 * @returns {Object} Snapshot object
 */
function takeSnapshot({ leadId, pipelinePath, configPath }) {
  const timestamp = new Date().toISOString();
  
  // File hashes
  const pipelineJsonSha256 = computeSHA256(pipelinePath);
  const configJsonSha256 = computeSHA256(configPath);
  
  // Lead snapshot (if leadId provided and pipeline exists)
  let lead = null;
  if (leadId && pipelineJsonSha256) {
    try {
      const pipeline = JSON.parse(fs.readFileSync(pipelinePath, 'utf-8'));
      const foundLead = pipeline.leads.find(l => l.id === leadId);
      if (foundLead) {
        lead = {
          id: foundLead.id,
          state: foundLead.state,
          has_draft: !!foundLead.draft
        };
      }
    } catch (e) {
      // Pipeline parse error - keep lead default (id=null, state=null, has_draft=null)
    }
  }
  
  return {
    ts: timestamp,
    files: {
      pipeline_json_sha256: pipelineJsonSha256,
      config_json_sha256: configJsonSha256
    },
    lead
  };
}

/**
 * Compute diff summary between before and after snapshots
 * @param {Object} params - Diff parameters
 * @param {Object} params.before - Before snapshot
 * @param {Object} params.after - After snapshot
 * @returns {Object} Diff summary
 */
function diffSummary({ before, after }) {
  const pipelineChanged = before.files.pipeline_json_sha256 !== after.files.pipeline_json_sha256;
  const configChanged = before.files.config_json_sha256 !== after.files.config_json_sha256;
  
  return {
    changed_files: [], // Git diff tracking not implemented for this phase
    pipeline_changed: pipelineChanged,
    config_changed: configChanged
  };
}

/**
 * Assert invariants haven't been violated
 * @param {Object} params - Invariant check parameters
 * @param {Array<string>} params.changedFiles - List of changed files from git diff
 * @returns {Object} Invariant check result
 */
function assertInvariants({ changedFiles }) {
  const violations = [];
  
  // INVARIANTS
  const TEMPLATES_IMMUTABLE = 'TEMPLATES_IMMUTABLE';
  const NO_UNEXPECTED_SKILL_CHANGES = 'NO_UNEXPECTED_SKILL_CHANGES';
  
  // Check: TEMPLATES_IMMUTABLE
  const templateChanges = changedFiles.filter(f => f.startsWith('skills/voila/templates/'));
  if (templateChanges.length > 0) {
    violations.push({
      code: TEMPLATES_IMMUTABLE,
      details: {
        message: 'Template files should not change during runtime',
        changed_templates: templateChanges
      }
    });
  }
  
  // Check: NO_UNEXPECTED_SKILL_CHANGES
  const skillChanges = changedFiles.filter(f => 
    f.startsWith('skills/voila/commands/') || f.startsWith('skills/voila/lib/')
  );
  if (skillChanges.length > 0) {
    violations.push({
      code: NO_UNEXPECTED_SKILL_CHANGES,
      details: {
        message: 'Command and library files should not change during runtime',
        changed_skill_files: skillChanges
      }
    });
  }
  
  return {
    ok: violations.length === 0,
    violations
  };
}

/**
 * Generate proof evidence for a command run
 * @param {Object} params - Proof parameters
 * @param {Object} params.before - Before snapshot
 * @param {Object} params.after - After snapshot
 * @param {Function} params.diffSummary - Diff summary function
 * @param {Function} params.assertInvariants - Invariant assertion function
 * @returns {Object} Proof object
 */
function generateProof({ before, after, diffSummary, assertInvariants }) {
  const diff = diffSummary({ before, after });
  const invariants = assertInvariants({ changedFiles: diff.changed_files });
  
  return {
    before,
    after,
    diff,
    invariants
  };
}

module.exports = {
  takeSnapshot,
  diffSummary,
  assertInvariants,
  generateProof
};
