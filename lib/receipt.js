/**
 * Voilà Mutation Receipts
 * Deterministic file hash tracking and receipt generation
 */

const fs = require('fs');
const crypto = require('crypto');

/**
 * Compute SHA-256 hash of file content, or null if file does not exist
 * @param {string} filePath - Path to file
 * @returns {string|null} Hex SHA-256 hash or null
 */
function sha256FileOrNull(filePath) {
  try {
    const content = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(content).digest('hex');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

/**
 * Write receipt atomically (to temp file, then rename)
 * @param {string} receiptPath - Final receipt file path
 * @param {Object} receiptObj - Receipt object to write
 * @returns {void}
 */
function writeReceiptAtomic(receiptPath, receiptObj) {
  const tempPath = `${receiptPath}.tmp`;
  const content = JSON.stringify(receiptObj, null, 2);

  fs.writeFileSync(tempPath, content, 'utf-8');
  fs.renameSync(tempPath, receiptPath);
}

/**
 * Wrap command execution with receipt generation
 * @param {Object} options - Receipt options
 * @param {string} options.receiptPath - Path to write receipt (or null to skip)
 * @param {string} options.commandName - Command name for receipt
 * @param {Object} options.args - Parsed command arguments
 * @param {string[]} options.touchedPaths - Paths to track for hash changes
 * @param {Function} fn - Async function to execute (returns stdout JSON object)
 * @returns {Promise<Object>} The stdout JSON object from fn()
 */
async function withReceipt({ receiptPath, commandName, args, touchedPaths }, fn) {
  // Capture before hashes
  const beforeHashes = {};
  touchedPaths.sort(); // Ensure deterministic order
  for (const path of touchedPaths) {
    beforeHashes[path] = sha256FileOrNull(path);
  }

  // Execute command
  let stdoutObj;
  let error = null;
  try {
    stdoutObj = await fn();
  } catch (err) {
    error = err;
  } finally {
    // Always write receipt if requested
    if (receiptPath) {
      try {
        // Capture after hashes
        const afterHashes = {};
        for (const path of touchedPaths) {
          afterHashes[path] = sha256FileOrNull(path);
        }

        // Build touched_files array
        const touchedFiles = touchedPaths.map(path => ({
          path,
          sha256_before: beforeHashes[path],
          sha256_after: afterHashes[path]
        }));

        // Build receipt object
        // If error occurred, stdoutObj is undefined/null, so we set ok: false
        const receiptOk = error ? false : (stdoutObj && stdoutObj.ok);
        const receipt = {
          ok: receiptOk,
          command: commandName,
          args: args,
          touched_files: touchedFiles,
          stdout_json: stdoutObj || { ok: false }
        };

        // Write receipt
        writeReceiptAtomic(receiptPath, receipt);
      } catch (receiptError) {
        // If receipt writing fails, we can't output it properly
        // But we've already output stdout JSON via printOk/printError
        // Log to stderr for debugging
        console.error(`[Receipt write failed: ${receiptError.message}]`);
      }
    }
  }

  // Re-throw error if one occurred
  if (error) {
    throw error;
  }

  return stdoutObj;
}

module.exports = {
  sha256FileOrNull,
  writeReceiptAtomic,
  withReceipt
};
