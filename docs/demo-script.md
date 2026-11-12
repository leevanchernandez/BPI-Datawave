# Demo script and what it needs

Two minutes. Only claims what can be shown. Items marked NEEDS are not built or measured yet.

## Headline

We catch the missing page, the blank TIN and the wrong-name ID while the client is still at the counter, so the BSO's email loop shrinks. (The measured part of this sentence rests on a simulated phone-photo test so far, see docs/aws.md. The printed 60-document test below is still open.)

## Script

| Time | What happens | Status |
| --- | --- | --- |
| 0:00 to 0:20 | State the pain in the BSO's words: a lead arrives incomplete, the BSO emails the lacking list, the branch resubmits, and it cycles. One sentence on who loses time. | Ready |
| 0:20 to 1:10 | Branch scans a synthetic packet with a page missing and the TIN blank. The result appears while the client is still there: two problems, with the exact page and field, plus the checklist for sole proprietorship, food, 750,000. | The checker and page work today on made-up packets. Textract and Bedrock read the synthetic specimens on the hackathon account, clean and with simulated photo damage (docs/aws.md). The demo page reads on that stack with `?stack=aws`. NEEDS: printed pages photographed with a phone |
| 1:10 to 1:40 | Client fixes one problem, branch scans again. The screen shows fixed, still open and new. The BSO sees the Taglish message to approve. | Ready on the demo page |
| 1:40 to 2:00 | One slide: recall and false-complete on the 60-document test with ranges, review rate, cost per completed referral, and "pilot task: scanner integration, hosted in BPI's own account". | A simulated version is measured (docs/aws.md). It named 32 of 33 planted defects, sent 1 to review and passed no defective packet. NEEDS: the printed and phone-photographed run |

## What must be built or measured before Nov 16

1. Deploy `/check` against real Textract and run 60 printed and phone-photographed synthetic documents with labeled defects. Report recall, false-complete and review rate with ranges. This is the most important item. A simulated stand-in ran on 2026-11-12 with `scripts/eval-degraded.mjs` (36 packets with ImageMagick damage on real Textract and Bedrock, results in docs/aws.md). The printed and phone-photographed run is still open.
2. Measure real end-to-end seconds including upload. The `/check` call alone took 12 to 20 seconds on AWS for 8 to 10 pages.
3. Run the Taglish test on real Bedrock with a BSO reading the drafts.
4. Done on 2026-11-12. The hackathon AWS role reaches Bedrock and Textract, and the backend runs there (docs/aws.md).
5. A shared store so the status is not one browser tab.
6. Answers from consultation 2: why a branch officer would open the tool (KPI credit for complete referrals?), how branches submit today, baselines (period behind 350, share incomplete at first submission, cycles per referral).

## Claims to avoid

- "Models never decide." Say: the checklist and the complete flag are code, and anything unclear is routed to a person.
- "0 percent false-complete." That number came from a simulated generator. Quote only what the real test measures. The Nov 12 run passed 0 of 33 defective packets on simulated photo damage, so say "0 of 33 in a simulated test" and give its limit.
- "BPI uses AWS." It is the team's statement, not a BPI source.
- A management view of incomplete referrals by branch. It reads as surveillance of the BSO's partners. Cut it or anonymize it.
- "Self-learning" or "the AI learns the requirements." The heads-up is a reminder that a BSO publishes after returning a real case. It cannot tell a habit from a rule, so it never changes the checklist or the status.
