/**
 * Voilà Error Contracts
 * Standardized error output for all Voilà CLI commands
 */

/**
 * Emit a standardized error and exit
 * @param {string} code - Error code (ALL_CAPS with underscores)
 * @param {string} message - Human-readable error message
 * @param {Object|null} details - Additional error details (must be object or null)
 */
function fail(code, message, details = null) {
  const errorOutput = {
    ok: false,
    error: {
      type: 'ERROR',
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
