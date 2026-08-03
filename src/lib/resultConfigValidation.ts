import type { ResultStrategy, ScoringConfig, ResultConfig, QuestionOption } from './supabase';
import { isOptionObject, getOptionCategory } from './scoring';

export interface ValidationIssues {
  errors: string[];
  warnings: string[];
}

interface QuestionLike {
  options: QuestionOption[] | null;
}

/**
 * Shared result-config validator used by the Import Wizard, the Settings
 * page, the Migration Assistant preview, the PUT API route, and the
 * Dashboard's config-status badges — one source of truth so all of them
 * agree on what counts as "broken" (errors, block save) vs. "worth a look"
 * (warnings, never block save).
 *
 * `questions` is optional: pass it when available (Settings/Questions page)
 * for the full check set. Omit it (Dashboard) to get only the checks that
 * don't require question data.
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

  if (!scoringConfig) {
    errors.push('scoring_config is required for this result strategy.');
  } else if (scoringConfig.type !== 'category' && scoringConfig.type !== 'points') {
    errors.push('scoring_config.type must be "category" or "points".');
  }

  if (!resultConfig || !Array.isArray(resultConfig.outcomes) || resultConfig.outcomes.length === 0) {
    errors.push('result_config.outcomes must be a non-empty array.');
  } else {
    resultConfig.outcomes.forEach((outcome, i) => {
      if (!outcome.id)    errors.push(`Outcome #${i + 1} is missing "id".`);
      if (!outcome.title) errors.push(`Outcome #${i + 1} is missing "title".`);
      if (!outcome.match || typeof outcome.match !== 'object') {
        errors.push(`Outcome #${i + 1} is missing "match".`);
      }
    });
  }

  // ── Soft warnings — informational only, never block save ──────────────────
  const categories = scoringConfig?.categories ?? [];

  if (scoringConfig?.type === 'category' && categories.length > 0 && resultConfig?.outcomes) {
    resultConfig.outcomes.forEach((outcome) => {
      const topCat = outcome.match?.top_category;
      if (topCat && !categories.includes(topCat)) {
        warnings.push(`Outcome "${outcome.title || outcome.id}" match.top_category ("${topCat}") is not listed in scoring_config.categories.`);
      }
    });
  }

  if (questions && questions.length > 0) {
    const hasPlainStringOptions = questions.some(
      (q) => Array.isArray(q.options) && q.options.some((o) => !isOptionObject(o))
    );
    if (hasPlainStringOptions) {
      warnings.push('Some questions still use plain string options without category/score metadata — scoring will skip those questions.');
    }

    if (scoringConfig?.type === 'category' && categories.length > 0) {
      const usedCategories = new Set<string>();
      questions.forEach((q) => {
        (q.options ?? []).forEach((o) => {
          const cat = getOptionCategory(o);
          if (cat) usedCategories.add(cat);
        });
      });
      const unknownCategories = Array.from(usedCategories).filter((c) => !categories.includes(c));
      if (unknownCategories.length > 0) {
        warnings.push(`Option categories not listed in scoring_config.categories: ${unknownCategories.join(', ')}.`);
      }
    }
  }

  return { errors, warnings };
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
