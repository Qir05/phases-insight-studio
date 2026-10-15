import { describe, it, expect } from 'vitest';
import { scoreSubmission, calculateOutcome, validateAnswers, sanitizeGeneratedText, buildHybridPrompt } from '@/lib/scoring';
import type { Question, ScoringConfig, ResultConfig } from '@/lib/supabase';
import { bendyQuestions, bendyScoring, bendyResult, answersFromLetters, CATS } from '../fixtures/bendyLike';

const qs = bendyQuestions();

describe('category scoring — Bendy-shaped quiz', () => {
  it.each([
    ['AAAAAAA', CATS.A, 'Musculoskeletal + Hypermobility Pattern'],
    ['BBBBBBB', CATS.B, 'Histamine + Inflammatory Reactivity Pattern'],
    ['CCCCCCC', CATS.C, 'Dysautonomia + Autonomic Regulation Pattern'],
    ['DDDDDDD', CATS.D, 'Complex Multi-System Pattern'],
  ])('all %s → %s', (letters, cat, title) => {
    const r = scoreSubmission(answersFromLetters(letters), qs, bendyScoring, bendyResult);
    expect(r.winningCategory).toBe(cat);
    expect(r.outcome?.title).toBe(title);
    expect(r.matchedBy).toBe('top_category');
    expect(r.categoryCounts[cat]).toBe(7);
    expect(r.tiedCategories).toEqual([cat]);
  });

  it('mixed answers → clear majority wins', () => {
    const r = scoreSubmission(answersFromLetters('CACBCDC'), qs, bendyScoring, bendyResult);
    expect(r.categoryCounts).toEqual({ [CATS.C]: 4, [CATS.A]: 1, [CATS.B]: 1, [CATS.D]: 1 });
    expect(r.outcome?.id).toBe(CATS.C);
    expect(r.tieBrokenBy).toBeNull();
  });

  it('answers matched by option value ("B") as well as label', () => {
    const answers = Object.fromEntries(qs.map((q) => [q.label, 'B']));
    expect(scoreSubmission(answers, qs, bendyScoring, bendyResult).outcome?.id).toBe(CATS.B);
  });

  it('answers keyed by variable_name are scored too', () => {
    const answers = Object.fromEntries(qs.map((q) => [q.variable_name, 'D']));
    expect(scoreSubmission(answers, qs, bendyScoring, bendyResult).outcome?.id).toBe(CATS.D);
  });

  describe('ties', () => {
    // D answered first, then A: 3 D, 3 A, 1 B  → tie between D and A
    const tied = answersFromLetters('DDDAAAB');

    it('default: earliest category in scoring_config.categories wins (deterministic)', () => {
      const r = scoreSubmission(tied, qs, bendyScoring, bendyResult);
      expect(r.tiedCategories.sort()).toEqual([CATS.A, CATS.D].sort());
      expect(r.tieBrokenBy).toBe('category_order');
      expect(r.outcome?.id).toBe(CATS.A);
    });

    it('category order is configurable', () => {
      const r = scoreSubmission(tied, qs, { ...bendyScoring, categories: [CATS.D, CATS.C, CATS.B, CATS.A] }, bendyResult);
      expect(r.outcome?.id).toBe(CATS.D);
    });

    it('first_answered keeps the pre-2026 behaviour (first category reached wins)', () => {
      const r = scoreSubmission(tied, qs, { ...bendyScoring, tie_breaker: 'first_answered' }, bendyResult);
      expect(r.tieBrokenBy).toBe('first_answered');
      expect(r.outcome?.id).toBe(CATS.D);
    });

    it('tie_outcome sends every tie to a dedicated outcome', () => {
      const r = scoreSubmission(tied, qs, { ...bendyScoring, tie_breaker: 'tie_outcome', tie_outcome_id: CATS.D }, bendyResult);
      expect(r.matchedBy).toBe('tie_outcome');
      expect(r.outcome?.id).toBe(CATS.D);
    });

    it('a four-way tie is still deterministic', () => {
      const r1 = scoreSubmission(answersFromLetters('ABCD---'), qs, bendyScoring, bendyResult);
      const r2 = scoreSubmission(answersFromLetters('DCBA---'), qs, bendyScoring, bendyResult);
      expect(r1.tiedCategories).toHaveLength(4);
      expect(r1.outcome?.id).toBe(CATS.A);
      expect(r2.outcome?.id).toBe(CATS.A);
    });
  });

  it('no answers → flagged fallback (first outcome), never silent', () => {
    const r = scoreSubmission({}, qs, bendyScoring, bendyResult);
    expect(r.matchedBy).toBe('fallback');
    expect(r.outcome?.id).toBe(CATS.A);
    expect(r.reason).toMatch(/No answers mapped/);
  });

  it('answers that match no option are ignored by the tally', () => {
    const answers = { ...answersFromLetters('BBB----'), [qs[3].label]: 'not a real option' };
    const r = scoreSubmission(answers, qs, bendyScoring, bendyResult);
    expect(r.categoryCounts).toEqual({ [CATS.B]: 3 });
  });

  it('calculateOutcome wrapper stays backwards compatible', () => {
    expect(calculateOutcome(answersFromLetters('CCCCCCC'), qs, bendyScoring, bendyResult)?.id).toBe(CATS.C);
  });
});

describe('broken scoring configurations', () => {
  it('missing scoring_config → no outcome with reason', () => {
    const r = scoreSubmission(answersFromLetters('AAAAAAA'), qs, null, bendyResult);
    expect(r.outcome).toBeNull();
    expect(r.reason).toMatch(/scoring_config/);
  });

  it('unknown scoring type → no outcome', () => {
    const r = scoreSubmission({}, qs, { type: 'weird' } as unknown as ScoringConfig, bendyResult);
    expect(r.outcome).toBeNull();
  });

  it('empty outcomes → no outcome', () => {
    const r = scoreSubmission(answersFromLetters('AAAAAAA'), qs, bendyScoring, { outcomes: [] });
    expect(r.outcome).toBeNull();
    expect(r.reason).toMatch(/no outcomes/);
  });

  it('winning category without an outcome → flagged fallback', () => {
    const partial: ResultConfig = { outcomes: bendyResult.outcomes.filter((o) => o.id !== CATS.C) };
    const r = scoreSubmission(answersFromLetters('CCCCCCC'), qs, bendyScoring, partial);
    expect(r.matchedBy).toBe('fallback');
    expect(r.reason).toMatch(/dysautonomia_autonomic/);
  });
});

describe('points scoring', () => {
  const pointsQs: Question[] = [0, 1, 2].map((i) => ({
    ...qs[i],
    options: [
      { label: `Q${i} never`, value: '0', score: 0 },
      { label: `Q${i} sometimes`, value: '1', score: 1 },
      { label: `Q${i} often`, value: '2', score: 2 },
    ],
  }));
  const pointsScoring: ScoringConfig = { type: 'points' };
  const pointsResult: ResultConfig = {
    outcomes: [
      { id: 'low', title: 'Low', match: { score_min: 0, score_max: 2 } },
      { id: 'mid', title: 'Mid', match: { score_min: 3, score_max: 4 } },
      { id: 'high', title: 'High', match: { score_min: 5, score_max: 6 } },
    ],
  };
  const pick = (vals: number[]) => Object.fromEntries(pointsQs.map((q, i) => [q.label, `Q${i} ${['never', 'sometimes', 'often'][vals[i]]}`]));

  it.each([
    [[0, 0, 0], 0, 'low'],
    [[1, 1, 0], 2, 'low'],
    [[1, 1, 1], 3, 'mid'],
    [[2, 2, 0], 4, 'mid'],
    [[2, 2, 2], 6, 'high'],
  ])('%j → total %i → %s', (vals, total, id) => {
    const r = scoreSubmission(pick(vals as number[]), pointsQs, pointsScoring, pointsResult);
    expect(r.totalScore).toBe(total);
    expect(r.outcome?.id).toBe(id);
    expect(r.matchedBy).toBe('score_range');
  });

  it('total outside every range → flagged fallback to last outcome', () => {
    const gappy: ResultConfig = { outcomes: [{ id: 'low', title: 'Low', match: { score_min: 0, score_max: 1 } }, { id: 'high', title: 'High', match: { score_min: 5 } }] };
    const r = scoreSubmission(pick([1, 1, 1]), pointsQs, pointsScoring, gappy);
    expect(r.matchedBy).toBe('fallback');
    expect(r.outcome?.id).toBe('high');
  });

  it('checkbox answers add every selected option', () => {
    const cb: Question = { ...pointsQs[0], field_type: 'checkbox' };
    const r = scoreSubmission({ [cb.label]: ['Q0 sometimes', 'Q0 often'] }, [cb], pointsScoring, pointsResult);
    expect(r.totalScore).toBe(3);
  });
});

describe('validateAnswers (public submissions)', () => {
  it('accepts a complete valid submission and normalises values to labels', () => {
    const answers = Object.fromEntries(qs.map((q) => [q.label, 'A']));
    const { errors, cleaned } = validateAnswers(answers, qs);
    expect(errors).toEqual([]);
    expect(cleaned[qs[0].label]).toBe((qs[0].options as { label: string }[])[0].label);
  });

  it('rejects missing required answers', () => {
    const { errors } = validateAnswers(answersFromLetters('AAA----'), qs);
    expect(errors).toHaveLength(4);
    expect(errors[0]).toMatch(/Please answer/);
  });

  it('rejects an option that does not exist', () => {
    const answers = { ...answersFromLetters('AAAAAAA'), [qs[2].label]: '(E) injected option' };
    const { errors } = validateAnswers(answers, qs);
    expect(errors).toEqual([`Invalid choice for: "${qs[2].label}"`]);
  });

  it('drops unknown keys instead of storing them', () => {
    const { cleaned } = validateAnswers({ ...answersFromLetters('AAAAAAA'), evil: 'x'.repeat(10) }, qs);
    expect(cleaned).not.toHaveProperty('evil');
  });

  it('rejects non-object payloads and wrong value types', () => {
    expect(validateAnswers(null, qs).errors[0]).toMatch(/missing or invalid/);
    expect(validateAnswers(['a'], qs).errors[0]).toMatch(/missing or invalid/);
    const { errors } = validateAnswers({ ...answersFromLetters('AAAAAAA'), [qs[0].label]: { $gt: '' } }, qs);
    expect(errors[0]).toMatch(/Invalid answer/);
  });

  it('validates numbers, text length and optional questions', () => {
    const extra: Question[] = [
      { ...qs[0], id: 'n', label: 'Age', variable_name: 'age', field_type: 'number', options: null },
      { ...qs[0], id: 't', label: 'Notes', variable_name: 'notes', field_type: 'textarea', options: null, required: false },
    ];
    expect(validateAnswers({ Age: 'abc' }, extra).errors[0]).toMatch(/number/);
    expect(validateAnswers({ Age: '52', Notes: 'x'.repeat(5001) }, extra).errors[0]).toMatch(/too long/);
    expect(validateAnswers({ Age: '52' }, extra).errors).toEqual([]);
  });
});

describe('sanitizeGeneratedText — no raw identifiers reach respondents', () => {
  it('replaces variable names, category ids and placeholders with readable text', () => {
    const text = 'Your q1SymptomDriver answer and {{q7SearchForAnswers}} point to histamine_inflammatory. [variable: q2_pattern]';
    const out = sanitizeGeneratedText(text, qs, bendyResult.outcomes);
    expect(out).not.toMatch(/q1SymptomDriver|q7SearchForAnswers|histamine_inflammatory|\[variable/);
    expect(out).toContain('Histamine + Inflammatory Reactivity Pattern');
    expect(out).toContain(qs[0].label);
  });

  it('humanises unknown snake_case / qNCamelCase identifiers but leaves URLs and emails alone', () => {
    const text = 'Your energy_level_score and q3SleepQuality suggest more rest. See https://example.com/book_now or a_b@example.com.';
    const out = sanitizeGeneratedText(text, [], []);
    expect(out).toBe('Your energy level score and sleep quality suggest more rest. See https://example.com/book_now or a_b@example.com.');
  });

  it('leaves ordinary prose untouched', () => {
    const text = 'Track your symptoms for two weeks and talk to a clinician.';
    expect(sanitizeGeneratedText(text, qs, bendyResult.outcomes)).toBe(text);
  });
});

describe('buildHybridPrompt', () => {
  it('pins the outcome title and lists only answered questions by wording', () => {
    const prompt = buildHybridPrompt('Be warm.', bendyResult.outcomes[1], answersFromLetters('BB-----'), qs);
    expect(prompt).toContain('PARTICIPANT\'S RESULT TYPE: Histamine + Inflammatory Reactivity Pattern');
    expect(prompt).toContain(qs[0].label);
    expect(prompt).not.toContain(qs[2].label);
    expect(prompt).not.toContain('q1SymptomDriver');
  });
});
