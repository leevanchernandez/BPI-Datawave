'use strict';
// Deterministic checklist from the rules table. The LLM never decides what is required.
const table = require('./rules.json');

// Filipino and English civil status words, mapped to one value. Anything else is not trusted.
const CIVIL_WORDS = {
  single: 'single', 'walang asawa': 'single', binata: 'single', dalaga: 'single',
  married: 'married', kasal: 'married', 'may asawa': 'married',
  widowed: 'widowed', widow: 'widowed', widower: 'widowed', balo: 'widowed', biyuda: 'widowed', biyudo: 'widowed',
  separated: 'separated', hiwalay: 'separated', divorced: 'separated', annulled: 'separated',
};
const civilOf = (v) => CIVIL_WORDS[String(v || '').trim().toLowerCase().replace(/\s+/g, ' ')] || null;

function applies(when, r) {
  if (when.type && !when.type.includes(r.type)) return false;
  if (when.industry && !when.industry.includes(r.industry)) return false;
  if (when.minAmount != null && !(Number(r.amount) >= when.minAmount)) return false;
  if (when.maxAmount != null && !(Number(r.amount) <= when.maxAmount)) return false;
  if (when.civilStatus && !when.civilStatus.includes(civilOf(r.civilStatus))) return false;
  if (when.secured != null && Boolean(r.secured) !== when.secured) return false;
  return true;
}

// r: { type, industry, amount, civilStatus?, secured? }. Returns rows in table order, each with its source.
function checklist(r, rules = table) {
  return rules.requirements.filter((row) => applies(row.when, r)).map((row) => {
    const docTypes = row.docTypes || [row.docType];
    const src = (rules.sources || {})[row.source] || { title: row.source, url: '' };
    return { ...row, docTypes, docType: docTypes[0], sourceTitle: src.title, sourceUrl: src.url };
  });
}

module.exports = { checklist, table, civilOf };
