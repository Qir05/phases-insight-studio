'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';
import Logo from '@/components/Logo';

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type Status = 'checking' | 'ready' | 'invalid' | 'saving' | 'done';

export default function ResetPasswordPage() {
  const router = useRouter();
  const [status, setStatus]     = useState<Status>('checking');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm]   = useState('');
  const [error, setError]       = useState<string | null>(null);

  useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setStatus('ready');
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      setStatus((current) => (current === 'checking' ? (session ? 'ready' : 'invalid') : current));
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }

    setStatus('saving');
    const { error: updateErr } = await supabase.auth.updateUser({ password });

    if (updateErr) {
      setError(updateErr.message);
      setStatus('ready');
      return;
    }

    await supabase.auth.signOut();
    setStatus('done');
    setTimeout(() => {
      router.push('/login');
      router.refresh();
    }, 1500);
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-8">
          <Logo size={44} />
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8">
          {status === 'checking' && (
            <p className="text-sm text-gray-400 text-center py-4">Checking your link…</p>
          )}

          {status === 'invalid' && (
            <>
              <h1 className="text-xl font-bold text-gray-900 mb-1">Link invalid or expired</h1>
              <p className="text-sm text-gray-400 mb-6">
                This password reset link is no longer valid. Ask a super admin to send you a new one.
              </p>
              <a href="/login" className="text-indigo-600 font-medium text-sm hover:underline">
                Back to sign in →
              </a>
            </>
          )}

          {status === 'done' && (
            <>
              <h1 className="text-xl font-bold text-gray-900 mb-1">Password updated</h1>
              <p className="text-sm text-gray-400">Redirecting you to sign in…</p>
            </>
          )}

          {(status === 'ready' || status === 'saving') && (
            <>
              <h1 className="text-xl font-bold text-gray-900 mb-1">Set a new password</h1>
              <p className="text-sm text-gray-400 mb-6">Choose a new password for your account.</p>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">New password</label>
                  <input
                    type="password"
                    required
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="••••••••"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Confirm password</label>
                  <input
                    type="password"
                    required
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="••••••••"
                  />
                </div>

                {error && (
                  <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
                )}

                <button
                  type="submit"
                  disabled={status === 'saving'}
                  className="w-full bg-indigo-600 text-white py-2.5 rounded-lg font-semibold text-sm hover:bg-indigo-700 disabled:opacity-60 transition-colors"
                >
                  {status === 'saving' ? 'Saving…' : 'Set password'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
