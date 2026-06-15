'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { ArrowLeft } from 'lucide-react';
import { slugify } from '@/lib/utils';

const input = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500';

export default function NewWorkspacePage() {
  const router  = useRouter();
  const [saving, setSaving] = useState(false);
  const [form, setForm]     = useState({
    name:            '',
    logo_url:        '',
    primary_color:   '',
    ghl_webhook_url: '',
    ghl_tag:         '',
  });

  function update(key: string, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);

    const res  = await fetch('/api/admin/workspaces', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        name:            form.name,
        logo_url:        form.logo_url        || null,
        primary_color:   form.primary_color   || null,
        ghl_webhook_url: form.ghl_webhook_url || null,
        ghl_tag:         form.ghl_tag         || null,
      }),
    });
    const json = await res.json();
    setSaving(false);

    if (!res.ok) { toast.error(json.error ?? 'Failed to create workspace'); return; }
    toast.success('Workspace created!');
    router.push(`/admin/workspaces/${json.workspace.id}`);
  }

  return (
    <div className="max-w-xl">
      <Link
        href="/admin/workspaces"
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-6 transition-colors"
      >
        <ArrowLeft size={15} /> Back to Workspaces
      </Link>

      <h1 className="text-2xl font-bold text-gray-900 mb-1">New Workspace</h1>
      <p className="text-sm text-gray-500 mb-8">Create a workspace for a provider admin team.</p>

      <form onSubmit={submit} className="space-y-6">
        <section className="bg-white rounded-2xl border border-gray-100 p-6 space-y-4">
          <h2 className="font-semibold text-gray-800">Basic Info</h2>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Workspace Name *</label>
            <input
              required
              value={form.name}
              onChange={(e) => update('name', e.target.value)}
              className={input}
              placeholder="e.g. Vitality Health"
            />
            {form.name && (
              <p className="text-xs text-gray-400 mt-1">Slug: {slugify(form.name)}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Logo URL</label>
            <input
              value={form.logo_url}
              onChange={(e) => update('logo_url', e.target.value)}
              className={input}
              placeholder="https://example.com/logo.png"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Primary Colour</label>
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
          </div>
        </section>

        <section className="bg-white rounded-2xl border border-gray-100 p-6 space-y-4">
          <h2 className="font-semibold text-gray-800">GoHighLevel (optional)</h2>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Webhook URL</label>
            <input
              value={form.ghl_webhook_url}
              onChange={(e) => update('ghl_webhook_url', e.target.value)}
              className={input}
              placeholder="https://hooks.zapier.com/…"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Default Tag</label>
            <input
              value={form.ghl_tag}
              onChange={(e) => update('ghl_tag', e.target.value)}
              className={input}
              placeholder="e.g. vitality-assessment"
            />
          </div>
        </section>

        <button
          type="submit"
          disabled={saving}
          className="w-full bg-indigo-600 text-white py-3 rounded-xl font-semibold hover:bg-indigo-700 disabled:opacity-60 transition-colors"
        >
          {saving ? 'Creating…' : 'Create Workspace →'}
        </button>
      </form>
    </div>
  );
}
