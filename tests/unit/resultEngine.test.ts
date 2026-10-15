import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Tool } from '@/lib/supabase';
import { bendyQuestions, bendyScoring, bendyResult, answersFromLetters, CATS } from '../fixtures/bendyLike';

const { generateResult } = vi.hoisted(() => ({ generateResult: vi.fn() }));
vi.mock('@/lib/groq', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/groq')>();
  return { ...actual, generateResult: (p: string) => generateResult(p) };
});

import { evaluateResult, MISSING_CONFIG_MESSAGE } from '@/lib/resultEngine';

const qs = bendyQuestions();
const baseTool = {
  id: 'tool-1',
  slug: 'bendy-like',
  title: 'Bendy-like',
  description: null,
  result_strategy: 'hybrid_ai_with_outcome',
  scoring_config: bendyScoring,
  result_config: bendyResult,
  result_template: 'Write a warm result.',
  system_prompt: null,
} as unknown as Tool;

const aiJson = {
  result_title: 'Something else entirely',
  short_summary: 'Your q1SymptomDriver answers point to histamine_inflammatory patterns.',
  why_this_result: 'Because of {{q7SearchForAnswers}}.',
  key_patterns_from_answers: ['Flushing after meals'],
  recommended_next_steps: ['Keep a symptom diary'],
  disclaimer: 'Educational only.',
  cta: 'Talk to your clinician.',
};

beforeEach(() => { generateResult.mockClear(); });

describe('evaluateResult — hybrid (Bendy mode)', () => {
  it('scores, then personalises with AI; output is sanitised and keeps the configured title', async () => {
    generateResult.mockResolvedValue({ raw: JSON.stringify(aiJson), parsed: { ...aiJson }, model: 'test-model' });
    const r = await evaluateResult(baseTool, qs, answersFromLetters('BBBBBBB'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.outcome?.id).toBe(CATS.B);
    expect(r.generationStatus).toBe('success');
    expect(r.resultJson?.result_title).toBe('Histamine + Inflammatory Reactivity Pattern');
    expect(r.aiResult).not.toMatch(/q1SymptomDriver|q7SearchForAnswers|histamine_inflammatory|\{\{/);
    expect(r.aiResult).toContain('Histamine + Inflammatory Reactivity Pattern');
    // the prompt sent to the model names the outcome and never includes variable names
    const prompt = generateResult.mock.calls[0][0] as string;
    expect(prompt).toContain('Histamine + Inflammatory Reactivity Pattern');
    expect(prompt).not.toContain('q1SymptomDriver');
  });

  it('AI failure still returns the scored outcome (respondent is not left with an error)', async () => {
    generateResult.mockImplementation(async () => { throw new Error('Groq 503'); });
    const r = await evaluateResult(baseTool, qs, answersFromLetters('CCCCCCC'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.outcome?.id).toBe(CATS.C);
    expect(r.aiResult).toBeNull();
    expect(r.generationStatus).toBe('failed');
    expect(r.generationError).toBe('Groq 503');
  });

  it('unreadable AI output counts as a failure — respondent still gets the outcome, never raw model text', async () => {
    generateResult.mockResolvedValue({ raw: 'this is { not json', parsed: null, model: 'm' });
    const r = await evaluateResult(baseTool, qs, answersFromLetters('AAAAAAA'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.outcome?.id).toBe(CATS.A);
    expect(r.aiResult).toBeNull();
    expect(r.generationStatus).toBe('failed');
  });

  it('ai_generated keeps (sanitised) plain-text output when JSON parsing fails', async () => {
    generateResult.mockResolvedValue({ raw: 'Plain text about q1SymptomDriver', parsed: null, model: 'm' });
    const r = await evaluateResult({ ...baseTool, result_strategy: 'ai_generated', system_prompt: 'Summarise.' } as Tool, qs, answersFromLetters('AAAAAAA'));
    expect(r.ok && r.aiResult).toBe(`Plain text about “${qs[0].label}”`);
  });

  it('missing config → safe public message, details only in internalError', async () => {
    const r = await evaluateResult({ ...baseTool, scoring_config: null } as Tool, qs, answersFromLetters('AAAAAAA'));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.publicError).toBe(MISSING_CONFIG_MESSAGE);
    expect(r.publicError).not.toMatch(/scoring_config/);
    expect(r.internalError).toMatch(/scoring_config/);
    expect(generateResult).not.toHaveBeenCalled();
  });
});

describe('evaluateResult — other strategies', () => {
  it('structured_outcome never calls the AI', async () => {
    const r = await evaluateResult({ ...baseTool, result_strategy: 'structured_outcome' } as Tool, qs, answersFromLetters('DDDDDDD'));
    expect(r.ok && r.outcome?.id).toBe(CATS.D);
    expect(generateResult).not.toHaveBeenCalled();
  });

  it('ai_generated failure is reported as a failed generation', async () => {
    generateResult.mockImplementation(async () => { throw new Error('timeout'); });
    const r = await evaluateResult({ ...baseTool, result_strategy: 'ai_generated', system_prompt: 'Summarise.' } as Tool, qs, answersFromLetters('AAAAAAA'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.mode).toBe('ai_result');
    expect(r.generationStatus).toBe('failed');
  });

  it('ai_generated without prompt → config error', async () => {
    const r = await evaluateResult({ ...baseTool, result_strategy: 'ai_generated', result_template: null } as Tool, qs, {});
    expect(r.ok).toBe(false);
  });
});
