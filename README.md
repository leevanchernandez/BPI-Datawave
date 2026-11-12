# Counter Check

Counter Check helps a BPI branch get a business loan referral complete before it reaches the Business Solutions Officer (BSO). The branch types the client's story in Taglish, gets the checklist, photographs the documents at the counter, and sees what is missing while the client is still there. The BSO sees every case and its status in one list. Built for BPI DATA Wave 2026, Group I. All data is synthetic.

## Try it

- Branch view: https://counter-check.h-847.workers.dev/live?stack=aws
- BSO view: https://counter-check.h-847.workers.dev/live?role=bso&stack=aws
- Without `stack=aws` the page reads photos in the browser and uses Gemini (the free stack). With it, photos go to S3 and are read by Amazon Textract and Claude Haiku 5.5 on Amazon Bedrock.

No key is needed. The page is rate limited and has a daily cap on model calls. Use only the synthetic documents in `frontend/specimens/`.

## How it works

- Rules decide. `backend/rules.json` builds the checklist from business structure, industry and amount, and every row has a source (today the BSO checklist from the team's BU captain). Code decides when a case is "Ready for BSO review".
- The AI reads and drafts. It fills the case form from the branch's note, reads names and dates on IDs, registrations and permits, drafts the Taglish message, and answers status questions from the case record and general requirement questions from the rules table.
- People decide. The branch confirms the form, the BSO reviews every case and can return it with a reason, and Credit decides the loan. Approval questions are refused before any model sees them.
- The BSO's case list counts how many cases sent to the BSO were complete the first time, which is BPI's main metric.

`docs/risk-map.md` maps each AI risk to its safeguard and test. `docs/aws.md` has the measured cost (about 4 pesos per 10-page check at list prices) and speed (15 to 20 seconds per check), and what is not verified. `docs/demo-script.md` is the recorded demo.

## Tests

```sh
npm test                          # rules, checker, reconciler
node scripts/verify-free.mjs      # the Worker API end to end on the Elena storyline, with a fake model
npm --prefix backend install && npm run test:aws   # AWS handlers and adapters against fakes
```

## Where things are

- `worker/` is the Cloudflare Worker that serves the page and the API and keeps cases in KV.
- `backend/` holds the rules, checker, reconciler, pipeline, and the Textract, Bedrock and Gemini adapters.
- `frontend/live.html` and `frontend/live.js` are the branch and BSO views.
- `scripts/deploy-cli.sh` deploys the AWS backend with plain CLI calls.

This is a hackathon concept, not an official BPI service.

## Backend notes

A document checker that runs while the client is still at the counter, plus the AWS pieces to run it for real.

- `backend/rules.json` holds the requirements as data (illustrative, replace with the BPI guidebook).
- `backend/checker.cjs` checks a scanned packet: missing documents and pages, ID sides, blank mandatory fields, name mismatches, expired permits. It abstains instead of guessing: unclear reads become "needs review", and "complete" is never reported while anything is open.
- `backend/reconcile.cjs` compares a resubmission with the open lacking list and derives the status from events.
- `backend/aws/` has the Textract and Bedrock adapters, `backend/lambda.cjs` the Lambda handlers, `infra/template.yaml` the SAM template. It ran on the hackathon AWS account on 2026-11-12 through `scripts/deploy-cli.sh`. See `docs/aws.md` for what is and is not verified.
- `frontend/counter-check.html` is an offline demo of the real checker on made-up packets. Serve `frontend/` and open it, no AWS needed.

```sh
npm test                       # rules, checker, reconciler, simulated OCR noise experiment
npm --prefix backend install   # once, for the AWS layer tests
npm run test:aws               # handlers, pipeline, and model adapters against fakes
npm run build:demo             # rebuild frontend/vendor/checker.js after changing backend code
```

`docs/challenges.md` logs what was attacked and what changed.

## Earlier mockup (Branchline)

Hackathon prototype for an MSME loan-referral workspace, styled using the team's BPI reference palette.

### Run locally

No dependencies, build step, or ChatGPT account is needed to run the frontend.

Open `frontend/index.html` in your browser, or serve the folder locally:

```sh
python -m http.server 8000 --directory frontend
```

Then open http://localhost:8000. Python may be available as `python3` on your system. The UI uses Google Fonts, with local fallback fonts when offline.

### Project structure

```text
frontend/
  index.html     Page shell and font links
  styles.css     Layout, responsive styling, BPI-inspired theme
  app.js         Demo records and interactive referral workflow
docs/
  workflow.md    Product flow and planned integrations
scripts/
  verify.cjs     Dependency-free workflow checks
```

### Features

- Client intake and editable business/contact profiles
- Searchable referral pipeline and status filters
- Purpose-based loan category suggestions and alternative products
- Requirements checklist with incomplete-handoff protection
- Attachment metadata, BSO assignment, and referral activity
- Scripted assistant for missing requirements, loan explanations, and handoff summaries
- Pipeline report and CSV export
- Browser-local persistence and responsive layouts

### Current prototype boundaries

- All initial records are fictional examples. Use sample information.
- Referral changes are saved in each browser's local storage (`branchline-v1`); teammates do not share records yet.
- Attachments store filename, size, and category only. File contents are not uploaded or retained.
- The assistant uses scripted responses; there is no live AI model or bank policy connection.
- Loan matching uses financing purpose only. It does not determine eligibility or credit approval.
- BSO handoff updates the local demo. It sends no messages and connects to no bank system.
- This source includes no application sign-in, shared database, or production document storage. The access controls on the existing hosted preview come from its hosting service.

## Team workflow

1. Clone the repository and create a branch for your feature.
2. Edit the relevant frontend files; open the local preview to review changes.
3. Run `npm test` (Node.js required; no install step needed).
4. Open a pull request into `main` for a teammate to review.

Keep `main` ready to demonstrate. Store API keys in environment variables when a backend is added; never put secrets in frontend JavaScript or commit `.env` files.

## Design and demo

- [Figma reference](https://www.figma.com/design/vTapcSQMNXddXFEvwqIhOM?node-id=2436-3)
- [Existing private hosted demo](https://branchline-referrals.dampaster2.chatgpt.site)

Figma design changes, GitHub code changes, and the existing hosted demo do not automatically synchronize. This repository can be deployed to a static host independently. Shared referral data and AI integration require a backend.

This is a hackathon concept, not an official BPI service or an approved lending product catalog.
