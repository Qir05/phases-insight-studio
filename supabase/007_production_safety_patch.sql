-- ============================================================
-- Migration 007: Production safety patch
-- ============================================================
-- Run in the Supabase SQL Editor (Dashboard → SQL Editor)
-- Safe to run multiple times — every statement is idempotent
-- (ADD COLUMN IF NOT EXISTS / DROP NOT NULL are no-ops when
-- already applied). Consolidates 005_tool_modes.sql,
-- 005_structured_ai_results.sql and 006_result_engine.sql so a
-- fresh or partially-migrated production database ends up in a
-- known-good state in one pass.
--
-- Nothing here deletes or rewrites existing data.
-- ============================================================

-- ── tools ─────────────────────────────────────────────────────
ALTER TABLE public.tools
  ADD COLUMN IF NOT EXISTS tool_mode        text NOT NULL DEFAULT 'ai_result',
  ADD COLUMN IF NOT EXISTS webhook_url      text,
  ADD COLUMN IF NOT EXISTS redirect_url     text,
  ADD COLUMN IF NOT EXISTS result_strategy  text NOT NULL DEFAULT 'ai_generated',
  ADD COLUMN IF NOT EXISTS scoring_config   jsonb,
  ADD COLUMN IF NOT EXISTS result_config    jsonb,
  ADD COLUMN IF NOT EXISTS result_template  text,
  ADD COLUMN IF NOT EXISTS admin_notes      text;

-- system_prompt was originally `not null default ''`. The admin
-- Settings page now saves `null` for strategies that don't use it
-- (structured_outcome), so the column must accept null or those
-- saves fail with a not-null constraint violation.
ALTER TABLE public.tools
  ALTER COLUMN system_prompt DROP NOT NULL;

-- ── questions ─────────────────────────────────────────────────
ALTER TABLE public.questions
  ADD COLUMN IF NOT EXISTS scoring_key text,
  ADD COLUMN IF NOT EXISTS category    text;

-- ── submissions ───────────────────────────────────────────────
ALTER TABLE public.submissions
  ADD COLUMN IF NOT EXISTS outcome_data jsonb;

ALTER TABLE public.submissions
  ADD COLUMN IF NOT EXISTS result_json jsonb;

ALTER TABLE public.submissions
  ADD COLUMN IF NOT EXISTS model_used text;

ALTER TABLE public.submissions
  ADD COLUMN IF NOT EXISTS generation_status text;

-- Constraint added separately (and guarded) so re-running this
-- file never fails with "constraint already exists".
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'submissions_generation_status_check'
  ) THEN
    ALTER TABLE public.submissions
      ADD CONSTRAINT submissions_generation_status_check
      CHECK (generation_status IN ('success', 'failed'));
  END IF;
END $$;

ALTER TABLE public.submissions
  ADD COLUMN IF NOT EXISTS generation_error text;

-- ── reload PostgREST schema cache ────────────────────────────
-- Required after any DDL change so the Supabase API layer picks
-- up the new/altered columns immediately instead of on next restart.
select pg_notify('pgrst', 'reload schema');
