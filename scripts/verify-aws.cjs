'use strict';
// Offline tests for the AWS layer using fakes. Proves wiring, validation and guardrails, NOT Textract or model accuracy.
// Run: node scripts/verify-aws.cjs  (needs: cd backend && npm install, for the SDK command classes)
const assert = require('node:assert/strict');
const { processPacket } = require('../backend/pipeline.cjs');
const { makeHandlers, validKey } = require('../backend/handler.cjs');
const llm = require('../backend/aws/llm.cjs');
const textract = require('../backend/aws/textract.cjs');
const { classify } = require('../backend/classify.cjs');

const REF = { id: 'RF-2026-050', business: 'Lim Prints', name: 'David Lim', type: 'Sole proprietorship', industry: 'Services', amount: 500000, bpiAccount: true };
const TODAY = new Date('2026-11-04T04:00:00Z');

// fake pages: bytes carry a tag. OCR lines, Forms output and model output are looked up by tag.
const FORM_KV = { 'business name': { value: 'Lim Prints', conf: 0.99 }, 'name of applicant': { value: 'David Lim', conf: 0.99 }, address: { value: '1 Main St', conf: 0.98 }, tin: { value: '123-456-789', conf: 0.97 }, 'contact number': { value: '0917 000 0000', conf: 0.97 }, signature: { value: 'signed', conf: 0.9 }, 'civil status': { value: 'single', conf: 0.95 } };
const DOCS = {
  form: { lines: ['LOAN APPLICATION FORM', 'Page 1 of 1', 'Business name Lim Prints'], kv: FORM_KV },
  idf: { lines: ['REPUBLIC OF THE PHILIPPINES', 'UMID', 'Name David Lim', 'Valid until 2030-01-31'], model: { docType: 'gov_id', fields: { owner_name: 'David Lim' }, conf: { owner_name: 0.95 }, side: 'front', expiry: '2030-01-31' } },
  idb: { lines: ['REPUBLIC OF THE PHILIPPINES', 'UMID back', 'Signature strip'], model: { docType: 'gov_id', fields: {}, conf: {}, side: 'back' } },
  reg: { lines: ['Department of Trade and Industry', 'Certificate of Registration', 'Owner David Lim Business Lim Prints'], model: { docType: 'registration', fields: { owner_name: 'David Lim', business_name: 'Lim Prints' }, conf: { owner_name: 0.95, business_name: 0.95 } } },
  permit: { lines: ["Mayor's Permit", 'Business name Lim Prints', 'Valid until March 31, 2027'], model: { docType: 'business_permit', fields: { business_name: 'Lim Prints' }, conf: { business_name: 0.95 }, expiry: '2027-03-31' } },
  fin: { lines: ['Statement of Financial Position', 'As of December 31 2025', 'Total assets'] },
  bank: { lines: ['Bank Statement', 'Account number ending 1234', 'Period covered'] },
  cor: { lines: ['Republic of the Philippines', 'Bureau of Internal Revenue', 'Certificate of Registration', 'BIR Form No. 2303'] },
  cal: { lines: ['CLIENT AUTHORIZATION LETTER', 'I authorize BPI to verify', 'Signed David Lim'] },
  itr: { lines: ['Annual Income Tax Return', 'BIR Form No. 1701', 'Taxable year 2025'] },
  blur: { lines: ['xx ##', 'xx', 'xx'], model: { unreadable: true, docType: null } },
  thin: { lines: ['UMID'] },
  // hostile: the model claims things that are not on the page
  liar: { lines: ["Mayor's Permit", 'Business name Lim Prints', 'Valid until March 31, 2027'], model: { docType: 'business_permit', fields: { business_name: 'Lim Prints' }, conf: { business_name: 0.95 }, expiry: '2099-12-31' } },
  liarName: { lines: ['REPUBLIC OF THE PHILIPPINES', 'UMID', 'Name David Lim'], model: { docType: 'gov_id', fields: { owner_name: 'Totally Other Person' }, conf: { owner_name: 0.95 }, side: 'front', expiry: '2030-01-31' } },
};
const page = (tag) => ({ bytes: Buffer.from(tag), mediaType: 'image/jpeg' });
const calls = { forms: 0, model: 0 };
const deps = {
  detectLines: async (b) => DOCS[b.toString()].lines.map((text) => ({ text, conf: 0.99 })),
  analyzeForm: async (b) => { calls.forms++; return DOCS[b.toString()].kv; },
  readPage: async ({ bytes }) => { calls.model++; return DOCS[bytes.toString()].model || { unreadable: true }; },
};
const GOOD = ['form', 'idf', 'idb', 'reg', 'cor', 'permit', 'bank', 'cal'];

(async () => {
  // ---- pipeline: complete packet, cost-sensitive routing ----
  let out = await processPacket(REF, GOOD.map(page), deps, { today: TODAY });
  assert.deepEqual(out.result.defects, [], JSON.stringify(out.result.defects));
  assert.deepEqual(out.result.needsReview, [], JSON.stringify(out.result.needsReview));
  assert(out.result.complete);
  assert.equal(calls.forms, 1, 'Forms (the expensive pass) runs only on the form page');
  assert.equal(calls.model, 4, 'model reads only id front, id back, registration, permit');

  // ---- pipeline: missing CAL plus an unreadable page never completes ----
  out = await processPacket(REF, ['form', 'idf', 'idb', 'reg', 'cor', 'permit', 'bank', 'blur'].map(page), deps, { today: TODAY });
  assert(out.result.defects.some((d) => d.key === 'MISSING_DOC:cal_sole'));
  assert(out.result.needsReview.some((d) => d.key.startsWith('PAGE_UNPLACED')), 'an unplaced page goes to the branch, not the model');
  assert(!out.result.complete);

  // ---- pipeline: a page with only a title is not trusted ----
  out = await processPacket(REF, ['form', 'thin', 'idb', 'reg', 'cor', 'permit', 'bank', 'cal'].map(page), deps, { today: TODAY });
  assert(out.result.needsReview.some((d) => d.key.startsWith('PAGE_THIN')) && !out.result.complete);

  // ---- pipeline: model output must be visible in the page text (prompt injection guard) ----
  out = await processPacket(REF, ['form', 'idf', 'idb', 'reg', 'liar', 'itr', 'fin', 'bank'].map(page), deps, { today: TODAY });
  assert(out.result.needsReview.some((d) => d.key.includes('MODEL_UNGROUNDED') && d.key.endsWith('expiry')), 'invented expiry date is rejected');
  assert(!out.result.complete);
  out = await processPacket(REF, ['form', 'liarName', 'idb', 'reg', 'permit', 'itr', 'fin', 'bank'].map(page), deps, { today: TODAY });
  assert(out.result.needsReview.some((d) => d.key.includes('MODEL_UNGROUNDED') && d.key.endsWith('owner_name')), 'invented name is rejected');
  assert(!out.result.complete);

  // ---- OCR page numbers: huge totals are clamped, not looped over ----
  const huge = { ...DOCS, form: { ...DOCS.form, lines: ['LOAN APPLICATION FORM', 'Page 1 of 99999999', 'Business name Lim Prints'] } };
  const d2 = { ...deps, detectLines: async (b) => huge[b.toString()].lines.map((text) => ({ text, conf: 0.99 })) };
  const t0 = Date.now(); out = await processPacket(REF, GOOD.map(page), d2, { today: TODAY });
  assert(Date.now() - t0 < 500 && !out.result.complete, 'page total 99999999 is flagged quickly');

  // ---- classifier ----
  assert.equal(classify([{ text: 'AUDITED FINANCIAL STATEMENTS 2025' }]).docType, 'audited_fs');
  assert.equal(classify([{ text: 'random receipt' }]).docType, null);

  // ---- handler: validation, trust boundary, reconcile across calls, status ----
  const events = [];
  const KEY = 'demo-key-0123456789abcdefghij';
  const hdeps = {
    demoKey: KEY,
    ...deps,
    loadPage: async (k) => page(k.split('/').pop()),
    store: {
      events: async () => events,
      lastOpen: async () => { const l = [...events].reverse().find((e) => e.defects); return { defects: l ? l.defects : [], needsReview: l ? l.needsReview : [] }; },
      record: async (id, ev) => { events.push(ev); },
    },
    draftMessage: async () => { throw new Error('model down'); }, // must fall back to the template
    ask: async (q, h) => ({ answer: JSON.stringify(await h.get_status({ referralId: 'RF-2026-050' })) }),
  };
  const H = makeHandlers(hdeps);
  const ev = (b, key = KEY) => ({ headers: { 'x-demo-key': key }, body: typeof b === 'string' ? b : JSON.stringify(b) });
  const keys = (tags, id = REF.id) => tags.map((k) => `uploads/${id}/${k}`);
  assert.equal((await H.check(ev('{bad'))).statusCode, 400);
  { // a photo of the application form fills case fields, and other pages are skipped
    const H5 = makeHandlers({ ...hdeps, detectLines: async (b) => [{ text: b.toString() === 'form' ? 'BUSINESS LOAN APPLICATION FORM' : 'Some receipt' }], analyzeForm: async () => ({ 'registered business name (trade name)': { value: 'ABC STORE', conf: 0.9 }, 'sole-proprietorship': { value: 'SELECTED', conf: 0.9 } }), intake: async (note) => ({ business: 'ABC STORE', type: 'Sole proprietorship', name: 'Not In Note' }) });
    const b64 = (t) => Buffer.from(t).toString('base64');
    const r = JSON.parse((await H5.check(ev({ formImages: [b64('form'), b64('other')] }))).body);
    assert.equal(r.found, 1); assert.deepEqual(r.fields, { business: 'ABC STORE', type: 'Sole proprietorship' }, 'cleanIntake drops a name the form did not have');
    assert.deepEqual(JSON.parse((await H5.check(ev({ formImages: [b64('other')] }))).body).fields, {});
    assert.equal((await H5.check(ev({ formImages: [] }))).statusCode, 400);
    assert.equal((await H5.check(ev({ formImages: [b64('form')] }, 'wrong'))).statusCode, 401, 'form reading needs the key'); }
  assert.equal((await H.check(ev({ referral: { ...REF, id: 'x' }, pageKeys: keys(['a']) }))).statusCode, 400, 'referral id format');
  for (const bad of [{ amount: -5 }, { amount: '500000' }, { amount: null }, { amount: 0 }, { industry: '' }, { name: '' }, { type: 'Cooperative' }]) assert.equal((await H.check(ev({ referral: { ...REF, ...bad }, pageKeys: keys(['form']) }))).statusCode, 400, `referral ${JSON.stringify(bad)}`);
  assert.equal((await H.check(ev({ referral: REF, pageKeys: ['uploads/../secret'] }))).statusCode, 400, 'path traversal');
  assert.equal((await H.check(ev({ referral: REF, pageKeys: ['other/a'] }))).statusCode, 400, 'prefix enforced');
  assert.equal((await H.check(ev({ referral: REF, pageKeys: keys(['form'], 'RF-2026-999') }))).statusCode, 400, 'keys must belong to this referral (no cross-case reads)');
  assert.equal((await H.check(ev({ referral: REF, pageKeys: keys(Array(21).fill('a')) }))).statusCode, 400, 'page cap');

  let r = JSON.parse((await H.check(ev({ referral: REF, pageKeys: keys(['form', 'idf', 'idb', 'reg', 'permit', 'cor', 'bank']) }))).body);
  assert(r.result.defects.some((d) => d.key === 'MISSING_DOC:cal_sole'));
  assert.equal(r.status, 'Missing requirements');
  assert(r.message.includes('Client Authorization Letter'), 'template fallback used when the model is down');
  r = JSON.parse((await H.check(ev({ referral: REF, pageKeys: keys(['form', 'idf', 'idb', 'reg', 'permit', 'cor', 'bank', 'cal']) }))).body);
  assert(r.reconcile.resolved.some((d) => d.key === 'MISSING_DOC:cal_sole'));
  assert.equal(r.status, 'Draft');
  assert(r.result.complete === false || r.result.needsReview.length === 0);
  assert.equal(JSON.parse((await H.ask(ev({ referralId: 'RF-2026-050', question: 'status?' }))).body).answer.includes('Draft'), true);
  assert.equal((await H.ask(ev({ question: 'status?' }))).statusCode, 400, 'ask needs a referralId');
  assert.equal((await H.ask(ev({ referralId: 'RF-2026-050', question: 'x'.repeat(501) }))).statusCode, 400);

  // ---- /ask with facts from the Worker answers from those facts and the rules table ----
  { let h; const H4 = makeHandlers({ ...hdeps, askCase: async (q, x) => { h = x; return { answer: 'ok', trace: [] }; } });
    const r = await H4.ask(ev({ question: 'ano status?', facts: { status: { status: 'With BSO' } } }));
    assert.equal(r.statusCode, 200);
    assert.equal((await h.get_status()).status, 'With BSO');
    assert.ok((await h.get_requirements({ type: 'Corporation' })).requirements.length > 3);
    assert.equal((await H4.ask(ev({ question: '', facts: {} }))).statusCode, 400); }
  // ---- /ask tools are bound to one referral (no IDOR through the model) ----
  let captured; const H2 = makeHandlers({ ...hdeps, ask: async (q, h) => { captured = h; return { answer: 'ok' }; } });
  await H2.ask(ev({ referralId: 'RF-2026-050', question: 'status?' }));
  await assert.rejects(captured.get_status({ referralId: 'RF-2026-051' }), /not allowed/, 'tool refuses another referral');
  assert.deepEqual(await captured.get_status({ referralId: 'RF-2026-050' }).then((x) => x.referralId), 'RF-2026-050');
  const H3 = makeHandlers({ ...hdeps, store: { ...hdeps.store, events: async () => [] }, ask: async (q, h) => { captured = h; return { answer: 'ok' }; } });
  await H3.ask(ev({ referralId: 'RF-2026-060', question: 'lacking?' }));
  assert.equal((await captured.get_lacking({ referralId: 'RF-2026-060' })).known, false, 'an unknown referral is "unknown", not "nothing lacking"');

  // ---- /ask { intake }: case fields from a note, kept only when the rules allow them ----
  const H5 = makeHandlers({ ...hdeps, intake: async () => ({ name: 'Elena Santos', business: 'Not In Note Inc', type: 'Corporation', amount: 750000 }) });
  const filled = await H5.ask(ev({ intake: 'Si Elena Santos, corporation, 750k ang loan' }));
  assert.equal(filled.statusCode, 200);
  assert.deepEqual(JSON.parse(filled.body).fields, { name: 'Elena Santos', type: 'Corporation', amount: 750000 }, 'a name that is not in the note is dropped');
  assert.equal((await H5.ask(ev({ intake: 'x'.repeat(1001) }))).statusCode, 400);
  assert.equal((await H5.ask(ev({ intake: 'note' }, 'wrong'))).statusCode, 401);

  // ---- /upload-url: presigned POST for uploads/{referralId}/{safe name}, fake presigner ----
  let signed;
  const H4 = makeHandlers({ ...hdeps, presignUpload: async (o) => { signed = o; return { url: 'https://bucket.example', fields: { key: o.key } }; } });
  const up = async (b) => { signed = null; const res = await H4.uploadUrl(ev(b)); return { code: res.statusCode, body: JSON.parse(res.body) }; };
  let u = await up({ referralId: 'RF-2026-050', name: '../../etc/My Scan (1).PNG' });
  assert.equal(u.code, 200);
  assert.equal(u.body.key, 'uploads/RF-2026-050/My-Scan-1-.PNG', 'path parts dropped, unsafe characters replaced');
  assert.deepEqual(signed, { key: u.body.key, contentType: 'image/png', maxBytes: 5 * 1024 * 1024, expiresIn: 300 });
  assert.deepEqual(u.body.fields, { key: u.body.key });
  assert(validKey('RF-2026-050', u.body.key), 'an issued key is a valid /check page key');
  assert.equal((await up({ referralId: 'RF-2026-050', name: 'id.jpeg' })).body.contentType, 'image/jpeg');
  assert.equal((await up({ referralId: 'RF-2026-050', name: 'dti.pdf' })).body.contentType, 'application/pdf');
  for (const id of ['RF-2026-05', 'rf-2026-050', '../RF-2026-050', 'RF-2026-050/x', 42, null]) assert.equal((await up({ referralId: id, name: 'a.png' })).code, 400, `referralId ${id}`);
  for (const name of ['a.exe', 'a.svg', 'a.png.html', '.png', '', 'noext', 'x'.repeat(200) + '.png', 5, null]) assert.equal((await up({ referralId: 'RF-2026-050', name })).code, 400, `name ${name}`);
  assert.equal(signed, null, 'nothing is signed for a rejected request');
  assert.equal((await H4.uploadUrl(ev('{bad'))).statusCode, 400);

  // ---- demo key: every route answers 401 without the right x-demo-key, before any work is done ----
  const touched = []; const spy = makeHandlers({ ...hdeps, loadPage: async (k) => { touched.push(k); return page('form'); }, presignUpload: async () => { touched.push('sign'); return {}; }, ask: async () => { touched.push('ask'); return {}; } });
  const okBodies = { check: { referral: REF, pageKeys: keys(['form']) }, ask: { referralId: REF.id, question: 'status?' }, uploadUrl: { referralId: REF.id, name: 'a.png' } };
  for (const [route, body] of Object.entries(okBodies)) {
    for (const key of [null, '', 'wrong', KEY.slice(0, -1), KEY + 'x', KEY.toUpperCase()]) assert.equal((await spy[route](ev(body, key))).statusCode, 401, `${route} key ${key}`);
    assert.equal((await spy[route]({ body: JSON.stringify(body) })).statusCode, 401, `${route} without headers`);
    assert.equal((await spy[route]({ headers: { 'x-demo-key': [KEY] }, body: JSON.stringify(body) })).statusCode, 401, `${route} non-string key`);
  }
  assert.deepEqual(touched, [], 'nothing runs before the key check');
  for (const [route, body] of Object.entries(okBodies)) assert.equal((await spy[route](ev(body))).statusCode, 200, `${route} with the key`);
  const noKey = makeHandlers({ ...hdeps, demoKey: undefined });
  for (const key of [null, '', 'undefined']) assert.equal((await noKey.check(ev(okBodies.check, key))).statusCode, 401, 'no configured key fails closed');
  assert.equal((await makeHandlers({ ...hdeps, demoKey: '' }).ask(ev(okBodies.ask, ''))).statusCode, 401, 'an empty configured key fails closed');

  // ---- llm.takeUsage: counts tokens per call and clears on read ----
  llm.takeUsage();
  const billed = { messages: { create: async () => ({ content: [{ type: 'text', text: 'ok po' }], usage: { input_tokens: 120, output_tokens: 30 } }) } };
  await llm.draftMessage({ items: ['x'] }, billed); await llm.draftMessage({ items: ['x'] }, billed);
  assert.deepEqual(llm.takeUsage(), { modelCalls: 2, inputTokens: 240, outputTokens: 60 });
  assert.deepEqual(llm.takeUsage(), { modelCalls: 0, inputTokens: 0, outputTokens: 0 });
  // ---- llm.readPage validation ----
  const fake = (text, extra = {}) => ({ messages: { create: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text }], ...extra }) } });
  { // the match step sends the note, the date and the page text, and asks for the schema
    let sent; const spy = { messages: { create: async (req) => { sent = req; return { content: [{ type: 'text', text: '{"verdict":"found","page":2,"why":"Page 2 is the statement."}' }] }; } } };
    const m = await llm.matchRequest({ request: 'Three months of bank statements', today: '2026-11-15', pages: [{ page: 1, text: 'FORM' }, { page: 2, text: 'BANK STATEMENT' }] }, spy);
    assert.equal(m.verdict, 'found'); assert.equal(sent.output_config.format.schema.properties.verdict.enum.length, 3);
    assert(/Three months/.test(sent.messages[0].content) && /--- Page 2 ---/.test(sent.messages[0].content) && /2026-11-15/.test(sent.messages[0].content));
  }
  { // the handler passes the BSO note to the pipeline
    const seenReq = [];
    const h = makeHandlers({ ...hdeps, matchRequest: async (i) => { seenReq.push(i.request); return { verdict: 'missing', page: null, why: 'none' }; } });
    const r = await h.check(ev({ ...okBodies.check, request: "Latest ITR" }));
    assert.equal(r.statusCode, 200, r.body); assert.deepEqual(seenReq, ['Latest ITR']);
    assert(JSON.parse(r.body).result.defects.some((d) => d.key === 'BSO_REQUEST'));
  }
  { // an empty intake answer is asked once more
    const outs = ['{}', '{"amount":5}', '{}', '{}'], seen = [];
    const seq = { messages: { create: async () => { seen.push(1); return { content: [{ type: 'text', text: outs.shift() }] }; } } };
    assert.deepEqual(await llm.intake('5 pesos', seq), { amount: 5 });
    assert.deepEqual(await llm.intake('nothing here', seq), {}); assert.equal(seen.length, 4, 'at most one retry');
  }
  let p = await llm.readPage({ bytes: Buffer.from('x') }, fake(JSON.stringify({ docType: 'root_access', legibility: 'clear', owner_name: 'A', expiry: '2026-13-45', admin: true })));
  assert.equal(p.docType, null); assert.equal(p.expiry, undefined, 'impossible calendar date rejected'); assert.equal(p.admin, undefined);
  p = await llm.readPage({ bytes: Buffer.from('x') }, fake('not json')); assert(p.unreadable);
  { // the reader gets the masked OCR text and never the photo
    let sent; const spy = { messages: { create: async (req) => { sent = req; return { stop_reason: 'end_turn', content: [{ type: 'text', text: '{}' }] }; } } };
    await llm.readPage({ bytes: Buffer.from('photo'), text: 'ELENA SANTOS [ID NUMBER]' }, spy);
    assert.equal(typeof sent.messages[0].content, 'string', 'no image block');
    assert.match(sent.messages[0].content, /\[ID NUMBER\]/);
  }
  p = await llm.readPage({ bytes: Buffer.from('x') }, fake(JSON.stringify({ docType: 'business_permit', legibility: 'unclear', business_name: 'Lim Prints', expiry: '2027-01-01' })));
  assert.equal(p.conf.business_name, 0.6, 'unclear reads get low confidence');

  // ---- draft guard: a model draft that sounds like approval is never used ----
  const items = ['Financial statements are missing.'];
  assert.equal(llm.safeDraft('Complete na po ang requirements ninyo! Approved na.', items), null);
  assert.equal(llm.safeDraft('Okay na po, good to go.', items), null);
  assert.equal(llm.safeDraft('', items), null);
  assert.equal(llm.safeDraft('x'.repeat(701), items), null);
  assert(llm.safeDraft('Pakisubmit po ang financial statements. Salamat!', items));
  const approvals = makeHandlers({ ...hdeps, draftMessage: async () => llm.safeDraft('Approved na po!', ['x']) });
  const r2 = JSON.parse((await approvals.check(ev({ referral: { ...REF, id: 'RF-2026-070' }, pageKeys: keys(['form', 'idf', 'idb', 'reg', 'permit', 'cor', 'bank'], 'RF-2026-070') }))).body);
  assert(r2.message.includes('Client Authorization Letter'), 'unsafe model draft falls back to the template');

  // ---- llm.ask: tool loop, parallel results in one message, error marking, refusal, turn cap ----
  const sent = []; let n = 0;
  const loop = { messages: { create: async (req) => { sent.push(JSON.parse(JSON.stringify(req.messages))); n++;
    if (n === 1) return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'get_status', input: { referralId: 'RF-2026-050' } }, { type: 'tool_use', id: 't2', name: 'nope', input: {} }] };
    return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Draft pa.' }] }; } } };
  const a = await llm.ask('status RF-2026-050?', { get_status: async () => ({ status: 'Draft' }) }, loop);
  assert.equal(a.answer, 'Draft pa.');
  const resultsMsg = sent[1].at(-1);
  assert.equal(resultsMsg.role, 'user'); assert.equal(resultsMsg.content.length, 2); assert(resultsMsg.content[1].is_error);
  assert((await llm.ask('q', {}, fake('', { stop_reason: 'refusal' }))).handoff);
  let m = 0; const forever = { messages: { create: async () => { m++; return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'x', name: 'get_status', input: { referralId: 'a' } }] }; } } };
  assert((await llm.ask('q', { get_status: async () => ({}) }, forever, 3)).handoff && m === 3, 'turn cap');
  let req; await llm.draftMessage({ items }, { messages: { create: async (r) => { req = r; return { content: [{ type: 'text', text: 'ok po' }] }; } } });
  for (const k of ['temperature', 'top_p', 'top_k', 'thinking', 'tool_choice']) assert(!(k in req), `${k} must not be sent to Haiku 5.5`);
  assert.equal(req.messages.at(-1).role, 'user', 'no assistant prefill');

  // ---- textract.analyzeForm parsing ----
  const blocks = [
    { Id: 'w1', BlockType: 'WORD', Text: 'TIN' }, { Id: 'w2', BlockType: 'WORD', Text: 'Signature' }, { Id: 'w3', BlockType: 'WORD', Text: '123' }, { Id: 'w4', BlockType: 'WORD', Text: 'TIN' },
    { Id: 'k1', BlockType: 'KEY_VALUE_SET', EntityTypes: ['KEY'], Confidence: 99, Relationships: [{ Type: 'CHILD', Ids: ['w1'] }, { Type: 'VALUE', Ids: ['v1'] }] },
    { Id: 'v1', BlockType: 'KEY_VALUE_SET', EntityTypes: ['VALUE'], Confidence: 91, Relationships: [{ Type: 'CHILD', Ids: ['w3'] }] },
    { Id: 'k2', BlockType: 'KEY_VALUE_SET', EntityTypes: ['KEY'], Confidence: 95, Relationships: [{ Type: 'CHILD', Ids: ['w2'] }] },
    { Id: 'k3', BlockType: 'KEY_VALUE_SET', EntityTypes: ['KEY'], Confidence: 95, Relationships: [{ Type: 'CHILD', Ids: ['w4'] }] }, // duplicate label, empty
  ];
  const kv = await textract.analyzeForm(Buffer.from('x'), { send: async () => ({ Blocks: blocks }) });
  assert.deepEqual(kv.tin, { value: '123', conf: 0.91 }, 'a later empty duplicate does not overwrite a filled value');
  assert.equal(kv.signature.value, '', 'missing value block is a blank field');
  const box = [
    { Id: 'w5', BlockType: 'WORD', Text: 'Married' }, { Id: 's1', BlockType: 'SELECTION_ELEMENT', SelectionStatus: 'SELECTED' },
    { Id: 'w6', BlockType: 'WORD', Text: '(First' }, { Id: 'w7', BlockType: 'WORD', Text: 'Name)' }, { Id: 'w8', BlockType: 'WORD', Text: 'ANA' }, { Id: 'w9', BlockType: 'WORD', Text: 'BEN' },
    { Id: 'k4', BlockType: 'KEY_VALUE_SET', EntityTypes: ['KEY'], Confidence: 90, Relationships: [{ Type: 'CHILD', Ids: ['w5'] }, { Type: 'VALUE', Ids: ['v4'] }] },
    { Id: 'v4', BlockType: 'KEY_VALUE_SET', EntityTypes: ['VALUE'], Confidence: 88, Relationships: [{ Type: 'CHILD', Ids: ['s1'] }] },
    { Id: 'k6', BlockType: 'KEY_VALUE_SET', EntityTypes: ['KEY'], Confidence: 90, Geometry: { BoundingBox: { Top: 0.3 } }, Relationships: [{ Type: 'CHILD', Ids: ['w6', 'w7'] }, { Type: 'VALUE', Ids: ['v6'] }] },
    { Id: 'v6', BlockType: 'KEY_VALUE_SET', EntityTypes: ['VALUE'], Confidence: 90, Relationships: [{ Type: 'CHILD', Ids: ['w9'] }] },
    { Id: 'k5', BlockType: 'KEY_VALUE_SET', EntityTypes: ['KEY'], Confidence: 90, Geometry: { BoundingBox: { Top: 0.1 } }, Relationships: [{ Type: 'CHILD', Ids: ['w6', 'w7'] }, { Type: 'VALUE', Ids: ['v5'] }] },
    { Id: 'v5', BlockType: 'KEY_VALUE_SET', EntityTypes: ['VALUE'], Confidence: 90, Relationships: [{ Type: 'CHILD', Ids: ['w8'] }] },
  ];
  const kv2 = await textract.analyzeForm(Buffer.from('x'), { send: async () => ({ Blocks: box }) });
  assert.equal(kv2.married.value, 'SELECTED', 'a ticked box reads as SELECTED');
  assert.equal(kv2['(first name)'].value, 'ANA', 'the higher repeated label comes first'); assert.equal(kv2['(first name) #2'].value, 'BEN');

  // ---- stored defect items must marshal for DynamoDB (it rejected undefined values by default) ----
  const { marshall } = require('../backend/node_modules/@aws-sdk/util-dynamodb');
  const bad = await processPacket(REF, ['form', 'liarName', 'idb', 'reg', 'permit', 'itr', 'fin', 'bank'].map(page), deps, { today: TODAY });
  assert.doesNotThrow(() => marshall({ defects: bad.result.defects, needsReview: bad.result.needsReview }), 'events marshal without removeUndefinedValues');

  const { AnthropicBedrock } = await import('../backend/node_modules/@anthropic-ai/bedrock-sdk/index.mjs');
  assert.equal(typeof new AnthropicBedrock({ awsRegion: 'ap-southeast-1' }).messages.create, 'function');

  // ---- the real presigner (local signing only, dummy credentials, no network): the POST policy caps size and type ----
  Object.assign(process.env, { AWS_REGION: 'ap-southeast-1', AWS_ACCESS_KEY_ID: 'AKIDEXAMPLE', AWS_SECRET_ACCESS_KEY: 'dummy', UPLOAD_BUCKET: 'test-bucket', EVENTS_TABLE: 't', DEMO_KEY: KEY });
  const lambda = require('../backend/lambda.cjs');
  const res = await lambda.uploadUrl(ev({ referralId: 'RF-2026-050', name: 'id.png' }));
  assert.equal(res.statusCode, 200, res.body);
  const post = JSON.parse(res.body);
  assert.match(post.url, /^https:\/\/test-bucket\.s3\.ap-southeast-1\.amazonaws\.com\/?$/);
  assert.equal(post.fields.key, 'uploads/RF-2026-050/id.png');
  const policy = JSON.parse(Buffer.from(post.fields.Policy, 'base64').toString());
  assert.deepEqual(policy.conditions.find((c) => c[0] === 'content-length-range'), ['content-length-range', 1, 5 * 1024 * 1024]);
  assert.deepEqual(policy.conditions.find((c) => c[1] === '$Content-Type'), ['eq', '$Content-Type', 'image/png']);
  assert(new Date(policy.expiration) - Date.now() <= 300e3, 'short expiry');

  console.log('aws-layer checks passed (fakes only; nothing here calls AWS)');
})().catch((e) => { console.error(e); process.exit(1); });
