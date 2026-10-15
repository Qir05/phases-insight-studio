import type { ResultStrategy, ScoringConfig, ResultConfig, QuestionOption } from './supabase';
import { isOptionObject, getOptionCategory, getOptionLabel, getOptionScore } from './scoring';

export interface ValidationIssues {
  errors: string[];
  warnings: string[];
}

interface QuestionLike {
  options: QuestionOption[] | null;
  label?: string;
  variable_name?: string;
  field_type?: string;
  category?: string | null;
}

const FIELD_TYPES = ['text', 'textarea', 'radio', 'checkbox', 'dropdown', 'number'];
const CHOICE_TYPES = ['radio', 'checkbox', 'dropdown'];

/** Only http(s) and mailto/tel links may be used as CTA targets (blocks javascript: URLs). */
export function isSafeUrl(url: unknown): boolean {
  if (typeof url !== 'string' || !url.trim()) return false;
  try {
    const u = new URL(url.trim());
    return ['http:', 'https:', 'mailto:', 'tel:'].includes(u.protocol);
  } catch {
    return false;
  }
}

/**
 * Shared result-config validator used by the Import Wizard, the Settings
 * page, the Migration Assistant preview, the PUT API route, the publish
 * gate and the Dashboard's config-status badges — one source of truth so all
 * of them agree on what counts as "broken" (errors) vs. "worth a look"
 * (warnings, never block).
 *
 * `questions` is optional: pass it when available (Settings/Questions page,
 * import, publish) for the full check set. Omit it (Dashboard, PUT) to get
 * only the checks that don't require question data.
 */
export function validateResultConfig(
  toolMode: string | null | undefined,
  resultStrategy: ResultStrategy | null | undefined,
  scoringConfig: ScoringConfig | null | undefined,
  resultConfig: ResultConfig | null | undefined,
  questions?: QuestionLike[],
): ValidationIssues {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (toolMode === 'smartform_redirect') {
    return { errors, warnings };
  }

  const needsScoring = resultStrategy === 'structured_outcome' || resultStrategy === 'hybrid_ai_with_outcome';
  if (!needsScoring) {
    return { errors, warnings };
  }

  if (!scoringConfig || typeof scoringConfig !== 'object') {
    errors.push('scoring_config is required for this result strategy.');
  } else if (scoringConfig.type !== 'category' && scoringConfig.type !== 'points') {
    errors.push('scoring_config.type must be "category" or "points".');
  }

  const outcomes = resultConfig && Array.isArray(resultConfig.outcomes) ? resultConfig.outcomes : null;
  if (!outcomes || outcomes.length === 0) {
    errors.push('result_config.outcomes must be a non-empty array.');
  } else {
    const seenIds = new Set<string>();
    outcomes.forEach((outcome, i) => {
      const name = outcome?.title || outcome?.id || `#${i + 1}`;
      if (!outcome || typeof outcome !== 'object') {
        errors.push(`Outcome #${i + 1} is not an object.`);
        return;
      }
      if (!outcome.id)    errors.push(`Outcome #${i + 1} is missing "id".`);
      if (!outcome.title) errors.push(`Outcome #${i + 1} is missing "title".`);
      if (outcome.id) {
        if (seenIds.has(outcome.id)) errors.push(`Outcome id "${outcome.id}" is used more than once.`);
        seenIds.add(outcome.id);
      }
      if (!outcome.match || typeof outcome.match !== 'object') {
        errors.push(`Outcome #${i + 1} is missing "match".`);
      } else if (scoringConfig?.type === 'category' && !outcome.match.top_category) {
        errors.push(`Outcome "${name}" needs match.top_category for category scoring.`);
      } else if (
        scoringConfig?.type === 'points' &&
        typeof outcome.match.score_min !== 'number' &&
        typeof outcome.match.score_max !== 'number'
      ) {
        errors.push(`Outcome "${name}" needs match.score_min and/or match.score_max for points scoring.`);
      }
      if (outcome.cta_url && !isSafeUrl(outcome.cta_url)) {
        errors.push(`Outcome "${name}" has an invalid cta_url — it must start with https://, http://, mailto: or tel:.`);
      }
      if (outcome.recommendations !== undefined && !Array.isArray(outcome.recommendations)) {
        errors.push(`Outcome "${name}" recommendations must be a list of strings.`);
      }
      if (!outcome.description) warnings.push(`Outcome "${name}" has no description.`);
      if (outcome.cta_text && !outcome.cta_url) warnings.push(`Outcome "${name}" has CTA text but no CTA URL — the button will be hidden.`);
    });

    if (scoringConfig?.type === 'category') {
      const topCats = outcomes.map((o) => o?.match?.top_category).filter(Boolean) as string[];
      const dupCats = topCats.filter((c, i) => topCats.indexOf(c) !== i);
      if (dupCats.length > 0) {
        warnings.push(`More than one outcome matches category ${Array.from(new Set(dupCats)).join(', ')} — only the first will ever be shown.`);
      }
      if (scoringConfig.tie_breaker === 'tie_outcome') {
        if (!scoringConfig.tie_outcome_id || !outcomes.some((o) => o?.id === scoringConfig.tie_outcome_id)) {
          errors.push('scoring_config.tie_outcome_id must be the id of one of the outcomes when tie_breaker is "tie_outcome".');
        }
      }
    }
  }

  const categories = Array.isArray(scoringConfig?.categories) ? scoringConfig!.categories : [];
  const outcomeCats = new Set((outcomes ?? []).map((o) => o?.match?.top_category).filter(Boolean) as string[]);

  // ── Soft warnings — informational only ────────────────────────────────────
  if (scoringConfig?.type === 'category' && categories.length > 0 && outcomes) {
    outcomes.forEach((outcome) => {
      const topCat = outcome?.match?.top_category;
      if (topCat && !categories.includes(topCat)) {
        warnings.push(`Outcome "${outcome.title || outcome.id}" match.top_category ("${topCat}") is not listed in scoring_config.categories.`);
      }
    });
  }

  if (questions && questions.length > 0) {
    validateQuestionShapes(questions, errors, warnings);

    const hasPlainStringOptions = questions.some(
      (q) => Array.isArray(q.options) && q.options.some((o) => !isOptionObject(o))
    );
    if (hasPlainStringOptions) {
      warnings.push('Some questions still use plain string options without category/score metadata — scoring will skip those questions.');
    }

    if (scoringConfig?.type === 'category') {
      const usedCategories = new Set<string>();
      let scorableQuestions = 0;
      questions.forEach((q) => {
        let questionScores = false;
        (q.options ?? []).forEach((o) => {
          const cat = getOptionCategory(o) ?? q.category ?? undefined;
          if (cat) { usedCategories.add(cat); questionScores = true; }
        });
        if (questionScores) scorableQuestions++;
      });

      if (scorableQuestions === 0) {
        errors.push('No question options are mapped to a category — every respondent would get the fallback (first) outcome.');
      }

      const unmapped = Array.from(usedCategories).filter((c) => outcomes && !outcomeCats.has(c));
      if (unmapped.length > 0) {
        errors.push(`Option categories with no matching outcome: ${unmapped.join(', ')}. If one of these wins, the respondent gets the wrong (fallback) result.`);
      }

      if (categories.length > 0) {
        const unknownCategories = Array.from(usedCategories).filter((c) => !categories.includes(c));
        if (unknownCategories.length > 0) {
          warnings.push(`Option categories not listed in scoring_config.categories: ${unknownCategories.join(', ')}.`);
        }
      }

      (outcomes ?? []).forEach((o) => {
        const cat = o?.match?.top_category;
        if (cat && scorableQuestions > 0 && !usedCategories.has(cat)) {
          warnings.push(`Outcome "${o.title || o.id}" can never be reached — no option is mapped to "${cat}".`);
        }
      });
    }

    if (scoringConfig?.type === 'points' && outcomes && outcomes.length > 0) {
      checkPointsCoverage(questions, outcomes, errors, warnings);
    }
  }

  return { errors, warnings };
}

function validateQuestionShapes(questions: QuestionLike[], errors: string[], warnings: string[]) {
  const labels = new Map<string, number>();
  const vars = new Map<string, number>();

  questions.forEach((q, i) => {
    const name = q.label ? `"${truncate(q.label)}"` : `#${i + 1}`;
    if (q.label !== undefined && !q.label.trim()) errors.push(`Question #${i + 1} has no text.`);
    if (q.label) labels.set(q.label, (labels.get(q.label) ?? 0) + 1);
    if (q.variable_name) vars.set(q.variable_name, (vars.get(q.variable_name) ?? 0) + 1);

    if (q.field_type !== undefined && !FIELD_TYPES.includes(q.field_type)) {
      errors.push(`Question ${name} has an invalid field_type "${q.field_type}".`);
    }
    if (q.field_type && CHOICE_TYPES.includes(q.field_type) && (!Array.isArray(q.options) || q.options.length === 0)) {
      errors.push(`Question ${name} is a choice question but has no options.`);
    }
    if (Array.isArray(q.options)) {
      const optLabels = q.options.map((o) => getOptionLabel(o));
      if (optLabels.some((l) => typeof l !== 'string' || !l.trim())) {
        errors.push(`Question ${name} has an option with no label.`);
      }
      const dup = optLabels.filter((l, j) => optLabels.indexOf(l) !== j);
      if (dup.length > 0) errors.push(`Question ${name} has duplicate options: ${Array.from(new Set(dup)).join(', ')}.`);
    }
  });

  Array.from(labels.entries()).forEach(([label, n]) => {
    if (n > 1) errors.push(`Question text "${truncate(label)}" is used ${n} times — answers are stored by question text, so each must be unique.`);
  });
  Array.from(vars.entries()).forEach(([v, n]) => {
    if (n > 1) warnings.push(`Variable name "${v}" is used ${n} times.`);
  });
}

function checkPointsCoverage(
  questions: QuestionLike[],
  outcomes: ResultConfig['outcomes'],
  errors: string[],
  warnings: string[],
) {
  // Possible total range (radio/dropdown pick one; checkbox can pick any subset).
  let min = 0;
  let max = 0;
  for (const q of questions) {
    const scores = (q.options ?? []).map(getOptionScore);
    if (scores.length === 0) continue;
    if (q.field_type === 'checkbox') {
      min += scores.filter((s) => s < 0).reduce((a, b) => a + b, 0);
      max += scores.filter((s) => s > 0).reduce((a, b) => a + b, 0);
    } else {
      min += Math.min(...scores);
      max += Math.max(...scores);
    }
  }
  if (min === 0 && max === 0) {
    errors.push('Points scoring is selected but no option has a non-zero "score".');
    return;
  }

  // Only integer totals are checked — scores are expected to be whole numbers.
  const uncovered: number[] = [];
  for (let t = Math.floor(min); t <= Math.ceil(max) && uncovered.length < 50; t++) {
    const hits = outcomes.filter((o) => {
      const lo = o?.match?.score_min;
      const hi = o?.match?.score_max;
      return (typeof lo !== 'number' || t >= lo) && (typeof hi !== 'number' || t <= hi);
    }).length;
    if (hits === 0) uncovered.push(t);
    if (hits > 1) {
      warnings.push(`Score ${t} matches more than one outcome — the first listed wins.`);
      break;
    }
  }
  if (uncovered.length > 0) {
    errors.push(`Possible totals ${uncovered.slice(0, 10).join(', ')}${uncovered.length > 10 ? '…' : ''} are not covered by any outcome score range (possible range ${min}–${max}).`);
  }
}

function truncate(s: string, n = 60) {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

export type ConfigStatus = 'configured' | 'missing' | 'draft' | 'redirect';

interface ToolLike {
  tool_mode:        string | null;
  result_strategy:  ResultStrategy | null;
  scoring_config:   ScoringConfig | null;
  result_config:    ResultConfig  | null;
  result_template:  string | null;
  system_prompt:    string | null;
}

/** Derives the Dashboard config-status badge from a tool row alone (no question fetch required). */
export function computeConfigStatus(tool: ToolLike): ConfigStatus {
  if (tool.tool_mode === 'smartform_redirect') return 'redirect';

  const strategy = tool.result_strategy ?? 'ai_generated';

  if (strategy === 'ai_generated') {
    const hasPrompt = !!tool.system_prompt?.trim() || !!tool.result_template?.trim();
    return hasPrompt ? 'configured' : 'missing';
  }

  const { errors, warnings } = validateResultConfig(tool.tool_mode, strategy, tool.scoring_config, tool.result_config);
  if (errors.length > 0) return 'missing';
  if (warnings.length > 0) return 'draft';
  return 'configured';
}

interface PublishableTool extends ToolLike {
  title?: string | null;
  webhook_url?: string | null;
  redirect_url?: string | null;
}

/**
 * Full pre-publish check: everything validateResultConfig checks with
 * questions, plus tool-level requirements. Errors block publishing.
 */
export function validateForPublish(tool: PublishableTool, questions: QuestionLike[]): ValidationIssues {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!tool.title?.trim()) errors.push('Tool title is missing.');
  if (questions.length === 0) errors.push('Add at least one question before publishing.');

  if (tool.tool_mode === 'smartform_redirect') {
    if (!isSafeUrl(tool.webhook_url)) errors.push('SmartForm Redirect needs a valid Webhook URL.');
    if (!isSafeUrl(tool.redirect_url)) errors.push('SmartForm Redirect needs a valid Redirect URL.');
    validateQuestionShapes(questions, errors, warnings);
    return { errors, warnings };
  }

  const strategy = tool.result_strategy ?? 'ai_generated';
  if (strategy === 'ai_generated') {
    if (!tool.system_prompt?.trim() && !tool.result_template?.trim()) {
      errors.push('AI Generated strategy needs a System Prompt or Result Template.');
    }
    validateQuestionShapes(questions, errors, warnings);
    return { errors, warnings };
  }

  const r = validateResultConfig(tool.tool_mode, strategy, tool.scoring_config, tool.result_config, questions);
  errors.push(...r.errors);
  warnings.push(...r.warnings);
  if (strategy === 'hybrid_ai_with_outcome' && !tool.result_template?.trim()) {
    warnings.push('No Result Template — the AI will use a generic personalisation instruction.');
  }
  return { errors, warnings };
}
