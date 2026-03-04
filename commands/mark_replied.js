#!/usr/bin/env node

/**
 * Voilà Mark Replied Command
 * Mark a sent lead as REPLIED with operator proof
 *
 * Input (CLI args):
 *   --lead <id>                Lead ID to mark as replied
 *   --reply-message-id <id>     Message ID from reply (required)
 *
 * Output (JSON):
 *   {
 *     "lead_id": "uuid",
 *     "previous_state": "SENT",
 *     "new_state": "REPLIED",
 *     "replied_at": "ISO8601",
 *     "reply_message_id": "string"
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
  const result = { leadId: null, replyMessageId: null, inReplyTo: null, prove: false, receiptPath: null };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--lead' && args[i + 1]) {
      result.leadId = args[i + 1];
      i++;
    } else if (args[i] === '--reply-message-id' && args[i + 1]) {
      result.replyMessageId = args[i + 1];
      i++;
    } else if (args[i] === '--in-reply-to' && args[i + 1]) {
      result.inReplyTo = args[i + 1];
      i++;
    } else if (args[i] === '--prove') {
      result.prove = true;
    } else if (args[i] === '--receipt' && args[i + 1]) {
      result.receiptPath = args[i + 1];
      i++;
    }
  }

  return result;
}

async function execute({ leadId, replyMessageId, inReplyTo, prove }) {
  // Validate required args
  if (!leadId) {
    throw new Error('Missing required argument: --lead <id>');
  }

  if (!replyMessageId || replyMessageId.trim() === '') {
    throw new Error('Missing required argument: --reply-message-id <id>');
  }

  if (!inReplyTo || inReplyTo.trim() === '') {
    throw new Error('Missing required argument: --in-reply-to <id>');
  }

  const pipeline = loadPipeline();

  // Proof mode: take before snapshot
  const before = prove ? takeSnapshot({
    leadId: leadId,
    pipelinePath: PIPELINE_FILE,
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
          pipelinePath: PIPELINE_FILE,
          configPath: path.join(__dirname, '..', 'config.json')
        }),
        diffSummary,
        assertInvariants
      });
    }
    throw error;
  }

  const lead = pipeline.leads[leadIndex];

  // Validate in-reply-to linkage
  if (inReplyTo !== null && inReplyTo.trim() !== '') {
    if (!lead.send_status || !lead.send_status.message_id || lead.send_status.message_id.trim() === '') {
      const error = new Error('No outbound message ID found for this lead');
      error.code = 'INVALID_STATE';
      error.details = {
        lead_id: leadId,
        expected_outbound_message_id: null,
        provided_in_reply_to: inReplyTo,
        proof: prove ? generateProof({
          before,
          after: takeSnapshot({
            leadId: leadId,
            pipelinePath: PIPELINE_FILE,
            configPath: path.join(__dirname, '..', 'config.json')
          }),
          diffSummary,
          assertInvariants
        }) : undefined
      };
      throw error;
    }

    if (lead.send_status.message_id !== inReplyTo) {
      const error = new Error('In-reply-to does not match outbound message ID');
      error.code = 'INVALID_STATE';
      error.details = {
        lead_id: leadId,
        current_state: lead.state,
        expected_outbound_message_id: lead.send_status.message_id,
        provided_in_reply_to: inReplyTo,
        proof: prove ? generateProof({
          before,
          after: takeSnapshot({
            leadId: leadId,
            pipelinePath: PIPELINE_FILE,
            configPath: path.join(__dirname, '..', 'config.json')
          }),
          diffSummary,
          assertInvariants
        }) : undefined
      };
      throw error;
    }
  }

  if (lead.state !== 'SENT') {
    const error = new Error('Lead must be in SENT state to mark as replied');
    error.code = 'INVALID_STATE';
    error.details = {
      lead_id: leadId,
      current_state: lead.state,
      required_state: 'SENT',
      proof: prove ? generateProof({
        before,
        after: takeSnapshot({
          leadId: leadId,
          pipelinePath: PIPELINE_FILE,
          configPath: path.join(__dirname, '..', 'config.json')
        }),
        diffSummary,
        assertInvariants
      }) : undefined
    };
    throw error;
  }

  console.error('Voilà: Marking lead as replied...');

  // Store previous state for confirmation
  const previousState = lead.state;

  // Transition to REPLIED state
  const repliedLead = transition(lead, 'REPLIED');
  repliedLead.replied_at = new Date().toISOString();
  repliedLead.reply_message_id = replyMessageId;
  if (inReplyTo) {
    repliedLead.in_reply_to = inReplyTo;
  }

  // Update pipeline
  pipeline.leads[leadIndex] = repliedLead;
  savePipeline(pipeline);

  console.error(`✓ Marked as replied: ${lead.raw_data.name} (${lead.raw_data.email})`);

  const output = {
    lead_id: repliedLead.id,
    previous_state: previousState,
    new_state: repliedLead.state,
    replied_at: repliedLead.replied_at,
    reply_message_id: replyMessageId
  };

  if (prove) {
    const after = takeSnapshot({
      leadId: leadId,
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

  return output;
}

// Entry point with receipt wrapping
async function entrypoint() {
  try {
    const args = parseArgs();

    const stdoutObj = await withReceipt({
      receiptPath: args.receiptPath,
      commandName: 'mark_replied',
      args: {
        lead_id: args.leadId,
        reply_message_id: args.replyMessageId,
        in_reply_to: args.inReplyTo,
        prove: args.prove
      },
      touchedPaths: [PIPELINE_FILE]
    }, () => execute(args));

    printOk(stdoutObj);
    process.exit(0);
  } catch (err) {
    // Map specific errors
    if (err.message === 'Missing required argument: --lead <id>') {
      printError('INVALID_ARGS', err.message, {
        usage: 'voila/mark_replied --lead <id> --reply-message-id <id> --in-reply-to <id>',
        example: 'voila/mark_replied --lead abc-123-def --reply-message-id <some-message-id> --in-reply-to <outbound-message-id>'
      });
    } else if (err.message === 'Missing required argument: --reply-message-id <id>') {
      printError('INVALID_ARGS', err.message, {
        usage: 'voila/mark_replied --lead <id> --reply-message-id <id> --in-reply-to <id>',
        example: 'voila/mark_replied --lead abc-123-def --reply-message-id <some-message-id> --in-reply-to <outbound-message-id>'
      });
    } else if (err.message === 'Missing required argument: --in-reply-to <id>') {
      printError('INVALID_ARGS', err.message, {
        usage: 'voila/mark_replied --lead <id> --reply-message-id <id> --in-reply-to <id>',
        example: 'voila/mark_replied --lead abc-123-def --reply-message-id <some-message-id> --in-reply-to <outbound-message-id>'
      });
    } else if (err.message.startsWith('Lead not found:')) {
      printError('LEAD_NOT_FOUND', err.message, err.details);
    } else if (err.code === 'INVALID_STATE') {
      printError('INVALID_STATE', err.message, err.details);
    } else {
      printError('UNHANDLED_ERROR', err.message, null);
    }
  }
}

entrypoint();
