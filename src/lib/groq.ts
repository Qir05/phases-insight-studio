import Groq from 'groq-sdk';

/**
 * Central Groq configuration. The model can be switched without a code change
 * by setting GROQ_MODEL in the environment (Vercel → Settings → Environment
 * Variables). llama-3.3-70b-versatile was withdrawn for this account (Groq
 * returns 404 model_not_found), so the default is openai/gpt-oss-120b —
 * verified via GET /openai/v1/models and a JSON-mode completion on 2026-10-15.
 */
export const GROQ_MODEL = process.env.GROQ_MODEL?.trim() || 'openai/gpt-oss-120b';

/** gpt-oss / qwen3 are reasoning models: hidden reasoning tokens count against the output budget. */
function isReasoningModel(model: string): boolean {
  return /gpt-oss|qwen3/i.test(model);
}

function completionOptions(maxTokens: number) {
  return isReasoningModel(GROQ_MODEL)
    ? {
        // Leave room for reasoning so the JSON answer is never cut off.
        max_completion_tokens: maxTokens + 4000,
        reasoning_effort: 'low' as const,
        include_reasoning: false,
      }
    : { max_completion_tokens: maxTokens };
}

/** No GROQ_API_KEY on the server. */
export class GroqConfigError extends Error {}

/** The configured model is not available to this Groq account (withdrawn / not entitled). */
export class GroqModelUnavailableError extends Error {
  constructor(model: string) {
    super(`AI model "${model}" is not available to the configured Groq account. Set GROQ_MODEL to a model listed by the Groq Models API.`);
  }
}

/** Maps SDK errors to clearer, typed errors. Always throws. */
function rethrow(err: unknown): never {
  const e = err as { status?: number; error?: { error?: { code?: string } }; code?: string };
  const code = e?.error?.error?.code ?? e?.code;
  if (e?.status === 404 || code === 'model_not_found' || code === 'model_decommissioned') {
    throw new GroqModelUnavailableError(GROQ_MODEL);
  }
  throw err;
}

/** Admin-facing message + HTTP status for an AI helper failure (Import Wizard, Migration Assistant). */
export function describeAiError(err: unknown): { message: string; status: number } {
  if (err instanceof GroqConfigError || err instanceof GroqModelUnavailableError) {
    return { message: err.message, status: 503 };
  }
  if ((err as { status?: number })?.status === 429) {
    return { message: 'The AI provider is rate-limiting requests. Wait a minute and try again.', status: 503 };
  }
  return { message: 'AI generation failed. Please try again.', status: 502 };
}

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

export function isStructuredResult(value: unknown): value is StructuredResult {
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

/**
 * Respondent-facing result generation. Throws on any provider problem —
 * there is deliberately no placeholder/mock output in any environment, so
 * fake text can never be presented as a generated result.
 */
export async function generateResult(userPrompt: string): Promise<GenerateResultOutput> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new GroqConfigError('GROQ_API_KEY is not configured on the server.');

  const client = new Groq({ apiKey, timeout: 40_000, maxRetries: 1 });

  let completion;
  try {
    completion = await client.chat.completions.create({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      ...completionOptions(2000),
      response_format: { type: 'json_object' },
    });
  } catch (err) {
    rethrow(err);
  }

  const choice = completion.choices[0];
  const text = choice?.message?.content;
  if (!text) throw new Error('Empty response from Groq');
  if (choice.finish_reason === 'length') throw new Error('Groq response was truncated (output token limit reached)');

  let parsed: StructuredResult | null = null;
  try {
    const obj = JSON.parse(text);
    if (isStructuredResult(obj)) parsed = obj;
  } catch {
    parsed = null;
  }

  return { raw: text, parsed, model: completion.model || GROQ_MODEL };
}

/**
 * JSON-mode completion used by the admin AI helpers (Import Wizard, Migration
 * Assistant). Throws GroqConfigError / GroqModelUnavailableError and passes
 * other provider errors through. `data` is null when the reply was not valid
 * (or was truncated) JSON.
 */
export async function generateJson(
  system: string,
  user: string,
  maxTokens: number,
): Promise<{ data: Record<string, unknown> | null; raw: string }> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new GroqConfigError('GROQ_API_KEY is not configured on the server.');

  const client = new Groq({ apiKey, timeout: 55_000, maxRetries: 1 });
  let completion;
  try {
    completion = await client.chat.completions.create({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      ...completionOptions(maxTokens),
      temperature: 0.2,
      response_format: { type: 'json_object' },
    });
  } catch (err) {
    rethrow(err);
  }
  const choice = completion.choices[0];
  const raw = choice?.message?.content ?? '';
  if (choice?.finish_reason === 'length') return { data: null, raw };
  const cleaned = raw.trim().replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/\s*```$/, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    return { data: parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null, raw };
  } catch {
    return { data: null, raw };
  }
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

// Hybrid mode: the page already shows the outcome title, description,
// recommendations and the standard disclaimer, so the personalised section
// only carries the parts that are specific to this respondent.
export function hybridResultToMarkdown(result: StructuredResult): string {
  const patterns = result.key_patterns_from_answers.map((p) => `- ${p}`).join('\n');
  const steps = result.recommended_next_steps.map((s, i) => `${i + 1}. ${s}`).join('\n');
  return [
    result.short_summary,
    result.why_this_result ? `### Why This Fits You\n${result.why_this_result}` : '',
    patterns ? `### What Stood Out In Your Answers\n${patterns}` : '',
    steps ? `### Practical Next Steps\n${steps}` : '',
    result.cta ? `\n${result.cta}` : '',
  ].filter(Boolean).join('\n\n');
}
