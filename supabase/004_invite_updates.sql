-- ============================================================
-- Migration 004: Expand invitations to support super_admin invites
-- ============================================================
-- Run AFTER 003_auth_workspaces.sql
-- Run in the Supabase SQL Editor (Dashboard → SQL Editor)
-- ============================================================

-- 1. Update the role check constraint on invitations
--    (original only allowed 'provider_admin')

DO $$
DECLARE r record;
BEGIN
  -- Drop any existing role-related check constraint on invitations
  FOR r IN (
    SELECT tc.constraint_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.check_constraints cc
      ON tc.constraint_name = cc.constraint_name
      AND tc.constraint_schema = cc.constraint_schema
    WHERE tc.table_schema = 'public'
      AND tc.table_name = 'invitations'
      AND tc.constraint_type = 'CHECK'
      AND cc.check_clause LIKE '%role%'
  ) LOOP
    EXECUTE format('ALTER TABLE public.invitations DROP CONSTRAINT %I', r.constraint_name);
  END LOOP;
END$$;

ALTER TABLE public.invitations
  ADD CONSTRAINT invitations_role_check
  CHECK (role IN ('super_admin', 'provider_admin'));

-- 2. Make workspace_id nullable for super_admin invitations

ALTER TABLE public.invitations
  ALTER COLUMN workspace_id DROP NOT NULL;

-- 3. Add optional full_name to invitations

ALTER TABLE public.invitations
  ADD COLUMN IF NOT EXISTS full_name text;

-- 4. Update the default role (was 'provider_admin', keep as-is — it stays)

-- ============================================================
-- BOOTSTRAP SUPER ADMIN — run once after migrations
-- ============================================================
--
-- This is the ONLY thing you ever need to do manually in Supabase.
-- Every admin user after this is invited from inside the app.
--
-- Step 1 — Create the auth user:
--   Supabase Dashboard → Authentication → Users → "Add user"
--   Enter Vanessa's email and a strong password.
--   Copy the User UUID shown.
--
-- Step 2 — Create her super_admin profile:
--
--   INSERT INTO public.profiles (user_id, email, role, is_active)
--   VALUES (
--     'PASTE_USER_UUID_HERE',
--     'vanessa@phasesclinic.com',
--     'super_admin',
--     true
--   );
--
-- Step 3 — Confirm the email if needed:
--   Authentication → Users → find the user → "Confirm email"
--
-- After that, Vanessa logs in at /login and can invite all other
-- super_admins and provider_admins from /admin/users/invite.
-- ============================================================
