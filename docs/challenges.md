# Challenge log

Each row is an attack on the idea or the code, and what changed. Newest at the bottom.

| Attack | Evidence | Change |
| --- | --- | --- |
| Self-learning rule suggestions are the headline | BSO ranked inquiries and status above extra documents, and said extras are handled by phone. A simulation only recovered planted rules, by construction. | Self-learning demoted to an optional BSO-side suggestion. Headline is the counter check, auto status and the resubmission reconciler. |
| Near-spelling surnames (Santos vs Santoz) pass an OCR-tolerant name match | Experiment: name-mismatch recall 0.85 to 0.94 | Fuzzy matching is earned by low OCR confidence only. Both fields read confidently: strict compare. |
| OCR noise causes false alarms | Experiment: 26 percent false alarms at 15 percent field noise, 66 percent at 50 percent | OCR folding (rn/m, 0/o, l/1/i), lost-space handling, confidence gate. Now 5 percent at 15 percent noise, 23 percent at 50 percent. Residue comes from silent high-confidence misreads, which cannot be fixed by the checker. |
| "Complete" can hide uncertainty | A low-confidence mismatch became a review flag, but complete stayed true | `complete` now requires no defects and no review flags. False-complete is 0 percent in the simulation at every noise level. |
| A bigger AI role makes the system less trustworthy | A hallucinated field or wrong status answer is worse than the email loop | Models only read, draft and answer from tool results. Outputs are schema-validated, doc types are an enum, unreadable pages flag review, the agent has a turn cap and hands off to the BSO. |
| The simulation measures its own generator | Same assumptions in generator and checker | The experiment is labeled simulated OCR noise. It says nothing about Textract or any model. Real measurement needs AWS access and the 60-document test. |

Open challenges: see the reviewer notes added below after each review round.
