#!/usr/bin/env node

/**
 * Voilà Snapshot Scrape Command
 * Generate a scrape snapshot with inline seed data
 *
 * Input (CLI args):
 *   --now <ISO8601>    REQUIRED - Snapshot timestamp
 *   --out <path>       REQUIRED - Output file path
 *   --dry-run          OPTIONAL - Skip file write
 *
 * Output (JSON):
 *   {
 *     "ok": true,
 *     "command": "snapshot_scrape",
 *     "schema_version": "scrape_snapshot_v1",
 *     "now": "<ISO8601>",
 *     "out_path": "<path>",
 *     "dry_run": true|false,
 *     "wrote_file": true|false,
 *     "counts": {...},
 *     "source": { "mode": "inline", "path": null }
 *   }
 */

const fs = require('fs');
const path = require('path');
const { printError, printOk } = require(path.join(__dirname, '../lib/result.js'));

/**
 * Deterministic inline seed dataset
 * 3 example teams with consistent data
 */
const SEED_TEAMS = [
  {
    name: "Alpha Construction",
    website: "https://alphaconstruction.example.com",
    market: "Portland OR",
    contacts: [
      { name: "John Smith", role: "Owner", email: "john@alphaconstruction.example.com", phone: null },
      { name: "Jane Doe", role: "Project Manager", email: "jane@alphaconstruction.example.com", phone: null }
    ]
  },
  {
    name: "Bravo Excavation",
    website: "https://bravoexcavation.example.com",
    market: "Southern WA",
    contacts: [
      { name: "Mike Johnson", role: "President", email: "mike@bravoexcavation.example.com", phone: "360-555-0100" }
    ]
  },
  {
    name: "Charlie Concrete",
    website: null,
    market: "Portland OR",
    contacts: [
      { name: "Sarah Williams", role: "Operations Manager", email: "sarah@charlieconcrete.example.com", phone: "503-555-0200" },
      { name: null, role: "Sales", email: "sales@charlieconcrete.example.com", phone: null }
    ]
  }
];

/**
 * Parse CLI arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const result = { now: null, out: null, dryRun: false };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--now' && args[i + 1]) {
      result.now = args[i + 1];
      i++;
    } else if (args[i] === '--out' && args[i + 1]) {
      result.out = args[i + 1];
      i++;
    } else if (args[i] === '--dry-run') {
      result.dryRun = true;
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
    return date.toISOString() === timestamp;
  } catch {
    return false;
  }
}

/**
 * Build entities from seed teams
 */
function buildEntities(teams) {
  return teams.map(team => ({
    entity_type: "team",
    name: team.name,
    website: team.website,
    market: team.market,
    contacts: team.contacts.map(contact => ({
      name: contact.name,
      role: contact.role,
      email: contact.email,
      phone: contact.phone
    })),
    raw: {}
  }));
}

/**
 * Calculate counts from entities
 */
function calculateCounts(entities) {
  const entitiesTotal = entities.length;
  const teams = entities.filter(e => e.entity_type === "team").length;
  const contactsWithEmail = entities.reduce((sum, entity) => {
    return sum + entity.contacts.filter(c => c.email !== null).length;
  }, 0);

  return {
    entities_total: entitiesTotal,
    teams: teams,
    contacts_with_email: contactsWithEmail
  };
}

/**
 * Generate snapshot file object
 */
function generateSnapshot(now, entities, counts) {
  return {
    schema_version: "scrape_snapshot_v1",
    now: now,
    sources: [
      {
        source_id: "seed_local_v1",
        type: "seed",
        input: { mode: "inline", path: null }
      }
    ],
    entities: entities,
    counts: counts,
    notes: []
  };
}

/**
 * Main function
 */
function main() {
  const args = parseArgs();

  // Validate required arguments
  if (!args.now) {
    fail('INVALID_ARGS', 'Missing required argument: --now <ISO8601>', {
      usage: 'voila/snapshot_scrape --now <ISO8601> --out <path> [--dry-run]',
      example: 'voila/snapshot_scrape --now 2026-03-03T11:14:00.000Z --out /path/to/snapshot.json'
    });
  }

  if (!args.out) {
    fail('INVALID_ARGS', 'Missing required argument: --out <path>', {
      usage: 'voila/snapshot_scrape --now <ISO8601> --out <path> [--dry-run]',
      example: 'voila/snapshot_scrape --now 2026-03-03T11:14:00.000Z --out /path/to/snapshot.json'
    });
  }

  // Validate ISO8601 timestamp
  if (!isValidISO8601(args.now)) {
    fail('INVALID_ARGS', 'Invalid ISO8601 timestamp format', {
      provided: args.now,
      expected_format: '2026-03-03T11:14:00.000Z'
    });
  }

  // Build entities from seed data
  let entities = buildEntities(SEED_TEAMS);

  // Sort entities alphabetically by name (deterministic)
  entities.sort((a, b) => a.name.localeCompare(b.name));

  // Calculate counts
  const counts = calculateCounts(entities);

  // Generate snapshot
  const snapshot = generateSnapshot(args.now, entities, counts);

  // Write file if not dry-run
  let wroteFile = false;
  if (!args.dryRun) {
    const outDir = path.dirname(args.out);
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }
    fs.writeFileSync(args.out, JSON.stringify(snapshot, null, 2));
    wroteFile = true;
  }

  // Output result
  const output = {
    ok: true,
    command: "snapshot_scrape",
    schema_version: "scrape_snapshot_v1",
    now: args.now,
    out_path: args.out,
    dry_run: args.dryRun,
    wrote_file: wroteFile,
    counts: counts,
    source: { mode: "inline", path: null }
  };

  printOk(output);

  process.exit(0);
}

main().catch(error => {
  printError('UNHANDLED_ERROR', error.message, null);
});
