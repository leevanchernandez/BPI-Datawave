# AWS design and what is verified

This is the AWS version of the backend. BPI's AI team pointed the team to Amazon Bedrock; no public source confirms BPI's cloud stack, so do not state it as fact. The backend was created on the hackathon AWS account on 2026-11-12 and passed the smoke test there (see the section on what was checked on the account). The live prototype page still runs on the free stack (see docs/free-stack.md).

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
- `AnthropicBedrock` exists in `@anthropic-ai/bedrock-sdk@1.1.1` and constructs. Requests carry none of the params Haiku 5.5 rejects (temperature, top_p, forced tool_choice, prefill).
- Lambda bundles with esbuild (about 0.9 MB minified, AWS SDK clients left external) and exports `check`, `ask` and `uploadUrl`. The template passes cfn-lint 1.60.0 with no findings.
- `/upload-url`: id validation, file name sanitising, type allow list, and the real presigner's POST policy (size range, pinned content type, expiry), signed locally with dummy credentials.
- Demo key: every route returns 401 for a missing, wrong, truncated or non-string key, and with no key configured.
- scripts/deploy.sh and scripts/teardown.sh run end to end against stubbed `aws` and `sam` commands, refuse to start without their env vars, and do not print the key. scripts/smoke.mjs runs end to end against an in-process fake API.
- Fail-closed behavior: every finding of the adversarial code review has a regression test (see `docs/challenges.md`).

## Checked on the hackathon account (2026-11-12, ap-southeast-1)

Every item here used the participant role and the synthetic specimens in frontend/specimens/.

- The role allows Lambda, S3, DynamoDB, API Gateway, Textract, Bedrock, CloudWatch Logs and creating IAM roles. It does not allow CloudFormation, so `sam deploy` stops at `cloudformation:CreateChangeSet`. `sam build` works once esbuild is on PATH.
- `scripts/deploy-cli.sh` created the same resources as the template with plain CLI calls. They are the bucket `counter-check-demo-uploads-<account id>`, the table `counter-check-demo-events`, three roles and three functions named `counter-check-demo-check`, `counter-check-demo-ask` and `counter-check-demo-upload-url`, and the HTTP API `counter-check-demo`. A second run updated them in place.
- `global.anthropic.claude-haiku-5-5` answers on the InvokeModel path through `AnthropicBedrock` with no console step. The Mantle endpoint returned 404 for Haiku 5.5 and 403 for Sonnet 5. The access check in scripts/deploy.sh printed AUTHORIZED and AVAILABLE. The Bedrock resources in the template were enough for the Lambda roles.
- Structured output works. `readPage` returned a valid `docType` and fields for two specimen pages in 2.6 and 4.3 seconds.
- `scripts/smoke.mjs` passed against the deployed API. A wrong key got 401, and uploads went through the presigned POST into the SSE-KMS bucket. Visit 1 (9 pages) took 17.5 seconds and returned "Missing requirements" with the two planted defects (DTI page 2 of 2 missing, TIN blank on the form). Visit 2 (10 pages) took 13.5 seconds and returned no defects and nothing to review (`complete: true`, status Draft). The drafted Taglish message listed both items, and `/ask` answered from the tools.
- Textract throttles. The first run failed with `ProvisionedThroughputExceededException` at 4 pages in parallel, so the adapter now shares one client with adaptive retries (backend/aws/textract.cjs). The role cannot read the account's Textract quota.
- The blank TIN on the real first-visit form came back as a blank-field defect, so the empty value handling holds for that form.

## NOT verified

- Textract accuracy on phone photos, handwriting (English only) and Filipino names. Only the clean synthetic specimens were read.
- Whether hackathon credits cover Marketplace-billed Claude, and the exact ARN a global profile resolves to (the wildcard resources in the template were enough).
- The Textract AI-services opt-out. The participant role cannot read the Organizations policy, so BPI has to confirm it.
- Taglish quality of drafted messages and extraction. No published benchmark found for Claude or Nova on Taglish.
- `sam deploy` and scripts/teardown.sh, which need CloudFormation. The teardown mode of scripts/deploy-cli.sh has not been run either.
- Authorization: callers share one demo key, which sits in the Lambda environment, and the referral (type, industry, amount, names) is supplied by the caller. Production needs an IAM or Cognito authorizer, must load the referral by id from the bank's system, and must authorize the caller for that case.
- Bucket CORS for a POST from the browser, and the 403 returned for an oversized or wrong-type file. The smoke test uploads from Node, where CORS does not apply.
- The live demo page talks to the free stack's API. Pointing it at the AWS API needs an adapter that is not built.
- HTTP API integrations time out at 30 seconds. A request is capped at 20 pages with 4 pages read in parallel. It was measured only at 9 and 10 pages (17.5 and 13.5 seconds), so 20 pages may pass 30 seconds under the Textract rate limit.
- Textract checkbox fields (for example civil status tick boxes) are not parsed, so such a form raises a blank-field defect.
- What "complete" means: no defects, nothing to review, every required signal present. It does not check authenticity, content accuracy, or that statements cover 6 months.
- PDFs: the Bedrock vision call needs images. Multi-page PDFs need to be split to page images first (not built).

## Region

No Philippine region for Textract or Bedrock. Singapore (ap-southeast-1) has Textract; Claude Haiku 5.5 reaches it only through global cross-region inference (processing may happen in other regions). Sydney has an AU geo profile for Haiku 5.5 at about a 10 percent premium. Choose on purpose and say so in the pitch. A real deployment would run in BPI's own account after compliance review (BSP outsourcing rules, Data Privacy Act). No compliance claim is made.

## Cost per pass (list price, unverified outside Oregon)

About 12 pesos per referral per pass, about 90 percent Textract Forms. Multiply by expected resubmission cycles. Not a constraint at 350 applications.

## Data handling

Synthetic documents only. Set the Textract AI-services opt-out policy before any upload (commands in docs/aws-runbook.md), keep Bedrock retention settings explicit, no document content in logs or object names, delete when the referral closes.

## To deploy

Follow docs/aws-runbook.md. In short, export AWS_REGION, DEMO_KEY, BEDROCK_MODEL_ID and REVIEW_ORIGIN, run `scripts/deploy.sh` (or `scripts/deploy-cli.sh` when the role cannot use CloudFormation), then `node scripts/smoke.mjs`, and tear down after recording. The shared demo key is for the demo only. Real use needs an IAM or Cognito authorizer.
