import type { Question, ScoringConfig, ResultConfig, QuestionOption } from '@/lib/supabase';

/**
 * Synthetic fixture shaped like the Bendy Menopause Type Quiz after
 * migration 008: 7 single-choice questions with lettered (A)–(D) options,
 * category scoring, letter → category mapping and 4 provisional outcomes.
 * Question/option wording is synthetic — the real copy lives in the
 * production database, which these unit tests never touch.
 */
export const CATS = {
  A: 'musculoskeletal_hypermobility',
  B: 'histamine_inflammatory',
  C: 'dysautonomia_autonomic',
  D: 'complex_multisystem',
} as const;

const THEMES = ['muscle/joint', 'reactive/flushing', 'dizziness/heart-rate', 'everything overlapping'];

export function bendyQuestions(): Question[] {
  return Array.from({ length: 7 }, (_, i) => {
    const options: QuestionOption[] = (['A', 'B', 'C', 'D'] as const).map((L, j) => ({
      label: `(${L}) Q${i + 1} ${THEMES[j]} answer`,
      value: L,
      category: CATS[L],
      score: 1,
    }));
    return {
      id: `q${i + 1}`,
      tool_id: 'bendy',
      label: `Question ${i + 1}: which best describes your symptoms?`,
      variable_name: i === 0 ? 'q1SymptomDriver' : i === 6 ? 'q7SearchForAnswers' : `q${i + 1}_pattern`,
      field_type: 'radio',
      options,
      required: true,
      order_index: i,
      scoring_key: null,
      category: null,
      created_at: '2026-01-01T00:00:00Z',
    };
  });
}

export const bendyScoring: ScoringConfig = {
  type: 'category',
  categories: [CATS.A, CATS.B, CATS.C, CATS.D],
};

export const bendyResult: ResultConfig = {
  outcomes: [
    { id: CATS.A, title: 'Musculoskeletal + Hypermobility Pattern', description: 'A desc', match: { top_category: CATS.A }, recommendations: ['a1'] },
    { id: CATS.B, title: 'Histamine + Inflammatory Reactivity Pattern', description: 'B desc', match: { top_category: CATS.B }, recommendations: ['b1'] },
    { id: CATS.C, title: 'Dysautonomia + Autonomic Regulation Pattern', description: 'C desc', match: { top_category: CATS.C }, recommendations: ['c1'] },
    { id: CATS.D, title: 'Complex Multi-System Pattern', description: 'D desc', match: { top_category: CATS.D }, recommendations: ['d1'] },
  ],
};

/** Build an answer map from a letter string, e.g. "AABCDDA" (use "-" to skip a question). */
export function answersFromLetters(letters: string, questions = bendyQuestions()) {
  const out: Record<string, string> = {};
  letters.split('').forEach((L, i) => {
    if (L === '-') return;
    const q = questions[i];
    const opt = (q.options as { label: string; value: string }[]).find((o) => o.value === L)!;
    out[q.label] = opt.label;
  });
  return out;
}
