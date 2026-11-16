# Demo script

Two minutes. Only How to record the demo and what to say over it. Every document in it is synthetic.

emo

Use a case number nobody has touched. The plain link https://counter-check.stimmie.dev/live picks a fresh number and puts it in the address. Open it in one window, then open the same address with `&role=bso` added in a second window. `RF-2026-050`, `051`, `052` and `310` are already used by earlier takes. The page needs no key. Record the screen with your voice in one take, and leave the waits in, because the 15 to 20 seconds of reading is part of the claim.

The files are in `frontend/specimens/`. Visit 1 uses `01-application-form-first-visit.png`, `02`, `03`, `04`, `05-dti-page-1.png`, `08`, `09`, `10` and `11`. Visit 2 adds `01b-application-form-corrected.png` and `05b-dti-page-2.png` and keeps the rest.

| Step | On screen | Voice-over |
| --- | --- | --- |
| 1 | Branch view, the Assistant box at the top with "Fill the form" selected. Send the sample note about Elena. | A branch manager types what the client said, in English or Taglish. |
| 2 | The form fills, and the filled fields are highlighted. Save the case. | The AI fills the form. The branch checks every field before it saves. The checklist comes from the rules, not from the AI. |
| 3 | Add the visit 1 photos (or press "Sample papers, visit 1") and press "Check documents". Wait for the result. | Now the branch photographs the documents at the counter. |
| 4 | The result shows the two problems and the Taglish message for the branch to send the client. | The checker found a missing DTI page and a blank field on the form, while the client is still there. The follow-up the BSO would otherwise write is drafted in Taglish for the branch to send the client. |
| 5 | Switch the Assistant to "Ask about this case" and send "Ano pa ang kulang?", then "ano requirements ng corporation?". | The branch can ask what is still missing, and what another structure needs, instead of calling the BSO. |
| 6 | Add the visit 2 photos (or press "Sample papers, visit 2") and check again. The status turns to "Ready for BSO review". Press "Send to BSO". | The client comes back with the missing page. The check passes and the case goes to the BSO. |
| 7 | BSO window. Point at the "All cases" list at the top, then click the case. Show the timeline and the open items. Ask "Approved na ba ito?" in the BSO ask box, then press "Endorse to Credit". | The BSO sees every referral and its status in one list. The assistant refuses approval questions, because Credit decides the loan. The BSO endorses the complete packet to Credit, and the list counts how many finished cases were endorsed without a return. That is the share complete the first time, BPI's main metric, and endorsements to Credit are already part of the BSO's KPI. |
| 8 | Optional. Return the case with a reason, then show the drafted heads-up and publish it. Back in the branch window, check the same papers again. | When the BSO returns a case, the reason becomes a reminder that other branches see on similar cases. A BSO publishes it, and it never changes the checklist. On the next check the AI reads the new scan against the BSO's note, so the branch can't send it back without the paper the BSO asked for. |

All documents are synthetic. Say that once on screen or in the voice-over.

A silent real-time take of steps 1 to 7 was recorded on Nov 13 at about 6:05 AM with Playwright on case `RF-2026-051` (90 seconds at 1280 by 800, waits left in). It ends with the BSO pressing "Endorse to Credit" and the case list metric. The file is outside the repo, in Simonee's Downloads. A voice-over can go on top of it if a live take is not possible.

This voice-over is timed to that take. The times are read off the video in 5 second steps, so start each line on the change you see. All documents in it are synthetic.

| Time | On screen | Voice-over |
| --- | --- | --- |
| 0 to 10 s | The note is sent and the form fills. The case is saved. | The branch types what the client said, in Taglish. The AI fills the form, and the branch checks it before saving. |
| 10 to 35 s | Visit 1 photos go up and the check runs. | The branch photographs the papers at the counter. Textract reads every page, and the rules compare them with the checklist. This takes about 15 seconds. |
| 35 to 40 s | Two problems and the drafted message appear. | It found a missing DTI page and a blank TIN while the client is still there. The follow-up is already drafted in Taglish. |
| 40 to 50 s | "ano pa kulang?" is asked and answered. | The branch can ask what is still missing instead of calling the BSO. |
| 50 to 65 s | Visit 2 photos go up and the check passes. | The client comes back with the missing page, and the case is ready for BSO review. |
| 65 to 70 s | The branch presses "Send to BSO". | The branch hands it off, and both sides see the same status. |
| 70 to 80 s | BSO view. "Approved na ba ito?" is refused. | The BSO sees every case in one list. The assistant refuses approval questions, because Credit decides the loan. |
| 80 to 90 s | The BSO presses "Endorse to Credit", and the list shows the count. | The BSO endorses the complete packet to Credit. The list counts how many cases were endorsed with no return, which is the share complete the first time. |

A longer silent take (168 seconds, 1280 by 800, waits left in) was recorded on Nov 13 at about 10:40 AM on case `RF-2026-310` with the loading states from `7726ab2`. It adds the BSO return, the heads-up and the second handoff. The file is `counter-check-demo-full-2026-11-13.mp4` in Simonee's Downloads. This voice-over is timed to it. It was recorded before `fa6634e` (Nov 15), so it doesn't show the AI reading the new scan against the BSO's note. A new take of step 8 would show it.

| Time | On screen | Voice-over |
| --- | --- | --- |
| 0 to 12 s | The sample note is sent, the form fills and the case is saved. | The branch types what the client said, in Taglish. The AI fills the form, and the branch checks every field before saving. |
| 12 to 32 s | Visit 1 papers load and the progress panel counts the upload, then the reading. | The branch photographs the papers at the counter. Textract reads every page, and the rules compare them with the BSO checklist. All the documents here are synthetic. |
| 32 to 42 s | Two problems and the drafted Taglish message appear. | It found a missing DTI page and a blank TIN while the client is still at the branch. The follow-up is already drafted, and a person sends it. |
| 42 to 48 s | "ano pa kulang?" is asked and answered. | The branch asks what is still missing instead of booking a call with the BSO. |
| 48 to 80 s | Visit 2 papers, the check passes, and the branch presses "Send to BSO". | The client comes back with the missing page. The check passes, and the case goes to the BSO. |
| 80 to 95 s | BSO view. "Approved na ba ito?" is refused. | The BSO sees the case with its history. The assistant refuses approval questions, because Credit decides the loan. |
| 95 to 112 s | The BSO returns the case with a reason, and a heads-up is drafted and published. | The BSO still finds a blurry mayor's permit and returns the case with a reason. That reason becomes a reminder that other branches see on similar cases, and only a BSO can publish it. |
| 112 to 150 s | The branch sees "Returned by BSO", checks again and hands it off. | The branch sees the reason right away, fixes it with the client and sends it back. |
| 150 to 168 s | The BSO presses "Endorse to Credit", and the case list shows the count. | The BSO endorses the complete packet to Credit. The list counts how many cases were endorsed with no return, which is the share complete the first time. |

## Voice-over for the slides after the demo

These go with slides 5 to 8 of the Canva design "Counter Check prototype slides". Each takes about 30 to 40 seconds.

| Slide | Voice-over |
| --- | --- |
| AI reads. Rules decide. People decide. | We use AI for two jobs that rules cannot do. It reads the branch's Taglish note and the photos of the documents. It never decides what is required. A table from the BSO checklist decides that, and a person confirms every step. The branch checks the form, the BSO reviews every case, and Credit decides the loan. |
| Safeguards we tested | When the AI cannot read a page or a field, the case goes to a person and never passes. A name or a date from the model is kept only when it appears in the page's own text. Approval questions are refused before the model sees them. In a simulated phone-photo test, none of the 33 defective packets passed. We have not measured real phone photos yet. |
| Cost and speed | One check of a 10-page packet costs about 4 pesos on AWS at list prices, and it takes about 15 seconds. At the BSO's 35 to 60 referrals a month, that is at most about 480 pesos a month. Cloud cost is not the constraint. |
| Path to a pilot | A pilot runs in one area, with one BSO and 8 to 17 branches, on BPI's own account and login. It measures one number, the share of cases the BSO endorses to Credit with no return, which the endorse step in the prototype already records. A new loan product is new rows in the rules table, so the same tool covers all 7 areas. |

## What must be built or measured before Nov 16

1. Deploy `/check` against real Textract and run 60 printed and phone-photographed synthetic documents with labeled defects. Report recall, false-complete and review rate with ranges. This is the most important item. A simulated stand-in ran on 2026-11-12 with `scripts/eval-degraded.mjs` (36 packets with ImageMagick damage on real Textract and Bedrock, results in docs/aws.md). The printed and phone-photographed run is still open.

   How to run it. Print `counter-check-print-test-2026-11-13.pdf` (in Simonee's Downloads, 9 A4 sheets) and cut out the three ID cards on the last sheet. Take one phone photo of each of the 11 pieces at a desk, the way a branch would. Save the photos as JPEG (on an iPhone, set the camera to "Most Compatible") and name each one like its specimen, for example `02-owner-id-front.jpg` and `05b-dti-page-2.jpg`. Put them in one folder and run `API_URL=<api> DEMO_KEY=<key> PHOTOS=<folder> node scripts/eval-degraded.mjs` from `app/`. It runs the same 12 packets as the simulated test (11 planted defects and one complete packet) on the real photos under `RF-2026-804`, in about 3 minutes. A second folder shot in poor light or at an angle gives a second level. The mode was checked on Nov 13 with JPEG copies of the specimens standing in for photos (1 packet, caught in 14.7 s), so the real photos are the only part not yet run.
2. Measured on Nov 13 at about 2:35 AM through the live Worker from a laptop (not a phone). Three 10-page packets (1.5 MB in all, uploaded one page after another) took 3.9 to 7.3 seconds to upload and 16.1 to 19.6 seconds to check, so 20 to 27 seconds end to end. A phone on mobile data is not measured.
3. Run the Taglish test on real Bedrock with a BSO reading the drafts. On Nov 13 the drafts were found to switch between the branch officer and the client as the reader, so the prompt now says the BSO writes to the branch officer about "the client". Eight new Haiku drafts for common defect sets are in `counter-check-taglish-review-2026-11-13.csv` (Simonee's Downloads), with columns for the BSO to mark each one.
4. Done on 2026-11-12. The hackathon AWS role reaches Bedrock and Textract, and the backend runs there (docs/aws.md).
5. Done. Cases live in the Worker's KV store, so the branch window and the BSO window see the same status.
6. Answers from BPI: why a branch officer would open the tool (KPI credit for complete referrals?), how branches submit today, and baselines (share incomplete at first submission, cycles per referral). The BSO stated 35 complete applications a month on average and 50 to 60 in Q4. On Nov 13 the BSO said 35 to 40 complete applications a month for the QC and CamaNava area (one area), with about 30 of them first coming in with requirements missing, and that applications endorsed to Credit each month are part of the BSO's KPI (BSO-stated).

## Live demo for the recorded pitch (Simonee, about 3 minutes)

Run `PW=<playwright dir> CHROME=<chrome> OUT=take.webm node scripts/record-demo.cjs` to record this run sheet as a silent take, or record the screen in real time at 1280 by 800 on the plain link https://counter-check.stimmie.dev/live, which opens a fresh case number. The look changed on Nov 15 at about 8:50 PM (BPI colors on grey, Poppins, a Requirements dropdown, 10 cases per page), so takes from before then show the old look. Keep a second tab ready on the same link with `&role=bso` added after the case number. The sample papers are synthetic, so say that once.

| Do | Say |
|---|---|
| Press Send in the Assistant with the sample note, then Save. Open the Requirements dropdown to show the papers. | The branch officer types what the client said, in Taglish if they like. The AI fills the form, and the officer checks it before saving. The checklist comes from the rules table, not from the AI. |
| Press "Sample papers, visit 1", then Check documents. | The officer snaps the papers at the counter. Textract reads them, Claude reads the IDs and permits from masked text, and the rules decide what's missing. It found two problems while the client is still there. |
| Ask "ano pa kulang?" in the Assistant. | The assistant answers from this case's record, and it won't say a loan is approved. |
| Press "Sample papers, visit 2", then Check documents, then Send to BSO. | On the second visit nothing is missing, so Send to BSO unlocks. It stays locked while anything is open. |
| In the BSO tab, return the case with "Bank statements must cover Sep to Nov 2026." | Say the BSO still needs more after review. The BSO returns it with a note. |
| Back in the branch tab, press "Sample papers, visit 2" and Check documents again. | The AI now reads the new scan against the BSO's note. The statement in this packet covers Aug to Oct, so it's flagged and the case can't go back to the BSO yet. The branch knows exactly what to ask the client for. |
| In the BSO tab, show the case list. | The BSO sees every referral and its status in one place, whether it came in at the branch or online through Ka-Negosyo, and the list counts how many cases were endorsed to Credit with no return, which is the share complete the first time. Ka-Negosyo isn't connected in the prototype, so the channel is a label that the branch picks. |

Regina asked on Nov 15 for the note step to be typed three ways for some humor, in English, in Taglish and in "nokia typing". Clear the form between tries with a fresh case link. All three filled every field on AWS on Nov 15 (9 of 9 each, 1.7 to 3.9 s).

- English. Elena Santos owns Elena's Artisan Bakery, a sole proprietorship in food and beverage. She wants a 750k loan. She's married to Ramon Santos and has a BPI account. No collateral.
- Taglish. Si Elena Santos, may-ari ng Elena's Artisan Bakery, sole prop siya, food business. Gusto niya mag-loan ng 750k. Kasal kay Ramon Santos, may BPI account na, walang collateral.
- Nokia. musta po!! c elena santos po ung owner ng Elena's Artisan Bakery, sole prop po xa, fud bsnes. gs2 nya po mg loan ng 750k. kSal n po xa ky Ramon Santos, my bpi acct n po, wLa pong collateral. tnx po :)

A silent real-time take of this run sheet is `~/Downloads/counter-check-demo-live-2026-11-16.mp4` (2:20 plus a 6 second hold on the last frame, recorded headless with `scripts/record-demo.cjs` on Nov 16 at about 5:45 PM on the /live layout with the true-to-life sample papers, case `RF-2026-589`, all three note styles, the return and the re-check flagging the Aug to Oct statement). The test cases were deleted first. Talk over it, or record your own with it as the guide. The times below are for that take.

| Time | On screen | Say |
|---|---|---|
| 0:00 to 0:25 | Three notes fill the form (English, Taglish, nokia). | The officer types the client's details three ways, and the form fills each time. |
| 0:25 to 0:29 | Save case. The Requirements dropdown opens. | Saving the case brings up the list of papers for a sole proprietorship. |
| 0:29 to 0:54 | Sample papers, visit 1, then Check documents. | The officer snaps the papers, and the check finds a missing DTI page and a blank TIN. |
| 0:54 to 1:04 | "ano pa kulang?" in the Assistant. | The officer asks what's still missing, in Taglish. |
| 1:04 to 1:28 | Visit 2, Check documents, Send to BSO. | On the second visit nothing is missing, so the case goes to the BSO. |
| 1:28 to 1:38 | BSO view, return with "Bank statements must cover Sep to Nov 2026." | The BSO needs newer bank statements and sends it back with a note. |
| 1:38 to 2:14 | Branch view, visit 2 papers checked again. | The branch scans again, and the Aug to Oct statement gets flagged against the note. |
| 2:14 to 2:26 | BSO case list. | The BSO sees every referral and its status in one list. |

The lines only say what's on screen, because pitch slides 11 to 16 and 18 to 21 already explain the AI, the rules and the safeguards (cross-checked on Nov 16 at Regina's ask).

The return step needs a BSO note that the sample photos fail. "Bank statements must cover Sep to Nov 2026." works because the visit 2 statement covers Aug to Oct 2026 (checked on AWS on Nov 15, and again on the true-to-life papers on Nov 16). A check takes 15 to 30 seconds, so keep talking or cut the wait in editing.

## Claims to avoid

- "Models never decide." Say: the checklist and the complete flag are code, and anything unclear is routed to a person. The one exception is the BSO's free-text note after a return, where the AI's "not found" holds the case at the branch. It can hold a case back, and the BSO still reviews every case before Credit.
- "0 percent false-complete." That number came from a simulated generator. Quote only what the real test measures. The Nov 12 run passed 0 of 33 defective packets on simulated photo damage, so say "0 of 33 in a simulated test" and give its limit.
- "BPI uses AWS." It is the team's statement, not a BPI source.
- A management view of incomplete referrals by branch. It reads as surveillance of the BSO's partners. Cut it or anonymize it.
- "Self-learning" or "the AI learns the requirements." The heads-up is a reminder that a BSO publishes after returning a real case. It cannot tell a habit from a rule, so it never changes the checklist or the status.
