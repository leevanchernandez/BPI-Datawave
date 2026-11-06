'use strict';
// Guards shared by every model adapter. Kept free of SDK imports so the Worker bundle stays small.
const DOC_TYPES = ['application_form', 'gov_id', 'registration', 'business_permit', 'sanitary_permit', 'itr', 'financials', 'audited_fs', 'bank_statements'];

/** Reject drafts that sound like approval, or are empty or oversized. null makes the caller use the template. */
const FORBIDDEN = /\b(approved?|na-?approve|ma-?a-?approve|complete\s+na|kumpleto\s+na|tapos\s+na|good\s+to\s+go|ok(?:ay)?\s+na|verified|eligible|pasado)\b/i;
function safeDraft(out, items) {
  const t = String(out || '').trim();
  if (!t || t.length > 700) return null;
  if (FORBIDDEN.test(t)) return null;
  return t;
}

/** Questions about approval, eligibility, rates or odds are refused by rule, before any model sees them. */
const CREDIT_Q = /\b(approv\w*|ma-?a-?approve|papasa|pasado|eligib\w*|qualif\w*|chance|odds|interest|rate|ma-?grant|mabibigyan|credit decision|ilang porsyento)\b/i;
const refuseCredit = (q) => CREDIT_Q.test(String(q || ''));

module.exports = { DOC_TYPES, FORBIDDEN, safeDraft, refuseCredit };
