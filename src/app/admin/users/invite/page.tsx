'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Copy, CheckCircle } from 'lucide-react';
import { toast } from 'sonner';
import type { Workspace } from '@/lib/supabase';

const input = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500';

export default function InviteAdminPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [form, setForm] = useState({
    email:        '',
    full_name:    '',
    role:         'provider_admin' as 'super_admin' | 'provider_admin',
    workspace_id: '',
  });
  const [sending,   setSending]   = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copied,    setCopied]    = useState(false);

  const loadWorkspaces = useCallback(async () => {
    const res  = await fetch('/api/admin/workspaces');
    const json = await res.json() as { workspaces?: Workspace[] };
    setWorkspaces(json.workspaces ?? []);
  }, []);

  useEffect(() => { loadWorkspaces(); }, [loadWorkspaces]);

  async function sendInvite(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    setInviteUrl(null);

    const res  = await fetch('/api/admin/users/invite', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        email:        form.email,
        full_name:    form.full_name || null,
        role:         form.role,
        workspace_id: form.role === 'provider_admin' ? form.workspace_id || null : null,
      }),
    });
    const json = await res.json() as { invite_url?: string; error?: string };
    setSending(false);

    if (!res.ok) {
      toast.error(json.error ?? 'Failed to create invitation.');
      return;
    }

    setInviteUrl(json.invite_url ?? null);
    toast.success('Invitation created!');
    setForm((f) => ({ ...f, email: '', full_name: '', workspace_id: '' }));
  }

  function copyLink() {
    if (!inviteUrl) return;
    navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    toast.success('Link copied!');
    setTimeout(() => setCopied(false), 2000);
  }

  const needsWorkspace = form.role === 'provider_admin';

  return (
    <div className="max-w-xl">
      <Link
        href="/admin/users"
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-6 transition-colors"
      >
        <ArrowLeft size={15} /> Back to Users
      </Link>

      <h1 className="text-2xl font-bold text-gray-900 mb-1">Invite Admin</h1>
      <p className="text-sm text-gray-500 mb-8">
        The invited user will receive a link to create their account.
        No Supabase setup required for them.
      </p>

      <div className="bg-white rounded-2xl border border-gray-100 p-6 space-y-5">
        <form onSubmit={sendInvite} className="space-y-4">
          {/* Email */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Email Address *
            </label>
            <input
              type="email"
              required
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              className={input}
              placeholder="admin@example.com"
            />
          </div>

          {/* Full name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Full Name <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={form.full_name}
              onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
              className={input}
              placeholder="Jane Smith"
            />
          </div>

          {/* Role */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Role *</label>
            <select
              value={form.role}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  role: e.target.value as 'super_admin' | 'provider_admin',
                  workspace_id: '',
                }))
              }
              className={input}
            >
              <option value="provider_admin">Provider Admin — scoped to one workspace</option>
              <option value="super_admin">Super Admin — full platform access</option>
            </select>
            {form.role === 'super_admin' && (
              <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2 mt-2">
                Super admins can see all workspaces, tools, and submissions, and can invite other admins.
              </p>
            )}
          </div>

          {/* Workspace — only for provider_admin */}
          {needsWorkspace && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Workspace *
              </label>
              <select
                required={needsWorkspace}
                value={form.workspace_id}
                onChange={(e) => setForm((f) => ({ ...f, workspace_id: e.target.value }))}
                className={input}
              >
                <option value="">Select a workspace…</option>
                {workspaces.map((ws) => (
                  <option key={ws.id} value={ws.id}>{ws.name}</option>
                ))}
              </select>
              {workspaces.length === 0 && (
                <p className="text-xs text-gray-400 mt-1">
                  No workspaces yet.{' '}
                  <Link href="/admin/workspaces/new" className="text-indigo-600 hover:underline">
                    Create one first
                  </Link>.
                </p>
              )}
            </div>
          )}

          <button
            type="submit"
            disabled={sending || (needsWorkspace && !form.workspace_id)}
            className="w-full bg-indigo-600 text-white py-2.5 rounded-lg font-medium text-sm hover:bg-indigo-700 disabled:opacity-60 transition-colors"
          >
            {sending ? 'Creating invite…' : 'Generate Invite Link'}
          </button>
        </form>

        {/* Invite link result */}
        {inviteUrl && (
          <div className="pt-5 border-t border-gray-100">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle size={16} className="text-green-500" />
              <p className="text-sm font-semibold text-gray-800">Invite link ready</p>
            </div>
            <p className="text-xs text-gray-500 mb-3">
              Share this link with the invited admin. It expires in 7 days and can only be used once.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 break-all text-gray-600">
                {inviteUrl}
              </code>
              <button
                onClick={copyLink}
                className="flex-shrink-0 p-2 border border-gray-200 rounded-lg text-gray-500 hover:text-indigo-600 hover:border-indigo-300 transition-colors"
                title="Copy link"
              >
                <Copy size={15} className={copied ? 'text-green-500' : ''} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
