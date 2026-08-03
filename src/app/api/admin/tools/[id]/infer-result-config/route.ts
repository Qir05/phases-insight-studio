import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getServiceClient } from '@/lib/supabase';
import type { Question, QuestionOption } from '@/lib/supabase';
import { getOptionLabel, getOptionValue, getOptionCategory, isOptionObject } from '@/lib/scoring';
import Groq from 'groq-sdk';

function canAccessTool(role: string, workspaceId: string | null, toolWorkspaceId: string | null): boolean {
  if (role === 'super_admin') return true;
  return !!workspaceId && workspaceId === toolWorkspaceId;
}

const SYSTEM_PROMPT = `You are a quiz scoring configuration expert for a health and wellness platform called Phases Insight Studio.
You are given a quiz's EXISTING questions and answer options — you do not invent new ones.
Your job is to infer a DRAFT scoring_config, result_config, and result_template that groups the existing options into a small number of plausible outcome types.
This is explicitly a draft for a human admin to review before publishing — never clinical, never a diagnosis, never presented as confirmed source material.
You must respond with ONLY raw JSON — no markdown, no code fences, no explanation.`;

function buildPrompt(toolTitle: string, questions: Question[]): string {
  const qBlock = questions
    .map((q) => {
      const opts = (q.options as QuestionOption[] | null) ?? [];
      const optLines = opts
        .map((o) => {
          const label = getOptionLabel(o);
          const value = getOptionValue(o);
          const cat   = getOptionCategory(o);
          return isOptionObject(o)
            ? `  - "${label}" (value: ${value}${cat ? `, existing category: ${cat}` : ''})`
            : `  - "${label}"`;
        })
        .join('\n');
      return `Question: "${q.label}" [variable: ${q.variable_name}]\n${optLines || '  (no options — free text answer)'}`;
    })
    .join('\n\n');

  return `Quiz title: ${toolTitle}

EXISTING QUESTIONS AND OPTIONS — use ONLY these, do not invent new questions or options:
${qBlock}

Produce a DRAFT result configuration as a JSON object with exactly this shape:
{
  "scoring_config": { "type": "category", "categories": ["snake_case_id", "..."] },
  "result_config": {
    "outcomes": [
      {
        "id": "snake_case_id",
        "title": "Outcome display title",
        "description": "2-3 sentence description grounded only in the option patterns given",
        "match": { "top_category": "snake_case_id" },
        "recommendations": ["Recommendation 1", "Recommendation 2", "Recommendation 3"]
      }
    ]
  },
  "result_template": "Instructions telling the AI to personalise the matched outcome using the user's actual answers. Must say: do not invent a new type, do not diagnose or prescribe, do not mention this is a draft."
}

Rules:
- Group the EXISTING answer options into outcome categories based only on patterns already visible in their text.
- Every outcome "id" must be snake_case and must appear in scoring_config.categories.
- If options already have an "existing category" noted above, reuse those categories/ids exactly instead of inventing new ones.
- Write cautious, non-clinical, educational descriptions and recommendations grounded only in the option text given — do not fabricate diagnoses or treatment claims.
- Respond with ONLY the JSON object — no markdown, no commentary.`;
}

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const db = getServiceClient();
  const { data: tool, error: toolErr } = await db
    .from('tools')
    .select('*')
    .eq('id', params.id)
    .single();

  if (toolErr || !tool) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (!canAccessTool(auth.profile.role, auth.profile.workspace_id, tool.workspace_id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data: questionsRaw, error: qErr } = await db
    .from('questions')
    .select('*')
    .eq('tool_id', params.id)
    .order('order_index');

  if (qErr) return NextResponse.json({ error: qErr.message }, { status: 500 });

  const questions = (questionsRaw ?? []) as Question[];
  if (questions.length === 0) {
    return NextResponse.json(
      { error: 'This tool has no questions yet. Add questions first, then generate a draft result config.' },
      { status: 400 }
    );
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'GROQ_API_KEY is not configured on the server.' }, { status: 500 });
  }

  const client = new Groq({ apiKey });

  let rawResponse: string;
  try {
    const completion = await client.chat.completions.create({
      model:       'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: buildPrompt(tool.title, questions) },
      ],
      max_tokens:  3000,
      temperature: 0.2,
    });
    rawResponse = completion.choices[0]?.message?.content ?? '';
  } catch (err) {
    console.error('[infer-result-config] Groq error:', err);
    return NextResponse.json({ error: 'AI generation failed. Please try again.' }, { status: 500 });
  }

  const cleaned = rawResponse
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/, '')
    .replace(/\s*```$/, '')
    .trim();

  let draft: Record<string, unknown>;
  try {
    draft = JSON.parse(cleaned);
  } catch {
    console.error('[infer-result-config] JSON parse failed. Raw:', rawResponse.slice(0, 1000));
    return NextResponse.json(
      { error: 'AI returned malformed JSON. Please try again.', raw_preview: rawResponse.slice(0, 300) },
      { status: 422 }
    );
  }

  // Never saved here — the admin reviews/edits and saves via the normal Settings form.
  return NextResponse.json({ draft });
}
