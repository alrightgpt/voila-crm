#!/usr/bin/env node

/**
 * Voilà Mark No Reply Command
 * Automatically mark SENT leads as NO_REPLY based on elapsed time
 *
 * Input (CLI args):
 *   --now <ISO8601>       Required: Current timestamp (for deterministic cutoff calculation)
 *   --after-days <int>    Required: Minimum days after send to mark as NO_REPLY (>=0)
 *   --dry-run             Optional: Report what would happen without writing
 *   --prove               Optional: Attach proof bundle using proof.js
 *   --pipeline <path>     Optional: Path to pipeline.json (default: state/pipeline.json)
 *   --config <path>       Optional: Path to config.json (default: config.json)
 *
 * Output (JSON):
 *   {
 *     "ok": true,
 *     "now": "...",
 *     "after_days": 3,
 *     "cutoff": "...",
 *     "dry_run": true,
 *     "processed": <n>,
 *     "eligible": <n>,
 *     "updated": <n>,
 *     "already_no_reply": <n>,
 *     "skipped_not_sent": <n>,
 *     "skipped_missing_sent_at": <n>,
 *     "updates": [
 *       {
 *         "lead_id": "...",
 *         "from": "SENT",
 *         "to": "NO_REPLY",
 *         "sent_at": "...",
 *         "reason": "older_than_cutoff",
 *         "would_write": true|false
 *       }
 *     ],
 *     "_proof": {...} // only if --prove
 *   }
 */

const fs = require('fs');
const path = require('path');
const { transition } = require(path.join(__dirname, '../lib/state-machine.js'));
const { printError, printOk } = require(path.join(__dirname, '../lib/result.js'));
const { takeSnapshot, diffSummary, assertInvariants, generateProof } = require(path.join(__dirname, '../lib/proof.js'));
const { withReceipt } = require(path.join(__dirname, '../lib/receipt.js'));

const PIPELINE_FILE_DEFAULT = path.join(__dirname, '../state/pipeline.json');
const CONFIG_FILE_DEFAULT = path.join(__dirname, '../config.json');

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

function savePipeline(pipeline, pipelinePath, nowIso) {
  pipeline.last_updated = nowIso;
  fs.writeFileSync(pipelinePath, JSON.stringify(pipeline, null, 2));
}

function parseArgs() {
  const args = process.argv.slice(2);
  const result = {
    now: null,
    afterDays: null,
    dryRun: false,
    prove: false,
    receiptPath: null,
    pipelinePath: PIPELINE_FILE_DEFAULT,
    configPath: CONFIG_FILE_DEFAULT
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--now' && args[i + 1]) {
      result.now = args[i + 1];
      i++;
    } else if (arg === '--after-days' && args[i + 1]) {
      result.afterDays = args[i + 1];
      i++;
    } else if (arg === '--dry-run') {
      result.dryRun = true;
    } else if (arg === '--prove') {
      result.prove = true;
    } else if (arg === '--receipt' && args[i + 1]) {
      result.receiptPath = args[i + 1];
      i++;
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

async function execute({ now, afterDays, dryRun, prove, pipelinePath, configPath }) {
  // Validate required args
  if (!now) {
    throw new Error('Missing required argument: --now <ISO8601>');
  }

  if (afterDays === null) {
    throw new Error('Missing required argument: --after-days <int>');
  }

  // Validate --now is valid ISO8601
  const nowMs = Date.parse(now);
  if (isNaN(nowMs)) {
    const error = new Error('Invalid --now timestamp: must be valid ISO8601 format');
    error.details = { now };
    throw error;
  }

  // Validate --after-days is valid integer >= 0
  const afterDaysInt = parseInt(afterDays, 10);
  if (isNaN(afterDaysInt) || afterDaysInt < 0) {
    const error = new Error('Invalid --after-days: must be integer >= 0');
    error.details = { after_days: afterDays };
    throw error;
  }

  // Calculate cutoff timestamp
  const cutoffMs = nowMs - afterDaysInt * 24 * 60 * 60 * 1000;
  const cutoffIso = new Date(cutoffMs).toISOString();

  // Load pipeline and config
  const pipeline = loadPipeline(pipelinePath);
  const config = loadConfig(configPath);

  // Take before snapshot if --prove
  let beforeSnapshot = null;
  if (prove) {
    beforeSnapshot = takeSnapshot({
      leadId: null,
      pipelinePath: pipelinePath,
      configPath: configPath
    });
  }

  // Initialize counters
  let processed = 0;
  let eligible = 0;
  let updated = 0;
  let alreadyNoReply = 0;
  let skippedNotSent = 0;
  let skippedMissingSentAt = 0;
  const updates = [];

  // Process leads in pipeline order
  for (let i = 0; i < pipeline.leads.length; i++) {
    const lead = pipeline.leads[i];
    processed++;

    // Skip leads not in SENT state
    if (lead.state !== 'SENT') {
      if (lead.state === 'NO_REPLY') {
        alreadyNoReply++;
      } else {
        skippedNotSent++;
      }
      continue;
    }

    // Skip leads without sent_at
    if (!lead.sent_at) {
      skippedMissingSentAt++;
      continue;
    }

    // Calculate sent timestamp
    const sentMs = Date.parse(lead.sent_at);
    if (isNaN(sentMs)) {
      skippedMissingSentAt++;
      continue;
    }

    // Check if sent before cutoff
    if (sentMs < cutoffMs) {
      eligible++;

      const update = {
        lead_id: lead.id,
        from: lead.state,
        to: 'NO_REPLY',
        sent_at: lead.sent_at,
        reason: 'older_than_cutoff',
        would_write: !dryRun
      };

      // Apply transition if not dry run
      if (!dryRun) {
        const noReplyLead = transition(lead, 'NO_REPLY');
        noReplyLead.no_reply_at = now;
        noReplyLead.no_reply_cutoff = cutoffIso;
        pipeline.leads[i] = noReplyLead;
        updated++;
      }

      updates.push(update);
    }
  }

  // Save pipeline if not dry run and there were updates
  if (!dryRun && updated > 0) {
    savePipeline(pipeline, pipelinePath, now);
  }

  console.error('Voilà: Marking leads as no-reply...');

  const output = {
    now: now,
    after_days: afterDaysInt,
    cutoff: cutoffIso,
    dry_run: dryRun,
    processed: processed,
    eligible: eligible,
    updated: updated,
    already_no_reply: alreadyNoReply,
    skipped_not_sent: skippedNotSent,
    skipped_missing_sent_at: skippedMissingSentAt,
    updates: updates
  };

  if (prove) {
    const afterSnapshot = takeSnapshot({
      leadId: null,
      pipelinePath: pipelinePath,
      configPath: configPath
    });

    output._proof = generateProof({
      before: beforeSnapshot,
      after: afterSnapshot,
      diffSummary,
      assertInvariants
    });
  }

  return output;
}

// Entry point with receipt wrapping
async function entrypoint() {
  try {
    const parsedArgs = parseArgs();

    const stdoutObj = await withReceipt({
      receiptPath: parsedArgs.receiptPath,
      commandName: 'mark_no_reply',
      args: {
        now: parsedArgs.now,
        after_days: parsedArgs.afterDays,
        dry_run: parsedArgs.dryRun,
        prove: parsedArgs.prove,
        pipeline_path: parsedArgs.pipelinePath,
        config_path: parsedArgs.configPath
      },
      touchedPaths: [parsedArgs.pipelinePath]
    }, () => execute(parsedArgs));

    printOk(stdoutObj);
    process.exit(0);
  } catch (err) {
    // Map specific errors
    if (err.message === 'Missing required argument: --now <ISO8601>') {
      printError('INVALID_ARGS', err.message, {
        usage: 'voila/mark_no_reply --now <ISO8601> --after-days <int> [--dry-run] [--prove] [--pipeline <path>] [--config <path>]',
        examples: [
          'voila/mark_no_reply --now 2026-03-03T09:00:00.000Z --after-days 3',
          'voila/mark_no_reply --now 2026-03-03T09:00:00.000Z --after-days 3 --dry-run',
          'voila/mark_no_reply --now 2026-03-03T09:00:00.000Z --after-days 3 --prove'
        ]
      });
    } else if (err.message === 'Missing required argument: --after-days <int>') {
      printError('INVALID_ARGS', err.message, {
        usage: 'voila/mark_no_reply --now <ISO8601> --after-days <int> [--dry-run] [--prove] [--pipeline <path>] [--config <path>]'
      });
    } else if (err.message === 'Invalid --now timestamp: must be valid ISO8601 format') {
      printError('INVALID_ARGS', err.message, err.details);
    } else if (err.message === 'Invalid --after-days: must be integer >= 0') {
      printError('INVALID_ARGS', err.message, err.details);
    } else {
      printError('UNHANDLED_ERROR', err.message, null);
    }
  }
}

entrypoint();
