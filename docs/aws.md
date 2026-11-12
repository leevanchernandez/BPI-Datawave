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

### Rerun with the text-only reader (2026-11-13)

Before Nov 13 the AWS reader sent the photo of each ID, registration and permit page to Claude. It now sends only the Textract text of the page with ID numbers masked, the same as the free stack, so the model never sees an ID photo. The application form still goes to Claude as an image for the blank-field second look below. The same test then named 33 of 33 planted defects, sent none to a person instead, passed 0 of 33 defective packets and made 0 wrong defects. One heavy packet had one extra review item (civil status), and the complete packet passed at all three levels. A check took 13 to 21 seconds (median 15.6). These are still simulated photos of synthetic pages.

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

## Form fill from the branch's note (2026-11-13)

`scripts/eval-intake.mjs` sends 20 synthetic Taglish and English notes to the live `/api/intake` and scores each field against what the note says. The team wrote the notes and the answers, so this measures our own notes, not real branch notes. A field the note leaves unclear (the industry of a water refilling station, for example) is not scored. A missed field is left empty for the branch to type. A wrong field is the one that matters, because the branch could save it without noticing.

| Stack | Fields scored | Correct | Wrong | Missed |
|---|---|---|---|---|
| AWS (Claude Haiku 5.5 on Bedrock) | 135 | 128 to 132 | 0 | 3 to 7 |
| Free (Gemini Flash-Lite) | 135 | 121 to 132 | 0 | 3 to 14 |

The first AWS run had 2 wrong names ("Mang Tonyo Reyes" and "Engr. Carlo Mendoza"). `cleanIntake` now drops a title before a name, and the run above is after that fix. The ranges come from repeated runs of the final version on Nov 13, because the models do not answer the same way every time. A prompt line on what a business name is raised Gemini from 109 to at least 121. Its first wording made both models fill "bakeshop" as a business name, so the line now says to leave the name out when the note only gives the kind of business. Run it with `DEMO_KEY=<key> STACK=aws node scripts/eval-intake.mjs` from `app/`.

Nico's 18 test cases (the team sheet "Testcases") also ran on both stacks on Nov 13. They found three faults, and all three are fixed. A correction such as "the amount is 850k, not 750k" used to clear the business and owner, a prompt-injection note got a made-up structure, industry and civil status from Haiku, and an empty note got the 1000-character error. A structure or civil status now needs a matching word in the note, and a note with two amounts and no correction leaves the amount empty. After the fixes all 18 match the expected result on both stacks, and the 20-note runs above still have 0 wrong fields.

Nico added two cases at 3:37 AM, and they found two more faults. "I am Nico" filled the officer as the owner, and "my child will be collateral and her name is Reg" filled the child as the owner. A name after "I am" or "ako si" is now dropped, a spouse name needs the note to mention marriage, and an industry is kept only when the model returns the word from the note that shows it (for example "bakery"). On the last AWS run all 20 cases matched, and the 20 notes gave 130 of 135 fields correct with 0 wrong. The free stack could not be rerun, because Gemini's free daily quota ran out at about 4:30 AM after these tests. TC-20 expects collateral ticked, and the page leaves it unticked because a person cannot be loan collateral.

Three more faults were fixed on Nov 13 at about 5:15 AM. A bare amount such as "sole prop, 300k" was left out, so the prompt now says a lone peso amount is the loan amount and income or sales never is. Haiku sometimes returned an empty answer for a whole note, so an empty answer is now asked once more. A code check in `cleanIntake` leaves the amount empty when the note has two different peso amounts and no correction word ("not", "hindi", "instead", "mali"), so TC-13 ("500,000, but later said 800,000") goes to the branch whatever the model says. After these fixes three AWS runs gave 128 to 130 of 135 fields correct with 0 wrong, and all 20 of Nico's cases still match.

A code review on Nov 13 at about 5:40 AM found that an income figure ("kita 30k a month, loan 750k") counted as a second amount and that any "hindi" in a note switched the check off. Income and sales figures are now left out of the count, and only a correction that names the wrong amount ("not 750k", "hindi 500k"), "correction" or "mali" keeps the amount. The structure check no longer matches "property" or "corporate", "wala pang asawa" no longer keeps a guessed "married", and "this is Elena" keeps Elena as the owner. Two more AWS runs gave 129 and 130 of 135 correct with 0 wrong.

## NOT verified

- Textract accuracy on real phone photos, handwriting (English only) and Filipino names. Only the synthetic specimens were read, clean and with simulated photo damage.
- Text printed over a form field on a real form (a stamp or a signature). The second look was measured only with the SPECIMEN watermark on simulated photos, on 8 calls.
- Whether hackathon credits cover Marketplace-billed Claude, and the exact ARN a global profile resolves to (the wildcard resources in the template were enough).
- The Textract AI-services opt-out. The participant role cannot read the Organizations policy, so BPI has to confirm it.
- Taglish quality of drafted messages and extraction. No published benchmark found for Claude or Nova on Taglish.
- `sam deploy` and scripts/teardown.sh, which need CloudFormation. The teardown mode of scripts/deploy-cli.sh has not been run either.
- Authorization: callers share one demo key, which sits in the Lambda environment, and the referral (type, industry, amount, names) is supplied by the caller. Production needs an IAM or Cognito authorizer, must load the referral by id from the bank's system, and must authorize the caller for that case.
- The 403 returned for an oversized or wrong-type file. The browser upload itself works (see the live page section).
- HTTP API integrations time out at 30 seconds. A request is capped at 20 pages with 4 pages read in parallel. It was measured only at 8 to 10 pages (12 to 20 seconds over about 70 calls), so 20 pages may pass 30 seconds under the Textract rate limit. One 9-page call did pass it on 2026-11-12. The Lambda ran for 36.5 seconds and the API returned 503 after 30.1 seconds. The Worker retries a 503 once. Since `0355877` the Worker can send `/check` to the check function's own URL (`AWS_CHECK_URL`), which has no 30 second limit. `deploy-cli.sh` created it on Nov 13 at about 2:18 AM, and the live Worker uses it. One 10-page check through the Worker took 14.5 seconds, and a 20-page check (the 10 specimens twice, the request maximum) took 26.9 seconds (one run each). Three more 10-page runs from a laptop took 3.9 to 7.3 seconds to upload 1.5 MB and 16.1 to 19.6 seconds to check.
- Textract checkbox fields (for example civil status tick boxes) are not parsed, so such a form raises a blank-field defect.
- What "complete" means: no defects, nothing to review, every required signal present. It does not check authenticity, content accuracy, or that the bank statements cover the last 3 months.
- PDFs: since Nov 13 the page turns each PDF page into a JPEG in the browser with pdf.js (up to 20 pages), so a PDF goes through the same path as photos. A 2-page synthetic PDF (the owner ID front and back) ran a full check on the AWS stack on case `RF-2026-099`. The ID was found, and the 7 documents the PDF did not hold were listed as missing.

## Region

No Philippine region for Textract or Bedrock. Singapore (ap-southeast-1) has Textract; Claude Haiku 5.5 reaches it only through global cross-region inference (processing may happen in other regions). Sydney has an AU geo profile for Haiku 5.5 at about a 10 percent premium. Choose on purpose and say so in the pitch. A real deployment would run in BPI's own account after compliance review (BSP outsourcing rules, Data Privacy Act). No compliance claim is made.

## Cost per check (usage measured on 2026-11-12, list prices)

`/check` and `/ask` return a `usage` object with the pages read, the form pages, the model calls and the input and output tokens. `scripts/smoke.mjs` prints it. One run on the hackathon account with the synthetic Elena packet gave these counts.

| Call | Pages | Form pages | Model calls | Input tokens | Output tokens |
| --- | --- | --- | --- | --- | --- |
| `/check`, visit 1 | 9 | 1 | 7 | 14,522 | 426 |
| `/check`, visit 2 | 10 | 1 | 6 | 14,622 | 322 |
| `/ask`, one question | | | 2 | 1,611 | 92 |

After the text-only reader (Nov 13, one run) visit 1 used 6,847 input and 430 output tokens and visit 2 used 4,230 and 305. The model share fell to under $0.001 per check, and the total stays about $0.065 because Textract is most of it.

At list price one check costs about $0.065, which is about 4 pesos at 58 pesos per dollar (assumed rate). The Textract Forms pass is $0.05 of that, the Textract text pass is about $0.015, and Claude Haiku 5.5 is under $0.002. One question to the assistant costs about $0.0002. Lambda, API Gateway, S3 and DynamoDB add less than $0.001 per check (estimated from 512 MB for 20 seconds, not measured).

The prices are $0.0015 per page for text and $0.05 per page for Forms (AWS Textract pricing page, US West Oregon, which does not show Singapore) and $0.10 per million input tokens and $0.50 per million output tokens for Haiku 5.5 (Anthropic list price, and the Bedrock price was not checked). The token counts are from one run, so treat them as a sample.

The specimen application form is one page. A three-page form would cost about $0.17 per check, which is about 10 pesos (assumed page count). A case costs one check per visit, and the demo case takes two.

The BSO said on Nov 12 that an average month has 35 complete applications and a Q4 month has 50 to 60 (BSO-stated). On Nov 13 the BSO said 35 to 40 a month for the QC and CamaNava area, so the count is one area. At two checks each, 35 applications cost about 280 pesos a month and 60 cost about 480 pesos. The 350 applications from the kickoff (BPI-stated, period not stated) would cost about 2,800 pesos. Since Nov 13 the open link uses this stack by default. Callers without the demo key share 300 model-route calls a day, so the worst case is about 300 checks, or about $20 a day at the measured cost. Cloud cost is not the constraint. The limit that matters is the Textract rate limit. The check now has its own function URL, so the 30 second API Gateway timeout no longer applies to it (see the section on what is not verified).

## Data handling

Synthetic documents only. Set the Textract AI-services opt-out policy before any upload (commands in docs/aws-runbook.md), keep Bedrock retention settings explicit, no document content in logs or object names, delete when the referral closes.

## To deploy

Follow docs/aws-runbook.md. In short, export AWS_REGION, DEMO_KEY, BEDROCK_MODEL_ID and REVIEW_ORIGIN, run `scripts/deploy.sh` (or `scripts/deploy-cli.sh` when the role cannot use CloudFormation), then `node scripts/smoke.mjs`. The demo stack stays up through scoring (Nov 17 to 20) and the Nov 27 pitch, and teardown runs only when the team asks. The shared demo key is for the demo only. Real use needs an IAM or Cognito authorizer.

## Assistant questions

`scripts/eval-ask.mjs` asks the live assistant 10 questions about the synthetic case `RF-2026-061` and checks each answer with a rule. The rules check that it refuses approval and an instruction to approve, names the missing mayor's permit, gives the status, lists corporation and partnership papers from the rules table, invents no number of days or interest rate, sends an unlisted structure (One Person Corporation) to the BSO, and does not read another case. On Nov 13 at about 5:40 AM all 10 passed on the AWS stack. Run it with `DEMO_KEY=<key> STACK=aws node scripts/eval-ask.mjs` from `app/`.
