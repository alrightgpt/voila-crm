#!/usr/bin/env node

/**
 * Voilà Send Command
 * Send emails or simulate sending based on config
 *
 * Input (CLI args):
 *   --lead <id>           Send/simulate for specific lead
 *   --all                 Process all leads in PENDING_SEND state
 *   --mode <mode>         simulate|send_if_enabled (default: simulate)
 *   --dry-run             Show what would happen without changing state
 *
 * Output (JSON):
 *   {
 *     "lead_id": "uuid",
 *     "state": "SENT|SIMULATED|FAILED|BLOCKED",
 *     "sent_at": "ISO8601?",
 *     "message_id": "string?",
 *     "simulation_note": "string?",
 *     "error": "string?"
 *   }
 */

const fs = require('fs');
const path = require('path');
const { transition } = require(path.join(__dirname, '../lib/state-machine.js'));
const { sendEmail } = require(path.join(__dirname, '../lib/smtp-client.js'));

// Pipeline state file
const PIPELINE_FILE = path.join(__dirname, '../state/pipeline.json');
const CONFIG_FILE = path.join(__dirname, '../config.json');

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
 * Load config
 */
function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    return { send_enabled: false, simulation_mode: true };
  }
  return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
}

/**
 * Validate lead is ready to send
 */
function validateLead(lead) {
  const errors = [];

  if (!lead.draft) {
    errors.push('Lead has no draft');
  }

  if (!lead.raw_data || !lead.raw_data.email) {
    errors.push('Lead has no email address');
  }

  if (!lead.draft || !lead.draft.subject) {
    errors.push('Draft has no subject');
  }

  if (!lead.draft || !lead.draft.body_text) {
    errors.push('Draft has no body text');
  }

  return errors;
}

/**
 * Process a single lead
 */
async function processLead(lead, mode, config, dryRun) {
  const validationErrors = validateLead(lead);

  if (validationErrors.length > 0) {
    return {
      lead_id: lead.id,
      state: 'FAILED',
      error: validationErrors.join(', '),
      simulation_note: null
    };
  }

  const email = lead.raw_data.email;
  const subject = lead.draft.subject;
  const body_text = lead.draft.body_text;

  // Check if we should actually send
  const shouldSend = mode === 'send_if_enabled' && config.send_enabled === true;

  if (shouldSend) {
    // Real send
    try {
      const result = await sendEmail({ to: email, subject, body_text });

      if (result.status === 'sent') {
        if (!dryRun) {
          const updatedLead = transition(lead, 'SENT', {
            mode: 'send',
            message_id: result.message_id
          });
          updatedLead.send_status = {
            sent_at: new Date().toISOString(),
            message_id: result.message_id
          };
          return {
            lead_id: lead.id,
            state: 'SENT',
            sent_at: updatedLead.send_status.sent_at,
            message_id: result.message_id,
            simulation_note: null
          };
        }

        return {
          lead_id: lead.id,
          state: 'SENT',
          sent_at: new Date().toISOString(),
          message_id: result.message_id,
          simulation_note: null
        };
      } else {
        if (!dryRun) {
          const updatedLead = transition(lead, 'FAILED', {
            mode: 'send',
            error: result.error
          });
        }

        return {
          lead_id: lead.id,
          state: 'FAILED',
          error: result.error,
          simulation_note: null
        };
      }
    } catch (error) {
      if (!dryRun) {
        transition(lead, 'FAILED', {
          mode: 'send',
          error: error.message
        });
      }

      return {
        lead_id: lead.id,
        state: 'FAILED',
        error: error.message,
        simulation_note: null
      };
    }
  } else {
    // Simulation mode
    const blockReason = !config.send_enabled
      ? 'send_enabled is false in config'
      : 'mode is simulate';

    if (!dryRun) {
      const updatedLead = transition(lead, 'SIMULATED', {
        mode: 'simulate',
        reason: blockReason,
        would_send_to: email,
        would_send_subject: subject
      });
      updatedLead.send_status = {
        simulated_at: new Date().toISOString(),
        reason: blockReason,
        would_send_to: email,
        would_send_subject: subject
      };
    }

    return {
      lead_id: lead.id,
      state: 'SIMULATED',
      sent_at: null,
      message_id: null,
      simulation_note: `Would send to ${email} with subject "${subject}" (${blockReason})`
    };
  }
}

/**
 * Parse CLI arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const result = { leadId: null, all: false, mode: 'simulate', dryRun: false };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--lead' && args[i + 1]) {
      result.leadId = args[i + 1];
      i++;
    } else if (args[i] === '--all') {
      result.all = true;
    } else if (args[i] === '--mode' && args[i + 1]) {
      result.mode = args[i + 1];
      i++;
    } else if (args[i] === '--dry-run') {
      result.dryRun = true;
    }
  }

  // Validate mode
  if (!['simulate', 'send_if_enabled'].includes(result.mode)) {
    console.error(JSON.stringify({
      error: 'Invalid mode. Must be "simulate" or "send_if_enabled"',
      provided: result.mode
    }));
    process.exit(1);
  }

  return result;
}

async function main() {
  console.error('Voilà: Processing email sends...');

  const config = loadConfig();
  const pipeline = loadPipeline();
  const args = parseArgs();
  const results = [];

  console.error(`Mode: ${args.mode}`);
  console.error(`Send enabled: ${config.send_enabled}`);
  console.error(`Dry run: ${args.dryRun}`);

  if (args.all) {
    console.error('Processing all leads in PENDING_SEND state...');

    const readyLeads = pipeline.leads.filter(l =>
      l.state === 'PENDING_SEND'
    );

    if (readyLeads.length === 0) {
      console.error('No leads ready to send.');
      console.log(JSON.stringify({
        message: 'No leads ready to send. Use voila/draft --all to create drafts, then manually approve leads.',
        processed: 0
      }));
      process.exit(0);
    }

    for (const lead of readyLeads) {
      try {
        const result = await processLead(lead, args.mode, config, args.dryRun);
        results.push(result);

        // Update pipeline if not dry run
        if (!args.dryRun) {
          const index = pipeline.leads.findIndex(l => l.id === lead.id);
          if (index !== -1) {
            const updatedLead = pipeline.leads[index];
            if (result.state === 'SENT' || result.state === 'SIMULATED') {
              const transitioned = transition(updatedLead, result.state, {
                processed_at: new Date().toISOString()
              });
              transitioned.send_status = {
                ...transitioned.send_status,
                processed_at: new Date().toISOString()
              };
              pipeline.leads[index] = transitioned;
            } else if (result.state === 'FAILED') {
              const transitioned = transition(updatedLead, 'FAILED', {
                error: result.error
              });
              pipeline.leads[index] = transitioned;
            }
          }
        }

        const statusIcon = result.state === 'SENT' ? '✓' :
                          result.state === 'SIMULATED' ? '◯' : '✗';
        console.error(`  ${statusIcon} ${result.state}: ${lead.raw_data.name} (${lead.raw_data.email})`);

      } catch (error) {
        console.error(`  ✗ Error processing ${lead.raw_data.name}: ${error.message}`);
        results.push({
          lead_id: lead.id,
          state: 'FAILED',
          error: error.message
        });
      }
    }

    if (!args.dryRun) {
      savePipeline(pipeline);
    }

    console.error(`\nTotal processed: ${results.length} leads`);

    const sent = results.filter(r => r.state === 'SENT').length;
    const simulated = results.filter(r => r.state === 'SIMULATED').length;
    const failed = results.filter(r => r.state === 'FAILED').length;

    console.error(`  Sent: ${sent}`);
    console.error(`  Simulated: ${simulated}`);
    console.error(`  Failed: ${failed}`);

    console.log(JSON.stringify({
      processed: results.length,
      sent,
      simulated,
      failed,
      results
    }, null, 2));

  } else if (args.leadId) {
    console.error(`Processing lead: ${args.leadId}`);

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

    // Block DRAFTED leads - require explicit approval
    if (lead.state === 'DRAFTED') {
      console.error(`✗ Lead is in DRAFTED state and requires explicit approval.`);
      console.log(JSON.stringify({
        lead_id: args.leadId,
        state: 'BLOCKED',
        error: 'Lead is in DRAFTED state. Use voila/draft to review drafts, then explicitly approve leads before sending. To approve, transition lead to PENDING_SEND manually or use a dedicated approve command.'
      }));
      process.exit(1);
    }

    const result = await processLead(lead, args.mode, config, args.dryRun);

    // Update pipeline if not dry run
    if (!args.dryRun) {
      if (result.state === 'SENT' || result.state === 'SIMULATED') {
        const transitioned = transition(lead, result.state, {
          processed_at: new Date().toISOString()
        });
        transitioned.send_status = {
          ...transitioned.send_status,
          processed_at: new Date().toISOString()
        };
        pipeline.leads[leadIndex] = transitioned;
      } else if (result.state === 'FAILED') {
        const transitioned = transition(lead, 'FAILED', {
          error: result.error
        });
        pipeline.leads[leadIndex] = transitioned;
      }
      savePipeline(pipeline);
    }

    const statusIcon = result.state === 'SENT' ? '✓' :
                      result.state === 'SIMULATED' ? '◯' : '✗';
    console.error(`${statusIcon} ${result.state}: ${lead.raw_data.name} (${lead.raw_data.email})`);

    if (result.simulation_note) {
      console.error(`  ${result.simulation_note}`);
    }

    if (result.error) {
      console.error(`  Error: ${result.error}`);
    }

    console.log(JSON.stringify(result, null, 2));
  } else {
    console.error(JSON.stringify({
      error: 'Missing required arguments',
      usage: 'voila/send --lead <id> OR voila/send --all [--mode <mode>] [--dry-run]',
      modes: {
        simulate: 'Log what would be sent without sending (default)',
        send_if_enabled: 'Send if config.send_enabled is true, otherwise simulate'
      },
      safety: 'Real sending is blocked unless: (1) mode=send_if_enabled AND (2) config.send_enabled=true',
      examples: [
        'voila/send --lead abc-123-def',
        'voila/send --all --mode simulate',
        'voila/send --all --mode send_if_enabled --dry-run'
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
