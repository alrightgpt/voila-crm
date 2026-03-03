#!/usr/bin/env node

/**
 * Voilà Run Daily Orchestrator
 * Run daily voila automation: intake → detect_replies → mark_no_reply
 *
 * Input (CLI args):
 *   --now <ISO8601>           Required: Current timestamp (for deterministic execution)
 *   --scrape-snapshot <path>  Optional: Path to scrape snapshot JSON (for future intake)
 *   --inbox-snapshot <path>   Optional: Path to inbox snapshot JSON
 *   --dry-run                 Optional: Report what would happen without writing
 *   --prove                   Optional: Attach proof bundles to all commands
 *
 * Output (JSON):
 *   {
 *     "ok": true,
 *     "command": "run_daily",
 *     "now": "<ISO8601>",
 *     "dry_run": true|false,
 *     "inputs": {
 *       "scrape_snapshot": "<path>",
 *       "inbox_snapshot": "<path>"
 *     },
 *     "steps": [
 *       {
 *         "name": "validate_inputs",
 *         "ok": true|false,
 *         "details": {...}
 *       },
 *       {
 *         "name": "detect_replies",
 *         "invoked": true|false,
 *         "exit_code": <int|null>,
 *         "stdout_json": <object|null>,
 *         "stderr": "<string|null>"
 *       },
 *       {
 *         "name": "mark_no_reply",
 *         "invoked": true|false,
 *         "exit_code": <int|null>,
 *         "stdout_json": <object|null>,
 *         "stderr": "<string|null>"
 *       }
 *     ]
 *   }
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { fail } = require(path.join(__dirname, '../lib/errors.js'));

const PIPELINE_FILE_DEFAULT = path.join(__dirname, '../state/pipeline.json');
const CONFIG_FILE_DEFAULT = path.join(__dirname, '../config.json');

/**
 * Parse CLI arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const result = {
    now: null,
    scrapeSnapshot: null,
    inboxSnapshot: null,
    dryRun: false,
    prove: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--now' && args[i + 1]) {
      result.now = args[i + 1];
      i++;
    } else if (arg === '--scrape-snapshot' && args[i + 1]) {
      result.scrapeSnapshot = args[i + 1];
      i++;
    } else if (arg === '--inbox-snapshot' && args[i + 1]) {
      result.inboxSnapshot = args[i + 1];
      i++;
    } else if (arg === '--dry-run') {
      result.dryRun = true;
    } else if (arg === '--prove') {
      result.prove = true;
    }
  }

  return result;
}

/**
 * Validate ISO8601 timestamp
 */
function isValidISO8601(timestamp) {
  try {
    const date = new Date(timestamp);
    return !isNaN(date.getTime()) && date.toISOString() === timestamp;
  } catch {
    return false;
  }
}

/**
 * Validate input files exist (unless dry-run)
 */
function validateInputs(args) {
  const errors = [];
  const details = {};

  // Validate scrape snapshot
  if (args.scrapeSnapshot) {
    details.scrape_snapshot = {
      provided: true,
      path: args.scrapeSnapshot,
      exists: fs.existsSync(args.scrapeSnapshot)
    };

    if (!args.dryRun && !fs.existsSync(args.scrapeSnapshot)) {
      errors.push({
        field: 'scrape_snapshot',
        message: 'Scrape snapshot file does not exist',
        path: args.scrapeSnapshot
      });
    }
  } else {
    details.scrape_snapshot = {
      provided: false,
      path: null,
      exists: null
    };
  }

  // Validate inbox snapshot
  if (args.inboxSnapshot) {
    details.inbox_snapshot = {
      provided: true,
      path: args.inboxSnapshot,
      exists: fs.existsSync(args.inboxSnapshot)
    };

    if (!args.dryRun && !fs.existsSync(args.inboxSnapshot)) {
      errors.push({
        field: 'inbox_snapshot',
        message: 'Inbox snapshot file does not exist',
        path: args.inboxSnapshot
      });
    }
  } else {
    details.inbox_snapshot = {
      provided: false,
      path: null,
      exists: null
    };
  }

  return {
    ok: errors.length === 0,
    errors,
    details
  }

  ;
}

/**
 * Spawn a voila command and capture output
 */
function spawnCommand(commandName, args) {
  const commandPath = path.join(__dirname, `${commandName}.js`);
  const spawnArgs = [];

  // Build spawn args
  for (const [key, value] of Object.entries(args)) {
    // Convert camelCase to kebab-case
    const kebabKey = key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);

    if (value === true) {
      spawnArgs.push(`--${kebabKey}`);
    } else if (value !== null && value !== false) {
      spawnArgs.push(`--${kebabKey}`);
      spawnArgs.push(String(value));
    }
  }

  const result = spawnSync('node', [commandPath, ...spawnArgs], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let stdoutJson = null;
  if (result.stdout && result.stdout.trim()) {
    try {
      stdoutJson = JSON.parse(result.stdout);
    } catch (e) {
      // Not valid JSON, keep as string in stderr
    }
  }

  return {
    invoked: true,
    exitCode: result.status,
    stdoutJson,
    stderr: result.stderr || null,
    signal: result.signal
  };
}

/**
 * Run detect_replies command
 */
function runDetectReplies(args) {
  if (!args.inboxSnapshot) {
    return {
      invoked: false,
      exitCode: null,
      stdoutJson: null,
      stderr: 'No inbox snapshot provided'
    };
  }

  const commandArgs = {
    inboxJson: args.inboxSnapshot,
    dryRun: args.dryRun,
    prove: args.prove,
    pipeline: PIPELINE_FILE_DEFAULT,
    config: CONFIG_FILE_DEFAULT
  };

  return spawnCommand('detect_replies', commandArgs);
}

/**
 * Run mark_no_reply command
 */
function runMarkNoReply(args) {
  // Default to 3 days for marking no reply
  const afterDays = 3;

  const commandArgs = {
    now: args.now,
    afterDays: afterDays,
    dryRun: args.dryRun,
    prove: args.prove,
    pipeline: PIPELINE_FILE_DEFAULT,
    config: CONFIG_FILE_DEFAULT
  };

  return spawnCommand('mark_no_reply', commandArgs);
}

/**
 * Main function
 */
function main() {
  const args = parseArgs();

  // Validate required args
  if (!args.now) {
    fail('INVALID_ARGS', 'Missing required argument: --now <ISO8601>', {
      usage: 'voila/run_daily --now <ISO8601> [--scrape-snapshot <path>] [--inbox-snapshot <path>] [--dry-run] [--prove]',
      examples: [
        'voila/run_daily --now 2026-03-03T11:14:00.000Z --scrape-snapshot /path/to/scrape.json --inbox-snapshot /path/to/inbox.json',
        'voila/run_daily --now 2026-03-03T11:14:00.000Z --inbox-snapshot /path/to/inbox.json --dry-run'
      ]
    });
  }

  // Validate ISO8601 timestamp
  if (!isValidISO8601(args.now)) {
    fail('INVALID_ARGS', 'Invalid ISO8601 timestamp format', {
      provided: args.now,
      expected_format: '2026-03-03T11:14:00.000Z'
    });
  }

  // Step 1: Validate inputs
  const validateResult = validateInputs(args);

  // Step 2: Run detect_replies
  const detectRepliesResult = runDetectReplies(args);

  // Step 3: Run mark_no_reply
  const markNoReplyResult = runMarkNoReply(args);

  // Build output
  const output = {
    ok: true,
    command: 'run_daily',
    now: args.now,
    dry_run: args.dryRun,
    inputs: {
      scrape_snapshot: args.scrapeSnapshot,
      inbox_snapshot: args.inboxSnapshot
    },
    steps: [
      {
        name: 'validate_inputs',
        ok: validateResult.ok,
        details: validateResult.details
      },
      {
        name: 'detect_replies',
        invoked: detectRepliesResult.invoked,
        exit_code: detectRepliesResult.exitCode,
        stdout_json: detectRepliesResult.stdoutJson,
        stderr: detectRepliesResult.stderr
      },
      {
        name: 'mark_no_reply',
        invoked: markNoReplyResult.invoked,
        exit_code: markNoReplyResult.exitCode,
        stdout_json: markNoReplyResult.stdoutJson,
        stderr: markNoReplyResult.stderr
      }
    ]
  };

  console.log(JSON.stringify(output, null, 2));
  process.exit(0);
}

main().catch(error => {
  fail('UNEXPECTED_ERROR', error.message, null);
});
