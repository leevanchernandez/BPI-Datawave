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
