#!/usr/bin/env node
// Simulated phone-photo test on the deployed AWS stack. It damages the synthetic specimens with ImageMagick at three
// levels (tilt, perspective, blur, shadow, noise, JPEG), then sends packets that each carry one known defect.
// This is a stand-in for the printed and phone-photographed test in docs/demo-script.md. It does not replace it.
// Run it with API_URL=https://<id>.execute-api.ap-southeast-1.amazonaws.com DEMO_KEY=<key> node scripts/eval-degraded.mjs
// PHOTOS=<folder> runs the same packets on real phone photos of the printed specimens instead (docs/demo-script.md).
// It needs ImageMagick 7 (magick). It makes 36 /check calls on real Textract and Bedrock and takes about 9 minutes.
// CASE=<text> runs only the cases whose label contains that text.
// Never prints the key or the presigned fields.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { API_URL, DEMO_KEY } = process.env;
const fail = (msg) => { console.error(`eval: ${msg}`); process.exit(1); };
if (!API_URL || !/^https:\/\/[^/\s]+\/?$/.test(API_URL)) fail('set API_URL to the ApiUrl output (https://..., no path)');
if (!DEMO_KEY) fail('set DEMO_KEY');
const api = API_URL.replace(/\/$/, '');
const SRC = fileURLToPath(new URL('../frontend/specimens/', import.meta.url));

// Same Elena referral as scripts/smoke.mjs. Each level gets its own referral id so the demo case keeps its history.
const REF = { business: "Elena's Artisan Bakery", name: 'Elena Santos', type: 'Sole proprietorship', industry: 'Food & beverage', amount: 750000, civilStatus: 'married', spouseName: 'Ramon Santos', secured: false, bpiAccount: true };
const FULL = ['01b-application-form-corrected', '02-owner-id-front', '03-owner-id-back', '04-spouse-id-front', '05-dti-page-1', '05b-dti-page-2', '09-bir-cor', '10-mayors-permit', '08-bank-statement', '11-client-authorization-letter'];
const without = (...drop) => FULL.filter((f) => !drop.includes(f));
// [label, pages, the defect key the checker must raise (null for the complete packet), referral fields to change]
const CASES = [
  ['complete packet', FULL, null],
  ['TIN left blank', ['01-application-form-first-visit', ...without('01b-application-form-corrected')], 'BLANK_FIELD:tin'],
  ['DTI page 2 missing', without('05b-dti-page-2'), 'MISSING_PAGE:dti#2'],
  ['DTI missing', without('05-dti-page-1', '05b-dti-page-2'), 'MISSING_DOC:dti'],
  ['ID back missing', without('03-owner-id-back'), 'ID_SIDE_MISSING:back'],
  ['spouse ID missing', without('04-spouse-id-front'), 'MISSING_DOC:spouse_id'],
  ['BIR COR missing', without('09-bir-cor'), 'MISSING_DOC:bir_cor'],
  ["mayor's permit missing", without('10-mayors-permit'), 'MISSING_DOC:mayors_permit'],
  ['bank statement missing', without('08-bank-statement'), 'MISSING_DOC:bank_statements'],
  ['authorization letter missing', without('11-client-authorization-letter'), 'MISSING_DOC:cal_sole'],
  // These two send Elena's packet under another client's referral. They pass only if the names are read off the photos.
  ['owner name differs from referral', FULL, 'REFERRAL_MISMATCH_OWNER:gov_id', { name: 'Maria Cruz' }],
  ['business name differs from referral', FULL, 'REFERRAL_MISMATCH_BUSINESS:business_permit', { business: 'Cruz Hardware' }],
].filter((c) => c[0].includes(process.env.CASE || ''));
if (!CASES.length) fail('CASE matches no case label');
// PHOTOS=<folder> uses real phone photos of the printed specimens, one per page, named like the specimen (02-owner-id-front.jpg).
const PHOTOS = process.env.PHOTOS;
const srcOf = (f) => PHOTOS ? ['jpg', 'jpeg', 'png', 'JPG', 'JPEG', 'PNG'].map((x) => join(PHOTOS, `${f}.${x}`)).find(existsSync) : join(SRC, `${f}.png`);
for (const f of new Set(CASES.flatMap((c) => c[1]))) if (!srcOf(f) || !existsSync(srcOf(f))) fail(`missing ${PHOTOS ? `photo ${f}.jpg in ${PHOTOS}` : `specimen ${f}.png`}`);

// ponytail: fixed ImageMagick recipes, not real photos. Swap in real phone photos by pointing SRC at them.
// The red SPECIMEN watermark is dropped first (red channel only), because Textract reads it as text once the page is
// a JPEG photo and then loses the fields around it. Each page still says SPECIMEN in its printed text.
// KEEP_WATERMARK=1 keeps it, to measure that effect.
const CLEAN = process.env.KEEP_WATERMARK ? [] : ['-channel', 'R', '-separate', '+channel'];
const SKEW = '0,0 %[fx:w*0.05],%[fx:h*0.03] %[fx:w],0 %[fx:w*0.97],0 0,%[fx:h] 0,%[fx:h] %[fx:w],%[fx:h] %[fx:w*0.93],%[fx:h*0.96]';
const SHADOW = ['(', '+clone', '-sparse-color', 'Barycentric', '0,0 white %[fx:w],%[fx:h] gray45', ')', '-compose', 'Multiply', '-composite'];
const LEVELS = PHOTOS ? [['phone', 'RF-2026-804', ['-auto-orient', '-resize', '2000x2000>', '-quality', '85']]] : [
  ['light', 'RF-2026-801', ['-background', '#cfcfcf', '-rotate', '1.5', '-resize', '80%', '-blur', '0x0.4', '-quality', '70']],
  ['medium', 'RF-2026-802', ['-seed', '42', '-background', '#9a9a9a', '-virtual-pixel', 'background', '-distort', 'Perspective', SKEW, '-rotate', '-3', '-resize', '65%', '-blur', '0x0.9', '-brightness-contrast', '-8x-10', '-attenuate', '0.3', '+noise', 'Gaussian', '-quality', '50']],
  ['heavy', 'RF-2026-803', ['-seed', '42', '-background', '#777', '-virtual-pixel', 'background', '-distort', 'Perspective', SKEW, '-rotate', '6', ...SHADOW, '-resize', '50%', '-blur', '0x1.3', '-attenuate', '0.6', '+noise', 'Gaussian', '-quality', '30']],
];

// ponytail: post and upload are copied from scripts/smoke.mjs, which runs on import and so cannot be imported.
async function post(path, body) {
  const r = await fetch(api + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-demo-key': DEMO_KEY }, body: JSON.stringify(body) });
  const text = await r.text();
  try { return { status: r.status, body: JSON.parse(text) }; } catch { return { status: r.status, body: text }; }
}
async function upload(id, file) {
  const name = file.split('/').pop();
  const u = await post('/upload-url', { referralId: id, name });
  if (u.status !== 200) fail(`/upload-url ${name}: ${u.status} ${JSON.stringify(u.body).slice(0, 300)}`);
  const form = new FormData();
  for (const [k, v] of Object.entries(u.body.fields)) form.append(k, v);
  form.append('file', new Blob([readFileSync(file)], { type: u.body.contentType }), name); // file goes last
  const r = await fetch(u.body.url, { method: 'POST', body: form });
  if (r.status !== 204) fail(`S3 upload ${name}: ${r.status} ${(await r.text()).slice(0, 300)}`);
  return u.body.key;
}

const tmp = mkdtempSync(join(tmpdir(), 'cc-eval-'));
process.on('exit', () => rmSync(tmp, { recursive: true, force: true }));
const rows = [];
for (const [level, id, recipe] of LEVELS) {
  const keys = {};
  for (const f of new Set(CASES.flatMap((c) => c[1]))) {
    const out = join(tmp, `${level}-${f}.jpg`);
    execFileSync('magick', [srcOf(f), ...CLEAN, ...recipe, out]);
    keys[f] = await upload(id, out);
  }
  for (const [label, files, want, patch] of CASES) {
    const t0 = Date.now();
    const r = await post('/check', { referral: { ...REF, ...patch, id }, pageKeys: files.map((f) => keys[f]) });
    const secs = (Date.now() - t0) / 1000;
    const res = r.status === 200 ? r.body.result : { defects: [], needsReview: [], complete: false };
    const found = res.defects.map((d) => d.key);
    // "caught" means the planted defect is named. "held for review" means it is not named but the packet did not pass.
    // "FALSE COMPLETE" means a defective packet passed.
    const outcome = r.status !== 200 ? `error ${r.status}` : !want ? (res.complete ? 'clean pass' : 'not passed') : found.includes(want) ? 'caught' : res.complete ? 'FALSE COMPLETE' : 'held for review';
    // A wrong referral name shows on every document that carries the name, so the same code on other documents is expected.
    const extra = found.filter((k) => k !== want && !(patch && k.startsWith(`${want.split(':')[0]}:`)));
    rows.push({ level, label, want, outcome, extra, review: res.needsReview.map((d) => d.key), secs });
    console.log(`${level.padEnd(7)}${label.padEnd(38)}${outcome.padEnd(16)}${secs.toFixed(1).padStart(5)}s  extra defects ${JSON.stringify(extra)}  review ${JSON.stringify(rows.at(-1).review)}`);
  }
}

const count = (list, fn) => list.filter(fn).length;
console.log('\nlevel    planted  caught  held  false-complete  wrong-defects  packets-with-review  median-s  max-s');
for (const level of [...LEVELS.map((l) => l[0]), 'all']) {
  const set = rows.filter((r) => level === 'all' || r.level === level), planted = set.filter((r) => r.want);
  const t = set.map((r) => r.secs).sort((a, b) => a - b);
  console.log([level.padEnd(8), planted.length, count(planted, (r) => r.outcome === 'caught'), count(planted, (r) => r.outcome === 'held for review'), count(planted, (r) => r.outcome === 'FALSE COMPLETE'),
    set.reduce((n, r) => n + r.extra.length, 0), `${count(set, (r) => r.review.length > 0)}/${set.length}`, t[Math.floor(t.length / 2)].toFixed(1), t.at(-1).toFixed(1)].join('  '));
}
const errors = count(rows, (r) => r.outcome.startsWith('error'));
if (errors) fail(`${errors} /check calls failed`);
