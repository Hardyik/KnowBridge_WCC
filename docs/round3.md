# Round 3 — the three committed improvements, plus an assistant

Round 2 ended with three improvements committed for the next round (§8 of the Round 2 report).
This round implements all three, and adds an AI assistant that answers questions from the same
evidence base.

Everything below is enforced in the API. The web client only renders what the server already
decided it may show.

---

## 1. A second source type with cross-source synthesis

**What it does.** A manager can connect a public GitHub repository in the Sources tab. The
connector reads three things — the README, the 15 most recently updated issues (excluding pull
requests), and the 15 most recent commits (excluding merge commits) — and stores them as ordinary
sources of kind `github`, with one dated passage per issue and per commit.

**Why it is safe.** Read-only: the connector never writes to GitHub, and it exposes no token to the
browser. A private repository is refused unless the API has a `GITHUB_TOKEN` for an account that
can already read it.

**What it enables.**

- **Per-source evidence.** A claim from a commit quotes the commit; a claim from an issue quotes
  the issue. The source kind is shown on every claim card, in the timeline and in delivery views.
- **A cross-source timeline.** Each passage carries `occurred_at` — the date the source itself
  states. The Timeline tab orders claims by that date and shows document claims separately as
  undated, because a handover note rarely states one. Nothing is guessed.
- **Cross-source corroboration.** `server/src/services/corroboration.ts` compares claims from
  different source kinds and flags the same fact stated twice ("also stated in …"). It is
  deterministic, has no model in the loop, and requires 50 % subject overlap.

**Honest limit.** Corroboration only fires when both source kinds discuss the same thing. With the
bundled Ledgerline documents, connecting this repository shows a timeline but no corroboration,
because the repository is about KnowBridge and the documents are about Ledgerline. Connect a
repository about the same project to see corroboration.

## 2. Review-preserving re-extraction, version comparison and rollback

**Re-extraction that keeps human judgement.** Every claim now stores a `fingerprint` (a hash of
its normalised statement) and the chunk it came from. "↻ Refresh all" regenerates every passage
rather than skipping the ones that already produced claims. Before regenerating, unreviewed claims
are removed and reviewed claims are kept; afterwards, each reviewer decision (verified, corrected,
redacted, excluded) is matched to the regenerated claim by fingerprint and, failing that, by 70 %
subject overlap within the same passage. The run summary reports `reviews_preserved` and
`reviews_reset`, so a decision is never silently dropped.

**Version comparison.** `GET /api/handovers/:id/diff/:otherId` compares two frozen snapshots by
claim identity: added, removed, rewritten and unchanged. The Handover tab offers *Compare* on every
older approved version.

**Rollback.** `POST /api/handovers/:id/rollback` restores an earlier approved snapshot as a **new**
approved version: earlier approvals are marked superseded, any open draft is closed, and the audit
trail records which version was restored. History is never rewritten.

## 3. Confidentiality tiers and delivered handover

**Tiers.** Every source is `public`, `internal` or `restricted`:

| Tier | Who can see it |
| --- | --- |
| public | every recipient scope |
| internal | engineer and manager scopes only |
| restricted | team only — never a recipient view, never a delivery link, never the assistant's context |

A manager changes a source's tier in the Sources tab. Live views reflect it immediately, and the
current tier of a source also overrides the copy frozen in an approved snapshot: tightening a
tier after approval immediately withdraws those claims from every recipient view and delivery
link. A restriction can never be bypassed by an earlier approval, and a tier change never makes
a claim more visible than it was at approval time.

**Delivery links.** A manager issues a link with a fixed scope and an expiry (1–90 days). The link
is a 24-byte random token; the public page at `#/delivery/<token>` needs no account. It applies the
same section-scope and confidentiality filter as the signed-in view, counts opens, and accepts a
named acknowledgement. The manager can revoke it, sees who has not acknowledged, and "Remind"
records the reminder in the audit trail and copies the link — KnowBridge does not send email, so
nothing pretends a message was delivered.

## 4. AI assistant tab

`POST /api/projects/:id/assistant` answers a question from the project's own handover: the newest
approved snapshot if one exists, otherwise the live claims. The context is filtered by the
member's scope and each source's tier before the model sees it, so a general-scope recipient cannot
be told what a restricted document says.

The model must answer from the numbered context, cite the claim ids it used, present contradictions
as contradictions, and say plainly when the handover does not record an answer (`grounded: false`).
Answers and citations are stored per person, so the conversation survives a reload; "Clear
conversation" removes that person's transcript, not the audit entry.

## Schema

`docs/schema.sql` is the full Round 3 schema for a fresh project. An existing Round 2 database
needs `docs/migration-round3.sql`, which is additive and idempotent:

- `sources`: `kind`, `external_ref`, `confidentiality`, `last_synced_at`
- `source_chunks`: `occurred_at`
- `claims`: `occurred_at`, `fingerprint`
- new tables: `delivery_links`, `delivery_acknowledgements`, `assistant_messages`
- RLS enabled on all three new tables, no public policies (as in Round 2 — the API holds the only
  service-role key)

## Configuration

| Variable | Needed for | Notes |
| --- | --- | --- |
| `GITHUB_TOKEN` | Connector | Optional. Raises GitHub's anonymous 60 req/h limit; required for a private repo |
| `WEB_ORIGIN` | Delivery links | Public web origin used to build `#/delivery/<token>`; defaults to `CORS_ORIGIN` |

## Verification

See §7 of [`docs/round2-report.md`](round2-report.md) for the Round 2 results and the end-to-end
script `scripts/round3-smoke.mjs` for these features. Run it against a local API:

```bash
node scripts/round3-smoke.mjs connect     # repository → dated sources
node scripts/round3-smoke.mjs extract     # documents + repository claims
node scripts/round3-smoke.mjs refresh     # reviewer decisions survive a refresh
node scripts/round3-smoke.mjs handover    # diff two versions, restore the older one
node scripts/round3-smoke.mjs delivery    # tiers, expiring link, acknowledgement
node scripts/round3-smoke.mjs assistant   # grounded answer, off-topic refusal
```
