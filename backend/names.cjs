'use strict';
// Name comparison that tolerates OCR noise and common Filipino name formats, in plain code.
// ponytail: token matching + edit distance 1. Upgrade path: an LLM judge for nicknames, only on pairs this flags.

const TITLES = new Set(['mr', 'mrs', 'ms', 'maria', 'ma', 'jr', 'sr', 'ii', 'iii', 'dr', 'engr', 'atty']);

// Fold common OCR confusions so 'B0RN', 'rn'/'m', 'l'/'1'/'i' compare equal. Used on the fuzzy path only.
const fold = (w) => w.replace(/0/g, 'o').replace(/5/g, 's').replace(/[1i]/g, 'l').replace(/rn/g, 'm');

function tokens(s) {
  let t = String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // ñ -> n
    .toLowerCase();
  if (t.includes(',')) { // "Santos, Elena M." -> "elena m. santos"
    const [last, rest] = t.split(/,(.*)/s);
    t = `${rest} ${last}`;
  }
  return t.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
}

function lev1(a, b) { // true when edit distance <= 1
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

function tokenMatch(a, b) {
  if (a === b || fold(a) === fold(b)) return true;
  if ((a.length === 1 || b.length === 1) && a[0] === b[0]) return true; // middle initial
  return Math.min(a.length, b.length) >= 5 && lev1(a, b); // OCR slip on a longer token only
}

// 0..1. Share of the shorter name's meaningful tokens found in the longer one.
function nameSimilarity(a, b) {
  const clean = (x) => { const t = tokens(x); const k = t.filter((w) => !TITLES.has(w)); return k.length ? k : t; };
  let A = clean(a), B = clean(b);
  if (!A.length || !B.length) return 0;
  if (A.length > B.length) [A, B] = [B, A];
  const used = new Set();
  let hit = 0;
  for (const x of A) {
    const j = B.findIndex((y, i) => !used.has(i) && tokenMatch(x, y));
    if (j >= 0) { used.add(j); hit++; }
  }
  if (hit < A.length) { // lost-space case: 'DelaCruz' vs 'Dela Cruz'
    const ja = A.join(''), jb = B.join('');
    if (ja.length >= 8 && (fold(ja) === fold(jb) || lev1(fold(ja), fold(jb)))) return 1;
  }
  return hit / A.length;
}

// Strict: same tokens after case, diacritics, order, titles and middle initials. No spelling tolerance.
function strictSimilarity(a, b) {
  const clean = (x) => { const t = tokens(x); const k = t.filter((w) => !TITLES.has(w)); return k.length ? k : t; };
  let A = clean(a), B = clean(b);
  if (!A.length || !B.length) return 0;
  if (A.length > B.length) [A, B] = [B, A];
  const used = new Set();
  let hit = 0;
  for (const x of A) {
    const j = B.findIndex((y, i) => !used.has(i) && (x === y || ((x.length === 1 || y.length === 1) && x[0] === y[0])));
    if (j >= 0) { used.add(j); hit++; }
  }
  return hit / A.length;
}

module.exports = { nameSimilarity, strictSimilarity, tokens };
