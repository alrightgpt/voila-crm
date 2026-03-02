# Voilà Outreach Automation Pipeline

Deterministic outreach automation for Voilà — "Automation that fits."

## Architecture

```
IMPORTED → ENRICHING → READY_TO_DRAFT → DRAFTED → PENDING_SEND → SENT → [REPLIED|BOUNCED|NO_REPLY]
                ↓              ↓             ↓           ↓
           [FAILED]      [SKIPPED]    [REVIEW]    [SIMULATED*]

Terminal states: CONVERTED, LOST, UNSUBSCRIBED, PAUSED
```

## Safety First

- **Emails NEVER send automatically** until explicitly enabled
- `config.send_enabled` defaults to `false`
- All SMTP credentials from environment variables only
- Two-layer protection: `mode="send_if_enabled"` + `config.send_enabled=true`

## Commands

### voila/intake
Import leads from CSV or manual entry.

```bash
# CSV import
./commands/intake.js --csv /path/to/leads.csv

# Manual entry
./commands/intake.js --manual '{"name":"John Doe","email":"john@example.com","company":"Acme Realty","role":"independent"}'
```

**Output:**
```json
{
  "lead_id": "uuid",
  "state": "IMPORTED",
  "imported_at": "ISO8601",
  "validation_errors": []
}
```

### voila/draft
Generate personalized email drafts.

```bash
# Draft all ready leads
./commands/draft.js --all [--template independent|brokerage]

# Draft specific lead
./commands/draft.js --lead <lead_id>
```

**Output:**
```json
{
  "lead_id": "uuid",
  "state": "DRAFTED",
  "draft": {
    "subject": "string",
    "body_text": "string",
    "personalization_used": [],
    "confidence_score": 0.8
  },
  "drafted_at": "ISO8601"
}
```

### voila/send
Send emails or simulate.

```bash
# Simulate all ready leads (default, safe)
./commands/send.js --all

# Test what would send
./commands/send.js --all --mode send_if_enabled --dry-run

# Actually send (requires send_enabled=true)
./commands/send.js --all --mode send_if_enabled
```

**Output:**
```json
{
  "lead_id": "uuid",
  "state": "SENT|SIMULATED|FAILED|BLOCKED",
  "sent_at": "ISO8601?",
  "message_id": "string?",
  "simulation_note": "string?",
  "error": "string?"
}
```

### voila/test_smtp
Validate SMTP transport.

```bash
./commands/test_smtp.js <to> <subject> [body_text]
```

**Output:**
```json
{
  "status": "sent|failed",
  "message_id": "string?",
  "error": "string?"
}
```

## Environment Variables

Required for SMTP:

```bash
export VOILA_SMTP_HOST="smtp.gmail.com"
export VOILA_SMTP_PORT="587"
export VOILA_SMTP_USER="your-email@gmail.com"
export VOILA_SMTP_PASS="your-app-password"
export VOILA_FROM_NAME="Austin"
export VOILA_FROM_EMAIL="austin@voila.fit"
```

**Never commit these to git.**

## State Machine

Pure functions in `lib/state-machine.js`:

- `canTransition(fromState, toState)` - Check if transition is valid
- `transition(lead, toState, metadata)` - Execute transition, return new lead
- `isTerminal(state)` - Check if state is terminal
- `requiresManualReview(state)` - Check if state needs approval
- `getNextStates(state)` - Get valid next states

## Pipeline State

Stored in `state/pipeline.json`:

```json
{
  "version": "1.0.0",
  "last_updated": "ISO8601",
  "leads": [
    {
      "id": "uuid",
      "state": "DRAFTED",
      "imported_at": "ISO8601",
      "updated_at": "ISO8601",
      "raw_data": { /* normalized lead data */ },
      "enriched_data": null,
      "draft": { /* generated email */ },
      "send_status": null,
      "history": [ /* transition log */ ]
    }
  ]
}
```

## Enabling Real Sending

1. Set all environment variables
2. Test SMTP: `./commands/test_smtp.js your-email@example.com "Test"`
3. Edit `config.json`, set `"send_enabled": true`
4. Run with `--mode send_if_enabled`

## Templates

Templates in `lib/templates/`:

- `independent.md` - For independent agents
- `brokerage.md` - For brokerages and teams

Use `{{variable}}` syntax for personalization:
- `{{first_name}}`
- `{{company}}`
- `{{company_name}}`

## Contracts

All commands input/output strict JSON. See command headers for schemas.

## Configuration

`config.json`:

```json
{
  "send_enabled": false,
  "simulation_mode": true
}
```

## CSV Format

Expected headers:
```
name,email,phone,company,role,notes
```

Role values: `independent`, `brokerage`, `kw`, or `unknown`
