'use strict';
// Gemini adapter with the same interface as aws/llm.cjs: readPage, draftMessage, ask.
// The model only ever receives OCR TEXT (ID numbers already masked by the pipeline), never images.
// Synthetic data only: the Gemini free tier may use prompts to improve Google products.
const { validDate } = require('../checker.cjs');
const { safeDraft, DOC_TYPES, INTAKE_PROMPT, INTAKE_SCHEMA } = require('./guards.cjs');

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

function makeGemini({ apiKey, model = 'gemini-3.5-flash-lite', fetchFn = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  async function call(body) {
    let last;
    for (let attempt = 0; attempt < 3; attempt++) {
      let res;
      try { res = await fetchFn(`${BASE}/${model}:generateContent`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey }, body: JSON.stringify(body) }); }
      catch (e) { last = 'network'; await sleep(800 * (attempt + 1)); continue; }
      if (res.ok) return res.json();
      last = `${res.status} ${(await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 160)}`;
      if (![429, 500, 503].includes(res.status)) break;
      await sleep(800 * (attempt + 1));
    }
    throw new Error(`model call failed (${last})`);
  }
  const textOf = (r) => ((((r.candidates || [])[0] || {}).content || {}).parts || []).filter((p) => typeof p.text === 'string' && !p.thought).map((p) => p.text).join('');

  const PAGE_SCHEMA = {
    type: 'object',
    properties: {
      docType: { type: 'string', enum: [...DOC_TYPES, 'unknown'] },
      owner_name: { type: 'string' },
      business_name: { type: 'string' },
      expiry: { type: 'string', description: 'YYYY-MM-DD if a validity or expiry date is printed, else empty' },
      side: { type: 'string', enum: ['front', 'back', 'na'] },
      legibility: { type: 'string', enum: ['clear', 'unclear'] },
    },
    required: ['docType', 'legibility'],
  };

  /** page: { text } (OCR text, ID numbers masked). Returns the same shape as aws/llm.cjs readPage. */
  async function readPage(page) {
    const first = await readOnce(page);
    return first.unreadable ? readOnce(page) : first; // one retry: the model sometimes returns unusable output
  }
  async function readOnce({ text }) {
    const r = await call({
      systemInstruction: { parts: [{ text: 'You read the OCR text of one page from a Philippine business loan application packet. Report only what the text shows. Leave a field empty if it is not in the text. Never guess a name or date. If the text is garbled, set legibility to "unclear".' }] },
      contents: [{ role: 'user', parts: [{ text: `OCR text of the page:\n"""\n${String(text).slice(0, 6000)}\n"""\nClassify the page and extract the fields.` }] }],
      generationConfig: { responseMimeType: 'application/json', responseJsonSchema: PAGE_SCHEMA, maxOutputTokens: 400 },
    });
    let o; try { o = JSON.parse(textOf(r)); } catch { return { docType: null, unreadable: true }; }
    const page = { docType: DOC_TYPES.includes(o.docType) ? o.docType : null, fields: {}, conf: {} };
    const c0 = o.legibility === 'clear' ? 0.95 : 0.6;
    for (const k of ['owner_name', 'business_name']) if (typeof o[k] === 'string' && o[k].trim()) { page.fields[k] = o[k].trim().slice(0, 120); page.conf[k] = c0; }
    if (validDate(o.expiry)) page.expiry = o.expiry;
    if (o.side === 'front' || o.side === 'back') page.side = o.side;
    return page;
  }

  async function draftMessage({ items, audience = 'branch' }) {
    const r = await call({
      systemInstruction: { parts: [{ text: 'You write short, polite Taglish messages for a bank business-loan officer (BSO). Use exactly the items provided: do not add, remove, merge, or soften any item, and never say the application is approved or complete. No promises about timing. Under 90 words.' }] },
      contents: [{ role: 'user', parts: [{ text: `Audience: ${audience === 'client' ? 'the business owner' : 'the branch officer'}.\nItems still needed:\n${items.map((i) => `- ${i}`).join('\n')}` }] }],
      generationConfig: { maxOutputTokens: 400 },
    });
    return safeDraft(textOf(r), items);
  }

  /** One general reminder from a BSO's return reason. null makes the caller use the reason itself. A BSO edits and publishes it. */
  async function draftLesson({ reason, type, industry }) {
    const r = await call({
      systemInstruction: { parts: [{ text: 'A bank business-loan officer (BSO) returned a loan referral to the branch for the reason given. Rewrite the reason as ONE short reminder for branch staff handling similar cases later: what to check, on which document, before sending. Use only what the reason says. No client, person or business names, no amounts, and never say anything is approved or complete. Same language as the reason (English or Taglish). Under 30 words.' }] },
      contents: [{ role: 'user', parts: [{ text: `Business structure: ${type}. Industry: ${industry}.\nReturn reason: ${reason}` }] }],
      generationConfig: { maxOutputTokens: 400 },
    });
    return safeDraft(textOf(r));
  }

  const TOOLS = [{ functionDeclarations: [
    { name: 'get_heads_up', description: 'Reminders a BSO published for cases like this one, from past returns. They are reminders, not requirements.', parameters: { type: 'object', properties: {} } },
    { name: 'get_status', description: 'Status of this referral.', parameters: { type: 'object', properties: {} } },
    { name: 'get_lacking', description: 'What is still missing or flagged for a person to check on this referral.', parameters: { type: 'object', properties: {} } },
    { name: 'get_checklist', description: 'Initial requirements for this referral, each with its source.', parameters: { type: 'object', properties: {} } },
  ] }];

  /** Tools are already bound to one referral by the caller. Returns { answer, handoff, trace }. */
  async function ask(question, handlers, maxTurns = 4) {
    const contents = [{ role: 'user', parts: [{ text: question }] }];
    const trace = [];
    for (let turn = 0; turn < maxTurns; turn++) {
      const r = await call({
        systemInstruction: { parts: [{ text: 'You help a BPI business solution officer (BSO) and branch staff with ONE loan referral. Answer ONLY from tool results. Name a document only if a tool result names it. If tools return nothing, or the question is about approval, eligibility, rates or credit decisions, say you cannot answer and that the BSO or Credit decides. Reply in the language of the question (English or Taglish), in plain text without markdown. Keep it short.' }] },
        contents, tools: TOOLS, generationConfig: { maxOutputTokens: 600 },
      });
      const content = ((r.candidates || [])[0] || {}).content || { role: 'model', parts: [] };
      contents.push(content);
      const calls = (content.parts || []).filter((p) => p.functionCall);
      if (!calls.length) return { answer: textOf(r).trim(), handoff: false, trace };
      const parts = [];
      for (const p of calls) {
        const { name } = p.functionCall;
        let result;
        try { const h = handlers[name]; if (!h) throw new Error('unknown tool'); result = await h(); }
        catch { result = { error: 'Tool failed or has no data.' }; }
        trace.push({ tool: name, result });
        parts.push({ functionResponse: { name, response: { result } } });
      }
      contents.push({ role: 'user', parts });
    }
    return { answer: 'I could not finish that. Please ask the BSO.', handoff: true, trace };
  }

  /** Case fields from the branch officer's note. The caller checks them with cleanIntake. */
  async function intake(note) {
    const r = await call({
      systemInstruction: { parts: [{ text: INTAKE_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: `Note:\n"""\n${note}\n"""` }] }],
      generationConfig: { responseMimeType: 'application/json', responseJsonSchema: INTAKE_SCHEMA, maxOutputTokens: 400 },
    });
    try { return JSON.parse(textOf(r)); } catch { return {}; }
  }

  return { readPage, draftMessage, draftLesson, ask, intake, model };
}

module.exports = { makeGemini };
