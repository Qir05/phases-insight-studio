-- ============================================================
-- Migration 005: Structured AI results + generation tracking
-- ============================================================
-- Run AFTER 004_invite_updates.sql
-- Run in the Supabase SQL Editor (Dashboard → SQL Editor)
--
-- This migration is additive and backward compatible:
--   - existing "ai_result" text column is untouched
--   - new columns are nullable, so old rows remain valid
-- ============================================================

ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS result_json       jsonb;
ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS model_used        text;
ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS generation_status text
  CHECK (generation_status IN ('success', 'failed'));
ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS generation_error  text;
