import type { QuestionOption, ResultStrategy, ScoringConfig, ResultConfig } from './supabase';
import { slugify } from './utils';
import { validateResultConfig } from './resultConfigValidation';

/**
 * Shared normaliser/validator for quiz configs coming from the Import
 * Wizard (AI draft, pasted JSON or uploaded JSON). The browser uses it for
 * live feedback; /api/admin/tools/import/commit runs it again server-side
 * before anything is written.
 */

export const FIELD_TYPES = ['text', 'textarea', 'radio', 'checkbox', 'dropdown', 'number'] as const;
export const CHOICE_TYPES = ['radio', 'checkbox', 'dropdown'];
const STRATEGIES: ResultStrategy[] = ['ai_generated', 'structured_outcome', 'hybrid_ai_with_outcome'];

export type ScoringProvenance = 'source' | 'inferred' | 'none';

export interface NormalizedQuestion {
  label:         string;
  variable_name: string;
  field_type:    typeof FIELD_TYPES[number];
  options:       QuestionOption[] | null;
  required:      boolean;
  scoring_key:   string | null;
  category:      string | null;
}

export interface NormalizedImportConfig {
  title:              string;
  slug:               string;
  description:        string | null;
  result_strategy:    ResultStrategy;
  system_prompt:      string | null;
  result_template:    string | null;
  scoring_config:     ScoringConfig | null;
  result_config:      ResultConfig | null;
  provider_name:      string | null;
  questions:          NormalizedQuestion[];
  scoring_provenance: ScoringProvenance;
  missing_information: string[];
}

export function toVarName(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
}

function optString(v: unknown, max = 20000): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

/** Normalises a question's options. Strings stay strings; objects keep label/value/score/category only. */
export function normalizeOptions(raw: unknown[] | null | undefined): { options: QuestionOption[] | null; errors: string[] } {
  if (raw === null || raw === undefined) return { options: null, errors: [] };
  if (!Array.isArray(raw)) return { options: null, errors: ['options must be an array'] };
  const errors: string[] = [];
  const out: QuestionOption[] = [];
  raw.forEach((o, i) => {
    if (typeof o === 'string') {
      if (o.trim()) out.push(o.trim());
      else errors.push(`Option #${i + 1} is empty`);
      return;
    }
    if (o && typeof o === 'object' && !Array.isArray(o)) {
      const obj = o as Record<string, unknown>;
      const label = optString(obj.label, 500);
      if (!label) { errors.push(`Option #${i + 1} has no label`); return; }
      const value = optString(obj.value === undefined || obj.value === null ? undefined : String(obj.value), 200) ?? label;
      const opt: QuestionOption = { label, value };
      if (obj.score !== undefined && obj.score !== null && obj.score !== '') {
        const n = Number(obj.score);
        if (!Number.isFinite(n)) { errors.push(`Option "${label}" has a non-numeric score`); return; }
        opt.score = n;
      }
      const cat = optString(obj.category, 100);
      if (cat) opt.category = cat;
      out.push(opt);
      return;
    }
    errors.push(`Option #${i + 1} must be text or an object with a label`);
  });
  return { options: out.length > 0 ? out : null, errors };
}

export function normalizeImportConfig(raw: unknown): {
  config: NormalizedImportConfig | null;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { config: null, errors: ['The config must be a JSON object.'], warnings };
  }
  const c = raw as Record<string, unknown>;

  const title = optString(c.title, 200);
  if (!title) errors.push('Missing "title".');

  const slug = slugify(optString(c.slug, 200) ?? title ?? '');
  if (title && !slug) errors.push('Slug must contain at least one letter or number.');

  let strategy = c.result_strategy as ResultStrategy;
  if (!STRATEGIES.includes(strategy)) {
    if (c.result_strategy !== undefined) warnings.push(`Unknown result_strategy "${String(c.result_strategy)}" — using "ai_generated".`);
    strategy = 'ai_generated';
  }

  const needsScoring = strategy === 'structured_outcome' || strategy === 'hybrid_ai_with_outcome';
  const scoring_config = needsScoring && c.scoring_config && typeof c.scoring_config === 'object' && !Array.isArray(c.scoring_config)
    ? (c.scoring_config as ScoringConfig) : null;
  const result_config = needsScoring && c.result_config && typeof c.result_config === 'object' && !Array.isArray(c.result_config)
    ? (c.result_config as ResultConfig) : null;

  // ── Questions ───────────────────────────────────────────────────────────────
  const rawQuestions = Array.isArray(c.questions) ? c.questions : [];
  if (rawQuestions.length === 0) errors.push('No questions in the config.');
  if (rawQuestions.length > 200) errors.push('Too many questions (max 200).');

  const usedVars = new Set<string>();
  const questions: NormalizedQuestion[] = [];
  rawQuestions.slice(0, 200).forEach((rq, i) => {
    if (!rq || typeof rq !== 'object') { errors.push(`Question #${i + 1} is not an object.`); return; }
    const q = rq as Record<string, unknown>;
    const label = optString(q.label, 1000);
    if (!label) { errors.push(`Question #${i + 1} has no "label" (question text).`); return; }

    const { options, errors: optErrors } = normalizeOptions(q.options as unknown[] | null);
    optErrors.forEach((e) => errors.push(`Question #${i + 1}: ${e}.`));

    let field_type = q.field_type as NormalizedQuestion['field_type'];
    if (!FIELD_TYPES.includes(field_type)) {
      const inferred = options && options.length > 0 ? 'radio' : 'text';
      if (q.field_type !== undefined) warnings.push(`Question #${i + 1}: unknown field_type "${String(q.field_type)}" — using "${inferred}".`);
      field_type = inferred;
    }
    if (CHOICE_TYPES.includes(field_type) && (!options || options.length === 0)) {
      errors.push(`Question #${i + 1} ("${label.slice(0, 50)}") is a choice question but has no options.`);
    }

    let variable_name = optString(q.variable_name, 60)?.replace(/[^\w]/g, '_') ?? toVarName(label);
    if (!variable_name) variable_name = `question_${i + 1}`;
    const base = variable_name;
    let n = 2;
    while (usedVars.has(variable_name)) variable_name = `${base}_${n++}`;
    usedVars.add(variable_name);

    questions.push({
      label,
      variable_name,
      field_type,
      options: CHOICE_TYPES.includes(field_type) ? options : null,
      required: q.required === undefined ? true : !!q.required,
      scoring_key: optString(q.scoring_key, 100),
      category: optString(q.category, 100),
    });
  });

  // ── Result configuration ────────────────────────────────────────────────────
  const system_prompt   = optString(c.system_prompt);
  const result_template = optString(c.result_template);
  if (strategy === 'ai_generated' && !system_prompt && !result_template) {
    errors.push('AI Generated tools need a "system_prompt" or "result_template".');
  }

  const rc = validateResultConfig('ai_result', strategy, scoring_config, result_config, questions);
  errors.push(...rc.errors);
  warnings.push(...rc.warnings);

  if (result_config?.outcomes?.some((o) => o?.cta_url === '' && o?.cta_text)) {
    warnings.push('Some outcomes have CTA text but an empty cta_url — fill in the booking/next-step link.');
  }

  // ── Provenance (never silently treat inferred scoring as real) ─────────────
  const provenanceRaw = c.scoring_provenance;
  const scoring_provenance: ScoringProvenance =
    provenanceRaw === 'source' || provenanceRaw === 'inferred' || provenanceRaw === 'none'
      ? provenanceRaw
      : needsScoring ? 'inferred' : 'none';
  if (needsScoring && scoring_provenance !== 'source') {
    warnings.push('Scoring rules and outcome mappings were INFERRED, not copied from the source material — verify them against the original quiz before publishing.');
  }

  const missing_information = Array.isArray(c.missing_information)
    ? (c.missing_information as unknown[]).filter((m): m is string => typeof m === 'string' && !!m.trim()).slice(0, 30)
    : [];
  missing_information.forEach((m) => warnings.push(`Missing from source: ${m}`));

  if (errors.length > 0 || !title) return { config: null, errors, warnings };

  return {
    config: {
      title,
      slug,
      description:     optString(c.description, 1000),
      result_strategy: strategy,
      system_prompt,
      result_template,
      scoring_config,
      result_config,
      provider_name:   optString(c.provider_name, 200),
      questions,
      scoring_provenance,
      missing_information,
    },
    errors,
    warnings,
  };
}
