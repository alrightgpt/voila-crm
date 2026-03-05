#!/usr/bin/env node

/**
 * Voilà Run Daily Orchestrator Scaffold
 * Deterministic orchestrator for daily voila automation.
 *
 * This is a SCAFFOLD: no subcommands are executed.
 * Future commits will wire up actual command invocations.
 *
 * CLI:
 *   node commands/run_daily.js --now <ISO8601> [--mode <simulate|send_if_enabled>] [--dry-run]
 *
 * Arguments:
 *   --now <ISO8601>       REQUIRED: Current timestamp (deterministic, no Date.now())
 *   --mode <mode>         Optional: "simulate" (default) or "send_if_enabled"
 *   --dry-run             Optional: Flag (default: false)
 *
 * Output (STRICT JSON to stdout):
 *   On success:
 *   {
 *     "ok": true,
 *     "command": "run_daily",
 *     "now": "<ISO8601 exactly as provided>",
 *     "mode": "simulate|send_if_enabled",
 *     "dry_run": true|false,
 *     "steps_planned": [
 *       { "name": "intake", "status": "planned" },
 *       { "name": "draft", "status": "planned" },
 *       { "name": "approve", "status": "planned" },
 *       { "name": "send", "status": "planned" },
 *       { "name": "detect_replies", "status": "planned" },
 *       { "name": "mark_no_reply", "status": "planned" },
 *       { "name": "report", "status": "planned" }
 *     ],
 *     "notes": [
 *       "Scaffold only: no subcommands executed",
 *       "Deterministic: --now is required"
 *     ]
 *   }
 *
 *   On error:
 *   {
 *     "ok": false,
 *     "code": "INVALID_ARGS",
 *     "message": "...",
 *     "details": { ... }
 *   }
 *
 * Exit codes:
 *   0 - success
 *   2 - invalid arguments (consistent with INVALID_ARGS code)
 */

const path = require('path');
const { printOk, printError } = require(path.join(__dirname, '../lib/result.js'));

// Fixed order of steps (deterministic)
const STEPS_PLANNED = [
  { name: 'intake', status: 'planned' },
  { name: 'draft', status: 'planned' },
  { name: 'approve', status: 'planned' },
  { name: 'send', status: 'planned' },
  { name: 'detect_replies', status: 'planned' },
  { name: 'mark_no_reply', status: 'planned' },
  { name: 'report', status: 'planned' }
];

const VALID_MODES = ['simulate', 'send_if_enabled'];
const DEFAULT_MODE = 'simulate';

/**
 * Parse CLI arguments deterministically
 * @returns {Object} Parsed arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const result = {
    now: null,
    mode: DEFAULT_MODE,
    dryRun: false,
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--now' && args[i + 1]) {
      result.now = args[i + 1];
      i++;
    } else if (arg === '--mode' && args[i + 1]) {
      result.mode = args[i + 1];
      i++;
    } else if (arg === '--dry-run') {
      result.dryRun = true;
    } else if (arg === '--help' || arg === '-h') {
      result.help = true;
    }
  }

  return result;
}

/**
 * Validate ISO8601 timestamp format
 * Uses Date.parse ONLY for validation, not for generating time.
 * @param {string} timestamp - The timestamp to validate
 * @returns {boolean} True if valid ISO8601
 */
function isValidISO8601(timestamp) {
  if (typeof timestamp !== 'string') return false;
  const parsed = Date.parse(timestamp);
  return !isNaN(parsed);
}

/**
 * Print help as STRICT JSON
 */
function printHelp() {
  console.log(JSON.stringify({
    ok: true,
    command: 'run_daily',
    help: {
      description: 'Deterministic orchestrator for daily voila automation (scaffold)',
      usage: 'node commands/run_daily.js --now <ISO8601> [--mode <simulate|send_if_enabled>] [--dry-run]',
      arguments: [
        { name: '--now', required: true, description: 'Current timestamp in ISO8601 format', example: '2026-03-04T00:00:00Z' },
        { name: '--mode', required: false, default: 'simulate', options: VALID_MODES, description: 'Execution mode' },
        { name: '--dry-run', required: false, default: false, description: 'Dry run flag' },
        { name: '--help', required: false, description: 'Print this help' }
      ],
      exit_codes: [
        { code: 0, description: 'Success' },
        { code: 2, description: 'Invalid arguments' }
      ]
    }
  }, null, 2));
}

/**
 * Print error and exit with specific code (for INVALID_ARGS, use code 2)
 * @param {string} code - Error code
 * @param {string} message - Error message
 * @param {Object|null} details - Error details
 * @param {number} exitCode - Exit code (default 1)
 */
function fail(code, message, details = null, exitCode = 1) {
  const result = {
    ok: false,
    code,
    message,
    details
  };
  console.log(JSON.stringify(result, null, 2));
  process.exit(exitCode);
}

/**
 * Main entry point
 */
function main() {
  const args = parseArgs();

  // Handle help flag
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  // Validate required --now argument
  if (!args.now) {
    fail(
      'INVALID_ARGS',
      'Missing required argument: --now <ISO8601>',
      { missing: 'now', usage: 'node commands/run_daily.js --now <ISO8601> [--mode <simulate|send_if_enabled>] [--dry-run]' },
      2
    );
  }

  // Validate ISO8601 format
  if (!isValidISO8601(args.now)) {
    fail(
      'INVALID_ARGS',
      'Invalid ISO8601 timestamp format',
      { field: 'now', provided: args.now, expected: 'ISO8601 format (e.g., 2026-03-04T00:00:00Z)' },
      2
    );
  }

  // Validate mode
  if (!VALID_MODES.includes(args.mode)) {
    fail(
      'INVALID_ARGS',
      'Invalid mode value',
      { field: 'mode', provided: args.mode, valid_values: VALID_MODES },
      2
    );
  }

  // Build success output (deterministic, stable ordering)
  const output = {
    command: 'run_daily',
    now: args.now,
    mode: args.mode,
    dry_run: args.dryRun,
    steps_planned: STEPS_PLANNED,
    notes: [
      'Scaffold only: no subcommands executed',
      'Deterministic: --now is required'
    ]
  };

  printOk(output);
  process.exit(0);
}

main();
