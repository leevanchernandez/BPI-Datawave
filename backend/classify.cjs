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
  ['form_annex', /checklist of supporting documents|printed name of (the )?borrower|for bank reference only|related to a dos\b|for business banking segment/i], // later pages of BPI's form: signatures, checklist, PSIC list, DOSRI questions
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
  business_name: ['business name', 'name of business', 'trade name', 'registered business name'],
  owner_name: ['name of applicant', 'owner name', 'applicant name', 'full name', 'name of the borrower'],
  address: ['business address', 'principal business address', 'address', 'home address'],
  tin: ['tin', 'tax identification number'],
  contact: ['contact number', 'mobile', 'phone', 'mobile no', 'mobile number'],
  signature: ['signature', 'signature of applicant'],
  civil_status: ['civil status'],
  spouse_name: ['spouse name', 'name of spouse'],
  spouse_signature: ['spouse signature', 'signature of spouse'],
};
// "Registered Business Name (Trade Name)" -> "registered business name". A key that is only "(First Name)" keeps its words.
const normKey = (k) => {
  const [, base, n = ''] = /^(.*?)(\s#\d+)?$/.exec(String(k).toLowerCase().replace(/[:*_]/g, ' '));
  const bare = base.replace(/\([^)]*\)/g, ' ').replace(/\([^)]*$/, ' '); // a blurred photo can lose the closing parenthesis
  return ((bare.trim() ? bare : base.replace(/[()]/g, ' ')).replace(/[\s.;,\-–]+$/, '').replace(/\s+/g, ' ').trim() + n).trim();
};
const CIVIL_BOXES = ['single', 'married', 'widow/er', 'widowed', 'separated', 'annulled'];
function mapForm(kv) {
  const fields = {}, conf = {};
  const SUBLABEL = /^\s*\(?(first|middle|last) name\)?\s*$/i; // a printed sub-label read as the value is a blank field
  const norm = new Map(Object.entries(kv).map(([k, v]) => [normKey(k), v && SUBLABEL.test(v.value || '') ? { ...v, value: '' } : v]));
  for (const [name, keys] of Object.entries(FORM_KEYS)) {
    const hit = keys.map((x) => norm.get(x)).find((v) => v && String(v.value || '').trim()) || keys.map((x) => norm.get(x)).find(Boolean); // exact match only: 'signature of spouse' must never fill 'signature'
    if (hit) { fields[name] = hit.value; conf[name] = hit.conf; }
  }
  // BPI's form splits names into (First Name) (Middle Name) (Last Name) boxes: the borrower's row first, the spouse's second.
  const parts = (n) => ['first name', 'middle name', 'last name'].map((k) => norm.get(n ? `${k} #${n}` : k)).filter((v) => v && String(v.value || '').trim());
  for (const [name, n] of [['owner_name', 0], ['spouse_name', 2]]) {
    const p = parts(n);
    if (!String(fields[name] || '').trim() && p.length >= 2) { fields[name] = p.map((v) => v.value.trim()).join(' '); conf[name] = Math.min(...p.map((v) => v.conf)); }
  }
  // Civil status as ticked boxes.
  if (!String(fields.civil_status || '').trim()) {
    const box = CIVIL_BOXES.find((k) => (norm.get(k) || {}).value === 'SELECTED');
    if (box) { fields.civil_status = box; conf.civil_status = norm.get(box).conf; }
  }
  return { fields, conf };
}

// A short note from BPI's application form, read by the same intake as a typed note.
function formNote(kv) {
  const { fields } = mapForm(kv);
  const norm = new Map(Object.entries(kv).map(([k, v]) => [normKey(k), v]));
  const val = (k) => { const v = String((norm.get(k) || {}).value || '').trim(); return /^(NOT_)?SELECTED$/.test(v) ? '' : v; };
  const ticked = (k) => (norm.get(k) || {}).value === 'SELECTED';
  const s = [];
  if (fields.business_name) s.push(`Business name ${fields.business_name}.`);
  if (fields.owner_name) s.push(`Owner ${fields.owner_name}.`);
  const type = ['sole-proprietorship', 'partnership', 'corporation', 'one person corporation'].find(ticked);
  if (type) s.push(`${type.replace('-', ' ')}.`);
  const activity = [val('please specify business activity'), val('nature of business')].filter(Boolean).join(', ');
  if (activity) s.push(`Business activity ${activity}.`);
  if (fields.civil_status) s.push(`Civil status ${fields.civil_status}.`);
  if (fields.spouse_name) s.push(`Spouse ${fields.spouse_name}.`);
  const amount = val('php').replace(/[^\d.]/g, '');
  if (+amount > 0) s.push(`Loan amount PHP ${amount}.`); // annual sales stay out, so the note has one peso amount
  if (ticked('unsecured loan')) s.push('Unsecured loan, no collateral.');
  else if (ticked('secured loan')) s.push('Secured loan with collateral.');
  return s.join(' ');
}

module.exports = { classify, mapForm, formNote };
