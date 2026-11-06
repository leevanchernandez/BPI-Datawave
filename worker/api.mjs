// Counter Check API on Cloudflare Workers (free stack). Pure functions over a small store, so it is testable in Node.
// TRUST BOUNDARY: the referral is saved once (POST /api/case) and every check reads it from the store, never from the
// caller. There is no bank login: a shared demo key protects the model quota. Synthetic data only.
import pipelineMod from '../backend/pipeline.cjs';
import reconcileMod from '../backend/reconcile.cjs';
import rulesMod from '../backend/rules.cjs';
import formMod from '../backend/free/formtext.cjs';
import guardsMod from '../backend/free/guards.cjs';

const { processPacket } = pipelineMod;
const { reconcile, draftMessage: templateDraft, deriveStatus } = reconcileMod;
const { checklist, table, civilOf } = rulesMod;
const { formFromLines } = formMod;
const { refuseCredit, FORBIDDEN } = guardsMod;

const ID = /^RF-\d{4}-\d{3}$/;
const TYPES = ['Sole proprietorship', 'Partnership', 'Corporation'];
const MAX_PAGES = 20, MAX_LINES = 300, MAX_LINE = 300;
const EVENT_TYPES = new Set(['cleared', 'waived', 'handed_off', 'bso_opened', 'draft_approved', 'special_case']);
const str = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;

export function validReferral(r) {
  return !!r && typeof r === 'object' && ID.test(r.id || '') && TYPES.includes(r.type)
    && str(r.industry, 80) && str(r.business, 120) && str(r.name, 120)
    && typeof r.amount === 'number' && Number.isFinite(r.amount) && r.amount > 0 && r.amount < 1e11
    && civilOf(r.civilStatus) !== null
    && (r.spouseName == null || r.spouseName === '' || str(r.spouseName, 120))
    && (r.secured == null || typeof r.secured === 'boolean');
}
const cleanReferral = (r) => ({ id: r.id, business: r.business.trim(), name: r.name.trim(), type: r.type, industry: r.industry.trim(), amount: r.amount, civilStatus: civilOf(r.civilStatus), spouseName: (r.spouseName || '').trim(), secured: Boolean(r.secured) });

function validPages(pages) {
  return Array.isArray(pages) && pages.length > 0 && pages.length <= MAX_PAGES && pages.every((p) =>
    p && Array.isArray(p.lines) && p.lines.length <= MAX_LINES && (p.docType == null || typeof p.docType === 'string')
    && p.lines.every((l) => l && typeof l.text === 'string' && l.text.length <= MAX_LINE && typeof l.conf === 'number' && l.conf >= 0 && l.conf <= 1));
}

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

export function makeApi({ store, llm, now = () => new Date(), demoKey }) {
  const json = (code, body) => new Response(JSON.stringify(body), { status: code, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  const bad = (m) => json(400, { error: m });
  const view = (c) => {
    const lastCheck = [...c.events].reverse().find((e) => e.type === 'check_failed' || e.type === 'check_passed');
    return { referral: c.referral, events: c.events.map(({ defects, needsReview, ...e }) => e), status: statusOf(c.events), open: openItems(c.events), lastMessage: lastCheck ? lastCheck.message : null, rules: rulesView(c.referral) };
  };
  const at = () => now().toISOString();

  async function body(req) { try { return await req.json(); } catch { return null; } }

  const routes = {
    'GET /api/health': async (req) => json(200, { ok: true, model: llm ? llm.model : null, rules: table.version, colo: (req.cf || {}).colo || null }),
    'GET /api/rules': async (req) => {
      const u = new URL(req.url).searchParams;
      return json(200, rulesView({ type: u.get('type'), industry: u.get('industry'), amount: Number(u.get('amount')), civilStatus: u.get('civilStatus'), secured: u.get('secured') === 'true' }));
    },
    'POST /api/case': async (req) => {
      const b = await body(req); if (!b || !validReferral(b.referral)) return bad('invalid referral');
      const ref = cleanReferral(b.referral);
      const c = (await store.get(ref.id)) || { referral: ref, events: [] };
      c.referral = ref; c.events.push({ type: c.events.length ? 'updated' : 'created', by: 'BM', at: at() });
      await store.put(ref.id, c);
      return json(200, view(c));
    },
    'GET /api/case': async (req) => {
      const id = new URL(req.url).searchParams.get('id');
      if (!ID.test(id || '')) return bad('invalid id');
      const c = await store.get(id); if (!c) return json(404, { error: 'unknown referral' });
      return json(200, view(c));
    },
    'POST /api/check': async (req) => {
      const b = await body(req); if (!b || !ID.test(b.id || '')) return bad('invalid id');
      if (!validPages(b.pages)) return bad('invalid pages');
      const c = await store.get(b.id); if (!c) return json(404, { error: 'save the case first' });
      const deps = {
        detectLines: async (_bytes, src) => src.lines,
        analyzeForm: async (_bytes, src) => formFromLines(src.lines),
        readPage: async (page) => (llm ? llm.readPage(page) : { unreadable: true }),
      };
      const prev = openItems(c.events);
      const { result, trace } = await processPacket(c.referral, b.pages, deps, { today: now() });
      const rec = reconcile(prev.defects, result.defects, result.needsReview);
      const items = [...rec.stillMissing, ...rec.newIssues, ...result.needsReview].map((d) => d.message);
      let message = null, drafted = 'template';
      if (llm && items.length) { try { message = await llm.draftMessage({ items, audience: 'branch' }); if (message) drafted = 'model'; } catch { /* template below */ } }
      message = message || templateDraft({ ...rec, newIssues: [...rec.newIssues, ...result.needsReview] });
      c.events.push({ type: result.complete ? 'check_passed' : 'check_failed', by: 'BM', at: at(), defects: result.defects, needsReview: result.needsReview, message, pages: b.pages.length });
      await store.put(b.id, c);
      return json(200, { result, reconcile: { resolved: rec.resolved.length, stillMissing: rec.stillMissing.length, newIssues: rec.newIssues.length }, message, drafted, trace, model: llm ? llm.model : null, ...view(c) });
    },
    'POST /api/event': async (req) => {
      const b = await body(req); if (!b || !ID.test(b.id || '') || !EVENT_TYPES.has(b.type)) return bad('invalid event');
      if (!['BM', 'BSO'].includes(b.by)) return bad('invalid by');
      const c = await store.get(b.id); if (!c) return json(404, { error: 'unknown referral' });
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
      } else if (reason) ev.reason = reason;
      c.events.push(ev); await store.put(b.id, c);
      return json(200, view(c));
    },
    'POST /api/ask': async (req) => {
      const b = await body(req); if (!b || !ID.test(b.id || '')) return bad('invalid id');
      const q = b.question; if (typeof q !== 'string' || !q.trim() || q.length > 500) return bad('invalid question');
      if (refuseCredit(q)) return json(200, { answer: 'Hindi ko masasagot iyan. Ang Credit ang nagdedesisyon sa approval. Ang kaya kong sabihin: ano pa ang kulang at ano ang status.', handoff: true, trace: [{ rule: 'refuse_credit_question' }], model: null });
      if (!llm) return json(503, { error: 'no model configured' });
      const c = await store.get(b.id); if (!c) return json(404, { error: 'unknown referral' });
      const handlers = {
        get_status: async () => ({ status: statusOf(c.events) }),
        get_lacking: async () => { const o = openItems(c.events); return o.checked ? { missing: o.defects.map((d) => d.message), toCheck: o.needsReview.map((d) => d.message) } : { checked: false }; },
        get_checklist: async () => checklist(c.referral).map((r) => ({ requirement: r.title, why: r.reason || (r.when.type ? `for a ${c.referral.type.toLowerCase()}` : 'all cases'), source: r.sourceTitle })),
      };
      const out = await llm.ask(q.trim(), handlers);
      const raw = String(out.answer || '').replace(/\*\*?|__/g, '').trim(); // plain text on screen
      const answer = raw && raw.length <= 1500 && !FORBIDDEN.test(raw) ? raw : 'Hindi ko masagot nang tiyak. Pakitanong sa BSO.';
      return json(200, { answer, handoff: out.handoff || answer !== out.answer, trace: out.trace, model: llm.model });
    },
  };

  return async function handle(req) {
    const u = new URL(req.url);
    const route = routes[`${req.method} ${u.pathname}`];
    if (!route) return json(404, { error: 'not found' });
    if (demoKey && u.pathname !== '/api/health' && req.headers.get('x-demo-key') !== demoKey) return json(401, { error: 'demo key required' });
    try { return await route(req); } catch (e) { return json(500, { error: 'server error', detail: String(e.message || e).slice(0, 200) }); }
  };
}
