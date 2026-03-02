#!/usr/bin/env node

/**
 * Voilà SMTP Test Command
 * Input: { "to": "string", "subject": "string", "body_text": "string" }
 * Output: { "status": "sent|failed", "error": "string?" }
 */

const path = require('path');
const { sendEmail, testConnection } = require(path.join(__dirname, '../lib/smtp-client.js'));

// Parse CLI args
const args = process.argv.slice(2);
const to = args[0];
const subject = args[1];
const body_text = args[2] || 'This is a test email from Voilà.';

if (!to || !subject) {
  console.error(JSON.stringify({
    error: 'Missing required arguments',
    usage: 'voila/test_smtp <to> <subject> [body_text]',
    example: 'voila/test_smtp austin@example.com "Test Email" "Testing SMTP transport"'
  }));
  process.exit(1);
}

async function main() {
  console.error(`Voilà: Testing SMTP transport to ${to}...`);

  // First test connection
  console.error('Step 1: Verifying SMTP connection...');
  const connectionOk = await testConnection();

  if (!connectionOk) {
    console.log(JSON.stringify({
      status: 'failed',
      error: 'SMTP connection verification failed'
    }));
    process.exit(1);
  }

  console.error('Step 2: Connection verified. Sending test email...');

  // Send test email
  const result = await sendEmail({ to, subject, body_text });

  if (result.status === 'sent') {
    console.error(`✓ Test email sent successfully to ${to}`);
    console.error(`  Message ID: ${result.message_id}`);
  } else {
    console.error(`✗ Test email failed: ${result.error}`);
  }

  // Output JSON result
  console.log(JSON.stringify(result, null, 2));

  process.exit(result.status === 'sent' ? 0 : 1);
}

main().catch(error => {
  console.error(JSON.stringify({
    status: 'failed',
    error: error.message
  }));
  process.exit(1);
});
