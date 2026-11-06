'use strict';
// Offline tests for the AWS layer using fakes. Proves wiring, validation and guardrails, NOT Textract or model accuracy.
// Run: node scripts/verify-aws.cjs  (needs: cd backend && npm install, for the SDK command classes)
const assert = require('node:assert/strict');
const { processPacket } = require('../backend/pipeline.cjs');
const { makeHandlers } = require('../backend/handler.cjs');
const llm = require('../backend/aws/llm.cjs');
const textract = require('../backend/aws/textract.cjs');
const { classify } = require('../backend/classify.cjs');

const REF = { id: 'RF-2026-050', business: 'Lim Prints', name: 'David Lim', type: 'Sole proprietorship', industry: 'Services', amount: 500000 };
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
const GOOD = ['form', 'idf', 'idb', 'reg', 'permit', 'fin', 'bank'];

(async () => {
  // ---- pipeline: complete packet, cost-sensitive routing ----
  let out = await processPacket(REF, GOOD.map(page), deps, { today: TODAY });
  assert.deepEqual(out.result.defects, [], JSON.stringify(out.result.defects));
  assert.deepEqual(out.result.needsReview, [], JSON.stringify(out.result.needsReview));
  assert(out.result.complete);
  assert.equal(calls.forms, 1, 'Forms (the expensive pass) runs only on the form page');
  assert.equal(calls.model, 4, 'model reads only id front, id back, registration, permit');

  // ---- pipeline: missing financials plus an unreadable page never completes ----
  out = await processPacket(REF, ['form', 'idf', 'idb', 'reg', 'permit', 'bank', 'blur'].map(page), deps, { today: TODAY });
  assert(out.result.defects.some((d) => d.key === 'MISSING_DOC:financials'));
  assert(out.result.needsReview.some((d) => d.key.startsWith('PAGE_UNREADABLE')));
  assert(!out.result.complete);

  // ---- pipeline: a page with only a title is not trusted ----
  out = await processPacket(REF, ['form', 'thin', 'idb', 'reg', 'permit', 'fin', 'bank'].map(page), deps, { today: TODAY });
  assert(out.result.needsReview.some((d) => d.key.startsWith('PAGE_THIN')) && !out.result.complete);

  // ---- pipeline: model output must be visible in the page text (prompt injection guard) ----
  out = await processPacket(REF, ['form', 'idf', 'idb', 'reg', 'liar', 'fin', 'bank'].map(page), deps, { today: TODAY });
  assert(out.result.needsReview.some((d) => d.key.includes('MODEL_UNGROUNDED') && d.key.endsWith('expiry')), 'invented expiry date is rejected');
  assert(!out.result.complete);
  out = await processPacket(REF, ['form', 'liarName', 'idb', 'reg', 'permit', 'fin', 'bank'].map(page), deps, { today: TODAY });
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
  const hdeps = {
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
  const ev = (b) => ({ body: JSON.stringify(b) });
  const keys = (tags, id = REF.id) => tags.map((k) => `uploads/${id}/${k}`);
  assert.equal((await H.check({ body: '{bad' })).statusCode, 400);
  assert.equal((await H.check(ev({ referral: { ...REF, id: 'x' }, pageKeys: keys(['a']) }))).statusCode, 400, 'referral id format');
  for (const bad of [{ amount: -5 }, { amount: '500000' }, { amount: null }, { amount: 0 }, { industry: '' }, { name: '' }, { type: 'Cooperative' }]) assert.equal((await H.check(ev({ referral: { ...REF, ...bad }, pageKeys: keys(['form']) }))).statusCode, 400, `referral ${JSON.stringify(bad)}`);
  assert.equal((await H.check(ev({ referral: REF, pageKeys: ['uploads/../secret'] }))).statusCode, 400, 'path traversal');
  assert.equal((await H.check(ev({ referral: REF, pageKeys: ['other/a'] }))).statusCode, 400, 'prefix enforced');
  assert.equal((await H.check(ev({ referral: REF, pageKeys: keys(['form'], 'RF-2026-999') }))).statusCode, 400, 'keys must belong to this referral (no cross-case reads)');
  assert.equal((await H.check(ev({ referral: REF, pageKeys: keys(Array(21).fill('a')) }))).statusCode, 400, 'page cap');

  let r = JSON.parse((await H.check(ev({ referral: REF, pageKeys: keys(['form', 'idf', 'idb', 'reg', 'permit', 'bank']) }))).body);
  assert(r.result.defects.some((d) => d.key === 'MISSING_DOC:financials'));
  assert.equal(r.status, 'Missing requirements');
  assert(r.message.includes('Financial statements'), 'template fallback used when the model is down');
  r = JSON.parse((await H.check(ev({ referral: REF, pageKeys: keys(['form', 'idf', 'idb', 'reg', 'permit', 'bank', 'fin']) }))).body);
  assert(r.reconcile.resolved.some((d) => d.key === 'MISSING_DOC:financials'));
  assert.equal(r.status, 'Draft');
  assert(r.result.complete === false || r.result.needsReview.length === 0);
  assert.equal(JSON.parse((await H.ask(ev({ referralId: 'RF-2026-050', question: 'status?' }))).body).answer.includes('Draft'), true);
  assert.equal((await H.ask(ev({ question: 'status?' }))).statusCode, 400, 'ask needs a referralId');
  assert.equal((await H.ask(ev({ referralId: 'RF-2026-050', question: 'x'.repeat(501) }))).statusCode, 400);

  // ---- /ask tools are bound to one referral (no IDOR through the model) ----
  let captured; const H2 = makeHandlers({ ...hdeps, ask: async (q, h) => { captured = h; return { answer: 'ok' }; } });
  await H2.ask(ev({ referralId: 'RF-2026-050', question: 'status?' }));
  await assert.rejects(captured.get_status({ referralId: 'RF-2026-051' }), /not allowed/, 'tool refuses another referral');
  assert.deepEqual(await captured.get_status({ referralId: 'RF-2026-050' }).then((x) => x.referralId), 'RF-2026-050');
  const H3 = makeHandlers({ ...hdeps, store: { ...hdeps.store, events: async () => [] }, ask: async (q, h) => { captured = h; return { answer: 'ok' }; } });
  await H3.ask(ev({ referralId: 'RF-2026-060', question: 'lacking?' }));
  assert.equal((await captured.get_lacking({ referralId: 'RF-2026-060' })).known, false, 'an unknown referral is "unknown", not "nothing lacking"');

  // ---- llm.readPage validation ----
  const fake = (text, extra = {}) => ({ messages: { create: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text }], ...extra }) } });
  let p = await llm.readPage({ bytes: Buffer.from('x') }, fake(JSON.stringify({ docType: 'root_access', legibility: 'clear', owner_name: 'A', expiry: '2026-13-45', admin: true })));
  assert.equal(p.docType, null); assert.equal(p.expiry, undefined, 'impossible calendar date rejected'); assert.equal(p.admin, undefined);
  p = await llm.readPage({ bytes: Buffer.from('x') }, fake('not json')); assert(p.unreadable);
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
  const r2 = JSON.parse((await approvals.check(ev({ referral: { ...REF, id: 'RF-2026-070' }, pageKeys: keys(['form', 'idf', 'idb', 'reg', 'permit', 'bank'], 'RF-2026-070') }))).body);
  assert(r2.message.includes('Financial statements'), 'unsafe model draft falls back to the template');

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

  // ---- stored defect items must marshal for DynamoDB (it rejected undefined values by default) ----
  const { marshall } = require('../backend/node_modules/@aws-sdk/util-dynamodb');
  const bad = await processPacket(REF, ['form', 'liarName', 'idb', 'reg', 'permit', 'fin', 'bank'].map(page), deps, { today: TODAY });
  assert.doesNotThrow(() => marshall({ defects: bad.result.defects, needsReview: bad.result.needsReview }), 'events marshal without removeUndefinedValues');

  const { AnthropicBedrockMantle } = await import('../backend/node_modules/@anthropic-ai/bedrock-sdk/index.mjs');
  assert.equal(typeof new AnthropicBedrockMantle({ awsRegion: 'ap-southeast-1' }).messages.create, 'function');

  console.log('aws-layer checks passed (fakes only; nothing here calls AWS)');
})().catch((e) => { console.error(e); process.exit(1); });
