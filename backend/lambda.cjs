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
  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const TABLE = process.env.EVENTS_TABLE, BUCKET = process.env.UPLOAD_BUCKET;

  const events = async (id) => (await ddb.send(new QueryCommand({ TableName: TABLE, KeyConditionExpression: 'referralId = :r', ExpressionAttributeValues: { ':r': id } }))).Items || [];
  const deps = {
    detectLines: (bytes) => textract.detectLines(bytes),
    analyzeForm: (bytes) => textract.analyzeForm(bytes),
    readPage: (page) => llm.readPage(page),
    draftMessage: (a) => llm.draftMessage(a),
    ask: (q, h) => llm.ask(q, h),
    async loadPage(key) {
      const o = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
      return { bytes: Buffer.from(await o.Body.transformToByteArray()), mediaType: o.ContentType || 'image/jpeg' };
    },
    store: {
      events,
      async lastDefects(id) { const e = (await events(id)).filter((x) => x.defects); return e.length ? e[e.length - 1].defects : []; },
      // ttl: delete case events after 30 days (synthetic data in the demo)
      async record(id, ev) { await ddb.send(new PutCommand({ TableName: TABLE, Item: { referralId: id, at: ev.at, type: ev.type, defects: ev.defects, ttl: Math.floor(Date.now() / 1000) + 30 * 86400 } })); },
    },
  };
  handlers = makeHandlers(deps);
  return handlers;
}

exports.check = (event) => build().check(event);
exports.ask = (event) => build().ask(event);
