'use strict';
// Claude on Amazon Bedrock through the Anthropic SDK's Mantle client. The client is injectable for tests.
// UNVERIFIED without AWS access: model id, region availability, IAM actions for the Mantle endpoint, and whether
// hackathon credits cover Marketplace-billed Claude. See docs/aws.md.
// Haiku 5.5 rules (Anthropic docs): no temperature/top_p, no assistant prefill, no forced tool_choice, thinking is adaptive.

const MODEL = process.env.BEDROCK_MODEL_ID || 'anthropic.claude-haiku-5-5';
const DOC_TYPES = ['application_form', 'gov_id', 'registration', 'business_permit', 'sanitary_permit', 'financials', 'audited_fs', 'bank_statements'];

async function makeClient() {
  const { AnthropicBedrockMantle } = await import('@anthropic-ai/bedrock-sdk');
  return new AnthropicBedrockMantle({ awsRegion: process.env.BEDROCK_REGION || process.env.AWS_REGION });
}

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

/** Case reader for pages the cheap classifier could not place, and for fields Textract forms do not cover. */
async function readPage({ bytes, mediaType = 'image/jpeg' }, client) {
  const c = client || (await makeClient());
  const msg = await c.messages.create({
    model: MODEL,
    max_tokens: 600,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: PAGE_SCHEMA } },
    system: 'You read one page from a Philippine business loan application packet. Report only what is printed on the page. Leave a field empty if you cannot read it. Never guess a name or date. If the page is blurry or cut off, set legibility to "unclear".',
    messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: mediaType, data: Buffer.from(bytes).toString('base64') } }, { type: 'text', text: 'Classify this page and extract the fields.' }] }],
  });
  let o;
  try { o = JSON.parse(text(msg)); } catch { return { docType: null, unreadable: true }; }
  // validate: the model never gets to invent a doc type or leak extra keys
  const page = { docType: DOC_TYPES.includes(o.docType) ? o.docType : null, fields: {}, conf: {} };
  const c0 = o.legibility === 'clear' ? 0.95 : 0.6; // coarse: the model gives no per-field score
  for (const k of ['owner_name', 'business_name']) if (typeof o[k] === 'string' && o[k].trim()) { page.fields[k] = o[k].trim().slice(0, 120); page.conf[k] = c0; }
  if (/^\d{4}-\d{2}-\d{2}$/.test(o.expiry || '')) page.expiry = o.expiry;
  if (o.side === 'front' || o.side === 'back') page.side = o.side;
  if (Number.isInteger(o.pageNo) && Number.isInteger(o.pageTotal)) { page.pageNo = o.pageNo; page.pageTotal = o.pageTotal; }
  return page;
}

/** Rewrite the lacking list as a short Taglish message. It may not add, remove, or soften items. */
async function draftMessage({ items, audience = 'branch' }, client) {
  const c = client || (await makeClient());
  const msg = await c.messages.create({
    model: MODEL,
    max_tokens: 500,
    output_config: { effort: 'low' },
    system: 'You write short, polite Taglish messages for a bank business-loan officer (BSO). Use exactly the items provided: do not add, remove, merge, or soften any item, and never say the application is approved or complete unless the item list is empty. No promises about timing. Under 90 words.',
    messages: [{ role: 'user', content: `Audience: ${audience === 'client' ? 'the business owner (explain briefly why each item is needed)' : 'the branch officer'}.\nItems still needed:\n${items.map((i) => `- ${i}`).join('\n') || '(none)'}` }],
  });
  const out = text(msg).trim();
  // guard: every item must still appear in some recognizable form; otherwise the caller falls back to the template
  return out.length ? out : null;
}

const TOOLS = [
  { name: 'get_status', description: 'Status of one referral by id, e.g. RF-2026-042.', strict: true, input_schema: { type: 'object', additionalProperties: false, required: ['referralId'], properties: { referralId: { type: 'string' } } } },
  { name: 'get_lacking', description: 'What is still missing or flagged for one referral.', strict: true, input_schema: { type: 'object', additionalProperties: false, required: ['referralId'], properties: { referralId: { type: 'string' } } } },
  { name: 'get_checklist', description: 'Basic requirements for a client profile.', strict: true, input_schema: { type: 'object', additionalProperties: false, required: ['type', 'industry', 'amount'], properties: { type: { type: 'string', enum: ['Sole proprietorship', 'Partnership', 'Corporation'] }, industry: { type: 'string' }, amount: { type: 'number' } } } },
];

/** Inquiry agent. Read-only tools; it can only report what tools return. handlers: { name: async (input) => object }. */
async function ask(question, handlers, client, maxTurns = 4) {
  const c = client || (await makeClient());
  const messages = [{ role: 'user', content: question }];
  for (let turn = 0; turn < maxTurns; turn++) {
    const msg = await c.messages.create({
      model: MODEL,
      max_tokens: 800,
      output_config: { effort: 'low' },
      system: 'You answer branch staff questions about loan referrals for a BPI business loan officer. Answer ONLY from tool results. If a tool returns nothing or the question is about approval odds, credit decisions, or anything not covered, say you cannot answer and that the BSO should be asked. Reply in the language of the question (English or Taglish). Keep it short.',
      tools: TOOLS,
      messages,
    });
    if (msg.stop_reason === 'refusal') return { answer: 'I cannot help with that. Please ask the BSO.', handoff: true };
    messages.push({ role: 'assistant', content: msg.content });
    const calls = (msg.content || []).filter((b) => b.type === 'tool_use');
    if (!calls.length) return { answer: text(msg).trim(), handoff: false };
    const results = [];
    for (const call of calls) { // all results go back in ONE user message
      try {
        const h = handlers[call.name];
        if (!h) throw new Error('unknown tool');
        results.push({ type: 'tool_result', tool_use_id: call.id, content: JSON.stringify(await h(call.input)) });
      } catch (e) {
        results.push({ type: 'tool_result', tool_use_id: call.id, is_error: true, content: 'Tool failed or has no data.' });
      }
    }
    messages.push({ role: 'user', content: results });
  }
  return { answer: 'I could not finish that. Please ask the BSO.', handoff: true };
}

module.exports = { readPage, draftMessage, ask, TOOLS, MODEL, DOC_TYPES };
