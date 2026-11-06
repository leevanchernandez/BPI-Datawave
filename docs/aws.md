# AWS design and what is verified

BPI runs on AWS (stated by the team, not verified from a BPI source), so the prototype is built as a small serverless stack. Nothing here has been deployed or called against real AWS yet.

## Flow

```
Browser (counter) -> S3 presigned upload (uploads/, SSE-KMS, 1 day expiry)
                  -> POST /check { referral, pageKeys } -> Lambda
Lambda: for each page
  1. Textract DetectDocumentText (cheap, every page) -> keyword classify (backend/classify.cjs)
  2. form pages only: Textract AnalyzeDocument FORMS (the expensive pass)
  3. other pages the classifier cannot place, or that need name/expiry fields: Claude vision on Bedrock
Lambda: deterministic checker (rules + page/field/name/expiry checks) -> reconcile vs last lacking list
        -> status derived from events (DynamoDB) -> draft Taglish message (Claude, template fallback)
POST /ask -> inquiry agent: Claude with read-only tools get_status, get_lacking, get_checklist
```

The checklist and the "complete" decision are plain code over a rules table. Models read pages, draft messages and answer questions from tool results. They never decide what is required and never say a referral is approved.

## Verified offline (`npm test`, `npm run test:aws`)

- Rules, checker, reconciler, status derivation, handler validation (path traversal, id format, caps).
- Routing cost: the Forms pass runs only on form pages; the model reads only ID, registration and permit pages.
- `AnthropicBedrockMantle` exists in `@anthropic-ai/bedrock-sdk@1.1.1` and constructs. Requests carry none of the params Haiku 5.5 rejects (temperature, top_p, forced tool_choice, prefill).
- Lambda bundles with esbuild (1.6 MB) and exports `check` and `ask`. SAM template parses.

## NOT verified (needs AWS access)

- Any real Textract output: how an empty form value is represented, accuracy on phone photos, handwriting (English only), Filipino names.
- Bedrock: model id `anthropic.claude-haiku-5-5`, availability in the chosen region, the IAM action and resource for the Mantle endpoint, structured-output field shape, latency, and whether hackathon credits cover Marketplace-billed Claude.
- Taglish quality of drafted messages and extraction. No published benchmark found for Claude or Nova on Taglish.
- `sam build` and `sam deploy`. The template has no authorizer yet and must not be exposed.
- PDFs: the Bedrock vision call needs images. Multi-page PDFs need to be split to page images first (not built).

## Region

No Philippine region for Textract or Bedrock. Singapore (ap-southeast-1) has Textract; Claude Haiku 5.5 reaches it only through global cross-region inference (processing may happen in other regions). Sydney has an AU geo profile for Haiku 5.5 at about a 10 percent premium. Choose on purpose and say so in the pitch. A real deployment would run in BPI's own account after compliance review (BSP outsourcing rules, Data Privacy Act). No compliance claim is made.

## Cost per pass (list price, unverified outside Oregon)

About 12 pesos per referral per pass, about 90 percent Textract Forms. Multiply by expected resubmission cycles. Not a constraint at 350 applications.

## Data handling

Synthetic documents only. Set the Textract AI-services opt-out policy before any upload, keep Bedrock retention settings explicit, no document content in logs or object names, delete when the referral closes.

## To deploy (not run)

```sh
npm --prefix backend install
sam build -t infra/template.yaml
sam deploy --guided --parameter-overrides ReviewOrigin=http://localhost:8000
```
Add an IAM or Cognito authorizer first.
