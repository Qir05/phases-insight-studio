'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';
import Logo from '@/components/Logo';

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

interface InviteInfo {
  email:          string;
  full_name:      string | null;
  role:           'super_admin' | 'provider_admin';
  workspace_name: string | null;
}

export default function AcceptInvitePage() {
  const { token } = useParams<{ token: string }>();
  const router    = useRouter();

  const [invite,          setInvite]          = useState<InviteInfo | null>(null);
  const [loadError,       setLoadError]       = useState<string | null>(null);
  const [loading,         setLoading]         = useState(true);
  const [fullName,        setFullName]        = useState('');
  const [password,        setPassword]        = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [formError,       setFormError]       = useState<string | null>(null);
  const [saving,          setSaving]          = useState(false);
  const [done,            setDone]            = useState(false);

  useEffect(() => {
    fetch(`/api/invitations/${token}`)
      .then((r) => r.json())
      .then((data: InviteInfo & { error?: string }) => {
        if (data.error) { setLoadError(data.error); }
        else {
          setInvite(data);
          setFullName(data.full_name ?? '');
        }
        setLoading(false);
      })
      .catch(() => {
        setLoadError('Failed to load invitation.');
        setLoading(false);
      });
  }, [token]);

  async function handleAccept(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (password.length < 8) {
      setFormError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setFormError('Passwords do not match.');
      return;
    }

    setSaving(true);

    const res  = await fetch(`/api/invitations/${token}/accept`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ password, full_name: fullName || null }),
    });
    const json = await res.json() as { error?: string };

    if (!res.ok) {
      setFormError(json.error ?? 'Failed to create account.');
      setSaving(false);
      return;
    }

    // Sign in automatically after account creation
    const { error: signInErr } = await supabase.auth.signInWithPassword({
      email:    invite!.email,
      password,
    });

    if (signInErr) {
      setFormError('Account created! Please sign in at /login.');
      setSaving(false);
      return;
    }

    setDone(true);
    setTimeout(() => router.push('/admin'), 1500);
  }

  // ── States ────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-400 text-sm">Loading invitation…</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <p className="text-red-600 font-semibold mb-2">Invalid or expired invitation</p>
          <p className="text-gray-400 text-sm">{loadError}</p>
          <p className="text-gray-400 text-xs mt-4">
            Contact your administrator to request a new invite link.
          </p>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-green-600 font-semibold mb-1">Account created!</p>
          <p className="text-gray-400 text-sm">Redirecting to admin…</p>
        </div>
      </div>
    );
  }

  const isSuperAdmin = invite?.role === 'super_admin';

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-8">
          <Logo size={40} />
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8">
          <h1 className="text-xl font-bold text-gray-900 mb-1">You&apos;re Invited</h1>
          {isSuperAdmin ? (
            <p className="text-sm text-gray-500 mb-1">
              You&apos;ve been invited as a <strong>Platform Super Admin</strong>.
            </p>
          ) : (
            <p className="text-sm text-gray-500 mb-1">
              You&apos;ve been invited to join{' '}
              <strong>{invite?.workspace_name ?? 'a workspace'}</strong> as a provider admin.
            </p>
          )}
          <p className="text-xs font-mono text-gray-400 mb-6">{invite?.email}</p>

          <form onSubmit={handleAccept} className="space-y-4">
            {/* Name */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Your Name <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input
                type="text"
                autoComplete="name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="Jane Smith"
              />
            </div>

            {/* Password */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Create Password *
              </label>
              <input
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="At least 8 characters"
              />
            </div>

            {/* Confirm password */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Confirm Password *
              </label>
              <input
                type="password"
                required
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="Repeat password"
              />
            </div>

            {formError && (
              <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{formError}</p>
            )}

            <button
              type="submit"
              disabled={saving}
              className="w-full bg-indigo-600 text-white py-2.5 rounded-lg font-medium text-sm hover:bg-indigo-700 disabled:opacity-60 transition-colors"
            >
              {saving ? 'Creating account…' : 'Create Account & Sign In'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
