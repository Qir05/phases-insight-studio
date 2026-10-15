'use client';
import { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { FlaskConical, ChevronDown, ChevronUp, Loader2, Sparkles, AlertTriangle } from 'lucide-react';
import { scoreSubmission, findOption, getOptionCategory, getOptionLabel } from '@/lib/scoring';
import type { AnswerMap } from '@/lib/utils';
import type { Question, QuestionOption, ScoringConfig, ResultConfig, ResultStrategy, Outcome } from '@/lib/supabase';

type TestQuestion = Pick<Question, 'label' | 'variable_name' | 'field_type' | 'options' | 'category'> & { id?: string };

interface ServerPreview {
  outcome?: Outcome | null;
  ai_result?: string | null;
  generation_status?: string | null;
  generation_error?: string | null;
  error?: string;
  internal_error?: string;
}

/**
 * Admin-only "what would this answer combination produce" simulator.
 * Scoring runs client-side through scoreSubmission() — the same function
 * /api/generate uses. With a toolId, "Run full preview" calls the admin
 * preview endpoint, which runs the real production pipeline (including AI)
 * without saving a submission.
 */
export default function TestOutcomeMapping({
  questions,
  scoringConfig,
  resultConfig,
  resultStrategy,
  toolId,
  defaultOpen = false,
}: {
  questions:      TestQuestion[];
  scoringConfig:  ScoringConfig | null;
  resultConfig:   ResultConfig  | null;
  resultStrategy: ResultStrategy;
  toolId?:        string;
  defaultOpen?:   boolean;
}) {
  const [open, setOpen]       = useState(defaultOpen);
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [running, setRunning] = useState(false);
  const [server, setServer]   = useState<ServerPreview | null>(null);

  const testableQuestions = useMemo(
    () => questions.filter((q) => Array.isArray(q.options) && q.options.length > 0),
    [questions]
  );

  const breakdown = useMemo(
    () => scoreSubmission(answers, questions, scoringConfig, resultConfig),
    [answers, questions, scoringConfig, resultConfig]
  );

  const answeredCount = Object.keys(answers).length;
  const maxOptions = Math.max(0, ...testableQuestions.map((q) => (q.options as QuestionOption[]).length));
  const letters = 'ABCDEFGH'.slice(0, Math.min(maxOptions, 8)).split('');

  function fillByIndex(idx: number) {
    const next: AnswerMap = {};
    for (const q of testableQuestions) {
      const opts = q.options as QuestionOption[];
      const opt = opts[Math.min(idx, opts.length - 1)];
      next[q.label] = q.field_type === 'checkbox' ? [getOptionLabel(opt)] : getOptionLabel(opt);
    }
    setAnswers(next);
    setServer(null);
  }

  function fillRandom() {
    const next: AnswerMap = {};
    for (const q of testableQuestions) {
      const opts = q.options as QuestionOption[];
      const opt = opts[Math.floor(Math.random() * opts.length)];
      next[q.label] = q.field_type === 'checkbox' ? [getOptionLabel(opt)] : getOptionLabel(opt);
    }
    setAnswers(next);
    setServer(null);
  }

  async function runServerPreview() {
    if (!toolId) return;
    setRunning(true);
    setServer(null);
    // Free-text questions get a neutral sample so required checks pass.
    const full: AnswerMap = { ...answers };
    for (const q of questions) {
      if (full[q.label] !== undefined) continue;
      if (q.field_type === 'text' || q.field_type === 'textarea') full[q.label] = 'Sample answer (admin preview)';
      if (q.field_type === 'number') full[q.label] = '1';
    }
    const res = await fetch(`/api/admin/tools/${toolId}/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers: full, run_ai: resultStrategy !== 'structured_outcome' }),
    });
    const json = await res.json().catch(() => ({ error: 'Preview failed' })) as ServerPreview;
    setRunning(false);
    setServer(res.ok ? json : { error: json.error ?? 'Preview failed', internal_error: json.internal_error });
  }

  if (!scoringConfig || !resultConfig) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 p-5">
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <FlaskConical size={15} />
          Test Outcome Mapping — configure Scoring Config and Result Config first.
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
            Pick test answers to see which outcome they produce. Uses the same scoring code as live submissions — nothing is saved.
          </p>

          {testableQuestions.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-gray-500 mr-1">Quick fill:</span>
              {letters.map((l, i) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => fillByIndex(i)}
                  className="text-xs border border-gray-200 rounded-md px-2 py-1 hover:border-indigo-300 hover:text-indigo-600"
                >
                  All {l}
                </button>
              ))}
              <button type="button" onClick={fillRandom} className="text-xs border border-gray-200 rounded-md px-2 py-1 hover:border-indigo-300 hover:text-indigo-600">
                Mixed
              </button>
              <button type="button" onClick={() => { setAnswers({}); setServer(null); }} className="text-xs text-gray-400 px-2 py-1 hover:text-gray-600">
                Clear
              </button>
            </div>
          )}

          {testableQuestions.length === 0 ? (
            <p className="text-sm text-gray-400">No questions with options yet.</p>
          ) : (
            <div className="space-y-3">
              {testableQuestions.map((q) => {
                const opts = (q.options as QuestionOption[]) ?? [];
                const raw = answers[q.label];
                const value = Array.isArray(raw) ? raw[0] ?? '' : raw ?? '';
                const matched = value ? findOption(opts, value) : undefined;
                const cat = matched ? getOptionCategory(matched) ?? q.category : null;

                return (
                  <div key={q.id ?? q.label} className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto] gap-1 sm:gap-3 sm:items-end">
                    <div className="min-w-0">
                      <label className="block text-xs font-medium text-gray-600 mb-1">{q.label}</label>
                      <select
                        value={value}
                        onChange={(e) => {
                          setServer(null);
                          setAnswers((a) => {
                            if (!e.target.value) {
                              const rest = { ...a };
                              delete rest[q.label];
                              return rest;
                            }
                            return { ...a, [q.label]: q.field_type === 'checkbox' ? [e.target.value] : e.target.value };
                          });
                        }}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      >
                        <option value="">— No answer —</option>
                        {opts.map((o) => (
                          <option key={getOptionLabel(o)} value={getOptionLabel(o)}>{getOptionLabel(o)}</option>
                        ))}
                      </select>
                    </div>
                    <span className={`text-xs font-mono whitespace-nowrap sm:pb-2.5 ${cat ? 'text-teal-600' : 'text-gray-300'}`}>
                      {cat ?? (value ? 'no category' : '—')}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          <div className="border-t border-gray-100 pt-4 space-y-3">
            {breakdown.type === 'category' ? (
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Category counts</p>
                {Object.keys(breakdown.categoryCounts).length === 0 ? (
                  <p className="text-xs text-gray-400">No categories tallied yet — answer at least one question above.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(breakdown.categoryCounts).map(([c, count]) => (
                      <span
                        key={c}
                        className={`text-xs border rounded-full px-2.5 py-1 font-mono ${
                          c === breakdown.winningCategory ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-gray-50 border-gray-100'
                        }`}
                      >
                        {c}: <strong>{count}</strong>
                      </span>
                    ))}
                  </div>
                )}
                {breakdown.tiedCategories.length > 1 && (
                  <p className="text-xs text-amber-700 mt-2">
                    Tie between {breakdown.tiedCategories.join(', ')} — resolved by{' '}
                    {breakdown.tieBrokenBy === 'tie_outcome'
                      ? 'the configured tie outcome'
                      : breakdown.tieBrokenBy === 'first_answered'
                      ? 'whichever category was reached first'
                      : 'the order of scoring_config.categories'}.
                  </p>
                )}
              </div>
            ) : breakdown.type === 'points' ? (
              <p className="text-xs text-gray-600">
                Total score: <strong className="font-mono">{breakdown.totalScore}</strong>
              </p>
            ) : null}

            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Winning outcome</p>
              {answeredCount === 0 ? (
                <p className="text-xs text-gray-400">Answer at least one question to see a result.</p>
              ) : breakdown.outcome ? (
                <div className="bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2.5">
                  <p className="text-sm font-semibold text-indigo-800">{breakdown.outcome.title}</p>
                  {breakdown.outcome.description && <p className="text-xs text-indigo-600 mt-0.5">{breakdown.outcome.description}</p>}
                </div>
              ) : (
                <p className="text-xs text-red-500">No outcome matched — {breakdown.reason}</p>
              )}
              {answeredCount > 0 && breakdown.matchedBy === 'fallback' && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mt-2 flex gap-1.5">
                  <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
                  Fallback used: {breakdown.reason} Fix the mapping before publishing.
                </p>
              )}
            </div>

            <p className="text-xs text-gray-400">
              AI personalisation: {resultStrategy === 'hybrid_ai_with_outcome'
                ? 'Yes — this outcome would be personalised by the AI (hybrid mode).'
                : resultStrategy === 'structured_outcome'
                ? 'No — structured outcome mode shows the configured result as-is, no AI call.'
                : 'N/A for this result strategy.'}
            </p>

            {toolId && answeredCount > 0 && (
              <p className="text-xs text-gray-400">The server preview runs the last <strong>saved</strong> settings — save first if you changed anything above.</p>
            )}
            {toolId && answeredCount > 0 && (
              <button
                type="button"
                onClick={runServerPreview}
                disabled={running}
                className="inline-flex items-center gap-2 text-sm bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 disabled:opacity-60"
              >
                {running ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                {running ? 'Running real pipeline…' : resultStrategy === 'hybrid_ai_with_outcome' ? 'Run full preview (with AI)' : 'Run server preview'}
              </button>
            )}

            {server && (
              <div className="border border-gray-100 rounded-xl p-4 space-y-2 bg-gray-50">
                {server.error ? (
                  <>
                    <p className="text-sm text-red-600">{server.error}</p>
                    {server.internal_error && <p className="text-xs text-red-400 font-mono">{server.internal_error}</p>}
                  </>
                ) : (
                  <>
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Server result</p>
                    {server.outcome && <p className="text-sm font-semibold text-gray-900">{server.outcome.title}</p>}
                    {server.generation_status === 'failed' && (
                      <p className="text-xs text-amber-700">
                        AI step failed ({server.generation_error}). Respondents would still see the outcome above without the personalised section.
                      </p>
                    )}
                    {server.ai_result && (
                      <div className="prose prose-sm prose-gray max-w-none bg-white border border-gray-100 rounded-lg p-3">
                        <ReactMarkdown>{server.ai_result}</ReactMarkdown>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
