"""Generate the synthetic Ledgerline demo documents.

The set is deliberately imperfect: two documents disagree about the webhook
retry queue, one contains a credential that must be redacted before sharing,
and one decision names nobody, which leaves an ownership gap for the reviewer.

Run: python scripts/gen_demo_docs.py
"""

from pathlib import Path

from docx import Document
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer

OUT = Path(__file__).resolve().parent.parent / "demo-data" / "documents"
OUT.mkdir(parents=True, exist_ok=True)

HANDOVER = """# Ledgerline payments migration — handover notes

## Overview
Ledgerline is the checkout and settlement service for our merchant portal. The team is
replacing the legacy transaction processor with a set of Node services. At the time of
writing, the migration is roughly 70 percent complete: card payments run on the new
pathway, bank transfer settlement is still on the legacy system.

## Current phase
The project is in a controlled pilot with three merchants. We have not announced a
general availability date. Priya Raman owns the pilot rollout and reports weekly.

## Decisions
We replaced vendor session cookies with short lived JWT access tokens so the mobile app
can authenticate without a server session. The reasoning was that the Flutter client
could not reliably persist cookies across app restarts.

We decided to keep the reconciliation report generation in the legacy PHP service for
this phase. Rewriting it would have delayed the pilot by an estimated six weeks.

We chose to store merchant settlement exports on the application server instead of the
old managed object store, because the procurement review for the managed store had not
finished.

## Completed work
The chargeback webhook handler is deployed and processing production traffic. Merchant
onboarding now goes through the new admin API. The OpenAPI contract for the payment
initiation endpoint is published and pinned in the client SDK.

## Pending work
Bank transfer settlement still routes through the legacy processor. The merchant
self-service screen for settlement exports is not started. Rate limiting on the public
payment endpoints is configured but not load tested.

## Ownership
Dana Okafor owns the settlement migration and the vendor relationship.
Priya Raman owns the pilot rollout and merchant communications.
Tomas Berg owns the reconciliation service and the legacy PHP integration.

## Next actions
Book a joint session with the vendor to confirm the sandbox cutover date.
Add an alert when chargeback webhook failures exceed one percent over ten minutes.
Publish the settlement export screen design for review before implementation starts.

## Open questions
Do we keep the legacy processor licenced past December, or pay for early termination?
Who signs off on the merchant data retention window that the exports now follow?
"""

RUNBOOK = """Ops runbook — Ledgerline payments

Deployment steps
1. Build the API image with npm run build and publish it to the internal registry.
2. Apply database migrations with the migration runner before starting the new image.
3. Restart the payment worker and confirm the queue depth returns to zero.
4. Open the admin console and verify the health panel shows green for payments.

Environment setup
The service reads DATABASE_URL, JWT_SECRET and VENDOR_API_BASE from the environment.
Copy .env.example to .env for local work. Never commit the filled file.

Known issues
The webhook retry queue is not yet deployed and remains blocked on vendor approval.
Until it ships, failed chargeback webhooks must be replayed manually from the admin
console.

The old vendor sandbox key is still active and was never revoked after the prototype
handed over. Rotate it before any external demo.

The reconciliation job occasionally times out on the last business day of the month
because the legacy PHP service holds a long transaction. Restarting the job is safe.

Dependencies
Vendor approval is required before the retry queue can be enabled in production.
The firewall team must allow inbound traffic on port 8443 for the settlement callback.
The finance team approves every change to the settlement export format.

Rollback
Keep the previous image tag available for two weeks. Rolling back requires replaying the
queue manually because the new worker acknowledges messages differently.
"""

STATUS = """STATUS UPDATE — week 12, Ledgerline payments migration

Overall the migration is tracking to plan. Card payments have been on the new pathway
for five weeks with no settlement incidents.

The webhook retry queue is deployed and live for all merchants, so manual replay of
chargeback webhooks is no longer required.

Pilot feedback from the three merchants is positive. Two asked for a settlement export
download; that work is scheduled for the next sprint.

Open risks: the reconciliation timeout on the last business day of the month is still
unresolved, and the legacy processor licence renewal is due in December.
"""

CONTACTS = """Team contacts and ownership

Dana Okafor — payments lead, owns settlement migration and the vendor relationship.
Reach her on the #payments channel for anything touching bank transfers.

Priya Raman — pilot rollout and merchant communications. She is the person to ask
before contacting a pilot merchant.

Tomas Berg — reconciliation service and legacy PHP integration. Ask him about month end
timeouts and the settlement export format.

Security lead — Meera Iyer. Contact her immediately for any suspected credential leak;
she owns key rotation and the vendor security review.
"""


def write_text() -> None:
    (OUT / "handover-notes.md").write_text(HANDOVER, encoding="utf-8")
    (OUT / "status-update.txt").write_text(STATUS, encoding="utf-8")
    (OUT / "ops-runbook.md").write_text(RUNBOOK, encoding="utf-8")
    (OUT / "contacts.md").write_text(CONTACTS, encoding="utf-8")


def write_docx() -> None:
    doc = Document()
    doc.add_heading("Decision log — Ledgerline payments", level=1)

    doc.add_heading("March 2026 — Settlement export storage", level=2)
    doc.add_paragraph(
        "Decision: keep settlement exports on the application server for the pilot. "
        "Reason: the managed object store procurement review was still open and the pilot "
        "date could not move."
    )
    doc.add_paragraph("Owner: Dana Okafor.")

    doc.add_heading("April 2026 — Token based authentication", level=2)
    doc.add_paragraph(
        "Decision: replace vendor session cookies with short lived JWT access tokens. "
        "Reason: the Flutter client could not persist cookies reliably across restarts."
    )
    doc.add_paragraph("Owner: Tomas Berg.")

    doc.add_heading("April 2026 — Sandbox credential cleanup", level=2)
    doc.add_paragraph(
        "Decision: the old sandbox key was revoked in March and replaced with a key stored "
        "in the shared secret manager. Do not re-enable the old key."
    )
    doc.add_paragraph(
        "No owner was recorded for the key rotation follow up; this must be confirmed "
        "before the next vendor review."
    )

    doc.add_heading("May 2026 — Reconciliation rewrite deferred", level=2)
    doc.add_paragraph(
        "Decision: the reconciliation report generator stays on the legacy PHP service for "
        "this phase. Rewriting it would delay the pilot by roughly six weeks."
    )
    doc.add_paragraph("Owner: Tomas Berg.")

    doc.save(OUT / "decision-log.docx")


def write_pdf() -> None:
    styles = getSampleStyleSheet()
    story = [
        Paragraph("Steering meeting — Ledgerline payments", styles["Title"]),
        Spacer(1, 12),
        Paragraph(
            "Attendees: Dana Okafor, Priya Raman, Tomas Berg, Meera Iyer. "
            "Meeting held in week 11 of the migration.",
            styles["BodyText"],
        ),
        Spacer(1, 10),
        Paragraph("Decisions taken", styles["Heading2"]),
        Paragraph(
            "The group agreed to hold general availability until the webhook retry queue is "
            "approved by the vendor. The pilot stays limited to three merchants in the meantime.",
            styles["BodyText"],
        ),
        Paragraph(
            "Security asked for every sandbox credential to be rotated before the vendor "
            "review in June. Meera Iyer owns that rotation.",
            styles["BodyText"],
        ),
        Spacer(1, 10),
        Paragraph("Risks raised", styles["Heading2"]),
        Paragraph(
            "The settlement export format is not versioned. Finance warned that changing it "
            "after the pilot will require a migration for three merchants.",
            styles["BodyText"],
        ),
        Paragraph(
            "The reconciliation job holds a long transaction on month end and has timed out "
            "twice, delaying settlement confirmations by a day.",
            styles["BodyText"],
        ),
        Spacer(1, 10),
        Paragraph("Actions", styles["Heading2"]),
        Paragraph("Priya Raman to confirm the vendor approval date with procurement.", styles["BodyText"]),
        Paragraph("Tomas Berg to add a month end reconciliation alert.", styles["BodyText"]),
        Paragraph("Dana Okafor to document the manual webhook replay procedure.", styles["BodyText"]),
    ]
    SimpleDocTemplate(str(OUT / "steering-notes.pdf"), pagesize=A4).build(story)


if __name__ == "__main__":
    write_text()
    write_docx()
    write_pdf()
    for path in sorted(OUT.iterdir()):
        print(f"{path.name}: {path.stat().st_size} bytes")
