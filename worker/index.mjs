// Cloudflare Worker entry: static pages from ./frontend, API under /api. KV holds one JSON record per case.
import { DurableObject } from 'cloudflare:workers';
import { makeApi, takeQuota } from './api.mjs';
import geminiMod from '../backend/free/gemini.cjs';

const TTL = 30 * 86400; // synthetic cases expire after 30 days

/** One object counts every caller, so the limits are exact. */
export class Quota extends DurableObject {
  // The minute counts live in memory. The day count is stored, so it survives a restart of the object.
  async take(ip, model) {
    this.s ||= { ...(await this.ctx.storage.get('day')) };
    const out = takeQuota(this.s, ip, model);
    if (model && out === 'ok') await this.ctx.storage.put('day', { day: this.s.day, n: this.s.n });
    return out;
  }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
    const store = {
      get: async (id) => env.CASES.get(`case:${id}`, 'json'),
      put: async (id, c) => env.CASES.put(`case:${id}`, JSON.stringify(c), { expirationTtl: TTL }),
      list: async () => (await env.CASES.list({ prefix: 'case:' })).keys.map((k) => k.name.slice(5)),
    };
    const llm = env.GEMINI_API_KEY ? geminiMod.makeGemini({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL || 'gemini-3.5-flash-lite' }) : null;
    const ip = req.headers.get('cf-connecting-ip') || 'unknown';
    // ponytail: one global object. Split it by address if the demo ever gets real traffic.
    const limits = (model) => env.QUOTA.get(env.QUOTA.idFromName('global')).take(ip, model);
    // The AWS backend still needs the demo key, and only this Worker sends it.
    const aws = env.AWS_API_URL ? { url: env.AWS_API_URL, key: env.DEMO_KEY } : null;
    return makeApi({ store, llm, demoKey: env.DEMO_KEY, aws, limits })(req);
  },
};
