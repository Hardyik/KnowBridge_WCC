# KnowBridge — Round 2 technical document

## 1. Architecture & data flow

```
Browser (React + TS, Vite)
   |  HTTPS, Bearer = Supabase access token
   v
Express API (Node + TS)
   |-- auth guard: validates the Supabase JWT, loads profile
   |-- membership guard: project/handover role checks (manager/reviewer/recipient)
   |-- ingestion service:  PDF (pdfjs, page-anchored) / DOCX (mammoth,
   |                       section-anchored) / TXT+MD chunker
   |-- github connector:   read-only snapshot at connect time
   |                       (README, docs/*, open issues, recent commits)
   |-- extraction service: Groq (llama-3.3-70b, JSON mode, temperature 0)
   |                       -> strict zod validation -> claims + evidence
   |                       -> dedup + conflict detection -> Supabase
   |-- handover service:   versioned drafts, reviewer edits, approval,
   |                       role-aware recipient view, acknowledgements
   v
Supabase (Postgres + RLS, Auth, Storage: kb_documents private bucket)
```

Every AI-extracted statement is stored as a **claim** with:
`category`, `text`, `reasoning` (only when the source states it),
`status` (`supported` | `needs_review` | `conflicting` | `unsupported`) and
**evidence rows** pointing at source + location (page / section / issue /
commit) with the verbatim quote and, for GitHub, a resolvable URL.

## 2. Trust & permissions model (problem statement §Trust Requirements)

- **Traceable**: the UI never shows an important statement without its evidence
  list; evidence opens the actual document page or GitHub object.
- **Do not present assumptions as verified truth**: claims with no grounding
  quote are `unsupported` and are labelled "no evidence"; the model prompt
  (server/services/groq.ts) enforces skip-over-invent with verbatim-quote
  requirements; zod validation drops anything outside the schema.
- **Conflicts**: same-category claims with opposite state words are upgraded
  to `conflicting` automatically; the reviewer resolves them.
- **Human control**: draft -> reviewer edit/verify/reject/redact -> manager
  approval -> versioned history; everything is audited (audit_log).
- **Permission-aware**: recipients get a server-computed role view
  (engineer / manager / coordinator / general); redacted and excluded claims
  never reach the payload; acknowledgement is recorded.

## 3. Stack decision notes

| Layer | Choice | Round 2 change | Reason |
| --- | --- | --- | --- |
| AI model | Groq | **was ambiguous in Round 1 (Groq vs Gemini)** — locked to Groq | fast structured JSON extraction, temperature 0, JSON mode |
| Web | React + TS (Vite) | unchanged | matches proposal |
| Mobile | React Native | **deferred to Round 3+** (responsive web only) | 14-day scope; proposal §5.2 already anticipated the deferral |
| Backend | Express + TS | unchanged from proposal | team roles align to it |
| Data | Supabase (Postgres/Auth/Storage) + RLS | unchanged from proposal | one managed dat­a plane |
| Demo data | synthetic payments-migration set | generated via scripts/gen_demo_docs.py | privacy rule; planted conflicts/owners/gaps |

## 4. Three major improvements committed for Round 3

1. **Interactive decision timeline** — a chronological timeline of dated
   decisions/change events reconstructed from commit dates, issue timestamps
   and document dates, with evidence links per marker.
2. **Task-board ingestion (CSV export)** — accept a task-board CSV as a source
   type so pending work / ownership evidence does not rely only on docs+GitHub.
3. **Recipient readiness checklist & acknowledgement analytics** — per-section
   read-confirmation for the incoming person plus a manager dashboard showing
   which handover sections were acknowledged and which questions remain open.

## 5. Known limitations (Round 2)

- Extraction runs synchronously per piece; large repos take minutes.
- Conflict detection is lexical-heuristic, not semantic.
- One GitHub repo connector; token is static PAT, not an app install flow.
- No mobile app (deferred); no Slack/drive integrations (future scope).
