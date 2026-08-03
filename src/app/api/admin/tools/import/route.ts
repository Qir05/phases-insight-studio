import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import Groq from 'groq-sdk';

// ── Groq prompts ──────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a quiz configuration expert for a health and wellness platform called Phases Insight Studio.
Your job is to analyze source material (FormWise instructions, quiz content, transcripts, worksheets) and generate a complete, production-ready quiz configuration JSON.
You must respond with ONLY raw JSON — no markdown, no code blocks, no explanation. Just the JSON object.`;

function buildUserPrompt(sourceLabel: string, text: string): string {
  return `Analyze this ${sourceLabel} and produce a complete quiz tool configuration JSON.

EXACT OUTPUT SCHEMA (respond with this exact structure):
{
  "title": "Quiz title string",
  "description": "One sentence shown to quiz takers",
  "result_strategy": "hybrid_ai_with_outcome" | "structured_outcome" | "ai_generated",
  "system_prompt": "AI system context (for ai_generated strategy, null otherwise)" | null,
  "result_template": "Instructions for AI personalisation (for hybrid strategy, null otherwise)" | null,
  "scoring_config": {
    "type": "category",
    "categories": ["outcome_id_1", "outcome_id_2", "outcome_id_3"]
  } | null,
  "result_config": {
    "outcomes": [
      {
        "id": "snake_case_outcome_id",
        "title": "Outcome display title",
        "description": "2-3 sentence outcome description paragraph",
        "match": { "top_category": "snake_case_outcome_id" },
        "recommendations": ["Recommendation 1", "Recommendation 2", "Recommendation 3"],
        "cta_text": "Call to action button label",
        "cta_url": ""
      }
    ]
  } | null,
  "questions": [
    {
      "label": "Full question text exactly as it should appear",
      "variable_name": "snake_case_name",
      "field_type": "radio" | "checkbox" | "text" | "textarea" | "dropdown" | "number",
      "options": [
        { "label": "Full option text", "value": "A", "score": 1, "category": "outcome_id" }
      ] | null,
      "required": true,
      "scoring_key": null,
      "category": null
    }
  ]
}

STRATEGY SELECTION RULES:
- Use "hybrid_ai_with_outcome": source has distinct personality/result types AND rich contextual descriptions — BEST for FormWise-style quizzes with types (e.g. Menopause Type Quiz)
- Use "structured_outcome": source has clear result types but minimal narrative — good for scored assessments
- Use "ai_generated": no distinct categories, open-ended wellness questionnaire

SCORING RULES (for hybrid or structured):
- Each option MUST have a "category" that EXACTLY matches one of the outcome "id" values
- Option "value" should be "A", "B", "C", "D" etc. for radio options
- "id" and "categories" array entries must be snake_case (e.g. "hormone_support", "nervous_system")
- scoring_config categories array must list the same IDs as the outcome ids

FIELD RULES:
- variable_name must be snake_case of the question topic (e.g. "primary_symptom", "energy_level")
- Generate 3-5 recommendations per outcome
- Leave cta_url as empty string (admin fills in later)
- result_template (hybrid): write personalisation instructions for the AI, e.g. "Write a warm 2-3 paragraph personalised result for this person based on their specific answers. Focus on their determined type without suggesting other types."
- Include ALL questions found in the source material
- For questions without options (text/textarea): set options to null

SOURCE MATERIAL (${sourceLabel}):
${text}

Remember: respond with ONLY the JSON object. No markdown. No explanation. No code blocks.`;
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

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

  if (!text?.trim()) {
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
        { role: 'user',   content: buildUserPrompt(source_label ?? 'source material', text) },
      ],
      max_tokens:  4096,
      temperature: 0.2, // Low temperature for precise JSON
    });
    rawResponse = completion.choices[0]?.message?.content ?? '';
  } catch (err) {
    console.error('[import] Groq error:', err);
    return NextResponse.json({ error: 'AI generation failed. Please try again.' }, { status: 500 });
  }

  // Strip markdown fences if Groq wraps in them despite instructions
  const cleaned = rawResponse
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/, '')
    .replace(/\s*```$/, '')
    .trim();

  let config: Record<string, unknown>;
  try {
    config = JSON.parse(cleaned);
  } catch {
    console.error('[import] JSON parse failed. Raw:', rawResponse.slice(0, 1000));
    return NextResponse.json(
      {
        error:       'AI returned malformed JSON. Try simplifying your source content or try again.',
        raw_preview: rawResponse.slice(0, 300),
      },
      { status: 422 }
    );
  }

  // Validate required fields
  const errors: string[] = [];
  if (!config.title || typeof config.title !== 'string') {
    errors.push('Missing title');
  }
  if (!Array.isArray(config.questions) || (config.questions as unknown[]).length === 0) {
    errors.push('No questions generated');
  }

  const strategy = config.result_strategy as string;
  if (!['ai_generated', 'structured_outcome', 'hybrid_ai_with_outcome'].includes(strategy)) {
    config.result_strategy = 'ai_generated';
  }

  if (errors.length > 0) {
    return NextResponse.json(
      { error: `Draft has issues: ${errors.join(', ')}. Try providing more detailed source content.`, config },
      { status: 422 }
    );
  }

  return NextResponse.json({ config });
}
