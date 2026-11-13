// Counter Check API on Cloudflare Workers (free stack). Pure functions over a small store, so it is testable in Node.
// TRUST BOUNDARY: the referral is saved once (POST /api/case) and every check reads it from the store, never from the
// caller. There is no bank login: a shared demo key protects the model quota. Synthetic data only.
// A check runs on one of two backends. Text lines from the browser run here (the free stack). Page keys run on the AWS
// backend (Textract and Bedrock), which gets the stored referral and the demo key from this Worker.
import pipelineMod from '../backend/pipeline.cjs';
import reconcileMod from '../backend/reconcile.cjs';
import rulesMod from '../backend/rules.cjs';
import formMod from '../backend/free/formtext.cjs';
import guardsMod from '../backend/free/guards.cjs';

const { processPacket } = pipelineMod;
const { reconcile, draftMessage: templateDraft, deriveStatus } = reconcileMod;
const { checklist, table, civilOf, requirementsFor } = rulesMod;
const { formFromLines } = formMod;
const { refuseCredit, FORBIDDEN, cleanIntake, INTAKE_MAX } = guardsMod;

const ID = /^RF-\d{4}-\d{3}$/;
const TYPES = ['Sole proprietorship', 'Partnership', 'Corporation'];
const MAX_PAGES = 20, MAX_LINES = 300, MAX_LINE = 300;
const MAX_LIST = 200; // ponytail: the list reads every case (up to 1,000 ids). Keep a summary in the KV metadata if that gets slow.
const EVENT_TYPES = new Set(['cleared', 'waived', 'handed_off', 'draft_approved', 'special_case', 'returned', 'endorsed']);
const str = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;

// Heads-ups are reminders from confirmed BSO returns. Only a 'returned' event drafts one (a waiver or a clearance never
// does), only a BSO publishes one, and none of this is read by the checklist, the checker or statusOf.
const LESSONS = '_lessons'; // ponytail: one record, read-modify-write, last write wins. Move to one row per lesson once two BSOs publish at the same time.
const SCOPES = ['industry', 'type', 'all'];
const MAX_LESSON = 240;
const appliesTo = (l, r) => l.status === 'published' && (!l.type || l.type === r.type) && (!l.industry || l.industry === r.industry);
/** why a heads-up cannot be shown to other branches, or null. r is the referral it came from. */
export function lessonProblem(text, r = {}) {
  if (!str(text, MAX_LESSON)) return `write the heads-up in ${MAX_LESSON} characters or fewer`;
  if (FORBIDDEN.test(text)) return 'a heads-up cannot use approval words';
  // ponytail: this matches exact words of the client's names only. A nickname or an address gets past it, which is why a BSO reads it before publishing.
  const t = text.toLowerCase(), words = new Set(t.split(/[^a-z0-9ñ]+/));
  const people = [r.name, r.spouseName].flatMap((n) => String(n || '').toLowerCase().split(/[^a-z0-9ñ]+/)).filter((w) => w.length >= 3);
  if ((r.business && t.includes(r.business.toLowerCase())) || people.some((w) => words.has(w))) return 'remove client details from the heads-up';
  return null;
}

export function validReferral(r) {
  return !!r && typeof r === 'object' && ID.test(r.id || '') && TYPES.includes(r.type)
    && str(r.industry, 80) && str(r.business, 120) && str(r.name, 120)
    && typeof r.amount === 'number' && Number.isFinite(r.amount) && r.amount > 0 && r.amount < 1e11
    && civilOf(r.civilStatus) !== null
    && (r.spouseName == null || r.spouseName === '' || str(r.spouseName, 120))
    && (r.secured == null || typeof r.secured === 'boolean')
    && (r.bpiAccount == null || typeof r.bpiAccount === 'boolean');
}
const cleanReferral = (r) => ({ id: r.id, business: r.business.trim(), name: r.name.trim(), type: r.type, industry: r.industry.trim(), amount: r.amount, civilStatus: civilOf(r.civilStatus), spouseName: (r.spouseName || '').trim(), secured: Boolean(r.secured), bpiAccount: r.bpiAccount === true });

function validPages(pages) {
  return Array.isArray(pages) && pages.length > 0 && pages.length <= MAX_PAGES && pages.every((p) =>
    p && Array.isArray(p.lines) && p.lines.length <= MAX_LINES && (p.docType == null || typeof p.docType === 'string')
    && p.lines.every((l) => l && typeof l.text === 'string' && l.text.length <= MAX_LINE && typeof l.conf === 'number' && l.conf >= 0 && l.conf <= 1));
}

const KEY = /^uploads\/RF-\d{4}-\d{3}\/[\w.-]{1,100}$/;
const validKeys = (id, keys) => Array.isArray(keys) && keys.length > 0 && keys.length <= MAX_PAGES && keys.every((k) => typeof k === 'string' && k.startsWith(`uploads/${id}/`) && KEY.test(k));

const rulesView = (r) => ({ version: table.version, note: table._note, rows: checklist(r).map(({ id, title, docTypes, reason, source, sourceTitle, sourceUrl }) => ({ id, title, docTypes, reason, source, sourceTitle, sourceUrl })) });

/** open items = the last check's items minus what a person cleared or waived after it */
export function openItems(events) {
  let last = -1;
  events.forEach((e, i) => { if (e.type === 'check_failed' || e.type === 'check_passed') last = i; });
  if (last < 0) return { checked: false, defects: [], needsReview: [] };
  const done = new Set(events.slice(last + 1).filter((e) => e.type === 'cleared' || e.type === 'waived').map((e) => e.key));
  return { checked: true, defects: (events[last].defects || []).filter((d) => !done.has(d.key)), needsReview: (events[last].needsReview || []).filter((d) => !done.has(d.key)) };
}
export function statusOf(events) {
  const s = deriveStatus(events), o = openItems(events);
  if ((s === 'Draft' || s === 'Missing requirements') && o.checked) return o.defects.length + o.needsReview.length ? 'Missing requirements' : 'Ready for BSO review';
  return s;
}

// The next step for each status, for the assistant to quote. It never gives a date.
const NEXT = {
  Draft: 'I-save ang case at i-upload ang mga papel, then press Check documents.',
  'Missing requirements': 'Kunin sa client ang mga kulang, then check the documents again.',
  'Ready for BSO review': 'Press Send to BSO.',
  'With BSO': 'Nasa BSO na. Hintayin ang BSO review.',
  'Returned by BSO': 'Ayusin ang sinabi ng BSO, then check the documents again before sending.',
  'Endorsed to Credit': 'Nasa Credit na. Credit ang nagdedesisyon sa loan.',
};

/** aws: { url, key, checkUrl?, fetch? } for the AWS backend, or null. checkUrl is the check function's own URL, which has no 30 second gateway limit. */
const MODEL_ROUTES = new Set(['/api/intake', '/api/check', '/api/ask']);
// Per address per minute for all routes and for model routes, and per UTC day for model calls per address and for all addresses together.
export const QUOTA = { perMinute: 300, modelPerMinute: 20, modelPerDay: 300, modelPerAddressDay: 150 };

/** Counts one call in state { minute, hits, day, n, ips } and returns 'ok', 'rate' or 'daily'. A refused call is not counted. */
export function takeQuota(s, ip, model, now = Date.now()) {
  const minute = Math.floor(now / 60000), day = new Date(now).toISOString().slice(0, 10);
  if (s.minute !== minute) { s.minute = minute; s.hits = {}; }
  if (s.day !== day) { s.day = day; s.n = 0; s.ips = {}; }
  s.ips ||= {};
  const h = s.hits[ip] || (s.hits[ip] = { all: 0, model: 0 });
  if (h.all >= QUOTA.perMinute || (model && h.model >= QUOTA.modelPerMinute)) return 'rate';
  if (model && (s.n >= QUOTA.modelPerDay || (s.ips[ip] || 0) >= QUOTA.modelPerAddressDay)) return 'daily';
  h.all++;
  if (model) { h.model++; s.n++; s.ips[ip] = (s.ips[ip] || 0) + 1; }
  return 'ok';
}

/** limits: async (model) => 'ok' | 'rate' | 'daily', or null for no limits. */
export function makeApi({ store, llm, now = () => new Date(), demoKey, aws = null, limits = null }) {
  const useAws = (stack) => (stack ? stack === 'aws' : !!aws); // no stack given: AWS when it is set up, like the page
  const awsPost = (path, payload) => (aws.fetch || fetch)(path === '/check' && aws.checkUrl ? aws.checkUrl : aws.url + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-demo-key': aws.key }, body: JSON.stringify(payload) });
  const noAws = () => json(503, { error: 'the AWS backend is not set up on this deployment' });
  const json = (code, body) => new Response(JSON.stringify(body), { status: code, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  const bad = (m) => json(400, { error: m });
  const view = (c) => {
    const lastCheck = [...c.events].reverse().find((e) => e.type === 'check_failed' || e.type === 'check_passed');
    return { referral: c.referral, events: c.events.map(({ defects, needsReview, ...e }) => e), status: statusOf(c.events), open: openItems(c.events), lastMessage: lastCheck ? lastCheck.message : null, rules: rulesView(c.referral) };
  };
  const at = () => now().toISOString();
  const lessons = async () => (await store.get(LESSONS)) || { list: [] };
  const shown = (list, r) => list.filter((l) => appliesTo(l, r)).map(({ id, text, type, industry }) => ({ id, text, type, industry })); // no source case, no raw reason
  /** the case view plus its heads-ups. Drafts go only to the case they came from. */
  const full = async (c) => {
    const { list } = await lessons();
    return { ...view(c), headsUp: shown(list, c.referral), lessonDrafts: list.filter((l) => l.status === 'draft' && l.fromCase === c.referral.id) };
  };

  async function body(req) { try { return await req.json(); } catch { return null; } }

  const routes = {
    'GET /api/health': async (req) => json(200, { ok: true, model: llm ? llm.model : null, aws: Boolean(aws), rules: table.version, colo: (req.cf || {}).colo || null }),
    'GET /api/rules': async (req) => {
      const u = new URL(req.url).searchParams;
      return json(200, rulesView({ type: u.get('type'), industry: u.get('industry'), amount: Number(u.get('amount')), civilStatus: u.get('civilStatus'), secured: u.get('secured') === 'true', bpiAccount: u.get('bpiAccount') === 'true' }));
    },
    'POST /api/case': async (req) => {
      const b = await body(req); if (!b || !validReferral(b.referral)) return bad('invalid referral');
      const ref = cleanReferral(b.referral);
      const c = (await store.get(ref.id)) || { referral: ref, events: [] };
      c.referral = ref; c.events.push({ type: c.events.length ? 'updated' : 'created', by: 'BM', at: at() });
      await store.put(ref.id, c);
      return json(200, await full(c));
    },
    // Every case with its status, newest first, for the BSO's list.
    'GET /api/cases': async () => {
      const ids = (await store.list()).filter((id) => ID.test(id));
      const cases = (await Promise.all(ids.map((id) => store.get(id)))).filter(Boolean).map((c) => {
        const o = openItems(c.events), r = c.referral;
        // After the first handoff: 'returned' if the BSO ever sent it back, 'complete' if endorsed with no return, else 'pending'.
        const h = c.events.findIndex((e) => e.type === 'handed_off'), after = h < 0 ? [] : c.events.slice(h);
        const firstHandoff = h < 0 ? null : after.some((e) => e.type === 'returned') ? 'returned' : after.some((e) => e.type === 'endorsed') ? 'complete' : 'pending';
        return { id: r.id, business: r.business, type: r.type, industry: r.industry, amount: r.amount, status: statusOf(c.events), open: o.defects.length + o.needsReview.length, updated: (c.events[c.events.length - 1] || {}).at || null, firstHandoff };
      });
      cases.sort((a, b) => String(b.updated || '').localeCompare(String(a.updated || '')));
      return json(200, { cases: cases.slice(0, MAX_LIST) });
    },
    'GET /api/case': async (req) => {
      const q = new URL(req.url).searchParams, id = q.get('id');
      if (!ID.test(id || '')) return bad('invalid id');
      const c = await store.get(id);
      if (q.has('exists')) return json(200, { exists: !!c }); // a free number is not an error
      if (!c) return json(404, { error: 'unknown referral' });
      return json(200, await full(c));
    },
    // Case fields from the branch officer's note. Nothing is saved here. The branch checks the form and saves the case.
    'POST /api/intake': async (req) => {
      const b = await body(req); if (!b || typeof b.text !== 'string' || !b.text.trim()) return bad('write the note first'); if (!str(b.text, INTAKE_MAX)) return bad(`write the note in ${INTAKE_MAX} characters or fewer`);
      const onAws = useAws(b.stack);
      if (onAws ? !aws : !llm) return onAws ? noAws() : json(503, { error: 'no model configured' });
      const text = b.text.trim();
      const failed = () => json(502, { error: 'The AI could not read the note. Fill the form by hand.' });
      let raw, model;
      try {
        if (onAws) {
          const r = await awsPost('/ask', { intake: text });
          const a = await r.json().catch(() => null);
          if (r.status !== 200 || !a) return failed();
          raw = a.fields; model = a.model || 'Amazon Bedrock';
        } else { raw = await llm.intake(text); model = llm.model; }
      } catch { return failed(); }
      return json(200, { fields: cleanIntake(raw, text), model, stack: onAws ? 'aws' : 'free' });
    },
    'POST /api/upload-url': async (req) => {
      const b = await body(req); if (!b || !ID.test(b.id || '') || !str(b.name, 200)) return bad('invalid upload');
      if (!aws) return noAws();
      if (!(await store.get(b.id))) return json(404, { error: 'save the case first' });
      const r = await awsPost('/upload-url', { referralId: b.id, name: b.name });
      return json(r.status === 200 ? 200 : 502, await r.json().catch(() => ({ error: 'the upload could not start' })));
    },
    'POST /api/check': async (req) => {
      const b = await body(req); if (!b || !ID.test(b.id || '')) return bad('invalid id');
      const onAws = b.pageKeys !== undefined;
      if (onAws ? !validKeys(b.id, b.pageKeys) : !validPages(b.pages)) return bad('invalid pages');
      if (onAws && !aws) return noAws();
      const c = await store.get(b.id); if (!c) return json(404, { error: 'save the case first' });
      if (statusOf(c.events) === 'Endorsed to Credit') return bad('this case is already endorsed to Credit');
      let result, trace, message = null, drafted = 'template', model = llm ? llm.model : null;
      if (onAws) {
        const send = () => awsPost('/check', { referral: c.referral, pageKeys: b.pageKeys });
        let r = await send();
        if (r.status === 503) r = await send(); // the HTTP API stops at 30 seconds. Without checkUrl, one retry covers a slow call
        const a = await r.json().catch(() => null);
        if (r.status !== 200 || !a || !a.result || !Array.isArray(a.result.defects) || !Array.isArray(a.result.needsReview)) return json(502, { error: `the AWS check did not finish (${r.status}). Try again.` });
        result = { ...a.result, complete: a.result.defects.length + a.result.needsReview.length === 0 };
        trace = Array.isArray(a.trace) ? a.trace : [];
        model = a.model || 'Amazon Bedrock';
        if (a.drafted === 'model' && str(a.message, 2000) && !FORBIDDEN.test(a.message)) { message = a.message; drafted = 'model'; }
      } else {
        const deps = {
          detectLines: async (_bytes, src) => src.lines,
          analyzeForm: async (_bytes, src) => formFromLines(src.lines),
          readPage: async (page) => (llm ? llm.readPage(page) : { unreadable: true }),
        };
        ({ result, trace } = await processPacket(c.referral, b.pages, deps, { today: now() }));
      }
      const rec = reconcile(openItems(c.events).defects, result.defects, result.needsReview);
      const items = [...rec.stillMissing, ...rec.newIssues, ...result.needsReview].map((d) => d.message);
      if (!onAws && llm && items.length) { try { message = await llm.draftMessage({ items, audience: 'branch' }); if (message) drafted = 'model'; } catch { /* template below */ } }
      message = message || templateDraft({ ...rec, newIssues: [...rec.newIssues, ...result.needsReview] });
      const pages = (b.pageKeys || b.pages).length;
      c.events.push({ type: result.complete ? 'check_passed' : 'check_failed', by: 'BM', at: at(), defects: result.defects, needsReview: result.needsReview, message, pages, ...(onAws ? { stack: 'aws' } : {}) });
      await store.put(b.id, c);
      return json(200, { result, reconcile: { resolved: rec.resolved.length, stillMissing: rec.stillMissing.length, newIssues: rec.newIssues.length }, message, drafted, trace, model, stack: onAws ? 'aws' : 'free', ...(await full(c)) });
    },
    'POST /api/event': async (req) => {
      const b = await body(req); if (!b || !ID.test(b.id || '') || !EVENT_TYPES.has(b.type)) return bad('invalid event');
      if (!['BM', 'BSO'].includes(b.by)) return bad('invalid by');
      const c = await store.get(b.id); if (!c) return json(404, { error: 'unknown referral' });
      if (statusOf(c.events) === 'Endorsed to Credit') return bad('this case is already endorsed to Credit');
      const o = openItems(c.events);
      const reason = typeof b.reason === 'string' ? b.reason.trim().slice(0, 300) : '';
      const ev = { type: b.type, by: b.by, at: at() };
      if (b.type === 'cleared') {
        if (!o.needsReview.some((d) => d.key === b.key)) return bad('nothing to clear with that key');
        if (!str(b.value, 120) || !reason) return bad('type the value from the paper and a reason');
        Object.assign(ev, { key: b.key, value: b.value.trim(), reason });
      } else if (b.type === 'waived') {
        if (b.by !== 'BSO') return bad('only the BSO can waive');
        if (!o.defects.some((d) => d.key === b.key) || !reason) return bad('waive needs an open defect and a reason');
        Object.assign(ev, { key: b.key, reason });
      } else if (b.type === 'handed_off') {
        if (!o.checked || o.defects.length || o.needsReview.length) return bad('not ready for BSO review');
        if (statusOf(c.events) === 'Returned by BSO') return bad('check the documents again before sending this back to the BSO');
      } else if (b.type === 'endorsed') {
        if (b.by !== 'BSO') return bad('only the BSO can endorse a case to Credit');
        if (statusOf(c.events) !== 'With BSO' || o.defects.length || o.needsReview.length) return bad('only a case with the BSO and nothing open can be endorsed');
      } else if (b.type === 'returned') {
        if (b.by !== 'BSO') return bad('only the BSO can return a case');
        if (statusOf(c.events) !== 'With BSO' || !reason) return bad('a return needs a case that is with the BSO and a reason');
        ev.reason = reason;
        let text = null;
        if (llm && llm.draftLesson) { try { text = await llm.draftLesson({ reason, type: c.referral.type, industry: c.referral.industry }); } catch { /* the reason itself below */ } }
        const drafted = text && !lessonProblem(text, c.referral) ? 'model' : 'reason';
        const ls = await lessons();
        ls.list.push({ id: `L-${ls.list.length + 1}`, status: 'draft', text: drafted === 'model' ? text.trim() : reason.slice(0, MAX_LESSON), drafted, type: c.referral.type, industry: c.referral.industry, fromCase: b.id, reason, at: ev.at });
        await store.put(LESSONS, ls);
      } else if (reason) ev.reason = reason;
      c.events.push(ev); await store.put(b.id, c);
      return json(200, await full(c));
    },
    'POST /api/lesson': async (req) => {
      const b = await body(req); if (!b || !['publish', 'retire'].includes(b.action)) return bad('invalid action');
      if (b.by !== 'BSO') return bad('only the BSO can publish or retire a heads-up');
      const ls = await lessons(), l = ls.list.find((x) => x.id === b.lessonId);
      if (!l || l.status === 'retired') return json(404, { error: 'unknown heads-up' });
      if (b.action === 'publish') {
        if (l.status !== 'draft' || !SCOPES.includes(b.scope)) return bad('publish needs a draft and a scope');
        const src = await store.get(l.fromCase);
        const problem = lessonProblem(b.text, src ? src.referral : {});
        if (problem) return bad(problem);
        // The scope 'industry' keeps structure and industry, 'type' keeps the structure only, and 'all' shows it on every case.
        Object.assign(l, { status: 'published', text: b.text.trim(), publishedAt: at() }, b.scope === 'industry' ? {} : { industry: null }, b.scope === 'all' ? { type: null } : {});
      } else Object.assign(l, { status: 'retired', retiredAt: at() }); // A retired heads-up is kept, so ids stay unique and the history stays readable.
      await store.put(LESSONS, ls);
      return json(200, { ok: true, id: l.id, status: l.status });
    },
    'POST /api/ask': async (req) => {
      const b = await body(req); if (!b || !ID.test(b.id || '')) return bad('invalid id');
      const q = b.question; if (typeof q !== 'string' || !q.trim() || q.length > 500) return bad('invalid question');
      if (refuseCredit(q)) return json(200, { answer: 'Hindi ko masasagot iyan. Ang Credit ang nagdedesisyon sa approval. Ang kaya kong sabihin: ano pa ang kulang at ano ang status.', handoff: true, trace: [{ rule: 'refuse_credit_question' }], model: null });
      const onAws = useAws(b.stack);
      if (!llm && !onAws) return json(503, { error: 'no model configured' });
      const c = await store.get(b.id);
      // an unsaved case can still get general requirement questions
      const handlers = !c ? {
        get_heads_up: async () => ({ reminders: [] }),
        get_status: async () => ({ status: 'Not saved yet', next: 'Fill the form and save the case first.' }),
        get_lacking: async () => ({ checked: false }),
        get_requirements: async (i) => requirementsFor(i),
        get_checklist: async () => null,
      } : {
        get_heads_up: async () => ({ reminders: shown((await lessons()).list, c.referral).map((l) => l.text) }),
        get_status: async () => { const status = statusOf(c.events), o = openItems(c.events); return { status, next: status === 'Missing requirements' && !o.defects.length ? 'May items na titingnan ng tao sa branch (toCheck). Hindi ito kailangang kunin sa client.' : NEXT[status] || null }; },
        get_lacking: async () => { const o = openItems(c.events); return o.checked ? { missing: o.defects.map((d) => d.message), toCheck: o.needsReview.map((d) => d.message) } : { checked: false }; },
        get_requirements: async (i) => requirementsFor(i),
        get_checklist: async () => checklist(c.referral).map((r) => ({ requirement: r.title, why: r.reason || (r.when.type ? `for a ${c.referral.type.toLowerCase()}` : 'all cases'), source: r.sourceTitle })),
      };
      let out, model = llm && llm.model;
      if (onAws) {
        if (!aws) return noAws();
        const facts = { status: await handlers.get_status(), lacking: await handlers.get_lacking(), checklist: await handlers.get_checklist(), headsUp: await handlers.get_heads_up() };
        const r = await awsPost('/ask', { question: q.trim(), facts });
        const a = await r.json().catch(() => null);
        if (r.status !== 200 || !a) return json(502, { error: 'The assistant is not available. Please ask the BSO.' });
        out = a; model = a.model || 'Amazon Bedrock';
      } else { try { out = await llm.ask(q.trim(), handlers); } catch { return json(502, { error: 'The assistant is not available. Please ask the BSO.' }); } }
      const raw = String(out.answer || '').replace(/\*\*?|__/g, '').trim(); // plain text on screen
      const answer = raw && raw.length <= 1500 && !FORBIDDEN.test(raw) ? raw : 'Hindi ko masagot nang tiyak. Pakitanong sa BSO.';
      return json(200, { answer, handoff: out.handoff || answer !== out.answer, trace: out.trace, model });
    },
  };

  return async function handle(req) {
    const u = new URL(req.url);
    const route = routes[`${req.method} ${u.pathname}`];
    if (!route) return json(404, { error: 'not found' });
    // The page needs no key. A caller without the demo key is rate limited, and the model routes also share a daily cap.
    const keyed = Boolean(demoKey) && req.headers.get('x-demo-key') === demoKey;
    if (limits && !keyed && u.pathname !== '/api/health') {
      const over = await limits(MODEL_ROUTES.has(u.pathname));
      if (over === 'rate') return json(429, { error: 'Too many requests. Please try again in a minute.' });
      if (over === 'daily') return json(429, { error: 'The demo has reached its limit for today. Please try again tomorrow.' });
    }
    try { return await route(req); } catch (e) { return json(500, { error: 'server error', detail: String(e.message || e).slice(0, 200) }); }
  };
}
