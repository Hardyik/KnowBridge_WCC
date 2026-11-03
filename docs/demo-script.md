# KnowBridge demo script

Use the seeded accounts. Both are pre-created by `npm run seed`; the project is seeded too.

| Who | Email | Password |
| --- | --- | --- |
| Manager (departing lead) | manager@knowbridge.demo | KnowBridge2026! |
| Incoming engineer | incoming@knowbridge.demo | KnowBridge2026! |

## 1. Sign in as the manager

Open the app, sign in. The project list shows **Ledgerline payments migration** with 0 sources.

## 2. Connect authorised sources

Open the project → **Sources** → choose all six files in `demo-data/documents/`:

- `handover-notes.md`, `ops-runbook.md`, `status-update.txt`, `contacts.md`
- `decision-log.docx`, `steering-notes.pdf`

Expect six rows with `ready` and a passage count (PDF and DOCX prove format support).

## 3. Reconstruct

Press **▶ Run AI extraction**. It takes roughly one to three minutes for ~12 passages; the bar
reports claims created, conflicts, review flags, duplicates and ownership gaps.

Expected on this document set (exact wording varies by run):

- roughly 40–60 claims across nine sections;
- **at least one conflict**: "webhook retry queue is not yet deployed" (runbook) against
  "webhook retry queue is deployed and live" (status update);
- a few **needs_review** claims whose quote the model paraphrased;
- several **Owner not confirmed** decisions.

## 4. Inspect the map

**Map** shows the Knowledge Continuity Map: counts, the conflict banner listing both sides, and
cards grouped by section. Every card names its document and section; the quotes are in **Claims**.

## 5. Verify and correct

**Claims** → each card has `Verify`, `Redact`, `Exclude`, `Edit text`.

- Verify a decision you agree with.
- Redact the credential line ("old vendor sandbox key is still active…"). It stays visible to
  reviewers, never to the recipient.
- Open a conflicted claim and read both quotes before deciding which to keep. Exclude the one the
  team says is stale — the system will not choose for you.

## 6. Review and approve

**Handover** → **Start handover draft**. Add a reviewer note such as *"Retry queue status
conflicts between the runbook and the status update — confirm with the vendor before announcing
anything."* Then **Approve & share**.

Expect: version `v1` appears as `approved`, and the recipient link is shown.

## 7. Hand over

Sign out, sign in as **incoming@knowbridge.demo**, open the project, follow **v1 approved →**.
Expect:

- scope badge `engineer` and only the sections that scope allows;
- the redacted credential claim is absent, and the page reports how many items were withheld;
- the reviewer note is displayed;
- **Acknowledge receipt** records the acknowledgement (visible to the manager afterwards).

To show permission-awareness in one screen: as the manager, change the incoming member's scope to
`general` on **Members**, then reload the recipient view in a second browser. Only overview,
pending work and next actions remain; nothing is re-extracted.

## 8. Audit

Back as the manager → **Audit**: source connections, the extraction run, each claim correction,
draft creation, approval, the recipient's opening (with the scope that was applied) and the
acknowledgement.

## Things to say out loud

- Every statement carries the document and section it came from, plus the verbatim quote.
- The tool shows contradictions and missing owners instead of inventing an answer.
- Approval freezes a version; later edits do not silently change what was shared.
- The scope is decided by the server from the member record, not by the browser.
