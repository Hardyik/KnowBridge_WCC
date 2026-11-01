# KnowBridge

**AI-assisted knowledge handover platform — Team Fallen Crows, Round 2 build.**

KnowBridge turns scattered, authorised project activity (documents + a connected
GitHub repository) into a reviewable, evidence-linked, permission-aware handover
for the incoming person.

The core workflow (matches the Round 1 proposal §2.2, challenge §2):

```
Connect -> Reconstruct -> Verify -> Review -> Handover
```

---

## Repository layout

```
web/        React + TypeScript (Vite) — judge-facing UI
server/     Express + TypeScript REST API (auth, ingestion, Groq extraction)
shared/     Shared domain types + zod schemas (@knowbridge/shared)
docs/       Supabase schema, architecture & data flow, demo script
demo-data/  Synthetic demo set: generated documents + demo-repo contents
scripts/    Demo data generator
```

## Judge quickstart / demo script

See [docs/demo-script.md](docs/demo-script.md) for the 8-step walkthrough of
one project: upload docs, connect the repo, run extraction, inspect evidence,
see conflicts and "Owner not confirmed", review, approve, switch to the
recipient account with a different role view, acknowledge.

## Setup

1. **Supabase**: create a project at [supabase.com](https://supabase.com) (free
   tier is enough), then run `docs/supabase_schema.sql` in the SQL editor.
   Create the private storage bucket `kb_documents` (Storage API can also
   auto-create it on first upload).
2. **Server**: `cd server`, copy `.env.example` to `.env`, fill in
   `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
   `GROQ_API_KEY` (from console.groq.com). Then:
   ```
   npm install          # from repo root (workspaces)
   npm run dev -w server
   ```
3. **Web**: `cd web`, copy `.env.example` to `.env`, fill in
   `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Then:
   ```
   npm run dev -w web   # -> http://localhost:5173
   ```
4. **Demo repo**: create a fresh public GitHub repository, copy the contents of
   `demo-data/demo-repo/` into it (the `issues-and-commits/` files describe the
   issues and commits to post), then connect it in the web UI.

## Deployment

- Web -> Vercel; API -> Render; data/auth/storage -> Supabase
- Public demo accounts are seeded per the demo script; all demo data is
  synthetic (privacy rule, challenge brief §Trust Requirements).

## Security & trust notes

- Supabase RLS is enabled on every table; the API double-checks membership and
  roles server-side on every request (defence in depth).
- GitHub tokens are used at connect time only and never stored.
- AI output is treated as *claims*: every claim stores its evidence; claims
  without a verbatim source quote are stored as `unsupported`, never as facts;
  contradictory sources are flagged `conflicting` for reviewer resolution.
- Recipients only ever see approved, non-redacted, role-scoped claims; the
  acknowledgement is recorded and audited.
