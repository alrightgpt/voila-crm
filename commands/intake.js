#!/usr/bin/env node

/**
 * Voilà Intake Command
 * Import leads from CSV or manual entry
 *
 * Input (CLI args):
 *   --csv <path>          Path to CSV file
 *   --manual <json>        JSON string of manual lead data
 *
 * Output (JSON):
 *   {
 *     "lead_id": "uuid",
 *     "state": "IMPORTED",
 *     "imported_at": "ISO8601",
 *     "validation_errors": []
 *   }
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parseCSV, normalizeLead, generateUUID } = require(path.join(__dirname, '../lib/csv-client.js'));
const { transition } = require(path.join(__dirname, '../lib/state-machine.js'));

// Pipeline state file
const PIPELINE_FILE = path.join(__dirname, '../state/pipeline.json');

/**
 * Load pipeline state
 */
function loadPipeline() {
  if (!fs.existsSync(PIPELINE_FILE)) {
    return { version: '1.0.0', last_updated: null, leads: [] };
  }
  return JSON.parse(fs.readFileSync(PIPELINE_FILE, 'utf-8'));
}

/**
 * Save pipeline state
 */
function savePipeline(pipeline) {
  pipeline.last_updated = new Date().toISOString();
  fs.writeFileSync(PIPELINE_FILE, JSON.stringify(pipeline, null, 2));
}

/**
 * Generate deterministic dedupe key for lead
 * Priority: email (lowercase+trim) -> phone -> hash of raw_data
 */
function generateDedupeKey(normalizedLead) {
  if (normalizedLead.email) {
    return normalizedLead.email.trim().toLowerCase();
  }

  if (normalizedLead.phone) {
    return normalizedLead.phone.replace(/\D/g, ''); // Strip non-digits
  }

  // Fallback: hash of raw_data
  const dataString = JSON.stringify(normalizedLead);
  return crypto.createHash('sha256').update(dataString).digest('hex');
}

/**
 * Check if lead with dedupe_key already exists in pipeline
 */
function isDuplicate(pipeline, dedupeKey) {
  return pipeline.leads.some(lead => lead.dedupe_key === dedupeKey);
}

/**
 * Import lead from normalized data
 */
function importLead(pipeline, normalizedLead) {
  const leadId = generateUUID();

  // Validate required fields
  const validationErrors = [];

  // Require email OR phone
  if (!normalizedLead.email && !normalizedLead.phone) {
    validationErrors.push('Email or phone is required');
  }

  // Require name
  if (!normalizedLead.name) {
    validationErrors.push('Name is required');
  }

  // Generate dedupe key for idempotency
  const dedupeKey = generateDedupeKey(normalizedLead);

  // Create new lead object
  const newLead = {
    id: leadId,
    state: 'IMPORTED',
    imported_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    raw_data: normalizedLead,
    dedupe_key: dedupeKey,
    validation_errors: validationErrors,
    enriched_data: null,
    draft: null,
    send_status: null,
    history: []
  };

  // Add to pipeline
  pipeline.leads.push(newLead);

  return newLead;
}

/**
 * Parse CLI arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const result = { source: null, csvPath: null, manualLead: null };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--csv' && args[i + 1]) {
      result.source = 'csv';
      result.csvPath = args[i + 1];
      i++;
    } else if (args[i] === '--manual' && args[i + 1]) {
      result.source = 'manual';
      try {
        result.manualLead = JSON.parse(args[i + 1]);
      } catch (e) {
        console.error(JSON.stringify({
          error: 'Invalid JSON for manual lead',
          example: '{"name":"John Doe","email":"john@example.com","company":"Acme Realty","role":"independent"}'
        }));
        process.exit(1);
      }
      i++;
    }
  }

  if (!result.source) {
    console.error(JSON.stringify({
      error: 'Missing required arguments',
      usage: 'voila/intake --csv <path> OR voila/intake --manual <json>',
      examples: [
        'voila/intake --csv /path/to/leads.csv',
        'voila/intake --manual \'{"name":"John Doe","email":"john@example.com","company":"Acme Realty","role":"independent"}\''
      ]
    }));
    process.exit(1);
  }

  return result;
}

async function main() {
  console.error('Voilà: Importing leads...');

  const pipeline = loadPipeline();
  const args = parseArgs();
  const imported = [];
  const duplicateSkipped = [];
  const invalidRows = [];

  if (args.source === 'csv') {
    console.error(`Importing from CSV: ${args.csvPath}`);

    try {
      const leads = parseCSV(args.csvPath);

      for (const lead of leads) {
        // Check for duplicate
        const dedupeKey = generateDedupeKey(lead);

        if (isDuplicate(pipeline, dedupeKey)) {
          duplicateSkipped.push({
            name: lead.name,
            email: lead.email,
            dedupe_key: dedupeKey
          });
          const contactInfo = lead.email ? lead.email : lead.phone;
          console.error(`  ⊘ Duplicate skipped: ${lead.name} (${contactInfo})`);
          continue;
        }

        // Check validation (email OR phone required, name required)
        if ((!lead.email && !lead.phone) || !lead.name) {
          const missing = [];
          if (!lead.email && !lead.phone) missing.push('Email or phone');
          if (!lead.name) missing.push('Name');

          invalidRows.push({
            name: lead.name || '<unknown>',
            reason: missing.join(', ')
          });
          console.error(`  ✗ Invalid row: ${lead.name || '<unknown>'} (${missing.join(', ')})`);
          continue;
        }

        const importedLead = importLead(pipeline, lead);
        imported.push(importedLead);
        const contactInfo = lead.email ? lead.email : lead.phone;
        console.error(`  ✓ Imported: ${lead.name} (${contactInfo})`);
      }

      savePipeline(pipeline);

      console.error(`\nImport summary:`);
      console.error(`  Imported: ${imported.length}`);
      console.error(`  Duplicates skipped: ${duplicateSkipped.length}`);
      console.error(`  Invalid rows: ${invalidRows.length}`);
      console.error(`  Total leads after: ${pipeline.leads.length}`);

      console.log(JSON.stringify({
        imported: imported.length,
        duplicate_skipped: duplicateSkipped.length,
        invalid_rows: invalidRows.length,
        total_after: pipeline.leads.length,
        leads: imported.map(l => ({
          lead_id: l.id,
          state: l.state,
          name: l.raw_data.name,
          email: l.raw_data.email,
          validation_errors: l.validation_errors
        }))
      }, null, 2));

    } catch (error) {
      console.error(`✗ Import failed: ${error.message}`);
      console.log(JSON.stringify({
        error: error.message,
        imported: 0
      }));
      process.exit(1);
    }

  } else if (args.source === 'manual') {
    console.error('Importing manual lead...');

    try {
      const normalizedLead = normalizeLead(args.manualLead);

      // Check for duplicate
      const dedupeKey = generateDedupeKey(normalizedLead);
      if (isDuplicate(pipeline, dedupeKey)) {
        console.error(`✗ Duplicate lead: ${normalizedLead.name} (${normalizedLead.email})`);
        console.log(JSON.stringify({
          error: 'Duplicate lead',
          lead_email: normalizedLead.email
        }));
        process.exit(1);
      }

      const importedLead = importLead(pipeline, normalizedLead);

      savePipeline(pipeline);

      console.error(`✓ Imported: ${normalizedLead.name} (${normalizedLead.email})`);

      console.log(JSON.stringify({
        lead_id: importedLead.id,
        state: importedLead.state,
        imported_at: importedLead.imported_at,
        validation_errors: importedLead.validation_errors
      }), null, 2);

    } catch (error) {
      console.error(`✗ Import failed: ${error.message}`);
      console.log(JSON.stringify({
        error: error.message
      }));
      process.exit(1);
    }
  }

  process.exit(0);
}

main().catch(error => {
  console.error(JSON.stringify({
    error: error.message
  }));
  process.exit(1);
});
