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
  const result = { leadId: null, replyMessageId: null, inReplyTo: null, prove: false };

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
    }
  }

  return result;
}

async function main() {
  const args = parseArgs();

  if (!args.leadId) {
    printError('INVALID_ARGS', 'Missing required argument: --lead <id>', {
      usage: 'voila/mark_replied --lead <id> --reply-message-id <id> --in-reply-to <id>',
      example: 'voila/mark_replied --lead abc-123-def --reply-message-id <some-message-id> --in-reply-to <outbound-message-id>'
    });
  }

  if (!args.replyMessageId || args.replyMessageId.trim() === '') {
    printError('INVALID_ARGS', 'Missing required argument: --reply-message-id <id>', {
      usage: 'voila/mark_replied --lead <id> --reply-message-id <id> --in-reply-to <id>',
      example: 'voila/mark_replied --lead abc-123-def --reply-message-id <some-message-id> --in-reply-to <outbound-message-id>'
    });
  }

  if (!args.inReplyTo || args.inReplyTo.trim() === '') {
    printError('INVALID_ARGS', 'Missing required argument: --in-reply-to <id>', {
      usage: 'voila/mark_replied --lead <id> --reply-message-id <id> --in-reply-to <id>',
      example: 'voila/mark_replied --lead abc-123-def --reply-message-id <some-message-id> --in-reply-to <outbound-message-id>'
    });
  }

  const pipeline = loadPipeline();

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

  // Validate in-reply-to linkage
  if (args.inReplyTo !== null && args.inReplyTo.trim() !== '') {
    if (!lead.send_status || !lead.send_status.message_id || lead.send_status.message_id.trim() === '') {
      printError('INVALID_STATE', 'No outbound message ID found for this lead', {
        lead_id: args.leadId,
        expected_outbound_message_id: null,
        provided_in_reply_to: args.inReplyTo,
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

    if (lead.send_status.message_id !== args.inReplyTo) {
      printError('INVALID_STATE', 'In-reply-to does not match outbound message ID', {
        lead_id: args.leadId,
        current_state: lead.state,
        expected_outbound_message_id: lead.send_status.message_id,
        provided_in_reply_to: args.inReplyTo,
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
  }

  if (lead.state !== 'SENT') {
    printError('INVALID_STATE', 'Lead must be in SENT state to mark as replied', {
      lead_id: args.leadId,
      current_state: lead.state,
      required_state: 'SENT',
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

  console.error('Voilà: Marking lead as replied...');

  // Store previous state for confirmation
  const previousState = lead.state;

  // Transition to REPLIED state
  const repliedLead = transition(lead, 'REPLIED');
  repliedLead.replied_at = new Date().toISOString();
  repliedLead.reply_message_id = args.replyMessageId;
  if (args.inReplyTo) {
    repliedLead.in_reply_to = args.inReplyTo;
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
    reply_message_id: args.replyMessageId
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
