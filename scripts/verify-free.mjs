// Free-stack API, end to end on the Elena storyline, with an in-memory store and a fake model.
// Run: node scripts/verify-free.mjs        (add GEMINI_API_KEY=... to also run one live model read)
import assert from 'node:assert/strict';
import { makeApi, openItems, takeQuota, QUOTA } from '../worker/api.mjs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const mem = new Map();
const store = { get: async (id) => (mem.has(id) ? JSON.parse(mem.get(id)) : null), put: async (id, c) => { mem.set(id, JSON.stringify(c)); }, list: async () => [...mem.keys()] };
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
  async intake() { return this.intakeOut; },
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
// no key is needed. A caller without the key is counted, the health route is not, and a caller with the key skips the count.
{
  const asked = [];
  const gate = (out) => makeApi({ store, llm: fakeLlm, demoKey: 'k', limits: async (model) => { asked.push(model); return out; } });
  const get = (api, path, key, method = 'GET', body) => api(new Request(`https://x${path}`, { method, headers: { 'content-type': 'application/json', 'x-demo-key': key }, body: body ? JSON.stringify(body) : undefined }));
  assert.equal((await get(gate('rate'), '/api/case?id=RF-2026-042', '')).status, 429);
  assert.equal((await get(gate('daily'), '/api/intake', 'wrong', 'POST', { text: 'x' })).status, 429);
  assert.equal((await get(gate('rate'), '/api/case?id=RF-2026-042', 'k')).status, 404, 'the key skips the limits');
  assert.equal((await get(gate('rate'), '/api/health', '')).status, 200);
  asked.length = 0; assert.equal((await get(gate('ok'), '/api/intake', '', 'POST', { text: 'Si Elena Santos' })).status, 200);
  await get(gate('ok'), '/api/case?id=RF-2026-042', '');
  assert.deepEqual(asked, [true, false], 'only model routes count toward the model limits');

  const s = {}, t = Date.UTC(2026, 10, 12, 4, 0, 0);
  for (let i = 0; i < QUOTA.modelPerMinute; i++) assert.equal(takeQuota(s, 'a', true, t), 'ok');
  assert.equal(takeQuota(s, 'a', true, t), 'rate');
  assert.equal(takeQuota(s, 'a', false, t), 'ok', 'other routes still pass');
  assert.equal(takeQuota(s, 'b', true, t), 'ok', 'another address has its own minute');
  assert.equal(takeQuota(s, 'a', true, t + 60000), 'ok', 'a new minute clears the count');
  assert.equal(s.n, QUOTA.modelPerMinute + 2);
  s.n = QUOTA.modelPerDay; assert.equal(takeQuota(s, 'c', true, t + 60000), 'daily');
  assert.equal(takeQuota(s, 'c', true, t + 86400000), 'ok', 'a new day clears the cap');
  const all = {}; for (let i = 0; i < QUOTA.perMinute; i++) takeQuota(all, 'a', false, t);
  assert.equal(takeQuota(all, 'a', false, t), 'rate');
}
assert.equal((await call('GET', '/api/case?id=RF-2026-042', null, 'wrong')).status, 404, 'a wrong key is treated as no key');
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

// 10. AWS reader: the Worker sends its own stored referral and the page keys, and keeps the case history
{
  const sent = [];
  let checkStatus = 200, checkBody = null;
  const awsFetch = async (url, init) => {
    const b = JSON.parse(init.body); sent.push({ path: new URL(url).pathname, key: init.headers['x-demo-key'], body: b });
    if (url.endsWith('/upload-url')) return Response.json({ url: 'https://bucket.example/', fields: { key: `uploads/${b.referralId}/${b.name}` }, key: `uploads/${b.referralId}/${b.name}`, contentType: 'image/jpeg' });
    return Response.json(checkBody, { status: checkStatus });
  };
  const api2 = makeApi({ store, llm: fakeLlm, now: () => new Date('2026-11-05T04:00:00Z'), demoKey: 'k', aws: { url: 'https://aws.example', key: 'aws-key', fetch: awsFetch } });
  const call2 = async (path, body, a = api2) => { const x = await a(new Request(`https://x${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-demo-key': 'k' }, body: JSON.stringify(body) })); return { status: x.status, body: await x.json() }; };
  const R2 = { ...REF, id: 'RF-2026-777' };
  assert.equal((await call2('/api/upload-url', { id: R2.id, name: 'page-1.jpg' })).status, 404, 'an upload needs a saved case');
  assert.equal((await call('POST', '/api/case', { referral: R2 })).status, 200);
  assert.equal((await call2('/api/upload-url', { id: R2.id, name: 'page-1.jpg' }, api)).status, 503, 'no AWS backend on this deployment');
  let u = await call2('/api/upload-url', { id: R2.id, name: 'page-1.jpg' });
  assert.equal(u.status, 200); assert.equal(u.body.key, `uploads/${R2.id}/page-1.jpg`);
  assert.equal(sent.at(-1).key, 'aws-key', 'the Worker adds the key, the browser never holds the AWS one');
  for (const bad of [[], ['uploads/RF-2026-042/page-1.jpg'], [`uploads/${R2.id}/../x.jpg`], [7]]) assert.equal((await call2('/api/check', { id: R2.id, pageKeys: bad })).status, 400, JSON.stringify(bad));
  const tin = { key: 'BLANK_FIELD:tin', code: 'BLANK_FIELD', message: 'Application form: TIN is blank.' };
  const unread = { key: 'FIELD_UNREADABLE:application_form:contact', code: 'FIELD_UNREADABLE', message: 'Application form: contact has marks that could not be read. Please check the paper form.' };
  checkBody = { result: { defects: [tin], needsReview: [unread], complete: true }, trace: [{ page: 1, docType: 'application_form' }], model: 'bedrock-model', message: 'This is approved.', drafted: 'model' };
  let k = await call2('/api/check', { id: R2.id, pageKeys: [u.body.key] });
  assert.equal(k.status, 200, JSON.stringify(k.body));
  assert.deepEqual(sent.at(-1).body.referral, R2, 'the stored referral goes to AWS, not one from the browser');
  assert.equal(k.body.result.complete, false, 'complete is recomputed here');
  assert.equal(k.body.status, 'Missing requirements'); assert.equal(k.body.stack, 'aws'); assert.equal(k.body.model, 'bedrock-model');
  assert.equal(k.body.drafted, 'template', 'a draft that sounds like approval is discarded'); assert(!/approved/i.test(k.body.message));
  checkBody = { result: { defects: [], needsReview: [] }, trace: [], message: 'Kumpleto na po ang mga papeles para sa review.', drafted: 'model' };
  k = await call2('/api/check', { id: R2.id, pageKeys: [u.body.key] });
  assert.equal(k.body.status, 'Ready for BSO review'); assert.equal(k.body.reconcile.resolved, 1);
  checkBody = { message: 'Service Unavailable' }; checkStatus = 503;
  const before = sent.length; k = await call2('/api/check', { id: R2.id, pageKeys: [u.body.key] });
  assert.equal(k.status, 502); assert.equal(sent.length - before, 2, 'one retry on 503');
  checkStatus = 200; checkBody = { result: { defects: 'none' } };
  assert.equal((await call2('/api/check', { id: R2.id, pageKeys: [u.body.key] })).status, 502, 'a malformed result never passes');
  assert.equal((await call('GET', `/api/case?id=${R2.id}`)).body.status, 'Ready for BSO review', 'failed calls leave the case as it was');
  const urls = [];
  const api4 = makeApi({ store, llm: fakeLlm, demoKey: 'k', aws: { url: 'https://aws.example', key: 'aws-key', checkUrl: 'https://fn.example/', fetch: async (url, init) => { urls.push(url); return awsFetch(url, init); } } });
  checkBody = { result: { defects: [], needsReview: [] }, trace: [] };
  await call2('/api/check', { id: R2.id, pageKeys: [u.body.key] }, api4); await call2('/api/upload-url', { id: R2.id, name: 'page-1.jpg' }, api4);
  assert.deepEqual(urls, ['https://fn.example/', 'https://aws.example/upload-url'], 'only the check goes to the function URL');
}

{ // 11. note intake: the model fills fields, and the rules keep only what the note supports
  const note = 'Si Elena Santos, may-ari ng Elena Artisan Bakery, sole prop, food. 750k ang loan, married kay Ramon Santos, may BPI account.';
  fakeLlm.intakeOut = { business: 'Elena Artisan Bakery', name: 'Elena Santos', spouseName: 'Ramon Cruz', type: 'Sole proprietorship', industry: 'Mining', amount: 750000.4, civilStatus: 'married', secured: 'no', bpiAccount: true, approved: true };
  let r = await call('POST', '/api/intake', { text: note });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.fields, { business: 'Elena Artisan Bakery', name: 'Elena Santos', type: 'Sole proprietorship', civilStatus: 'married', amount: 750000, bpiAccount: true }, 'a name not in the note, an unknown industry and a non-boolean are dropped');
  assert.equal((await call('POST', '/api/intake', { text: 'x'.repeat(1001) })).status, 400);
  assert.equal((await call('POST', '/api/intake', { text: note, stack: 'aws' })).status, 503, 'no AWS backend on this deployment');
  fakeLlm.intakeOut = { secured: false, bpiAccount: false }; assert.deepEqual((await call('POST', '/api/intake', { text: 'Si Elena Santos, sole prop, 750k' })).body.fields, {}, 'a box the note never mentions stays as it was');
  fakeLlm.intakeOut = null; assert.deepEqual((await call('POST', '/api/intake', { text: note })).body.fields, {});
  const sent = [];
  const awsFetch = async (url, init) => { sent.push({ url, key: init.headers['x-demo-key'], body: JSON.parse(init.body) }); return Response.json({ fields: { name: 'Elena Santos', spouseName: 'Somebody Else', amount: -5 }, model: 'bedrock-model' }); };
  const api3 = makeApi({ store, llm: fakeLlm, demoKey: 'k', aws: { url: 'https://aws.example', key: 'aws-key', fetch: awsFetch } });
  const x = await api3(new Request('https://x/api/intake', { method: 'POST', headers: { 'content-type': 'application/json', 'x-demo-key': 'k' }, body: JSON.stringify({ text: note, stack: 'aws' }) }));
  const xb = await x.json();
  assert.deepEqual(xb.fields, { name: 'Elena Santos' }, 'fields from AWS pass the same rules');
  assert.equal(xb.model, 'bedrock-model'); assert.equal(sent[0].url, 'https://aws.example/ask'); assert.equal(sent[0].key, 'aws-key'); assert.equal(sent[0].body.intake, note);
  assert.equal(mem.has('RF-2026-778'), false, 'the intake saves nothing');
}

{ // 12. the BSO's list shows every case with its status, and no heads-up record
  const r = await call('GET', '/api/cases');
  assert.equal(r.status, 200);
  assert.ok(r.body.cases.length >= 1 && r.body.cases.every((c) => /^RF-\d{4}-\d{3}$/.test(c.id) && typeof c.status === 'string' && Number.isInteger(c.open)), JSON.stringify(r.body));
  const elena = r.body.cases.find((c) => c.id === 'RF-2026-042');
  assert.ok(elena && elena.business === REF.business);
}

console.log('free-stack API checks passed');

if (process.env.GEMINI_API_KEY) {
  const { makeGemini } = require('../backend/free/gemini.cjs');
  const g = makeGemini({ apiKey: process.env.GEMINI_API_KEY, model: process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite' });
  const p = await g.readPage({ text: ID('Elena Santos', 'front').lines.map((l) => l.text).join('\n').replace(/1234-5678-9012-3456/, '[ID NUMBER]') });
  console.log('live model read:', JSON.stringify(p));
  console.log('live ask refusal guard and draft:', await g.draftMessage({ items: ['DTI registration: page 2 of 2 is missing.'] }));
}
