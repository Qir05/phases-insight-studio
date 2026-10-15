-- ============================================================
-- READ-ONLY verification of the Bendy Menopause Type Quiz
-- ============================================================
-- Every statement is a SELECT — nothing is written. Safe to run on
-- production in the Supabase SQL Editor. Paste the output back to the
-- dev team / Claude to confirm the live configuration.
--
-- Tool: 35aaceb2-8232-42b3-8147-7ce8ca302b5a  (slug bendy-menopause-type-quiz)
-- ============================================================

-- 1. Tool configuration (expect: ai_result / hybrid_ai_with_outcome, 4 categories, 4 outcomes)
SELECT id, slug, tool_mode, result_strategy,
       scoring_config->>'type'                              AS scoring_type,
       jsonb_array_length(scoring_config->'categories')     AS n_categories,
       jsonb_array_length(result_config->'outcomes')        AS n_outcomes,
       (SELECT string_agg(o->>'id' || ' = ' || (o->>'title'), E'\n')
          FROM jsonb_array_elements(result_config->'outcomes') o) AS outcomes,
       left(result_template, 200)                           AS result_template_start,
       to_jsonb(t) ? 'status'                               AS has_status_column,
       to_jsonb(t)->>'status'                               AS status
FROM public.tools t
WHERE id = '35aaceb2-8232-42b3-8147-7ce8ca302b5a';

-- 2. Questions (expect: 7 rows, every option an object with a category)
SELECT order_index, variable_name, field_type, required,
       jsonb_array_length(options)                                             AS n_options,
       (SELECT count(*) FROM jsonb_array_elements(options) o
         WHERE jsonb_typeof(o) = 'object' AND o ? 'category')                  AS n_with_category,
       (SELECT string_agg((o->>'value') || '→' || coalesce(o->>'category', '∅'), ', ')
          FROM jsonb_array_elements(options) o WHERE jsonb_typeof(o) = 'object') AS mapping,
       left(label, 80)                                                          AS label
FROM public.questions
WHERE tool_id = '35aaceb2-8232-42b3-8147-7ce8ca302b5a'
ORDER BY order_index;

-- 3. Option categories that have NO matching outcome (expect: 0 rows)
SELECT DISTINCT o->>'category' AS orphan_category
FROM public.questions q, jsonb_array_elements(q.options) o
WHERE q.tool_id = '35aaceb2-8232-42b3-8147-7ce8ca302b5a'
  AND jsonb_typeof(o) = 'object'
  AND NOT EXISTS (
    SELECT 1 FROM public.tools t, jsonb_array_elements(t.result_config->'outcomes') oc
    WHERE t.id = q.tool_id AND oc->'match'->>'top_category' = o->>'category'
  );

-- 4. Submissions summary (no contact details selected)
SELECT count(*)                                                    AS submissions,
       count(*) FILTER (WHERE outcome_data IS NOT NULL)            AS with_outcome,
       count(*) FILTER (WHERE generation_status = 'failed')        AS ai_failed,
       min(created_at) AS first_at, max(created_at) AS last_at
FROM public.submissions
WHERE tool_id = '35aaceb2-8232-42b3-8147-7ce8ca302b5a';

SELECT outcome_data->>'id' AS outcome, count(*)
FROM public.submissions
WHERE tool_id = '35aaceb2-8232-42b3-8147-7ce8ca302b5a'
GROUP BY 1 ORDER BY 2 DESC;

-- 5. Saved results that show raw identifiers to respondents (expect: 0 rows going forward)
SELECT id, created_at,
       ai_result ~ '(q1SymptomDriver|q7SearchForAnswers|\{\{|musculoskeletal_hypermobility|histamine_inflammatory|dysautonomia_autonomic|complex_multisystem)' AS has_raw_identifier
FROM public.submissions
WHERE tool_id = '35aaceb2-8232-42b3-8147-7ce8ca302b5a'
  AND ai_result ~ '(q1SymptomDriver|q7SearchForAnswers|\{\{|musculoskeletal_hypermobility|histamine_inflammatory|dysautonomia_autonomic|complex_multisystem)'
ORDER BY created_at DESC
LIMIT 20;

-- 6. RLS exposure check (expect after migration 009: only "users read own profile")
SELECT tablename, policyname, roles, cmd, qual
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('tools','questions','submissions','workspaces','profiles','invitations')
ORDER BY tablename;
