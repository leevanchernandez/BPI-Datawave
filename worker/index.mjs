// Cloudflare Worker entry: static pages from ./frontend, API under /api. KV holds one JSON record per case.
import { makeApi } from './api.mjs';
import geminiMod from '../backend/free/gemini.cjs';

const TTL = 30 * 86400; // synthetic cases expire after 30 days

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
    const store = {
      get: async (id) => env.CASES.get(`case:${id}`, 'json'),
      put: async (id, c) => env.CASES.put(`case:${id}`, JSON.stringify(c), { expirationTtl: TTL }),
    };
    const llm = env.GEMINI_API_KEY ? geminiMod.makeGemini({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL || 'gemini-3.5-flash-lite' }) : null;
    // The AWS backend takes the same demo key as this Worker.
    const aws = env.AWS_API_URL ? { url: env.AWS_API_URL, key: env.DEMO_KEY } : null;
    return makeApi({ store, llm, demoKey: env.DEMO_KEY, aws })(req);
  },
};
