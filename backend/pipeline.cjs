'use strict';
// Pages in, check result out. OCR and model access are injected: deps = { detectLines, analyzeForm, readPage, markedFields? }.
// Model output is untrusted: any name or date it returns must be visible in the OCR text of the same page.
// The model only sees pages the classifier placed as IDs, registrations or permits, as OCR text with ID numbers
// masked. Pages the classifier cannot place go to the branch to label, never to the model.
const { classify, mapForm } = require('./classify.cjs');
const { check } = require('./checker.cjs');
const { nameCompare } = require('./names.cjs');

const NEEDS_MODEL_FIELDS = new Set(['gov_id', 'registration', 'business_permit', 'sanitary_permit']);
const LABELS = new Set(['application_form', 'gov_id', 'spouse_id', 'registration', 'business_permit', 'sanitary_permit', 'itr', 'financials', 'audited_fs', 'bank_statements', 'articles', 'bylaws', 'gis', 'collateral', 'bir_cor', 'cal', 'endorsement_letter', 'pcab_license', 'project_list', 'contract', 'tax_declaration', 'tax_clearance', 'tax_receipt', 'appraisal_letter', 'authorization_letter']);
const MIN_LINES = 3;     // a page with fewer text lines than this is not trusted to be the document its title says
const CONCURRENCY = 4;
const FORM_TEXT = ['business_name', 'owner_name', 'address', 'tin', 'contact', 'civil_status', 'spouse_name'];
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

const words = (s) => String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const pageOf = (lines) => {
  for (const l of lines) { const m = /page\s+(\d{1,3})\s+of\s+(\d{1,3})/i.exec(l.text); if (m) return { pageNo: +m[1], pageTotal: +m[2] }; }
  return {};
};

/** every word of the name appears as a whole word on the page ("Ana Lena" is not grounded by "BANANA ... ELENA") */
function nameGrounded(value, text) {
  const page = new Set(words(text));
  const w = words(value).filter((x) => x.length > 1);
  return w.length > 0 && w.every((x) => page.has(x));
}
/** an ISO date is grounded only if ONE line shows its year, day and month (number or name) */
function dateGrounded(iso, text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return false;
  const mon = MONTHS[+m[2] - 1];
  return String(text).toLowerCase().split('\n').some((line) => {
    const nums = new Set(line.match(/\d+/g) || []);
    const dayOk = nums.has(String(+m[3])) || nums.has(m[3]);
    const monthOk = nums.has(String(+m[2])) || nums.has(m[2]) || new RegExp(`\\b${mon.slice(0, 3)}`).test(line);
    return nums.has(m[1]) && dayOk && monthOk;
  });
}

/** mask ID numbers (PhilSys 16 digits, UMID CRN 12, TIN, driver's licence) before any text reaches a model */
function maskIds(text) {
  return String(text)
    .replace(/\b\d{4}[- ]?\d{4}[- ]?\d{4}(?:[- ]?\d{4})?\b/g, '[ID NUMBER]')
    .replace(/\b\d{3}[- ]\d{3}[- ]\d{3}(?:[- ]\d{3,5})?\b/g, '[ID NUMBER]')
    .replace(/\b[A-Z]\d{2}[- ]\d{2}[- ]\d{6}\b/gi, '[ID NUMBER]')
    .replace(/\b\d{10,}\b/g, '[ID NUMBER]');
}

async function pool(items, n, fn) {
  const out = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } }));
  return out;
}

/** pages: [{ bytes?, mediaType?, lines?, docType? (branch label) }]. Returns { result, pages, trace }. */
async function processPacket(referral, pages, deps, opts = {}) {
  const review = [], trace = [];
  const read = await pool(pages, CONCURRENCY, async (src, i) => {
    const lines = await deps.detectLines(src.bytes, src);
    const text = lines.map((l) => l.text).join('\n');
    const label = LABELS.has(src.docType) ? src.docType : null;
    let page = { ...classify(lines), ...pageOf(lines), fields: {}, conf: {}, srcIndex: i };
    const t = { page: i + 1, lines: lines.length, classifiedAs: page.docType, label, model: false };
    trace.push(t);
    if (!page.docType && label) page.docType = label;
    if (!page.docType) { review.push({ key: `PAGE_UNPLACED:${i + 1}`, message: `Page ${i + 1} is not a recognized document. Please label it.` }); return null; }
    if (lines.length < MIN_LINES) { review.push({ key: `PAGE_THIN:${i + 1}`, message: `Page ${i + 1} has very little text for a ${page.docType.replace(/_/g, ' ')}. Please check it.` }); return null; }
    if (page.docType === 'application_form') {
      Object.assign(page, mapForm(await deps.analyzeForm(src.bytes, src)));
      // Fields the Forms pass left empty get a second look. A field with any mark in it goes to a person, not to the client.
      const empty = FORM_TEXT.filter((k) => !String(page.fields[k] ?? '').trim());
      if (empty.length && deps.markedFields) {
        t.model = true;
        try { page.unread = (await deps.markedFields(src, empty)).filter((k) => empty.includes(k)); } catch (e) { t.modelError = String(e.message || e).slice(0, 160); } // on a model outage the field stays a blank-field defect
      }
    } else if (NEEDS_MODEL_FIELDS.has(page.docType)) {
      t.model = true;
      let m;
      try { m = await deps.readPage({ ...src, text: maskIds(text) }); } catch (e) { t.modelError = String(e.message || e).slice(0, 160); m = null; } // a model outage sends the page to a person
      if (!m || m.unreadable) { review.push({ key: `PAGE_UNREADABLE:${i + 1}`, message: `Page ${i + 1} could not be read. Please rescan.` }); return null; }
      const fields = {}, conf = {};
      for (const k of ['owner_name', 'business_name']) {
        const v = (m.fields || {})[k];
        if (v && nameGrounded(v, text)) { fields[k] = v; conf[k] = (m.conf || {})[k] ?? 0.6; }
        else if (v) review.push({ key: `MODEL_UNGROUNDED:${i + 1}:${k}`, message: `Page ${i + 1}: a ${k.replace(/_/g, ' ')} was reported that is not visible in the page text. Please check it.` });
      }
      const expiry = m.expiry && dateGrounded(m.expiry, text) ? m.expiry : undefined;
      if (m.expiry && !expiry) review.push({ key: `MODEL_UNGROUNDED:${i + 1}:expiry`, message: `Page ${i + 1}: a validity date was reported that is not visible in the page text. Please check it.` });
      t.grounded = { ...Object.fromEntries(Object.keys(fields).map((k) => [k, true])), ...(m.expiry ? { expiry: Boolean(expiry) } : {}) };
      page = { ...page, side: m.side, pageNo: page.pageNo ?? m.pageNo, pageTotal: page.pageTotal ?? m.pageTotal, fields, conf, expiry, srcIndex: i };
    }
    t.docType = page.docType;
    return page;
  });
  const out = read.filter(Boolean);

  // A government ID whose name is the spouse on the form (and not the owner) is the spouse's ID.
  // The spouse named on the referral stands in when the form shows none. The checker then sends that ID to a person.
  const spouse = out.filter((p) => p.docType === 'application_form').map((p) => p.fields.spouse_name).find((v) => v && String(v).trim()) || referral.spouseName;
  if (spouse) for (const p of out) {
    const n = p.docType === 'gov_id' && p.fields.owner_name;
    if (n && nameCompare(n, spouse) !== 'different' && nameCompare(n, referral.name) === 'different') {
      p.docType = 'spouse_id';
      const t = trace.find((x) => x.page === p.srcIndex + 1); if (t) t.docType = 'spouse_id';
    }
  }

  const result = check(referral, { pages: out }, opts);
  result.needsReview.push(...review);
  result.complete = result.defects.length === 0 && result.needsReview.length === 0;
  return { result, trace, pages: out.map(({ docType, pageNo, pageTotal, side, srcIndex }) => ({ docType, pageNo, pageTotal, side, srcIndex })) };
}

module.exports = { processPacket, nameGrounded, dateGrounded, maskIds };
