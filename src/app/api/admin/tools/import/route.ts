import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { generateJson, GroqConfigError } from '@/lib/groq';
import { normalizeImportConfig } from '@/lib/importConfig';
import { rateLimit } from '@/lib/rateLimit';

export const maxDuration = 60;

// ── Groq prompts ──────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a quiz configuration assistant for a health and wellness platform called Phases Insight Studio.
You convert source material (FormWise quiz exports and instructions, quiz content, transcripts, worksheets) into a quiz configuration JSON.
You are a faithful transcriber, not an author: copy questions, options, result names, descriptions, recommendations and CTAs from the source.
NEVER invent scoring rules, answer-to-result mappings, result types, descriptions or CTAs that the source does not contain. When something is missing, leave it empty and list it in "missing_information".
Respond with ONLY one JSON object — no markdown, no code fences, no explanation.`;

function buildUserPrompt(sourceLabel: string, text: string): string {
  return `Analyze this ${sourceLabel} and produce a quiz tool configuration JSON.

EXACT OUTPUT SCHEMA:
{
  "title": "Quiz title string",
  "slug": "url-friendly-slug-derived-from-title",
  "description": "One sentence shown to quiz takers (from the source if present)",
  "result_strategy": "hybrid_ai_with_outcome" | "structured_outcome" | "ai_generated",
  "scoring_provenance": "source" | "inferred" | "none",
  "missing_information": ["Each piece of information the admin must supply because the source does not contain it"],
  "system_prompt": "AI instructions (ai_generated only, otherwise null)" | null,
  "result_template": "Instructions for AI personalisation (hybrid only, otherwise null)" | null,
  "scoring_config": { "type": "category", "categories": ["outcome_id_1", "outcome_id_2"] } | null,
  "result_config": {
    "outcomes": [
      {
        "id": "snake_case_outcome_id",
        "title": "Result name exactly as in the source",
        "description": "Result description copied/condensed from the source ('' if absent)",
        "match": { "top_category": "snake_case_outcome_id" },
        "recommendations": ["Recommendations from the source"],
        "cta_text": "CTA label from the source ('' if absent)",
        "cta_url": "CTA link from the source ('' if absent)"
      }
    ]
  } | null,
  "questions": [
    {
      "label": "Full question text exactly as in the source",
      "variable_name": "snake_case_name",
      "field_type": "radio" | "checkbox" | "text" | "textarea" | "dropdown" | "number",
      "options": [ { "label": "Full option text exactly as in the source", "value": "A", "score": 1, "category": "outcome_id" } ] | null,
      "required": true
    }
  ]
}

STRATEGY RULES:
- "hybrid_ai_with_outcome": the source defines distinct result types AND which answers lead to which type (FormWise-style type quizzes).
- "structured_outcome": like hybrid, but results are shown as written with no AI personalisation.
- "ai_generated": the source has no result types or no answer→result logic. Then scoring_config and result_config are null and system_prompt describes what the AI result should cover, based only on the source.

SCORING RULES — READ CAREFULLY:
- "scoring_provenance" = "source" ONLY if the source explicitly states which answer/option leads to which result (e.g. "mostly A's = Type 1", a points table, a mapping list).
- If the source lists result types but does NOT say how answers map to them, you may propose a mapping, but you MUST set "scoring_provenance" to "inferred" and add "Answer-to-result scoring rules" to "missing_information".
- Every option "category" must exactly match one outcome "id"; scoring_config.categories lists the same ids.
- Never invent result types that are not named in the source. If none are named, use "ai_generated".
- Never invent CTA URLs — use "" and list "CTA link for <result>" in "missing_information".
- Option "value": use the letter if options are lettered (A, B, C, D…), otherwise a short snake_case value.

FIELD RULES:
- Include ALL questions found in the source, in order. Keep wording exactly.
- variable_name: snake_case summary of the question topic.
- For questions without options (text/textarea/number): options = null.

SOURCE MATERIAL (${sourceLabel}):
${text}

Respond with ONLY the JSON object.`;
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  if (!rateLimit(`import:${auth.user.id}`, 10, 60_000).ok) {
    return NextResponse.json({ error: 'Too many draft generations — wait a minute and try again.' }, { status: 429 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { text, source_label } = body as {
    text?:         string;
    source_label?: string;
  };

  if (typeof text !== 'string' || !text.trim()) {
    return NextResponse.json({ error: 'Source text is required' }, { status: 400 });
  }
  if (text.trim().length < 50) {
    return NextResponse.json(
      { error: 'Source text is too short — paste more content for better results' },
      { status: 400 }
    );
  }
  if (text.length > 60000) {
    return NextResponse.json(
      { error: 'Source text is too long (max 60,000 characters). Try trimming the content.' },
      { status: 400 }
    );
  }

  const label = typeof source_label === 'string' && source_label.trim() ? source_label.trim().slice(0, 100) : 'source material';

  let data: Record<string, unknown> | null;
  let raw: string;
  try {
    ({ data, raw } = await generateJson(SYSTEM_PROMPT, buildUserPrompt(label, text), 8000));
  } catch (err) {
    if (err instanceof GroqConfigError) {
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
    console.error('[import] Groq error:', err);
    return NextResponse.json({ error: 'AI generation failed. Please try again.' }, { status: 502 });
  }

  if (!data) {
    console.error('[import] JSON parse failed. Raw:', raw.slice(0, 1000));
    return NextResponse.json(
      {
        error:       'AI returned malformed JSON. Try simplifying your source content or try again.',
        raw_preview: raw.slice(0, 300),
      },
      { status: 422 }
    );
  }

  // Never saved here. The draft goes back to the browser for review; the
  // commit endpoint re-validates it after the admin confirms.
  const { errors, warnings } = normalizeImportConfig(data);
  return NextResponse.json({ config: data, errors, warnings });
}
