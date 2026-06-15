'use client';
import { memo, useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { slugify } from '@/lib/utils';
import { ArrowLeft } from 'lucide-react';

export default function NewToolPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    title:                  '',
    description:            '',
    system_prompt:          '',
    email_capture_enabled:  true,
    phone_capture_enabled:  false,
    ghl_enabled:            false,
    ghl_webhook_url:        '',
    ghl_tag:                '',
    provider_name:          '',
    provider_logo_url:      '',
    primary_color:          '',
  });

  const update = useCallback((key: string, value: string | boolean) => {
    setForm((f) => ({ ...f, [key]: value }));
  }, []);

  const setEmailCapture = useCallback((v: boolean) => update('email_capture_enabled', v), [update]);
  const setPhoneCapture = useCallback((v: boolean) => update('phone_capture_enabled', v), [update]);
  const setGhlEnabled   = useCallback((v: boolean) => update('ghl_enabled', v), [update]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const res = await fetch('/api/admin/tools', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        provider_name:     form.provider_name     || null,
        provider_logo_url: form.provider_logo_url || null,
        primary_color:     form.primary_color     || null,
      }),
    });
    const json = await res.json();
    setSaving(false);
    if (!res.ok) {
      toast.error(json.error ?? 'Failed to create tool');
      return;
    }
    toast.success('Tool created!');
    router.push(`/admin/tools/${json.tool.id}/questions`);
  }

  return (
    <div className="max-w-2xl">
      {/* Back */}
      <Link
        href="/admin"
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-6 transition-colors"
      >
        <ArrowLeft size={15} /> Back to Dashboard
      </Link>

      <h1 className="text-2xl font-bold text-gray-900 mb-1">Create New Tool</h1>
      <p className="text-sm text-gray-500 mb-8">Set up your AI assessment questionnaire.</p>

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
              placeholder="e.g. Hormone Health Check"
            />
            {form.title && (
              <p className="text-xs text-gray-400 mt-1">Slug: /t/{slugify(form.title)}</p>
            )}
          </Field>

          <Field label="Description">
            <input
              value={form.description}
              onChange={(e) => update('description', e.target.value)}
              className={input}
              placeholder="Short description shown to users"
            />
          </Field>

          <Field label="System Prompt *" hint="This is used as the AI context for generating results.">
            <textarea
              required
              rows={6}
              value={form.system_prompt}
              onChange={(e) => update('system_prompt', e.target.value)}
              className={`${input} resize-y`}
              placeholder="You are an expert wellness educator. Based on the responses below, provide a thoughtful educational summary about…"
            />
          </Field>
        </section>

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
              placeholder="e.g. Phases Clinic, Vitality Health"
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

        <button
          type="submit"
          disabled={saving}
          className="w-full bg-indigo-600 text-white py-3 rounded-xl font-semibold hover:bg-indigo-700 disabled:opacity-60 transition-colors"
        >
          {saving ? 'Creating…' : 'Create Tool & Add Questions →'}
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
