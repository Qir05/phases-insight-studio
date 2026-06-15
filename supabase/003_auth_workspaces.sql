-- ============================================================
-- Migration 003: Auth, Workspaces, Profiles, Invitations
-- ============================================================
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor)
-- AFTER the existing schema.sql and provider-tool-upgrade.sql
-- ============================================================

-- 1. WORKSPACES -----------------------------------------------

create table if not exists public.workspaces (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  slug            text unique not null,
  logo_url        text,
  primary_color   text,
  ghl_webhook_url text,
  ghl_tag         text,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now()
);

alter table public.workspaces enable row level security;
create policy "service role all workspaces" on public.workspaces for all using (true);


-- 2. PROFILES -------------------------------------------------
-- One row per invited admin user, linked to auth.users

create table if not exists public.profiles (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid unique not null references auth.users(id) on delete cascade,
  full_name    text,
  email        text not null,
  role         text not null check (role in ('super_admin', 'provider_admin')),
  workspace_id uuid references public.workspaces(id) on delete set null,
  is_active    boolean not null default true,
  invited_by   uuid,                       -- references profiles(id), left loose to avoid circular FK
  created_at   timestamptz not null default now()
);

alter table public.profiles enable row level security;
create policy "service role all profiles" on public.profiles for all using (true);

-- Allow each authenticated user to read their own profile row
-- (used by the browser Supabase client; API routes use service key)
create policy "users read own profile" on public.profiles
  for select using (auth.uid() = user_id);


-- 3. INVITATIONS ----------------------------------------------

create table if not exists public.invitations (
  id           uuid primary key default gen_random_uuid(),
  email        text not null,
  role         text not null default 'provider_admin' check (role in ('provider_admin')),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  token        text unique not null default encode(gen_random_bytes(32), 'hex'),
  accepted_at  timestamptz,
  expires_at   timestamptz not null default (now() + interval '7 days'),
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);

alter table public.invitations enable row level security;
create policy "service role all invitations" on public.invitations for all using (true);


-- 4. ADD workspace_id TO EXISTING TABLES ---------------------

alter table public.tools
  add column if not exists workspace_id uuid references public.workspaces(id) on delete set null;

alter table public.submissions
  add column if not exists workspace_id uuid references public.workspaces(id) on delete set null;

-- Index for workspace lookups
create index if not exists idx_tools_workspace_id        on public.tools(workspace_id);
create index if not exists idx_submissions_workspace_id  on public.submissions(workspace_id);
create index if not exists idx_profiles_user_id          on public.profiles(user_id);
create index if not exists idx_profiles_workspace_id     on public.profiles(workspace_id);
create index if not exists idx_invitations_token         on public.invitations(token);


-- ============================================================
-- SEEDING THE FIRST SUPER ADMIN (run manually after migration)
-- ============================================================
--
-- Step 1 — Create the auth user in Supabase Dashboard:
--   Authentication → Users → "Add user"
--   Enter Vanessa's email and a secure password.
--   Copy the resulting User UUID (e.g. 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx').
--
-- Step 2 — Insert the super_admin profile (paste the UUID below):
--
--   insert into public.profiles (user_id, email, role, is_active)
--   values (
--     'PASTE_USER_UUID_HERE',   -- from Auth → Users
--     'vanessa@phasesclinic.com',
--     'super_admin',
--     true
--   );
--
-- Step 3 — Confirm the user in Auth → Users if email confirmation is enabled.
--
-- That's it. Vanessa can now log in at /login and access the full admin.
-- ============================================================
