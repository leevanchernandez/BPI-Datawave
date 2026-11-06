'use strict';
// Backend checks. No dependencies, no AWS. Run: node scripts/verify-backend.cjs
const assert = require('node:assert/strict');
const { checklist } = require('../backend/rules.cjs');
const { check } = require('../backend/checker.cjs');
const { nameSimilarity } = require('../backend/names.cjs');
const { reconcile, draftMessage, deriveStatus } = require('../backend/reconcile.cjs');
const { packet, DEFECTS, rng } = require('../backend/synth.cjs');

// ---- rules: golden cases (illustrative table) ----
const ids = (r) => checklist(r).map((x) => x.id);
assert.deepEqual(ids({ type: 'Sole proprietorship', industry: 'Services', amount: 500000 }),
  ['application_form', 'gov_id', 'registration_dti', 'business_permit', 'financials', 'bank_statements']);
assert(ids({ type: 'Sole proprietorship', industry: 'Food & beverage', amount: 750000 }).includes('sanitary_permit'));
assert(ids({ type: 'Corporation', industry: 'Services', amount: 6000000 }).includes('registration_sec'));
assert(ids({ type: 'Corporation', industry: 'Services', amount: 6000000 }).includes('audited_fs'));
assert(!ids({ type: 'Corporation', industry: 'Services', amount: 4999999 }).includes('audited_fs'), 'boundary below 5M');
assert(ids({ type: 'Partnership', industry: 'Services', amount: 1 }).includes('registration_sec_partner'));

// ---- names ----
assert(nameSimilarity('Santos, Elena M.', 'Elena Santos') === 1);
assert(nameSimilarity('MARIA ELENA SANTOS', 'Elena Santos') === 1);
assert(nameSimilarity('Elena Santos', 'Marco Reyes') === 0);
assert(nameSimilarity('Bautista', 'Bautlsta') === 1, 'OCR i->l slip on a long token');
assert(nameSimilarity('Lim', 'Lirn') === 1, 'rn/m is a known OCR fold');
assert(nameSimilarity('Lim', 'Lam') < 1, 'short tokens get no spelling tolerance');
assert(require('../backend/names.cjs').strictSimilarity('Elena Santos', 'Elena Santoz') < 1, 'strict path rejects near spellings');

// ---- checker: each injected defect is found at zero noise, clean is complete ----
const REF = { type: 'Sole proprietorship', industry: 'Food & beverage', amount: 750000, business: 'Elena Artisan Bakery' };
{
  const c = packet(1, REF, [], 0);
  assert.deepEqual(check(REF, c.packet, { today: c.today }).defects, [], 'clean packet at zero noise has no defects');
  for (const d of DEFECTS.filter((x) => x !== 'NAME_MISMATCH')) {
    const s = packet(7, REF, [d], 0);
    const codes = check(REF, s.packet, { today: s.today }).defects.map((x) => x.code);
    assert(codes.includes(d), `${d} detected`);
  }
}

// NAME_MISMATCH with an unambiguous different person. Near-spelling surnames (Santos/Santoz) are accepted as OCR slips by design: see experiment.
{
  const s = packet(7, REF, [], 0);
  s.packet.pages.find((x) => x.docType === 'gov_id' && x.side === 'front').fields.owner_name = 'Pedro Villanueva';
  assert(check(REF, s.packet, { today: s.today }).defects.some((d) => d.code === 'NAME_MISMATCH'));
}

// ---- married applicant needs spouse fields (the BSO's own example of a recurring error) ----
{
  const s = packet(3, { ...REF, civilStatus: 'married' }, [], 0);
  const out = check({ ...REF, civilStatus: 'married' }, s.packet, { today: s.today });
  assert(out.defects.some((d) => d.key === 'BLANK_FIELD:spouse_name'));
}

// ---- reconcile + status ----
{
  const prev = [{ key: 'MISSING_DOC:financials', message: 'Financial statements missing.' }, { key: 'MISSING_PAGE:application_form#2', message: 'Form page 2 missing.' }];
  const next = [{ key: 'MISSING_PAGE:application_form#2', message: 'Form page 2 missing.' }, { key: 'EXPIRED:business_permit', message: 'Permit expired.' }];
  const rec = reconcile(prev, next);
  assert.equal(rec.resolved.length, 1);
  assert.equal(rec.stillMissing[0].key, 'MISSING_PAGE:application_form#2');
  assert.equal(rec.newIssues[0].key, 'EXPIRED:business_permit', 'resubmission introduced a new issue');
  assert(!rec.complete);
  assert(draftMessage(rec).includes('Form page 2 missing.'));
  assert.equal(deriveStatus([{ type: 'created' }, { type: 'check_failed' }]), 'Missing requirements');
  assert.equal(deriveStatus([{ type: 'created' }, { type: 'check_failed' }, { type: 'check_passed' }, { type: 'handed_off' }]), 'With BSO');
}

// ---- experiment: detection and false alarms under SIMULATED OCR noise ----
function experiment(noise, n = 600, seed0 = 1000) {
  const r = rng(seed0);
  const types = ['Sole proprietorship', 'Corporation', 'Partnership'];
  const inds = ['Food & beverage', 'Services', 'Wholesale & retail'];
  const rows = Object.fromEntries(DEFECTS.map((d) => [d, { n: 0, hit: 0 }]));
  let clean = 0, falseAlarm = 0, reviewOnly = 0, falseComplete = 0, defective = 0;
  for (let i = 0; i < n; i++) {
    const ref = { type: types[Math.floor(r() * 3)], industry: inds[Math.floor(r() * 3)], amount: [300000, 750000, 6000000][Math.floor(r() * 3)], business: ['Elena Artisan Bakery', 'Verde Trading Co', 'Northside Auto Care', 'Lim Prints'][Math.floor(r() * 4)] };
    const inject = r() < 0.5 ? [] : [DEFECTS[Math.floor(r() * DEFECTS.length)]];
    const s = packet(seed0 + i * 7 + 1, ref, inject, noise);
    const out = check(ref, s.packet, { today: s.today });
    const codes = new Set(out.defects.map((x) => x.code));
    if (!inject.length) { clean++; if (codes.size) falseAlarm++; else if (out.needsReview.length) reviewOnly++; } else { defective++; if (out.complete) falseComplete++; for (const d of inject) { rows[d].n++; if (codes.has(d)) rows[d].hit++; } }
  }
  return { rows, clean, falseAlarm, reviewOnly, defective, falseComplete };
}

console.log('\nSimulated OCR noise (per-field rate) vs deterministic checker. Synthetic, not Textract.');
console.log('noise | clean packets: hard false alarm / review flag | defective: false-complete | per-defect recall');
const results = {};
for (const noise of [0, 0.15, 0.3, 0.5]) {
  const e = experiment(noise);
  results[noise] = e;
  const rec = DEFECTS.map((d) => `${d.split('_')[0].slice(0, 4)}${e.rows[d].n ? (e.rows[d].hit / e.rows[d].n).toFixed(2) : '-'}`).join(' ');
  console.log(`${String(noise).padEnd(5)} | ${(e.falseAlarm / e.clean * 100).toFixed(1).padStart(5)}% / ${(e.reviewOnly / e.clean * 100).toFixed(1).padStart(5)}%                       | ${(e.falseComplete / e.defective * 100).toFixed(1).padStart(5)}%                 | ${rec}`);
}
assert.equal(results[0].falseAlarm, 0, 'no false alarms at zero noise');
assert.equal(results[0].falseComplete, 0, 'no false-complete at zero noise');
console.log('\nbackend checks passed');
