-- KnowBridge — Round 3 migration
-- Run this in Supabase → SQL Editor → New query → Run.
-- It is additive and idempotent: existing projects, sources, claims and
-- handovers are untouched, and running it twice is safe.

-- ---------------------------------------------------------------------------
-- 1. Source provenance: files vs a connected repository, plus a
--    confidentiality tier that the scoping layer enforces.
-- ---------------------------------------------------------------------------

alter table public.sources add column if not exists kind text not null default 'document';
alter table public.sources add column if not exists external_ref text;
alter table public.sources add column if not exists confidentiality text not null default 'internal';
alter table public.sources add column if not exists last_synced_at timestamptz;

alter table public.sources drop constraint if exists sources_kind_check;
alter table public.sources
  add constraint sources_kind_check check (kind in ('document', 'github'));

alter table public.sources drop constraint if exists sources_confidentiality_check;
alter table public.sources
  add constraint sources_confidentiality_check
  check (confidentiality in ('public', 'internal', 'restricted'));

-- ---------------------------------------------------------------------------
-- 2. Timeline and re-extraction support
--    occurred_at is the date the source itself states (a commit date, an issue
--    date). fingerprint identifies the same statement across extraction runs
--    so a reviewer decision can be carried over instead of reset.
-- ---------------------------------------------------------------------------

alter table public.source_chunks add column if not exists occurred_at timestamptz;
alter table public.claims add column if not exists occurred_at timestamptz;
alter table public.claims add column if not exists fingerprint text;

create index if not exists claims_fingerprint_idx on public.claims (project_id, fingerprint);
create index if not exists claims_occurred_idx on public.claims (project_id, occurred_at desc);

-- ---------------------------------------------------------------------------
-- 3. Delivered handover: expiring signed links and their acknowledgements
-- ---------------------------------------------------------------------------

create table if not exists public.delivery_links (
  id uuid primary key default gen_random_uuid(),
  handover_id uuid not null references public.handovers (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  token text not null unique,
  scope text not null
    check (scope in ('engineer', 'manager', 'coordinator', 'general')),
  recipient_label text,
  created_by uuid references auth.users (id) on delete set null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  opened_at timestamptz,
  open_count integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.delivery_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null references public.delivery_links (id) on delete cascade,
  name text not null,
  email text,
  acknowledged_at timestamptz not null default now(),
  unique (link_id)
);

create index if not exists delivery_links_handover_idx on public.delivery_links (handover_id);
create index if not exists delivery_links_token_idx on public.delivery_links (token);

-- ---------------------------------------------------------------------------
-- 4. AI assistant conversation, kept per person and per project
-- ---------------------------------------------------------------------------

create table if not exists public.assistant_messages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  citations jsonb,
  created_at timestamptz not null default now()
);

create index if not exists assistant_messages_thread_idx
  on public.assistant_messages (project_id, user_id, created_at);

-- ---------------------------------------------------------------------------
-- 5. Access control, matching the Round 2 model: the Express API uses the
--    service-role key and enforces membership in code, so RLS stays on with no
--    public policies and the browser can never read these tables directly.
-- ---------------------------------------------------------------------------

alter table public.delivery_links enable row level security;
alter table public.delivery_acknowledgements enable row level security;
alter table public.assistant_messages enable row level security;
