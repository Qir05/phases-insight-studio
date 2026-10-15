import type { Question, Tool, ScoringConfig, ResultConfig, ResultStrategy, Outcome } from './supabase';
import type { AnswerMap } from './utils';
import { compilePrompt } from './utils';
import {
  generateResult,
  structuredResultToMarkdown,
  hybridResultToMarkdown,
  GROQ_MODEL,
  type StructuredResult,
} from './groq';
import { scoreSubmission, buildHybridPrompt, sanitizeGeneratedText, type ScoreBreakdown } from './scoring';

/**
 * The single result pipeline. /api/generate (real submissions) and the
 * admin preview endpoint both call evaluateResult(), so an admin preview
 * runs exactly the scoring and AI path a respondent would.
 */
export type EngineMode = 'structured_outcome' | 'hybrid_ai_with_outcome' | 'ai_result';

export type EngineResult =
  | {
      ok: false;
      status: number;
      /** Safe to show to the public. */
      publicError: string;
      /** For server logs and admin preview only. */
      internalError: string;
    }
  | {
      ok: true;
      mode:             EngineMode;
      breakdown:        ScoreBreakdown | null;
      outcome:          Outcome | null;
      aiResult:         string | null;
      resultJson:       StructuredResult | null;
      compiledPrompt:   string | null;
      modelUsed:        string | null;
      generationStatus: 'success' | 'failed' | null;
      generationError:  string | null;
    };

export const MISSING_CONFIG_MESSAGE = 'This tool is missing result configuration. Please contact the administrator.';

type EngineTool = Pick<Tool, 'id' | 'slug' | 'title' | 'description' | 'result_strategy' | 'scoring_config' | 'result_config' | 'result_template' | 'system_prompt'>;

export async function evaluateResult(
  tool: EngineTool,
  questions: Question[],
  answers: AnswerMap,
): Promise<EngineResult> {
  const strategy: ResultStrategy = tool.result_strategy ?? 'ai_generated';

  if (strategy === 'structured_outcome' || strategy === 'hybrid_ai_with_outcome') {
    const scoringConfig = tool.scoring_config as ScoringConfig | null;
    const resultConfig  = tool.result_config  as ResultConfig  | null;
    if (!scoringConfig || !resultConfig) {
      return {
        ok: false, status: 400, publicError: MISSING_CONFIG_MESSAGE,
        internalError: `Tool "${tool.slug}" (${tool.id}) is missing scoring_config/result_config for ${strategy}.`,
      };
    }

    const breakdown = scoreSubmission(answers, questions, scoringConfig, resultConfig);
    if (!breakdown.outcome) {
      return {
        ok: false, status: 400, publicError: MISSING_CONFIG_MESSAGE,
        internalError: `Tool "${tool.slug}" (${tool.id}) — could not match an outcome: ${breakdown.reason ?? 'unknown reason'}`,
      };
    }
    if (breakdown.matchedBy === 'fallback') {
      console.warn(`[resultEngine] Tool "${tool.slug}" (${tool.id}) used a fallback outcome: ${breakdown.reason}`);
    }

    const outcome = breakdown.outcome;
    if (strategy === 'structured_outcome') {
      return {
        ok: true, mode: 'structured_outcome', breakdown, outcome,
        aiResult: null, resultJson: null, compiledPrompt: null, modelUsed: null,
        generationStatus: null, generationError: null,
      };
    }

    // Hybrid: personalise the fixed outcome. If the AI fails the respondent
    // still gets their configured outcome — the failure is recorded, not shown.
    const prompt = buildHybridPrompt(tool.result_template, outcome, answers, questions);
    try {
      const gen = await generateResult(prompt);
      // JSON mode is enforced, so unreadable output means the call went wrong —
      // treat it as a failure rather than showing raw model text to a respondent.
      if (!gen.parsed) throw new Error('AI returned an unreadable (non-JSON) response');
      const parsed = sanitizeStructured(gen.parsed, questions, resultConfig.outcomes);
      parsed.result_title = outcome.title;
      const text = hybridResultToMarkdown(parsed);
      return {
        ok: true, mode: 'hybrid_ai_with_outcome', breakdown, outcome,
        aiResult: text, resultJson: parsed, compiledPrompt: prompt, modelUsed: gen.model,
        generationStatus: 'success', generationError: null,
      };
    } catch (err) {
      console.error('[resultEngine] Groq error (hybrid):', err);
      return {
        ok: true, mode: 'hybrid_ai_with_outcome', breakdown, outcome,
        aiResult: null, resultJson: null, compiledPrompt: prompt, modelUsed: GROQ_MODEL,
        generationStatus: 'failed', generationError: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // ── ai_generated ───────────────────────────────────────────────────────────
  const hasSystemPrompt   = typeof tool.system_prompt   === 'string' && tool.system_prompt.trim().length   > 0;
  const hasResultTemplate = typeof tool.result_template === 'string' && tool.result_template.trim().length > 0;
  if (!hasSystemPrompt && !hasResultTemplate) {
    return {
      ok: false, status: 400, publicError: MISSING_CONFIG_MESSAGE,
      internalError: `Tool "${tool.slug}" (${tool.id}) is missing system_prompt/result_template for ai_generated mode.`,
    };
  }

  const promptBase = hasResultTemplate ? (tool.result_template as string) : (tool.system_prompt as string);
  const compiledPrompt = compilePrompt(
    { title: tool.title, description: tool.description },
    promptBase,
    answers,
    questions,
  );

  try {
    const gen = await generateResult(compiledPrompt);
    const parsed = gen.parsed ? sanitizeStructured(gen.parsed, questions, []) : null;
    return {
      ok: true, mode: 'ai_result', breakdown: null, outcome: null,
      aiResult: parsed ? structuredResultToMarkdown(parsed) : sanitizeGeneratedText(gen.raw, questions),
      resultJson: parsed, compiledPrompt, modelUsed: gen.model,
      generationStatus: 'success', generationError: null,
    };
  } catch (err) {
    console.error('[resultEngine] Groq error:', err);
    return {
      ok: true, mode: 'ai_result', breakdown: null, outcome: null,
      aiResult: null, resultJson: null, compiledPrompt, modelUsed: GROQ_MODEL,
      generationStatus: 'failed', generationError: err instanceof Error ? err.message : String(err),
    };
  }
}

function sanitizeStructured(
  r: StructuredResult,
  questions: Question[],
  outcomes: Outcome[],
): StructuredResult {
  const s = (t: string) => sanitizeGeneratedText(t, questions, outcomes);
  return {
    result_title:              s(r.result_title),
    short_summary:             s(r.short_summary),
    why_this_result:           s(r.why_this_result),
    key_patterns_from_answers: r.key_patterns_from_answers.map(s),
    recommended_next_steps:    r.recommended_next_steps.map(s),
    disclaimer:                s(r.disclaimer),
    cta:                       s(r.cta),
  };
}
