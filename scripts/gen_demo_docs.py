"""
Demo data generator (synthetic, per doc §8): produces the KnowBridge demo
document set for the "SafeSense — hazard reporting" handover scenario.

The repository connected in the demo is github.com/Hardyik/SafeSense
(Flutter app + Flask/MySQL backend + three YOLO hazard models). These
documents are the synthetic handover material the outgoing team left
behind — same project, so extracted claims and repository evidence line
up for a judge.

Planted for the judge walkthrough (proposal §5.4):
  1. A key decision WITH its reasoning and a named owner   -> supported claim
  2. A decision with no owner named anywhere               -> "Owner not confirmed"
  3. Two documents that contradict each other on the flood
     model rollout state                                   -> conflicting claims
  4. A credential/risk item a reviewer must redact before
     sharing with the incoming person                      -> redaction demo

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
    c.drawRightString(540, 40, f"SafeSense handover — synthetic demo document, page {page}")
    c.showPage()


def gen_decisions_pdf(path: Path) -> None:
    """decisions.pdf: 2 pages, decision + reasoning + owner on p1; p2 decision WITHOUT owner."""
    c = canvas.Canvas(str(path), pagesize=A4)

    _text_page(
        c,
        "SafeSense — Architecture Decision Record (draft 2)",
        [
            "",
            "Decision: Hazard detection stays server-side in the Flask backend",
            "using the three YOLO model files, instead of running inference",
            "on-device inside the Flutter app.",
            "",
            "Reasoning: On-device inference could not finish inside two seconds",
            "on the low-end Android phones used in the pilot, and every model",
            "update would have required a Play Store release. Keeping the",
            "models behind the Flask API lets us ship a new .pt file without",
            "touching the mobile client, and the app only needs the API base",
            "URL (configured through dart-define or lib/config/app_config.dart).",
            "",
            "Backend owner: Meera Iyer (Flask API and model serving).",
            "Mobile owner: Priya Sharma (Flutter client, release builds).",
            "",
            "Approved in the architecture review on 12 March 2026.",
        ],
        1,
    )

    _text_page(
        c,
        "SafeSense — Architecture Decision Record (draft 2), continued",
        [
            "",
            "Related decision: The Firebase storage bucket used by the first",
            "prototype is retired. Uploaded photos are written to local disk",
            "on the API host and referenced from the MySQL uploaded_image",
            "column, matching the 100% local architecture in the README.",
            "",
            "NOTE: This retirement decision was recorded without a named owner.",
            "The original author left the team before it was written down, and",
            "no review note assigns one. The incoming engineer must confirm who",
            "owns revoking the old Firebase credentials.",
            "",
            "Open question: video-based hazard detection was proposed during",
            "the pilot but was never evaluated or scoped.",
        ],
        2,
    )

    c.save()


def gen_status_docx(path: Path) -> None:
    """status.docx: claims the flood model rollout is COMPLETE (conflicts with the runbook)."""
    doc = Document()
    doc.add_heading("SafeSense — Status Memo", level=1)

    doc.add_heading("Rollout status", level=2)
    doc.add_paragraph(
        "The flood hazard model rollout is complete and live for all users. "
        "hazard_best.pt, flood_best.pt and hazard_fire_building_best.pt are "
        "all serving traffic from the Flask backend."
    )

    doc.add_heading("Delivered this cycle", level=2)
    doc.add_paragraph(
        "Admin dashboard shipped with alert review and user promotion. "
        "Emergency contacts, location shares and risk zones are backed by "
        "the migration script 001_add_new_tables.sql."
    )

    doc.add_heading("Known gaps", level=2)
    doc.add_paragraph(
        "The Firebase retirement decision still has no named owner, and the "
        "release checklist omits the JWT secret rotation step."
    )
    doc.save(str(path))


def gen_runbook(path: Path) -> None:
    path.write_text(
        """SafeSense — Ops Runbook (excerpt)

Section: Backend deployment
The Flask API runs on the university VM behind the campus network. Deploy
by pulling the Backend folder, reinstalling requirements.txt, importing
schema.sql (or the newest migration) and restarting the service.
Deployment owner for the VM: Meera Iyer.

Section: Mobile release
Build the release APK with the API base URL baked in:

    flutter build apk --release --dart-define=API_BASE_URL=http://<LAN-IP>:5000

The manifest allows cleartext LAN traffic, so the phone and the VM must be
on the same network. Release owner: Priya Sharma.

Section: Credentials
Database credentials and JWT_SECRET live in Backend/.env and must never be
committed. The old Firebase storage bucket is still reachable — its
service account key was never revoked after the prototype was retired.

Section: Rollout status
The flood hazard model rollout is pending and has not been released to
users. Only hazard_best.pt and hazard_fire_building_best.pt are approved
for the pilot; flood_best.pt still needs a second accuracy pass on the
labelled flood images collected in February.

Section: Missing
Nobody documented how the risk-zone polygons were generated, and the
labelled dataset used to train the three models is not stored with the
repository. Treat both as open questions for the incoming engineer.
""",
        encoding="utf-8",
    )


def gen_contacts(path: Path) -> None:
    path.write_text(
        """# SafeSense — Contacts

| Area | Contact | When to involve |
| --- | --- | --- |
| Model accuracy | Meera Iyer, backend and models | any change to flood_best.pt or hazard thresholds |
| Mobile release | Priya Sharma, Flutter client | APK builds, API base URL, Play/APK distribution |
| Campus infrastructure | Arun Desai, university IT | VM access, firewall rules, LAN addressing |
| Security review | Dana Okafor, AppSec | anything touching JWT_SECRET or database credentials |

Escalation: model regressions go to Meera first; anything that exposes the
database or the .env file pages Dana immediately.
""",
        encoding="utf-8",
    )


if __name__ == "__main__":
    gen_decisions_pdf(DOCS / "decisions.pdf")
    gen_status_docx(DOCS / "status.docx")
    gen_runbook(DOCS / "ops-runbook.txt")
    gen_contacts(DOCS / "contacts.md")
    print(f"Demo documents written to {DOCS}")
