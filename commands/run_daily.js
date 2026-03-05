#!/usr/bin/env node

/**
 * Voilà Run Daily Orchestrator - Phase 2D
 * Deterministic orchestrator for daily voila automation.
 *
 * Phase 2D: detect_replies step wired with --inbox-json support
 * - --inbox-json <path>: Path to inbox snapshot JSON (enables detect_replies step)
 *
 * CLI:
 *   node commands/run_daily.js --now <ISO8601> [--mode <simulate|send_if_enabled>] [--dry-run] [--plan-only|--execute] [--inbox-json <path>]
 *
 * Arguments:
 *   --now <ISO8601>       REQUIRED: Current timestamp (deterministic, no Date.now())
 *   --mode <mode>         Optional: "simulate" (default) or "send_if_enabled"
 *   --dry-run             Optional: Flag (default: false)
 *   --plan-only           Optional: Plan-only mode (default if --execute not set)
 *   --execute             Optional: Execute mode (requires --dry-run for safety)
 *   --inbox-json <path>   Optional: Path to inbox snapshot JSON (enables detect_replies)
 *
 * Output (STRICT JSON to stdout):
 *   On success:
 *   {
 *     "ok": true,
 *     "command": "run_daily",
 *     "now": "<ISO8601 exactly as provided>",
 *     "mode": "simulate|send_if_enabled",
 *     "dry_run": true|false,
 *     "plan_only": true|false,
 *     "inbox_json": "<path or null>",
 *     "steps": [
 *       {
 *         "name": "send",
 *         "status": "invoked_help|executed_dry_run|skipped_unsafe|missing",
 *         "supports_dry_run": true|false|unknown,
 *         "cmd": [...],
 *         "exit_code": 0,
 *         "ok_json_parse": true,
 *         "output_json": {...},
 *         "reason": "..." // only when skipped_unsafe
 *       }
 *     ],
 *     "notes": [...]
 *   }
 *
 * Exit codes:
 *   0 - success
 *   2 - invalid arguments (e.g., --execute without --dry-run)
 */

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { printOk, printError } = require(path.join(__dirname, '../lib/result.js'));

// Fixed order of steps (deterministic)
// supports_dry_run: determined by inspecting command source
const STEP_DEFINITIONS = [
  { name: 'intake', script: 'intake.js', supports_dry_run: false },
  { name: 'draft', script: 'draft.js', supports_dry_run: false },
  { name: 'approve', script: 'approve.js', supports_dry_run: false },
  { name: 'send', script: 'send.js', supports_dry_run: true },
  { name: 'detect_replies', script: 'detect_replies.js', supports_dry_run: true },
  { name: 'mark_no_reply', script: 'mark_no_reply.js', supports_dry_run: true },
  { name: 'report', script: null, supports_dry_run: false } // No script for report yet
];

const VALID_MODES = ['simulate', 'send_if_enabled'];
const DEFAULT_MODE = 'simulate';
const DEFAULT_AFTER_DAYS = 7;

/**
 * Parse CLI arguments deterministically
 * @returns {Object} Parsed arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const result = {
    now: null,
    mode: DEFAULT_MODE,
    afterDays: DEFAULT_AFTER_DAYS,
    dryRun: false,
    planOnly: true,  // Default to plan-only
    execute: false,
    inboxJson: null,
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
    } else if (arg === '--after-days' && args[i + 1]) {
      result.afterDays = args[i + 1];
      i++;
    } else if (arg === '--dry-run') {
      result.dryRun = true;
    } else if (arg === '--plan-only') {
      result.planOnly = true;
      result.execute = false;
    } else if (arg === '--execute') {
      result.execute = true;
      result.planOnly = false;
    } else if (arg === '--inbox-json' && args[i + 1]) {
      result.inboxJson = args[i + 1];
      i++;
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
      description: 'Deterministic orchestrator for daily voila automation (phase 2d)',
      usage: 'node commands/run_daily.js --now <ISO8601> [--mode <simulate|send_if_enabled>] [--dry-run] [--plan-only|--execute] [--inbox-json <path>]',
      arguments: [
        { name: '--now', required: true, description: 'Current timestamp in ISO8601 format', example: '2026-03-04T00:00:00Z' },
        { name: '--mode', required: false, default: 'simulate', options: VALID_MODES, description: 'Execution mode' },
        { name: '--dry-run', required: false, default: false, description: 'Dry run flag' },
        { name: '--plan-only', required: false, default: true, description: 'Plan-only mode (invoke --help only)' },
        { name: '--execute', required: false, description: 'Execute mode (requires --dry-run)' },
        { name: '--inbox-json', required: false, description: 'Path to inbox snapshot JSON (enables detect_replies step)' },
        { name: '--help', required: false, description: 'Print this help' }
      ],
      safety: [
        '--execute requires --dry-run to prevent accidental mutations',
        'Steps without dry-run support are skipped with status skipped_unsafe'
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
 * Invoke a step in plan-only mode (via --help)
 * 
 * @param {Object} stepDef - Step definition { name, script, supports_dry_run }
 * @returns {Object} Step result with invocation details
 */
function invokeStepPlanOnly(stepDef) {
  const commandDir = path.join(__dirname);
  
  if (!stepDef.script) {
    return {
      name: stepDef.name,
      status: 'missing',
      supports_dry_run: stepDef.supports_dry_run ? true : false,
      cmd: null,
      exit_code: null,
      ok_json_parse: false,
      output_json: null
    };
  }

  const scriptPath = path.join(commandDir, stepDef.script);
  
  if (!fs.existsSync(scriptPath)) {
    return {
      name: stepDef.name,
      status: 'missing',
      supports_dry_run: 'unknown',
      cmd: null,
      exit_code: null,
      ok_json_parse: false,
      output_json: null
    };
  }

  // Build command args array (--help invocation)
  const cmdArgs = [scriptPath, '--help'];
  const result = runNodeCommand(cmdArgs);

  return {
    name: stepDef.name,
    status: 'invoked_help',
    supports_dry_run: stepDef.supports_dry_run,
    cmd: [process.execPath, ...cmdArgs],
    exit_code: result.exit_code,
    ok_json_parse: result.ok_json_parse,
    output_json: result.parsed_json
  };
}

/**
 * Invoke a step in execute mode (with --dry-run safety)
 * 
 * @param {Object} stepDef - Step definition { name, script, supports_dry_run }
 * @param {Object} args - CLI arguments (for --now, --inbox-json, etc.)
 * @returns {Object} Step result with invocation details
 */
function invokeStepExecute(stepDef, args) {
  const commandDir = path.join(__dirname);
  
  if (!stepDef.script) {
    return {
      name: stepDef.name,
      status: 'missing',
      supports_dry_run: stepDef.supports_dry_run ? true : false,
      cmd: null,
      exit_code: null,
      ok_json_parse: false,
      output_json: null
    };
  }

  const scriptPath = path.join(commandDir, stepDef.script);
  
  if (!fs.existsSync(scriptPath)) {
    return {
      name: stepDef.name,
      status: 'missing',
      supports_dry_run: 'unknown',
      cmd: null,
      exit_code: null,
      ok_json_parse: false,
      output_json: null
    };
  }

  // Check if step supports dry-run
  if (!stepDef.supports_dry_run) {
    return {
      name: stepDef.name,
      status: 'skipped_unsafe',
      supports_dry_run: false,
      cmd: null,
      exit_code: null,
      ok_json_parse: false,
      output_json: null,
      reason: 'Step does not support --dry-run; skipped for safety'
    };
  }

  // Build command args array (actual invocation with --dry-run)
  // Phase 2D: Execute steps with appropriate arguments
  let cmdArgs;
  
  if (stepDef.name === 'send') {
    // send.js args: --all --mode <mode> --dry-run (no --now needed)
    cmdArgs = [scriptPath, '--all', '--mode', args.mode, '--dry-run'];
  } else if (stepDef.name === 'detect_replies') {
    // detect_replies.js requires --now and --inbox-json
    if (!args.inboxJson) {
      return {
        name: stepDef.name,
        status: 'skipped_unsafe',
        supports_dry_run: true,
        cmd: null,
        exit_code: null,
        ok_json_parse: false,
        output_json: null,
        reason: 'detect_replies requires --inbox-json; not provided'
      };
    }
    // Invoke with --now, --inbox-json, and --dry-run
    cmdArgs = [scriptPath, '--now', args.now, '--inbox-json', args.inboxJson, '--dry-run'];
  } else if (stepDef.name === 'mark_no_reply') {
    // mark_no_reply.js needs --now and --after-days
    cmdArgs = [scriptPath, '--now', args.now, '--after-days', String(args.afterDays), '--dry-run'];
  } else {
    // Generic fallback
    cmdArgs = [scriptPath, '--dry-run'];
  }

  const result = runNodeCommand(cmdArgs);

  // Determine step status based on execution result
  const stepOk = result.exit_code === 0 && result.ok_json_parse;

  return {
    name: stepDef.name,
    status: 'executed_dry_run',
    supports_dry_run: true,
    ok: stepOk,
    cmd: [process.execPath, ...cmdArgs],
    exit_code: result.exit_code,
    ok_json_parse: result.ok_json_parse,
    output_json: result.parsed_json,
    error: stepOk ? null : (result.stderr || 'Command failed or returned non-JSON')
  };
}

/**
 * Run all steps in fixed order (deterministic)
 * @param {Object} args - CLI arguments
 * @returns {Object[]} Array of step results
 */
function runAllSteps(args) {
  const results = [];
  
  for (const stepDef of STEP_DEFINITIONS) {
    let stepResult;
    
    if (args.execute) {
      stepResult = invokeStepExecute(stepDef, args);
    } else {
      stepResult = invokeStepPlanOnly(stepDef);
    }
    
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
      { missing: 'now', usage: 'node commands/run_daily.js --now <ISO8601> [--mode <simulate|send_if_enabled>] [--dry-run] [--plan-only|--execute] [--inbox-json <path>]' },
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

  // Validate afterDays is integer >= 0
  const afterDaysInt = parseInt(args.afterDays, 10);
  if (isNaN(afterDaysInt) || afterDaysInt < 0) {
    fail(
      'INVALID_ARGS',
      'Invalid --after-days value: must be integer >= 0',
      { field: 'after_days', provided: args.afterDays, expected: 'non-negative integer' },
      2
    );
  }
  args.afterDays = afterDaysInt;

  // SAFETY: --execute requires --dry-run
  if (args.execute && !args.dryRun) {
    fail(
      'INVALID_ARGS',
      '--execute requires --dry-run for safety',
      { 
        reason: 'Execute mode without --dry-run would perform mutations',
        suggestion: 'Add --dry-run to preview executions, or use --plan-only for safe planning'
      },
      2
    );
  }

  // Run all steps
  const steps = runAllSteps(args);

  // Aggregate step results for overall ok status
  // Phase 2C-2: Overall ok=true even if substeps fail (aggregated reporting)
  const failedSteps = steps.filter(s => s.status === 'executed_dry_run' && s.ok === false);
  const overallOk = true; // run_daily itself succeeded; step failures are reported in steps[]

  // Build success output (deterministic, stable ordering)
  const output = {
    ok: overallOk,
    command: 'run_daily',
    now: args.now,
    mode: args.mode,
    after_days: args.afterDays,
    dry_run: args.dryRun,
    plan_only: args.planOnly,
    inbox_json: args.inboxJson,
    steps,
    summary: {
      total: steps.length,
      executed: steps.filter(s => s.status === 'executed_dry_run').length,
      skipped_unsafe: steps.filter(s => s.status === 'skipped_unsafe').length,
      missing: steps.filter(s => s.status === 'missing').length,
      invoked_help: steps.filter(s => s.status === 'invoked_help').length,
      failed: failedSteps.length
    },
    notes: [
      args.execute 
        ? 'Phase 2D: execute mode with --dry-run safety gate' 
        : 'Phase 2D: plan-only mode (--help invocations)',
      'Deterministic: --now is required',
      'Fixed step order: intake, draft, approve, send, detect_replies, mark_no_reply, report',
      'Steps without dry-run support are skipped with status skipped_unsafe',
      'detect_replies requires --inbox-json to execute; otherwise skipped_unsafe',
      'Overall ok=true: run_daily succeeded; check steps[] for substep failures'
    ]
  };

  printOk(output);
  process.exit(0);
}

main();
