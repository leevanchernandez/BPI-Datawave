# AWS design and what is verified

This is the AWS version of the backend. BPI's AI team pointed the team to Amazon Bedrock; no public source confirms BPI's cloud stack, so do not state it as fact. The backend was created on the hackathon AWS account on 2026-11-12 and passed the smoke test there (see the section on what was checked on the account). The live prototype page runs on the free stack by default (see docs/free-stack.md) and switches to this backend with `?stack=aws`.

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

## Simulated phone-photo test (2026-11-12)

`scripts/eval-degraded.mjs` ran against the deployed API with real Textract and Bedrock. It damages the synthetic specimens with ImageMagick at three levels and sends packets that each carry one known defect. The light level is a 1.5 degree tilt at 80 percent size and JPEG quality 70. The medium level adds perspective skew, blur, lower contrast and noise at 65 percent size and quality 50. The heavy level adds a shadow across the page, a 6 degree tilt and stronger blur and noise at 50 percent size and quality 30. These are simulated photos of synthetic pages. They are not printed pages photographed with a phone, so the 60-document test in docs/demo-script.md is still open.

Eleven defects were planted, one per packet, at each level. Seven are a missing document, page or ID side. One is the blank TIN. Two send Elena's packet under a referral with another owner name or business name, which is caught only if the names are read off the photos. One complete packet was also sent at each level.

| Level | Planted defects named | Sent to review instead | Defective packets that passed | Complete packet | Wrong defects |
| --- | --- | --- | --- | --- | --- |
| Light | 11 of 11 | 0 | 0 | passed | 0 |
| Medium | 11 of 11 | 0 | 0 | passed | 0 |
| Heavy | 10 of 11 | 1 | 0 | passed | 1 |

- No defective packet passed in 33 tries. With 33 tries the true false-complete rate could still be as high as about 9 percent at 95 percent confidence. The tries reuse the same eleven pages, so the real uncertainty is wider than that.
- At the heavy level the business name on the mayor's permit could not be matched to the referral, so the permit went to a person as a review item and the packet did not pass.
- The one wrong defect was at the heavy level. The Forms pass returned no value for civil status on the first-visit form, and the checker reported that field as blank. The second look described below was added after this run, and this level was not rerun without the watermark.
- A `/check` call took 12 to 19 seconds over these 36 calls (8 to 10 pages each), with a median near 15 seconds. That time does not include the uploads.

### Text printed over a form field

The first run kept the red SPECIMEN watermark, which crosses the field values on the application form. On every damaged form the Forms pass returned no value for the spouse name, and on almost every one it returned none for the contact number. At the medium and heavy levels it usually lost civil status too. The checker reported those fields as blank. With no spouse name on the form, the spouse's ID was treated as a second owner ID, which added a missing spouse ID, two name mismatches and a referral mismatch. The 30 packets of that run carried 182 wrong defects. All 27 planted defects were still named and no packet passed. The clean specimens do not show this, and neither do the damaged ones once the watermark is gone. The script now drops the watermark by keeping only the red channel, and `KEEP_WATERMARK=1` brings it back.

A stamp or a signature over a field on a real form could do the same, because an empty Forms value alone cannot tell blank from unreadable.

The fix is a second look. When the Forms pass returns no value for a text field on the form, the form image goes to Claude with one question, which is whether the space for that field holds any mark (`markedFields` in backend/aws/llm.cjs). A field with a mark becomes a review item for a person (`FIELD_UNREADABLE:application_form:<field>`). A field with no mark stays a blank-field defect. The model's answer can only move a defect to a person, and it can never clear one. If the model call fails, the field stays a blank-field defect. When the form shows no spouse name, the spouse named on the referral is used to tell the spouse's ID from the owner's, and the checker sends that ID to a person.

The fix was measured on the deployed API with `KEEP_WATERMARK=1` on three packets at three levels (the complete packet, the blank TIN and the missing spouse ID). Eight of the 9 calls finished and one returned 503 after 30 seconds. The 8 calls carried 0 wrong defects, against 182 over 30 packets before the fix. All 6 planted defects were named. The complete packet with the watermark did not pass at the light and medium levels. It went to a person with unreadable-field and spouse items, which is the intended result. A check took 14 to 18 seconds.

## Live page on the AWS reader (2026-11-12)

The live page reads on this backend when the address has `?stack=aws` (for example `/live?id=RF-2026-042&stack=aws`). The page shrinks each photo to a JPEG of at most 2400 pixels, asks the Worker for a presigned upload (`POST /api/upload-url`), and posts the photo to S3 from the browser. `POST /api/check` then sends the page keys and the referral stored in the Worker to the AWS `/check` route. The Worker adds the demo key, so the browser never calls the AWS API. The Worker recomputes the complete flag from the defects and the review items, discards a draft that sounds like approval, and keeps the case history in its own store. Browser OCR and the page label menus are off on this path.

- `scripts/verify-free.mjs` covers the Worker side with a fake AWS API (block 10).
- The bucket's CORS preflight from the Worker origin returned 200, and 9 photos uploaded from Chrome with status 204.
- A Node run through the live Worker returned "Missing requirements" on visit 1 with the two planted defects and a model-drafted Taglish message, then "Ready for BSO review" on visit 2 in 13.8 seconds.
- A run in Chrome on visit 1 (9 pages) showed the same two problems and the drafted message. From the click to the result it took between 30 and 43 seconds with the uploads. That time was not measured more closely.
- The problem line shows the field id in lowercase (`"tin" is blank`). It is cosmetic and not fixed.
- The note intake runs on Claude through the `/ask` function (`POST /ask { intake }`), so it needed no new API route. Three notes were tried on 2026-11-12. The Elena note filled all eight stated fields in 3.6 to 5.2 seconds. A vague note about a corporation filled the structure, industry and amount and left the names empty. A note with an instruction to change the owner and say the loan is approved filled the real client's name only. Three notes are a smoke test and not a measurement.
- A full run was recorded in Chrome on case `RF-2026-043` (note, save, visit 1 with 2 problems, visit 2 "Ready for BSO review", hand-off, one question and one refused approval question).

## NOT verified

- Textract accuracy on real phone photos, handwriting (English only) and Filipino names. Only the synthetic specimens were read, clean and with simulated photo damage.
- Text printed over a form field on a real form (a stamp or a signature). The second look was measured only with the SPECIMEN watermark on simulated photos, on 8 calls.
- Whether hackathon credits cover Marketplace-billed Claude, and the exact ARN a global profile resolves to (the wildcard resources in the template were enough).
- The Textract AI-services opt-out. The participant role cannot read the Organizations policy, so BPI has to confirm it.
- Taglish quality of drafted messages and extraction. No published benchmark found for Claude or Nova on Taglish.
- `sam deploy` and scripts/teardown.sh, which need CloudFormation. The teardown mode of scripts/deploy-cli.sh has not been run either.
- Authorization: callers share one demo key, which sits in the Lambda environment, and the referral (type, industry, amount, names) is supplied by the caller. Production needs an IAM or Cognito authorizer, must load the referral by id from the bank's system, and must authorize the caller for that case.
- The 403 returned for an oversized or wrong-type file. The browser upload itself works (see the live page section).
- HTTP API integrations time out at 30 seconds. A request is capped at 20 pages with 4 pages read in parallel. It was measured only at 8 to 10 pages (12 to 20 seconds over about 70 calls), so 20 pages may pass 30 seconds under the Textract rate limit. One 9-page call did pass it on 2026-11-12. The Lambda ran for 36.5 seconds and the API returned 503 after 30.1 seconds. The Worker retries a 503 once. Since `0355877` the Worker can send `/check` to the check function's own URL (`AWS_CHECK_URL`), which has no 30 second limit. `deploy-cli.sh` created it on Nov 13 at about 2:18 AM, and the live Worker uses it. One 10-page check through the Worker took 14.5 seconds, and a 20-page check (the 10 specimens twice, the request maximum) took 26.9 seconds (one run each).
- Textract checkbox fields (for example civil status tick boxes) are not parsed, so such a form raises a blank-field defect.
- What "complete" means: no defects, nothing to review, every required signal present. It does not check authenticity, content accuracy, or that statements cover 6 months.
- PDFs: the Bedrock vision call needs images. Multi-page PDFs need to be split to page images first (not built).

## Region

No Philippine region for Textract or Bedrock. Singapore (ap-southeast-1) has Textract; Claude Haiku 5.5 reaches it only through global cross-region inference (processing may happen in other regions). Sydney has an AU geo profile for Haiku 5.5 at about a 10 percent premium. Choose on purpose and say so in the pitch. A real deployment would run in BPI's own account after compliance review (BSP outsourcing rules, Data Privacy Act). No compliance claim is made.

## Cost per check (usage measured on 2026-11-12, list prices)

`/check` and `/ask` return a `usage` object with the pages read, the form pages, the model calls and the input and output tokens. `scripts/smoke.mjs` prints it. One run on the hackathon account with the synthetic Elena packet gave these counts.

| Call | Pages | Form pages | Model calls | Input tokens | Output tokens |
| --- | --- | --- | --- | --- | --- |
| `/check`, visit 1 | 9 | 1 | 7 | 14,522 | 426 |
| `/check`, visit 2 | 10 | 1 | 6 | 14,622 | 322 |
| `/ask`, one question | | | 2 | 1,611 | 92 |

At list price one check costs about $0.065, which is about 4 pesos at 58 pesos per dollar (assumed rate). The Textract Forms pass is $0.05 of that, the Textract text pass is about $0.015, and Claude Haiku 5.5 is under $0.002. One question to the assistant costs about $0.0002. Lambda, API Gateway, S3 and DynamoDB add less than $0.001 per check (estimated from 512 MB for 20 seconds, not measured).

The prices are $0.0015 per page for text and $0.05 per page for Forms (AWS Textract pricing page, US West Oregon, which does not show Singapore) and $0.10 per million input tokens and $0.50 per million output tokens for Haiku 5.5 (Anthropic list price, and the Bedrock price was not checked). The token counts are from one run, so treat them as a sample.

The specimen application form is one page. A three-page form would cost about $0.17 per check, which is about 10 pesos (assumed page count). A case costs one check per visit, and the demo case takes two.

The BSO said on Nov 12 that an average month has 35 complete applications and a Q4 month has 50 to 60 (BSO-stated, and the scope of that count is not stated). At two checks each, 35 applications cost about 280 pesos a month and 60 cost about 480 pesos. The 350 applications from the kickoff (BPI-stated, period not stated) would cost about 2,800 pesos. Cloud cost is not the constraint. The limits that matter are the Textract rate limit and the 30 second API Gateway timeout (see the section on what is not verified).

## Data handling

Synthetic documents only. Set the Textract AI-services opt-out policy before any upload (commands in docs/aws-runbook.md), keep Bedrock retention settings explicit, no document content in logs or object names, delete when the referral closes.

## To deploy

Follow docs/aws-runbook.md. In short, export AWS_REGION, DEMO_KEY, BEDROCK_MODEL_ID and REVIEW_ORIGIN, run `scripts/deploy.sh` (or `scripts/deploy-cli.sh` when the role cannot use CloudFormation), then `node scripts/smoke.mjs`, and tear down after recording. The shared demo key is for the demo only. Real use needs an IAM or Cognito authorizer.
