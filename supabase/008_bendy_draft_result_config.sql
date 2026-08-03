-- ============================================================
-- Migration 008: Bendy Menopause Type Quiz — draft result config
-- ============================================================
-- Run in the Supabase SQL Editor (Dashboard → SQL Editor)
-- Run AFTER 007_production_safety_patch.sql
--
-- Scope / caveat (see project audit for full context):
--   The 4 outcome titles, descriptions and recommendations below
--   are a FUNCTIONAL DRAFT derived only from the visible A/B/C/D
--   question options already in the database. They are NOT
--   confirmed FormWise result copy. Replace them once the real
--   FormWise result text is provided.
--
-- Targets exactly one tool: id = 35aaceb2-8232-42b3-8147-7ce8ca302b5a
-- (Bendy Menopause Type Quiz). No other rows are touched.
--
-- Idempotent: safe to re-run. The options transform below only
-- rewrites option elements that are still plain strings — once an
-- option has already been converted to an object it is left as-is.
-- ============================================================

-- ── 1. Tool: switch to hybrid_ai_with_outcome + draft scoring/result config ──

UPDATE public.tools
SET
  tool_mode        = 'ai_result',
  result_strategy  = 'hybrid_ai_with_outcome',

  scoring_config = $sc$
  {
    "type": "category",
    "categories": [
      "musculoskeletal_hypermobility",
      "histamine_inflammatory",
      "dysautonomia_autonomic",
      "complex_multisystem"
    ]
  }
  $sc$::jsonb,

  result_config = $rc$
  {
    "outcomes": [
      {
        "id": "musculoskeletal_hypermobility",
        "title": "Musculoskeletal + Hypermobility Pattern",
        "description": "User responses suggest symptoms are mainly driven by muscle tension, joint instability, overuse, trigger points, or musculoskeletal strain.",
        "match": { "top_category": "musculoskeletal_hypermobility" },
        "recommendations": [
          "Track which movements, positions, or activities worsen symptoms.",
          "Prioritize strength, stability, pacing, and recovery.",
          "Bring up joint instability, muscle tension, and pain patterns with a qualified clinician."
        ]
      },
      {
        "id": "histamine_inflammatory",
        "title": "Histamine + Inflammatory Reactivity Pattern",
        "description": "User responses suggest symptoms may cluster around flushing, itching, headaches, food sensitivity, inflammation, GI flares, or reactive-system patterns.",
        "match": { "top_category": "histamine_inflammatory" },
        "recommendations": [
          "Track foods, stressors, seasonal changes, temperature changes, and flares.",
          "Discuss reactive symptoms, headaches, GI flares, and sensitivities with a qualified clinician.",
          "Prepare a symptom timeline before the visit."
        ]
      },
      {
        "id": "dysautonomia_autonomic",
        "title": "Dysautonomia + Autonomic Regulation Pattern",
        "description": "User responses suggest symptoms may cluster around dizziness, heart-rate changes, crashing, heat intolerance, upright intolerance, hydration, or nervous-system regulation.",
        "match": { "top_category": "dysautonomia_autonomic" },
        "recommendations": [
          "Track dizziness, heart-rate changes, fatigue crashes, heat intolerance, and hydration patterns.",
          "Ask about autonomic symptoms and regulation support.",
          "Consider discussing hydration, electrolytes, compression, pacing, and movement tolerance with a qualified clinician."
        ]
      },
      {
        "id": "complex_multisystem",
        "title": "Complex Multi-System Pattern",
        "description": "User responses suggest symptoms do not fit into one simple category and may involve overlapping pain, fatigue, gut, mood, sleep, temperature, and energy patterns.",
        "match": { "top_category": "complex_multisystem" },
        "recommendations": [
          "Track symptoms by body system and trigger.",
          "Bring a concise timeline of symptoms and what has helped or worsened them.",
          "Work with a clinician comfortable with complex, overlapping menopause-related symptoms."
        ]
      }
    ]
  }
  $rc$::jsonb,

  result_template = $rt$Write a supportive, educational, FormWise-style result based on the selected outcome and the user's actual answers. Do not invent a new type. Do not diagnose or prescribe. Do not mention that this is a draft. Keep the tone warm, validating, practical, and menopause-informed. Include: a short explanation of the user's type, key patterns from their answers, practical next steps, and a reminder to consult a qualified clinician.$rt$,

  updated_at = now()
WHERE id = '35aaceb2-8232-42b3-8147-7ce8ca302b5a';

-- ── 2. Questions: convert "(A) ..." / "(B) ..." / "(C) ..." / "(D) ..." ──
--    option strings into scored option objects. Elements that are already
--    objects (re-run safety) are left untouched.

UPDATE public.questions q
SET options = (
  SELECT jsonb_agg(
    CASE
      WHEN jsonb_typeof(t.elem) = 'string' THEN
        jsonb_build_object(
          'label',    t.elem #>> '{}',
          'value',    substring(t.elem #>> '{}' from '^\(([A-D])\)'),
          'category', CASE substring(t.elem #>> '{}' from '^\(([A-D])\)')
                        WHEN 'A' THEN 'musculoskeletal_hypermobility'
                        WHEN 'B' THEN 'histamine_inflammatory'
                        WHEN 'C' THEN 'dysautonomia_autonomic'
                        WHEN 'D' THEN 'complex_multisystem'
                      END,
          'score',    1
        )
      ELSE t.elem
    END
    ORDER BY t.ord
  )
  FROM jsonb_array_elements(q.options) WITH ORDINALITY AS t(elem, ord)
)
WHERE q.tool_id = '35aaceb2-8232-42b3-8147-7ce8ca302b5a'
  AND q.options IS NOT NULL;

-- ── 3. Fix variable names on question 1 and question 7 ──
--    (identified by position via order_index, not by id, since ids
--    weren't provided — this matches how the app itself orders questions)

WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY order_index) AS rn
  FROM public.questions
  WHERE tool_id = '35aaceb2-8232-42b3-8147-7ce8ca302b5a'
)
UPDATE public.questions q
SET variable_name = 'q1SymptomDriver'
FROM ranked r
WHERE q.id = r.id AND r.rn = 1;

WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY order_index) AS rn
  FROM public.questions
  WHERE tool_id = '35aaceb2-8232-42b3-8147-7ce8ca302b5a'
)
UPDATE public.questions q
SET variable_name = 'q7SearchForAnswers'
FROM ranked r
WHERE q.id = r.id AND r.rn = 7;

-- ── 4. Verify (read-only, safe to inspect before trusting the migration) ──

SELECT id, title, slug, tool_mode, result_strategy, scoring_config, result_config, result_template
FROM public.tools
WHERE id = '35aaceb2-8232-42b3-8147-7ce8ca302b5a';

SELECT id, label, variable_name, field_type, options, scoring_key, category, order_index
FROM public.questions
WHERE tool_id = '35aaceb2-8232-42b3-8147-7ce8ca302b5a'
ORDER BY order_index;

-- ── reload PostgREST schema cache ────────────────────────────
select pg_notify('pgrst', 'reload schema');
