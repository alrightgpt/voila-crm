/**
 * Voilà Receipt Wrapper
 * Wraps printOk/printError to capture stdout and write receipts
 */

const { withReceipt, sha256FileOrNull } = require('./receipt.js');

/**
 * Wrap a command function with receipt support
 * @param {Object} options
 * @param {string} options.commandName - Command name
 * @param {string} options.receiptPath - Receipt file path (or null)
 * @param {string[]} options.touchedPaths - Files to track
 * @param {Function} parseArgs - Function that parses args
 * @param {Function} execute - Async function that takes args and returns stdout JSON object
 */
async function wrapCommand({ commandName, receiptPath, touchedPaths, parseArgs, execute }) {
  const args = parseArgs();

  return await withReceipt({
    receiptPath,
    commandName,
    args: args,
    touchedPaths
  }, () => execute(args));
}

module.exports = {
  wrapCommand,
  sha256FileOrNull
};
