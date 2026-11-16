'use strict';
// API Gateway (HTTP API v2) Lambda handlers. Thin: validate, call pipeline and reconcile, return JSON.
// Document pages are uploaded to S3 under uploads/{referralId}/ with a presigned POST from /upload-url, then read by /check.
// TRUST BOUNDARY: this prototype accepts the referral from the caller. In production the referral (type, industry,
// amount, names) must be loaded server-side by id from the bank's own system and the caller must be authenticated
// and authorised for that case. The demo has only a shared x-demo-key header; production needs IAM or Cognito.
const crypto = require('node:crypto');
const { processPacket } = require('./pipeline.cjs');
const { reconcile, draftMessage, deriveStatus } = require('./reconcile.cjs');
const { checklist, requirementsFor } = require('./rules.cjs');
const { cleanIntake, INTAKE_MAX } = require('./free/guards.cjs');
const { classify, formNote } = require('./classify.cjs');

const MAX_PAGES = 20; // HTTP API integrations time out at 30 seconds, so keep one request small
const ID = /^RF-\d{4}-\d{3}$/;
const json = (code, body) => ({ statusCode: code, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const bad = (msg) => json(400, { error: msg });
const str = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;

function validReferral(r) {
  return !!r && typeof r === 'object' && ID.test(r.id || '')
    && ['Sole proprietorship', 'Partnership', 'Corporation'].includes(r.type)
    && str(r.industry, 80) && str(r.business, 120) && str(r.name, 120)
    && typeof r.amount === 'number' && Number.isFinite(r.amount) && r.amount > 0 && r.amount < 1e11;
}
const validKey = (id, k) => typeof k === 'string' && k.startsWith(`uploads/${id}/`) && /^uploads\/RF-\d{4}-\d{3}\/[\w.-]{1,100}$/.test(k);

const UPLOAD_TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', pdf: 'application/pdf' };
const UPLOAD_MAX_BYTES = 5 * 1024 * 1024; // under the Textract sync limit (10 MB). The Bedrock image limit is unverified.
const UPLOAD_TTL = 300; // seconds
/** Object key for an upload, or null. Keeps [\w.-], drops path parts and leading dots, keeps the extension. */
function uploadKey(id, name) {
  if (!ID.test(id || '') || typeof name !== 'string' || name.length > 200) return null;
  const safe = name.split(/[\\/]/).pop().replace(/[^\w.-]+/g, '-').replace(/^[.-]+/, '').slice(-100);
  const ext = (/\.([a-z]+)$/i.exec(safe) || [])[1];
  const key = `uploads/${id}/${safe}`;
  return ext && UPLOAD_TYPES[ext.toLowerCase()] && validKey(id, key) ? { key, contentType: UPLOAD_TYPES[ext.toLowerCase()] } : null;
}

const msgs = (list) => list.map((d) => d.message);

// Compare SHA-256 digests with timingSafeEqual: constant time, and the key length does not leak either.
const digest = (v) => crypto.createHash('sha256').update(v).digest();
const sameKey = (given, want) => typeof given === 'string' && typeof want === 'string' && want.length > 0 && crypto.timingSafeEqual(digest(given), digest(want));

// Dependencies are built once per container and injectable for tests. Every route needs deps.demoKey in x-demo-key;
// with no key configured every request is refused.
function makeHandlers(deps) {
  /** POST /check { formImages: [base64 JPEG, ...] } fills case fields from photos of BPI's application form. Nothing is stored. */
  async function readForm(images) {
    if (!Array.isArray(images) || !images.length || images.length > 6 || !images.every((s) => str(s, 2e6))) return bad('invalid formImages');
    usage();
    const kv = {}; let found = 0;
    for (const b64 of images) {
      const bytes = Buffer.from(b64, 'base64');
      if (classify(await deps.detectLines(bytes)).docType !== 'application_form') continue;
      found++;
      for (const [k, v] of Object.entries(await deps.analyzeForm(bytes))) if (!kv[k] || (!kv[k].value && v.value)) kv[k] = v;
    }
    const note = found ? formNote(kv).slice(0, INTAKE_MAX) : '';
    const fields = note ? cleanIntake(await deps.intake(note), note) : {};
    return json(200, { fields, note, found, usage: usage(), model: deps.model || null });
  }
  // Model tokens used by one request. The call at the start of a route clears what an earlier failed request left.
  const usage = () => (deps.takeUsage ? deps.takeUsage() : null);
  const routes = {
    /** POST /check  { referral, pageKeys: ["uploads/RF-2026-042/page1.jpg", ...] } */
    async check(event) {
      let body; try { body = JSON.parse(event.body || '{}'); } catch { return bad('invalid json'); }
      if (body.formImages !== undefined) return readForm(body.formImages);
      if (!validReferral(body.referral)) return bad('invalid referral');
      const id = body.referral.id, keys = body.pageKeys;
      if (!Array.isArray(keys) || !keys.length || keys.length > MAX_PAGES || !keys.every((k) => validKey(id, k))) return bad('invalid pageKeys');
      usage();
      const pages = await Promise.all(keys.map((k) => deps.loadPage(k)));
      const prev = await deps.store.lastOpen(id);
      const request = str(body.request, 300) ? body.request.trim() : undefined;
      const { result, pages: provenance, trace } = await processPacket(body.referral, pages, deps, { request });
      const rec = reconcile(prev.defects, result.defects, result.needsReview);
      const items = msgs([...rec.stillMissing, ...rec.newIssues, ...result.needsReview]);
      let message = null, drafted = 'template';
      if (deps.draftMessage && items.length) { try { message = await deps.draftMessage({ items, audience: 'branch' }); if (message) drafted = 'model'; } catch { /* template fallback below */ } }
      message = message || draftMessage({ ...rec, newIssues: [...rec.newIssues, ...result.needsReview] });
      await deps.store.record(id, { type: result.complete ? 'check_passed' : 'check_failed', defects: result.defects, needsReview: result.needsReview, at: new Date().toISOString() });
      // Textract reads every page for text lines, and the Forms pass runs on application form pages only.
      const used = { pages: pages.length, formPages: trace.filter((t) => t.docType === 'application_form').length, ...usage() };
      return json(200, { result, reconcile: rec, message, drafted, trace, usage: used, model: deps.model || null, pages: provenance, status: deriveStatus(await deps.store.events(id)) });
    },
    /** POST /ask  { referralId, question }. Tools are bound to that one referral. POST /ask { intake } fills case fields from a note. */
    async ask(event) {
      let body; try { body = JSON.parse(event.body || '{}'); } catch { return bad('invalid json'); }
      // ponytail: the intake shares this route, so the deploy needs no new API route. Give it its own route when it grows.
      usage();
      if (body.intake !== undefined) {
        if (typeof body.intake !== 'string' || !body.intake.trim() || body.intake.length > INTAKE_MAX) return bad('invalid intake');
        return json(200, { fields: cleanIntake(await deps.intake(body.intake.trim()), body.intake), usage: usage(), model: deps.model || null });
      }
      if (body.facts && typeof body.facts === 'object') { // the Worker loaded the case, so the tools answer from these facts
        const f = body.facts, q = body.question;
        if (typeof q !== 'string' || !q.trim() || q.length > 500) return bad('invalid question');
        const handlers = { get_status: async () => f.status ?? null, get_lacking: async () => f.lacking ?? null, get_checklist: async () => f.checklist ?? null, get_heads_up: async () => f.headsUp ?? null, get_requirements: async (i) => requirementsFor(i) };
        return json(200, { ...(await deps.askCase(q.trim(), handlers)), usage: usage(), model: deps.model || null });
      }
      const q = body.question, id = body.referralId;
      if (typeof q !== 'string' || !q.trim() || q.length > 500) return bad('invalid question');
      if (!ID.test(id || '')) return bad('invalid referralId');
      const own = (input) => { if (input.referralId !== id) throw new Error('referral not allowed'); };
      const handlers = {
        get_status: async (i) => { own(i); const ev = await deps.store.events(id); return ev.length ? { referralId: id, status: deriveStatus(ev) } : { referralId: id, known: false }; },
        get_lacking: async (i) => { own(i); const ev = await deps.store.events(id); if (!ev.length) return { referralId: id, known: false }; const o = await deps.store.lastOpen(id); return { referralId: id, defects: msgs(o.defects), needsReview: msgs(o.needsReview) }; },
        get_checklist: async (r) => ({ requirements: checklist(r).map((x) => x.title), note: 'Sample rules. Confirm against the bank guidebook.' }),
      };
      return json(200, { ...(await deps.ask(q.trim(), handlers)), usage: usage() });
    },
    /** POST /upload-url  { referralId, name } -> { url, fields, key }. The browser POSTs the file as multipart form data. */
    async uploadUrl(event) {
      let body; try { body = JSON.parse(event.body || '{}'); } catch { return bad('invalid json'); }
      if (!ID.test(body.referralId || '')) return bad('invalid referralId');
      const u = uploadKey(body.referralId, body.name);
      if (!u) return bad('invalid name: use a .jpg, .jpeg, .png or .pdf file name');
      const post = await deps.presignUpload({ ...u, maxBytes: UPLOAD_MAX_BYTES, expiresIn: UPLOAD_TTL });
      return json(200, { url: post.url, fields: post.fields, key: u.key, contentType: u.contentType, maxBytes: UPLOAD_MAX_BYTES, expiresIn: UPLOAD_TTL });
    },
  };
  const authed = (fn) => async (event) => (sameKey((event.headers || {})['x-demo-key'], deps.demoKey) ? fn(event) : json(401, { error: 'demo key required' }));
  return Object.fromEntries(Object.entries(routes).map(([name, fn]) => [name, authed(fn)]));
}

module.exports = { makeHandlers, validReferral, validKey, uploadKey };
