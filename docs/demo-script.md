# Judge demo script (proposal §5.4 walkthrough)

The demo project is **SafeSense — hazard reporting handover**. Its connected
source is the real repository **github.com/Hardyik/SafeSense** (Flutter client,
Flask/MySQL backend, three YOLO hazard models). The four handover documents in
`demo-data/documents/` are **synthetic** — invented colleagues, invented
credentials policy — but they describe the same project as the repository, so
extracted claims and repository evidence line up.

Planted for the walkthrough:

| What | Where | What the judge should see |
| --- | --- | --- |
| Decision with reasoning + owner | `decisions.pdf` p1 | a supported decision with its "why" and named owners |
| Decision with no owner | `decisions.pdf` p2 (Firebase retirement) | **Owner not confirmed** — never invented |
| Contradiction | `status.docx` vs `ops-runbook.txt` (flood model rollout) | both claims flagged **conflict**, both quotes shown |
| Credential exposure | `ops-runbook.txt` credentials section | a risk claim a reviewer can **redact** before sharing |
| Missing runbook knowledge | `ops-runbook.txt` "Missing" section | open questions the incoming engineer must chase |

1. **Sign in** as the manager. *Projects* lists **SafeSense — hazard reporting
   handover**. Open it.
2. **Connect** (Sources tab): upload the four files from
   `demo-data/documents/` if they are not already present, and connect
   `Hardyik/SafeSense`. The repo snapshot is read-only and captures the README
   plus recent commit subjects with resolvable URLs. (That repository has no
   open issues, so the issue channel is simply empty; documents and commits
   carry the evidence.)
3. **Reconstruct**: press *Run AI extraction*. The server ingests each page and
   section with anchors, asks Groq for strictly grounded claims, and reports how
   many were created, how many conflict, how many lack a verbatim quote and how
   many were deduplicated.
4. **Verify** (Map + Claims tabs — the Knowledge Continuity Map):
   - the server-side detection decision shows **Why: …** and its two named
     owners, with a page-1 quote from `decisions.pdf`;
   - the **Firebase retirement decision** carries **⚠ Owner not confirmed** —
     no source names an owner, so none is invented;
   - the **flood-rollout state** appears twice with opposite wording
     (`complete and live for all users` in `status.docx` versus `pending and
     has not been released` in the runbook); both are flagged **conflict** with
     their quotes so the reviewer can decide which source wins;
   - the Firebase service-account risk is evidence-backed, and is the claim to
     redact in step 5.
   Click any node for the inspector: evidence label, quote, and a link to the
   GitHub file/commit or the document page.
5. **Review** (Handovers tab → *New draft handover* → *Review & approve*): as
   manager or reviewer, edit one claim's wording, verify another, exclude one,
   **redact** the credential risk from recipients, add a reviewer note, then
   **Approve & share**. Approval is manager-only; a new draft creates the next
   version and history is kept.
6. **Handover**: open *Recipient view* (or sign in as the recipient account).
   The incoming person sees the approved handover with redacted claims absent,
   the reviewer note on top, and claims the reviewer did not personally verify
   marked **unverified**. Their role tag comes from project membership, not
   from anything in the URL: a recipient is scoped to *Project overview* and
   *Next actions*.
7. **Acknowledge**: press *I have read and acknowledged this handover*. The
   Audit tab then records the acknowledgement alongside approvals, edits,
   source connects, extraction runs and role checks.
8. **Traceability check**: pick any important statement in the report — the
   judge can reach its supporting source in one click, and anything without
   verbatim evidence is visibly flagged instead of presented as fact.

## What this demonstrates (rubric mapping)

- Core workflow end-to-end: steps 2–7 (Connect → Reconstruct → Verify → Review
  → Handover).
- Evidence-linked output: steps 4–6, page/section anchors and GitHub URLs.
- Uncertainty & conflicts: step 4 (conflict pair, "Owner not confirmed",
  unverified claims).
- Human control: step 5 (edit / verify / exclude / redact / approve).
- Permission-aware sharing: steps 6–7 (server-derived role scope, redaction,
  acknowledgement, audit).
