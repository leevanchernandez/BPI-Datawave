'use strict';
// Packet check, fail closed. Input is the extracted packet (Textract plus the case reader), not images.
// complete=true means: no defects found AND nothing flagged for a person to review AND every signal this check
// depends on was actually present. It is "no issues detected by these rules", never "verified" or "approved".
// NOT checked: document authenticity, content accuracy, whether statements cover 6 months, forged documents.
const { checklist, table, civilOf } = require('./rules.cjs');
const { nameCompare } = require('./names.cjs');

const HIGH_CONF = 0.9;  // a read below this never grants a name match
const MAX_PAGES = 50;   // clamp for any page number or page total that came from OCR or a model

const PLACEHOLDER = /^(n\/?a|none|nil|null|-+|_+|x+|\.+|0+)$/i;
const blank = (v) => v == null || String(v).trim() === '' || PLACEHOLDER.test(String(v).trim());
const TIN = /^\d{3}[- ]?\d{3}[- ]?\d{3}([- ]?\d{3,5})?$/;

const conf = (p, k) => { const c = (p.conf || {})[k]; return typeof c === 'number' && Number.isFinite(c) ? c : 0; }; // unknown confidence counts as low, never as high
const manilaDay = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(d); // YYYY-MM-DD
function validDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

/** 'match' | 'mismatch' | 'review'. Low confidence can never produce 'match' unless the names are exactly equal. */
function compareNames(va, ca, vb, cb) {
  const r = nameCompare(va, vb);
  if (r === 'equal') return 'match';
  if (Math.min(ca, cb) < HIGH_CONF || r === 'subset') return 'review';
  return 'mismatch';
}

/**
 * referral: { business, name, type, industry, amount, civilStatus? }  (the caller must source this from a trusted store)
 * packet:   { pages: [{ docType, pageNo?, pageTotal?, side?, fields?, conf?, expiry?, unread? }] }  (unread: empty form fields that have marks in them)
 */
function check(referral, packet, { today = new Date(), rules = table } = {}) {
  const required = checklist(referral, rules);
  const pages = packet.pages || [];
  const byType = (t) => pages.filter((p) => p.docType === t);
  const defects = [], needsReview = [];
  const add = (code, target, message, docType) => { const d = { key: `${code}:${target}`, code, message }; if (docType) d.docType = docType; defects.push(d); };
  const review = (code, target, message) => needsReview.push({ key: `${code}:${target}`, message });
  const todayStr = manilaDay(today);

  // 1. missing documents, page and side completeness (page numbers are clamped: they come from OCR or a model)
  for (const row of required) {
    const found = pages.filter((p) => row.docTypes.includes(p.docType));
    if (!found.length) { add('MISSING_DOC', row.id, `${row.title} is missing.`, row.docType); continue; }
    let total = 1;
    for (const p of found) {
      const t = Number(p.pageTotal), n = Number(p.pageNo);
      if (p.pageTotal == null && p.pageNo == null) continue;
      if (Number.isInteger(t) && t >= 1 && t <= MAX_PAGES && Number.isInteger(n) && n >= 1 && n <= t) total = Math.max(total, t);
      else review('PAGE_NUMBER_INVALID', row.docType, `${row.title}: a page number could not be read. Please check the page order.`);
    }
    const have = new Set(found.map((p) => Number(p.pageNo) || 1));
    for (let n = 1; n <= total; n++) if (!have.has(n)) add('MISSING_PAGE', `${row.id}#${n}`, `${row.title}: page ${n} of ${total} is missing.`, row.docType);
    if (row.docType === 'gov_id') {
      const sides = new Set(found.map((p) => p.side || 'front'));
      for (const s of ['front', 'back']) if (!sides.has(s)) add('ID_SIDE_MISSING', s, `Government ID ${s} is missing.`, 'gov_id');
    }
  }

  // 2. application form: mandatory fields, first non-blank value wins across pages
  const forms = byType('application_form');
  if (forms.length) {
    const f = {};
    for (const p of forms) for (const [k, v] of Object.entries(p.fields || {})) { if (!(k in f) || (blank(f[k]) && !blank(v))) f[k] = v; }
    // civil status: Filipino or English words, read with high confidence, and consistent with what the branch confirmed
    const formCivil = civilOf(f.civil_status), intakeCivil = civilOf(referral.civilStatus);
    const formConf = Math.max(0, ...forms.map((p) => (p.fields || {}).civil_status === f.civil_status ? conf(p, 'civil_status') : 0));
    const married = formCivil === 'married' || intakeCivil === 'married';  // married if EITHER source says so
    const must = [...rules.forms.application_form.mandatory];
    if (married) must.push(...rules.forms.application_form.ifMarried);
    const unread = new Set(forms.flatMap((p) => p.unread || []));
    const empty = (k) => (unread.has(k)
      ? review('FIELD_UNREADABLE', `application_form:${k}`, `Application form: "${k.replace(/_/g, ' ')}" has marks that could not be read. Please check the paper.`)
      : add('BLANK_FIELD', k, `Application form: "${k.replace(/_/g, ' ')}" is blank.`, 'application_form'));
    for (const k of must) if (blank(f[k])) empty(k);
    if (blank(f.civil_status)) empty('civil_status');
    else if (!formCivil || formConf < HIGH_CONF) review('CIVIL_UNREADABLE', 'civil_status', 'Civil status on the form could not be read with confidence. Please check the paper.');
    else if (intakeCivil && formCivil !== intakeCivil) review('CIVIL_DIFFERS', 'civil_status', `Civil status on the form (${formCivil}) differs from the case (${intakeCivil}). Please check it.`);
    if (!blank(f.tin) && !TIN.test(String(f.tin).trim())) review('TIN_FORMAT', 'tin', 'The TIN does not look like a TIN. Please check it.');
  }

  // 3. names. Missing signals are review items, never silent passes.
  const collect = (types, field) => {
    const out = [];
    for (const p of pages) {
      if (!types.includes(p.docType)) continue;
      if ((p.docType === 'gov_id' && p.side === 'back') || (['application_form', 'registration', 'business_permit'].includes(p.docType) && Number(p.pageNo) > 1)) continue; // names are on the first page
      const v = (p.fields || {})[field];
      if (blank(v)) { if (p.docType !== 'application_form') review('FIELD_UNREADABLE', `${p.docType}:${field}`, `${p.docType.replace(/_/g, ' ')}: the ${field.replace(/_/g, ' ')} could not be read. Please check it.`); continue; }
      out.push({ p, v, c: conf(p, field) });
    }
    return out;
  };
  const owners = collect(['application_form', 'gov_id', 'registration'], 'owner_name');
  const bizs = collect(['application_form', 'registration', 'business_permit'], 'business_name');
  const pairs = (list, code, reviewCode, label) => {
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const [a, b] = [list[i], list[j]];
      if (a.p.docType === b.p.docType) continue;
      const res = compareNames(a.v, a.c, b.v, b.c), pair = [a.p.docType, b.p.docType].sort().join('~');
      const where = `${a.p.docType.replace(/_/g, ' ')} and ${b.p.docType.replace(/_/g, ' ')}`;
      if (res === 'mismatch') add(code, pair, `${label} differs between ${where}.`);
      else if (res === 'review') review(reviewCode, pair, `${label} between ${where} could not be confirmed. Please check it.`);
    }
  };
  pairs(owners, 'NAME_MISMATCH', 'NAME_REVIEW', 'Owner name');

  // 3a. spouse ID is compared with the spouse named on the form (never with the owner)
  const spouseOnForm = forms.map((p) => (p.fields || {}).spouse_name).find((v) => !blank(v));
  for (const p of byType('spouse_id')) {
    const v = (p.fields || {}).owner_name;
    if (blank(v) || blank(spouseOnForm)) { review('SPOUSE_REVIEW', 'spouse_id', 'Spouse ID name could not be matched to the form. Please check it.'); continue; }
    const res = compareNames(spouseOnForm, conf(forms[0], 'spouse_name') || 1, v, conf(p, 'owner_name'));
    if (res === 'mismatch') add('SPOUSE_MISMATCH', 'spouse_id', 'Spouse ID name does not match the spouse on the form.', 'spouse_id');
    else if (res === 'review') review('SPOUSE_REVIEW', 'spouse_id', 'Spouse ID name could not be confirmed against the form. Please check it.');
  }
  pairs(bizs, 'BUSINESS_NAME_MISMATCH', 'BUSINESS_REVIEW', 'Business name');

  // 3b. the packet must be about the referral (the referral is the trusted side, confidence 1)
  const against = (list, refValue, code, reviewCode, label) => {
    if (blank(refValue)) return;
    for (const x of list) {
      const res = compareNames(refValue, 1, x.v, x.c);
      if (res === 'mismatch') add(code, x.p.docType, `${label} on the ${x.p.docType.replace(/_/g, ' ')} does not match the referral.`);
      else if (res === 'review') review(reviewCode, x.p.docType, `${label} on the ${x.p.docType.replace(/_/g, ' ')} could not be matched to the referral. Please check it.`);
    }
  };
  against(owners, referral.name, 'REFERRAL_MISMATCH_OWNER', 'REFERRAL_REVIEW_OWNER', 'Owner name');
  against(bizs, referral.business, 'REFERRAL_MISMATCH_BUSINESS', 'REFERRAL_REVIEW_BUSINESS', 'Business name');

  // 4. validity dates: must parse, must exist where the document has one, compared by Manila calendar day
  for (const docType of ['gov_id', 'business_permit', 'sanitary_permit']) {
    const found = byType(docType);
    if (!found.length) continue;
    const dated = found.map((p) => p.expiry).filter((e) => e != null && e !== '');
    if (!dated.length) { review('EXPIRY_UNREADABLE', docType, `${docType.replace(/_/g, ' ')}: no validity date could be read. Please check it.`); continue; }
    for (const e of dated) {
      if (!validDate(e)) review('EXPIRY_UNREADABLE', docType, `${docType.replace(/_/g, ' ')}: the validity date could not be read. Please check it.`);
      else if (e < todayStr) add('EXPIRED', docType, `${docType.replace(/_/g, ' ')} expired on ${e}.`, docType);
    }
  }

  return { checklist: required, present: [...new Set(pages.map((p) => p.docType))], defects, needsReview, complete: defects.length === 0 && needsReview.length === 0 };
}

module.exports = { check, HIGH_CONF, validDate };
