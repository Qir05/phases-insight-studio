'use client';
import { useMemo, useState } from 'react';
import { FlaskConical, ChevronDown, ChevronUp } from 'lucide-react';
import { calculateOutcome, computeCategoryCounts, findOption, getOptionCategory, getOptionLabel } from '@/lib/scoring';
import type { AnswerMap } from '@/lib/utils';
import type { Question, QuestionOption, ScoringConfig, ResultConfig, ResultStrategy } from '@/lib/supabase';

/**
 * Admin-only "what would this answer combination produce" simulator.
 * Pure client-side computation against calculateOutcome() — never calls
 * /api/generate and never creates a submission.
 */
export default function TestOutcomeMapping({
  questions,
  scoringConfig,
  resultConfig,
  resultStrategy,
}: {
  questions:      Question[];
  scoringConfig:  ScoringConfig | null;
  resultConfig:   ResultConfig  | null;
  resultStrategy: ResultStrategy;
}) {
  const [open, setOpen]       = useState(false);
  const [answers, setAnswers] = useState<AnswerMap>({});

  const testableQuestions = useMemo(
    () => questions.filter((q) => Array.isArray(q.options) && q.options.length > 0),
    [questions]
  );

  const categoryCounts = useMemo(
    () => (scoringConfig ? computeCategoryCounts(answers, questions) : {}),
    [answers, questions, scoringConfig]
  );

  const outcome = useMemo(() => {
    if (!scoringConfig || !resultConfig) return null;
    return calculateOutcome(answers, questions, scoringConfig, resultConfig);
  }, [answers, questions, scoringConfig, resultConfig]);

  const answeredCount = Object.keys(answers).length;

  if (!scoringConfig || !resultConfig) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 p-5">
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <FlaskConical size={15} />
          Test Outcome Mapping — configure Scoring Config and Result Config in Settings first.
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-gray-50 transition-colors"
      >
        <span className="inline-flex items-center gap-2 text-sm font-medium text-gray-800">
          <FlaskConical size={15} className="text-indigo-500" />
          Test Outcome Mapping
        </span>
        {open ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
      </button>

      {open && (
        <div className="border-t border-gray-100 px-5 py-5 space-y-5">
          <p className="text-xs text-gray-400">
            Pick a test answer for each question to preview which outcome it would produce. This is admin-only — it never creates a real submission.
          </p>

          {testableQuestions.length === 0 ? (
            <p className="text-sm text-gray-400">No questions with options yet — add some in the list above.</p>
          ) : (
            <div className="space-y-3">
              {testableQuestions.map((q) => {
                const opts = (q.options as QuestionOption[]) ?? [];
                const value = (answers[q.label] as string | undefined) ?? '';
                const matched = value ? findOption(opts, value) : undefined;
                const cat = matched ? getOptionCategory(matched) ?? q.category : null;

                return (
                  <div key={q.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 items-center">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">{q.label}</label>
                      <select
                        value={value}
                        onChange={(e) =>
                          setAnswers((a) => {
                            if (!e.target.value) {
                              const rest = { ...a };
                              delete rest[q.label];
                              return rest;
                            }
                            return { ...a, [q.label]: e.target.value };
                          })
                        }
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      >
                        <option value="">— No answer —</option>
                        {opts.map((o) => (
                          <option key={getOptionLabel(o)} value={getOptionLabel(o)}>{getOptionLabel(o)}</option>
                        ))}
                      </select>
                    </div>
                    <span className="text-xs text-teal-600 font-mono whitespace-nowrap mt-4">
                      {cat ?? '—'}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          <div className="border-t border-gray-100 pt-4 space-y-3">
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Category counts</p>
              {Object.keys(categoryCounts).length === 0 ? (
                <p className="text-xs text-gray-400">No categories tallied yet — answer at least one question above.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {Object.entries(categoryCounts).map(([cat, count]) => (
                    <span key={cat} className="text-xs bg-gray-50 border border-gray-100 rounded-full px-2.5 py-1 font-mono">
                      {cat}: <strong>{count}</strong>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Winning outcome</p>
              {answeredCount === 0 ? (
                <p className="text-xs text-gray-400">Answer at least one question to see a result.</p>
              ) : outcome ? (
                <div className="bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2.5">
                  <p className="text-sm font-semibold text-indigo-800">{outcome.title}</p>
                  {outcome.description && <p className="text-xs text-indigo-600 mt-0.5">{outcome.description}</p>}
                </div>
              ) : (
                <p className="text-xs text-red-500">No outcome matched these answers — check your scoring_config/result_config mapping.</p>
              )}
            </div>

            <p className="text-xs text-gray-400">
              AI personalisation: {resultStrategy === 'hybrid_ai_with_outcome'
                ? 'Yes — this outcome would be personalised by the AI (hybrid mode).'
                : resultStrategy === 'structured_outcome'
                ? 'No — structured outcome mode shows the configured result as-is, no AI call.'
                : 'N/A for this result strategy.'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
