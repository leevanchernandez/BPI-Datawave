'use strict';
// Reconcile a resubmission against the open lacking list, and derive status from events (never typed by hand).

// prev: defects[] from the last check. next: defects[] from the new check.
function reconcile(prev, next) {
  const nextKeys = new Set(next.map((d) => d.key));
  const prevKeys = new Set(prev.map((d) => d.key));
  return {
    resolved: prev.filter((d) => !nextKeys.has(d.key)),
    stillMissing: prev.filter((d) => nextKeys.has(d.key)),
    newIssues: next.filter((d) => !prevKeys.has(d.key)), // a resubmission can introduce new problems
    complete: next.length === 0,
  };
}

// Template fallback when no LLM is available. The LLM version (llm.cjs) only rewrites this in Taglish.
function draftMessage(rec, { to = 'branch' } = {}) {
  const lines = [...rec.stillMissing, ...rec.newIssues].map((d) => `- ${d.message}`);
  if (!lines.length) return 'Complete na ang requirements. Thank you!';
  const head = rec.resolved.length ? `Natanggap namin. ${rec.resolved.length} ang na-resolve na. Kulang pa:` : 'Kulang pa ang mga ito:';
  return [head, ...lines].join('\n');
}

// events: [{ type }] in order. Types: created, check_failed, check_passed, handed_off, bso_opened, submitted_for_credit.
const STATUS_BY_EVENT = {
  created: 'Draft',
  check_failed: 'Missing requirements',
  check_passed: 'Draft',
  handed_off: 'With BSO',
  bso_opened: 'With BSO',
  submitted_for_credit: 'For approval',
};
function deriveStatus(events) {
  let s = 'Draft';
  for (const e of events) if (STATUS_BY_EVENT[e.type]) s = STATUS_BY_EVENT[e.type];
  return s;
}

module.exports = { reconcile, draftMessage, deriveStatus };
