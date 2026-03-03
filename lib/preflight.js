/**
 * Voilà Preflight Gate
 * Pure function for deterministic pre-flight validation before dangerous operations
 *
 * @param {Object} params - Preflight parameters
 * @param {Object|null} params.lead - Lead object (may be null/undefined)
 * @param {string} params.mode - Execution mode: 'simulate' | 'send_if_enabled'
 * @param {Object} params.config - Config object (must contain send_enabled)
 * @param {Object} params.env - Environment variables object (e.g., process.env)
 * @returns {Object} Preflight result: { ok:boolean, gate:string|null, code:string|null, details:object|null }
 */
function runPreflight({ lead, mode, config, env }) {
  // Gate A: LEAD_EXISTS
  if (lead == null) {
    return {
      ok: false,
      gate: 'LEAD_EXISTS',
      code: 'LEAD_NOT_FOUND',
      details: null
    };
  }

  // Gate B: VALID_STATE_FOR_SEND
  if (mode === 'send_if_enabled') {
    if (lead.state !== 'PENDING_SEND') {
      return {
        ok: false,
        gate: 'VALID_STATE_FOR_SEND',
        code: 'INVALID_STATE',
        details: {
          mode,
          state: lead?.state ?? null
        }
      };
    }
  } else {
    return {
      ok: false,
      gate: 'VALID_STATE_FOR_SEND',
      code: 'INVALID_STATE',
      details: {
        mode,
        state: lead?.state ?? null
      }
    };
  }

  // Gate C: DRAFT_PRESENT
  const draftMissing = [];
  if (!lead.draft || !lead.draft.subject) {
    draftMissing.push('subject');
  }
  if (!lead.draft || !lead.draft.body_text) {
    draftMissing.push('body_text');
  }
  if (draftMissing.length > 0) {
    return {
      ok: false,
      gate: 'DRAFT_PRESENT',
      code: 'DRAFT_MISSING',
      details: {
        missing: draftMissing
      }
    };
  }

  // Gate D: RECIPIENT_EMAIL_PRESENT
  const email = lead.raw_data?.email || lead.email || lead.raw_data?.Email || lead.raw_data?.['email_address'];
  if (!email) {
    return {
      ok: false,
      gate: 'RECIPIENT_EMAIL_PRESENT',
      code: 'EMAIL_MISSING',
      details: null
    };
  }

  // Gate E: SEND_ENABLED_GATE
  if (mode === 'send_if_enabled') {
    if (config.send_enabled !== true) {
      return {
        ok: false,
        gate: 'SEND_ENABLED_GATE',
        code: 'SEND_DISABLED',
        details: null
      };
    }
  }

  // Gate F: SMTP_ENV_PRESENT (only when mode==="send_if_enabled" AND config.send_enabled===true)
  if (mode === 'send_if_enabled' && config.send_enabled === true) {
    const requiredEnvVars = [
      'VOILA_SMTP_HOST',
      'VOILA_SMTP_PORT',
      'VOILA_SMTP_USER',
      'VOILA_SMTP_PASS',
      'VOILA_FROM_EMAIL'
    ];

    const missingVars = requiredEnvVars.filter(key => {
      return env[key] === undefined || env[key] === '';
    });

    if (missingVars.length > 0) {
      return {
        ok: false,
        gate: 'SMTP_ENV_PRESENT',
        code: 'SMTP_ENV_MISSING',
        details: {
          missing: missingVars
        }
      };
    }
  }

  // All checks passed
  return {
    ok: true,
    gate: null,
    code: null,
    details: null
  };
}

module.exports = {
  runPreflight
};
