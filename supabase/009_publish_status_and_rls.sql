-- ============================================================
-- Migration 009: Draft/publish status + RLS lockdown
-- ============================================================
-- Run in the Supabase SQL Editor (Dashboard → SQL Editor)
-- Run AFTER 008_bendy_draft_result_config.sql
-- Safe to run multiple times (every statement is idempotent).
--
-- PART 1 — tools.status ('draft' | 'published')
--   Existing tools become 'published' so nothing currently live goes
--   offline. Tools created from now on start as 'draft' (set by the app)
--   and only go public after an admin clicks Publish, which runs the
--   full config validation first.
--
-- PART 2 — RLS lockdown (SECURITY — run as soon as possible)
--   schema.sql and 003_auth_workspaces.sql created policies of the form
--     create policy "service role all X" on X for all using (true);
--   with no "to service_role" clause. Postgres applies such a policy to
--   EVERY role, including `anon` — and the anon key is public (it ships
--   in the browser bundle). That means anyone could read/modify tools,
--   questions, submissions (respondent PII), workspaces, profiles and
--   invitations (→ take over an invite → admin access) straight through
--   the Supabase REST API, bypassing the app.
--
--   The app never reads tables with the anon key — every API route uses
--   the service-role key, which bypasses RLS entirely. So these policies
--   can simply be dropped: RLS stays enabled, and with no permissive
--   policy anon/authenticated get no rows. "users read own profile" is
--   kept (harmless: a signed-in user can only read their own row).
--
-- Nothing in this file deletes or rewrites data rows.
-- ============================================================

-- ── PART 1: publish status ───────────────────────────────────

ALTER TABLE public.tools
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'published';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tools_status_check') THEN
    ALTER TABLE public.tools
      ADD CONSTRAINT tools_status_check CHECK (status IN ('draft', 'published'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tools_slug_status ON public.tools(slug, status);

-- ── PART 2: RLS lockdown ─────────────────────────────────────

ALTER TABLE public.tools       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.questions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspaces  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service role all tools"       ON public.tools;
DROP POLICY IF EXISTS "service role all questions"   ON public.questions;
DROP POLICY IF EXISTS "service role all submissions" ON public.submissions;
DROP POLICY IF EXISTS "service role all workspaces"  ON public.workspaces;
DROP POLICY IF EXISTS "service role all profiles"    ON public.profiles;
DROP POLICY IF EXISTS "service role all invitations" ON public.invitations;

-- ── Verify (read-only) ───────────────────────────────────────
-- Expect: only "users read own profile" remains on these tables.
SELECT schemaname, tablename, policyname, roles, cmd, qual
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('tools','questions','submissions','workspaces','profiles','invitations')
ORDER BY tablename, policyname;

-- Expect: rowsecurity = true for all six tables.
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('tools','questions','submissions','workspaces','profiles','invitations');

SELECT status, count(*) FROM public.tools GROUP BY status;

-- ── reload PostgREST schema cache ────────────────────────────
select pg_notify('pgrst', 'reload schema');
