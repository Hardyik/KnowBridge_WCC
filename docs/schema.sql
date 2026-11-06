-- KnowBridge — Round 3 schema (documents + repository connector)
-- Run this in Supabase → SQL Editor → New query → Run.
-- It recreates the KnowBridge tables; any previous KnowBridge tables are dropped.

create extension if not exists pgcrypto;

drop table if exists public.assistant_messages cascade;
drop table if exists public.delivery_acknowledgements cascade;
drop table if exists public.delivery_links cascade;
drop table if exists public.acknowledgements cascade;
drop table if exists public.handovers cascade;
drop table if exists public.audit_log cascade;
drop table if exists public.claims cascade;
drop table if exists public.source_chunks cascade;
drop table if exists public.sources cascade;
drop table if exists public.project_members cascade;
drop table if exists public.projects cascade;
drop table if exists public.profiles cascade;

-- ---------------------------------------------------------------------------
-- People and projects
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  display_name text not null default 'Member',
  created_at timestamptz not null default now()
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  owner_id uuid not null references auth.users (id) on delete cascade,
  last_extracted_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.project_members (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('manager', 'reviewer', 'recipient')),
  scope text not null default 'general'
    check (scope in ('engineer', 'manager', 'coordinator', 'general')),
  created_at timestamptz not null default now(),
  unique (project_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Sources and their chunks (the evidence anchors)
-- ---------------------------------------------------------------------------

create table public.sources (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  title text not null,
  filename text not null,
  byte_size integer not null default 0,
  status text not null default 'ready' check (status in ('ready', 'failed')),
  error text,
  -- provenance: an uploaded file or a read-only repository connection
  kind text not null default 'document' check (kind in ('document', 'github')),
  external_ref text,
  -- confidentiality tier, enforced by the API's scoping layer
  confidentiality text not null default 'internal'
    check (confidentiality in ('public', 'internal', 'restricted')),
  last_synced_at timestamptz,
  uploaded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.source_chunks (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.sources (id) on delete cascade,
  ordinal integer not null,
  heading text not null default 'Document start',
  text text not null,
  -- date the source itself states (commit or issue date), used by the timeline
  occurred_at timestamptz,
  unique (source_id, ordinal)
);

-- ---------------------------------------------------------------------------
-- Claims: extracted statements that must point at a quote in a chunk
-- ---------------------------------------------------------------------------

create table public.claims (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  source_id uuid not null references public.sources (id) on delete cascade,
  chunk_id uuid not null references public.source_chunks (id) on delete cascade,
  category text not null check (category in (
    'decision', 'completed', 'pending', 'next_action', 'owner',
    'contact', 'risk', 'blocker', 'dependency', 'setup'
  )),
  text text not null,
  original_text text not null,
  quote text,
  location text not null default 'Document start',
  reasoning text,
  owner_text text,
  status text not null default 'supported'
    check (status in ('supported', 'needs_review', 'conflicting', 'unsupported')),
  confidence numeric not null default 0.5,
  conflict_group text,
  review_state text not null default 'pending'
    check (review_state in ('pending', 'verified', 'excluded', 'redacted')),
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  occurred_at timestamptz,
  -- stable identity of the statement, so a re-extraction can carry a reviewer
  -- decision onto the regenerated claim instead of resetting it
  fingerprint text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Handover versions, acknowledgement and audit
-- ---------------------------------------------------------------------------

create table public.handovers (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  version integer not null,
  status text not null default 'draft'
    check (status in ('draft', 'approved', 'rejected', 'superseded')),
  note text,
  snapshot jsonb,
  created_by uuid references auth.users (id) on delete set null,
  approved_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (project_id, version)
);

create table public.acknowledgements (
  id uuid primary key default gen_random_uuid(),
  handover_id uuid not null references public.handovers (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  acknowledged_at timestamptz not null default now(),
  unique (handover_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Delivered handover: expiring signed links and their acknowledgements
-- ---------------------------------------------------------------------------

create table public.delivery_links (
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

create table public.delivery_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null references public.delivery_links (id) on delete cascade,
  name text not null,
  email text,
  acknowledged_at timestamptz not null default now(),
  unique (link_id)
);

-- ---------------------------------------------------------------------------
-- AI assistant conversation, kept per person and per project
-- ---------------------------------------------------------------------------

create table public.assistant_messages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  citations jsonb,
  created_at timestamptz not null default now()
);

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null,
  action text not null,
  target_type text not null,
  target_id text,
  detail jsonb,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

create index claims_project_idx on public.claims (project_id, category);
create index claims_fingerprint_idx on public.claims (project_id, fingerprint);
create index claims_occurred_idx on public.claims (project_id, occurred_at desc);
create index claims_chunk_idx on public.claims (chunk_id);
create index sources_project_idx on public.sources (project_id);
create index chunks_source_idx on public.source_chunks (source_id, ordinal);
create index members_user_idx on public.project_members (user_id);
create index delivery_links_handover_idx on public.delivery_links (handover_id);
create index delivery_links_token_idx on public.delivery_links (token);
create index assistant_messages_thread_idx
  on public.assistant_messages (project_id, user_id, created_at);
create index handovers_project_idx on public.handovers (project_id, version desc);
create index audit_project_idx on public.audit_log (project_id, created_at desc);
create index sources_external_idx on public.sources (project_id, external_ref);

-- ---------------------------------------------------------------------------
-- Access control
--
-- All application reads and writes go through the Express API using the
-- service-role key, which enforces project membership in code. RLS is enabled
-- with no anon/authenticated policies, so the browser cannot read these tables
-- directly even with a signed-in Supabase session.
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.sources enable row level security;
alter table public.source_chunks enable row level security;
alter table public.claims enable row level security;
alter table public.handovers enable row level security;
alter table public.acknowledgements enable row level security;
alter table public.audit_log enable row level security;
alter table public.delivery_links enable row level security;
alter table public.delivery_acknowledgements enable row level security;
alter table public.assistant_messages enable row level security;

-- Profiles are created by the API, but this trigger keeps direct Supabase
-- sign-ups from leaving an account without a profile row.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(
      new.raw_user_meta_data ->> 'display_name',
      split_part(coalesce(new.email, 'member'), '@', 1)
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
