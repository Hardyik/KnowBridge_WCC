"""
Demo data generator (synthetic, per doc §8): produces the KnowBridge demo
document set for the "Payments Platform — Gateway Migration" scenario.

Planted for the judge walkthrough (proposal §5.4):
  1. A key decision WITH its reasoning preserved in the source  -> supported claim
  2. A decision with reasoning but no owner anywhere             -> "Owner not confirmed"
  3. Two sources that contradict each other about migration state -> conflicting claims
  4. An unresolved question and missing runbook step             -> unsupported/open

Run:  python scripts/gen_demo_docs.py
"""
from pathlib import Path

from docx import Document
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "demo-data" / "documents"
DOCS.mkdir(parents=True, exist_ok=True)


def _text_page(c: canvas.Canvas, title: str, body: list[str], page: int) -> None:
    c.setFont("Helvetica-Bold", 15)
    c.drawString(72, 800, title)
    c.setFont("Helvetica", 10.5)
    y = 775
    for para in body:
        for line in para.split("\n"):
            c.drawString(72, y, line)
            y -= 16
        y -= 6
    c.setFont("Helvetica", 8)
    c.drawRightString(540, 40, f"Payments Platform — demo document, page {page}")
    c.showPage()


def gen_db_migration_pdf(path: Path) -> None:
    """decisions.pdf: 2 pages, decision + reasoning + named owner on p1; p2 decommission decision WITHOUT owner."""
    c = canvas.Canvas(str(path), pagesize=A4)

    _text_page(
        c,
        "Gateway Migration — Decision Record (draft 3)",
        [
            "",
            "Decision: We selected the Stripe-adapter microservice over direct vendor",
            "SDK integration for the transaction routing service.",
            "",
            "Reasoning: Direct SDK integration tied our core payments flows to one",
            "vendor's client library lifetime and gave us no control over edge-case",
            "handling during gateway outages. The adapter service isolates vendor",
            "behaviour behind our own interface and keeps the legacy refund",
            "reconciliation path intact while the migration completes.",
            "",
            "Architecture owner: Aarav Mehta (Payments Platform team).",
            "Implementation owner: Sofia Lindqvist (Transaction Services).",
            "",
            "Approval: signed off in architecture review, 14 March 2026.",
        ],
        1,
    )

    _text_page(
        c,
        "Gateway Migration — Decision Record (draft 3), continued",
        [
            "",
            "Related decision: The legacy transaction-processing service",
            "(internal codename \"TF-Bridge\") is scheduled for decommission after",
            "two clean settlement cycles. TF-Bridge contains unreferenced",
            "reconciliation jobs that must be inventoried before removal.",
            "",
            "NOTE: The decommission decision above was recorded without a named",
            "owner because the last maintainer left the team before this record",
            "was drafted. Whoever takes over payments work must confirm an owner",
            "for the TF-Bridge inventory in their first week.",
            "",
            "Open follow-up: final vendor sandbox dataset location was never",
            "documented — the test-data scripts reference a bucket that is no",
            "longer mounted.",
        ],
        2,
    )

    c.save()


def gen_status_docx(path: Path) -> None:
    """status.docx: claims migration COMPLETE (conflicts with the demo repo)."""
    doc = Document()
    doc.add_heading("Gateway Migration — Status Memo", level=1)
    doc.add_heading("Migration status", level=2)
    doc.add_paragraph(
        "The transaction routing service migration is complete and running "
        "in production as of 18 April 2026. Legacy gateway traffic has been "
        "cut over and the adapter service is processing live settlement."
    )
    doc.add_heading("Work completed", level=2)
    doc.add_paragraph(
        "Refund reconciliation port completed by Sofia Lindqvist. "
        "Encryption protocol wrapper completed and reviewed by Aarav Mehta."
    )
    doc.add_heading("Known gaps", level=2)
    doc.add_paragraph(
        "The TF-Bridge decommission inventory has no confirmed owner and the "
        "detailed reconciliation jobs are undocumented."
    )
    doc.save(str(path))


def gen_runbook(path: Path) -> None:
    path.write_text(
        """Payments Platform — Ops Runbook (excerpt)

Section: Deployment
The adapter service deploys through the payments pipeline with the
profile "adapter-prod". Rolling restart takes about four minutes; do not
run migration reconciliation jobs during the restart window.
Deployment owner for this profile: Aarav Mehta.

Section: Credentials
Sandbox and production vendor keys live in the payments secrets manager
under "gateway/sandbox" and "gateway/production". The legacy TF-Bridge
credential set is revoked and must not be reused.

Section: Known issues
Vendor webhook retries double-count refunds when the adapter is slow to
acknowledge. Workaround until the patch: enable idempotency guard flags
on refund endpoints.

Section: Missing
The run of TF-Bridge reconciliation jobs is undocumented — nobody on the
current team knows whether these still fire on the legacy scheduler.
Marked as an open question for the incoming engineer.
""",
        encoding="utf-8",
    )


def gen_contacts(path: Path) -> None:
    path.write_text(
        """# Gateway Migration — Contacts

| Area | Contact | When to involve |
| --- | --- | --- |
| Vendor integration | Elif Karaca, Stripe partner team | webhook or payout edge cases |
| Settlement ops | Marta Rubio, Finance systems | reconciliation diffs, cut-over windows |
| Security review | Dana Okafor, AppSec | any change touching credential handling |

Escalation: vendor incidents go through Elif first; outages affecting live
settlement page the payments on-call.
""",
        encoding="utf-8",
    )


if __name__ == "__main__":
    gen_db_migration_pdf(DOCS / "decisions.pdf")
    gen_status_docx(DOCS / "status.docx")
    gen_runbook(DOCS / "ops-runbook.txt")
    gen_contacts(DOCS / "contacts.md")
    print(f"Demo documents written to {DOCS}")
