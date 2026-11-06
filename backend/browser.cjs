'use strict';
// Browser bundle entry for the offline demo (frontend/counter-check.html). Pure logic only, no AWS.
module.exports = {
  check: require('./checker.cjs').check,
  checklist: require('./rules.cjs').checklist,
  reconcile: require('./reconcile.cjs').reconcile,
  draftMessage: require('./reconcile.cjs').draftMessage,
  deriveStatus: require('./reconcile.cjs').deriveStatus,
  packet: require('./synth.cjs').packet,
};
