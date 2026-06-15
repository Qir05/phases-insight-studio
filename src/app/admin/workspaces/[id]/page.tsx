'use client';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { ArrowLeft, Users, Mail, Building2 } from 'lucide-react';
import type { Workspace } from '@/lib/supabase';

const input = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500';

export default function WorkspaceDetailPage() {
  const { id }  = useParams<{ id: string }>();
  const [ws,      setWs]      = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [form,    setForm]    = useState({
    name:            '',
    logo_url:        '',
    primary_color:   '',
    ghl_webhook_url: '',
    ghl_tag:         '',
  });

  const load = useCallback(async () => {
    const res  = await fetch(`/api/admin/workspaces/${id}`);
    const json = await res.json() as { workspace?: Workspace };
    if (json.workspace) {
      setWs(json.workspace);
      setForm({
        name:            json.workspace.name            ?? '',
        logo_url:        json.workspace.logo_url        ?? '',
        primary_color:   json.workspace.primary_color   ?? '',
        ghl_webhook_url: json.workspace.ghl_webhook_url ?? '',
        ghl_tag:         json.workspace.ghl_tag         ?? '',
      });
    }
    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const res  = await fetch(`/api/admin/workspaces/${id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        name:            form.name            || undefined,
        logo_url:        form.logo_url        || null,
        primary_color:   form.primary_color   || null,
        ghl_webhook_url: form.ghl_webhook_url || null,
        ghl_tag:         form.ghl_tag         || null,
      }),
    });
    setSaving(false);
    if (res.ok) { toast.success('Workspace saved.'); load(); }
    else        { const j = await res.json(); toast.error(j.error ?? 'Failed to save'); }
  }

  if (loading) {
    return <div className="max-w-xl animate-pulse space-y-4">
      <div className="h-6 bg-gray-100 rounded w-40" />
      <div className="h-48 bg-gray-100 rounded-2xl" />
    </div>;
  }

  return (
    <div className="max-w-xl">
      <Link
        href="/admin/workspaces"
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-6 transition-colors"
      >
        <ArrowLeft size={15} /> All Workspaces
      </Link>

      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Building2 size={20} className="text-indigo-500" />
            <h1 className="text-2xl font-bold text-gray-900">{ws?.name}</h1>
          </div>
          <p className="text-sm text-gray-400">/{ws?.slug}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/admin/workspaces/${id}/users`}
            className="inline-flex items-center gap-1.5 text-sm border border-gray-200 rounded-lg px-3 py-2 text-gray-500 hover:text-indigo-600 hover:border-indigo-300 transition-colors"
          >
            <Users size={14} /> Users
          </Link>
          <Link
            href={`/admin/workspaces/${id}/invite`}
            className="inline-flex items-center gap-1.5 text-sm bg-indigo-600 text-white rounded-lg px-3 py-2 hover:bg-indigo-700 transition-colors"
          >
            <Mail size={14} /> Invite Admin
          </Link>
        </div>
      </div>

      <form onSubmit={save} className="space-y-6">
        <section className="bg-white rounded-2xl border border-gray-100 p-6 space-y-4">
          <h2 className="font-semibold text-gray-800">Workspace Settings</h2>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
            <input
              required
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className={input}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Logo URL</label>
            <input
              value={form.logo_url}
              onChange={(e) => setForm((f) => ({ ...f, logo_url: e.target.value }))}
              className={input}
              placeholder="https://example.com/logo.png"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Primary Colour</label>
            <div className="flex items-center gap-2">
              <input
                value={form.primary_color}
                onChange={(e) => setForm((f) => ({ ...f, primary_color: e.target.value }))}
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

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">GHL Webhook URL</label>
            <input
              value={form.ghl_webhook_url}
              onChange={(e) => setForm((f) => ({ ...f, ghl_webhook_url: e.target.value }))}
              className={input}
              placeholder="https://hooks.zapier.com/…"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">GHL Default Tag</label>
            <input
              value={form.ghl_tag}
              onChange={(e) => setForm((f) => ({ ...f, ghl_tag: e.target.value }))}
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
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </form>
    </div>
  );
}
