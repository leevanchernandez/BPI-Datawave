// Free-stack API, end to end on the Elena storyline, with an in-memory store and a fake model.
// Run: node scripts/verify-free.mjs        (add GEMINI_API_KEY=... to also run one live model read)
import assert from 'node:assert/strict';
import { makeApi, openItems } from '../worker/api.mjs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const mem = new Map();
const store = { get: async (id) => (mem.has(id) ? JSON.parse(mem.get(id)) : null), put: async (id, c) => { mem.set(id, JSON.stringify(c)); } };
const seen = [];
const fakeLlm = {
  model: 'fake',
  async readPage({ text }) {
    seen.push(text);
    const name = /^(?:Name|Owner|Pangalan)\s*:\s*(.+)$/im.exec(text);
    const biz = /^Business name\s*:\s*(.+)$/im.exec(text);
    const until = /Valid until\s*:?\s*(\d{4}-\d{2}-\d{2})/i.exec(text);
    const side = /\bback\b/i.test(text) ? 'back' : 'front';
    return { docType: null, fields: { ...(name ? { owner_name: name[1].trim() } : {}), ...(biz ? { business_name: biz[1].trim() } : {}) }, conf: { owner_name: 0.95, business_name: 0.95 }, expiry: until ? until[1] : undefined, side };
  },
  async draftMessage({ items }) { return `Kulang pa po: ${items.length} item.`; },
  async draftLesson({ reason }) { return `Reminder from a BSO return. ${reason}`; },
  async ask(q, h) { const r = await h.get_lacking(); return { answer: `Kulang pa: ${(r.missing || []).join('; ')}`, handoff: false, trace: [{ tool: 'get_lacking', result: r }] }; },
};
const api = makeApi({ store, llm: fakeLlm, now: () => new Date('2026-11-05T04:00:00Z'), demoKey: 'k' });
const call = async (method, path, body, key = 'k') => {
  const r = await api(new Request(`https://x${path}`, { method, headers: { 'content-type': 'application/json', 'x-demo-key': key }, body: body ? JSON.stringify(body) : undefined }));
  return { status: r.status, body: await r.json() };
};
const L = (texts, conf = 0.96) => texts.map((t) => (typeof t === 'string' ? { text: t, conf } : t));

const REF = { id: 'RF-2026-042', business: "Elena's Artisan Bakery", name: 'Elena Santos', type: 'Sole proprietorship', industry: 'Food & beverage', amount: 750000, civilStatus: 'married', spouseName: 'Ramon Santos', secured: false, bpiAccount: true };
const FORM = (tin, civil, civilConf = 0.95) => ({ lines: L(['LOAN APPLICATION FORM', 'SPECIMEN', 'Page 1 of 1', "Business name: Elena's Artisan Bakery", 'Name of applicant: Elena Santos', 'Address: 12 Rizal St, Los Banos, Laguna', `TIN: ${tin}`, 'Contact number: 0917 555 0142', { text: `Civil status: ${civil}`, conf: civilConf }, 'Name of spouse: Ramon Santos']) });
const ID = (name, side, until) => ({ lines: L(['REPUBLIC OF THE PHILIPPINES', 'PHILIPPINE IDENTIFICATION CARD', 'PhilSys', 'SPECIMEN', `Name: ${name}`, 'PSN 1234-5678-9012-3456', side === 'back' ? 'back of card' : `Valid until 2031-01-31`]) });
const DTI = (n) => ({ lines: L(['DEPARTMENT OF TRADE AND INDUSTRY', 'Certificate of Business Name Registration', 'SPECIMEN', `Page ${n} of 2`, "Business name: Elena's Artisan Bakery", 'Owner: Elena Santos']) });
const ITR = { lines: L(['Annual Income Tax Return', 'BIR Form No. 1701', 'SPECIMEN', 'Taxable year 2025']) };
const FS = { lines: L(['Statement of Financial Position', 'SPECIMEN', 'As of December 31, 2025', 'Total assets']) };
const BANK = { lines: L(['BANK STATEMENT', 'SPECIMEN', 'Account [masked]', 'Period: Aug to Oct 2026']) };
const COR = { lines: L(['REPUBLIC OF THE PHILIPPINES', 'BUREAU OF INTERNAL REVENUE', 'Certificate of Registration', 'BIR Form No. 2303', 'SPECIMEN', "Business name: Elena's Artisan Bakery"]) };
const PERMIT = { lines: L(["MAYOR'S PERMIT", 'SPECIMEN', "Business name: Elena's Artisan Bakery", 'Valid until: 2027-01-31']) };
const CAL = { lines: L(['CLIENT AUTHORIZATION LETTER', 'SPECIMEN', 'Signed: Elena Santos', 'Signed: Ramon Santos']) };

// auth and validation
assert.equal((await call('GET', '/api/case?id=RF-2026-042', null, 'wrong')).status, 401);
assert.equal((await call('POST', '/api/case', { referral: { ...REF, civilStatus: 'complicated' } })).status, 400, 'civil status must be known');
assert.equal((await call('POST', '/api/check', { id: REF.id, pages: [FORM('', 'Kasal')] })).status, 404, 'check needs a saved case');

// 1. save the case: checklist with sources, spouse ID row because married
let r = await call('POST', '/api/case', { referral: REF });
assert.equal(r.status, 200);
assert(r.body.rules.rows.some((x) => x.id === 'spouse_id' && x.reason === 'married'));
assert(r.body.rules.rows.every((x) => x.sourceTitle));

// 2. first scan: DTI page 2 missing, TIN blank, handwritten civil status unreadable (low OCR confidence)
const pages1 = [FORM('', 'Kasal', 0.41), ID('Elena Santos', 'front'), ID('Elena Santos', 'back'), ID('Ramon Santos', 'front'), DTI(1), COR, PERMIT, BANK, CAL];
r = await call('POST', '/api/check', { id: REF.id, pages: pages1 });
assert.equal(r.status, 200, JSON.stringify(r.body));
const keys = (x) => [...x.result.defects, ...x.result.needsReview].map((d) => d.key);
assert(keys(r.body).includes('MISSING_PAGE:dti#2'), keys(r.body).join(','));
assert(keys(r.body).includes('BLANK_FIELD:tin'));
assert(keys(r.body).includes('CIVIL_UNREADABLE:civil_status'));
assert(!keys(r.body).some((k) => /NAME_MISMATCH|REFERRAL_MISMATCH/.test(k)), "spouse ID is not treated as the owner");
assert.equal(r.body.status, 'Missing requirements');
assert(r.body.trace.some((t) => t.docType === 'spouse_id'), 'trace shows the spouse ID');
assert(seen.every((t) => !/1234-5678/.test(t)), 'ID numbers are masked before the model');
assert(!seen.some((t) => /BANK STATEMENT/.test(t)), 'bank statements never reach the model');

// 3. handoff refused while items are open; clearing needs the typed value and a reason
assert.equal((await call('POST', '/api/event', { id: REF.id, type: 'handed_off', by: 'BM' })).status, 400);
assert.equal((await call('POST', '/api/event', { id: REF.id, type: 'cleared', by: 'BM', key: 'CIVIL_UNREADABLE:civil_status' })).status, 400);
r = await call('POST', '/api/event', { id: REF.id, type: 'cleared', by: 'BM', key: 'CIVIL_UNREADABLE:civil_status', value: 'Married', reason: 'Checked the paper form with the client' });
assert.equal(r.status, 200);
assert(!r.body.open.needsReview.some((d) => d.key === 'CIVIL_UNREADABLE:civil_status'));
assert.equal((await call('POST', '/api/event', { id: REF.id, type: 'waived', by: 'BM', key: 'BLANK_FIELD:tin', reason: 'x' })).status, 400, 'only the BSO waives');

// 4. BSO asks; approval questions are refused by rule
r = await call('POST', '/api/ask', { id: REF.id, question: 'ano pa kulang?' });
assert(r.body.answer.includes('page 2 of 2'), r.body.answer);
r = await call('POST', '/api/ask', { id: REF.id, question: 'ma-a-approve ba to?' });
assert(r.body.trace[0].rule === 'refuse_credit_question' && /Credit/.test(r.body.answer));

// 5. rescan with TIN and page 2: ready for BSO review, then hand off
const pages2 = [FORM('123-456-789-000', 'Married', 0.95), ID('Elena Santos', 'front'), ID('Elena Santos', 'back'), ID('Ramon Santos', 'front'), DTI(1), DTI(2), COR, PERMIT, BANK, CAL];
r = await call('POST', '/api/check', { id: REF.id, pages: pages2 });
assert.equal(r.body.result.complete, true, JSON.stringify([r.body.result.defects, r.body.result.needsReview]));
assert.equal(r.body.reconcile.resolved, 2);
assert.equal(r.body.status, 'Ready for BSO review');
r = await call('POST', '/api/event', { id: REF.id, type: 'handed_off', by: 'BM' });
assert.equal(r.body.status, 'With BSO');

// 6. an unlabeled page goes to the branch; with a label it is accepted without the model
r = await call('POST', '/api/check', { id: REF.id, pages: [...pages2, { lines: L(['Lorem receipt', 'Item 1', 'Item 2']) }] });
assert(keys(r.body).some((k) => k.startsWith('PAGE_UNPLACED')));
r = await call('POST', '/api/check', { id: REF.id, pages: [...pages2.filter((p) => p !== BANK), { lines: L(['Statement', 'Aug', 'Sep', 'Oct']), docType: 'bank_statements' }] });
assert.equal(r.body.result.complete, true, 'branch label places the page');

// 7. heads-up from a BSO return: only a return drafts one, only a BSO publishes one, and the checklist never changes
const ev = (body) => call('POST', '/api/event', { id: REF.id, ...body });
const lesson = (body) => call('POST', '/api/lesson', body);
assert.equal((await ev({ type: 'returned', by: 'BSO', reason: 'x' })).status, 400, 'a return needs a case that is with the BSO');
assert.equal((await ev({ type: 'handed_off', by: 'BM' })).body.status, 'With BSO');
assert.equal((await ev({ type: 'returned', by: 'BM', reason: 'x' })).status, 400, 'only the BSO returns');
assert.equal((await ev({ type: 'returned', by: 'BSO' })).status, 400, 'a return needs a reason');
r = await ev({ type: 'returned', by: 'BSO', reason: 'The bank statements cover two months, and the BSO needs three.' });
assert.equal(r.body.status, 'Returned by BSO');
assert.equal(r.body.lessonDrafts.length, 1);
assert.equal(r.body.headsUp.length, 0, 'a draft is not shown to branches');
const draft = r.body.lessonDrafts[0];
assert.equal((await ev({ type: 'handed_off', by: 'BM' })).status, 400, 'a returned case needs a new check first');
r = await call('POST', '/api/check', { id: REF.id, pages: pages2 });
assert.equal(r.body.status, 'Ready for BSO review');
const TEXT = 'Check that the bank statements cover the last three months before sending.';
assert.equal((await lesson({ action: 'publish', by: 'BM', lessonId: draft.id, text: TEXT, scope: 'type' })).status, 400, 'only the BSO publishes');
assert.equal((await lesson({ action: 'publish', by: 'BSO', lessonId: draft.id, text: `Elena sent two months only. ${TEXT}`, scope: 'type' })).status, 400, 'client names stay out');
assert.equal((await lesson({ action: 'publish', by: 'BSO', lessonId: draft.id, text: 'Three months of statements gets it approved.', scope: 'type' })).status, 400, 'approval words stay out');
assert.equal((await lesson({ action: 'publish', by: 'BSO', lessonId: draft.id, text: TEXT, scope: 'everyone' })).status, 400, 'scope must be known');
assert.equal((await lesson({ action: 'publish', by: 'BSO', lessonId: draft.id, text: TEXT, scope: 'type' })).status, 200);
const rowsBefore = (await call('GET', `/api/case?id=${REF.id}`)).body.rules.rows;
const other = { ...REF, id: 'RF-2026-043', business: 'Santos Hardware', name: 'Maria Cruz', industry: 'Retail', civilStatus: 'single', spouseName: '' };
r = await call('POST', '/api/case', { referral: other });
assert.equal(r.status, 200, JSON.stringify(r.body));
assert.deepEqual(r.body.headsUp.map((l) => l.text), [TEXT], 'another sole proprietorship sees it');
assert(!/RF-2026-042|Elena|two months/.test(JSON.stringify(r.body.headsUp)), 'no source case and no raw reason');
assert.equal(r.body.status, 'Draft', 'a heads-up does not change the status');
assert.deepEqual((await call('GET', `/api/case?id=${REF.id}`)).body.rules.rows, rowsBefore, 'a heads-up does not change the checklist');
r = await call('POST', '/api/case', { referral: { ...other, id: 'RF-2026-044', type: 'Corporation' } });
assert.equal(r.status, 200, JSON.stringify(r.body));
assert.equal(r.body.headsUp.length, 0, 'a corporation does not see a sole proprietorship heads-up');
assert.equal((await lesson({ action: 'retire', by: 'BSO', lessonId: draft.id })).status, 200);
assert.equal((await call('GET', '/api/case?id=RF-2026-043')).body.headsUp.length, 0, 'a retired heads-up is gone');
assert.equal((await lesson({ action: 'retire', by: 'BSO', lessonId: draft.id })).status, 404);

console.log('free-stack API checks passed');

if (process.env.GEMINI_API_KEY) {
  const { makeGemini } = require('../backend/free/gemini.cjs');
  const g = makeGemini({ apiKey: process.env.GEMINI_API_KEY, model: process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite' });
  const p = await g.readPage({ text: ID('Elena Santos', 'front').lines.map((l) => l.text).join('\n').replace(/1234-5678-9012-3456/, '[ID NUMBER]') });
  console.log('live model read:', JSON.stringify(p));
  console.log('live ask refusal guard and draft:', await g.draftMessage({ items: ['DTI registration: page 2 of 2 is missing.'] }));
}
