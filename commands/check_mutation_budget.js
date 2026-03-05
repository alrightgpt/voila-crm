#!/usr/bin/env node

/**
 * Voilà Mutation Budget Checker
 * Enforces limits on file and line changes in the working tree vs a base ref.
 *
 * CLI:
 *   node commands/check_mutation_budget.js \
 *     --max-files <int> \
 *     --max-lines <int> \
 *     [--base <gitref>] \
 *     [--deny-prefix <pathprefix>]... \
 *     [--allow-prefix <pathprefix>]... \
 *     [--json]
 *
 * Defaults:
 *   --base: HEAD
 *   --deny-prefix: templates/, pipeline.json, PROJECT_STATE.md (always included unless overridden)
 *
 * Exit codes:
 *   0 - budget check passed
 *   2 - invalid arguments
 *   3 - budget exceeded (too many files or lines)
 *   4 - path violation (deny-prefix or allow-prefix mismatch)
 *
 * Output: STRICT JSON
 */

const path = require('path');
const { spawnSync } = require('child_process');

const DEFAULT_BASE = 'HEAD';
const DEFAULT_DENY_PREFIXES = ['templates/', 'pipeline.json', 'PROJECT_STATE.md'];

/**
 * Parse CLI arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const result = {
    maxFiles: null,
    maxLines: null,
    base: DEFAULT_BASE,
    denyPrefixes: [...DEFAULT_DENY_PREFIXES],
    allowPrefixes: [],
    json: false,
    help: false
  };

  let overrideDenyPrefixes = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--max-files' && args[i + 1]) {
      result.maxFiles = parseInt(args[i + 1], 10);
      i++;
    } else if (arg === '--max-lines' && args[i + 1]) {
      result.maxLines = parseInt(args[i + 1], 10);
      i++;
    } else if (arg === '--base' && args[i + 1]) {
      result.base = args[i + 1];
      i++;
    } else if (arg === '--deny-prefix' && args[i + 1]) {
      if (!overrideDenyPrefixes) {
        // First explicit --deny-prefix overrides defaults
        result.denyPrefixes = [];
        overrideDenyPrefixes = true;
      }
      result.denyPrefixes.push(args[i + 1]);
      i++;
    } else if (arg === '--allow-prefix' && args[i + 1]) {
      result.allowPrefixes.push(args[i + 1]);
      i++;
    } else if (arg === '--json') {
      result.json = true;
    } else if (arg === '--help' || arg === '-h') {
      result.help = true;
    }
  }

  return result;
}

/**
 * Print help as STRICT JSON
 */
function printHelp() {
  console.log(JSON.stringify({
    ok: true,
    command: 'check_mutation_budget',
    help: {
      description: 'Enforce mutation budget limits on working tree changes',
      usage: 'node commands/check_mutation_budget.js --max-files <int> --max-lines <int> [options]',
      arguments: [
        { name: '--max-files', required: true, description: 'Maximum number of files that can be changed' },
        { name: '--max-lines', required: true, description: 'Maximum total lines (added + deleted) allowed' },
        { name: '--base', required: false, default: DEFAULT_BASE, description: 'Git ref to compare against' },
        { name: '--deny-prefix', required: false, default: DEFAULT_DENY_PREFIXES.join(', '), description: 'Path prefixes that are always denied (can be specified multiple times, overrides defaults)' },
        { name: '--allow-prefix', required: false, description: 'Path prefixes that are allowed (if set, all others are denied; can be specified multiple times)' },
        { name: '--json', required: false, description: 'Always output JSON (default behavior)' },
        { name: '--help', required: false, description: 'Print this help' }
      ],
      exit_codes: [
        { code: 0, description: 'Budget check passed' },
        { code: 2, description: 'Invalid arguments' },
        { code: 3, description: 'Budget exceeded (too many files or lines)' },
        { code: 4, description: 'Path violation (deny-prefix or allow-prefix mismatch)' }
      ]
    }
  }, null, 2));
}

/**
 * Print error and exit
 */
function fail(code, message, details, exitCode) {
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
 * Run a git command and capture output
 */
function runGit(args, cwd) {
  const result = spawnSync('git', args, {
    cwd: cwd || process.cwd(),
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe']
  });

  return {
    exitCode: result.status !== null ? result.status : -1,
    stdout: result.stdout || '',
    stderr: result.stderr || ''
  };
}

/**
 * Get changed files and their line stats using git diff --numstat
 */
function getChangedFilesStats(base) {
  const result = runGit(['diff', '--numstat', base]);
  
  if (result.exitCode !== 0) {
    return { error: result.stderr, files: [] };
  }

  const files = [];
  const lines = result.stdout.trim().split('\n').filter(line => line.length > 0);

  for (const line of lines) {
    const parts = line.split('\t');
    if (parts.length >= 3) {
      const added = parts[0] === '-' ? 0 : parseInt(parts[0], 10) || 0;
      const deleted = parts[1] === '-' ? 0 : parseInt(parts[1], 10) || 0;
      const filepath = parts.slice(2).join('\t'); // Handle filenames with tabs
      files.push({ path: filepath, added, deleted });
    }
  }

  return { error: null, files };
}

/**
 * Get list of changed file paths using git diff --name-only
 */
function getChangedFilePaths(base) {
  const result = runGit(['diff', '--name-only', base]);
  
  if (result.exitCode !== 0) {
    return { error: result.stderr, paths: [] };
  }

  const paths = result.stdout.trim().split('\n').filter(p => p.length > 0);
  return { error: null, paths };
}

/**
 * Get untracked files using git status --porcelain
 */
function getUntrackedFiles() {
  const result = runGit(['status', '--porcelain']);
  
  if (result.exitCode !== 0) {
    return { error: result.stderr, paths: [] };
  }

  const paths = [];
  const lines = result.stdout.trim().split('\n').filter(l => l.length > 0);

  for (const line of lines) {
    // Status format: XY PATH or XY PATH -> PATH for renames
    // X = index status, Y = worktree status
    // ?? = untracked, !! = ignored
    const status = line.substring(0, 2);
    const filePath = line.substring(3);

    if (status === '??') {
      paths.push(filePath);
    } else if (status === 'A ' || status === 'AM' || status === ' M' || status === 'M ' || status === 'MM') {
      // Also track modified/added files that may not show in diff --name-only for staged
      // But for our purposes, untracked (??) are the main concern
    }
  }

  return { error: null, paths };
}

/**
 * Check if a path matches any prefix in a list
 */
function matchesPrefix(filePath, prefixes) {
  for (const prefix of prefixes) {
    if (filePath.startsWith(prefix) || filePath === prefix) {
      return true;
    }
  }
  return false;
}

/**
 * Main entry point
 */
function main() {
  const args = parseArgs();

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  // Validate required arguments
  if (args.maxFiles === null || isNaN(args.maxFiles) || args.maxFiles < 0) {
    fail(
      'INVALID_ARGS',
      'Missing or invalid required argument: --max-files <non-negative int>',
      { provided: args.maxFiles },
      2
    );
  }

  if (args.maxLines === null || isNaN(args.maxLines) || args.maxLines < 0) {
    fail(
      'INVALID_ARGS',
      'Missing or invalid required argument: --max-lines <non-negative int>',
      { provided: args.maxLines },
      2
    );
  }

  // Get changed files stats
  const statsResult = getChangedFilesStats(args.base);
  if (statsResult.error) {
    fail(
      'GIT_ERROR',
      'Failed to get diff stats',
      { error: statsResult.error, base: args.base },
      2
    );
  }

  // Get untracked files
  const untrackedResult = getUntrackedFiles();
  if (untrackedResult.error) {
    fail(
      'GIT_ERROR',
      'Failed to get untracked files',
      { error: untrackedResult.error },
      2
    );
  }

  // Compute totals
  let linesAdded = 0;
  let linesDeleted = 0;
  const changedPaths = [];

  for (const file of statsResult.files) {
    linesAdded += file.added;
    linesDeleted += file.deleted;
    changedPaths.push(file.path);
  }

  const untrackedPaths = untrackedResult.paths;

  // Collect all paths for checking
  const allPaths = [...changedPaths, ...untrackedPaths];

  // Filter paths based on allow-prefix (if specified)
  // Paths matching allow-prefix are excluded from budget counting
  let budgetPaths = allPaths;
  if (args.allowPrefixes.length > 0) {
    budgetPaths = allPaths.filter(p => !matchesPrefix(p, args.allowPrefixes));
  }

  // Total files for budget = filtered paths
  const filesTotal = budgetPaths.length;
  
  // Lines total only counts tracked files (untracked have unknown line counts)
  // For untracked files in budget, we can't count lines, so we only count tracked file lines
  const budgetChangedPaths = args.allowPrefixes.length > 0
    ? changedPaths.filter(p => !matchesPrefix(p, args.allowPrefixes))
    : changedPaths;
  
  let linesTotal = 0;
  for (const file of statsResult.files) {
    if (args.allowPrefixes.length === 0 || !matchesPrefix(file.path, args.allowPrefixes)) {
      linesTotal += file.added + file.deleted;
    }
  }

  // Check for violations
  const violations = [];

  // Check max-files
  if (filesTotal > args.maxFiles) {
    violations.push({
      code: 'TOO_MANY_FILES',
      details: {
        files_changed: filesTotal,
        max_files: args.maxFiles,
        exceeded_by: filesTotal - args.maxFiles
      }
    });
  }

  // Check max-lines
  if (linesTotal > args.maxLines) {
    violations.push({
      code: 'TOO_MANY_LINES',
      details: {
        lines_total: linesTotal,
        max_lines: args.maxLines,
        exceeded_by: linesTotal - args.maxLines
      }
    });
  }

  // Check deny-prefix violations (against ALL paths, not filtered)
  for (const filePath of allPaths) {
    if (matchesPrefix(filePath, args.denyPrefixes)) {
      violations.push({
        code: 'DENY_PREFIX_VIOLATION',
        details: {
          path: filePath,
          matched_prefixes: args.denyPrefixes.filter(p => filePath.startsWith(p) || filePath === p)
        }
      });
    }
  }

  // Check allow-prefix violations (if specified, paths NOT matching are violations)
  // Only report if the path is also not in deny-prefix (deny takes precedence)
  if (args.allowPrefixes.length > 0) {
    for (const filePath of allPaths) {
      if (!matchesPrefix(filePath, args.allowPrefixes) && !matchesPrefix(filePath, args.denyPrefixes)) {
        violations.push({
          code: 'ALLOW_PREFIX_VIOLATION',
          details: {
            path: filePath,
            allowed_prefixes: args.allowPrefixes
          }
        });
      }
    }
  }

  // Determine overall status
  const hasBudgetViolation = violations.some(v => v.code === 'TOO_MANY_FILES' || v.code === 'TOO_MANY_LINES');
  const hasPathViolation = violations.some(v => v.code === 'DENY_PREFIX_VIOLATION' || v.code === 'ALLOW_PREFIX_VIOLATION');

  const ok = violations.length === 0;

  // Build output
  const output = {
    ok,
    base: args.base,
    budget: {
      max_files: args.maxFiles,
      max_lines: args.maxLines
    },
    totals: {
      files: filesTotal,
      lines_added: linesAdded,
      lines_deleted: linesDeleted,
      lines: linesTotal
    },
    changed_paths: changedPaths,
    untracked_paths: untrackedPaths,
    violations
  };

  console.log(JSON.stringify(output, null, 2));

  // Exit with appropriate code
  if (hasBudgetViolation) {
    process.exit(3);
  } else if (hasPathViolation) {
    process.exit(4);
  } else {
    process.exit(0);
  }
}

main();
