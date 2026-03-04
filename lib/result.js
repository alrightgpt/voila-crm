/**
 * Voilà Result Contracts
 * Standardized output for all Voilà CLI commands
 *
 * Success: { ok: true, ...fields }
 * Failure: { ok: false, error: { code, message, details } }
 */

/**
 * Print success result to stdout (JSON only)
 * @param {Object} payload - Data to include in output (will be spread into result)
 */
function printOk(payload) {
  const result = {
    ok: true,
    ...payload
  };
  console.log(JSON.stringify(result, null, 2));
}

/**
 * Print error result to stdout (JSON only) and exit with error code
 * @param {string} code - Error code (ALL_CAPS with underscores)
 * @param {string} message - Human-readable error message
 * @param {Object|null} details - Additional error details (must be object or null)
 */
function printError(code, message, details = null) {
  const result = {
    ok: false,
    error: {
      code,
      message,
      details
    }
  };
  console.log(JSON.stringify(result, null, 2));
  process.exit(1);
}

module.exports = {
  printOk,
  printError
};
