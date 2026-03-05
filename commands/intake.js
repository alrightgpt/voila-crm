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
const { withReceipt } = require(path.join(__dirname, '../lib/receipt.js'));

const { assertVoilaSSOT } = require('../lib/ssot');
assertVoilaSSOT();

const PIPELINE_FILE = path.join(__dirname, '../state/pipeline.json');

function loadPipeline(pipelinePath) {
  if (!fs.existsSync(pipelinePath)) {
    return { version: '1.0.0', last_updated: null, leads: [] };
  }
  return JSON.parse(fs.readFileSync(pipelinePath, 'utf-8'));
}

function savePipeline(pipeline, pipelinePath) {
  pipeline.last_updated = new Date().toISOString();
  fs.writeFileSync(pipelinePath, JSON.stringify(pipeline, null, 2));
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function findLeadByEmail(pipeline, normalizedEmail) {
  return pipeline.leads.find(l => normalizeEmail(l.raw_data?.email) === normalizedEmail);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const result = { source: null, csvPath: null, manualLead: null, receiptPath: null, pipelinePath: PIPELINE_FILE };

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
        throw new Error('Invalid JSON for manual lead');
      }
      i++;
    } else if (args[i] === '--receipt' && args[i + 1]) {
      result.receiptPath = args[i + 1];
      i++;
    } else if (args[i] === '--pipeline' && args[i + 1]) {
      result.pipelinePath = args[i + 1];
      i++;
    }
  }

  return result;
}

async function loadPipelineState(pipelinePath) {
  const pipeline = loadPipeline(pipelinePath);
  return pipeline;
}

async function executeWithPipeline({ args, pipeline }) {

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
      savePipeline(pipeline, args.pipelinePath);
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
      throw new Error('Email required for manual intake');
    }

    if (findLeadByEmail(pipeline, normalizedEmail)) {
      throw new Error('Lead already exists');
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
    savePipeline(pipeline, args.pipelinePath);

    printOk({
      imported: 1,
      skipped_duplicates: 0,
      duplicates: [],
      errors: []
    });
  }

  process.exit(0);
}

// Entry point with receipt wrapping
async function entrypoint() {
  try {
    // Parse args first to get receipt path
    const parsedArgs = parseArgs();

    // Always run with receipt to capture any errors
    const stdoutObj = await withReceipt({
      receiptPath: parsedArgs.receiptPath,
      commandName: 'intake',
      args: { source: parsedArgs.source, csvPath: parsedArgs.csvPath, manualLead: parsedArgs.manualLead },
      touchedPaths: [parsedArgs.pipelinePath]
    }, async () => {
      // Validate basic args
      if (!parsedArgs.source) {
        throw new Error('Missing --csv <path> or --manual <json>');
      }

      const pipeline = await loadPipelineState(parsedArgs.pipelinePath);
      return await executeWithPipeline({ args: parsedArgs, pipeline });
    });

    process.exit(0);
  } catch (err) {
    // Receipt already written by withReceipt, now just print error
    if (err.message === 'Missing --csv <path> or --manual <json>') {
      printError('INVALID_ARGS', err.message, {
        usage: 'voila/intake --csv <path> OR voila/intake --manual <json>'
      });
    } else if (err.message === 'Invalid JSON for manual lead') {
      printError('INVALID_ARGS', err.message, {
        example: '{"name":"John","email":"john@example.com"}'
      });
    } else if (err.message === 'Email required for manual intake') {
      printError('EMAIL_MISSING', err.message, null);
    } else if (err.message === 'Lead already exists') {
      printError('DUPLICATE_LEAD', err.message, null);
    } else {
      printError('UNHANDLED_ERROR', err.message, null);
    }
  }
}

entrypoint();
