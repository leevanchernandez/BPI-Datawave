'use strict';
// Cheap page classification from OCR lines. Model is only the fallback for pages this cannot place.
const RULES = [
  ['application_form', /loan application|application form/i],
  ['audited_fs', /audited financial statements?/i],
  ['financials', /statement of financial position|income statement|balance sheet|income tax return|\bitr\b/i],
  ['bank_statements', /statement of account|bank statement/i],
  ['sanitary_permit', /sanitary permit|health permit/i],
  ['business_permit', /mayor'?s permit|business permit/i],
  ['registration', /department of trade and industry|\bdti\b|securities and exchange commission|certificate of registration/i],
  ['gov_id', /republic of the philippines[\s\S]*(umid|driver'?s? licen[sc]e|philsys|passport|prc|postal id|voter)|umid|philsys/i],
];

// lines: [{text, conf}] -> { docType | null, hits }
function classify(lines) {
  const text = lines.map((l) => l.text).join('\n');
  for (const [docType, re] of RULES) if (re.test(text)) return { docType };
  return { docType: null };
}

// Map Textract form keys to our field names. Extend per real form.
const FORM_KEYS = {
  business_name: ['business name', 'name of business', 'trade name'],
  owner_name: ['name of applicant', 'owner name', 'applicant name', 'full name'],
  address: ['business address', 'address'],
  tin: ['tin', 'tax identification number'],
  contact: ['contact number', 'mobile', 'phone'],
  signature: ['signature', 'signature of applicant'],
  civil_status: ['civil status'],
  spouse_name: ['spouse name', 'name of spouse'],
  spouse_signature: ['spouse signature', 'signature of spouse'],
};
function mapForm(kv) {
  const fields = {}, conf = {};
  for (const [name, keys] of Object.entries(FORM_KEYS)) {
    const hit = Object.entries(kv).find(([k]) => keys.some((x) => k === x || k.startsWith(x)));
    if (hit) { fields[name] = hit[1].value; conf[name] = hit[1].conf; }
  }
  return { fields, conf };
}

module.exports = { classify, mapForm };
