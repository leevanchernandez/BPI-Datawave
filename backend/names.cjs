'use strict';
// Name comparison. Deliberately conservative: it can say 'equal', 'subset' (one name contains the other, a person
// should look) or 'different'. It never grants a match on spelling similarity. Reviewed after a hostile code review:
// Maria/Jose Santos, Juan Cruz Jr/Sr, and a bare first name must not compare equal.

const HONORIFICS = new Set(['mr', 'mrs', 'ms', 'dr', 'engr', 'atty', 'sir']); // ONLY these are dropped. maria, jr, sr, ii, iii stay.

function tokens(s) {
  let t = String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // n with tilde -> n
    .toLowerCase();
  if (t.includes(',')) { // "Santos, Elena M." -> "elena m. santos"
    const [last, rest] = t.split(/,(.*)/s);
    t = `${rest} ${last}`;
  }
  return t.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w && !HONORIFICS.has(w));
}

const sorted = (xs) => [...xs].sort();
const same = (a, b) => a.length === b.length && sorted(a).every((w, i) => w === sorted(b)[i]);
const subsetOf = (a, b) => a.length > 0 && a.every((w) => b.includes(w));

/** 'equal' | 'subset' | 'different'. Single-letter tokens are middle initials: ignored when the full words are equal. */
function nameCompare(a, b) {
  const A = tokens(a), B = tokens(b);
  const wa = A.filter((w) => w.length > 1), wb = B.filter((w) => w.length > 1);
  if (!wa.length || !wb.length) return 'different';
  if (same(wa, wb)) return wa.length >= 2 ? 'equal' : 'subset'; // a single word is never enough to call it the same person
  if (subsetOf(wa, wb) || subsetOf(wb, wa)) return 'subset';
  // an initial in one name that expands to a word in the other ("J. Santos" vs "Juan Santos") is a person's call
  const ia = A.filter((w) => w.length === 1), ib = B.filter((w) => w.length === 1);
  const expands = (ini, words) => ini.some((i) => words.some((w) => w[0] === i));
  if ((expands(ia, wb) && subsetOf(wa, wb)) || (expands(ib, wa) && subsetOf(wb, wa))) return 'subset';
  return 'different';
}

module.exports = { nameCompare, tokens };
