import type { AnswerMap } from './utils';
import type {
  Question,
  QuestionOption,
  OptionObject,
  ScoringConfig,
  ResultConfig,
  Outcome,
} from './supabase';

// ── Option helpers ────────────────────────────────────────────────────────────

export function isOptionObject(opt: QuestionOption): opt is OptionObject {
  return typeof opt === 'object' && opt !== null;
}

export function getOptionLabel(opt: QuestionOption): string {
  return isOptionObject(opt) ? opt.label : opt;
}

export function getOptionValue(opt: QuestionOption): string {
  return isOptionObject(opt) ? opt.value : opt;
}

export function getOptionCategory(opt: QuestionOption): string | undefined {
  return isOptionObject(opt) ? opt.category : undefined;
}

export function getOptionScore(opt: QuestionOption): number {
  if (!isOptionObject(opt)) return 0;
  const n = Number(opt.score ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** Match a stored answer string against an option by label or value. */
function matchesOption(opt: QuestionOption, answer: string): boolean {
  if (isOptionObject(opt)) {
    return opt.label === answer || opt.value === answer;
  }
  return opt === answer;
}

export function findOption(opts: QuestionOption[], answer: string): QuestionOption | undefined {
  return opts.find((o) => matchesOption(o, answer));
}

type ScorableQuestion = Pick<Question, 'label' | 'variable_name' | 'options' | 'category'>;

function answerFor(answers: AnswerMap, question: ScorableQuestion): string | string[] | undefined {
  return answers[question.label] ?? (question.variable_name ? answers[question.variable_name] : undefined);
}

/** Tally how many answers fall into each category — shared by category scoring and the admin test harness. */
export function computeCategoryCounts(answers: AnswerMap, questions: ScorableQuestion[]): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const question of questions) {
    const opts = question.options as QuestionOption[] | null;
    if (!opts || opts.length === 0) continue;

    const answer = answerFor(answers, question);
    if (!answer) continue;

    const answerValues = Array.isArray(answer) ? answer : [answer];

    for (const ansVal of answerValues) {
      const matched = findOption(opts, ansVal);
      const cat = matched
        ? getOptionCategory(matched) ?? question.category
        : question.category;
      if (cat) {
        counts[cat] = (counts[cat] ?? 0) + 1;
      }
    }
  }

  return counts;
}

/** Sum of option scores for the given answers — shared by points scoring and the admin test harness. */
export function computeTotalScore(answers: AnswerMap, questions: ScorableQuestion[]): number {
  let totalScore = 0;
  for (const question of questions) {
    const opts = question.options as QuestionOption[] | null;
    if (!opts || opts.length === 0) continue;

    const answer = answerFor(answers, question);
    if (!answer) continue;

    const answerValues = Array.isArray(answer) ? answer : [answer];
    for (const ansVal of answerValues) {
      const matched = findOption(opts, ansVal);
      if (matched) totalScore += getOptionScore(matched);
    }
  }
  return totalScore;
}

// ── Outcome calculation ───────────────────────────────────────────────────────

/**
 * Full scoring breakdown. Production (/api/generate), the admin preview
 * endpoint and the Test Outcome Mapping harness all call this, so what an
 * admin sees in preview is exactly what a respondent gets.
 */
export interface ScoreBreakdown {
  type:            'category' | 'points' | null;
  categoryCounts:  Record<string, number>;
  totalScore:      number;
  winningCategory: string | null;
  /** Categories sharing the top count (length > 1 means a tie occurred). */
  tiedCategories:  string[];
  tieBrokenBy:     'category_order' | 'first_answered' | 'tie_outcome' | null;
  outcome:         Outcome | null;
  /** How the outcome was chosen. 'fallback' means the config did not cover these answers. */
  matchedBy:       'top_category' | 'score_range' | 'tie_outcome' | 'fallback' | null;
  /** Human-readable explanation when matchedBy is 'fallback' or outcome is null. */
  reason:          string | null;
}

/**
 * Calculate the best-matching outcome from quiz answers.
 * Supports two scoring modes:
 *   - category: counts how many answers belong to each category; top category wins
 *   - points:   sums numeric scores; matches the outcome whose score range contains the total
 *
 * Ties (category mode) are resolved by scoring_config.tie_breaker:
 *   - 'category_order' (default): earliest category in scoring_config.categories wins
 *   - 'first_answered': the category reached first in question order wins (pre-2026 behaviour)
 *   - 'tie_outcome':   the outcome named by scoring_config.tie_outcome_id is shown on any tie
 */
export function scoreSubmission(
  answers: AnswerMap,
  questions: ScorableQuestion[],
  scoring_config: ScoringConfig | null | undefined,
  result_config: ResultConfig | null | undefined,
): ScoreBreakdown {
  const base: ScoreBreakdown = {
    type:            null,
    categoryCounts:  {},
    totalScore:      0,
    winningCategory: null,
    tiedCategories:  [],
    tieBrokenBy:     null,
    outcome:         null,
    matchedBy:       null,
    reason:          null,
  };

  const outcomes = Array.isArray(result_config?.outcomes) ? result_config!.outcomes : [];
  if (!scoring_config || (scoring_config.type !== 'category' && scoring_config.type !== 'points')) {
    return { ...base, reason: 'scoring_config is missing or has an unknown type.' };
  }
  if (outcomes.length === 0) {
    return { ...base, type: scoring_config.type, reason: 'result_config has no outcomes.' };
  }

  if (scoring_config.type === 'category') {
    return scoreCategory(answers, questions, scoring_config, outcomes, base);
  }
  return scorePoints(answers, questions, outcomes, base);
}

function scoreCategory(
  answers: AnswerMap,
  questions: ScorableQuestion[],
  scoring_config: ScoringConfig,
  outcomes: Outcome[],
  base: ScoreBreakdown,
): ScoreBreakdown {
  const counts = computeCategoryCounts(answers, questions);
  const result: ScoreBreakdown = { ...base, type: 'category', categoryCounts: counts };

  const entries = Object.entries(counts);
  if (entries.length === 0) {
    return {
      ...result,
      outcome:   outcomes[0] ?? null,
      matchedBy: 'fallback',
      reason:    'No answers mapped to a category — showing the first outcome.',
    };
  }

  const topCount = Math.max(...entries.map(([, c]) => c));
  // Object.entries preserves insertion order = order categories were first reached in question order.
  const tied = entries.filter(([, c]) => c === topCount).map(([cat]) => cat);
  result.tiedCategories = tied;

  let winner = tied[0];
  if (tied.length > 1) {
    const mode = scoring_config.tie_breaker ?? 'category_order';
    if (mode === 'tie_outcome' && scoring_config.tie_outcome_id) {
      const tieOutcome = outcomes.find((o) => o.id === scoring_config.tie_outcome_id);
      if (tieOutcome) {
        return { ...result, winningCategory: null, tieBrokenBy: 'tie_outcome', outcome: tieOutcome, matchedBy: 'tie_outcome' };
      }
    }
    if (mode === 'first_answered') {
      result.tieBrokenBy = 'first_answered';
    } else {
      const order = categoryOrder(scoring_config, outcomes);
      const rank = (c: string) => {
        const i = order.indexOf(c);
        return i === -1 ? Number.MAX_SAFE_INTEGER : i;
      };
      winner = [...tied].sort((a, b) => rank(a) - rank(b))[0];
      result.tieBrokenBy = 'category_order';
    }
  }
  result.winningCategory = winner;

  const matched = outcomes.find((o) => o.match?.top_category === winner);
  if (matched) return { ...result, outcome: matched, matchedBy: 'top_category' };

  return {
    ...result,
    outcome:   outcomes[0] ?? null,
    matchedBy: 'fallback',
    reason:    `Winning category "${winner}" has no outcome with match.top_category = "${winner}" — showing the first outcome.`,
  };
}

function categoryOrder(scoring_config: ScoringConfig, outcomes: Outcome[]): string[] {
  if (Array.isArray(scoring_config.categories) && scoring_config.categories.length > 0) {
    return scoring_config.categories;
  }
  return outcomes.map((o) => o.match?.top_category).filter((c): c is string => !!c);
}

function scorePoints(
  answers: AnswerMap,
  questions: ScorableQuestion[],
  outcomes: Outcome[],
  base: ScoreBreakdown,
): ScoreBreakdown {
  const totalScore = computeTotalScore(answers, questions);
  const result: ScoreBreakdown = { ...base, type: 'points', totalScore };

  for (const outcome of outcomes) {
    const { score_min, score_max } = outcome.match ?? {};
    const minOk = score_min === undefined || score_min === null || totalScore >= score_min;
    const maxOk = score_max === undefined || score_max === null || totalScore <= score_max;
    if (minOk && maxOk) return { ...result, outcome, matchedBy: 'score_range' };
  }

  // Fallback: last outcome (highest-score bucket) — kept for existing tools, flagged for admins.
  return {
    ...result,
    outcome:   outcomes[outcomes.length - 1] ?? null,
    matchedBy: 'fallback',
    reason:    `Total score ${totalScore} is not inside any outcome's score range — showing the last outcome.`,
  };
}

/** Backwards-compatible wrapper — returns just the chosen outcome. */
export function calculateOutcome(
  answers: AnswerMap,
  questions: ScorableQuestion[],
  scoring_config: ScoringConfig,
  result_config: ResultConfig,
): Outcome | null {
  return scoreSubmission(answers, questions, scoring_config, result_config).outcome;
}

// ── Answer validation (public submissions) ────────────────────────────────────

const MAX_TEXT_ANSWER = 5000;
const CHOICE_TYPES = ['radio', 'dropdown', 'checkbox'];

type AnswerQuestion = Pick<Question, 'label' | 'variable_name' | 'field_type' | 'options' | 'required'>;

/**
 * Validates a public submission against the tool's questions and returns a
 * cleaned answer map keyed by question label (unknown keys are dropped).
 * Error messages are safe to show to respondents.
 */
export function validateAnswers(
  raw: unknown,
  questions: AnswerQuestion[],
): { errors: string[]; cleaned: AnswerMap } {
  const errors: string[] = [];
  const cleaned: AnswerMap = {};

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { errors: ['Answers are missing or invalid.'], cleaned };
  }
  const input = raw as Record<string, unknown>;

  for (const q of questions) {
    const value = input[q.label] ?? (q.variable_name ? input[q.variable_name] : undefined);
    const opts = (q.options as QuestionOption[] | null) ?? [];
    const isChoice = CHOICE_TYPES.includes(q.field_type) && opts.length > 0;

    const isEmpty =
      value === undefined || value === null ||
      (typeof value === 'string' && value.trim() === '') ||
      (Array.isArray(value) && value.length === 0);

    if (isEmpty) {
      if (q.required) errors.push(`Please answer: "${q.label}"`);
      continue;
    }

    if (q.field_type === 'checkbox' && isChoice) {
      const arr = Array.isArray(value) ? value : [value];
      if (!arr.every((v) => typeof v === 'string' && !!findOption(opts, v))) {
        errors.push(`Invalid choice for: "${q.label}"`);
        continue;
      }
      cleaned[q.label] = Array.from(new Set(arr as string[]));
      continue;
    }

    if (typeof value !== 'string') {
      errors.push(`Invalid answer for: "${q.label}"`);
      continue;
    }

    if (isChoice) {
      const matched = findOption(opts, value);
      if (!matched) {
        errors.push(`Invalid choice for: "${q.label}"`);
        continue;
      }
      // Always store the option label so stored answers stay human-readable.
      cleaned[q.label] = getOptionLabel(matched);
      continue;
    }

    if (q.field_type === 'number' && !Number.isFinite(Number(value))) {
      errors.push(`Please enter a number for: "${q.label}"`);
      continue;
    }

    if (value.length > MAX_TEXT_ANSWER) {
      errors.push(`Answer is too long for: "${q.label}"`);
      continue;
    }
    cleaned[q.label] = value.trim();
  }

  return { errors, cleaned };
}

// ── Output hygiene ────────────────────────────────────────────────────────────

/**
 * Replaces internal identifiers that an LLM sometimes echoes back
 * ({{placeholders}}, question variable names, category ids) with
 * their human-readable labels, so respondents never see raw keys.
 */
export function sanitizeGeneratedText(
  text: string,
  questions: Pick<Question, 'label' | 'variable_name'>[],
  outcomes: Pick<Outcome, 'id' | 'title' | 'match'>[] = [],
): string {
  if (!text) return text;
  let out = text.replace(/\s*\[variable:\s*[A-Za-z0-9_]+\]/g, '');

  const replacements: [string, string][] = [];
  for (const q of questions) {
    if (q.variable_name && q.variable_name.length >= 3) replacements.push([q.variable_name, `“${q.label}”`]);
  }
  for (const o of outcomes) {
    if (o.id && o.id.includes('_')) replacements.push([o.id, o.title]);
    const cat = o.match?.top_category;
    if (cat && cat.includes('_') && cat !== o.id) replacements.push([cat, o.title]);
  }
  // Longest first so "q1_symptom_driver_2" is not partially replaced by "q1_symptom_driver".
  replacements.sort((a, b) => b[0].length - a[0].length);

  out = out.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_m, name: string) => {
    const hit = replacements.find(([k]) => k === name);
    return hit ? hit[1] : '';
  });

  for (const [key, label] of replacements) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`(?<![A-Za-z0-9_])\`?${escaped}\`?(?![A-Za-z0-9_])`, 'g'), label);
  }

  // Safety net for identifiers we don't know about: snake_case → plain words,
  // "q3SleepQuality"-style keys → "sleep quality". URLs and emails are left alone.
  out = out.replace(/(?<![\w/@.:-])`?([a-z][a-z0-9]*(?:_[a-z0-9]+)+)`?(?![\w/@.-])/g, (_m, id: string) => id.replace(/_/g, ' '));
  out = out.replace(/(?<![\w/@.:-])`?q\d+([A-Z][A-Za-z]+)`?(?![\w/@.-])/g, (_m, rest: string) =>
    rest.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase());
  return out;
}

// ── Prompt builder for hybrid mode ───────────────────────────────────────────

/**
 * Build the AI prompt for hybrid_ai_with_outcome mode.
 * The AI personalizes the configured outcome — it must NOT invent new types.
 */
export function buildHybridPrompt(
  resultTemplate: string | null,
  outcome: Outcome,
  answers: AnswerMap,
  questions: ScorableQuestion[],
): string {
  const answerBlock = questions
    .map((q) => {
      const answer = answerFor(answers, q);
      if (!answer) return null;
      const val = Array.isArray(answer) ? answer.join(', ') : answer;
      return `Q: ${q.label}\nA: ${val}`;
    })
    .filter(Boolean)
    .join('\n\n');

  const template = resultTemplate?.trim()
    ? resultTemplate
    : `Based on their answers, write a personalized explanation of their result type. Be warm, specific, and educational.`;

  const recs = outcome.recommendations?.length
    ? `\nCONFIGURED RECOMMENDATIONS (you may expand on these, do not contradict them):\n${outcome.recommendations.map((r) => `- ${r}`).join('\n')}`
    : '';

  return `${template}

PARTICIPANT'S RESULT TYPE: ${outcome.title}
${outcome.description ? `\nOVERVIEW: ${outcome.description}` : ''}${recs}

IMPORTANT RULES:
- Personalize this result based on the participant's specific answers below.
- Use "${outcome.title}" as the result_title.
- Do NOT suggest they might be a different type.
- Do NOT invent or reference result types not listed.
- Stay focused on the "${outcome.title}" type.
- Never output internal identifiers, variable names, snake_case keys or template placeholders — refer to questions by their wording.
- Do not diagnose, prescribe, or present this as medical advice.
- Be warm, encouraging, and educational.

THEIR ANSWERS:
${answerBlock}

Write the personalized result now:`;
}
