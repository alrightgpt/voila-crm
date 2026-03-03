#!/usr/bin/env node

/**
 * Voilà Detect Replies Command
 * Automatically mark matching leads as REPLIED based on inbound messages
 *
 * Input (CLI args):
 *   --inbox-json <path>    Required: Path to JSON file with inbound messages
 *   --dry-run               Optional: Report what would happen without writing
 *   --prove                 Optional: Attach proof bundle
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
const { fail } = require(path.join(__dirname, '../lib/errors.js'));
const { takeSnapshot, generateProof } = require(path.join(__dirname, '../lib/proof.js'));

// Default paths
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
    
    // Handle space-separated flags with values: --flag value
    if (arg.startsWith('--') && !arg.includes('=') && i + 1 < args.length) {
      const nextArg = args[i + 1];
      
      if (arg === '--inbox-json') {
        result.inboxPath = nextArg;
        i++; // Skip next arg (it's the value)
        continue;
      } else if (arg === '--dry-run') {
        result.dryRun = true;
      } else if (arg === '--prove') {
        result.prove = true;
      } else if (arg === '--pipeline') {
        result.pipelinePath = nextArg;
        i++;
        continue;
      } else if (arg === '--config') {
        result.configPath = nextArg;
        i++;
        continue;
      }
    }
    
    // Handle equals syntax: --flag=value
    if (arg.includes('=')) {
      const [flag, value] = arg.split('=', 2);
      
      if (flag === '--inbox-json') {
        result.inboxPath = value;
      } else if (flag === '--dry-run') {
        result.dryRun = value === 'true';
      } else if (flag === '--prove') {
        result.prove = value === 'true';
      } else if (flag === '--pipeline') {
        result.pipelinePath = value;
      } else if (flag === '--config') {
        result.configPath = value;
      }
    }
  }
  
  return result;
}

async function main() {
  const args = parseArgs();
  
  // Validate required arguments
  if (!args.inboxPath) {
    fail('INVALID_ARGS', 'Missing required argument: --inbox-json <path>', {
      usage: 'voila/detect_replies --inbox-json <path> [--dry-run] [--prove] [--pipeline <path>] [--config <path>]',
      examples: [
        'voila/detect_replies --inbox-json /path/to/inbox.json',
        'voila/detect_replies --inbox-json /path/to/inbox.json --dry-run',
        'voila/detect_replies --inbox-json /path/to/inbox.json --prove'
      ]
    });
  }
  
  // Load inbox
  const inbox = loadInbox(args.inboxPath);
  if (!inbox) {
    fail('INTAKE_PARSE_FAILED', 'Failed to load or parse inbox JSON', {
      inbox_path: args.inboxPath
    });
  }
  
  // Load pipeline and config
  const pipeline = loadPipeline(args.pipelinePath);
  const config = loadConfig(args.configPath);
  
  // Create lead lookup by message_id for O(1) matching
  const leadsByMessageId = new Map();
  for (const lead of pipeline.leads) {
    if (lead.send_status?.message_id) {
      leadsByMessageId.set(lead.send_status.message_id, lead);
    }
  }
  
  // Statistics
  let processed = 0;
  let matched = 0;
  let updated = 0;
  let skippedAlreadyReplied = 0;
  const errors = [];
  const matches = [];
  const unmatchedMessages = [];
  
  // Process each inbound message
  for (let i = 0; i < inbox.length; i++) {
    const message = inbox[i];
    processed++;
    
    // Validation: message.in_reply_to must be non-empty
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
    
    // Find matching lead
    const lead = leadsByMessageId.get(message.in_reply_to);
    const fromEmailNormalized = normalizeEmail(message.from_email);
    
    if (!lead) {
      // No matching lead
      unmatchedMessages.push({
        message_id: message.message_id,
        in_reply_to: message.in_reply_to,
        from_email: message.from_email,
        subject: message.subject
      });
      continue;
    }
    
    // Safety check: email addresses must match (if both present)
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
    
    // Check if lead is in SENT state
    if (lead.state !== 'SENT') {
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
    
    // Check if lead is already REPLIED (idempotent)
    if (lead.state === 'REPLIED') {
      skippedAlreadyReplied++;
      matches.push({
        lead_id: lead.id,
        in_reply_to: message.in_reply_to,
        reply_message_id: message.message_id,
        from_email: message.from_email,
        email_check: emailCheck,
        details: emailCheckDetails,
        would_transition_to: 'REPLIED'
      });
      continue;
    }
    
    // Match found - proceed with transition
    matched++;
    
    if (args.dryRun) {
      // Dry run: just report would_mark_replied
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
      // Actual transition
      const updatedLead = transition(lead, 'REPLIED');
      
      // Store reply info (NO timestamp for determinism)
      updatedLead.reply_status = {
        replied_at: null,
        reply_message_id: message.message_id,
        in_reply_to: message.in_reply_to
      };
      
      // Update pipeline
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
  
  const unmatched = inbox.length - matches.length;
  
  // Only save pipeline if we made changes and not in dry-run mode
  if (updated > 0 && !args.dryRun) {
    savePipeline(pipeline, args.pipelinePath);
  }
  
  // Generate proof if requested
  let proofOutput = undefined;
  if (args.prove) {
    const before = takeSnapshot({
      leadId: null,
      pipelinePath: args.pipelinePath,
      configPath: args.configPath
    });
    
    const after = takeSnapshot({
      leadId: null,
      pipelinePath: args.pipelinePath,
      configPath: args.configPath
    });
    
    proofOutput = generateProof({
      before,
      after,
      diffSummary: (before, after) => {
        const gitChangedFiles = after.git.diff_name_only.filter(f => !before.git.diff_name_only.includes(f));
        const pipelineChanged = before.files.pipeline_json_sha256 !== after.files.pipeline_json_sha256;
        const configChanged = before.files.config_json_sha256 !== after.files.config_json_sha256;
        return {
          changed_files: gitChangedFiles,
          pipeline_changed: pipelineChanged,
          config_changed: configChanged
        };
      },
      assertInvariants: ({ changedFiles }) => {
        const violations = [];
        const TEMPLATES_IMMUTABLE = 'TEMPLATES_IMMUTABLE';
        
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
        
        return {
          ok: violations.length === 0,
          violations
        };
      }
    });
  }
  
  const output = {
    ok: true,
    inbox_path: args.inboxPath,
    dry_run: args.dryRun,
    processed,
    matched,
    updated,
    skipped_already_replied: unmatchedMessages.length,
    unmatched: unmatchedMessages.length,
    matches,
    unmatched_messages: unmatchedMessages,
    errors,
    _proof: proofOutput
  };
  
  console.log(JSON.stringify(output, null, 2));
  
  process.exit(0);
}

main().catch(error => {
  fail('UNEXPECTED_ERROR', error.message, null);
});
