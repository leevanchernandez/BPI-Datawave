'use strict';
// Cheap page classification from OCR lines. Model is only the fallback for pages this cannot place.
const RULES = [
  ['application_form', /\bloan application( form)?\b|^application form\b/im],
  ['audited_fs', /audited financial statements?/i],
  ['financials', /statement of financial position|income statement|balance sheet|income tax return|\bitr\b/i],
  ['bank_statements', /statement of account|bank statement/i],
  ['sanitary_permit', /sanitary permit|health permit/i],
  ['business_permit', /mayor'?s permit|business permit/i],
  ['registration', /department of trade and industry|\bdti\b|securities and exchange commission|certificate of registration/i],
  ['gov_id', /republic of the philippines[\s\S]*\b(umid|driver'?s? licen[sc]e|philsys|passport|prc|postal id|voter)\b|\bumid\b|\bphilsys\b/i],
];

// lines: [{text, conf}] -> { docType | null, hits }
function classify(lines) {
  const text = lines.slice(0, 8).map((l) => l.text).join('\n'); // titles live at the top; body mentions must not classify the page
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
const normKey = (k) => String(k).toLowerCase().replace(/[:*_]/g, ' ').replace(/\s+/g, ' ').trim();
function mapForm(kv) {
  const fields = {}, conf = {};
  const norm = new Map(Object.entries(kv).map(([k, v]) => [normKey(k), v]));
  for (const [name, keys] of Object.entries(FORM_KEYS)) {
    const hit = keys.map((x) => norm.get(x)).find(Boolean); // exact match only: 'signature of spouse' must never fill 'signature'
    if (hit) { fields[name] = hit.value; conf[name] = hit.conf; }
  }
  return { fields, conf };
}

module.exports = { classify, mapForm };
