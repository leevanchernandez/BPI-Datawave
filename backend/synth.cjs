'use strict';
// Synthetic packets with labeled defects and SIMULATED OCR noise. No real borrower data.
// This tests the deterministic rules under noise. It does NOT measure Textract or any model.
const { checklist } = require('./rules.cjs');

function rng(seed) { // mulberry32
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pick = (r, xs) => xs[Math.floor(r() * xs.length)];

const FIRST = ['Elena', 'Marco', 'David', 'Sofia', 'Jericho', 'Mariel', 'Paolo', 'Carmela', 'Rodel', 'Annalyn'];
const LAST = ['Santos', 'Reyes', 'Garcia', 'Lim', 'Dela Cruz', 'Bautista', 'Mendoza', 'Villanueva', 'Aquino', 'Ramos'];
const SIMILAR_LAST = { Reyes: 'Reyna', Santos: 'Santoz', Garcia: 'Gracia', Ramos: 'Ramon', Aquino: 'Aquinas' }; // hard negatives: different people, near spelling

const OCR = [[/rn/g, 'm'], [/m/g, 'rn'], [/o/gi, '0'], [/l/g, '1'], [/i/g, 'l'], [/e/g, 'c']];
function ocrNoise(r, s, p) {
  if (r() > p) return s;
  noised = true;
  const k = r();
  if (k < 0.4) { const [re, to] = pick(r, OCR); return s.replace(re, to); } // char confusions
  if (k < 0.6) { const i = Math.floor(r() * s.length); return s.slice(0, i) + s.slice(i + 1); } // dropped char
  if (k < 0.8) return s.toUpperCase();
  return s.replace(/ /g, ''); // lost space
}

let noised = false; // set by ocrNoise, read by confFor
const SILENT = 0.2; // share of OCR errors that come back with high confidence (silent errors)
function confFor(r, wasNoised) { return wasNoised && r() > SILENT ? 0.5 + r() * 0.35 : 0.93 + r() * 0.06; }

function person(r, name) { if (name) { const t = name.trim().split(/\s+/); return { first: t.slice(0, -1).join(' '), last: t[t.length - 1] }; } return { first: pick(r, FIRST), last: pick(r, LAST) }; }
const asWritten = (r, p, style) => (style === 'lastfirst' ? `${p.last}, ${p.first}` : style === 'initial' ? `${p.first} ${pick(r, 'ABCDEFG')}. ${p.last}` : `${p.first} ${p.last}`);

const DEFECTS = ['MISSING_DOC', 'MISSING_PAGE', 'BLANK_FIELD', 'ID_SIDE_MISSING', 'NAME_MISMATCH', 'BUSINESS_NAME_MISMATCH', 'EXPIRED'];

/** referral: { type, industry, amount, business }. inject: array of defect names. noise: 0..1 per-field OCR noise rate. */
function packet(seed, referral, inject = [], noise = 0.25, today = new Date('2026-11-04')) {
  const r = rng(seed);
  const p = person(r, referral.name);
  const style = pick(r, ['plain', 'lastfirst', 'initial']);
  const req = checklist(referral);
  const nzc = (s) => { noised = false; const v = ocrNoise(r, s, noise); return [v, confFor(r, noised)]; };
  const biz = referral.business;
  const pages = [];
  for (const row of req) {
    const base = { docType: row.docType, fields: {} };
    if (row.docType === 'application_form') {
      const [bn, bc] = nzc(biz), [on, oc] = nzc(asWritten(r, p, style));
      pages.push(...[1, 2, 3].map((n) => ({ ...base, pageNo: n, pageTotal: 3, conf: n === 1 ? { business_name: bc, owner_name: oc, civil_status: 0.97 } : {}, fields: n === 1 ? { business_name: bn, owner_name: on, address: '24 Market St', tin: '123-456-789', contact: '09170000000', signature: 'signed', civil_status: 'single' } : {} })));
    } else if (row.docType === 'gov_id') {
      const [on, oc] = nzc(asWritten(r, p, 'plain'));
      pages.push({ ...base, side: 'front', conf: { owner_name: oc }, fields: { owner_name: on }, expiry: '2030-01-31' }, { ...base, side: 'back' });
    } else if (row.docType === 'registration') {
      const [on, oc] = nzc(asWritten(r, p, 'lastfirst')), [bn, bc] = nzc(biz);
      pages.push({ ...base, conf: { owner_name: oc, business_name: bc }, fields: { owner_name: on, business_name: bn } });
    } else if (row.docType === 'business_permit') {
      const [bn, bc] = nzc(biz);
      pages.push({ ...base, conf: { business_name: bc }, fields: { business_name: bn }, expiry: '2027-03-31' });
    } else if (row.docType === 'spouse_id') {
      pages.push({ ...base, fields: { owner_name: 'Ramon Bautista' }, conf: { owner_name: 0.97 } });
    } else if (row.docType === 'sanitary_permit') {
      pages.push({ ...base, expiry: '2027-06-30' });
    } else pages.push(base);
  }
  if (req.some((x) => x.docType === 'spouse_id')) { const f = pages.find((x) => x.docType === 'application_form' && x.pageNo === 1); if (f) { f.fields.civil_status = 'married'; f.fields.spouse_name = 'Ramon Bautista'; f.conf.spouse_name = 0.97; } }
  if (!pages.some((x) => x.docType === 'business_permit')) { const [bn, bc] = nzc(biz); pages.push({ docType: 'business_permit', conf: { business_name: bc }, fields: { business_name: bn }, expiry: '2027-03-31' }); }
  const truth = new Set();
  for (const d of inject) {
    if (d === 'MISSING_DOC') { const i = pages.findIndex((x) => x.docType === 'bank_statements'); pages.splice(i, 1); truth.add('MISSING_DOC'); }
    if (d === 'MISSING_PAGE') { const i = pages.findIndex((x) => x.docType === 'application_form' && x.pageNo === 2); pages.splice(i, 1); truth.add('MISSING_PAGE'); }
    if (d === 'BLANK_FIELD') { pages.find((x) => x.docType === 'application_form' && x.pageNo === 1).fields.tin = ''; truth.add('BLANK_FIELD'); }
    if (d === 'ID_SIDE_MISSING') { const i = pages.findIndex((x) => x.docType === 'gov_id' && x.side === 'back'); pages.splice(i, 1); truth.add('ID_SIDE_MISSING'); }
    if (d === 'NAME_MISMATCH') { // ID belongs to someone else: near-spelling surname half the time, a different person otherwise
      const id = pages.find((x) => x.docType === 'gov_id' && x.side === 'front');
      id.conf = { owner_name: 0.5 + r() * 0.49 }; // the wrong name can be read confidently or not, do not rig it
      id.fields.owner_name = r() < 0.5 && SIMILAR_LAST[p.last] ? `${p.first} ${SIMILAR_LAST[p.last]}` : asWritten(r, { first: pick(r, FIRST.filter((f) => f !== p.first)), last: pick(r, LAST.filter((l) => l !== p.last)) }, 'plain');
      truth.add('NAME_MISMATCH');
    }
    if (d === 'BUSINESS_NAME_MISMATCH') { const bp = pages.find((x) => x.docType === 'business_permit'); bp.conf = { business_name: 0.5 + r() * 0.49 }; bp.fields.business_name = `${pick(r, ['Golden', 'Sunrise', 'Metro', 'Prime'])} ${pick(r, ['Traders', 'Foods', 'Hardware', 'Prints'])}`; truth.add('BUSINESS_NAME_MISMATCH'); }
    if (d === 'EXPIRED') { pages.find((x) => x.docType === 'business_permit').expiry = '2026-06-30'; truth.add('EXPIRED'); }
  }
  return { packet: { pages }, truth, today };
}

module.exports = { packet, DEFECTS, rng };
