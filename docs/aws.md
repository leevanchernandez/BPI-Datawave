# AWS design and what is verified

This is the AWS version of the backend. BPI's AI team pointed the team to Amazon Bedrock; no public source confirms BPI's cloud stack, so do not state it as fact. Nothing here has been deployed or called against real AWS yet. The live prototype runs on the free stack instead (see docs/free-stack.md).

## Flow

```
Browser (counter) -> POST /upload-url { referralId, name } -> presigned S3 POST
                     (uploads/{referralId}/, jpeg/png/pdf, 5 MB cap, 5 minute URL, SSE-KMS, objects expire after 1 day)
                  -> POST /check { referral, pageKeys } -> Lambda
Every route needs the x-demo-key header (shared demo secret, constant-time compare).
Lambda: for each page
  1. Textract DetectDocumentText (cheap, every page) -> keyword classify (backend/classify.cjs)
  2. form pages only: Textract AnalyzeDocument FORMS (the expensive pass)
  3. other pages the classifier cannot place, or that need name/expiry fields: Claude vision on Bedrock
Lambda: deterministic checker (rules + page/field/name/expiry checks) -> reconcile vs last lacking list
        -> status derived from events (DynamoDB) -> draft Taglish message (Claude, template fallback)
POST /ask -> inquiry agent: Claude with read-only tools get_status, get_lacking, get_checklist
```

The checklist and the "complete" decision are plain code over a rules table, and the check fails closed: anything unreadable, unparseable or unconfirmed becomes a review item. Models read pages, draft messages and answer questions from tool results. Anything a model reads must be visible in the page's OCR text. They never decide what is required and a draft that sounds like approval is discarded.

## Verified offline (`npm test`, `npm run test:aws`)

- Rules, checker, reconciler, status derivation, handler validation (path traversal, id format, caps).
- Routing cost: the Forms pass runs only on form pages; the model reads only ID, registration and permit pages.
- `AnthropicBedrockMantle` exists in `@anthropic-ai/bedrock-sdk@1.1.1` and constructs. Requests carry none of the params Haiku 5.5 rejects (temperature, top_p, forced tool_choice, prefill).
- Lambda bundles with esbuild (about 0.9 MB minified, AWS SDK clients left external) and exports `check`, `ask` and `uploadUrl`. The template passes cfn-lint 1.60.0 with no findings.
- `/upload-url`: id validation, file name sanitising, type allow list, and the real presigner's POST policy (size range, pinned content type, expiry), signed locally with dummy credentials.
- Demo key: every route returns 401 for a missing, wrong, truncated or non-string key, and with no key configured.
- scripts/deploy.sh and scripts/teardown.sh run end to end against stubbed `aws` and `sam` commands, refuse to start without their env vars, and do not print the key. scripts/smoke.mjs runs end to end against an in-process fake API.
- Fail-closed behavior: every finding of the adversarial code review has a regression test (see `docs/challenges.md`).

## NOT verified (needs AWS access)

- Any real Textract output: how an empty form value is represented, accuracy on phone photos, handwriting (English only), Filipino names.
- Bedrock: model id `anthropic.claude-haiku-5-5`, availability in the chosen region, the IAM action and resource for the Mantle endpoint (the template scopes InvokeModel to ARNs built from BedrockModelId, with a commented `'*'` fallback), the ARN form of a global profile, structured-output field shape, latency, and whether hackathon credits cover Marketplace-billed Claude.
- The Bedrock model access check in scripts/deploy.sh: the output of `get-foundation-model-availability` on a real account.
- Taglish quality of drafted messages and extraction. No published benchmark found for Claude or Nova on Taglish.
- `sam build`, `sam deploy`, the smoke test and teardown against a real account. Steps are in docs/aws-runbook.md.
- Authorization: callers share one demo key, which sits in the Lambda environment, and the referral (type, industry, amount, names) is supplied by the caller. Production needs an IAM or Cognito authorizer, must load the referral by id from the bank's system, and must authorize the caller for that case.
- Real S3 behavior of the presigned POST: bucket CORS for POST from the browser, SSE-KMS on upload, and the 403 returned for an oversized or wrong-type file.
- The live demo page talks to the free stack's API. Pointing it at the AWS API needs an adapter that is not built.
- HTTP API integrations time out at 30 seconds. A request is capped at 20 pages with 4 pages read in parallel. Not measured.
- Textract checkbox fields (for example civil status tick boxes) are not parsed, so such a form raises a blank-field defect.
- What "complete" means: no defects, nothing to review, every required signal present. It does not check authenticity, content accuracy, or that statements cover 6 months.
- PDFs: the Bedrock vision call needs images. Multi-page PDFs need to be split to page images first (not built).

## Region

No Philippine region for Textract or Bedrock. Singapore (ap-southeast-1) has Textract; Claude Haiku 5.5 reaches it only through global cross-region inference (processing may happen in other regions). Sydney has an AU geo profile for Haiku 5.5 at about a 10 percent premium. Choose on purpose and say so in the pitch. A real deployment would run in BPI's own account after compliance review (BSP outsourcing rules, Data Privacy Act). No compliance claim is made.

## Cost per pass (list price, unverified outside Oregon)

About 12 pesos per referral per pass, about 90 percent Textract Forms. Multiply by expected resubmission cycles. Not a constraint at 350 applications.

## Data handling

Synthetic documents only. Set the Textract AI-services opt-out policy before any upload (commands in docs/aws-runbook.md), keep Bedrock retention settings explicit, no document content in logs or object names, delete when the referral closes.

## To deploy (not run)

Follow docs/aws-runbook.md. In short, export AWS_REGION, DEMO_KEY, BEDROCK_MODEL_ID and REVIEW_ORIGIN, run `scripts/deploy.sh`, then `node scripts/smoke.mjs`, and `scripts/teardown.sh` after recording. The shared demo key is for the demo only; real use needs an IAM or Cognito authorizer.
