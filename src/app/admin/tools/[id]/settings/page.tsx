'use client';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { slugify } from '@/lib/utils';
import { ArrowLeft, ExternalLink, List, Users, AlertTriangle, Sparkles, Loader2, Wrench } from 'lucide-react';
import type { ResultStrategy, ScoringConfig, ResultConfig, Tool, Question, QuestionOption } from '@/lib/supabase';
import { validateResultConfig } from '@/lib/resultConfigValidation';
import { getOptionCategory, getOptionLabel, getOptionValue } from '@/lib/scoring';
import PublishControls from '@/components/PublishControls';
import TestOutcomeMapping from '@/components/TestOutcomeMapping';

type ToolMode = 'ai_result' | 'smartform_redirect';

interface OptionMapping {
  question_id:    string;
  question_label: string;
  options:        { label: string; value: string; category: string | null }[];
}

interface MigrationDraft {
  result_strategy: ResultStrategy;
  scoring_config:  string;
  result_config:   string;
  result_template: string;
  option_mappings: OptionMapping[];
}

const RESULT_STRATEGY_OPTIONS: { value: ResultStrategy; label: string; description: string }[] = [
  {
    value: 'ai_generated',
    label: 'AI Generated',
    description: 'AI produces a fully personalised response using your system prompt / result template.',
  },
  {
    value: 'structured_outcome',
    label: 'Structured Outcome',
    description: 'Calculates a result from scores/categories — no AI. Shows configured title, description, and recommendations.',
  },
  {
    value: 'hybrid_ai_with_outcome',
    label: 'Hybrid — Outcome + AI Personalisation',
    description: 'Calculates the structured outcome first, then the AI personalises the configured result for this person.',
  },
];

const SCORING_CONFIG_PLACEHOLDER = JSON.stringify(
  { type: 'category', categories: ['hormone_support', 'liver_support', 'nervous_system'] },
  null, 2
);

const RESULT_CONFIG_PLACEHOLDER = JSON.stringify(
  {
    outcomes: [
      {
        id: 'hormone_support',
        title: 'The Hormone Support Type',
        description: 'Your symptoms are primarily driven by hormonal shifts.',
        match: { top_category: 'hormone_support' },
        recommendations: ['Consider hormone-supportive herbs', 'Prioritise sleep quality'],
        cta_text: 'Book a Consultation',
        cta_url: 'https://your-site.com/book',
      },
    ],
  },
  null, 2
);

interface FormState {
  title:                  string;
  slug:                   string;
  description:            string;
  tool_mode:              ToolMode;
  result_strategy:        ResultStrategy;
  system_prompt:          string;
  result_template:        string;
  scoring_config:         string;
  result_config:          string;
  admin_notes:            string;
  webhook_url:            string;
  redirect_url:           string;
  email_capture_enabled:  boolean;
  phone_capture_enabled:  boolean;
  ghl_enabled:            boolean;
  ghl_webhook_url:        string;
  ghl_tag:                string;
  provider_name:          string;
  provider_logo_url:      string;
  primary_color:          string;
}

const EMPTY_FORM: FormState = {
  title:                  '',
  slug:                   '',
  description:            '',
  tool_mode:              'ai_result',
  result_strategy:        'ai_generated',
  system_prompt:          '',
  result_template:        '',
  scoring_config:         '',
  result_config:          '',
  admin_notes:            '',
  webhook_url:            '',
  redirect_url:           '',
  email_capture_enabled:  true,
  phone_capture_enabled:  false,
  ghl_enabled:            false,
  ghl_webhook_url:        '',
  ghl_tag:                '',
  provider_name:          '',
  provider_logo_url:      '',
  primary_color:          '',
};

export default function ToolSettingsPage() {
  const { id } = useParams<{ id: string }>();
  const [tool, setTool]         = useState<Tool | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [form, setForm]         = useState<FormState>(EMPTY_FORM);

  const [saveErrors, setSaveErrors] = useState<string[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);

  // ── Migration Assistant (draft result config inferred from existing questions) ──
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [inferring,     setInferring]     = useState(false);
  const [draft,         setDraft]         = useState<MigrationDraft | null>(null);
  const [draftError,    setDraftError]    = useState<string | null>(null);
  const [draftReviewed, setDraftReviewed] = useState(false);
  const [applying,      setApplying]      = useState(false);

  const update = useCallback((key: keyof FormState, value: string | boolean) => {
    setForm((f) => ({ ...f, [key]: value }));
  }, []);

  const setEmailCapture = useCallback((v: boolean) => update('email_capture_enabled', v), [update]);
  const setPhoneCapture = useCallback((v: boolean) => update('phone_capture_enabled', v), [update]);
  const setGhlEnabled   = useCallback((v: boolean) => update('ghl_enabled', v), [update]);

  const load = useCallback(async () => {
    const [res, qRes] = await Promise.all([
      fetch(`/api/admin/tools/${id}`),
      fetch(`/api/admin/tools/${id}/questions`),
    ]);
    const json  = await res.json()  as { tool?: Tool; error?: string };
    const qJson = await qRes.json().catch(() => ({})) as { questions?: Question[] };
    setQuestions(Array.isArray(qJson.questions) ? qJson.questions : []);

    if (!res.ok || !json.tool) {
      toast.error(json.error ?? 'Failed to load tool');
      setLoading(false);
      return;
    }
    const t = json.tool;
    setTool(t);
    setForm({
      title:                  t.title                  ?? '',
      slug:                   t.slug                   ?? '',
      description:            t.description            ?? '',
      tool_mode:              t.tool_mode               as ToolMode ?? 'ai_result',
      result_strategy:        t.result_strategy        ?? 'ai_generated',
      system_prompt:          t.system_prompt          ?? '',
      result_template:        t.result_template        ?? '',
      scoring_config:         t.scoring_config ? JSON.stringify(t.scoring_config, null, 2) : '',
      result_config:          t.result_config  ? JSON.stringify(t.result_config,  null, 2) : '',
      admin_notes:            t.admin_notes            ?? '',
      webhook_url:            t.webhook_url            ?? '',
      redirect_url:           t.redirect_url           ?? '',
      email_capture_enabled:  t.email_capture_enabled  ?? true,
      phone_capture_enabled:  t.phone_capture_enabled  ?? false,
      ghl_enabled:            t.ghl_enabled            ?? false,
      ghl_webhook_url:        t.ghl_webhook_url        ?? '',
      ghl_tag:                t.ghl_tag                ?? '',
      provider_name:          t.provider_name          ?? '',
      provider_logo_url:      t.provider_logo_url      ?? '',
      primary_color:          t.primary_color          ?? '',
    });
    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const isSmartForm  = form.tool_mode === 'smartform_redirect';
  const strategy     = form.result_strategy;
  const needsScoring = strategy === 'structured_outcome' || strategy === 'hybrid_ai_with_outcome';

  // Migration Assistant applies only to the exact "never configured" state.
  const needsMigrationAssistant =
    !isSmartForm &&
    strategy === 'ai_generated' &&
    !form.scoring_config.trim() &&
    !form.result_config.trim() &&
    !form.result_template.trim();

  // Live, non-blocking validation — shown to the admin, never blocks Save
  // (the PUT route still hard-blocks genuinely broken config server-side).
  const liveValidation = useMemo(() => {
    if (isSmartForm || !needsScoring) return { errors: [] as string[], warnings: [] as string[] };

    let parsedScoring: ScoringConfig | null = null;
    let parsedResult:  ResultConfig  | null = null;
    try { parsedScoring = form.scoring_config.trim() ? JSON.parse(form.scoring_config) : null; } catch { /* reported by submit() */ }
    try { parsedResult  = form.result_config.trim()  ? JSON.parse(form.result_config)  : null; } catch { /* reported by submit() */ }

    return validateResultConfig(
      form.tool_mode,
      strategy,
      parsedScoring,
      parsedResult,
      questions.map((q) => ({ options: q.options })),
    );
  }, [isSmartForm, needsScoring, form.tool_mode, strategy, form.scoring_config, form.result_config, questions]);

  // Parsed (unsaved) form configs for the test harness — null while the JSON is invalid.
  const liveConfigs = useMemo(() => {
    try {
      const scoring = form.scoring_config.trim() ? JSON.parse(form.scoring_config) as ScoringConfig : null;
      const result  = form.result_config.trim()  ? JSON.parse(form.result_config)  as ResultConfig  : null;
      return scoring && result ? { scoring, result } : null;
    } catch {
      return null;
    }
  }, [form.scoring_config, form.result_config]);

  async function generateDraftResultConfig() {
    setInferring(true);
    setDraftError(null);
    setDraftReviewed(false);
    const res  = await fetch(`/api/admin/tools/${id}/infer-result-config`, { method: 'POST' });
    const json = await res.json().catch(() => ({})) as {
      draft?: {
        result_strategy: ResultStrategy;
        scoring_config: unknown;
        result_config: unknown;
        result_template: string | null;
        option_mappings: OptionMapping[];
      };
      error?: string;
    };
    setInferring(false);

    if (!res.ok || !json.draft) {
      setDraftError(json.error ?? 'Failed to generate a draft. Please try again.');
      return;
    }
    setDraft({
      result_strategy: json.draft.result_strategy,
      scoring_config:  JSON.stringify(json.draft.scoring_config ?? { type: 'category', categories: [] }, null, 2),
      result_config:   JSON.stringify(json.draft.result_config ?? { outcomes: [] }, null, 2),
      result_template: json.draft.result_template ?? '',
      option_mappings: json.draft.option_mappings ?? [],
    });
  }

  /** Starts a migration draft from the tool's current config (no AI) so mappings can be corrected by hand. */
  function startManualDraft() {
    setDraftError(null);
    setDraftReviewed(false);
    setDraft({
      result_strategy: needsScoring ? strategy : 'hybrid_ai_with_outcome',
      scoring_config:  form.scoring_config || JSON.stringify({ type: 'category', categories: [] }, null, 2),
      result_config:   form.result_config  || JSON.stringify({ outcomes: [] }, null, 2),
      result_template: form.result_template,
      option_mappings: questions
        .filter((q) => Array.isArray(q.options) && q.options.length > 0)
        .map((q) => ({
          question_id:    q.id,
          question_label: q.label,
          options: (q.options as QuestionOption[]).map((o) => ({
            label:    getOptionLabel(o),
            value:    getOptionValue(o),
            category: getOptionCategory(o) ?? null,
          })),
        })),
    });
  }

  function setMapping(questionId: string, optionIndex: number, category: string | null) {
    setDraftReviewed(false);
    setDraft((d) => d && ({
      ...d,
      option_mappings: d.option_mappings.map((m) =>
        m.question_id !== questionId ? m : {
          ...m,
          options: m.options.map((o, i) => (i === optionIndex ? { ...o, category } : o)),
        }
      ),
    }));
  }

  const draftParsed = useMemo(() => {
    if (!draft) return null;
    let scoring: ScoringConfig | null = null;
    let result: ResultConfig | null = null;
    let parseError: string | null = null;
    try { scoring = JSON.parse(draft.scoring_config); } catch { parseError = 'Scoring config JSON is not valid.'; }
    try { result = JSON.parse(draft.result_config); } catch { parseError = 'Result config JSON is not valid.'; }
    const mergedQuestions = questions.map((q) => {
      const m = draft.option_mappings.find((x) => x.question_id === q.id);
      return m
        ? { ...q, options: m.options.map((o) => ({ label: o.label, value: o.value, score: 1, ...(o.category ? { category: o.category } : {}) })) }
        : q;
    });
    const validation = parseError
      ? { errors: [parseError], warnings: [] as string[] }
      : validateResultConfig('ai_result', draft.result_strategy, scoring, result, mergedQuestions);
    const categoryChoices = Array.from(new Set([
      ...(Array.isArray(scoring?.categories) ? scoring!.categories : []),
      ...((result?.outcomes ?? []).map((o) => o?.match?.top_category).filter(Boolean) as string[]),
    ]));
    return { scoring, result, mergedQuestions, validation, categoryChoices };
  }, [draft, questions]);

  async function saveMigration() {
    if (!draft || !draftParsed?.scoring || !draftParsed.result) return;
    setApplying(true);
    const res = await fetch(`/api/admin/tools/${id}/apply-result-config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        result_strategy: draft.result_strategy,
        scoring_config:  draftParsed.scoring,
        result_config:   draftParsed.result,
        result_template: draft.result_template,
        option_mappings: draft.option_mappings,
      }),
    });
    const json = await res.json().catch(() => ({})) as { error?: string; errors?: string[]; questions_updated?: number };
    setApplying(false);
    if (!res.ok) {
      setDraftError(json.error ?? 'Failed to save the migration.');
      return;
    }
    toast.success(`Result configuration saved — ${json.questions_updated ?? 0} question(s) mapped. Tool ID and submissions unchanged.`);
    setDraft(null);
    setAssistantOpen(false);
    setRefreshKey((k) => k + 1);
    load();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    setSaveErrors([]);

    let parsedScoringConfig: unknown = null;
    let parsedResultConfig:  unknown = null;

    if (form.scoring_config.trim()) {
      try { parsedScoringConfig = JSON.parse(form.scoring_config); }
      catch { toast.error('Scoring Config is not valid JSON'); setSaving(false); return; }
    }
    if (form.result_config.trim()) {
      try { parsedResultConfig = JSON.parse(form.result_config); }
      catch { toast.error('Result Config is not valid JSON'); setSaving(false); return; }
    }

    const res = await fetch(`/api/admin/tools/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        provider_name:     form.provider_name     || null,
        provider_logo_url: form.provider_logo_url || null,
        primary_color:     form.primary_color     || null,
        webhook_url:        form.webhook_url        || null,
        redirect_url:       form.redirect_url       || null,
        system_prompt:      form.system_prompt      || null,
        result_template:    form.result_template    || null,
        admin_notes:        form.admin_notes        || null,
        scoring_config:     parsedScoringConfig,
        result_config:      parsedResultConfig,
      }),
    });
    const json = await res.json().catch(() => ({})) as { tool?: Tool; error?: string; errors?: string[] };
    setSaving(false);

    if (!res.ok) {
      setSaveError(json.error ?? 'Failed to save settings');
      setSaveErrors(json.errors && json.errors.length > 1 ? json.errors : []);
      toast.error(json.error ?? 'Failed to save settings');
      return;
    }

    toast.success('Settings saved');
    setRefreshKey((k) => k + 1);
    load();
  }

  if (loading) {
    return (
      <div className="max-w-2xl animate-pulse space-y-4">
        <div className="h-6 bg-gray-100 rounded w-40" />
        <div className="h-48 bg-gray-100 rounded-2xl" />
        <div className="h-48 bg-gray-100 rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <Link
        href="/admin"
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-6 transition-colors"
      >
        <ArrowLeft size={15} /> Back to Dashboard
      </Link>

      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between mb-6 gap-3 sm:gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-gray-900 truncate">{tool?.title}</h1>
          <p className="text-sm text-gray-500 mt-0.5">Tool Settings</p>
        </div>
        {tool && (
          <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
            <Link
              href={`/admin/tools/${id}/questions`}
              className="inline-flex items-center gap-1 text-xs border border-gray-200 rounded-lg px-3 py-1.5 text-gray-500 hover:text-indigo-600 transition-colors"
            >
              <List size={13} /> Questions
            </Link>
            <Link
              href={`/admin/tools/${id}/submissions`}
              className="inline-flex items-center gap-1 text-xs border border-gray-200 rounded-lg px-3 py-1.5 text-gray-500 hover:text-indigo-600 transition-colors"
            >
              <Users size={13} /> Submissions
            </Link>
            <Link
              href={`/t/${tool.slug}?preview=1`}
              target="_blank"
              className="inline-flex items-center gap-1 text-xs border border-gray-200 rounded-lg px-3 py-1.5 text-gray-500 hover:text-indigo-600 transition-colors"
            >
              <ExternalLink size={13} /> Preview
            </Link>
          </div>
        )}
      </div>

      {tool && (
        <div className="mb-6">
          <PublishControls toolId={tool.id} slug={tool.slug} refreshKey={refreshKey} />
        </div>
      )}

      {saveError && (
        <div className="bg-red-50 border border-red-100 rounded-2xl px-4 py-3 text-sm text-red-700 mb-6">
          {saveError}
          {saveErrors.length > 0 && (
            <ul className="list-disc list-inside text-xs mt-1.5 space-y-0.5">
              {saveErrors.slice(1).map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          )}
        </div>
      )}

      <form onSubmit={submit} className="space-y-6">

        {/* Basic info */}
        <section className="bg-white rounded-2xl border border-gray-100 p-6 space-y-4">
          <h2 className="font-semibold text-gray-800">Basic Info</h2>

          <Field label="Title *">
            <input
              required
              value={form.title}
              onChange={(e) => update('title', e.target.value)}
              className={input}
            />
          </Field>

          <Field
            label="Slug *"
            hint="This tool's public URL is /t/{slug}. Changing it will break any previously shared links."
          >
            <input
              required
              value={form.slug}
              onChange={(e) => update('slug', e.target.value)}
              className={`${input} font-mono`}
              placeholder={slugify(form.title)}
            />
            <p className="text-xs text-gray-400 mt-1">/t/{slugify(form.slug) || slugify(form.title)}</p>
          </Field>

          <Field label="Description">
            <input
              value={form.description}
              onChange={(e) => update('description', e.target.value)}
              className={input}
              placeholder="Short description shown to users"
            />
          </Field>
        </section>

        {/* Tool Mode */}
        <section className="bg-white rounded-2xl border border-gray-100 p-6 space-y-4">
          <div>
            <h2 className="font-semibold text-gray-800">Tool Mode</h2>
            <p className="text-xs text-gray-400 mt-0.5">Controls what happens after the user submits.</p>
          </div>

          <Field label="Mode *">
            <select
              value={form.tool_mode}
              onChange={(e) => update('tool_mode', e.target.value)}
              className={input}
            >
              <option value="ai_result">AI Result — Generate personalised output</option>
              <option value="smartform_redirect">SmartForm Redirect — Send webhook &amp; redirect user</option>
            </select>
          </Field>

          {isSmartForm && (
            <>
              <Field label="Webhook URL *" hint="POST request sent with all answers after submission.">
                <input
                  required
                  value={form.webhook_url}
                  onChange={(e) => update('webhook_url', e.target.value)}
                  className={input}
                  placeholder="https://hooks.zapier.com/hooks/catch/…"
                />
              </Field>
              <Field label="Redirect URL *" hint="Where the user is sent after a successful submission.">
                <input
                  required
                  value={form.redirect_url}
                  onChange={(e) => update('redirect_url', e.target.value)}
                  className={input}
                  placeholder="https://your-site.com/thank-you"
                />
              </Field>
              <Field label="Notes" hint="Optional reference notes — not shown to users.">
                <textarea
                  rows={3}
                  value={form.admin_notes}
                  onChange={(e) => update('admin_notes', e.target.value)}
                  className={`${input} resize-y`}
                  placeholder="Optional notes about this form…"
                />
              </Field>
            </>
          )}

          {!isSmartForm && (
            <Field label="Result Strategy *" hint="Controls how the result is generated after scoring.">
              <select
                value={form.result_strategy}
                onChange={(e) => update('result_strategy', e.target.value)}
                className={input}
              >
                {RESULT_STRATEGY_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
              <p className="text-xs text-gray-400 mt-1">
                {RESULT_STRATEGY_OPTIONS.find((s) => s.value === form.result_strategy)?.description}
              </p>
            </Field>
          )}
        </section>

        {/* Migration Assistant — prominent for never-configured tools, on demand otherwise */}
        {!isSmartForm && !needsMigrationAssistant && !assistantOpen && !draft && (
          <button
            type="button"
            onClick={() => setAssistantOpen(true)}
            className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-indigo-600"
          >
            <Wrench size={13} /> Open Migration Assistant (review or rebuild answer → outcome mappings)
          </button>
        )}

        {!isSmartForm && (needsMigrationAssistant || assistantOpen || draft) && (
          <section className="bg-amber-50 border border-amber-200 rounded-2xl p-4 sm:p-6 space-y-4">
            <div className="flex items-start gap-2.5">
              <AlertTriangle size={16} className="text-amber-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-amber-800">
                  {needsMigrationAssistant ? 'This tool is missing result configuration.' : 'Migration Assistant'}
                </p>
                <p className="text-xs text-amber-700 mt-0.5">
                  Builds a scored result configuration from this tool&apos;s existing questions. The tool ID, question IDs, option wording and existing submissions are kept as they are.
                  {questions.length === 0 && ' Add questions to this tool first — the assistant reads your existing questions and options.'}
                </p>
              </div>
            </div>

            {!draft && (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={generateDraftResultConfig}
                  disabled={inferring || questions.length === 0}
                  className="inline-flex items-center gap-2 bg-amber-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {inferring ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
                  {inferring ? 'Analyzing existing questions…' : 'Generate Draft Result Config'}
                </button>
                <button
                  type="button"
                  onClick={startManualDraft}
                  disabled={questions.length === 0}
                  className="px-4 py-2 text-sm text-amber-800 border border-amber-300 rounded-lg hover:bg-amber-100 disabled:opacity-50"
                >
                  Edit current mappings by hand
                </button>
                {assistantOpen && (
                  <button type="button" onClick={() => setAssistantOpen(false)} className="px-3 py-2 text-sm text-amber-700">
                    Close
                  </button>
                )}
              </div>
            )}

            {draftError && (
              <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{draftError}</p>
            )}

            {draft && draftParsed && (
              <div className="space-y-4">
                <div className="bg-amber-100 border border-amber-200 rounded-lg px-3 py-2">
                  <p className="text-xs font-semibold text-amber-800">Draft — review before saving.</p>
                  <p className="text-xs text-amber-700 mt-0.5">
                    Inferred only from this tool&apos;s existing questions and options. This is <strong>not</strong> confirmed FormWise copy or scoring — check every mapping and outcome below.
                  </p>
                </div>

                {/* Option → category mapping review */}
                <div className="bg-white border border-amber-100 rounded-xl p-4 space-y-4">
                  <p className="text-sm font-semibold text-gray-800">1. Answer → outcome mapping</p>
                  {draft.option_mappings.length === 0 && (
                    <p className="text-xs text-gray-500">No multiple-choice questions to map.</p>
                  )}
                  {draft.option_mappings.map((m, qi) => (
                    <div key={m.question_id} className="space-y-1.5">
                      <p className="text-xs font-medium text-gray-700">Q{qi + 1}. {m.question_label}</p>
                      {m.options.map((o, oi) => (
                        <div key={oi} className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_200px] gap-1 sm:gap-2 sm:items-center">
                          <span className="text-xs text-gray-600 min-w-0 break-words">{o.label}</span>
                          <select
                            aria-label={`Category for ${o.label}`}
                            value={o.category ?? ''}
                            onChange={(e) => setMapping(m.question_id, oi, e.target.value || null)}
                            className={`border rounded-lg px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-amber-500 ${
                              o.category ? 'border-gray-200' : 'border-red-200 bg-red-50'
                            }`}
                          >
                            <option value="">— not scored —</option>
                            {Array.from(new Set([...draftParsed.categoryChoices, ...(o.category ? [o.category] : [])])).map((c) => (
                              <option key={c} value={c}>{c}</option>
                            ))}
                          </select>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>

                {/* Outcomes + scoring JSON */}
                <div className="bg-white border border-amber-100 rounded-xl p-4 space-y-3">
                  <p className="text-sm font-semibold text-gray-800">2. Outcomes, scoring and AI instructions</p>
                  <Field label="Result strategy">
                    <select
                      value={draft.result_strategy}
                      onChange={(e) => setDraft((d) => d && ({ ...d, result_strategy: e.target.value as ResultStrategy }))}
                      className={input}
                    >
                      <option value="hybrid_ai_with_outcome">Hybrid — Outcome + AI Personalisation</option>
                      <option value="structured_outcome">Structured Outcome (no AI)</option>
                    </select>
                  </Field>
                  <Field label="Scoring Config (JSON)" hint='Category order here decides ties (earlier wins), unless you add "tie_breaker": "tie_outcome" with a "tie_outcome_id".'>
                    <textarea
                      rows={5}
                      value={draft.scoring_config}
                      onChange={(e) => setDraft((d) => d && ({ ...d, scoring_config: e.target.value }))}
                      className={`${input} resize-y font-mono text-xs`}
                      spellCheck={false}
                    />
                  </Field>
                  <Field label="Result Config (JSON)" hint="Outcome titles, descriptions, recommendations, CTA text and CTA URLs.">
                    <textarea
                      rows={14}
                      value={draft.result_config}
                      onChange={(e) => setDraft((d) => d && ({ ...d, result_config: e.target.value }))}
                      className={`${input} resize-y font-mono text-xs`}
                      spellCheck={false}
                    />
                  </Field>
                  {draft.result_strategy === 'hybrid_ai_with_outcome' && (
                    <Field label="Result Template (AI personalisation instructions)">
                      <textarea
                        rows={4}
                        value={draft.result_template}
                        onChange={(e) => setDraft((d) => d && ({ ...d, result_template: e.target.value }))}
                        className={`${input} resize-y`}
                      />
                    </Field>
                  )}
                </div>

                {/* Validation */}
                {draftParsed.validation.errors.length > 0 && (
                  <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2.5">
                    <p className="text-xs font-medium text-red-700 mb-1">Must fix before saving:</p>
                    <ul className="text-xs text-red-600 list-disc list-inside space-y-0.5">
                      {draftParsed.validation.errors.map((e, i) => <li key={i}>{e}</li>)}
                    </ul>
                  </div>
                )}
                {draftParsed.validation.warnings.length > 0 && (
                  <div className="bg-white border border-amber-100 rounded-lg px-3 py-2.5">
                    <p className="text-xs font-medium text-amber-700 mb-1">Worth a look:</p>
                    <ul className="text-xs text-amber-600 list-disc list-inside space-y-0.5">
                      {draftParsed.validation.warnings.map((w, i) => <li key={i}>{w}</li>)}
                    </ul>
                  </div>
                )}

                {/* 3. Test before saving */}
                {draftParsed.scoring && draftParsed.result && (
                  <TestOutcomeMapping
                    questions={draftParsed.mergedQuestions}
                    scoringConfig={draftParsed.scoring}
                    resultConfig={draftParsed.result}
                    resultStrategy={draft.result_strategy}
                    defaultOpen
                  />
                )}

                <label className="flex items-start gap-2 text-sm text-amber-900 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draftReviewed}
                    onChange={(e) => setDraftReviewed(e.target.checked)}
                    className="accent-amber-600 mt-0.5"
                  />
                  I have reviewed every mapping and outcome above and tested sample answers.
                </label>

                <div className="flex flex-col sm:flex-row gap-2">
                  <button
                    type="button"
                    onClick={saveMigration}
                    disabled={applying || !draftReviewed || draftParsed.validation.errors.length > 0}
                    className="flex-1 bg-amber-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors inline-flex items-center justify-center gap-2"
                  >
                    {applying && <Loader2 size={14} className="animate-spin" />}
                    Save Result Configuration
                  </button>
                  <button
                    type="button"
                    onClick={() => { setDraft(null); setDraftError(null); setAssistantOpen(false); }}
                    className="px-4 py-2.5 text-sm text-amber-700 border border-amber-200 rounded-lg hover:bg-amber-100 transition-colors"
                  >
                    Discard
                  </button>
                </div>
                <p className="text-xs text-amber-600">
                  Saving updates this tool&apos;s result configuration and the category on each existing option. It does not publish the tool.
                </p>
              </div>
            )}
          </section>
        )}

        {/* Scoring config */}
        {!isSmartForm && needsScoring && (
          <section className="bg-white rounded-2xl border border-gray-100 p-6 space-y-4">
            <div>
              <h2 className="font-semibold text-gray-800">Scoring Config</h2>
              <p className="text-xs text-gray-400 mt-0.5">
                Defines how quiz answers are scored. Use <code>category</code> type to count option categories, or <code>points</code> to sum numeric scores.
              </p>
            </div>

            <Field label="Scoring Config (JSON) *">
              <textarea
                rows={5}
                value={form.scoring_config}
                onChange={(e) => update('scoring_config', e.target.value)}
                className={`${input} resize-y font-mono text-xs`}
                placeholder={SCORING_CONFIG_PLACEHOLDER}
              />
            </Field>

            <Field label="Result Config (JSON) *" hint="List of possible outcomes with match rules, descriptions, and recommendations.">
              <textarea
                rows={14}
                value={form.result_config}
                onChange={(e) => update('result_config', e.target.value)}
                className={`${input} resize-y font-mono text-xs`}
                placeholder={RESULT_CONFIG_PLACEHOLDER}
              />
            </Field>

            {liveValidation.errors.length > 0 && (
              <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2.5">
                <p className="text-xs font-medium text-red-700 mb-1">Must fix before this will work:</p>
                <ul className="text-xs text-red-600 list-disc list-inside space-y-0.5">
                  {liveValidation.errors.map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              </div>
            )}
            {liveValidation.warnings.length > 0 && (
              <div className="bg-amber-50 border border-amber-100 rounded-lg px-3 py-2.5">
                <p className="text-xs font-medium text-amber-700 mb-1">Worth a look (won&apos;t block saving):</p>
                <ul className="text-xs text-amber-600 list-disc list-inside space-y-0.5">
                  {liveValidation.warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              </div>
            )}

            {liveConfigs && questions.length > 0 && (
              <TestOutcomeMapping
                questions={questions}
                scoringConfig={liveConfigs.scoring}
                resultConfig={liveConfigs.result}
                resultStrategy={strategy}
                toolId={id}
              />
            )}
          </section>
        )}

        {/* AI prompt / result template */}
        {!isSmartForm && (
          <section className="bg-white rounded-2xl border border-gray-100 p-6 space-y-4">
            <div>
              <h2 className="font-semibold text-gray-800">AI Prompt</h2>
              <p className="text-xs text-gray-400 mt-0.5">
                {strategy === 'structured_outcome'
                  ? 'Not used for Structured Outcome — the result comes from your Result Config above.'
                  : strategy === 'hybrid_ai_with_outcome'
                  ? 'Result Template: instructs the AI how to personalise the calculated outcome. Do not describe new result types.'
                  : 'System Prompt / Result Template: tells the AI what to write and how to personalise the result.'}
              </p>
            </div>

            {strategy !== 'structured_outcome' && (
              <>
                <Field
                  label={strategy === 'hybrid_ai_with_outcome' ? 'Result Template' : 'System Prompt'}
                  hint={
                    strategy === 'hybrid_ai_with_outcome'
                      ? 'Instructions for personalising the calculated outcome. The outcome type is fixed — the AI only personalises it.'
                      : 'The AI uses this to generate the personalised result.'
                  }
                >
                  <textarea
                    rows={6}
                    value={strategy === 'hybrid_ai_with_outcome' ? form.result_template : form.system_prompt}
                    onChange={(e) => {
                      if (strategy === 'hybrid_ai_with_outcome') {
                        update('result_template', e.target.value);
                      } else {
                        update('system_prompt', e.target.value);
                      }
                    }}
                    className={`${input} resize-y`}
                    placeholder={
                      strategy === 'hybrid_ai_with_outcome'
                        ? 'Write a warm, personalised 2-3 paragraph result for this person based on their specific answers. Stay within their determined type. Do not suggest other types.'
                        : 'You are an expert wellness educator. Based on the responses below, provide a thoughtful educational summary about…'
                    }
                  />
                </Field>

                {strategy === 'ai_generated' && (
                  <Field label="Result Template (optional)" hint="Overrides the System Prompt for generating results. Use this for more structured output instructions.">
                    <textarea
                      rows={4}
                      value={form.result_template}
                      onChange={(e) => update('result_template', e.target.value)}
                      className={`${input} resize-y`}
                      placeholder="Optional — if set, this is used instead of the System Prompt when generating results."
                    />
                  </Field>
                )}
              </>
            )}

            <Field label="Admin Notes (internal)" hint="Not shown to users. For team reference only.">
              <textarea
                rows={2}
                value={form.admin_notes}
                onChange={(e) => update('admin_notes', e.target.value)}
                className={`${input} resize-y`}
                placeholder="e.g. Bendy Menopause Type Quiz v2 — category scoring"
              />
            </Field>
          </section>
        )}

        {/* Provider branding */}
        <section className="bg-white rounded-2xl border border-gray-100 p-6 space-y-4">
          <div>
            <h2 className="font-semibold text-gray-800">Provider / Branding</h2>
            <p className="text-xs text-gray-400 mt-0.5">Shown on the public quiz page. Leave blank to use generic branding.</p>
          </div>

          <Field label="Provider / Brand Name">
            <input
              value={form.provider_name}
              onChange={(e) => update('provider_name', e.target.value)}
              className={input}
              placeholder="e.g. Phases Clinic, Bendy Health"
            />
          </Field>

          <Field label="Logo URL" hint="Direct URL to an image file (PNG/SVG). Optional.">
            <input
              value={form.provider_logo_url}
              onChange={(e) => update('provider_logo_url', e.target.value)}
              className={input}
              placeholder="https://your-site.com/logo.png"
            />
          </Field>

          <Field label="Primary Color" hint="Hex colour code. Optional — defaults to indigo.">
            <div className="flex items-center gap-2">
              <input
                value={form.primary_color}
                onChange={(e) => update('primary_color', e.target.value)}
                className={`${input} flex-1`}
                placeholder="#4f46e5"
              />
              {form.primary_color && /^#[0-9a-fA-F]{6}$/.test(form.primary_color) && (
                <div
                  className="w-8 h-8 rounded-lg border border-gray-200 flex-shrink-0"
                  style={{ backgroundColor: form.primary_color }}
                />
              )}
            </div>
          </Field>
        </section>

        {/* Lead capture */}
        <section className="bg-white rounded-2xl border border-gray-100 p-6 space-y-3">
          <h2 className="font-semibold text-gray-800">Lead Capture</h2>
          <Toggle label="Require email"         checked={form.email_capture_enabled} onChange={setEmailCapture} />
          <Toggle label="Capture phone number"  checked={form.phone_capture_enabled} onChange={setPhoneCapture} />
        </section>

        {/* GHL */}
        {!isSmartForm && (
          <section className="bg-white rounded-2xl border border-gray-100 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-gray-800">GoHighLevel Integration</h2>
              <Toggle label="" checked={form.ghl_enabled} onChange={setGhlEnabled} />
            </div>
            {form.ghl_enabled && (
              <>
                <Field label="Webhook URL">
                  <input
                    value={form.ghl_webhook_url}
                    onChange={(e) => update('ghl_webhook_url', e.target.value)}
                    className={input}
                    placeholder="https://hooks.zapier.com/…"
                  />
                </Field>
                <Field label="Tag">
                  <input
                    value={form.ghl_tag}
                    onChange={(e) => update('ghl_tag', e.target.value)}
                    className={input}
                    placeholder="e.g. hormone-assessment"
                  />
                </Field>
              </>
            )}
          </section>
        )}

        <button
          type="submit"
          disabled={saving}
          className="w-full bg-indigo-600 text-white py-3 rounded-xl font-semibold hover:bg-indigo-700 disabled:opacity-60 transition-colors"
        >
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </form>
    </div>
  );
}

// ── helpers ───────────────────────────────────────────────────────────────────

const input =
  'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500';

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {hint && <p className="text-xs text-gray-400 mb-1">{hint}</p>}
      {children}
    </div>
  );
}

const Toggle = memo(function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-3 cursor-pointer select-none">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
          checked ? 'bg-indigo-600' : 'bg-gray-200'
        }`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-[18px]' : 'translate-x-[3px]'
          }`}
        />
      </button>
      {label && <span className="text-sm text-gray-700">{label}</span>}
    </label>
  );
});
