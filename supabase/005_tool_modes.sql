-- Migration 005: Add tool_mode, webhook_url, redirect_url to tools
-- Supports two tool modes:
--   'ai_result'         – existing behavior: Groq generation + result page
--   'smartform_redirect' – save submission, send webhook, redirect user (no AI)

ALTER TABLE tools
  ADD COLUMN IF NOT EXISTS tool_mode    text NOT NULL DEFAULT 'ai_result',
  ADD COLUMN IF NOT EXISTS webhook_url  text,
  ADD COLUMN IF NOT EXISTS redirect_url text;

-- Configure Bendy Menopause Type Quiz as a SmartForm Redirect tool
UPDATE tools
SET
  tool_mode    = 'smartform_redirect',
  webhook_url  = 'https://hooks.zapier.com/hooks/catch/20605590/ua9vwn0/',
  redirect_url = 'https://quiz.bendymenopause.com/'
WHERE slug = 'bendy-menopause-type-quiz';
