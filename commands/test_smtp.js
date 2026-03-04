#!/usr/bin/env node

/**
 * Voilà SMTP Test Command
 * Input: { "to": "string", "subject": "string", "body_text": "string" }
 * Output: { "ok": true, "status": "sent|failed", "error": "string?" }
 */

const path = require('path');
const { sendEmail, testConnection } = require(path.join(__dirname, '../lib/smtp-client.js'));
const { printError, printOk } = require(path.join(__dirname, '../lib/result.js'));

// Parse CLI args
const args = process.argv.slice(2);
const to = args[0];
const subject = args[1];
const body_text = args[2] || 'This is a test email from Voilà.';

if (!to || !subject) {
  printError('INVALID_ARGS', 'Missing required arguments', {
    usage: 'voila/test_smtp <to> <subject> [body_text]',
    example: 'voila/test_smtp austin@example.com "Test Email" "Testing SMTP transport"'
  });
}

async function main() {
  console.error(`Voilà: Testing SMTP transport to ${to}...`);

  // First test connection
  console.error('Step 1: Verifying SMTP connection...');
  const connectionOk = await testConnection();

  if (!connectionOk) {
    printError('SMTP_CONNECTION_FAILED', 'SMTP connection verification failed', null);
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
  printOk(result);

  process.exit(result.status === 'sent' ? 0 : 1);
}

main().catch(error => {
  printError('UNEXPECTED_ERROR', error.message, null);
});
