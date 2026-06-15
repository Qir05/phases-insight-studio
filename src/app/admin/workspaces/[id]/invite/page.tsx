'use client';
import { useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Copy, CheckCircle } from 'lucide-react';
import { toast } from 'sonner';

export default function InvitePage() {
  const { id }  = useParams<{ id: string }>();
  const [email,     setEmail]     = useState('');
  const [sending,   setSending]   = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copied,    setCopied]    = useState(false);

  async function sendInvite(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    setInviteUrl(null);

    const res  = await fetch(`/api/admin/workspaces/${id}/invite`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email }),
    });
    const json = await res.json() as { invite_url?: string; error?: string };
    setSending(false);

    if (!res.ok) {
      toast.error(json.error ?? 'Failed to send invitation.');
      return;
    }

    setInviteUrl(json.invite_url ?? null);
    toast.success('Invitation created!');
    setEmail('');
  }

  function copyLink() {
    if (!inviteUrl) return;
    navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    toast.success('Link copied!');
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="max-w-xl">
      <div className="flex items-center gap-3 mb-6">
        <Link
          href={`/admin/workspaces/${id}/users`}
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors"
        >
          <ArrowLeft size={15} /> Back to Users
        </Link>
      </div>

      <h1 className="text-2xl font-bold text-gray-900 mb-1">Invite Provider Admin</h1>
      <p className="text-sm text-gray-500 mb-8">
        Enter the email address of the admin you want to invite. They&apos;ll receive a link
        to create their account and access this workspace.
      </p>

      <div className="bg-white rounded-2xl border border-gray-100 p-6">
        <form onSubmit={sendInvite} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Email Address
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="provider@example.com"
            />
          </div>

          <button
            type="submit"
            disabled={sending}
            className="w-full bg-indigo-600 text-white py-2.5 rounded-lg font-medium text-sm hover:bg-indigo-700 disabled:opacity-60 transition-colors"
          >
            {sending ? 'Creating invite…' : 'Generate Invite Link'}
          </button>
        </form>

        {inviteUrl && (
          <div className="mt-6 pt-6 border-t border-gray-100">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle size={16} className="text-green-500" />
              <p className="text-sm font-semibold text-gray-800">Invite link ready</p>
            </div>
            <p className="text-xs text-gray-500 mb-3">
              Share this link with the invited admin. It expires in 7 days.
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
