#!/usr/bin/env node

/**
 * Voilà Approve Command
 * Approve a drafted lead for sending (DRAFTED → PENDING_SEND)
 *
 * Input (CLI args):
 *   --lead <id>           Approve specific lead
 *
 * Output (JSON):
 *   {
 *     "lead_id": "uuid",
 *     "previous_state": "DRAFTED",
 *     "new_state": "PENDING_SEND",
 *     "approved_at": "ISO8601"
 *   }
 */

const fs = require('fs');
const path = require('path');
const { transition } = require(path.join(__dirname, '../lib/state-machine.js'));
const { printError, printOk } = require(path.join(__dirname, '../lib/result.js'));
const { takeSnapshot, diffSummary, assertInvariants, generateProof } = require(path.join(__dirname, '../lib/proof.js'));

// Pipeline state file
const PIPELINE_FILE = path.join(__dirname, '../state/pipeline.json');

/**
 * Load pipeline state
 */
function loadPipeline() {
  if (!fs.existsSync(PIPELINE_FILE)) {
    return { version: '1.0.0', last_updated: null, leads: [] };
  }
  return JSON.parse(fs.readFileSync(PIPELINE_FILE, 'utf-8'));
}

/**
 * Save pipeline state
 */
function savePipeline(pipeline) {
  pipeline.last_updated = new Date().toISOString();
  fs.writeFileSync(PIPELINE_FILE, JSON.stringify(pipeline, null, 2));
}

/**
 * Parse CLI arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const result = { leadId: null, prove: false };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--lead' && args[i + 1]) {
      result.leadId = args[i + 1];
      i++;
    } else if (args[i] === '--prove') {
      result.prove = true;
    }
  }

  return result;
}

async function main() {
  const pipeline = loadPipeline();
  const args = parseArgs();

  if (!args.leadId) {
    printError('INVALID_ARGS', 'Missing required argument: --lead <id>', {
      usage: 'voila/approve --lead <id>',
      example: 'voila/approve --lead abc-123-def'
    });
  }

  // Proof mode: take before snapshot
  const before = args.prove ? takeSnapshot({
    leadId: args.leadId,
    pipelinePath: PIPELINE_FILE,
    configPath: path.join(__dirname, '..', 'config.json')
  }) : null;

  const leadIndex = pipeline.leads.findIndex(l => l.id === args.leadId);

  if (leadIndex === -1) {
    printError('LEAD_NOT_FOUND', `Lead not found: ${args.leadId}`, {
      lead_id: args.leadId,
      proof: args.prove ? generateProof({
        before,
        after: takeSnapshot({
          leadId: args.leadId,
          pipelinePath: PIPELINE_FILE,
          configPath: path.join(__dirname, '..', 'config.json')
        }),
        diffSummary,
        assertInvariants
      }) : undefined
    });
  }

  const lead = pipeline.leads[leadIndex];

  // Validate lead is in DRAFTED state
  if (lead.state !== 'DRAFTED') {
    printError('INVALID_STATE', 'Lead must be in DRAFTED state to approve', {
      lead_id: args.leadId,
      current_state: lead.state,
      required_state: 'DRAFTED',
      proof: args.prove ? generateProof({
        before,
        after: takeSnapshot({
          leadId: args.leadId,
          pipelinePath: PIPELINE_FILE,
          configPath: path.join(__dirname, '..', 'config.json')
        }),
        diffSummary,
        assertInvariants
      }) : undefined
    });
  }

  // Validate lead has a draft
  if (!lead.draft) {
    printError('DRAFT_MISSING', 'Lead must have a draft to approve', {
      lead_id: args.leadId,
      proof: args.prove ? generateProof({
        before,
        after: takeSnapshot({
          leadId: args.leadId,
          pipelinePath: PIPELINE_FILE,
          configPath: path.join(__dirname, '..', 'config.json')
        }),
        diffSummary,
        assertInvariants
      }) : undefined
    });
  }

  console.error('Voilà: Approving lead for sending...');
  console.error(`Approving lead: ${args.leadId}`);

  const previousState = lead.state;

  // Transition to PENDING_SEND
  const approvedLead = transition(lead, 'PENDING_SEND');
  approvedLead.approved_at = new Date().toISOString();

  // Save to pipeline
  pipeline.leads[leadIndex] = approvedLead;
  savePipeline(pipeline);

  console.error(`✓ Approved: ${lead.raw_data.name} (${lead.raw_data.email})`);

  const output = {
    lead_id: approvedLead.id,
    previous_state: previousState,
    new_state: approvedLead.state,
    approved_at: approvedLead.approved_at
  };

  if (args.prove) {
    const after = takeSnapshot({
      leadId: args.leadId,
      pipelinePath: PIPELINE_FILE,
      configPath: path.join(__dirname, '..', 'config.json')
    });
    output._proof = generateProof({
      before,
      after,
      diffSummary,
      assertInvariants
    });
  }

  printOk(output);

  process.exit(0);
}

main().catch(error => {
  printError('UNHANDLED_ERROR', error.message, null);
});
