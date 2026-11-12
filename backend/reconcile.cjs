'use strict';
// Reconcile a resubmission against the open lacking list, and derive status from events (never typed by hand).

// prev: defects[] from the last check. next: defects[] from the new check.
function reconcile(prev, next, nextReview = []) {
  const nextKeys = new Set(next.map((d) => d.key));
  const prevKeys = new Set(prev.map((d) => d.key));
  return {
    resolved: prev.filter((d) => !nextKeys.has(d.key)),
    stillMissing: prev.filter((d) => nextKeys.has(d.key)),
    newIssues: next.filter((d) => !prevKeys.has(d.key)), // a resubmission can introduce new problems
    complete: next.length === 0 && nextReview.length === 0,
  };
}

// Template fallback when no LLM is available. The LLM version (llm.cjs) only rewrites this in Taglish.
function draftMessage(rec, { to = 'branch' } = {}) {
  const lines = [...rec.stillMissing, ...rec.newIssues].map((d) => `- ${d.message}`);
  if (!lines.length) return 'Walang nakitang problema ng checker. Titingnan pa rin ito ng BSO.';
  const head = rec.resolved.length ? `Natanggap namin. ${rec.resolved.length} ang na-resolve na. Kulang pa:` : 'Kulang pa ang mga ito:';
  return [head, ...lines].join('\n');
}

// events: [{ type }] in order. Types: created, check_failed, check_passed, handed_off, bso_opened, returned, endorsed.
const STATUS_BY_EVENT = {
  created: 'Draft',
  check_failed: 'Missing requirements',
  check_passed: 'Draft',
  handed_off: 'With BSO',
  bso_opened: 'With BSO',
  returned: 'Returned by BSO', // back at the branch: the next passing check makes it ready for BSO review again
  endorsed: 'Endorsed to Credit', // the BSO sends it on; Credit decides the loan
};
const RANK = { Draft: 0, 'Missing requirements': 0, 'Returned by BSO': 0, 'With BSO': 1, 'Endorsed to Credit': 2 };
function deriveStatus(events) {
  let s = 'Draft';
  for (const e of events) {
    if (s === 'Endorsed to Credit') break; // nothing moves a case back from Credit
    const next = STATUS_BY_EVENT[e.type];
    if (!next) continue;
    if (RANK[s] >= 1 && e.type === 'check_passed') continue; // a later passing re-check never rolls back a handoff
    s = next;
  }
  return s;
}

module.exports = { reconcile, draftMessage, deriveStatus };
