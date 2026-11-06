'use strict';
// API Gateway (HTTP API v2) Lambda handlers. Thin: validate, call pipeline/reconcile, return JSON.
// Document bytes come from S3 (browser uploads with a presigned URL). No document content is logged.
const { processPacket } = require('./pipeline.cjs');
const { reconcile, draftMessage, deriveStatus } = require('./reconcile.cjs');
const { checklist } = require('./rules.cjs');

const MAX_PAGES = 40;
const json = (code, body) => ({ statusCode: code, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const bad = (msg) => json(400, { error: msg });

function validReferral(r) {
  return r && typeof r === 'object' && typeof r.id === 'string' && /^RF-\d{4}-\d{3}$/.test(r.id)
    && ['Sole proprietorship', 'Partnership', 'Corporation'].includes(r.type) && typeof r.industry === 'string'
    && Number.isFinite(Number(r.amount)) && typeof r.business === 'string';
}

// Dependencies are built once per container and injectable for tests.
function makeHandlers(deps) {
  return {
    /** POST /check  { referral, pageKeys: ["uploads/..."] } */
    async check(event) {
      let body; try { body = JSON.parse(event.body || '{}'); } catch { return bad('invalid json'); }
      if (!validReferral(body.referral)) return bad('invalid referral');
      const keys = body.pageKeys;
      if (!Array.isArray(keys) || !keys.length || keys.length > MAX_PAGES || !keys.every((k) => typeof k === 'string' && /^uploads\/[\w./-]+$/.test(k) && !k.includes('..'))) return bad('invalid pageKeys');
      const pages = await Promise.all(keys.map((k) => deps.loadPage(k)));
      const prev = await deps.store.lastDefects(body.referral.id);
      const { result, pages: provenance } = await processPacket(body.referral, pages, deps);
      const rec = reconcile(prev, result.defects);
      const items = [...rec.stillMissing, ...rec.newIssues, ...result.needsReview].map((d) => d.message);
      let message = null;
      if (deps.draftMessage && items.length) { try { message = await deps.draftMessage({ items, audience: 'branch' }); } catch { /* template fallback below */ } }
      message = message || draftMessage({ ...rec, newIssues: [...rec.newIssues, ...result.needsReview] });
      const eventType = result.complete ? 'check_passed' : 'check_failed';
      await deps.store.record(body.referral.id, { type: eventType, defects: result.defects, at: new Date().toISOString() });
      return json(200, { result, reconcile: rec, message, pages: provenance, status: deriveStatus(await deps.store.events(body.referral.id)) });
    },
    /** POST /ask  { question } */
    async ask(event) {
      let body; try { body = JSON.parse(event.body || '{}'); } catch { return bad('invalid json'); }
      const q = body.question;
      if (typeof q !== 'string' || !q.trim() || q.length > 500) return bad('invalid question');
      const handlers = {
        get_status: async ({ referralId }) => ({ referralId, status: deriveStatus(await deps.store.events(referralId)) }),
        get_lacking: async ({ referralId }) => ({ referralId, lacking: (await deps.store.lastDefects(referralId)).map((d) => d.message) }),
        get_checklist: async (r) => ({ requirements: checklist(r).map((x) => x.title), note: 'Sample rules. Confirm against the bank guidebook.' }),
      };
      return json(200, await deps.ask(q.trim(), handlers));
    },
  };
}

module.exports = { makeHandlers, validReferral };
