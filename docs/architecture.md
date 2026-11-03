# KnowBridge architecture

## Shape of the system

```
Browser (React SPA)
  │  HTTPS, bearer token from Supabase Auth (obtained via the API, never embedded)
  ▼
Express API (/api)
  ├── auth routes        sign up, sign in, session profile
  ├── project routes     projects, membership, audit
  ├── source routes      upload, list, remove, run extraction
  ├── claim routes       list claims, reviewer corrections
  └── handover routes    draft, note, approve, reject, recipient view, acknowledge
  │
  ├─► Supabase Postgres  (service-role key, RLS deny-all for the browser)
  └─► Groq API           JSON-mode extraction per chunk
```

The browser never talks to Postgres or to Supabase with a privileged key. `web/.env` only
optionally carries the API origin; no Supabase keys ship to the client. The Supabase anon key is
used server-side only, to exchange a password for an access token.

## Data model

```
profiles ─┐
projects ─┼─ project_members (role: manager | reviewer | recipient, scope: engineer|manager|coordinator|general)
          ├─ sources ── source_chunks
          │               └── claims ── (quote, location, status, review_state)
          ├─ handovers (version, status, snapshot jsonb)
          │               └── acknowledgements
          └─ audit_log
```

A **claim** is the unit of knowledge: one statement, one category, one source, one chunk, one
verbatim quote, one review state. `handovers.snapshot` freezes the claims that existed at
approval time, so later corrections cannot silently change a shared handover.

Full DDL: [`schema.sql`](schema.sql).

## Data flow

1. **Upload.** `POST /api/projects/:id/sources` accepts up to 10 files (15 MB each). Text is
   extracted (`pdfjs-dist`, `mammoth`, UTF-8), then split into passages of ≤ ~1500 characters at
   heading boundaries. Each passage stores its nearest heading as `location`.
2. **Extraction.** `POST /api/projects/:id/extract` runs three concurrent Groq calls at a time,
   one per passage. The model must return JSON claims with `category`, `text`, `quote`,
   `reasoning`, `owner_text`.
3. **Evidence check.** The quote is normalised (case/whitespace) and searched inside the passage:
   found → `supported`; present but not found → `needs_review`; no quote at all → `unsupported`.
   Nothing is ever stored as "verified" by the model.
4. **Conflicts.** After insertion a deterministic pass compares claims from different passages:
   opposing word poles (`pending` vs `complete`, `disabled` vs `active`, …) plus ≥ 40 % subject
   overlap. Both claims are marked `conflicting` with a shared group id. The system shows both
   sides and asks a human to resolve them.
5. **Ownership gaps.** If a passage names no person/team and its decision claim has no owner,
   `owner_text` becomes the literal **Owner not confirmed** rather than a guess.
6. **Review.** `PATCH /api/claims/:id` sets `review_state` (`pending|verified|redacted|excluded`)
   and/or a corrected `text`. `original_text` keeps the model's wording; the reviewer id and
   timestamp are stored, and the change is audited.
7. **Approval.** `POST /api/handovers/:id/approve` (manager only) snapshots every non-excluded
   claim grouped into nine sections, marks older approved versions `superseded`, and stamps the
   approver and time.
8. **Recipient view.** `GET /api/handovers/:id/recipient` reads the **member row** for the
   caller's scope, filters sections through `SECTIONS_BY_SCOPE`, drops `redacted` claims and
   reports how many items were withheld. A `?role=` parameter has no effect — the server never
   accepts a client-chosen scope.
9. **Acknowledgement.** `POST /api/handovers/:id/acknowledge` upserts `(handover_id, user_id)`.

## Sections and scopes

| Section | Source categories |
| --- | --- |
| Project overview | setup, plus project record |
| Completed work | completed |
| Pending work | pending |
| Key decisions | decision |
| Ownership | owner, contact |
| Risks and blockers | risk, blocker |
| Dependencies | dependency |
| Next actions | next_action |
| Open questions | other, plus flagged conflict/gap context |

| Scope | Sections |
| --- | --- |
| engineer | all nine |
| manager | all except nothing withheld by section (redactions still apply) |
| coordinator | overview, pending, ownership, dependencies, next actions, open questions |
| general | overview, pending, next actions |

Scope is set per member by the project manager on the Members tab.

## Security and privacy decisions

- The service-role key exists only in the API process. RLS is enabled with **no** anon/
  authenticated policies, so a leaked anon key cannot read project data.
- Every route resolves the bearer token to a profile (`auth.getUser`) and then checks project
  membership; membership checks are expressed as `[requireAuth, memberGuard]`, so a route cannot
  check membership without a session.
- Role checks: upload/extract/claim editing = manager or reviewer; approval, rejection, source
  removal and member changes = manager.
- Redaction is a review state, not a delete: reviewers still see the claim, recipients never do.
- The audit log records project creation, source add/remove, extraction runs, claim corrections,
  draft creation, approval, rejection, handover opening (with the scope used) and acknowledgement.
- Uploaded files are stored as text chunks only; no binary is retained in the database or object
  storage. Removing a source deletes its chunks and claims.

## Failure handling

- Unreadable file → source row kept with `status = failed` and the parser message surfaced in the UI.
- Groq rate limit / 5xx → up to four retries, honouring the `retry after` hint in the 429 body;
  exhausted passages are reported in `sources_failed` instead of failing the whole run.
- Extraction is incremental: a passage that already produced claims is skipped on later runs, so a
  rate-limited run can be repeated without paying for the whole document set again.
- Configuration errors (unknown model, bad key) fail immediately instead of retrying.
- Model JSON that does not parse or violates the category/length rules → that row is dropped, the
  rest of the passage still lands.
- Duplicate claims (same normalised text in the project) are skipped and counted.
- A handover cannot be approved with no claims, and a non-approved handover cannot be opened as
  a recipient.

## Deliberate trade-offs

- **Chunk-level extraction, no cross-document synthesis.** Cheaper, more traceable, and quotes
  stay verifiable. The cost is that a project-level narrative is only as good as its sections.
- **Deterministic conflict detection.** A judge can always explain why two claims conflict. A model
  judge would catch more, but would be unpredictable and untestable.
- **Snapshot on approval.** Reviewers edit claims, not handover copies, so there is one source of
  truth during review; the snapshot exists only to protect what was shared.
- **Documents only.** The Round 1 plan included a GitHub connector; it was cut to keep the central
  workflow reliable (see `round2-report.md`).
