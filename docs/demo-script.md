# Judge demo script (proposal §5.4 walkthrough)

All data is synthetic (payments-platform "Gateway Migration"). Two demo
accounts: a **manager** and an **incoming engineer (recipient)**.

1. **Sign in** as the manager. *Projects* lists one project:
   "Payments Platform — Gateway Migration". Open it.
2. **Connect** (Sources tab): four synthetic documents are already uploaded
   (`decisions.pdf`, `status.docx`, `ops-runbook.txt`, `contacts.md`) and the
   demo GitHub repository (`owner/demo-gateway-migration`) is connected — its
   README openly says the migration is **incomplete** while `status.docx`
   claims it is **complete**.
3. **Reconstruct**: press *Run AI extraction*. The server extracts text with
   page/section anchors, asks Groq to produce strictly-grounded claims, and
   returns the summary (created / conflicting / without-evidence counts).
4. **Verify** (Map + Claims tabs, the Knowledge Continuity Map):
   - the Stripe-adapter decision shows its **reasoning** and its named owners,
     with a page-2 quote from `decisions.pdf`;
   - the **TF-Bridge decommission** decision shows *Owner not confirmed* —
     no source names an owner, and the system does not invent one;
   - the **migration state** appears as a **conflict**: `status.docx` and the
     GitHub README disagree; both quotes are shown for resolution;
   - the reconciliation-jobs question shows **no evidence** — flagged, not stated as fact.
   Click any node: full claim inspector with evidence links (open the actual
   GitHub URL or see the PDF page label).
5. **Review** (Handovers tab -> Review & approve): as manager/reviewer, edit a
   claim, verify another, exclude one, redact a vendor credential detail from
   recipient views, add a reviewer note, then **Approve & share** (approval is
   manager-only and creates a new version, history is kept).
6. **Handover**: switch to the recipient account (or open *Recipient view*).
   The incoming engineer sees the role-appropriate approved handover: sections
   scoped by role, redacted claims absent, reviewer note on top, "unverified"
   claims visibly marked.
7. **Acknowledge**: press *I have read and acknowledged this handover* — the
   manager's audit trail (`Audit` tab) records the acknowledgement, approval,
   edits, source connects and extraction runs.
8. **Traceability check**: pick *any* important claim in the report — a judge
   can click through to its supporting source in one click, and unsupported
   statements are visibly flagged instead of presented as fact.

## What this demonstrates (rubric mapping)

- Core workflow end-to-end: steps 2-7 (Connect -> Recipient view).
- Evidence-linked output: step 4-6.
- Uncertainty & conflicts: step 4 ("no evidence", "conflict", "Owner not confirmed").
- Human control: step 5 (edit/verify/exclude/redact/approve).
- Permission-aware sharing: step 6-7 (role-scoped view + audit).
