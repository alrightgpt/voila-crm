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
const { withReceipt } = require(path.join(__dirname, '../lib/receipt.js'));

// Pipeline state file
const PIPELINE_FILE = path.join(__dirname, '../state/pipeline.json');

/**
 * Load pipeline state
 */
function loadPipeline(pipelinePath) {
  if (!fs.existsSync(pipelinePath)) {
    return { version: '1.0.0', last_updated: null, leads: [] };
  }
  return JSON.parse(fs.readFileSync(pipelinePath, 'utf-8'));
}

/**
 * Save pipeline state
 */
function savePipeline(pipeline, pipelinePath) {
  pipeline.last_updated = new Date().toISOString();
  fs.writeFileSync(pipelinePath, JSON.stringify(pipeline, null, 2));
}

/**
 * Parse CLI arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const result = { leadId: null, prove: false, receiptPath: null, pipelinePath: PIPELINE_FILE };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--lead' && args[i + 1]) {
      result.leadId = args[i + 1];
      i++;
    } else if (args[i] === '--prove') {
      result.prove = true;
    } else if (args[i] === '--receipt' && args[i + 1]) {
      result.receiptPath = args[i + 1];
      i++;
    } else if (args[i] === '--pipeline' && args[i + 1]) {
      result.pipelinePath = args[i + 1];
      i++;
    }
  }

  return result;
}

async function execute({ leadId, prove, receiptPath, pipelinePath }) {
  // Validate required args
  if (!leadId) {
    throw new Error('Missing required argument: --lead <id>');
  }

  const pipeline = loadPipeline(pipelinePath);

  // Proof mode: take before snapshot
  const before = prove ? takeSnapshot({
    leadId: leadId,
    pipelinePath: pipelinePath,
    configPath: path.join(__dirname, '..', 'config.json')
  }) : null;

  const leadIndex = pipeline.leads.findIndex(l => l.id === leadId);

  if (leadIndex === -1) {
    const error = new Error(`Lead not found: ${leadId}`);
    error.details = { lead_id: leadId };
    if (prove) {
      error.details.proof = generateProof({
        before,
        after: takeSnapshot({
          leadId: leadId,
          pipelinePath: pipelinePath,
          configPath: path.join(__dirname, '..', 'config.json')
        }),
        diffSummary,
        assertInvariants
      });
    }
    throw error;
  }

  const lead = pipeline.leads[leadIndex];

  // Validate lead is in DRAFTED state
  if (lead.state !== 'DRAFTED') {
    const error = new Error('Lead must be in DRAFTED state to approve');
    error.code = 'INVALID_STATE';
    error.details = {
      lead_id: leadId,
      current_state: lead.state,
      required_state: 'DRAFTED',
      proof: prove ? generateProof({
        before,
        after: takeSnapshot({
          leadId: leadId,
          pipelinePath: pipelinePath,
          configPath: path.join(__dirname, '..', 'config.json')
        }),
        diffSummary,
        assertInvariants
      }) : undefined
    };
    throw error;
  }

  // Validate lead has a draft
  if (!lead.draft) {
    const error = new Error('Lead must have a draft to approve');
    error.code = 'DRAFT_MISSING';
    error.details = {
      lead_id: leadId,
      proof: prove ? generateProof({
        before,
        after: takeSnapshot({
          leadId: leadId,
          pipelinePath: pipelinePath,
          configPath: path.join(__dirname, '..', 'config.json')
        }),
        diffSummary,
        assertInvariants
      }) : undefined
    };
    throw error;
  }

  console.error('Voilà: Approving lead for sending...');
  console.error(`Approving lead: ${leadId}`);

  const previousState = lead.state;

  // Transition to PENDING_SEND
  const approvedLead = transition(lead, 'PENDING_SEND');
  approvedLead.approved_at = new Date().toISOString();

  // Save to pipeline
  pipeline.leads[leadIndex] = approvedLead;
  savePipeline(pipeline, pipelinePath);

  console.error(`✓ Approved: ${lead.raw_data.name} (${lead.raw_data.email})`);

  const output = {
    lead_id: approvedLead.id,
    previous_state: previousState,
    new_state: approvedLead.state,
    approved_at: approvedLead.approved_at
  };

  if (prove) {
    const after = takeSnapshot({
      leadId: leadId,
      pipelinePath: pipelinePath,
      configPath: path.join(__dirname, '..', 'config.json')
    });
    output._proof = generateProof({
      before,
      after,
      diffSummary,
      assertInvariants
    });
  }

  return output;
}

// Entry point with receipt wrapping
async function entrypoint() {
  try {
    const args = parseArgs();

    const stdoutObj = await withReceipt({
      receiptPath: args.receiptPath,
      commandName: 'approve',
      args: { lead_id: args.leadId, prove: args.prove },
      touchedPaths: [args.pipelinePath]
    }, () => execute(args));

    printOk(stdoutObj);
    process.exit(0);
  } catch (err) {
    // Map specific errors
    if (err.message === 'Missing required argument: --lead <id>') {
      printError('INVALID_ARGS', err.message, {
        usage: 'voila/approve --lead <id>',
        example: 'voila/approve --lead abc-123-def'
      });
    } else if (err.message === 'Lead not found:') {
      printError('LEAD_NOT_FOUND', err.message, err.details);
    } else if (err.code === 'INVALID_STATE') {
      printError('INVALID_STATE', err.message, err.details);
    } else if (err.code === 'DRAFT_MISSING') {
      printError('DRAFT_MISSING', err.message, err.details);
    } else {
      printError('UNHANDLED_ERROR', err.message, null);
    }
  }
}

entrypoint();
