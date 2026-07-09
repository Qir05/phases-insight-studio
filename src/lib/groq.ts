import Groq from 'groq-sdk';

export const GROQ_MODEL = 'llama-3.3-70b-versatile';

export interface StructuredResult {
  result_title: string;
  short_summary: string;
  why_this_result: string;
  key_patterns_from_answers: string[];
  recommended_next_steps: string[];
  disclaimer: string;
  cta: string;
}

export interface GenerateResultOutput {
  raw: string;
  parsed: StructuredResult | null;
  model: string;
}

const SYSTEM_PROMPT =
  'You are an expert wellness educator. Analyze the client responses provided and produce a personalized, ' +
  'specific, educational summary that clearly references their actual answers — do not write generic, ' +
  'templated advice that could apply to anyone. ' +
  'Respond ONLY with a single valid JSON object containing these exact keys: result_title (string), ' +
  'short_summary (string), why_this_result (string), key_patterns_from_answers (array of strings), ' +
  'recommended_next_steps (array of strings), disclaimer (string), cta (string). ' +
  'Do not include markdown, code fences, or any text outside the JSON object. ' +
  'Do not diagnose, prescribe, or provide clinical/medical advice — this content is educational only.';

const MOCK_RESULT: StructuredResult = {
  result_title: 'Your Personalised Insight',
  short_summary: 'Thank you for completing this assessment. Here is a summary based on your responses.',
  why_this_result:
    'This is a sample result generated in development mode because GROQ_API_KEY is not set. In production, ' +
    'this section will reference your specific answers.',
  key_patterns_from_answers: [
    'Your answers indicate areas of strength and potential growth.',
    'Consider reviewing the recommendations below carefully.',
  ],
  recommended_next_steps: [
    'Reflect on the patterns highlighted by your responses.',
    'Take one small, specific action within the next 7 days.',
    'Consult a qualified professional for personalised, clinical guidance.',
  ],
  disclaimer:
    'This is educational information and is not medical advice. Please consult a qualified clinician for personalized care.',
  cta: 'Reach out to the team to discuss your results and explore next steps tailored to your situation.',
};

function isStructuredResult(value: unknown): value is StructuredResult {
  if (!value || typeof value !== 'object') return false;
  const o = value as Record<string, unknown>;
  return (
    typeof o.result_title === 'string' &&
    typeof o.short_summary === 'string' &&
    typeof o.why_this_result === 'string' &&
    Array.isArray(o.key_patterns_from_answers) &&
    o.key_patterns_from_answers.every((v) => typeof v === 'string') &&
    Array.isArray(o.recommended_next_steps) &&
    o.recommended_next_steps.every((v) => typeof v === 'string') &&
    typeof o.disclaimer === 'string' &&
    typeof o.cta === 'string'
  );
}

export async function generateResult(userPrompt: string): Promise<GenerateResultOutput> {
  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) {
    console.warn('[groq] GROQ_API_KEY is not set — returning mock result');
    return { raw: JSON.stringify(MOCK_RESULT, null, 2), parsed: MOCK_RESULT, model: 'mock' };
  }

  const client = new Groq({ apiKey });

  const completion = await client.chat.completions.create({
    model: GROQ_MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    max_tokens: 2000,
    response_format: { type: 'json_object' },
  });

  const text = completion.choices[0]?.message?.content;
  if (!text) throw new Error('Empty response from Groq');

  let parsed: StructuredResult | null = null;
  try {
    const obj = JSON.parse(text);
    if (isStructuredResult(obj)) parsed = obj;
  } catch {
    parsed = null;
  }

  return { raw: text, parsed, model: GROQ_MODEL };
}

// Renders a StructuredResult as markdown so ai_result stays a valid, readable
// fallback for anything still expecting plain text (GHL webhook payload, old
// result_json-less rows, etc).
export function structuredResultToMarkdown(result: StructuredResult): string {
  const patterns = result.key_patterns_from_answers.map((p) => `- ${p}`).join('\n');
  const steps = result.recommended_next_steps.map((s, i) => `${i + 1}. ${s}`).join('\n');

  return `## ${result.result_title}

${result.short_summary}

### Why This Result
${result.why_this_result}

### Key Patterns From Your Answers
${patterns}

### Recommended Next Steps
${steps}

---
*${result.disclaimer}*

${result.cta}`;
}
