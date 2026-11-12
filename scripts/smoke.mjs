#!/usr/bin/env node
// Smoke test for the deployed AWS stack, on the Elena storyline with the synthetic specimens in frontend/specimens/.
// Checks the key is enforced, uploads through /upload-url, runs /check for the first and second visit, asks one question.
// Run: API_URL=https://<id>.execute-api.ap-southeast-1.amazonaws.com DEMO_KEY=<key> node scripts/smoke.mjs
// Never prints the key or the presigned fields. Calls real Textract and Bedrock, so each run costs a little.
import { readFile } from 'node:fs/promises';

const { API_URL, DEMO_KEY } = process.env;
const fail = (msg) => { console.error(`smoke: ${msg}`); process.exit(1); };
if (!API_URL || !/^https:\/\/[^/\s]+\/?$/.test(API_URL)) fail('set API_URL to the ApiUrl stack output (https://..., no path)');
if (!DEMO_KEY) fail('set DEMO_KEY');
const api = API_URL.replace(/\/$/, '');

// Same referral as scripts/verify-free.mjs. Visit 1 has the first-visit form and one DTI page; visit 2 fixes both.
const REF = { id: 'RF-2026-042', business: "Elena's Artisan Bakery", name: 'Elena Santos', type: 'Sole proprietorship', industry: 'Food & beverage', amount: 750000, civilStatus: 'married', spouseName: 'Ramon Santos', secured: false, bpiAccount: true };
const COMMON = ['02-owner-id-front.png', '03-owner-id-back.png', '04-spouse-id-front.png', '05-dti-page-1.png', '09-bir-cor.png', '10-mayors-permit.png', '08-bank-statement.png', '11-client-authorization-letter.png'];
const VISITS = [['visit 1', ['01-application-form-first-visit.png', ...COMMON]], ['visit 2', ['01b-application-form-corrected.png', ...COMMON, '05b-dti-page-2.png']]];
const DIR = new URL('../frontend/specimens/', import.meta.url);

async function post(path, body, key = DEMO_KEY) {
  const r = await fetch(api + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-demo-key': key }, body: JSON.stringify(body) });
  const text = await r.text();
  try { return { status: r.status, body: JSON.parse(text) }; } catch { return { status: r.status, body: text }; }
}

const keys = new Map(); // file name -> S3 key, so visit 2 uploads only the new pages
async function upload(name) {
  if (keys.has(name)) return keys.get(name);
  const u = await post('/upload-url', { referralId: REF.id, name });
  if (u.status !== 200) fail(`/upload-url ${name}: ${u.status} ${JSON.stringify(u.body).slice(0, 300)}`);
  const form = new FormData();
  for (const [k, v] of Object.entries(u.body.fields)) form.append(k, v);
  form.append('file', new Blob([await readFile(new URL(name, DIR))], { type: u.body.contentType }), name); // file goes last
  const r = await fetch(u.body.url, { method: 'POST', body: form });
  if (r.status !== 204) fail(`S3 upload ${name}: ${r.status} ${(await r.text()).slice(0, 300)}`);
  keys.set(name, u.body.key);
  return u.body.key;
}

const denied = await post('/check', {}, 'not-the-key');
if (denied.status !== 401) fail(`expected 401 with a wrong key, got ${denied.status}`);
console.log('key enforced: 401 without the right x-demo-key');

for (const [label, files] of VISITS) {
  const pageKeys = [];
  for (const f of files) pageKeys.push(await upload(f));
  const t0 = Date.now();
  const r = await post('/check', { referral: REF, pageKeys });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  if (r.status !== 200) fail(`${label} /check: ${r.status} after ${secs}s (API Gateway stops at 30 s) ${JSON.stringify(r.body).slice(0, 500)}`);
  const { result, status, message } = r.body;
  console.log(`\n${label}: ${files.length} pages, ${secs}s, status "${status}", complete ${result.complete}`);
  for (const d of result.defects) console.log(`  defect  ${d.message}`);
  for (const d of result.needsReview) console.log(`  review  ${d.message}`);
  console.log(`  message ${message}`);
  console.log(`  usage   ${JSON.stringify(r.body.usage)}`);
}

const a = await post('/ask', { referralId: REF.id, question: 'Ano pa ang kulang sa RF-2026-042?' });
if (a.status !== 200) fail(`/ask: ${a.status} ${JSON.stringify(a.body).slice(0, 300)}`);
console.log(`\nask: ${a.body.answer}${a.body.handoff ? ' (handoff)' : ''}`);
console.log(`  usage   ${JSON.stringify(a.body.usage)}`);
