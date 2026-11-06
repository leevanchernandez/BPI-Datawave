'use strict';
// Deterministic checklist from the rules table. The LLM never decides what is required.
const table = require('./rules.json');

function applies(when, r) {
  if (when.type && !when.type.includes(r.type)) return false;
  if (when.industry && !when.industry.includes(r.industry)) return false;
  if (when.minAmount != null && !(Number(r.amount) >= when.minAmount)) return false;
  if (when.maxAmount != null && !(Number(r.amount) <= when.maxAmount)) return false;
  return true;
}

// r: { type, industry, amount }. Returns rows in table order.
function checklist(r, rules = table) {
  return rules.requirements.filter((row) => applies(row.when, r));
}

module.exports = { checklist, table };
