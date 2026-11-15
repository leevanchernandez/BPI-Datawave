'use strict';
// Cheap page classification from OCR lines. Model is only the fallback for pages this cannot place.
const RULES = [
  // Titles that contain words matched further down come first: "client authorization letter" before
  // "authorization letter", "tax declaration" before the TCT rule, "certificate of registration" (BIR) before DTI.
  ['cal', /client authori[sz]ation letter/i],
  ['endorsement_letter', /endorsement letter|bank verification/i],
  ['authorization_letter', /authori[sz]ation letter|letter of authority|special power of attorney/i],
  ['appraisal_letter', /appraisal (letter|report)|letter of appraisal/i],
  ['tax_clearance', /(real property )?tax clearance/i],
  ['tax_receipt', /official receipt[\s\S]*real property tax|real property tax[\s\S]*receipt|\brpt\b.*receipt/i],
  ['tax_declaration', /tax declaration/i],
  ['pcab_license', /\bpcab\b|philippine contractors accreditation board|contractor'?s licen[sc]e/i],
  ['project_list', /list of (on-?going|current) projects/i],
  ['contract', /notice of award|\bcontract agreement\b|construction contract/i],
  ['bir_cor', /bir form (no\.? )?2303|certificate of registration[\s\S]*bureau of internal revenue|bureau of internal revenue[\s\S]*certificate of registration/i],
  ['application_form', /\bloan application( form)?\b|^application form\b/im],
  ['gov_application', /(business permit|business name registration|sole proprietorship|department of trade and industry)[\s\S]*application (form|for)\b|application (form )?for (a )?(business permit|mayor'?s permit|registration|business name)/i], // an application to an agency, not the paper it issues
  ['audited_fs', /audited financial statements?|independent auditor/i],
  ['itr', /income tax return|\bbir form (no\.? )?170[0-2]/i],
  ['financials', /statement of financial position|income statement|balance sheet|financial statements?/i],
  ['bank_statements', /statement of account|bank statement/i],
  ['gis', /general information sheet/i],
  ['articles', /articles of (incorporation|partnership)/i],
  ['bylaws', /\bby-?laws\b/i],
  ['collateral', /transfer certificate of title|condominium certificate of title|tax declaration of real property|\btct\b/i],
  ['sanitary_permit', /sanitary permit|health permit/i],
  ['business_permit', /mayor'?s permit|business permit/i],
  ['registration', /department of trade and industry|\bdti\b|securities and exchange commission|certificate of (business name )?registration/i],
  ['gov_id', /republic of the philippines[\s\S]*\b(umid|driver'?s? licen[sc]e|philsys|passport|prc|postal id|voter)\b|\bumid\b|\bphilsys\b|pambansang pagkakakilanlan|philippine identification|araw ng pagkakaloob/i], // the last one is the back of the national ID, which has no title
];

const GOV_FORM_TITLE = /(business permit|business name registration|sole proprietorship|department of trade and industry)[\s\S]*application form\b|application form for (a )?(business permit|mayor'?s permit|registration|business name)/i;

// lines: [{text, conf}] -> { docType | null, hits }
function classify(lines) {
  const top = (n) => lines.slice(0, n).map((l) => l.text).join('\n');
  const text = top(8); // titles live at the top; body mentions must not classify the page
  if (GOV_FORM_TITLE.test(top(16)) && !/\bloan application/i.test(text)) return { docType: 'gov_application' }; // the title can sit under a header box
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
