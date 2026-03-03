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
  const result = { leadId: null, replyMessageId: null, inReplyTo: null };

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
    }
  }

  return result;
}

async function main() {
  console.error('Voilà: Marking lead as replied...');

  const args = parseArgs();

  if (!args.leadId) {
    console.error('✗ Missing required argument: --lead <id>');
    console.log(JSON.stringify({
      error: 'Missing required argument',
      usage: 'voila/mark_replied --lead <id> --reply-message-id <id>',
      example: 'voila/mark_replied --lead abc-123-def --reply-message-id <some-message-id> --in-reply-to <outbound-message-id>'
    }));
    process.exit(1);
  }

  if (!args.replyMessageId || args.replyMessageId.trim() === '') {
    console.error('✗ Missing required argument: --reply-message-id <id>');
    console.log(JSON.stringify({
      error: 'Missing required argument',
      usage: 'voila/mark_replied --lead <id> --reply-message-id <id>',
      example: 'voila/mark_replied --lead abc-123-def --reply-message-id <some-message-id> --in-reply-to <outbound-message-id>'
    }));
    process.exit(1);
  }

  if (!args.inReplyTo || args.inReplyTo.trim() === '') {
    console.error('✗ Missing required argument: --in-reply-to <id>');
    console.log(JSON.stringify({
      error: 'Missing required argument',
      usage: 'voila/mark_replied --lead <id> --reply-message-id <id> --in-reply-to <id>',
      example: 'voila/mark_replied --lead abc-123-def --reply-message-id <some-message-id> --in-reply-to <outbound-message-id>'
    }));
    process.exit(1);
  }

  const pipeline = loadPipeline();
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

  // Validate lead is in SENT state

  // Validate in-reply-to linkage
  if (args.inReplyTo !== null && args.inReplyTo.trim() !== '') {
    if (!lead.send_status || !lead.send_status.message_id || lead.send_status.message_id.trim() === '') {
      console.error('✗ No outbound message ID found for this lead');
      console.log(JSON.stringify({
        error: 'No outbound message ID found',
        lead_id: args.leadId,
        expected_outbound_message_id: null,
        provided_in_reply_to: args.inReplyTo
      }));
      process.exit(1);
    }

    if (lead.send_status.message_id !== args.inReplyTo) {
      console.error('✗ In-reply-to does not match outbound message ID');
      console.log(JSON.stringify({
        error: 'In-reply-to mismatch',
        lead_id: args.leadId,
        current_state: lead.state,
        expected_outbound_message_id: lead.send_status.message_id,
        provided_in_reply_to: args.inReplyTo
      }));
      process.exit(1);
    }
  }

if (lead.state !== 'SENT') {
    console.error(`✗ Lead is not in SENT state (current: ${lead.state})`);
    console.log(JSON.stringify({
      error: 'Lead must be in SENT state to mark as replied',
      lead_id: args.leadId,
      current_state: lead.state,
      required_state: 'SENT'
    }));
    process.exit(1);
  }

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

  console.log(JSON.stringify({
    lead_id: repliedLead.id,
    previous_state: previousState,
    new_state: repliedLead.state,
    replied_at: repliedLead.replied_at,
    reply_message_id: args.replyMessageId
  }, null, 2));

  process.exit(0);
}

main().catch(error => {
  console.error(JSON.stringify({
    error: error.message
  }));
  process.exit(1);
});
