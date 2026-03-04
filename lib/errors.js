/**
 * Voilà Error Contracts
 * Standardized error output for all Voilà CLI commands
 *
 * @deprecated This module is replaced by lib/result.js. Use printError() instead.
 * This file is kept for backward compatibility only.
 */

/**
 * Emit a standardized error and exit
 * @param {string} code - Error code (ALL_CAPS with underscores)
 * @param {string} message - Human-readable error message
 * @param {Object|null} details - Additional error details (must be object or null)
 * @deprecated Use printError() from lib/result.js instead
 */
function fail(code, message, details = null) {
  const errorOutput = {
    ok: false,
    error: {
      code,
      message,
      details
    }
  };

  console.log(JSON.stringify(errorOutput, null, 2));
  process.exit(1);
}

module.exports = {
  fail
};
