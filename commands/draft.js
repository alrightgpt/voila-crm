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
  const templatePath = path.join(__dirname, '../lib/templates', `${templateVariant}.md`);

  if (!fs.existsSync(templatePath)) {
    throw new Error(`Template not found: ${templateVariant}`);
  }

  return fs.readFileSync(templatePath, 'utf-8');
}

/**
 * Parse template to extract subject and body
 */
function parseTemplate(content) {
  let subject = '';
  let body = content;

  // Extract subject line
  const subjectMatch = content.match(/^Subject:\s*(.+)$/m);
  if (subjectMatch) {
    subject = subjectMatch[1].trim();
    body = content.replace(/^Subject:\s*.+$/m, '').trim();
  }

  return { subject, body };
}

/**
 * Personalize template with lead data
 */
function personalizeTemplate(template, lead) {
  const raw = lead.raw_data || {};
  const enriched = lead.enriched_data || {};

  const replacements = {
    '{{name}}': raw.name || '',
    '{{first_name}}': raw.first_name || '',
    '{{company}}': raw.company || '',
    '{{company_name}}': raw.company || '',
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
 * Select template based on lead role
 */
function selectTemplate(lead, forcedTemplate) {
  if (forcedTemplate) {
    return forcedTemplate;
  }

  const role = (lead.raw_data || {}).role || 'unknown';

  if (role === 'kw') {
    return 'brokerage';
  } else if (role === 'brokerage') {
    return 'brokerage';
  } else if (role === 'independent') {
    return 'independent';
  }

  // Default to independent for unknown
  return 'independent';
}

/**
 * Generate draft for a lead
 */
function generateDraft(lead, templateVariant) {
  const template = loadTemplate(templateVariant);
  const { subject, body } = parseTemplate(template);
  const { text: personalizedBody, used } = personalizeTemplate(body, lead);

  const personalizedSubject = personalizeTemplate(subject, lead).text;

  return {
    subject: personalizedSubject,
    body_text: personalizedBody,
    personalization_used: used,
    confidence_score: used.length > 0 ? 0.8 : 0.5
  };
}

/**
 * Parse CLI arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const result = { leadId: null, all: false, template: null };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--lead' && args[i + 1]) {
      result.leadId = args[i + 1];
      i++;
    } else if (args[i] === '--all') {
      result.all = true;
    } else if (args[i] === '--template' && args[i + 1]) {
      result.template = args[i + 1];
      i++;
    }
  }

  return result;
}

async function main() {
  console.error('Voilà: Generating email drafts...');

  const pipeline = loadPipeline();
  const args = parseArgs();
  const results = [];

  if (args.all) {
    console.error('Generating drafts for all ready leads...');

    const readyLeads = pipeline.leads.filter(l =>
      l.state === 'IMPORTED' || l.state === 'READY_TO_DRAFT'
    );

    if (readyLeads.length === 0) {
      console.error('No leads ready for drafting.');
      console.log(JSON.stringify({
        message: 'No leads ready for drafting',
        drafted: 0
      }));
      process.exit(0);
    }

    for (const lead of readyLeads) {
      try {
        const templateVariant = selectTemplate(lead, args.template);
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

    console.log(JSON.stringify({
      drafted: results.length,
      drafts: results
    }, null, 2));

  } else if (args.leadId) {
    console.error(`Generating draft for lead: ${args.leadId}`);

    const leadIndex = pipeline.leads.findIndex(l => l.id === args.leadId);

    if (leadIndex === -1) {
      console.error(`✗ Lead not found: ${args.leadId}`);
      console.log(JSON.stringify({
        error: 'Lead not found',
        lead_id: args.leadId
      }));
      process.exit(1);
    }

    const lead = pipeline.leads[leadIndex];
    const templateVariant = selectTemplate(lead, args.template);
    const draft = generateDraft(lead, templateVariant);

    // Transition through READY_TO_DRAFT first, then DRAFTED
    let updatedLead = transition(lead, 'READY_TO_DRAFT');
    updatedLead = transition(updatedLead, 'DRAFTED');
    updatedLead.draft = draft;
    updatedLead.drafted_at = new Date().toISOString();

    pipeline.leads[leadIndex] = updatedLead;
    savePipeline(pipeline);

    console.error(`✓ Drafted: ${lead.raw_data.name} (${lead.raw_data.email})`);

    console.log(JSON.stringify({
      lead_id: updatedLead.id,
      state: updatedLead.state,
      draft: updatedLead.draft,
      drafted_at: updatedLead.drafted_at
    }, null, 2));
  } else {
    console.error(JSON.stringify({
      error: 'Missing required arguments',
      usage: 'voila/draft --lead <id> OR voila/draft --all [--template <variant>]',
      examples: [
        'voila/draft --lead abc-123-def',
        'voila/draft --all',
        'voila/draft --all --template independent'
      ]
    }));
    process.exit(1);
  }

  process.exit(0);
}

main().catch(error => {
  console.error(JSON.stringify({
    error: error.message
  }));
  process.exit(1);
});
