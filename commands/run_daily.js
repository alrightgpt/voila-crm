#!/usr/bin/env node

/**
 * Voilà Run Daily Orchestrator - Phase 2A
 * Deterministic orchestrator for daily voila automation.
 *
 * Phase 2A: CLI runner + JSON aggregation (NO MUTATIONS)
 * - Invokes subcommands via --help (safe, non-mutating)
 * - Aggregates STRICT JSON outputs
 * - No pipeline state mutations in this commit
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
 *     "steps": [
 *       { "name": "intake", "status": "invoked|missing", "cmd": ["node","commands/intake.js","--help"], "exit_code": 0, "ok_json_parse": true, "output_json": {...} }
 *     ],
 *     "notes": [...]
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
 *   2 - invalid arguments
 */

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { printOk, printError } = require(path.join(__dirname, '../lib/result.js'));

// Fixed order of steps (deterministic)
const STEP_DEFINITIONS = [
  { name: 'intake', script: 'intake.js' },
  { name: 'draft', script: 'draft.js' },
  { name: 'approve', script: 'approve.js' },
  { name: 'send', script: 'send.js' },
  { name: 'detect_replies', script: 'detect_replies.js' },
  { name: 'mark_no_reply', script: 'mark_no_reply.js' },
  { name: 'report', script: null } // No script for report yet
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
      description: 'Deterministic orchestrator for daily voila automation (phase 2a)',
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
 * Print error and exit with specific code
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
 * Run a Node command and capture output
 * Uses spawnSync with args array (no shell features)
 * 
 * @param {string[]} argsArray - Arguments to pass to node
 * @returns {Object} { exit_code, stdout, stderr, parsed_json, ok_json_parse }
 */
function runNodeCommand(argsArray) {
  const result = spawnSync(process.execPath, argsArray, {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30000
  });

  const stdout = result.stdout || '';
  const stderr = result.stderr || '';
  const exitCode = result.status !== null ? result.status : -1;

  let parsedJson = null;
  let okJsonParse = false;

  if (stdout && stdout.trim()) {
    try {
      parsedJson = JSON.parse(stdout);
      okJsonParse = true;
    } catch (e) {
      // Not valid JSON, keep parsedJson as null
    }
  }

  return {
    exit_code: exitCode,
    stdout,
    stderr,
    parsed_json: parsedJson,
    ok_json_parse: okJsonParse
  };
}

/**
 * Invoke a subcommand with --help (safe, non-mutating)
 * For Phase 2A, we call --help to verify command exists and get its help output
 * 
 * @param {Object} stepDef - Step definition { name, script }
 * @returns {Object} Step result with invocation details
 */
function invokeStepSafe(stepDef) {
  const commandDir = path.join(__dirname);
  
  if (!stepDef.script) {
    // No script defined for this step (e.g., report)
    return {
      name: stepDef.name,
      status: 'missing',
      cmd: null,
      exit_code: null,
      ok_json_parse: false,
      output_json: null
    };
  }

  const scriptPath = path.join(commandDir, stepDef.script);
  
  // Check if script exists
  if (!fs.existsSync(scriptPath)) {
    return {
      name: stepDef.name,
      status: 'missing',
      cmd: null,
      exit_code: null,
      ok_json_parse: false,
      output_json: null
    };
  }

  // Build command args array
  const cmdArgs = [scriptPath, '--help'];
  
  // Run the command
  const result = runNodeCommand(cmdArgs);

  return {
    name: stepDef.name,
    status: 'invoked',
    cmd: [process.execPath, ...cmdArgs],
    exit_code: result.exit_code,
    ok_json_parse: result.ok_json_parse,
    output_json: result.parsed_json
  };
}

/**
 * Run all steps in fixed order (deterministic)
 * @returns {Object[]} Array of step results
 */
function runAllSteps() {
  const results = [];
  
  for (const stepDef of STEP_DEFINITIONS) {
    const stepResult = invokeStepSafe(stepDef);
    results.push(stepResult);
  }
  
  return results;
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

  // Run all steps (Phase 2A: safe --help invocations only)
  const steps = runAllSteps();

  // Build success output (deterministic, stable ordering)
  const output = {
    command: 'run_daily',
    now: args.now,
    mode: args.mode,
    dry_run: args.dryRun,
    steps,
    notes: [
      'Phase 2A: subcommands invoked via --help (no mutations)',
      'Deterministic: --now is required',
      'Fixed step order: intake, draft, approve, send, detect_replies, mark_no_reply, report'
    ]
  };

  printOk(output);
  process.exit(0);
}

main();
