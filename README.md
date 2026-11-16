# Counter Check

Counter Check helps a BPI branch get a business loan referral complete before it reaches the Business Solutions Officer (BSO). The branch types the client's story in Taglish, gets the checklist, photographs the documents at the counter, and sees what is missing while the client is still there. The BSO sees every case and its status in one list. Built for BPI DATA Wave 2026, Group I. All data is synthetic.

## Try it

- Branch view: https://counter-check.stimmie.dev/live
- BSO view: https://counter-check.stimmie.dev/live?role=bso
- The old address https://counter-check.h-847.workers.dev still works and serves the same Worker.
- By default photos go to S3 and are read by Amazon Textract and Claude Haiku 5.5 on Amazon Bedrock, and the form fill and the assistant use Claude too. With `?stack=free` the page reads photos in the browser and uses Gemini (the free stack). Old links with `?stack=aws` still work.

No key is needed. The page is rate limited and has a daily cap on model calls. Use only the synthetic documents in `frontend/specimens/`. `scripts/make-specimens.cjs` draws them in the layout of the real documents, with made-up people, a SPECIMEN mark on every page and no official seal or logo. The older plain pages are in `frontend/specimens/plain/`, and the browser reader (`?stack=free`) uses those.

## How it works

- Rules decide. `backend/rules.json` builds the checklist from business structure, industry and amount, and every row has a source (today the BSO checklist from the team's BU captain). Code decides when a case is "Ready for BSO review".
- The AI reads and drafts. It fills the case form from the branch's note or from photos of BPI's filled paper application form (AWS reader only), reads names and dates on IDs, registrations and permits, drafts the Taglish message the branch sends the client, and answers status questions from the case record and general requirement questions from the rules table.
- People decide. The branch confirms the form, the BSO reviews every case and can return it with a reason, and Credit decides the loan. Approval questions are refused before any model sees them.
- The check reads BPI's own Business Loan Application Form. It maps the form's labels, builds the borrower and spouse names from the name boxes, reads ticked boxes, and skips the signature, checklist and reference pages. It was tested on copies we filled with made-up details, not on client forms.
- After a BSO return, every new check reads the masked page text against the BSO's note. A paper the AI can't find locks Send to BSO until the branch brings it or the BSO waives it, and an unsure answer goes to a person. This is the one place where the AI's reading can hold a case, because the note is free text.
- The BSO endorses a complete case to Credit, and the case list counts how many finished cases were endorsed without a return (complete the first time), which is BPI's main metric.

`docs/risk-map.md` maps each AI risk to its safeguard and test. `docs/aws.md` has the measured cost (about 4 pesos per 10-page check at list prices) and speed (15 to 20 seconds per check), and what is not verified. `docs/demo-script.md` is the recorded demo.

## Results

All of these ran on synthetic data. The numbers are in `docs/aws.md`.

- On rendered phone photos of 11 sample packets with one planted problem each, the check named 11 of 11 problems, let 0 of 11 broken packets through and made 0 wrong flags. The complete packet passed.
- On BPI's real application form, filled with made-up details and photographed, it read every required field and sent one unclear box to a person.
- On 20 test notes in English, Taglish and text-speak, the form fill got 121 to 132 of 135 fields across runs and never filled a field wrong.
- The assistant passed 10 of 10 test questions, including approval, rate and prompt-injection questions.
- A 10-page check takes 12 to 20 seconds and costs about 4 pesos at list prices. Five checks at the same moment all finished in under a minute.

## Tests

```sh
npm test                          # rules, checker, reconciler
node scripts/verify-free.mjs      # the Worker API end to end on the Elena storyline, with a fake model
npm --prefix backend install && npm run test:aws   # AWS handlers and adapters against fakes
```

## Where things are

- `worker/` is the Cloudflare Worker that serves the page and the API and keeps cases in KV.
- `backend/rules.json` holds the requirements as data, from the BSO checklist. `backend/checker.cjs` checks a packet (missing documents and pages, ID sides, blank fields, name mismatches, expired permits) and sends anything unclear to a person. `backend/reconcile.cjs` compares a resubmission with what was open.
- `backend/aws/` holds the Textract and Bedrock adapters and `backend/handler.cjs` the Lambda handlers. `scripts/deploy-cli.sh` deploys them with plain CLI calls.
- `frontend/live.html` and `frontend/live.js` are the branch and BSO views, and `frontend/specimens/` holds the synthetic papers.
- `docs/` has the AWS results (`aws.md`), the risk map (`risk-map.md`), the free stack (`free-stack.md`), the demo script (`demo-script.md`) and what was attacked and changed (`challenges.md`).

`frontend/index.html` is the team's first clickable mockup (Branchline), and `docs/workflow.md` describes it. It's kept for reference and isn't part of Counter Check.

This is a hackathon concept, not an official BPI service.
