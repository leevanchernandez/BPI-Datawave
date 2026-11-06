'use strict';
// Offline tests for the AWS layer using fakes. Proves wiring, validation and guardrails, NOT Textract or model accuracy.
// Run: node scripts/verify-aws.cjs  (needs: cd backend && npm install, for the Textract command classes)
const assert = require('node:assert/strict');
const { processPacket } = require('../backend/pipeline.cjs');
const { makeHandlers } = require('../backend/handler.cjs');
const llm = require('../backend/aws/llm.cjs');
const textract = require('../backend/aws/textract.cjs');
const { classify } = require('../backend/classify.cjs');

const REF = { id: 'RF-2026-050', business: 'Lim Prints', name: 'David Lim', type: 'Sole proprietorship', industry: 'Services', amount: 500000 };

// ---- fake pages: bytes carry a tag, detectLines/readPage fakes look it up ----
const DOCS = {
  form: { lines: ['LOAN APPLICATION FORM', 'Page 1 of 1'], kv: { 'business name': { value: 'Lim Prints', conf: 0.99 }, 'name of applicant': { value: 'David Lim', conf: 0.99 }, address: { value: '1 Main St', conf: 0.98 }, tin: { value: '123-456', conf: 0.97 }, 'contact number': { value: '0917', conf: 0.97 }, signature: { value: 'signed', conf: 0.9 } } },
  idf: { lines: ['REPUBLIC OF THE PHILIPPINES', 'UMID'], model: { docType: 'gov_id', fields: { owner_name: 'David Lim' }, conf: { owner_name: 0.95 }, side: 'front' } },
  idb: { lines: ['REPUBLIC OF THE PHILIPPINES', 'UMID back'], model: { docType: 'gov_id', fields: {}, conf: {}, side: 'back' } },
  reg: { lines: ['Department of Trade and Industry', 'Certificate of Registration'], model: { docType: 'registration', fields: { owner_name: 'David Lim', business_name: 'Lim Prints' }, conf: { owner_name: 0.95, business_name: 0.95 } } },
  permit: { lines: ["Mayor's Permit"], model: { docType: 'business_permit', fields: { business_name: 'Lim Prints' }, conf: { business_name: 0.95 }, expiry: '2027-03-31' } },
  fin: { lines: ['Statement of Financial Position'] },
  bank: { lines: ['Bank Statement'] },
  blur: { lines: ['xx ##'], model: { unreadable: true, docType: null } },
};
const page = (tag) => ({ bytes: Buffer.from(tag), mediaType: 'image/jpeg' });
const calls = { forms: 0, model: 0 };
const deps = {
  detectLines: async (b) => DOCS[b.toString()].lines.map((text) => ({ text, conf: 0.99 })),
  analyzeForm: async (b) => { calls.forms++; return DOCS[b.toString()].kv; },
  readPage: async ({ bytes }) => { calls.model++; return DOCS[bytes.toString()].model || { docType: null, unreadable: true }; },
};

(async () => {
  // ---- pipeline: complete packet, with cost-sensitive routing ----
  let out = await processPacket(REF, ['form', 'idf', 'idb', 'reg', 'permit', 'fin', 'bank'].map(page), deps, { today: new Date('2026-11-04') });
  assert.deepEqual(out.result.defects, [], JSON.stringify(out.result.defects));
  assert(out.result.complete);
  assert.equal(calls.forms, 1, 'Forms (the expensive pass) runs only on the form page');
  assert.equal(calls.model, 4, 'model reads only id, id back, registration, permit; not financials or bank statements');

  // ---- pipeline: missing financials + unreadable page => defect and review, never complete ----
  out = await processPacket(REF, ['form', 'idf', 'idb', 'reg', 'permit', 'bank', 'blur'].map(page), deps, { today: new Date('2026-11-04') });
  assert(out.result.defects.some((d) => d.key === 'MISSING_DOC:financials'));
  assert(out.result.needsReview.some((d) => d.key.startsWith('PAGE_UNREADABLE')));
  assert(!out.result.complete);

  // ---- classifier ----
  assert.equal(classify([{ text: 'AUDITED FINANCIAL STATEMENTS 2025' }]).docType, 'audited_fs');
  assert.equal(classify([{ text: 'random receipt' }]).docType, null);

  // ---- handler: validation, reconcile across calls, status ----
  const events = [];
  let last = [];
  const hdeps = {
    ...deps,
    loadPage: async (k) => page(k.split('/').pop()),
    store: { events: async () => events, lastDefects: async () => last, record: async (id, ev) => { events.push(ev); if (ev.defects) last = ev.defects; } },
    draftMessage: async () => { throw new Error('model down'); }, // must fall back to the template
    ask: async (q, h) => ({ answer: JSON.stringify(await h.get_status({ referralId: REF.id })) }),
  };
  const H = makeHandlers(hdeps);
  const ev = (b) => ({ body: JSON.stringify(b) });
  assert.equal((await H.check({ body: '{bad' })).statusCode, 400);
  assert.equal((await H.check(ev({ referral: { ...REF, id: 'x' }, pageKeys: ['uploads/a'] }))).statusCode, 400, 'referral id format');
  assert.equal((await H.check(ev({ referral: REF, pageKeys: ['uploads/../secret'] }))).statusCode, 400, 'path traversal');
  assert.equal((await H.check(ev({ referral: REF, pageKeys: ['other/a'] }))).statusCode, 400, 'prefix enforced');
  assert.equal((await H.check(ev({ referral: REF, pageKeys: Array(41).fill('uploads/a') }))).statusCode, 400, 'page cap');

  let r = JSON.parse((await H.check(ev({ referral: REF, pageKeys: ['form', 'idf', 'idb', 'reg', 'permit', 'bank'].map((k) => `uploads/${k}`) }))).body);
  assert(r.result.defects.some((d) => d.key === 'MISSING_DOC:financials'));
  assert.equal(r.status, 'Missing requirements');
  assert(r.message.includes('Financial statements'), 'template fallback used when the model is down');
  r = JSON.parse((await H.check(ev({ referral: REF, pageKeys: ['form', 'idf', 'idb', 'reg', 'permit', 'bank', 'fin'].map((k) => `uploads/${k}`) }))).body);
  assert(r.reconcile.resolved.some((d) => d.key === 'MISSING_DOC:financials'), 'resubmission resolves the lacking item');
  assert.equal(r.status, 'Draft', 'passed check, not yet handed off');
  assert.equal(JSON.parse((await H.ask(ev({ question: 'status?' }))).body).answer.includes('Draft'), true);
  assert.equal((await H.ask(ev({ question: 'x'.repeat(501) }))).statusCode, 400);

  // ---- llm.readPage validation: the model cannot invent a doc type, bad dates, or extra keys ----
  const fake = (text, extra = {}) => ({ messages: { create: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text }], ...extra }) } });
  let p = await llm.readPage({ bytes: Buffer.from('x') }, fake(JSON.stringify({ docType: 'root_access', legibility: 'clear', owner_name: 'A', expiry: 'tomorrow', admin: true })));
  assert.equal(p.docType, null); assert.equal(p.expiry, undefined); assert.equal(p.admin, undefined);
  p = await llm.readPage({ bytes: Buffer.from('x') }, fake('not json'));
  assert(p.unreadable);
  p = await llm.readPage({ bytes: Buffer.from('x') }, fake(JSON.stringify({ docType: 'business_permit', legibility: 'unclear', business_name: 'Lim Prints', expiry: '2027-01-01' })));
  assert.equal(p.conf.business_name, 0.6, 'unclear reads get low confidence so the checker abstains');

  // ---- llm.ask: tool loop returns all results in ONE user message, errors are marked, refusal hands off ----
  const sent = [];
  let n = 0;
  const loop = { messages: { create: async (req) => { sent.push(JSON.parse(JSON.stringify(req.messages))); n++;
    if (n === 1) return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'get_status', input: { referralId: 'RF-2026-050' } }, { type: 'tool_use', id: 't2', name: 'nope', input: {} }] };
    return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Draft pa.' }] }; } } };
  const a = await llm.ask('status RF-2026-050?', { get_status: async () => ({ status: 'Draft' }) }, loop);
  assert.equal(a.answer, 'Draft pa.');
  const resultsMsg = sent[1].at(-1);
  assert.equal(resultsMsg.role, 'user'); assert.equal(resultsMsg.content.length, 2, 'parallel tool results in one message');
  assert(resultsMsg.content[1].is_error, 'unknown tool is reported as an error result');
  const ref = await llm.ask('q', {}, fake('', { stop_reason: 'refusal' }));
  assert(ref.handoff);
  let m = 0;
  const forever = { messages: { create: async () => { m++; return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'x', name: 'get_status', input: { referralId: 'a' } }] }; } } };
  assert((await llm.ask('q', { get_status: async () => ({}) }, forever, 3)).handoff && m === 3, 'turn cap');
  // request shape for Haiku 5.5: no banned params
  let req; await llm.draftMessage({ items: ['Form page 2 is missing.'] }, { messages: { create: async (r) => { req = r; return { content: [{ type: 'text', text: 'ok' }] }; } } });
  for (const k of ['temperature', 'top_p', 'top_k', 'thinking', 'tool_choice']) assert(!(k in req), `${k} must not be sent to Haiku 5.5`);
  assert.equal(req.messages.at(-1).role, 'user', 'no assistant prefill');

  // ---- textract.analyzeForm parsing: key/value, empty value = blank field ----
  const blocks = [
    { Id: 'w1', BlockType: 'WORD', Text: 'TIN' }, { Id: 'w2', BlockType: 'WORD', Text: 'Signature' }, { Id: 'w3', BlockType: 'WORD', Text: '123' },
    { Id: 'k1', BlockType: 'KEY_VALUE_SET', EntityTypes: ['KEY'], Confidence: 99, Relationships: [{ Type: 'CHILD', Ids: ['w1'] }, { Type: 'VALUE', Ids: ['v1'] }] },
    { Id: 'v1', BlockType: 'KEY_VALUE_SET', EntityTypes: ['VALUE'], Confidence: 91, Relationships: [{ Type: 'CHILD', Ids: ['w3'] }] },
    { Id: 'k2', BlockType: 'KEY_VALUE_SET', EntityTypes: ['KEY'], Confidence: 95, Relationships: [{ Type: 'CHILD', Ids: ['w2'] }] }, // no VALUE block
  ];
  const kv = await textract.analyzeForm(Buffer.from('x'), { send: async () => ({ Blocks: blocks }) });
  assert.deepEqual(kv.tin, { value: '123', conf: 0.91 });
  assert.equal(kv.signature.value, '', 'missing value block is a blank field');

  // ---- real SDK class exists and constructs offline ----
  const { AnthropicBedrockMantle } = await import('../backend/node_modules/@anthropic-ai/bedrock-sdk/index.mjs');
  const c = new AnthropicBedrockMantle({ awsRegion: 'ap-southeast-1' });
  assert.equal(typeof c.messages.create, 'function');

  console.log('aws-layer checks passed (fakes only; nothing here calls AWS)');
})().catch((e) => { console.error(e); process.exit(1); });
