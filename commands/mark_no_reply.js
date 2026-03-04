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
const { sha256FileOrNull } = require(path.join(__dirname, '../lib/receipt.js'));

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

async function main() {
  const args = parseArgs();
  const beforeHash = args.receiptPath ? sha256FileOrNull(args.pipelinePath) : null;

  // Validate required args
  if (!args.now) {
    printError('INVALID_ARGS', 'Missing required argument: --now <ISO8601>', {
      usage: 'voila/mark_no_reply --now <ISO8601> --after-days <int> [--dry-run] [--prove] [--pipeline <path>] [--config <path>]',
      examples: [
        'voila/mark_no_reply --now 2026-03-03T09:00:00.000Z --after-days 3',
        'voila/mark_no_reply --now 2026-03-03T09:00:00.000Z --after-days 3 --dry-run',
        'voila/mark_no_reply --now 2026-03-03T09:00:00.000Z --after-days 3 --prove'
      ]
    });
  }

  if (args.afterDays === null) {
    printError('INVALID_ARGS', 'Missing required argument: --after-days <int>', {
      usage: 'voila/mark_no_reply --now <ISO8601> --after-days <int> [--dry-run] [--prove] [--pipeline <path>] [--config <path>]'
    });
  }

  // Validate --now is valid ISO8601
  const nowMs = Date.parse(args.now);
  if (isNaN(nowMs)) {
    printError('INVALID_ARGS', 'Invalid --now timestamp: must be valid ISO8601 format', {
      now: args.now
    });
  }

  // Validate --after-days is valid integer >= 0
  const afterDaysInt = parseInt(args.afterDays, 10);
  if (isNaN(afterDaysInt) || afterDaysInt < 0) {
    printError('INVALID_ARGS', 'Invalid --after-days: must be integer >= 0', {
      after_days: args.afterDays
    });
  }

  // Calculate cutoff timestamp
  const cutoffMs = nowMs - afterDaysInt * 24 * 60 * 60 * 1000;
  const cutoffIso = new Date(cutoffMs).toISOString();

  // Load pipeline and config
  const pipeline = loadPipeline(args.pipelinePath);
  const config = loadConfig(args.configPath);

  // Take before snapshot if --prove
  let beforeSnapshot = null;
  if (args.prove) {
    beforeSnapshot = takeSnapshot({
      leadId: null,
      pipelinePath: args.pipelinePath,
      configPath: args.configPath
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

    // Skip if already NO_REPLY
    if (lead.state === 'NO_REPLY') {
      alreadyNoReply++;
      continue;
    }

    // Skip if not in SENT state
    if (lead.state !== 'SENT') {
      skippedNotSent++;
      continue;
    }

    // Determine sent_at timestamp
    const sentAt = lead.send_status?.sent_at || lead.sent_at || null;

    // Skip if sent_at is missing or invalid
    if (!sentAt || isNaN(Date.parse(sentAt))) {
      skippedMissingSentAt++;
      continue;
    }

    const sentAtMs = Date.parse(sentAt);

    // Check if eligible (sent_at <= cutoff)
    if (sentAtMs <= cutoffMs) {
      eligible++;

      if (args.dryRun) {
        // Dry run: record would-transition but don't mutate
        updates.push({
          lead_id: lead.id,
          from: 'SENT',
          to: 'NO_REPLY',
          sent_at: sentAt,
          reason: 'older_than_cutoff',
          would_write: false
        });
      } else {
        // Real run: transition and update
        const transitioned = transition(lead, 'NO_REPLY');
        transitioned.no_reply_status = {
          marked_at: args.now,
          cutoff: cutoffIso,
          after_days: afterDaysInt,
          sent_at: sentAt
        };

        pipeline.leads[i] = transitioned;
        updated++;

        updates.push({
          lead_id: lead.id,
          from: 'SENT',
          to: 'NO_REPLY',
          sent_at: sentAt,
          reason: 'older_than_cutoff',
          would_write: true
        });
      }
    }
  }

  // Write pipeline only if not dry-run and we have updates
  if (!args.dryRun && updated > 0) {
    savePipeline(pipeline, args.pipelinePath, args.now);
  }

  // Generate proof if requested
  let proofOutput = undefined;
  if (args.prove) {
    const afterSnapshot = takeSnapshot({
      leadId: null,
      pipelinePath: args.pipelinePath,
      configPath: args.configPath
    });

    proofOutput = generateProof({
      before: beforeSnapshot,
      after: afterSnapshot,
      diffSummary,
      assertInvariants
    });
  }

  // Output success JSON
  const output = {
    ok: true,
    now: args.now,
    after_days: afterDaysInt,
    cutoff: cutoffIso,
    dry_run: args.dryRun,
    processed,
    eligible,
    updated,
    already_no_reply: alreadyNoReply,
    skipped_not_sent: skippedNotSent,
    skipped_missing_sent_at: skippedMissingSentAt,
    updates,
    _proof: proofOutput
  };

  // Write receipt if requested
  if (args.receiptPath) {
    const afterHash = sha256FileOrNull(args.pipelinePath);
    const receipt = {
      ok: true,
      command: 'mark_no_reply',
      args: { now: args.now, after_days: args.afterDays, dry_run: args.dryRun, prove: args.prove, pipeline_path: args.pipelinePath, config_path: args.configPath },
      touched_files: [
        {
          path: args.pipelinePath,
          sha256_before: beforeHash,
          sha256_after: afterHash
        }
      ],
      stdout_json: output
    };

    try {
      const tempPath = `${args.receiptPath}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(receipt, null, 2), 'utf-8');
      fs.renameSync(tempPath, args.receiptPath);
    } catch (receiptError) {
      console.error(`[Receipt write failed: ${receiptError.message}]`);
    }
  }

  printOk(output);
  process.exit(0);
}

main().catch(error => {
  printError('UNHANDLED_ERROR', error.message, null);
});
