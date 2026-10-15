import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getServiceClient } from '@/lib/supabase';
import type { Question, QuestionOption, ScoringConfig, ResultConfig } from '@/lib/supabase';
import { getOptionLabel, getOptionValue, getOptionCategory, isOptionObject } from '@/lib/scoring';
import { loadToolForAdmin } from '@/lib/toolAccess';
import { generateJson, GroqConfigError } from '@/lib/groq';
import { rateLimit } from '@/lib/rateLimit';
import { validateResultConfig } from '@/lib/resultConfigValidation';

export const maxDuration = 60;

const SYSTEM_PROMPT = `You are a quiz scoring configuration assistant for a health and wellness platform called Phases Insight Studio.
You are given a quiz's EXISTING questions and answer options — you never invent, reword or drop questions or options.
Your job is to infer a DRAFT scoring_config, result_config, result_template, AND an option-to-category mapping for every existing option.
This is explicitly a draft for a human admin to review before publishing — never clinical, never a diagnosis, never presented as confirmed source material.
Respond with ONLY one JSON object — no markdown, no code fences, no explanation.`;

const CHOICE_TYPES = ['radio', 'checkbox', 'dropdown'];

function buildPrompt(toolTitle: string, questions: Question[]): string {
  const qBlock = questions
    .map((q, qi) => {
      const opts = (q.options as QuestionOption[] | null) ?? [];
      const optLines = opts
        .map((o, oi) => {
          const cat = getOptionCategory(o);
          return `  ${oi + 1}. "${getOptionLabel(o)}"${cat ? ` (existing category: ${cat})` : ''}`;
        })
        .join('\n');
      return `Q${qi + 1}: "${q.label}"\n${optLines || '  (no options — free text answer, not scored)'}`;
    })
    .join('\n\n');

  return `Quiz title: ${toolTitle}

EXISTING QUESTIONS AND OPTIONS (numbered) — use ONLY these:
${qBlock}

Produce a DRAFT as a JSON object with exactly this shape:
{
  "scoring_config": { "type": "category", "categories": ["snake_case_id", "..."] },
  "result_config": {
    "outcomes": [
      {
        "id": "snake_case_id",
        "title": "Outcome display title",
        "description": "2-3 sentence description grounded only in the option patterns given",
        "match": { "top_category": "snake_case_id" },
        "recommendations": ["Recommendation 1", "Recommendation 2", "Recommendation 3"],
        "cta_text": "",
        "cta_url": ""
      }
    ]
  },
  "result_template": "Instructions telling the AI to personalise the matched outcome using the user's actual answers. Must say: do not invent a new type, do not diagnose or prescribe, do not mention this is a draft.",
  "option_mappings": [
    { "question": 1, "categories": ["category id for option 1", "category id for option 2", "..."] }
  ]
}

Rules:
- Group the EXISTING answer options into a small number of outcome categories based only on patterns visible in their text.
- If options are lettered (A)/(B)/(C)/(D) and each letter consistently describes the same theme across questions, use one category per letter.
- option_mappings: one entry per question that has options, with exactly one category id per option, in the same order as listed. Use null for an option that should not count.
- Every outcome "id" must be snake_case, must appear in scoring_config.categories, and must equal its match.top_category.
- If options already have an "existing category", reuse those ids exactly.
- Leave cta_text and cta_url empty — the admin fills them in.
- Write cautious, non-clinical, educational descriptions and recommendations — no diagnoses or treatment claims.`;
}

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const access = await loadToolForAdmin(params.id, auth.profile);
  if ('response' in access) return access.response;
  const tool = access.tool;

  if (!rateLimit(`infer:${auth.user.id}`, 10, 60_000).ok) {
    return NextResponse.json({ error: 'Too many draft generations — wait a minute and try again.' }, { status: 429 });
  }

  const db = getServiceClient();
  const { data: questionsRaw, error: qErr } = await db
    .from('questions')
    .select('*')
    .eq('tool_id', params.id)
    .order('order_index');

  if (qErr) {
    console.error('[infer-result-config] questions', qErr);
    return NextResponse.json({ error: 'Failed to load questions' }, { status: 500 });
  }

  const questions = (questionsRaw ?? []) as Question[];
  const choiceQuestions = questions.filter((q) => CHOICE_TYPES.includes(q.field_type) && Array.isArray(q.options) && q.options.length > 0);
  if (choiceQuestions.length === 0) {
    return NextResponse.json(
      { error: 'This tool has no multiple-choice questions yet. Add questions with options first, then generate a draft result config.' },
      { status: 400 }
    );
  }

  let data: Record<string, unknown> | null;
  let raw: string;
  try {
    ({ data, raw } = await generateJson(SYSTEM_PROMPT, buildPrompt(tool.title, questions), 4000));
  } catch (err) {
    if (err instanceof GroqConfigError) return NextResponse.json({ error: err.message }, { status: 500 });
    console.error('[infer-result-config] Groq error:', err);
    return NextResponse.json({ error: 'AI generation failed. Please try again.' }, { status: 502 });
  }

  if (!data) {
    console.error('[infer-result-config] JSON parse failed. Raw:', raw.slice(0, 1000));
    return NextResponse.json(
      { error: 'AI returned malformed JSON. Please try again.', raw_preview: raw.slice(0, 300) },
      { status: 422 }
    );
  }

  // Convert the AI's index-based mapping into an id/label-based mapping the
  // admin reviews. Labels always come from the database, never from the AI.
  const aiMappings = Array.isArray(data.option_mappings) ? (data.option_mappings as { question?: number; categories?: unknown[] }[]) : [];
  const option_mappings = questions
    .map((q, qi) => {
      const opts = (q.options as QuestionOption[] | null) ?? [];
      if (!CHOICE_TYPES.includes(q.field_type) || opts.length === 0) return null;
      const ai = aiMappings.find((m) => Number(m?.question) === qi + 1);
      return {
        question_id: q.id,
        question_label: q.label,
        options: opts.map((o, oi) => {
          const proposed = ai?.categories?.[oi];
          return {
            label: getOptionLabel(o),
            value: isOptionObject(o) ? getOptionValue(o) : (getOptionLabel(o).match(/^\(([A-Z])\)/)?.[1] ?? getOptionLabel(o)),
            category: getOptionCategory(o) ?? (typeof proposed === 'string' && proposed.trim() ? proposed.trim() : null),
          };
        }),
      };
    })
    .filter(Boolean);

  const draft = {
    result_strategy: 'hybrid_ai_with_outcome' as const,
    scoring_config:  (data.scoring_config ?? null) as ScoringConfig | null,
    result_config:   (data.result_config ?? null) as ResultConfig | null,
    result_template: typeof data.result_template === 'string' ? data.result_template : null,
    option_mappings,
  };

  const merged = questions.map((q) => {
    const m = option_mappings.find((x) => x!.question_id === q.id);
    return m ? { ...q, options: m.options.map((o) => ({ label: o.label, value: o.value, ...(o.category ? { category: o.category } : {}) })) } : q;
  });
  const validation = validateResultConfig('ai_result', draft.result_strategy, draft.scoring_config, draft.result_config, merged);

  // Never saved here — the admin reviews/edits and saves via apply-result-config.
  return NextResponse.json({ draft, validation });
}
