'use strict';
// Deterministic packet check. Input is the extracted packet (from Textract plus the case reader), not images.
// The check never says "approved". complete=true means "no defects and nothing flagged for review".
const { checklist, table } = require('./rules.cjs');
const { nameSimilarity, strictSimilarity } = require('./names.cjs');

const NAME_MATCH_MIN = 0.7; // fuzzy path only
const HIGH_CONF = 0.9;      // both fields read at >= this: compare strictly, no spelling tolerance

const conf = (p, k) => ((p.conf || {})[k] ?? 1);

// 'match' | 'mismatch' | 'review'. Fuzziness is earned by low OCR confidence; otherwise strict.
function compareNames(a, ka, b, kb) {
  const va = a.fields[ka], vb = b.fields[kb];
  if (Math.min(conf(a, ka), conf(b, kb)) >= HIGH_CONF) return strictSimilarity(va, vb) === 1 ? 'match' : 'mismatch';
  return nameSimilarity(va, vb) >= NAME_MATCH_MIN ? 'match' : 'review';
}

const blank = (v) => v == null || String(v).trim() === '';

/**
 * referral: { business, name, type, industry, amount, civilStatus? }
 * packet:   { pages: [{ docType, pageNo?, pageTotal?, side?, fields?, expiry? }] }
 * returns:  { checklist, present, defects: [{ key, code, message, docType? }], complete }
 */
function check(referral, packet, { today = new Date(), rules = table } = {}) {
  const required = checklist(referral, rules);
  const pages = packet.pages || [];
  const byType = (t) => pages.filter((p) => p.docType === t);
  const defects = [];
  const needsReview = [];
  const add = (code, target, message, docType) => defects.push({ key: `${code}:${target}`, code, message, docType });

  // 1. missing documents, with page and side completeness
  for (const row of required) {
    const found = byType(row.docType);
    if (!found.length) { add('MISSING_DOC', row.id, `${row.title} is missing.`, row.docType); continue; }
    const total = Math.max(...found.map((p) => p.pageTotal || 1));
    const have = new Set(found.map((p) => p.pageNo || 1));
    for (let n = 1; n <= total; n++) {
      if (!have.has(n)) add('MISSING_PAGE', `${row.id}#${n}`, `${row.title}: page ${n} of ${total} is missing.`, row.docType);
    }
    if (row.docType === 'gov_id') {
      const sides = new Set(found.map((p) => p.side || 'front'));
      for (const s of ['front', 'back']) if (!sides.has(s)) add('ID_SIDE_MISSING', s, `Government ID ${s} is missing.`, 'gov_id');
    }
  }

  // 2. blank mandatory fields on the application form
  const form = byType('application_form').flatMap((p) => Object.entries(p.fields || {}));
  if (byType('application_form').length) {
    const f = Object.fromEntries(form);
    const must = [...rules.forms.application_form.mandatory];
    if (String(referral.civilStatus || f.civil_status || '').toLowerCase() === 'married') must.push(...rules.forms.application_form.ifMarried);
    for (const k of must) if (blank(f[k])) add('BLANK_FIELD', k, `Application form: "${k.replace(/_/g, ' ')}" is blank.`, 'application_form');
  }

  // 3. names must agree across documents (OCR tolerant)
  const nameOf = (p) => (p.fields || {}).owner_name || (p.fields || {}).name;
  const ownerSrc = pages.filter((p) => ['application_form', 'gov_id', 'registration'].includes(p.docType) && !blank(nameOf(p)));
  for (let i = 0; i < ownerSrc.length; i++) for (let j = i + 1; j < ownerSrc.length; j++) {
    const [a, b] = [ownerSrc[i], ownerSrc[j]];
    if (a.docType === b.docType) continue;
    const ka = a.fields.owner_name != null ? 'owner_name' : 'name', kb = b.fields.owner_name != null ? 'owner_name' : 'name';
    const res = compareNames(a, ka, b, kb), pair = [a.docType, b.docType].sort().join('~');
    const where = `${a.docType.replace(/_/g, ' ')} and ${b.docType.replace(/_/g, ' ')}`;
    if (res === 'mismatch') add('NAME_MISMATCH', pair, `Owner name differs between ${where}.`);
    else if (res === 'review') needsReview.push({ key: `NAME_REVIEW:${pair}`, message: `Owner name between ${where} could not be read clearly. Please confirm.` });
  }
  const bizSrc = pages.filter((p) => ['application_form', 'registration', 'business_permit'].includes(p.docType) && !blank((p.fields || {}).business_name));
  for (let i = 0; i < bizSrc.length; i++) for (let j = i + 1; j < bizSrc.length; j++) {
    const [a, b] = [bizSrc[i], bizSrc[j]];
    if (a.docType === b.docType) continue;
    const res = compareNames(a, 'business_name', b, 'business_name'), pair = [a.docType, b.docType].sort().join('~');
    const where = `${a.docType.replace(/_/g, ' ')} and ${b.docType.replace(/_/g, ' ')}`;
    if (res === 'mismatch') add('BUSINESS_NAME_MISMATCH', pair, `Business name differs between ${where}.`);
    else if (res === 'review') needsReview.push({ key: `BUSINESS_REVIEW:${pair}`, message: `Business name between ${where} could not be read clearly. Please confirm.` });
  }

  // 4. expiry
  for (const p of pages) {
    if (p.expiry && new Date(p.expiry) < today) add('EXPIRED', p.docType, `${p.docType.replace(/_/g, ' ')} expired on ${p.expiry}.`, p.docType);
  }

  return { checklist: required, present: [...new Set(pages.map((p) => p.docType))], defects, needsReview, complete: defects.length === 0 && needsReview.length === 0 };
}

module.exports = { check, NAME_MATCH_MIN, HIGH_CONF };
