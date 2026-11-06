# Free stack: what is real and what is not

**Live:** https://counter-check.h-847.workers.dev/live (branch) and `/live?role=bso` (BSO). Cloudflare Workers free plan, Workers KV, Gemini API, Tesseract.js. Cost so far: zero.

## Real
- **OCR on real photos** (Tesseract.js, English model, in the browser). Images stay on the device; only text lines with confidence leave it.
- **Rules decide completeness:**
  - the `backend/checker.cjs` fail-closed checker
  - the rules table with per-row sources
  - civil status in Filipino and English
  - the spouse ID matched against the spouse on the form
- **Model reads** (Gemini 3.5 Flash-Lite):
  - It sees only ID, registration and permit pages, as OCR text with ID numbers masked.
  - Names must appear on the page as whole words, and dates on one line, or the page goes to review.
  - If the model is down, the page goes to a person instead of failing the check.
- **Assistant:** answers from read-only tools bound to one case. A rule refuses approval questions before the model sees them, and answers with approval words are replaced.
- **Shared cases:**
  - Two devices see the same case.
  - Every check, clearance, waiver, handoff and approval is an event with who and when.
  - Status is derived from events.
- **Worker placement:** the Worker runs in Singapore (`placement.region: gcp:asia-southeast1`), because Gemini refuses requests from Hong Kong, where Cloudflare would otherwise serve Manila.

## Not real (say so in the pitch)
- **Bank systems and logins:** no BPI login and no BPI systems. A shared demo key protects the model quota.
- **Synthetic data only:** the Gemini free tier may use prompts to improve Google products.
- **Form fields:** read as "Label: value" lines, which is how our SPECIMEN form is printed. Real BPI forms need a layout map.
- **No handwriting reading:** handwriting is not read reliably. That is by design: low-confidence values go to a person, who types what the paper says.
- **Rules are not BPI policy:** they are seeded from BPI's public pages, which BPI calls indicative and non-exhaustive.

## Moving to BPI's cloud
OCR and the model sit behind two adapters:
- `deps.detectLines` / `analyzeForm`
- `backend/free/gemini.cjs` / `backend/aws/llm.cjs`

The rules, checker, reconciler and event logic are plain JavaScript with no cloud SDK.
