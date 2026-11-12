# Demo script and what it needs

Two minutes. Only claims what can be shown. Items marked NEEDS are not built or measured yet.

## Headline

We catch the missing page, the blank TIN and the wrong-name ID while the client is still at the counter, so the BSO's email loop shrinks. (The measured part of this sentence rests on a simulated phone-photo test so far, see docs/aws.md. The printed 60-document test below is still open.)

## Script

| Time | What happens | Status |
| --- | --- | --- |
| 0:00 to 0:20 | State the pain in the BSO's words: a lead arrives incomplete, the BSO emails the lacking list, the branch resubmits, and it cycles. One sentence on who loses time. | Ready |
| 0:20 to 1:10 | Branch scans a synthetic packet with a page missing and the TIN blank. The result appears while the client is still there: two problems, with the exact page and field, plus the checklist for sole proprietorship, food, 750,000. | The checker and page work today on made-up packets. Textract and Bedrock read the synthetic specimens on the hackathon account, clean and with simulated photo damage (docs/aws.md). The demo page reads on that stack with `?stack=aws`, and the case form is filled from a typed note that the branch confirms. NEEDS: printed pages photographed with a phone |
| 1:10 to 1:40 | Client fixes one problem, branch scans again. The screen shows fixed, still open and new. The BSO sees the Taglish message to approve. | Ready on the demo page |
| 1:40 to 2:00 | One slide: recall and false-complete on the 60-document test with ranges, review rate, cost per completed referral, and "pilot task: scanner integration, hosted in BPI's own account". | A simulated version is measured (docs/aws.md). It named 32 of 33 planted defects, sent 1 to review and passed no defective packet. NEEDS: the printed and phone-photographed run |

## Recording the demo

Use a case number nobody has touched. `RF-2026-050` was unused on 2026-11-12 at 11 PM, and `RF-2026-051` is the spare. Open https://counter-check.h-847.workers.dev/live?stack=aws&id=RF-2026-050 in one window and the same link with `&role=bso` in a second window. The page needs no key. Record the screen with your voice in one take, and leave the waits in, because the 15 to 20 seconds of reading is part of the claim.

The files are in `frontend/specimens/`. Visit 1 uses `01-application-form-first-visit.png`, `02`, `03`, `04`, `05-dti-page-1.png`, `08`, `09`, `10` and `11`. Visit 2 adds `01b-application-form-corrected.png` and `05b-dti-page-2.png` and keeps the rest.

| Step | On screen | Voice-over |
| --- | --- | --- |
| 1 | Branch view, the Assistant box at the top with "Fill the form" selected. Send the sample note about Elena. | A branch manager types what the client said, in English or Taglish. |
| 2 | The form fills, and the filled fields are highlighted. Save the case. | The AI fills the form. The branch checks every field before it saves. The checklist comes from the rules, not from the AI. |
| 3 | Add the visit 1 photos and press "Check documents". Wait for the result. | Now the branch photographs the documents at the counter. |
| 4 | The result shows the two problems and the Taglish message to the client. | The checker found a missing DTI page and a blank field on the form, while the client is still there. The message to the client is drafted in Taglish. |
| 5 | Switch the Assistant to "Ask about this case" and send "Ano pa ang kulang?". | The branch can ask what is still missing instead of calling the BSO. |
| 6 | Add the visit 2 photos and check again. The status turns to "Ready for BSO review". Press "Send to BSO". | The client comes back with the missing page. The check passes and the case goes to the BSO. |
| 7 | BSO window. Point at the "All cases" list at the top, then click the case. Show the timeline and the open items. Ask "Approved na ba ito?" in the BSO ask box. | The BSO sees every referral and its status in one list, with the share of cases that were complete the first time (BPI's main metric, from the event log). The BSO gets a complete packet with its history. The assistant refuses approval questions, because Credit decides the loan. |
| 8 | Optional. Return the case with a reason, then show the drafted heads-up and publish it. | When the BSO returns a case, the reason becomes a reminder that other branches see on similar cases. A BSO publishes it, and it never changes the checklist. |

All documents are synthetic. Say that once on screen or in the voice-over.

## What must be built or measured before Nov 16

1. Deploy `/check` against real Textract and run 60 printed and phone-photographed synthetic documents with labeled defects. Report recall, false-complete and review rate with ranges. This is the most important item. A simulated stand-in ran on 2026-11-12 with `scripts/eval-degraded.mjs` (36 packets with ImageMagick damage on real Textract and Bedrock, results in docs/aws.md). The printed and phone-photographed run is still open.
2. Measure real end-to-end seconds including upload. The `/check` call alone took 12 to 20 seconds on AWS for 8 to 10 pages.
3. Run the Taglish test on real Bedrock with a BSO reading the drafts.
4. Done on 2026-11-12. The hackathon AWS role reaches Bedrock and Textract, and the backend runs there (docs/aws.md).
5. Done. Cases live in the Worker's KV store, so the branch window and the BSO window see the same status.
6. Answers from BPI: why a branch officer would open the tool (KPI credit for complete referrals?), how branches submit today, and baselines (share incomplete at first submission, cycles per referral). The BSO stated 35 complete applications a month on average and 50 to 60 in Q4. Whether that covers one area or all areas is still unanswered.

## Claims to avoid

- "Models never decide." Say: the checklist and the complete flag are code, and anything unclear is routed to a person.
- "0 percent false-complete." That number came from a simulated generator. Quote only what the real test measures. The Nov 12 run passed 0 of 33 defective packets on simulated photo damage, so say "0 of 33 in a simulated test" and give its limit.
- "BPI uses AWS." It is the team's statement, not a BPI source.
- A management view of incomplete referrals by branch. It reads as surveillance of the BSO's partners. Cut it or anonymize it.
- "Self-learning" or "the AI learns the requirements." The heads-up is a reminder that a BSO publishes after returning a real case. It cannot tell a habit from a rule, so it never changes the checklist or the status.
