'use strict';
// Claude on Amazon Bedrock through the Anthropic SDK's Bedrock client (the InvokeModel path). The client is injectable for tests.
// Checked on the hackathon account on 2026-11-12 in ap-southeast-1. The global Haiku 5.5 profile answers on this path.
// The Mantle endpoint returned 404 for Haiku and 403 for Sonnet there, so it is not used.
// Still unverified is whether hackathon credits cover Marketplace-billed Claude. See docs/aws.md.
// Haiku 5.5 rules (Anthropic docs): no temperature/top_p, no assistant prefill, no forced tool_choice, thinking is adaptive.

const { validDate } = require('../checker.cjs');
const { INTAKE_PROMPT, INTAKE_SCHEMA } = require('../free/guards.cjs');
const MODEL = process.env.BEDROCK_MODEL_ID || 'global.anthropic.claude-haiku-5-5';
const DOC_TYPES = ['application_form', 'gov_id', 'registration', 'business_permit', 'sanitary_permit', 'financials', 'audited_fs', 'bank_statements'];

async function makeClient() {
  const { AnthropicBedrock } = await import('@anthropic-ai/bedrock-sdk');
  return new AnthropicBedrock({ awsRegion: process.env.BEDROCK_REGION || process.env.AWS_REGION });
}

// Token counts of the model calls since the last takeUsage().
// ponytail: one counter per container. It holds while a Lambda container serves one request at a time.
let used = { modelCalls: 0, inputTokens: 0, outputTokens: 0 };
function count(msg) {
  const u = msg.usage || {};
  used.modelCalls++; used.inputTokens += u.input_tokens || 0; used.outputTokens += u.output_tokens || 0;
  return msg;
}
function takeUsage() { const u = used; used = { modelCalls: 0, inputTokens: 0, outputTokens: 0 }; return u; }

const text = (msg) => (msg.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');

const PAGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['docType', 'legibility'],
  properties: {
    docType: { type: 'string', enum: [...DOC_TYPES, 'unknown'] },
    owner_name: { type: 'string' },
    business_name: { type: 'string' },
    expiry: { type: 'string', description: 'YYYY-MM-DD if a validity or expiry date is printed, else empty' },
    side: { type: 'string', enum: ['front', 'back', 'na'] },
    pageNo: { type: 'integer' },
    pageTotal: { type: 'integer' },
    legibility: { type: 'string', enum: ['clear', 'unclear'] },
  },
};

/** Reads names and dates from the masked OCR text of an ID, registration or permit page. The photo is not sent. */
async function readPage({ text: ocr }, client) {
  const c = client || (await makeClient());
  const msg = count(await c.messages.create({
    model: MODEL,
    max_tokens: 600,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: PAGE_SCHEMA } },
    system: 'You read the OCR text of one page from a Philippine business loan application packet. Report only what the text shows. Leave a field empty if it is not in the text. Never guess a name or date. If the text is garbled, set legibility to "unclear".',
    messages: [{ role: 'user', content: `OCR text of the page:\n"""\n${String(ocr || '').slice(0, 6000)}\n"""\nClassify the page and extract the fields.` }],
  }));
  let o;
  try { o = JSON.parse(text(msg)); } catch { return { docType: null, unreadable: true }; }
  // validate: the model never gets to invent a doc type or leak extra keys
  const page = { docType: DOC_TYPES.includes(o.docType) ? o.docType : null, fields: {}, conf: {} };
  const c0 = o.legibility === 'clear' ? 0.95 : 0.6; // coarse: the model gives no per-field score
  for (const k of ['owner_name', 'business_name']) if (typeof o[k] === 'string' && o[k].trim()) { page.fields[k] = o[k].trim().slice(0, 120); page.conf[k] = c0; }
  if (validDate(o.expiry)) page.expiry = o.expiry; // real calendar parse. The pipeline also requires it to be visible in the OCR text.
  if (o.side === 'front' || o.side === 'back') page.side = o.side;
  if (Number.isInteger(o.pageNo) && Number.isInteger(o.pageTotal)) { page.pageNo = o.pageNo; page.pageTotal = o.pageTotal; }
  return page;
}

/** Second look at form fields the Forms pass returned empty. Returns the fields whose space has any mark in it. */
async function markedFields({ bytes, mediaType = 'image/jpeg' }, fields, client) {
  const c = client || (await makeClient());
  const msg = count(await c.messages.create({
    model: MODEL,
    max_tokens: 300,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: { type: 'object', additionalProperties: false, required: ['marked'], properties: { marked: { type: 'array', items: { type: 'string', enum: fields } } } } } },
    system: 'You look at one page of a loan application form. For each field you are asked about, look only at the space where its value is written. A field is marked if that space holds any writing, typing, stamp, signature or other ink, even if you cannot read it. A field is not marked if the space is empty. Do not read out any value.',
    messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: mediaType, data: Buffer.from(bytes).toString('base64') } }, { type: 'text', text: `Which of these fields are marked? ${fields.map((f) => f.replace(/_/g, ' ')).join(', ')}. Answer with the field ids ${fields.join(', ')}.` }] }],
  }));
  let o;
  try { o = JSON.parse(text(msg)); } catch { return []; }
  return (Array.isArray(o.marked) ? o.marked : []).filter((f) => fields.includes(f));
}

/** Reject model drafts that sound like approval or are empty or oversized. null makes the caller use the template. */
const FORBIDDEN = /\b(approved?|na-?approve|complete\s+na|tapos\s+na|good\s+to\s+go|ok(?:ay)?\s+na|verified)\b/i;
function safeDraft(out, items) {
  const t = String(out || '').trim();
  if (!t || t.length > 700) return null;
  if (items.length && FORBIDDEN.test(t)) return null;
  return t;
}

/** Rewrite the lacking list as a short Taglish message. It may not add, remove, or soften items. */
async function draftMessage({ items, audience = 'branch' }, client) {
  const c = client || (await makeClient());
  const msg = count(await c.messages.create({
    model: MODEL,
    max_tokens: 500,
    output_config: { effort: 'low' },
    system: 'You write short, polite Taglish messages for a bank business-loan officer (BSO). Use exactly the items provided: do not add, remove, merge, or soften any item, and never say the application is approved or complete unless the item list is empty. No promises about timing. Under 90 words.',
    messages: [{ role: 'user', content: `Audience: ${audience === 'client' ? 'the business owner (explain briefly why each item is needed)' : 'the branch officer'}.\nItems still needed:\n${items.map((i) => `- ${i}`).join('\n') || '(none)'}` }],
  }));
  return safeDraft(text(msg), items);
}

const TOOLS = [
  { name: 'get_status', description: 'Status of one referral by id, e.g. RF-2026-042.', strict: true, input_schema: { type: 'object', additionalProperties: false, required: ['referralId'], properties: { referralId: { type: 'string' } } } },
  { name: 'get_lacking', description: 'What is still missing or flagged for one referral.', strict: true, input_schema: { type: 'object', additionalProperties: false, required: ['referralId'], properties: { referralId: { type: 'string' } } } },
  { name: 'get_checklist', description: 'Basic requirements for a client profile.', strict: true, input_schema: { type: 'object', additionalProperties: false, required: ['type', 'industry', 'amount'], properties: { type: { type: 'string', enum: ['Sole proprietorship', 'Partnership', 'Corporation'] }, industry: { type: 'string' }, amount: { type: 'number' } } } },
];

/** Inquiry agent. Read-only tools; it can only report what tools return. handlers: { name: async (input) => object }. */
const ASK_SYSTEM = 'You answer branch staff questions about loan referrals for a BPI business loan officer. Answer ONLY from tool results. If a tool returns nothing or the question is about approval odds, credit decisions, or anything not covered, say you cannot answer and that the BSO should be asked. Reply in the language of the question (English or Taglish). Keep it short.';
const noInput = { type: 'object', additionalProperties: false, properties: {} };
/** Tools for one referral whose facts the caller already loaded, plus requirements for any profile. */
const CASE_TOOLS = [
  { name: 'get_status', description: 'Status of this referral.', input_schema: noInput },
  { name: 'get_lacking', description: 'What is still missing or flagged for a person to check on this referral.', input_schema: noInput },
  { name: 'get_checklist', description: 'Initial requirements for this referral, each with its source.', input_schema: noInput },
  { name: 'get_heads_up', description: 'Reminders a BSO published for cases like this one. They are reminders, not requirements.', input_schema: noInput },
  { name: 'get_requirements', description: 'Initial requirements for any client profile, for general questions such as what a corporation needs. Not for this referral.', input_schema: { type: 'object', additionalProperties: false, required: ['type'], properties: { type: { type: 'string', enum: ['Sole proprietorship', 'Partnership', 'Corporation'] }, industry: { type: 'string' }, amount: { type: 'number' }, married: { type: 'boolean' }, secured: { type: 'boolean' }, bpiAccount: { type: 'boolean' } } } },
];

async function ask(question, handlers, client, maxTurns = 4, tools = TOOLS) {
  const c = client || (await makeClient());
  const messages = [{ role: 'user', content: question }], trace = [];
  for (let turn = 0; turn < maxTurns; turn++) {
    const msg = count(await c.messages.create({
      model: MODEL,
      max_tokens: 800,
      output_config: { effort: 'low' },
      system: ASK_SYSTEM,
      tools,
      messages,
    }));
    if (msg.stop_reason === 'refusal') return { answer: 'I cannot help with that. Please ask the BSO.', handoff: true, trace };
    messages.push({ role: 'assistant', content: msg.content });
    const calls = (msg.content || []).filter((b) => b.type === 'tool_use');
    if (!calls.length) return { answer: text(msg).trim(), handoff: false, trace };
    const results = [];
    for (const call of calls) { // all results go back in ONE user message
      try {
        const h = handlers[call.name];
        if (!h) throw new Error('unknown tool');
        const result = await h(call.input);
        trace.push({ tool: call.name, result });
        results.push({ type: 'tool_result', tool_use_id: call.id, content: JSON.stringify(result) });
      } catch (e) {
        results.push({ type: 'tool_result', tool_use_id: call.id, is_error: true, content: 'Tool failed or has no data.' });
      }
    }
    messages.push({ role: 'user', content: results });
  }
  return { answer: 'I could not finish that. Please ask the BSO.', handoff: true, trace };
}

/** Case fields from the branch officer's note. The caller checks them with cleanIntake. */
async function intake(note, client, tries = 2) {
  const c = client || (await makeClient());
  const msg = count(await c.messages.create({
    model: MODEL,
    max_tokens: 400,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: { ...INTAKE_SCHEMA, additionalProperties: false, required: [] } } },
    system: INTAKE_PROMPT,
    messages: [{ role: 'user', content: `Note:\n"""\n${note}\n"""` }],
  }));
  let out = {};
  try { out = JSON.parse(text(msg)); } catch {}
  return Object.keys(out).length || tries < 2 ? out : intake(note, c, 1); // the model sometimes returns nothing, so ask once more
}

module.exports = { readPage, markedFields, draftMessage, safeDraft, ask, intake, takeUsage, TOOLS, CASE_TOOLS, MODEL, DOC_TYPES };
