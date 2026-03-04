#!/usr/bin/env node

/**
 * Voilà Draft Command
 * Generate personalized email drafts for leads
 *
 * Input (CLI args):
 *   --lead <id>           Generate draft for specific lead
 *   --all                 Generate drafts for all leads in READY_TO_DRAFT state
 *   --template <variant>  Force template: independent|brokerage|kw
 *
 * Output (JSON):
 *   {
 *     "lead_id": "uuid",
 *     "state": "DRAFTED",
 *     "draft": {
 *       "subject": "string",
 *       "body_text": "string",
 *       "personalization_used": [],
 *       "confidence_score": "0-1"
 *     },
 *     "drafted_at": "ISO8601"
 *   }
 */

const fs = require('fs');
const path = require('path');
const { transition, getNextStates } = require(path.join(__dirname, '../lib/state-machine.js'));
const { printError, printOk } = require(path.join(__dirname, '../lib/result.js'));
const { takeSnapshot, diffSummary, assertInvariants, generateProof } = require(path.join(__dirname, '../lib/proof.js'));
const { withReceipt } = require(path.join(__dirname, '../lib/receipt.js'));

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
 * Load email template
 */
function loadTemplate(templateVariant) {
  const templatePath = path.join(__dirname, '../../../skills/voila/templates', `${templateVariant}.txt`);

  if (!fs.existsSync(templatePath)) {
    throw new Error(`Template not found: ${templateVariant}`);
  }

  return fs.readFileSync(templatePath, 'utf-8');
}

/**
 * Parse template to extract subject and body
 * Format: First line "SUBJECT: <subject>", then body (blank line or immediate)
 */
function parseTemplate(content) {
  const lines = content.split('\n');

  if (lines.length < 2) {
    throw new Error('Invalid template format: missing subject line or body');
  }

  // Extract subject from first line (remove "SUBJECT: " prefix)
  const subjectLine = lines[0].trim();
  const subjectPrefix = 'SUBJECT:';

  if (!subjectLine.toLowerCase().startsWith(subjectPrefix.toLowerCase())) {
    throw new Error('Invalid template format: first line must start with "SUBJECT:"');
  }

  const subject = subjectLine.substring(subjectPrefix.length).trim();

  // Body is everything after the subject line
  // Skip the first blank line if present, otherwise start from line 2
  const bodyLines = [];
  let startBody = 1;

  // If line 2 is blank, skip it and start from line 3
  if (lines.length > 1 && lines[1].trim() === '') {
    startBody = 2;
  }

  for (let i = startBody; i < lines.length; i++) {
    bodyLines.push(lines[i]);
  }

  const body = bodyLines.join('\n').trim();

  return { subject, body };
}

/**
 * Get first name from lead data with deterministic fallback logic
 */
function getFirstName(lead) {
  const raw = lead.raw_data || {};

  // first_name: lead.first_name if non-empty else first token of lead.name if present
  if (raw.first_name && raw.first_name.trim() !== '') {
    return raw.first_name.trim();
  }

  if (raw.name && raw.name.trim() !== '') {
    const firstToken = raw.name.trim().split(/\s+/)[0];
    if (firstToken) {
      return firstToken;
    }
  }

  return null; // FAIL
}

/**
 * Get team name from lead data
 * team_name: MUST use lead.team_name if non-empty
 * NO fallback to company, brokerage, or name
 * If token present and lead.team_name missing/empty → FAIL
 */
function getTeamName(lead) {
  const raw = lead.raw_data || {};

  // STRICT: Only use team_name field
  if (raw.team_name && raw.team_name.trim() !== '') {
    return raw.team_name.trim();
  }

  return null; // FAIL - no fallback
}

/**
 * Get brokerage name from lead data
 */
function getBrokerageName(lead) {
  const raw = lead.raw_data || {};

  // Check in order: brokerage_name, brokerage, "Brokerage Name", then team_name as fallback
  if (raw.brokerage_name && raw.brokerage_name.trim() !== '') {
    return raw.brokerage_name.trim();
  }

  if (raw.brokerage && raw.brokerage.trim() !== '') {
    return raw.brokerage.trim();
  }

  if (raw["Brokerage Name"] && raw["Brokerage Name"].trim() !== '') {
    return raw["Brokerage Name"].trim();
  }

  // Fallback: if role indicates broker/team and brokerage truly absent, use team_name
  const role = String(raw.role || '').toLowerCase();
  if (role === 'broker' || role === 'team') {
    if (raw.team_name && raw.team_name.trim() !== '') {
      return raw.team_name.trim();
    }
  }

  return null; // FAIL
}

/**
 * Get company name alias from lead data
 */
function getCompanyNameAlias(lead) {
  const raw = lead.raw_data || {};

  // company_name alias: lead.team_name if non-empty else lead.brokerage if non-empty else FAIL
  if (raw.team_name && raw.team_name.trim() !== '') {
    return raw.team_name.trim();
  }

  if (raw.brokerage && raw.brokerage.trim() !== '') {
    return raw.brokerage.trim();
  }

  return null; // FAIL
}

/**
 * Check if any placeholder tokens remain in text
 */
function hasPlaceholdersRemaining(text) {
  const supportedTokens = [
    '\\[First Name\\]',
    '\\[Team Name\\]',
    '\\[Brokerage Name\\]',
    '\\{\\{first_name\\}\\}',
    '\\{\\{team_name\\}\\}',
    '\\{\\{brokerage_name\\}\\}',
    '\\{\\{company_name\\}\\}'
  ];

  for (const token of supportedTokens) {
    if (new RegExp(token).test(text)) {
      return true;
    }
  }

  return false;
}

/**
 * Render placeholders in template with deterministic values
 * Token-driven: only fetch values for tokens that exist in template
 * Supports bracket syntax: [First Name], [Team Name], [Brokerage Name]
 * Supports moustache syntax: {{first_name}}, {{team_name}}, {{brokerage_name}}, {{company_name}}
 */
function renderPlaceholders(template, lead) {
  const raw = lead.raw_data || {};
  const enriched = lead.enriched_data || {};

  // Define token-getter pairs
  const tokenGetters = [
    // Bracket tokens
    { token: '[First Name]', getter: () => getFirstName(lead) },
    { token: '[Team Name]', getter: () => getTeamName(lead) },
    { token: '[Brokerage Name]', getter: () => getBrokerageName(lead) },
    // Moustache tokens
    { token: '{{first_name}}', getter: () => getFirstName(lead) },
    { token: '{{team_name}}', getter: () => getTeamName(lead) },
    { token: '{{brokerage_name}}', getter: () => getBrokerageName(lead) },
    { token: '{{company_name}}', getter: () => getCompanyNameAlias(lead) }
  ];

  let rendered = template;
  const used = [];

  // Token-driven: only evaluate if token exists in template
  for (const tokenGetter of tokenGetters) {
    if (rendered.includes(tokenGetter.token)) {
      const value = tokenGetter.getter();
      if (value === null) {
        throw new Error(`Required value missing for placeholder: ${tokenGetter.token}`);
      }
      rendered = rendered.replace(new RegExp(tokenGetter.token.replace(/[{}[\]]/g, '\\$&'), 'g'), value);
      used.push(tokenGetter.token);
    }
  }

  return { text: rendered, used };
}

/**
 * Personalize template with lead data
 * Legacy function - kept for backwards compatibility with other tokens
 */
function personalizeTemplate(template, lead) {
  const raw = lead.raw_data || {};
  const enriched = lead.enriched_data || {};

  // Normalize company name from multiple possible fields
  const companyName = raw.company || raw.team_name || raw.brokerage || '';

  const replacements = {
    '{{name}}': raw.name || '',
    '{{first_name}}': raw.first_name || '',
    '{{company}}': companyName,
    '{{company_name}}': companyName,
    '{{email}}': raw.email || '',
    '{{role}}': raw.role || '',
    '{{market_focus}}': enriched.market_focus || '',
    '{{company_size}}': enriched.company_size || '',
    '{{recent_listings}}': enriched.recent_listings || ''
  };

  let personalized = template;
  const used = [];

  for (const [key, value] of Object.entries(replacements)) {
    if (value && personalized.includes(key)) {
      personalized = personalized.replace(new RegExp(key, 'g'), value);
      used.push(key);
    }
  }

  return { text: personalized, used };
}

/**
 * Select template based on lead role and team indicators
 * Brokerage/team detection (case-insensitive):
 *   - role contains "broker" OR
 *   - brokerage field exists OR
 *   - team_name exists
 */
function selectTemplate(lead, forcedTemplate) {
  if (forcedTemplate) {
    return forcedTemplate;
  }

  const raw = lead.raw_data || {};
  const role = (raw.role || '').toLowerCase();

  // Brokerage/team classification
  const hasBrokerageRole = role.includes('broker');
  const hasBrokerageField = !!raw.brokerage;
  const hasTeamName = !!raw.team_name;

  const isBrokerageTeam = hasBrokerageRole || hasBrokerageField || hasTeamName;

  return isBrokerageTeam ? 'outreach_brokerage_v1' : 'outreach_independent_v1';
}

/**
 * Generate draft for a lead
 */
function generateDraft(lead, templateVariant) {
  const template = loadTemplate(templateVariant);
  const { subject, body } = parseTemplate(template);

  // Validate subject and body are present
  if (!subject || subject.trim() === '') {
    throw new Error('Template missing subject line');
  }

  if (!body || body.trim() === '') {
    throw new Error('Template missing body text');
  }

  // Render placeholders with deterministic dual-syntax support
  const { text: renderedBody, used: usedBody } = renderPlaceholders(body, lead);
  const { text: renderedSubject, used: usedSubject } = renderPlaceholders(subject, lead);

  // Merge used tokens
  const used = [...new Set([...usedBody, ...usedSubject])];

  // Hard-fail validation: Check if any supported tokens remain
  if (hasPlaceholdersRemaining(renderedSubject)) {
    throw new Error('Validation failed: Unsupported placeholders remain in subject');
  }

  if (hasPlaceholdersRemaining(renderedBody)) {
    throw new Error('Validation failed: Unsupported placeholders remain in body');
  }

  return {
    subject: renderedSubject,
    body_text: renderedBody,
    personalization_used: used,
    confidence_score: used.length > 0 ? 0.8 : 0.5,
    placeholders_remaining: false
  };
}

/**
 * Parse CLI arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const result = { leadId: null, all: false, template: null, debug: false, prove: false, receiptPath: null };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--lead' && args[i + 1]) {
      result.leadId = args[i + 1];
      i++;
    } else if (args[i] === '--all') {
      result.all = true;
    } else if (args[i] === '--template' && args[i + 1]) {
      result.template = args[i + 1];
      i++;
    } else if (args[i] === '--debug') {
      result.debug = true;
    } else if (args[i] === '--prove') {
      result.prove = true;
    } else if (args[i] === '--receipt' && args[i + 1]) {
      result.receiptPath = args[i + 1];
      i++;
    }
  }

  return result;
}

async function main() {
  const args = parseArgs();
  const pipeline = loadPipeline();
  const results = [];

  if (args.all) {
    console.error('Voilà: Generating email drafts...');
    console.error('Generating drafts for all ready leads...');

    const readyLeads = pipeline.leads.filter(l =>
      l.state === 'IMPORTED' || l.state === 'READY_TO_DRAFT'
    );

    if (readyLeads.length === 0) {
      throw new Error('No leads ready for drafting');
    }

    for (const lead of readyLeads) {
      try {
        const templateVariant = selectTemplate(lead, args.template);
        if (args.debug) {
          console.error(`DEBUG: Lead ${lead.raw_data.name}, template: ${templateVariant}`);
        }
        const draft = generateDraft(lead, templateVariant);

        // Transition through READY_TO_DRAFT first, then DRAFTED
        let updatedLead = transition(lead, 'READY_TO_DRAFT');
        updatedLead = transition(updatedLead, 'DRAFTED');
        updatedLead.draft = draft;
        updatedLead.drafted_at = new Date().toISOString();

        // Update in pipeline
        const index = pipeline.leads.findIndex(l => l.id === lead.id);
        if (index !== -1) {
          pipeline.leads[index] = updatedLead;
        }

        results.push({
          lead_id: lead.id,
          state: 'DRAFTED',
          draft: draft,
          drafted_at: updatedLead.drafted_at
        });

        console.error(`  ✓ Drafted: ${lead.raw_data.name} (${lead.raw_data.email})`);

      } catch (error) {
        console.error(`  ✗ Failed for ${lead.raw_data.name}: ${error.message}`);
      }
    }

    savePipeline(pipeline);

    console.error(`\nTotal drafted: ${results.length} leads`);

    return {
      drafted: results.length,
      drafts: results
    };

  } else if (args.leadId) {
    // Proof mode: take before snapshot
    const before = args.prove ? takeSnapshot({
      leadId: args.leadId,
      pipelinePath: PIPELINE_FILE,
      configPath: path.join(__dirname, '..', 'config.json')
    }) : null;

    const leadIndex = pipeline.leads.findIndex(l => l.id === args.leadId);

    if (leadIndex === -1) {
      printError('LEAD_NOT_FOUND', `Lead not found: ${args.leadId}`, {
        lead_id: args.leadId,
        proof: args.prove ? generateProof({
          before,
          after: takeSnapshot({
            leadId: args.leadId,
            pipelinePath: PIPELINE_FILE,
            configPath: path.join(__dirname, '..', 'config.json')
          }),
          diffSummary,
          assertInvariants
        }) : undefined
      });
    }

    const lead = pipeline.leads[leadIndex];
    const templateVariant = selectTemplate(lead, args.template);
    if (args.debug) {
      console.error(`DEBUG: Lead ${lead.raw_data.name}, template: ${templateVariant}`);
    }
    const draft = generateDraft(lead, templateVariant);

    // Transition through READY_TO_DRAFT first, then DRAFTED
    let updatedLead = transition(lead, 'READY_TO_DRAFT');
    updatedLead = transition(updatedLead, 'DRAFTED');
    updatedLead.draft = draft;
    updatedLead.drafted_at = new Date().toISOString();

    pipeline.leads[leadIndex] = updatedLead;
    savePipeline(pipeline);

    console.error(`✓ Drafted: ${lead.raw_data.name} (${lead.raw_data.email})`);

    const output = {
      lead_id: updatedLead.id,
      state: updatedLead.state,
      draft: updatedLead.draft,
      drafted_at: updatedLead.drafted_at
    };

    if (args.prove) {
      const after = takeSnapshot({
        leadId: args.leadId,
        pipelinePath: PIPELINE_FILE,
        configPath: path.join(__dirname, '..', 'config.json')
      });
      output._proof = generateProof({
        before,
        after,
        diffSummary,
        assertInvariants
      });
    }

    return output;
  } else {
    throw new Error('Missing required arguments: --lead <id> or --all');
  }
}

// Entry point with receipt wrapping
async function entrypoint() {
  try {
    const parsedArgs = parseArgs();

    // Always run with receipt to capture any errors
    const stdoutObj = await withReceipt({
      receiptPath: parsedArgs.receiptPath,
      commandName: 'draft',
      args: { lead_id: parsedArgs.leadId, all: parsedArgs.all, template: parsedArgs.template, debug: parsedArgs.debug, prove: parsedArgs.prove },
      touchedPaths: [PIPELINE_FILE]
    }, async () => {
      return await main();
    });

    printOk(stdoutObj);
    process.exit(0);
  } catch (err) {
    // Receipt already written by withReceipt, now just print error
    if (err.message === 'Missing required arguments: --lead <id> or --all') {
      printError('INVALID_ARGS', err.message, {
        usage: 'voila/draft --lead <id> OR voila/draft --all [--template <variant>]',
        examples: [
          'voila/draft --lead abc-123-def',
          'voila/draft --all',
          'voila/draft --all --template independent'
        ]
      });
    } else if (err.message === 'No leads ready for drafting') {
      printOk({
        message: 'No leads ready for drafting',
        drafted: 0
      });
      process.exit(0);
    } else {
      printError('UNHANDLED_ERROR', err.message, null);
    }
  }
}

entrypoint();
