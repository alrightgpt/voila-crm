/**
 * Voilà CSV Import Client
 */

const fs = require('fs');
const path = require('path');

/**
 * Parse CSV file and convert to array of lead objects
 * @param {string} csvPath - Path to CSV file
 * @returns {Array<Object>} Array of lead objects
 */
function parseCSV(csvPath) {
  if (!fs.existsSync(csvPath)) {
    throw new Error(`CSV file not found: ${csvPath}`);
  }

  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = content.trim().split('\n');

  if (lines.length < 2) {
    throw new Error(`CSV file is empty or has no data rows: ${csvPath}`);
  }

  const headers = parseCSVLine(lines[0]);
  const leads = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const lead = {};

    headers.forEach((header, index) => {
      const key = header.trim().toLowerCase().replace(/\s+/g, '_');
      lead[key] = values[index] ? values[index].trim() : '';
    });

    // Normalize required fields
    leads.push(normalizeLead(lead));
  }

  return leads;
}

/**
 * Parse a single CSV line (handles quoted fields)
 * @param {string} line - CSV line
 * @returns {Array<string>} Array of field values
 */
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  result.push(current);
  return result;
}

/**
 * Normalize lead data to standard format
 * @param {Object} rawLead - Raw lead from CSV
 * @returns {Object} Normalized lead
 */
function normalizeLead(rawLead) {
  // Normalize email (priority: direct_email -> general_email -> email -> email_address)
  const email = (rawLead.direct_email || rawLead.general_email || rawLead.email || rawLead.email_address || '').trim().toLowerCase();

  // Normalize name (priority: primary_contact -> team_name -> name)
  const fullName = (rawLead.primary_contact || rawLead.team_name || rawLead.name || rawLead.contact_name || '').trim();
  const first_name = fullName.split(' ')[0] || '';

  // Normalize role
  const roleRaw = (rawLead.role || rawLead.team_type || rawLead.type || 'unknown').toLowerCase();
  let role = 'unknown';

  if (roleRaw.includes('independent') || roleRaw.includes('individual')) {
    role = 'independent';
  } else if (roleRaw.includes('brokerage') || roleRaw.includes('broker')) {
    role = 'brokerage';
  } else if (roleRaw.includes('kw') || roleRaw.includes('keller williams')) {
    role = 'kw';
  }

  return {
    name: fullName,
    first_name,
    email,
    phone: rawLead.phone || rawLead.phone_number || '',
    company: rawLead.company || rawLead.company_name || rawLead.brokerage || '',
    role,
    source_notes: rawLead.notes || rawLead.source || rawLead.lead_source || 'csv_import',
    ...rawLead
  };
}

/**
 * Generate UUID for new leads
 * @returns {string} UUID v4
 */
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

module.exports = {
  parseCSV,
  normalizeLead,
  generateUUID
};
