-- ============================================================
-- KnowBridge — Supabase schema (docs/supabase_schema.sql)
-- Run this in Supabase SQL Editor (or supabase db push).
-- RLS is enabled everywhere; the API additionally enforces
-- permissions server-side (defence in depth, doc §3.5).
-- ============================================================

create extension if not exists "pgcrypto";

-- ------------------------------------------------------------
-- Profiles (one row per Supabase auth user)
-- ------------------------------------------------------------
create table if not exists profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  display_name text not null default '',
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------
-- Projects & members
-- ------------------------------------------------------------
create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  owner_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists project_members (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('manager', 'reviewer', 'recipient')),
  created_at timestamptz not null default now(),
  unique (project_id, user_id)
);

create index if not exists project_members_user_idx on project_members (user_id);
create index if not exists project_members_project_idx on project_members (project_id);

-- ------------------------------------------------------------
-- Sources
-- ------------------------------------------------------------
create table if not exists sources (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  type text not null check (type in ('document', 'github')),
  title text not null,
  status text not null default 'ready' check (status in ('processing', 'ready', 'failed')),
  created_by uuid not null references auth.users (id),
  external_ref text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- One retrievable unit: page, section, issue, commit...
create table if not exists source_pieces (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references sources (id) on delete cascade,
  idx int not null,
  label text not null,
  location text not null,
  text text not null,
  url text,
  unique (source_id, idx)
);

create index if not exists source_pieces_source_idx on source_pieces (source_id);

-- ------------------------------------------------------------
-- Claims & evidence
-- ------------------------------------------------------------
create table if not exists claims (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  category text not null check (category in ('decision','task','risk','dependency','owner','setup','contact','other')),
  text text not null,
  reasoning text,
  owner_text text,
  status text not null default 'supported' check (status in ('supported','needs_review','conflicting','unsupported')),
  confidence numeric(4,3) not null default 0.5,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists claims_project_idx on claims (project_id);
create index if not exists claims_category_idx on claims (category);

create table if not exists claim_evidence (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references claims (id) on delete cascade,
  source_id uuid not null references sources (id) on delete cascade,
  piece_id uuid references source_pieces (id) on delete set null,
  label text not null,
  location text not null,
  url text,
  quote text,
  created_at timestamptz not null default now()
);

create index if not exists claim_evidence_claim_idx on claim_evidence (claim_id);

-- ------------------------------------------------------------
-- Handovers (versioned) & acknowledgements
-- ------------------------------------------------------------
create table if not exists handovers (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  version int not null,
  status text not null default 'draft' check (status in ('draft','approved','rejected')),
  claim_reviews jsonb not null default '[]'::jsonb,
  reviewer_note text,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid references auth.users (id),
  unique (project_id, version)
);

create table if not exists acknowledgements (
  id uuid primary key default gen_random_uuid(),
  handover_id uuid not null references handovers (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  acknowledged_at timestamptz not null default now(),
  unique (handover_id, user_id)
);

-- ------------------------------------------------------------
-- Audit log
-- ------------------------------------------------------------
create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  actor_id uuid not null references auth.users (id),
  actor_email text,
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_log_project_idx on audit_log (project_id, created_at desc);

-- ============================================================
-- Row-Level Security
-- ============================================================
alter table profiles enable row level security;
alter table projects enable row level security;
alter table project_members enable row level security;
alter table sources enable row level security;
alter table source_pieces enable row level security;
alter table claims enable row level security;
alter table claim_evidence enable row level security;
alter table handovers enable row level security;
alter table acknowledgements enable row level security;
alter table audit_log enable row level security;

-- Everyone reads their own profile; profiles are readable by project members only.
drop policy if exists "profiles_self_select" on profiles;
create policy "profiles_self_select" on profiles
  for select using (id = auth.uid());

drop policy if exists "profiles_self_update" on profiles;
create policy "profiles_self_update" on profiles
  for update using (id = auth.uid());

-- Projects: visible to members (read), creatable by any authenticated user.
drop policy if exists "projects_read_members" on projects;
create policy "projects_read_members" on projects
  for select using (
    exists (select 1 from project_members m where m.project_id = id and m.user_id = auth.uid())
  );
drop policy if exists "projects_insert_owner" on projects;
create policy "projects_insert_owner" on projects
  for insert with check (owner_id = auth.uid());

-- Members: everyone in a project can see its members.
drop policy if exists "members_read" on project_members;
create policy "members_read" on project_members
  for select using (
    exists (select 1 from project_members m where m.project_id = project_id and m.user_id = auth.uid())
  );

-- Generic membership helper. Data tables (sources, pieces, claims, evidence,
-- handovers, acks, audit) are mainly written by the API through the
-- service-role connection (which bypasses RLS); these policies provide the
-- client-side backstop: project members can read everything in their project.
drop policy if exists "sources_member_read" on sources;
create policy "sources_member_read" on sources for select using (
  exists (select 1 from project_members m where m.project_id = project_id and m.user_id = auth.uid())
);
drop policy if exists "sources_member_write" on sources;
create policy "sources_member_write" on sources for insert with check (
  exists (select 1 from project_members m where m.project_id = project_id
          and m.user_id = auth.uid() and m.role in ('manager','reviewer'))
);

drop policy if exists "pieces_member_read" on source_pieces;
create policy "pieces_member_read" on source_pieces for select using (
  exists (select 1 from project_members m join sources s on s.id = source_id
          where s.project_id = m.project_id and m.user_id = auth.uid())
);

drop policy if exists "claims_member_read" on claims;
create policy "claims_member_read" on claims for select using (
  exists (select 1 from project_members m where m.project_id = project_id and m.user_id = auth.uid())
);

drop policy if exists "evidence_member_read" on claim_evidence;
create policy "evidence_member_read" on claim_evidence for select using (
  exists (select 1 from claims c join project_members m on c.project_id = m.project_id
          where c.id = claim_id and m.user_id = auth.uid())
);

drop policy if exists "handovers_member_read" on handovers;
create policy "handovers_member_read" on handovers for select using (
  exists (select 1 from project_members m where m.project_id = project_id
          and m.user_id = auth.uid())
);
drop policy if exists "handovers_manager_write" on handovers;
create policy "handovers_manager_write" on handovers for insert with check (
  exists (select 1 from project_members m where m.project_id = project_id
          and m.user_id = auth.uid() and m.role in ('manager','reviewer'))
);

drop policy if exists "acks_member_read" on acknowledgements;
create policy "acks_member_read" on acknowledgements for select using (
  exists (select 1 from handovers h join project_members m on h.project_id = m.project_id
          where h.id = handover_id and m.user_id = auth.uid())
);
drop policy if exists "acks_recipient_write" on acknowledgements;
create policy "acks_recipient_write" on acknowledgements for insert with check (
  user_id = auth.uid()
  and exists (select 1 from project_members m join handovers h on h.project_id = m.project_id
              where h.id = handover_id and m.user_id = auth.uid())
);

drop policy if exists "audit_member_read" on audit_log;
create policy "audit_member_read" on audit_log for select using (
  exists (select 1 from project_members m where m.project_id = project_id
          and m.user_id = auth.uid() and m.role in ('manager','reviewer'))
);

-- Storage buckets are configured in Supabase dashboard:
--   bucket: "kb_documents", private. Uploads go through the API (service role).
