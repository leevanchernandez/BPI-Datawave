'use strict';
// Pages in, check result out. All AWS access is injected: deps = { detectLines, analyzeForm, readPage }.
const { classify, mapForm } = require('./classify.cjs');
const { check } = require('./checker.cjs');

const NEEDS_MODEL_FIELDS = new Set(['gov_id', 'registration', 'business_permit']);
const pageOf = (lines) => {
  for (const l of lines) { const m = /page\s+(\d+)\s+of\s+(\d+)/i.exec(l.text); if (m) return { pageNo: +m[1], pageTotal: +m[2] }; }
  return {};
};

/** pages: [{ bytes, mediaType }]. Returns { result, pages } where pages carries provenance for display. */
async function processPacket(referral, pages, deps, opts = {}) {
  const out = [];
  const review = [];
  for (let i = 0; i < pages.length; i++) {
    const src = pages[i];
    const lines = await deps.detectLines(src.bytes);
    let page = { ...classify(lines), ...pageOf(lines), fields: {}, conf: {}, srcIndex: i };
    if (page.docType === 'application_form') {
      Object.assign(page, mapForm(await deps.analyzeForm(src.bytes)));
    } else if (!page.docType || NEEDS_MODEL_FIELDS.has(page.docType)) {
      const m = await deps.readPage(src);
      if (m.unreadable || m.docType === undefined) { review.push({ key: `PAGE_UNREADABLE:${i + 1}`, message: `Page ${i + 1} could not be read. Please rescan.` }); continue; }
      page = { ...page, ...m, docType: page.docType || m.docType, pageNo: page.pageNo ?? m.pageNo, pageTotal: page.pageTotal ?? m.pageTotal, srcIndex: i };
    }
    if (!page.docType) { review.push({ key: `PAGE_UNPLACED:${i + 1}`, message: `Page ${i + 1} is not a recognized document. Please check it.` }); continue; }
    out.push(page);
  }
  const result = check(referral, { pages: out }, opts);
  result.needsReview.push(...review);
  result.complete = result.defects.length === 0 && result.needsReview.length === 0;
  return { result, pages: out.map(({ docType, pageNo, pageTotal, side, srcIndex }) => ({ docType, pageNo, pageTotal, side, srcIndex })) };
}

module.exports = { processPacket };
