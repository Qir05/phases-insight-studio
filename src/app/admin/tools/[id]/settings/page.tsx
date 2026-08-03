'use client';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { slugify } from '@/lib/utils';
import { ArrowLeft, ExternalLink, List, Users, AlertTriangle, Sparkles, Loader2 } from 'lucide-react';
import type { ResultStrategy, ScoringConfig, ResultConfig, Tool, Question } from '@/lib/supabase';
import { validateResultConfig } from '@/lib/resultConfigValidation';

type ToolMode = 'ai_result' | 'smartform_redirect';

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

  // ── Migration Assistant (draft result config inferred from existing questions) ──
  const [inferring,    setInferring]    = useState(false);
  const [draftPreview, setDraftPreview] = useState<string | null>(null);
  const [draftError,   setDraftError]   = useState<string | null>(null);

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

  async function generateDraftResultConfig() {
    setInferring(true);
    setDraftError(null);
    const res  = await fetch(`/api/admin/tools/${id}/infer-result-config`, { method: 'POST' });
    const json = await res.json().catch(() => ({})) as { draft?: unknown; error?: string };
    setInferring(false);

    if (!res.ok || !json.draft) {
      setDraftError(json.error ?? 'Failed to generate a draft. Please try again.');
      return;
    }
    setDraftPreview(JSON.stringify(json.draft, null, 2));
  }

  function applyDraftToForm() {
    if (!draftPreview) return;
    let draft: { scoring_config?: unknown; result_config?: unknown; result_template?: string };
    try {
      draft = JSON.parse(draftPreview);
    } catch {
      setDraftError('The draft JSON is not valid — fix any syntax errors before applying.');
      return;
    }

    setForm((f) => ({
      ...f,
      result_strategy: 'hybrid_ai_with_outcome',
      scoring_config:  draft.scoring_config  ? JSON.stringify(draft.scoring_config, null, 2) : f.scoring_config,
      result_config:   draft.result_config   ? JSON.stringify(draft.result_config,  null, 2) : f.result_config,
      result_template: draft.result_template ?? f.result_template,
    }));
    setDraftPreview(null);
    setDraftError(null);
    toast.success('Draft applied below — review it, then click Save Changes to publish.');
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);

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
    const json = await res.json().catch(() => ({})) as { tool?: Tool; error?: string };
    setSaving(false);

    if (!res.ok) {
      setSaveError(json.error ?? 'Failed to save settings');
      toast.error(json.error ?? 'Failed to save settings');
      return;
    }

    toast.success('Settings saved');
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

      <div className="flex items-start justify-between mb-6 gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-gray-900 truncate">{tool?.title}</h1>
          <p className="text-sm text-gray-500 mt-0.5">Tool Settings</p>
        </div>
        {tool && (
          <div className="flex items-center gap-2 flex-shrink-0">
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
              href={`/t/${tool.slug}`}
              target="_blank"
              className="inline-flex items-center gap-1 text-xs border border-gray-200 rounded-lg px-3 py-1.5 text-gray-500 hover:text-indigo-600 transition-colors"
            >
              <ExternalLink size={13} /> Preview
            </Link>
          </div>
        )}
      </div>

      {saveError && (
        <div className="bg-red-50 border border-red-100 rounded-2xl px-4 py-3 text-sm text-red-700 mb-6">
          {saveError}
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

        {/* Migration Assistant — only for tools that have never been configured */}
        {needsMigrationAssistant && (
          <section className="bg-amber-50 border border-amber-200 rounded-2xl p-6 space-y-4">
            <div className="flex items-start gap-2.5">
              <AlertTriangle size={16} className="text-amber-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-amber-800">This tool is missing result configuration.</p>
                <p className="text-xs text-amber-700 mt-0.5">
                  It will fall back to plain AI text (or a config error) until a result strategy is set up.
                  {questions.length === 0 && ' Add questions to this tool first — the assistant reads your existing questions and options.'}
                </p>
              </div>
            </div>

            {!draftPreview && (
              <button
                type="button"
                onClick={generateDraftResultConfig}
                disabled={inferring || questions.length === 0}
                className="inline-flex items-center gap-2 bg-amber-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {inferring ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
                {inferring ? 'Analyzing existing questions…' : 'Generate Draft Result Config'}
              </button>
            )}

            {draftError && (
              <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{draftError}</p>
            )}

            {draftPreview && (
              <div className="space-y-3">
                <div className="bg-amber-100 border border-amber-200 rounded-lg px-3 py-2">
                  <p className="text-xs font-semibold text-amber-800">Draft — review before publishing.</p>
                  <p className="text-xs text-amber-700 mt-0.5">
                    Inferred only from this tool&apos;s existing questions and options. This is <strong>not</strong> confirmed FormWise copy — read it carefully, edit anything wrong, and only then apply it below.
                  </p>
                </div>
                <textarea
                  rows={16}
                  value={draftPreview}
                  onChange={(e) => setDraftPreview(e.target.value)}
                  className="w-full border border-amber-200 rounded-xl px-4 py-3 text-xs font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-amber-500 resize-y bg-white"
                  spellCheck={false}
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={applyDraftToForm}
                    className="flex-1 bg-amber-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-amber-700 transition-colors"
                  >
                    Apply to Form Below
                  </button>
                  <button
                    type="button"
                    onClick={() => { setDraftPreview(null); setDraftError(null); }}
                    className="px-4 py-2 text-sm text-amber-700 border border-amber-200 rounded-lg hover:bg-amber-100 transition-colors"
                  >
                    Discard
                  </button>
                </div>
                <p className="text-xs text-amber-600">
                  Applying only fills in the fields below — nothing is saved until you click <strong>Save Changes</strong> at the bottom of this page.
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
