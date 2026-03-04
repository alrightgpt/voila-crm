#!/usr/bin/env node

/**
 * Voilà Detect Replies Command
 * Automatically mark matching leads as REPLIED based on inbound messages
 *
 * Input (CLI args):
 *   --inbox-json <path>    Required: Path to JSON file with inbound messages
 *   --dry-run               Optional: Report what would happen without writing
 *   --prove                 Optional: Attach proof bundle using Phase 3 proof.js
 *   --pipeline <path>        Optional: Path to pipeline.json (default: state/pipeline.json)
 *   --config <path>          Optional: Path to config.json (default: config.json)
 *
 * Output (JSON):
 *   {
 *     "ok": true,
 *     "inbox_path": "<path>",
 *     "dry_run": true|false,
 *     "processed": <n>,
 *     "matched": <n>,
 *     "updated": <n>,
 *     "skipped_already_replied": <n>,
 *     "unmatched": <n>,
 *     "matches": [...],
 *     "unmatched_messages": [...],
 *     "errors": [...],
 *     "_proof": {...} // only if --prove
 *   }
 */

const fs = require('fs');
const path = require('path');
const { transition } = require(path.join(__dirname, '../lib/state-machine.js'));
const { printError, printOk } = require(path.join(__dirname, '../lib/result.js'));
const { takeSnapshot, diffSummary, assertInvariants, generateProof } = require(path.join(__dirname, '../lib/proof.js'));

const PIPELINE_FILE_DEFAULT = path.join(__dirname, '../state/pipeline.json');
const CONFIG_FILE_DEFAULT = path.join(__dirname, '../config.json');

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function loadInbox(inboxPath) {
  try {
    const content = fs.readFileSync(inboxPath, 'utf-8');
    const data = JSON.parse(content);
    
    if (!data.messages || !Array.isArray(data.messages)) {
      return null;
    }
    
    return data.messages;
  } catch (error) {
    return null;
  }
}

function loadPipeline(pipelinePath) {
  if (!fs.existsSync(pipelinePath)) {
    return { version: '1.0.0', last_updated: null, leads: [] };
  }
  return JSON.parse(fs.readFileSync(pipelinePath, 'utf-8'));
}

function loadConfig(configPath) {
  if (!fs.existsSync(configPath)) {
    return { send_enabled: false };
  }
  return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
}

function savePipeline(pipeline, pipelinePath) {
  pipeline.last_updated = new Date().toISOString();
  fs.writeFileSync(pipelinePath, JSON.stringify(pipeline, null, 2));
}

function parseArgs() {
  const args = process.argv.slice(2);
  const result = { inboxPath: null, dryRun: false, prove: false, pipelinePath: PIPELINE_FILE_DEFAULT, configPath: CONFIG_FILE_DEFAULT };
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--inbox-json' && args[i + 1]) {
      result.inboxPath = args[i + 1];
      i++;
    } else if (arg === '--dry-run') {
      result.dryRun = true;
    } else if (arg === '--prove') {
      result.prove = true;
    } else if (arg === '--pipeline' && args[i + 1]) {
      result.pipelinePath = args[i + 1];
      i++;
    } else if (arg === '--config' && args[i + 1]) {
      result.configPath = args[i + 1];
      i++;
    }
  }
  
  return result;
}

async function main() {
  const args = parseArgs();
  
  if (!args.inboxPath) {
    printError('INVALID_ARGS', 'Missing required argument: --inbox-json <path>', {
      usage: 'voila/detect_replies --inbox-json <path> [--dry-run] [--prove] [--pipeline <path>] [--config <path>]',
      examples: [
        'voila/detect_replies --inbox-json /path/to/inbox.json',
        'voila/detect_replies --inbox-json /path/to/inbox.json --dry-run',
        'voila/detect_replies --inbox-json /path/to/inbox.json --prove'
      ]
    });
  }

  const inbox = loadInbox(args.inboxPath);
  if (!inbox) {
    printError('INTAKE_PARSE_FAILED', 'Failed to load or parse inbox JSON', {
      inbox_path: args.inboxPath
    });
  }
  
  const pipeline = loadPipeline(args.pipelinePath);
  const config = loadConfig(args.configPath);
  
  const leadsByMessageId = new Map();
  for (const lead of pipeline.leads) {
    if (lead.send_status?.message_id) {
      leadsByMessageId.set(lead.send_status.message_id, lead);
    }
  }
  
  let processed = 0;
  let matched = 0;
  let updated = 0;
  let skippedAlreadyReplied = 0;
  const errors = [];
  const matches = [];
  const unmatchedMessages = [];
  
  for (let i = 0; i < inbox.length; i++) {
    const message = inbox[i];
    processed++;
    
    if (!message.in_reply_to || typeof message.in_reply_to !== 'string' || message.in_reply_to.trim() === '') {
      errors.push({
        index: i,
        code: 'MISSING_IN_REPLY_TO',
        message: 'Message missing in_reply_to',
        details: {
          message_id: message.message_id
        }
      });
      continue;
    }
    
    const lead = leadsByMessageId.get(message.in_reply_to);
    const fromEmailNormalized = normalizeEmail(message.from_email);
    
    if (!lead) {
      unmatchedMessages.push({
        message_id: message.message_id,
        in_reply_to: message.in_reply_to,
        from_email: message.from_email,
        subject: message.subject
      });
      continue;
    }
    
    if (lead.state !== 'SENT' && lead.state !== 'REPLIED') {
      errors.push({
        index: i,
        code: 'LEAD_NOT_SENT',
        message: 'Lead is not in SENT state',
        details: {
          lead_id: lead.id,
          lead_state: lead.state,
          message_id: message.message_id
        }
      });
      continue;
    }
    
    if (lead.state === 'REPLIED') {
      skippedAlreadyReplied++;
      matches.push({
        lead_id: lead.id,
        in_reply_to: message.in_reply_to,
        reply_message_id: message.message_id,
        from_email: message.from_email,
        email_check: 'skipped',
        details: null,
        already_replied: true
      });
      continue;
    }
    
    // Email safety check: if both emails exist, verify they match (non-blocking)
    let emailCheck = 'skipped';
    let emailCheckDetails = null;
    if (lead.raw_data?.email && message.from_email) {
      const leadEmailNormalized = normalizeEmail(lead.raw_data.email);
      if (leadEmailNormalized !== fromEmailNormalized) {
        emailCheck = 'mismatch';
        emailCheckDetails = {
          lead_email: lead.raw_data.email,
          message_from_email: message.from_email
        };
      }
    }
    
    matched++;
    
    if (args.dryRun) {
      matches.push({
        lead_id: lead.id,
        in_reply_to: message.in_reply_to,
        reply_message_id: message.message_id,
        from_email: message.from_email,
        email_check: emailCheck,
        details: emailCheckDetails,
        would_transition_to: 'REPLIED'
      });
    } else {
      const updatedLead = transition(lead, 'REPLIED');
      updatedLead.reply_status = {
        replied_at: null,
        reply_message_id: message.message_id,
        in_reply_to: message.in_reply_to
      };
      
      const leadIndex = pipeline.leads.findIndex(l => l.id === lead.id);
      if (leadIndex !== -1) {
        pipeline.leads[leadIndex] = updatedLead;
      }
      
      updated++;
      matches.push({
        lead_id: lead.id,
        in_reply_to: message.in_reply_to,
        reply_message_id: message.message_id,
        from_email: message.from_email,
        email_check: emailCheck,
        details: emailCheckDetails
      });
    }
  }
  
  if (updated > 0 && !args.dryRun) {
    savePipeline(pipeline, args.pipelinePath);
  }
  
  let proofOutput = undefined;
  if (args.prove) {
    proofOutput = generateProof({
      before: takeSnapshot({ leadId: null, pipelinePath: args.pipelinePath, configPath: args.configPath }),
      after: takeSnapshot({ leadId: null, pipelinePath: args.pipelinePath, configPath: args.configPath }),
      diffSummary,
      assertInvariants
    });
  }
  
  const output = {
    ok: true,
    inbox_path: args.inboxPath,
    dry_run: args.dryRun,
    processed,
    matched,
    updated,
    skipped_already_replied: skippedAlreadyReplied,
    unmatched: unmatchedMessages.length,
    matches,
    unmatched_messages: unmatchedMessages,
    errors,
    _proof: proofOutput
  };
  
  printOk(output);
  process.exit(0);
}

main().catch(error => {
  printError('UNHANDLED_ERROR', error.message, null);
});
