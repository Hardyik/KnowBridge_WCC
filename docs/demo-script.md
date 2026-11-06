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

---

# Round 3 additions (optional, five minutes)

These extend the same Ledgerline project. Do them after §8 if time allows; each one is a single
tab.

## R1. Repository connector and timeline

1. **Sources** → *Connect a GitHub repository* → `Hardyik/KnowBridge_WCC` → **Connect repository**.
   Two sources appear with the `github` badge: the README and the recent commits.
2. **Run AI extraction** once (Groq's token-per-minute limit may need a second press — it resumes).
3. **Timeline**: claims from commits are grouped by month with the commit date and message as
   evidence; document claims sit under **Undated** instead of being given an invented date.
4. Where a commit and a document state the same fact, the claim shows **also stated in …** — here
   the README describes the retry-queue contradiction the runbook also records.

## R2. Refresh that keeps review decisions, then diff and restore

1. **Claims**: verify or redact one claim, for example the sandbox-key line.
2. **↻ Refresh all**: the summary reports how many reviewer decisions were carried over. The claim
   you verified is still verified, with the same id.
3. **Handover → Handover versions**: press **Compare** on an older approved version. The panel
   shows added, removed, rewritten and unchanged statements — matched by text, so a refresh that
   regenerates ids does not look like wholesale change.
4. Press **Restore** on an older version: it becomes a new approved version and the previous one is
   marked superseded. Nothing is deleted.

## R3. Confidentiality tier and an expiring delivery link

1. **Sources**: change a source's confidentiality to `restricted`. Immediately, that source's
   claims disappear from every recipient view and delivery link, even one approved earlier.
2. **Handover → Deliver this handover**: choose a scope (`general` is the most striking), an
   expiry of 1–3 days, and create the link. **Copy** it.
3. Open the link in a private window — no account needed. The page shows only overview, pending
   work and next actions, the reviewer note, and an acknowledgement form.
4. Acknowledge as a name; back in the manager's Handover tab the link shows the acknowledgement
   time. **Remind** is available for links that are still unacknowledged, and **Revoke** kills a
   link immediately.

## R4. AI assistant

**AI Assistant** tab (or the recipient's own session): ask *What is still pending, and who owns
it?* The answer is built only from the scoped handover and lists the claims it used with their
source and quote. Ask something the documents never mention — for example *Who won the 2010 World
Cup?* — and it says the handover does not record it, rather than answering.

Say out loud: the assistant is a reader of the same evidence base, not a second source of truth;
its context is filtered by scope and confidentiality before the model sees it.
