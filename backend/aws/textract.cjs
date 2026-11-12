'use strict';
// Textract adapter. Returns plain objects; the client is injectable so tests need no AWS.
// Confidence is 0..1 (Textract reports 0..100).

// One shared client with adaptive retries. Synchronous Textract calls are rate limited per account, and the
// hackathon account in ap-southeast-1 threw ProvisionedThroughputExceededException at 4 pages in parallel on 2026-11-12.
let shared;
async function defaultClient() {
  const { TextractClient } = require('@aws-sdk/client-textract'); // bundled in the Lambda nodejs runtime
  return (shared ||= new TextractClient({ region: process.env.TEXTRACT_REGION || process.env.AWS_REGION, maxAttempts: 10, retryMode: 'adaptive' }));
}

/** bytes: Buffer of one page image/PDF page. Cheap pass for every page. */
async function detectLines(bytes, client) {
  const { DetectDocumentTextCommand } = require('@aws-sdk/client-textract');
  const c = client || (await defaultClient());
  const out = await c.send(new DetectDocumentTextCommand({ Document: { Bytes: bytes } }));
  return (out.Blocks || []).filter((b) => b.BlockType === 'LINE').map((b) => ({ text: b.Text, conf: (b.Confidence || 0) / 100 }));
}

/** Forms pass, only for pages classified as forms (about 90 percent of Textract cost, so do not run it on every page). */
async function analyzeForm(bytes, client) {
  const { AnalyzeDocumentCommand } = require('@aws-sdk/client-textract');
  const c = client || (await defaultClient());
  const out = await c.send(new AnalyzeDocumentCommand({ Document: { Bytes: bytes }, FeatureTypes: ['FORMS'] }));
  const blocks = new Map((out.Blocks || []).map((b) => [b.Id, b]));
  const text = (b) => ((b.Relationships || []).filter((r) => r.Type === 'CHILD').flatMap((r) => r.Ids).map((id) => blocks.get(id)).filter((w) => w && w.BlockType === 'WORD').map((w) => w.Text).join(' '));
  const kv = {};
  for (const b of blocks.values()) {
    if (b.BlockType !== 'KEY_VALUE_SET' || !(b.EntityTypes || []).includes('KEY')) continue;
    const valueIds = (b.Relationships || []).filter((r) => r.Type === 'VALUE').flatMap((r) => r.Ids);
    const v = valueIds.map((id) => blocks.get(id)).filter(Boolean)[0];
    // An empty value block means a blank field. Unverified against real forms: test on synthetic PDFs in week 1.
    const key = text(b).replace(/:$/, '').trim().toLowerCase(), val = { value: v ? text(v) : '', conf: ((v || b).Confidence || 0) / 100 };
    if (!kv[key] || (!kv[key].value && val.value)) kv[key] = val; // duplicate labels: keep the first non-empty value
  }
  return kv;
}

module.exports = { detectLines, analyzeForm };
