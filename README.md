# BPI Datawave

Hackathon prototype for an MSME loan-referral workspace, styled using the team's BPI reference palette.

## Run locally

No dependencies, build step, or ChatGPT account is needed to run the frontend.

Open `frontend/index.html` in your browser, or serve the folder locally:

```sh
python -m http.server 8000 --directory frontend
```

Then open http://localhost:8000. Python may be available as `python3` on your system. The UI uses Google Fonts, with local fallback fonts when offline.

## Project structure

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

## Features

- Client intake and editable business/contact profiles
- Searchable referral pipeline and status filters
- Purpose-based loan category suggestions and alternative products
- Requirements checklist with incomplete-handoff protection
- Attachment metadata, BSO assignment, and referral activity
- Scripted assistant for missing requirements, loan explanations, and handoff summaries
- Pipeline report and CSV export
- Browser-local persistence and responsive layouts

## Current prototype boundaries

- All initial records are fictional examples. Use sample information.
- Referral changes are saved in each browser's local storage (`branchline-v1`); teammates do not share records yet.
- Attachments store filename, size, and category only. File contents are not uploaded or retained.
- The assistant uses scripted responses; there is no live AI model or bank policy connection.
- Loan matching uses financing purpose only. It does not determine eligibility or credit approval.
- BSO handoff updates the local demo. It sends no messages and connects to no bank system.
- This source includes no application sign-in, shared database, or production document storage. The access controls on the existing hosted preview come from its hosting service.

## Counter Check live prototype (free stack)

Live: https://counter-check.h-847.workers.dev/live (branch view) and `/live?role=bso` (BSO view). A demo key is required; ask Simonee.

- Photos are read by Tesseract.js **in the browser**. Images never leave the device; only lines of text go to the server.
- A Cloudflare Worker (`worker/`) runs the same rules, checker, grounding and reconciler as `backend/`, and keeps each case in KV.
- Gemini (`backend/free/gemini.cjs`) reads only ID, registration and permit pages, as text with ID numbers masked, and drafts Taglish messages. Every name or date it reports must appear in the OCR text, or the page goes to a person.
- Approval, eligibility and rate questions are refused by a rule before any model sees them.
- Rules (`backend/rules.json`) are seeded from BPI's public Ka-Negosyo pages, each row with its source. Not BPI policy.
- Synthetic data only. SPECIMEN documents are in `frontend/specimens/`.

Tests: `npm test` (rules and checker), `node scripts/verify-free.mjs` (the API on the Elena storyline). Details in `docs/free-stack.md`.

## Counter Check backend (branch feat/aws-case-agent)

A document checker that runs while the client is still at the counter, plus the AWS pieces to run it for real. The dashboard above is not wired to it yet.

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
