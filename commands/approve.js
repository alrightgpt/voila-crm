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
  const result = { leadId: null };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--lead' && args[i + 1]) {
      result.leadId = args[i + 1];
      i++;
    }
  }

  return result;
}

async function main() {
  console.error('Voilà: Approving lead for sending...');

  const pipeline = loadPipeline();
  const args = parseArgs();

  if (!args.leadId) {
    console.error(JSON.stringify({
      error: 'Missing required argument',
      usage: 'voila/approve --lead <id>',
      example: 'voila/approve --lead abc-123-def'
    }));
    process.exit(1);
  }

  console.error(`Approving lead: ${args.leadId}`);

  const leadIndex = pipeline.leads.findIndex(l => l.id === args.leadId);

  if (leadIndex === -1) {
    console.error(`✗ Lead not found: ${args.leadId}`);
    console.log(JSON.stringify({
      error: 'Lead not found',
      lead_id: args.leadId
    }));
    process.exit(1);
  }

  const lead = pipeline.leads[leadIndex];

  // Validate lead is in DRAFTED state
  if (lead.state !== 'DRAFTED') {
    console.error(`✗ Lead is not in DRAFTED state (current: ${lead.state})`);
    console.log(JSON.stringify({
      error: 'Lead must be in DRAFTED state to approve',
      lead_id: args.leadId,
      current_state: lead.state,
      required_state: 'DRAFTED'
    }));
    process.exit(1);
  }

  // Validate lead has a draft
  if (!lead.draft) {
    console.error(`✗ Lead has no draft to approve`);
    console.log(JSON.stringify({
      error: 'Lead must have a draft to approve',
      lead_id: args.leadId
    }));
    process.exit(1);
  }

  const previousState = lead.state;

  // Transition to PENDING_SEND
  const approvedLead = transition(lead, 'PENDING_SEND');
  approvedLead.approved_at = new Date().toISOString();

  // Save to pipeline
  pipeline.leads[leadIndex] = approvedLead;
  savePipeline(pipeline);

  console.error(`✓ Approved: ${lead.raw_data.name} (${lead.raw_data.email})`);

  console.log(JSON.stringify({
    lead_id: approvedLead.id,
    previous_state: previousState,
    new_state: approvedLead.state,
    approved_at: approvedLead.approved_at
  }, null, 2));

  process.exit(0);
}

main().catch(error => {
  console.error(JSON.stringify({
    error: error.message
  }));
  process.exit(1);
});
