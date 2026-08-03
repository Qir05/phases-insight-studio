-- 006_result_engine.sql
-- Adds the reusable result engine: configurable scoring, structured outcomes, and hybrid AI generation.

-- ── tools: add result engine columns ─────────────────────────────────────────
ALTER TABLE tools
  ADD COLUMN IF NOT EXISTS result_strategy text NOT NULL DEFAULT 'ai_generated',
  ADD COLUMN IF NOT EXISTS scoring_config   jsonb,
  ADD COLUMN IF NOT EXISTS result_config    jsonb,
  ADD COLUMN IF NOT EXISTS result_template  text,
  ADD COLUMN IF NOT EXISTS admin_notes      text;

-- ── questions: add scoring columns ───────────────────────────────────────────
ALTER TABLE questions
  ADD COLUMN IF NOT EXISTS scoring_key text,
  ADD COLUMN IF NOT EXISTS category    text;

-- ── submissions: store structured outcome alongside AI result ─────────────────
ALTER TABLE submissions
  ADD COLUMN IF NOT EXISTS outcome_data jsonb;
