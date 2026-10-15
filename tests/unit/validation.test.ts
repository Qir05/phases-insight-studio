import { describe, it, expect } from 'vitest';
import { validateResultConfig, validateForPublish, isSafeUrl, computeConfigStatus } from '@/lib/resultConfigValidation';
import { normalizeImportConfig, normalizeOptions } from '@/lib/importConfig';
import type { ResultConfig, Question } from '@/lib/supabase';
import { bendyQuestions, bendyScoring, bendyResult, CATS } from '../fixtures/bendyLike';

const qs = bendyQuestions();

describe('validateResultConfig', () => {
  it('the Bendy-shaped config passes with questions', () => {
    const r = validateResultConfig('ai_result', 'hybrid_ai_with_outcome', bendyScoring, bendyResult, qs);
    expect(r.errors).toEqual([]);
  });

  it('flags duplicate outcome ids and missing match.top_category', () => {
    const rc: ResultConfig = { outcomes: [bendyResult.outcomes[0], { ...bendyResult.outcomes[0], match: {} }] };
    const r = validateResultConfig('ai_result', 'structured_outcome', bendyScoring, rc);
    expect(r.errors.join(' ')).toMatch(/used more than once/);
    expect(r.errors.join(' ')).toMatch(/needs match.top_category/);
  });

  it('blocks javascript: CTA links (XSS) but allows https/mailto/tel', () => {
    const rc: ResultConfig = { outcomes: [{ ...bendyResult.outcomes[0], cta_text: 'Book', cta_url: 'javascript:alert(1)' }] };
    expect(validateResultConfig('ai_result', 'structured_outcome', bendyScoring, rc).errors.join(' ')).toMatch(/invalid cta_url/);
    expect(isSafeUrl('https://example.com/book')).toBe(true);
    expect(isSafeUrl('mailto:hi@example.com')).toBe(true);
    expect(isSafeUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeUrl('data:text/html,hi')).toBe(false);
  });

  it('option categories with no outcome are an error (would silently fall back)', () => {
    const rc: ResultConfig = { outcomes: bendyResult.outcomes.filter((o) => o.id !== CATS.C) };
    const r = validateResultConfig('ai_result', 'hybrid_ai_with_outcome', bendyScoring, rc, qs);
    expect(r.errors.join(' ')).toMatch(/no matching outcome: dysautonomia_autonomic/);
  });

  it('questions with no categories at all are an error', () => {
    const plain: Question[] = qs.map((q) => ({ ...q, options: ['Yes', 'No'] }));
    const r = validateResultConfig('ai_result', 'structured_outcome', bendyScoring, bendyResult, plain);
    expect(r.errors.join(' ')).toMatch(/No question options are mapped/);
    expect(r.warnings.join(' ')).toMatch(/plain string options/);
  });

  it('unreachable outcomes are a warning', () => {
    const noD: Question[] = qs.map((q) => ({ ...q, options: (q.options as { label: string; value: string; category: string }[]).filter((o) => o.value !== 'D') }));
    const r = validateResultConfig('ai_result', 'structured_outcome', bendyScoring, bendyResult, noD);
    expect(r.warnings.join(' ')).toMatch(/can never be reached/);
  });

  it('points ranges with gaps are an error', () => {
    const pq: Question[] = [{ ...qs[0], options: [{ label: 'a', value: 'a', score: 0 }, { label: 'b', value: 'b', score: 3 }] }];
    const rc: ResultConfig = { outcomes: [{ id: 'lo', title: 'Lo', match: { score_min: 0, score_max: 1 } }] };
    const r = validateResultConfig('ai_result', 'structured_outcome', { type: 'points' }, rc, pq);
    expect(r.errors.join(' ')).toMatch(/not covered/);
  });

  it('duplicate question text and choice questions without options are errors', () => {
    const dup: Question[] = [qs[0], { ...qs[1], label: qs[0].label }, { ...qs[2], options: [] }];
    const r = validateResultConfig('ai_result', 'structured_outcome', bendyScoring, bendyResult, dup);
    expect(r.errors.join(' ')).toMatch(/used 2 times/);
    expect(r.errors.join(' ')).toMatch(/has no options/);
  });

  it('tie_outcome must point at a real outcome', () => {
    const r = validateResultConfig('ai_result', 'structured_outcome', { ...bendyScoring, tie_breaker: 'tie_outcome', tie_outcome_id: 'nope' }, bendyResult);
    expect(r.errors.join(' ')).toMatch(/tie_outcome_id/);
  });

  it('dashboard status still works without questions', () => {
    const base = { tool_mode: 'ai_result', result_template: null, system_prompt: null };
    expect(computeConfigStatus({ ...base, result_strategy: 'hybrid_ai_with_outcome', scoring_config: bendyScoring, result_config: bendyResult })).toBe('configured');
    expect(computeConfigStatus({ ...base, result_strategy: 'hybrid_ai_with_outcome', scoring_config: null, result_config: null })).toBe('missing');
    expect(computeConfigStatus({ ...base, result_strategy: 'ai_generated', scoring_config: null, result_config: null })).toBe('missing');
  });
});

describe('validateForPublish', () => {
  const tool = { title: 'T', tool_mode: 'ai_result', result_strategy: 'hybrid_ai_with_outcome' as const, scoring_config: bendyScoring, result_config: bendyResult, result_template: 'Be warm', system_prompt: null };
  it('passes for a complete tool', () => {
    expect(validateForPublish(tool, qs).errors).toEqual([]);
  });
  it('blocks a tool with no questions', () => {
    expect(validateForPublish(tool, []).errors.join(' ')).toMatch(/at least one question/);
  });
  it('blocks ai_generated without a prompt', () => {
    expect(validateForPublish({ ...tool, result_strategy: 'ai_generated', result_template: null }, qs).errors.join(' ')).toMatch(/System Prompt/);
  });
  it('blocks SmartForm tools without safe URLs', () => {
    expect(validateForPublish({ ...tool, tool_mode: 'smartform_redirect', webhook_url: 'ftp://x', redirect_url: null }, qs).errors).toHaveLength(2);
  });
});

describe('normalizeImportConfig (Import Wizard)', () => {
  const good = {
    title: 'Sleep Type Quiz',
    result_strategy: 'structured_outcome',
    scoring_provenance: 'source',
    scoring_config: { type: 'category', categories: ['owl', 'lark'] },
    result_config: { outcomes: [
      { id: 'owl', title: 'Night Owl', description: 'd', match: { top_category: 'owl' }, cta_text: 'Book', cta_url: 'https://example.com' },
      { id: 'lark', title: 'Early Lark', description: 'd', match: { top_category: 'lark' } },
    ] },
    questions: [
      { label: 'When do you feel best?', options: [{ label: 'Late', value: 'A', category: 'owl' }, { label: 'Early', value: 'B', category: 'lark' }] },
      { label: 'When do you feel best?!', variable_name: 'when_do_you_feel_best', field_type: 'radio', options: [{ label: 'Night', category: 'owl' }, { label: 'Dawn', category: 'lark' }] },
      { label: 'Anything else?', field_type: 'textarea', required: false },
    ],
  };

  it('normalises a valid config (defaults field types, dedupes variable names, slugifies)', () => {
    const { config, errors } = normalizeImportConfig(good);
    expect(errors).toEqual([]);
    expect(config!.slug).toBe('sleep-type-quiz');
    expect(config!.questions[0].field_type).toBe('radio');
    expect(config!.questions[0].variable_name).toBe('when_do_you_feel_best');
    expect(config!.questions[1].variable_name).toBe('when_do_you_feel_best_2');
    expect(config!.questions[2].options).toBeNull();
    expect(config!.questions[1].options![0]).toEqual({ label: 'Night', value: 'Night', category: 'owl' });
  });

  it('reports clear errors for missing information', () => {
    const { config, errors } = normalizeImportConfig({ questions: [{ field_type: 'radio' }, { label: 'Pick', field_type: 'radio', options: [] }] });
    expect(config).toBeNull();
    expect(errors).toEqual(expect.arrayContaining([
      'Missing "title".',
      'Question #1 has no "label" (question text).',
      expect.stringMatching(/Question #2 .* has no options/),
    ]));
  });

  it('never treats inferred scoring as confirmed', () => {
    const { warnings } = normalizeImportConfig({ ...good, scoring_provenance: undefined, missing_information: ['CTA link for Night Owl'] });
    expect(warnings.join(' ')).toMatch(/INFERRED/);
    expect(warnings).toContain('Missing from source: CTA link for Night Owl');
  });

  it('ai_generated needs a prompt', () => {
    const { errors } = normalizeImportConfig({ title: 'X', result_strategy: 'ai_generated', questions: [{ label: 'Q', field_type: 'text' }] });
    expect(errors.join(' ')).toMatch(/system_prompt/);
  });

  it('rejects non-objects and bad options', () => {
    expect(normalizeImportConfig('nope').errors[0]).toMatch(/JSON object/);
    expect(normalizeOptions([{ label: 'x', score: 'abc' }]).errors[0]).toMatch(/non-numeric/);
    expect(normalizeOptions([42]).errors[0]).toMatch(/must be text/);
  });
});
