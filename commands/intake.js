#!/usr/bin/env node

/**
 * Voilà Intake Command
 * Import leads from CSV or manual entry with idempotency
 *
 * Input (CLI args):
 *   --csv <path>          Path to CSV file
 *   --manual <json>       JSON string of manual lead data
 *
 * Output (JSON):
 *   {
 *     "imported": <n>,
 *     "skipped_duplicates": <n>,
 *     "duplicates": [{ "email": "...", "existing_lead_id": "..." }],
 *     "errors": [{ "row": <1-based>, "code": "...", "message": "...", "details": {} }]
 *   }
 */

const fs = require('fs');
const path = require('path');
const { parseCSV, normalizeLead, generateUUID } = require(path.join(__dirname, '../lib/csv-client.js'));
const { printError, printOk } = require(path.join(__dirname, '../lib/result.js'));

const PIPELINE_FILE = path.join(__dirname, '../state/pipeline.json');

function loadPipeline() {
  if (!fs.existsSync(PIPELINE_FILE)) {
    return { version: '1.0.0', last_updated: null, leads: [] };
  }
  return JSON.parse(fs.readFileSync(PIPELINE_FILE, 'utf-8'));
}

function savePipeline(pipeline) {
  pipeline.last_updated = new Date().toISOString();
  fs.writeFileSync(PIPELINE_FILE, JSON.stringify(pipeline, null, 2));
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function findLeadByEmail(pipeline, normalizedEmail) {
  return pipeline.leads.find(l => normalizeEmail(l.raw_data?.email) === normalizedEmail);
}

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
        printError('INVALID_ARGS', 'Invalid JSON for manual lead', {
          example: '{"name":"John","email":"john@example.com"}'
        });
      }
      i++;
    }
  }

  if (!result.source) {
    printError('INVALID_ARGS', 'Missing --csv <path> or --manual <json>', {
      usage: 'voila/intake --csv <path> OR voila/intake --manual <json>'
    });
  }

  return result;
}

async function main() {
  const pipeline = loadPipeline();
  const args = parseArgs();

  if (args.source === 'csv') {
    const leads = parseCSV(args.csvPath);
    
    const imported = [];
    const duplicates = [];
    const errors = [];
    const seenEmails = new Set();
    let rowNum = 0;

    for (const rawLead of leads) {
      rowNum++;
      const normalizedEmail = normalizeEmail(rawLead.email);

      // Check for missing email
      if (!normalizedEmail) {
        errors.push({
          row: rowNum,
          code: 'EMAIL_MISSING',
          message: 'Email required for deduplication',
          details: { name: rawLead.name || '<unknown>' }
        });
        continue;
      }

      // Check for duplicate in current batch
      if (seenEmails.has(normalizedEmail)) {
        const firstLead = imported.find(l => normalizeEmail(l.raw_data.email) === normalizedEmail);
        duplicates.push({
          email: normalizedEmail,
          existing_lead_id: firstLead?.id || null
        });
        continue;
      }

      // Check for duplicate in pipeline
      const existing = findLeadByEmail(pipeline, normalizedEmail);
      if (existing) {
        duplicates.push({
          email: normalizedEmail,
          existing_lead_id: existing.id
        });
        continue;
      }

      // Import the lead
      const normalizedLead = normalizeLead(rawLead);
      const newLead = {
        id: generateUUID(),
        state: 'IMPORTED',
        imported_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        raw_data: normalizedLead,
        dedupe_key: normalizedEmail,
        validation_errors: [],
        enriched_data: null,
        draft: null,
        send_status: null,
        history: []
      };

      imported.push(newLead);
      seenEmails.add(normalizedEmail);
    }

    // Only save if we imported something
    if (imported.length > 0) {
      pipeline.leads.push(...imported);
      savePipeline(pipeline);
    }

    printOk({
      imported: imported.length,
      skipped_duplicates: duplicates.length,
      duplicates,
      errors
    });

  } else if (args.source === 'manual') {
    const normalizedLead = normalizeLead(args.manualLead);
    const normalizedEmail = normalizeEmail(normalizedLead.email);

    if (!normalizedEmail) {
      printError('EMAIL_MISSING', 'Email required for manual intake', null);
    }

    if (findLeadByEmail(pipeline, normalizedEmail)) {
      printError('DUPLICATE_LEAD', 'Lead already exists', { email: normalizedEmail });
    }

    const newLead = {
      id: generateUUID(),
      state: 'IMPORTED',
      imported_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      raw_data: normalizedLead,
      dedupe_key: normalizedEmail,
      validation_errors: [],
      enriched_errors: null,
      draft: null,
      send_status: null,
      history: []
    };

    pipeline.leads.push(newLead);
    savePipeline(pipeline);

    printOk({
      imported: 1,
      skipped_duplicates: 0,
      duplicates: [],
      errors: []
    });
  }

  process.exit(0);
}

main().catch(err => printError('UNEXPECTED_ERROR', err.message, null));
