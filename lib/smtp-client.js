/**
 * Voilà SMTP Transport Client
 * Environment variables only - no credentials in files
 */

const nodemailer = require('nodemailer');

// Validate required env vars
function validateEnv() {
  const required = [
    'VOILA_SMTP_HOST',
    'VOILA_SMTP_PORT',
    'VOILA_SMTP_USER',
    'VOILA_SMTP_PASS',
    'VOILA_FROM_NAME',
    'VOILA_FROM_EMAIL'
  ];

  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  return {
    host: process.env.VOILA_SMTP_HOST,
    port: parseInt(process.env.VOILA_SMTP_PORT, 10),
    user: process.env.VOILA_SMTP_USER,
    pass: process.env.VOILA_SMTP_PASS,
    fromName: process.env.VOILA_FROM_NAME,
    fromEmail: process.env.VOILA_FROM_EMAIL
  };
}

/**
 * Create SMTP transporter
 */
function createTransporter() {
  const config = validateEnv();

  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465, // true for 465, false for other ports
    auth: {
      user: config.user,
      pass: config.pass
    }
  });
}

/**
 * Send a single email
 * @param {Object} email
 * @param {string} email.to - Recipient email
 * @param {string} email.subject - Email subject
 * @param {string} email.body_text - Plain text body
 * @returns {Promise<Object>} Result with status and messageId
 */
async function sendEmail({ to, subject, body_text }) {
  const config = validateEnv();
  const transporter = createTransporter();

  try {
    const info = await transporter.sendMail({
      from: `"${config.fromName}" <${config.fromEmail}>`,
      to,
      subject,
      text: body_text
    });

    return {
      status: 'sent',
      message_id: info.messageId,
      accepted: info.accepted,
      rejected: info.rejected
    };
  } catch (error) {
    return {
      status: 'failed',
      error: error.message
    };
  }
}

/**
 * Test SMTP connection without sending
 * @returns {Promise<boolean>} True if connection succeeds
 */
async function testConnection() {
  const transporter = createTransporter();

  try {
    await transporter.verify();
    return true;
  } catch (error) {
    console.error('SMTP connection test failed:', error.message);
    return false;
  }
}

module.exports = {
  validateEnv,
  createTransporter,
  sendEmail,
  testConnection
};
