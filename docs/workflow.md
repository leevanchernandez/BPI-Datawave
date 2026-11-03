# Loan referral workflow

## Participants

- Client: MSME owner or representative visiting a branch.
- Branch manager (BM): records financing needs, discusses product options, collects requirements, and refers the case.
- Business service officer (BSO): follows up with the client and prepares a complete case for credit review.
- Credit team: reviews the application and makes the lending decision outside this prototype.

## BM flow

1. Create a referral with the client's business, contact details, industry, business structure, financing purpose, and requested amount.
2. Review the suggested loan category and select an alternative if appropriate.
3. Review requirements for the business structure. Confirm the sample checklist against approved bank policy.
4. Collect documents and mark checklist items collected. Add sample attachment metadata.
5. Assign a BSO, review the assistant's handoff summary, and refer the case once all sample checklist items are collected.
6. Track the referral's status and activity.

## Demo statuses

| Status | Meaning |
| --- | --- |
| Draft | Referral created or checklist completed, pending BM handoff |
| Missing requirements | One or more checklist items remain outstanding |
| With BSO | BM handed off the complete sample checklist |
| For approval | Example of a downstream case submitted for credit review |

The prototype starts with sample records at different stages. It does not implement a BSO portal or credit review workflow. The BM cannot approve a loan. Collected checklist items are locked after handoff.

## Next integrations

- Shared database so authorized teammates see the same clients and statuses
- BM/BSO identity and role permissions
- Secure document storage and document review
- Approved product catalog and requirements by client situation
- Live AI assistant grounded in the approved policy source
- BSO client follow-up workflow and credit review integration
- Timestamped audit trail and concurrent-edit handling

Keep model API keys on the server. Treat AI output as guidance requiring human review; it must not make credit decisions.
