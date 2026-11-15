'use strict';
// Backend checks. No dependencies, no AWS. Run: node scripts/verify-backend.cjs
// Includes a regression case for every finding of the adversarial code review (complete=true must fail closed).
const assert = require('node:assert/strict');
const { checklist } = require('../backend/rules.cjs');
const { check, validDate } = require('../backend/checker.cjs');
const { nameCompare } = require('../backend/names.cjs');
const { classify, mapForm } = require('../backend/classify.cjs');
const { reconcile, draftMessage, deriveStatus } = require('../backend/reconcile.cjs');
const { packet, DEFECTS, rng } = require('../backend/synth.cjs');

const TODAY = new Date('2026-11-04T04:00:00Z'); // 12:00 in Manila
const REF = { id: 'RF-2026-042', type: 'Sole proprietorship', industry: 'Food & beverage', amount: 750000, business: 'Elena Artisan Bakery', name: 'Elena Santos' };
const run = (ref, pk, today = TODAY) => check(ref, pk, { today });
const clean = (seed = 1, ref = REF) => packet(seed, ref, [], 0, TODAY).packet;
const codes = (o) => [...o.defects, ...o.needsReview].map((d) => d.key.split(':')[0]);
const dup = (x) => JSON.parse(JSON.stringify(x));

// ---- rules: golden cases (BSO checklist, 2026-11-06) ----
const ids = (r) => checklist(r).map((x) => x.id);
assert.deepEqual(ids({ type: 'Sole proprietorship', industry: 'Services', amount: 500000, civilStatus: 'single', bpiAccount: true }), ['application_form_sole', 'gov_id', 'dti', 'bir_cor', 'mayors_permit', 'bank_statements', 'cal_sole']);
assert(ids({ type: 'Sole proprietorship', industry: 'Services', amount: 500000 }).includes('endorsement_letter'), 'unknown working account asks for the endorsement letter');
assert(!ids({ type: 'Corporation', industry: 'Services', amount: 500000, bpiAccount: true }).includes('endorsement_letter'));
assert(ids({ type: 'Sole proprietorship', industry: 'Services', amount: 3000001 }).includes('itr'), 'ITR and AFS above PHP 3M for sole props too');
assert(ids({ type: 'Corporation', industry: 'Construction', amount: 500000 }).includes('pcab_license'));
assert(!ids({ type: 'Corporation', industry: 'Services', amount: 500000 }).includes('pcab_license'));
assert.equal(ids({ type: 'Corporation', industry: 'Services', amount: 500000, secured: true }).filter((i) => ['title', 'tax_declaration', 'tax_clearance', 'tax_receipt', 'appraisal_letter', 'collateral_authorization'].includes(i)).length, 6, 'six collateral documents');
assert(ids({ type: 'Sole proprietorship', industry: 'Food & beverage', amount: 750000, civilStatus: 'Kasal' }).includes('spouse_id'), 'Filipino civil status adds the spouse ID');
assert(!ids({ type: 'Corporation', industry: 'Services', amount: 750000, civilStatus: 'married' }).includes('spouse_id'));
assert(ids({ type: 'Corporation', industry: 'Services', amount: 3000001 }).includes('afs'));
assert(!ids({ type: 'Corporation', industry: 'Services', amount: 3000000 }).includes('afs'), 'AFS only above PHP 3M');
assert(ids({ type: 'Partnership', industry: 'Services', amount: 500000, secured: true }).includes('title'));
assert(checklist({ type: 'Sole proprietorship', amount: 1 }).every((r) => r.sourceTitle), 'every row carries a source');
assert(!checklist({ type: 'Sole proprietorship', amount: 1 }).some((r) => /6 months/.test(r.title)), 'bank statements are 3 months');

// ---- names: these pairs must NOT compare equal (reviewer repros) ----
for (const [a, b] of [['Maria Santos', 'Jose Santos'], ['Pedro Santos', 'Santos'], ['Juan Cruz Jr.', 'Juan Cruz Sr.'], ['Juan Cruz II', 'Juan Cruz III'], ['Elena Santos', 'Elena'], ['Maria Cruz', 'Mario Cruz'], ['J. Santos', 'Juan Santos'], ['Elena Santos', 'Elena Santoz']]) {
  assert.notEqual(nameCompare(a, b), 'equal', `${a} vs ${b}`);
}
for (const [a, b] of [['Santos, Elena M.', 'Elena Santos'], ['ELENA  SANTOS', 'elena santos'], ['Mr. Elena Santos', 'Elena Santos'], ['Elena Q. Santos', 'Elena Santos']]) assert.equal(nameCompare(a, b), 'equal', `${a} vs ${b}`);
assert.equal(nameCompare('Juan Cruz Jr.', 'Juan Cruz Sr.'), 'different');

// ---- true-to-life papers: the documents print a middle name, and the national ID prints no validity date ----
{
  const { shortOf } = require('../backend/names.cjs');
  assert(shortOf('Elena Santos', 'SANTOS ELENA REYES') && shortOf('Elena Santos', 'Elena Reyes Santos'));
  assert(!shortOf('Elena', 'Elena Reyes Santos') && !shortOf('Juan Cruz', 'Juan Cruz Jr.') && !shortOf('Elena Reyes Santos', 'Elena Santos') && !shortOf('Maria Santos', 'Jose Reyes Santos'));
  const full = () => { const pk = clean(); for (const x of pk.pages) if ((x.fields || {}).owner_name) x.fields.owner_name = 'Elena Reyes Santos'; return pk; };
  assert.equal(run(REF, clean()).complete, true, 'the clean packet passes before the changes below');
  assert.equal(run(REF, full()).complete, true, 'a middle name on the documents still matches the name the branch typed');
  const jr = full(); for (const x of jr.pages) if ((x.fields || {}).owner_name) x.fields.owner_name = 'Elena Santos Jr.';
  assert(run(REF, jr).needsReview.some((x) => x.key.startsWith('REFERRAL_REVIEW_OWNER')), 'a suffix the branch left out goes to a person');
  const low = full(); for (const x of low.pages) if (x.docType === 'gov_id' && (x.fields || {}).owner_name) x.conf.owner_name = 0.5;
  assert.equal(run(REF, low).complete, false, 'a low-confidence read never gets the middle-name match');
  const noDate = () => { const pk = full(); for (const x of pk.pages) if (x.docType === 'gov_id') delete x.expiry; return pk; };
  assert(run(REF, noDate()).needsReview.some((x) => x.key === 'EXPIRY_UNREADABLE:gov_id'), 'an ID with no date read goes to a person');
  const phil = noDate(); for (const x of phil.pages) if (x.docType === 'gov_id') x.noExpiry = true;
  assert.equal(run(REF, phil).complete, true, 'the national ID has no validity date');
  assert.equal(classify([{ text: 'Araw ng pagkakaloob/Date of issue' }, { text: '18 AUGUST 2022' }, { text: 'Kasarian/Sex' }]).docType, 'gov_id');
}

// ---- clean packet and each single defect ----
assert.deepEqual(run(REF, clean()).defects, []);
assert.deepEqual(run(REF, clean()).needsReview, [], 'a clean, confident packet needs no review');
assert(run(REF, clean()).complete);
for (const d of DEFECTS.filter((x) => x !== 'NAME_MISMATCH')) {
  const s = packet(7, REF, [d], 0, TODAY);
  const o = run(REF, s.packet, TODAY);
  if (d === 'BUSINESS_NAME_MISMATCH') assert(!o.complete, `${d} flagged`); // hard defect at high confidence, review item at low
  else assert(codes(o).includes(d), `${d} detected`);
}
{ const s = packet(7, REF, [], 0, TODAY); s.packet.pages.find((x) => x.docType === 'gov_id' && x.side === 'front').fields.owner_name = 'Pedro Villanueva';
  s.packet.pages.find((x) => x.docType === 'gov_id' && x.side === 'front').conf = { owner_name: 0.97 };
  assert(run(REF, s.packet).defects.some((d) => d.code === 'NAME_MISMATCH')); }

// ---- REGRESSIONS from the adversarial review: complete must fail closed ----
{ // 1. a consistent packet for a different client
  const pk = clean(); for (const p of pk.pages) { if (p.fields.owner_name) p.fields.owner_name = 'Pedro Reyes'; if (p.fields.business_name) p.fields.business_name = 'X Corp'; }
  const o = run(REF, pk); assert(!o.complete); assert(o.defects.some((d) => d.code.startsWith('REFERRAL_MISMATCH'))); }
{ // 2. missing signals are review items, never silent passes
  const noName = clean(); noName.pages.find((p) => p.docType === 'gov_id' && p.side === 'front').fields.owner_name = '';
  assert(!run(REF, noName).complete, 'ID with no readable name');
  const noExpiry = clean(); delete noExpiry.pages.find((p) => p.docType === 'business_permit').expiry;
  assert(!run(REF, noExpiry).complete, 'permit with no validity date');
  const noCivil = clean(); noCivil.pages.find((p) => p.docType === 'application_form' && p.pageNo === 1).fields.civil_status = '';
  assert(!run(REF, noCivil).complete, 'blank civil status'); }
{ // 3. garbage dates, and the expiry day itself in Manila
  for (const bad of ['2026-13-45', '9999-99-99', 'garbage', '2026-02-30']) { const pk = clean(); pk.pages.find((p) => p.docType === 'business_permit').expiry = bad; assert(!run(REF, pk).complete, `date ${bad}`); }
  assert(validDate('2027-03-31') && !validDate('2026-02-30'));
  const onDay = clean(); onDay.pages.find((p) => p.docType === 'business_permit').expiry = '2026-11-04'; assert(run(REF, onDay).complete, 'valid through the day itself in Manila');
  const dayBefore = clean(); dayBefore.pages.find((p) => p.docType === 'business_permit').expiry = '2026-11-03'; assert(run(REF, dayBefore).defects.some((d) => d.code === 'EXPIRED'));
  const earlyUtc = new Date('2026-11-03T20:00:00Z'); // already Nov 4 in Manila
  assert(run(REF, onDay, earlyUtc).complete, 'expiry compare does not depend on UTC midnight'); }
{ // 4. low or missing confidence never grants a name match
  const lo = clean(); const id = lo.pages.find((p) => p.docType === 'gov_id' && p.side === 'front'); id.fields.owner_name = 'Elena Santoz'; id.conf = { owner_name: 0.75 };
  assert(!run(REF, lo).complete, 'near spelling at 0.75 confidence');
  const nan = dup(lo); nan.pages.find((p) => p.docType === 'gov_id' && p.side === 'front').conf = { owner_name: NaN }; assert(!run(REF, nan).complete, 'NaN confidence');
  const none = dup(lo); delete none.pages.find((p) => p.docType === 'gov_id' && p.side === 'front').conf; assert(!run(REF, none).complete, 'no confidence'); }
{ // 5. spouse requirement cannot be bypassed
  const mk = (formCivil, refCivil) => { const pk = clean(); pk.pages.find((p) => p.docType === 'application_form' && p.pageNo === 1).fields.civil_status = formCivil; return run({ ...REF, civilStatus: refCivil }, pk); };
  assert(mk('Married', 'single').defects.some((d) => d.key === 'BLANK_FIELD:spouse_name'), 'form says married, caller says single');
  assert(mk('single', 'married').defects.some((d) => d.key === 'BLANK_FIELD:spouse_name'), 'caller says married');
  assert(mk('Married ', undefined).defects.some((d) => d.key === 'BLANK_FIELD:spouse_name'), 'trailing space');
  assert(!mk('Marr1ed', undefined).complete, 'garbled civil status'); }
{ // 6. page numbers are clamped (was 4.6 s and 1.8 GB at 5e6)
  for (const bad of [5e6, 1e9, -3, 'x', 0]) { const pk = clean(); pk.pages.find((p) => p.docType === 'application_form').pageTotal = bad; const t = Date.now(); const o = run(REF, pk); assert(Date.now() - t < 200, `pageTotal ${bad} fast`); assert(!o.complete, `pageTotal ${bad} flagged`); } }
{ // 7. placeholders and TIN shape
  const pk = clean(); pk.pages.find((p) => p.docType === 'application_form' && p.pageNo === 1).fields.tin = 'N/A'; assert(run(REF, pk).defects.some((d) => d.key === 'BLANK_FIELD:tin'));
  const pk2 = clean(); pk2.pages.find((p) => p.docType === 'application_form' && p.pageNo === 1).fields.tin = '12'; assert(!run(REF, pk2).complete); }
{ // 8. a later empty page does not blank a field filled earlier
  const pk = clean(); pk.pages.find((p) => p.docType === 'application_form' && p.pageNo === 3).fields = { tin: '' }; assert(!run(REF, pk).defects.some((d) => d.key === 'BLANK_FIELD:tin')); }
{ // 9. classifier and form key mapping
  assert.equal(classify([{ text: 'relative humidity 80%' }]).docType, null);
  assert.equal(classify([{ text: 'LOAN APPLICATION FORM' }]).docType, 'application_form');
  const m = mapForm({ 'Signature of Spouse:': { value: 'x', conf: 1 }, 'Full name of spouse': { value: 'Pedro', conf: 1 }, 'Address of employer': { value: 'z', conf: 1 } });
  assert.equal(m.fields.signature, undefined); assert.equal(m.fields.owner_name, undefined); assert.equal(m.fields.address, undefined); assert.equal(m.fields.spouse_signature, 'x'); }
{ // 10. defects must be storable: no undefined values (DynamoDB rejected them by default)
  const s = packet(7, REF, [], 0, TODAY); const idp = s.packet.pages.find((x) => x.docType === 'gov_id' && x.side === 'front'); idp.fields.owner_name = 'Pedro Villanueva'; idp.conf = { owner_name: 0.97 }; const o = run(REF, s.packet);
  assert(o.defects.some((d) => d.code === 'NAME_MISMATCH' && !('docType' in d)), 'identity defects carry no docType key, never an undefined one'); assert.doesNotThrow(() => { for (const d of o.defects) for (const [k, v] of Object.entries(d)) if (v === undefined) throw new Error(`${d.key}.${k} is undefined`); }); }

{ // 11. red team: Filipino civil status, low confidence, spouse ID is not the owner
  const form = (pk) => pk.pages.find((p) => p.docType === 'application_form' && p.pageNo === 1);
  const kasal = clean(); form(kasal).fields.civil_status = 'Kasal'; form(kasal).fields.spouse_name = 'Ramon Santos';
  assert(!codes(run({ ...REF, civilStatus: 'married' }, kasal)).includes('CIVIL_UNREADABLE'), 'clear Kasal is understood');
  const low = clean(); form(low).fields.civil_status = 'single'; form(low).conf.civil_status = 0.31;
  const lo = run({ ...REF, civilStatus: 'married' }, low); assert(!lo.complete && codes(lo).includes('CIVIL_UNREADABLE'), 'low-confidence civil status goes to review, never silently single');
  const sp = clean(5, { ...REF, civilStatus: 'married' });
  const o = run({ ...REF, civilStatus: 'married' }, sp);
  assert(!o.defects.some((d) => /NAME_MISMATCH|REFERRAL_MISMATCH/.test(d.code)), 'spouse ID raises no owner-name defects: ' + JSON.stringify(o.defects));
  assert(o.complete, 'married packet with spouse ID is complete: ' + JSON.stringify([o.defects, o.needsReview]));
  const wrong = dup(sp); wrong.pages.find((p) => p.docType === 'spouse_id').fields.owner_name = 'Pedro Villanueva';
  assert(run({ ...REF, civilStatus: 'married' }, wrong).defects.some((d) => d.code === 'SPOUSE_MISMATCH')); }
{ // 12. grounding and masking (pipeline)
  const { nameGrounded, dateGrounded, maskIds } = require('../backend/pipeline.cjs');
  assert(!nameGrounded('Ana Lena', 'BANANA BREAD by ELENA'), 'substring is not grounding');
  assert(nameGrounded('Elena Santos', 'SANTOS\nELENA MARIA'));
  assert(!dateGrounded('2026-05-01', 'Issued 2026\nValid 05 January\nNo. 01'), 'date parts on different lines');
  assert(dateGrounded('2027-03-31', 'Valid until March 31, 2027'));
  const m = maskIds('PhilSys 1234-5678-9012-3456\nTIN 123-456-789-000\nValid until 2027-03-31');
  assert(!/1234|123-456/.test(m) && m.includes('2027-03-31'), m); }
{ // 13. an empty form field with marks in it goes to a person, and a truly blank one stays a defect
  const form = (pk) => pk.pages.find((p) => p.docType === 'application_form' && p.pageNo === 1);
  const pk = clean(); form(pk).fields.tin = ''; form(pk).fields.contact = ''; form(pk).unread = ['contact'];
  const o = run(REF, pk);
  assert(!o.complete && o.defects.some((d) => d.key === 'BLANK_FIELD:tin'), 'blank TIN is still a defect');
  assert(!o.defects.some((d) => d.key === 'BLANK_FIELD:contact') && o.needsReview.some((d) => d.key === 'FIELD_UNREADABLE:application_form:contact'), 'marked contact goes to review: ' + JSON.stringify([o.defects, o.needsReview]));
  const full = clean(); form(full).unread = ['tin']; assert(run(REF, full).complete, 'unread is ignored for a field that has a value'); }

// ---- reconcile + status ----
{ const prev = [{ key: 'MISSING_DOC:financials', message: 'Financial statements missing.' }, { key: 'MISSING_PAGE:application_form#2', message: 'Form page 2 missing.' }];
  const next = [{ key: 'MISSING_PAGE:application_form#2', message: 'Form page 2 missing.' }, { key: 'EXPIRED:business_permit', message: 'Permit expired.' }];
  const rec = reconcile(prev, next);
  assert.equal(rec.resolved.length, 1); assert.equal(rec.stillMissing[0].key, 'MISSING_PAGE:application_form#2'); assert.equal(rec.newIssues[0].key, 'EXPIRED:business_permit'); assert(!rec.complete);
  assert(!reconcile([], [], [{ key: 'x', message: 'review me' }]).complete, 'reconcile is not complete while a review item is open');
  assert(!/complete|approved/i.test(draftMessage({ resolved: [], stillMissing: [], newIssues: [] })), 'template never sounds like approval');
  assert.equal(deriveStatus([{ type: 'created' }, { type: 'check_failed' }]), 'Missing requirements');
  assert.equal(deriveStatus([{ type: 'created' }, { type: 'check_failed' }, { type: 'check_passed' }, { type: 'handed_off' }]), 'With BSO');
  assert.equal(deriveStatus([{ type: 'handed_off' }, { type: 'check_passed' }]), 'With BSO', 'a later passing check does not roll back a handoff'); }

// ---- experiment: simulated OCR noise. Reports what was found FOR THE RIGHT REASON, separately from "flagged for any reason". ----
function wilson(k, n, z = 1.96) { if (!n) return [0, 0]; const p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [(c - m) / d, (c + m) / d]; }
const pct = (k, n) => `${(100 * k / n).toFixed(1).padStart(5)}%`;
const ci = (k, n) => { const [a, b] = wilson(k, n); return `[${Math.max(0, 100 * a).toFixed(0)}-${(100 * b).toFixed(0)}]`; };
function experiment(noise, n = 1500, seed0 = 1000) {
  const r = rng(seed0), types = ['Sole proprietorship', 'Corporation', 'Partnership'], inds = ['Food & beverage', 'Services', 'Wholesale & retail'];
  const bizs = ['Elena Artisan Bakery', 'Verde Trading Co', 'Northside Auto Care', 'Lim Prints'], owners = ['Elena Santos', 'Marco Reyes', 'David Lim', 'Sofia Garcia', 'Rodel Ramos', 'Carmela Aquino'];
  const rows = Object.fromEntries(DEFECTS.map((d) => [d, { n: 0, right: 0, any: 0 }]));
  let clean = 0, hard = 0, reviewOnly = 0, defective = 0, falseComplete = 0;
  for (let i = 0; i < n; i++) {
    const ref = { id: 'RF-2026-001', type: types[Math.floor(r() * 3)], industry: inds[Math.floor(r() * 3)], amount: [300000, 750000, 6000000][Math.floor(r() * 3)], business: bizs[Math.floor(r() * 4)], name: owners[Math.floor(r() * 6)] };
    const inject = r() < 0.5 ? [] : [DEFECTS[Math.floor(r() * DEFECTS.length)]];
    const s = packet(seed0 + i * 7 + 1, ref, inject, noise, TODAY);
    const o = run(ref, s.packet);
    const defectCodes = new Set(o.defects.map((x) => x.code)), flagged = o.defects.length + o.needsReview.length > 0;
    if (!inject.length) { clean++; if (o.defects.length) hard++; else if (o.needsReview.length) reviewOnly++; }
    else { defective++; if (o.complete) falseComplete++; for (const d of inject) { rows[d].n++; if (defectCodes.has(d)) rows[d].right++; if (flagged) rows[d].any++; } }
  }
  return { rows, clean, hard, reviewOnly, defective, falseComplete };
}
console.log('\nSimulated OCR noise (per-field rate). Synthetic generator and checker share assumptions: this is NOT Textract and NOT a model.');
console.log('noise | clean packets: hard alarm / review only | defective: false-complete | recall for the right reason (flagged for any reason)');
const res = {};
for (const noise of [0, 0.15, 0.3, 0.5]) {
  const e = experiment(noise); res[noise] = e;
  const per = DEFECTS.map((d) => `${d.split('_')[0].slice(0, 4)} ${(e.rows[d].right / e.rows[d].n).toFixed(2)}(${(e.rows[d].any / e.rows[d].n).toFixed(2)})`).join('  ');
  console.log(`${String(noise).padEnd(5)} | ${pct(e.hard, e.clean)} / ${pct(e.reviewOnly, e.clean)} (n=${e.clean})      | ${pct(e.falseComplete, e.defective)} ${ci(e.falseComplete, e.defective)} (n=${e.defective}) | ${per}`);
}
assert.equal(res[0].hard, 0, 'no hard false alarms at zero noise');
assert.equal(res[0].reviewOnly, 0, 'no review flags on clean confident packets');
assert.equal(res[0].falseComplete, 0, 'no false-complete at zero noise');
for (const noise of [0, 0.15, 0.3, 0.5]) assert(res[noise].falseComplete / res[noise].defective < 0.03, `false-complete stays under 3 percent at noise ${noise}`);
console.log('\nbackend checks passed');
