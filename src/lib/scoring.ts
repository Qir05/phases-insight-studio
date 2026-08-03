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
  return isOptionObject(opt) ? (opt.score ?? 0) : 0;
}

/** Match a stored answer string against an option by label or value. */
function matchesOption(opt: QuestionOption, answer: string): boolean {
  if (isOptionObject(opt)) {
    return opt.label === answer || opt.value === answer;
  }
  return opt === answer;
}

function findOption(opts: QuestionOption[], answer: string): QuestionOption | undefined {
  return opts.find((o) => matchesOption(o, answer));
}

// ── Outcome calculation ───────────────────────────────────────────────────────

/**
 * Calculate the best-matching outcome from quiz answers.
 * Supports two scoring modes:
 *   - category: counts how many answers belong to each category; top category wins
 *   - points:   sums numeric scores; matches the outcome whose score range contains the total
 */
export function calculateOutcome(
  answers: AnswerMap,
  questions: Question[],
  scoring_config: ScoringConfig,
  result_config: ResultConfig,
): Outcome | null {
  if (scoring_config.type === 'category') {
    return calculateCategoryOutcome(answers, questions, result_config);
  }
  if (scoring_config.type === 'points') {
    return calculatePointsOutcome(answers, questions, result_config);
  }
  return null;
}

function calculateCategoryOutcome(
  answers: AnswerMap,
  questions: Question[],
  result_config: ResultConfig,
): Outcome | null {
  const counts: Record<string, number> = {};

  for (const question of questions) {
    const opts = question.options as QuestionOption[] | null;
    if (!opts || opts.length === 0) continue;

    // Answers are keyed by question label or variable_name
    const answer = answers[question.label] ?? answers[question.variable_name];
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

  // Find the top category
  let topCategory: string | undefined;
  let topCount = 0;
  for (const [cat, count] of Object.entries(counts)) {
    if (count > topCount) {
      topCount = count;
      topCategory = cat;
    }
  }

  if (!topCategory) return result_config.outcomes[0] ?? null;

  // Match outcome by top_category
  for (const outcome of result_config.outcomes) {
    if (outcome.match?.top_category === topCategory) return outcome;
  }

  // Fallback: first outcome
  return result_config.outcomes[0] ?? null;
}

function calculatePointsOutcome(
  answers: AnswerMap,
  questions: Question[],
  result_config: ResultConfig,
): Outcome | null {
  let totalScore = 0;

  for (const question of questions) {
    const opts = question.options as QuestionOption[] | null;
    if (!opts || opts.length === 0) continue;

    const answer = answers[question.label] ?? answers[question.variable_name];
    if (!answer) continue;

    const answerValues = Array.isArray(answer) ? answer : [answer];
    for (const ansVal of answerValues) {
      const matched = findOption(opts, ansVal);
      if (matched) totalScore += getOptionScore(matched);
    }
  }

  // Match outcome by score range
  for (const outcome of result_config.outcomes) {
    const { score_min, score_max } = outcome.match ?? {};
    const minOk = score_min === undefined || totalScore >= score_min;
    const maxOk = score_max === undefined || totalScore <= score_max;
    if (minOk && maxOk) return outcome;
  }

  // Fallback: last outcome (highest-score bucket)
  return result_config.outcomes[result_config.outcomes.length - 1] ?? null;
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
  questions: Question[],
): string {
  const answerBlock = questions
    .map((q) => {
      const answer = answers[q.label] ?? answers[q.variable_name];
      if (!answer) return null;
      const val = Array.isArray(answer) ? answer.join(', ') : answer;
      return `Q: ${q.label}\nA: ${val}`;
    })
    .filter(Boolean)
    .join('\n\n');

  const template = resultTemplate
    ?? `Based on their answers, write a personalized explanation of their result type. Be warm, specific, and educational.`;

  return `${template}

PARTICIPANT'S RESULT TYPE: ${outcome.title}
${outcome.description ? `\nOVERVIEW: ${outcome.description}` : ''}

IMPORTANT RULES:
- Personalize this result based on the participant's specific answers below.
- Do NOT suggest they might be a different type.
- Do NOT invent or reference result types not listed.
- Stay focused on the "${outcome.title}" type.
- Be warm, encouraging, and educational.

THEIR ANSWERS:
${answerBlock}

Write the personalized result now:`;
}
