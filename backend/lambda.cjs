'use strict';
// Lambda entry points. Real AWS wiring lives only here so everything else is testable offline.
const { makeHandlers } = require('./handler.cjs');
const textract = require('./aws/textract.cjs');
const llm = require('./aws/llm.cjs');

let handlers;
function build() {
  if (handlers) return handlers;
  const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
  const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
  const { DynamoDBDocumentClient, PutCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
  const s3 = new S3Client({});
  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } }); // identity-mismatch defects carry no docType
  const TABLE = process.env.EVENTS_TABLE, BUCKET = process.env.UPLOAD_BUCKET;

  const events = async (id) => (await ddb.send(new QueryCommand({ TableName: TABLE, KeyConditionExpression: 'referralId = :r', ExpressionAttributeValues: { ':r': id } }))).Items || [];
  const deps = {
    demoKey: process.env.DEMO_KEY,
    model: llm.MODEL,
    detectLines: (bytes) => textract.detectLines(bytes),
    analyzeForm: (bytes) => textract.analyzeForm(bytes),
    readPage: (page) => llm.readPage(page),
    markedFields: (page, fields) => llm.markedFields(page, fields),
    draftMessage: (a) => llm.draftMessage(a),
    ask: (q, h) => llm.ask(q, h),
    async loadPage(key) {
      const o = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
      return { bytes: Buffer.from(await o.Body.transformToByteArray()), mediaType: o.ContentType || 'image/jpeg' };
    },
    // Presigned POST, not PUT: only a POST policy can cap the size and pin the content type.
    presignUpload({ key, contentType, maxBytes, expiresIn }) {
      const { createPresignedPost } = require('@aws-sdk/s3-presigned-post');
      return createPresignedPost(s3, { Bucket: BUCKET, Key: key, Expires: expiresIn, Fields: { 'Content-Type': contentType }, Conditions: [['content-length-range', 1, maxBytes], ['eq', '$Content-Type', contentType]] });
    },
    store: {
      events,
      async lastOpen(id) { const e = (await events(id)).filter((x) => x.defects); const l = e[e.length - 1]; return { defects: l ? l.defects : [], needsReview: l ? l.needsReview || [] : [] }; },
      // ttl: delete case events after 30 days (synthetic data in the demo)
      async record(id, ev) { await ddb.send(new PutCommand({ TableName: TABLE, Item: { referralId: id, at: `${ev.at}#${Math.random().toString(16).slice(2, 6)}`, type: ev.type, defects: ev.defects, needsReview: ev.needsReview, ttl: Math.floor(Date.now() / 1000) + 30 * 86400 }, ConditionExpression: 'attribute_not_exists(referralId)' })); },
    },
  };
  handlers = makeHandlers(deps);
  return handlers;
}

exports.check = (event) => build().check(event);
exports.ask = (event) => build().ask(event);
exports.uploadUrl = (event) => build().uploadUrl(event);
