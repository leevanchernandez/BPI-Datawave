'use strict';
// Pages in, check result out. All AWS access is injected: deps = { detectLines, analyzeForm, readPage }.
// Model output is untrusted: any name or date it returns must be visible in the OCR text of the same page.
const { classify, mapForm } = require('./classify.cjs');
const { check } = require('./checker.cjs');

const NEEDS_MODEL_FIELDS = new Set(['gov_id', 'registration', 'business_permit', 'sanitary_permit']);
const MIN_LINES = 3;     // a page with fewer text lines than this is not trusted to be the document its title says
const CONCURRENCY = 4;
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

const alnum = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const pageOf = (lines) => {
  for (const l of lines) { const m = /page\s+(\d{1,3})\s+of\s+(\d{1,3})/i.exec(l.text); if (m) return { pageNo: +m[1], pageTotal: +m[2] }; }
  return {};
};

/** every word of a name appears in the page text (letters and digits only, so punctuation and spacing do not matter) */
function nameGrounded(value, text) {
  const t = alnum(text);
  const words = String(value || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1);
  return words.length > 0 && words.every((w) => t.includes(w));
}
/** an ISO date is grounded if the page shows its year, its day, and its month (number or name) */
function dateGrounded(iso, text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return false;
  const low = String(text).toLowerCase();
  const nums = new Set(low.match(/\d+/g) || []);
  const mon = MONTHS[+m[2] - 1];
  const dayOk = nums.has(String(+m[3])) || nums.has(m[3]);
  const monthOk = nums.has(String(+m[2])) || nums.has(m[2]) || low.includes(mon) || low.includes(mon.slice(0, 3));
  return nums.has(m[1]) && dayOk && monthOk;
}

async function pool(items, n, fn) {
  const out = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } }));
  return out;
}

/** pages: [{ bytes, mediaType }]. Returns { result, pages } where pages carries provenance for display. */
async function processPacket(referral, pages, deps, opts = {}) {
  const review = [];
  const read = await pool(pages, CONCURRENCY, async (src, i) => {
    const lines = await deps.detectLines(src.bytes);
    const text = lines.map((l) => l.text).join('\n');
    let page = { ...classify(lines), ...pageOf(lines), fields: {}, conf: {}, srcIndex: i };
    if (page.docType && lines.length < MIN_LINES) { review.push({ key: `PAGE_THIN:${i + 1}`, message: `Page ${i + 1} has very little text for a ${page.docType.replace(/_/g, ' ')}. Please check it.` }); return null; }
    if (page.docType === 'application_form') {
      Object.assign(page, mapForm(await deps.analyzeForm(src.bytes)));
    } else if (!page.docType || NEEDS_MODEL_FIELDS.has(page.docType)) {
      const m = await deps.readPage(src);
      if (!m || m.unreadable) { review.push({ key: `PAGE_UNREADABLE:${i + 1}`, message: `Page ${i + 1} could not be read. Please rescan.` }); return null; }
      const fields = {}, conf = {};
      for (const k of ['owner_name', 'business_name']) {
        const v = (m.fields || {})[k];
        if (v && nameGrounded(v, text)) { fields[k] = v; conf[k] = (m.conf || {})[k] ?? 0.6; }
        else if (v) review.push({ key: `MODEL_UNGROUNDED:${i + 1}:${k}`, message: `Page ${i + 1}: a ${k.replace(/_/g, ' ')} was reported that is not visible in the page text. Please check it.` });
      }
      const expiry = m.expiry && dateGrounded(m.expiry, text) ? m.expiry : undefined;
      if (m.expiry && !expiry) review.push({ key: `MODEL_UNGROUNDED:${i + 1}:expiry`, message: `Page ${i + 1}: a validity date was reported that is not visible in the page text. Please check it.` });
      page = { ...page, docType: page.docType || m.docType, side: m.side, pageNo: page.pageNo ?? m.pageNo, pageTotal: page.pageTotal ?? m.pageTotal, fields, conf, expiry, srcIndex: i };
    }
    if (!page.docType) { review.push({ key: `PAGE_UNPLACED:${i + 1}`, message: `Page ${i + 1} is not a recognized document. Please check it.` }); return null; }
    return page;
  });
  const out = read.filter(Boolean);
  const result = check(referral, { pages: out }, opts);
  result.needsReview.push(...review);
  result.complete = result.defects.length === 0 && result.needsReview.length === 0;
  return { result, pages: out.map(({ docType, pageNo, pageTotal, side, srcIndex }) => ({ docType, pageNo, pageTotal, side, srcIndex })) };
}

module.exports = { processPacket, nameGrounded, dateGrounded };
