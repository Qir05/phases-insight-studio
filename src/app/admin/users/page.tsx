'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { UserPlus, UserCheck, UserX, Shield, Building2, Mail, KeyRound, Link as LinkIcon } from 'lucide-react';
import ActionsMenu from '@/components/ActionsMenu';
import SecretResultModal from '@/components/SecretResultModal';
import type { Profile } from '@/lib/supabase';

type UserWithWorkspace = Profile & {
  workspaces: { name: string } | null;
};

type SecretResult = {
  title: string;
  value: string;
  warning: string;
};

function RoleBadge({ role }: { role: string }) {
  const isSA = role === 'super_admin';
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${
      isSA ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-500'
    }`}>
      {isSA && <Shield size={10} />}
      {isSA ? 'Super Admin' : 'Provider Admin'}
    </span>
  );
}

export default function UsersPage() {
  const [users,        setUsers]        = useState<UserWithWorkspace[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [pendingId,    setPendingId]    = useState<string | null>(null);
  const [currentUser,  setCurrentUser]  = useState<Profile | null>(null);
  const [secretResult, setSecretResult] = useState<SecretResult | null>(null);

  const load = useCallback(async () => {
    const res  = await fetch('/api/admin/users');
    const json = await res.json() as { users?: UserWithWorkspace[] };
    setUsers(json.users ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { profile?: Profile } | null) => {
        if (data?.profile) setCurrentUser(data.profile);
      });
  }, [load]);

  async function toggleActive(userId: string, current: boolean, name: string) {
    if (!confirm(`${current ? 'Deactivate' : 'Reactivate'} ${name}?`)) return;
    setPendingId(userId);
    const res  = await fetch(`/api/admin/users/${userId}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ is_active: !current }),
    });
    setPendingId(null);
    if (res.ok) {
      toast.success(current ? 'User deactivated.' : 'User reactivated.');
      load();
    } else {
      const j = await res.json() as { error?: string };
      toast.error(j.error ?? 'Failed to update.');
    }
  }

  async function sendPasswordReset(userId: string, name: string) {
    if (!confirm(`Send a password reset email to ${name}?`)) return;
    setPendingId(userId);
    const res = await fetch(`/api/admin/users/${userId}/send-password-reset`, { method: 'POST' });
    setPendingId(null);
    if (res.ok) {
      toast.success('Password reset email sent.');
    } else {
      const j = await res.json() as { error?: string };
      toast.error(j.error ?? 'Failed to send reset email.');
    }
  }

  async function generateRecoveryLink(userId: string, name: string) {
    setPendingId(userId);
    const res = await fetch(`/api/admin/users/${userId}/generate-recovery-link`, { method: 'POST' });
    setPendingId(null);
    if (res.ok) {
      const j = await res.json() as { link: string };
      setSecretResult({
        title: `Recovery link for ${name}`,
        value: j.link,
        warning: 'This link lets anyone who has it set a new password. Share it securely and only with the intended user.',
      });
    } else {
      const j = await res.json() as { error?: string };
      toast.error(j.error ?? 'Failed to generate link.');
    }
  }

  async function setTemporaryPassword(userId: string, name: string) {
    if (!confirm(`Set a temporary password for ${name}? Their current password will stop working immediately.`)) return;
    setPendingId(userId);
    const res = await fetch(`/api/admin/users/${userId}/set-temporary-password`, { method: 'POST' });
    setPendingId(null);
    if (res.ok) {
      const j = await res.json() as { temporaryPassword: string };
      setSecretResult({
        title: `Temporary password for ${name}`,
        value: j.temporaryPassword,
        warning: 'Share this securely. This password will not be shown again.',
      });
    } else {
      const j = await res.json() as { error?: string };
      toast.error(j.error ?? 'Failed to set temporary password.');
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Admin Users</h1>
          <p className="text-sm text-gray-500 mt-1">All platform administrators</p>
        </div>
        <Link
          href="/admin/users/invite"
          className="inline-flex items-center gap-2 bg-indigo-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
        >
          <UserPlus size={16} /> Invite Admin
        </Link>
      </div>

      {loading ? (
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          {[1, 2, 3].map((i) => (
            <div key={i} className="p-5 border-b border-gray-100 last:border-0 animate-pulse">
              <div className="h-4 bg-gray-100 rounded w-48 mb-2" />
              <div className="h-3 bg-gray-100 rounded w-32" />
            </div>
          ))}
        </div>
      ) : users.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-16 text-center">
          <p className="text-gray-500 font-medium mb-1">No admin users yet</p>
          <p className="text-gray-400 text-sm mb-4">Invite a super admin or provider admin to get started.</p>
          <Link href="/admin/users/invite" className="text-indigo-600 font-medium text-sm hover:underline">
            Invite first admin →
          </Link>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1.5fr)_minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_auto] gap-4 px-5 py-3 border-b border-gray-100 bg-gray-50">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">User</span>
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Role</span>
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide hidden md:block">Workspace</span>
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide hidden sm:block">Status</span>
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide hidden lg:block">Joined</span>
            <span />
          </div>

          {/* Rows */}
          {users.map((user) => {
            const name    = user.full_name || user.email;
            const pending = pendingId === user.user_id;
            const isSelf  = currentUser?.user_id === user.user_id;
            const canManage = currentUser?.role === 'super_admin' && !isSelf;

            return (
              <div
                key={user.id}
                className="grid grid-cols-[minmax(0,2fr)_minmax(0,1.5fr)_minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_auto] gap-4 px-5 py-4 items-center border-b border-gray-100 last:border-0 hover:bg-gray-50 transition-colors"
              >
                {/* User */}
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{name}</p>
                  {user.full_name && (
                    <p className="text-xs text-gray-400 truncate">{user.email}</p>
                  )}
                </div>

                {/* Role */}
                <div>
                  <RoleBadge role={user.role} />
                </div>

                {/* Workspace */}
                <div className="hidden md:block">
                  {user.workspaces ? (
                    <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                      <Building2 size={11} /> {user.workspaces.name}
                    </span>
                  ) : (
                    <span className="text-xs text-gray-300">Platform</span>
                  )}
                </div>

                {/* Status */}
                <div className="hidden sm:block">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    user.is_active
                      ? 'bg-green-50 text-green-700'
                      : 'bg-red-50 text-red-500'
                  }`}>
                    {user.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>

                {/* Joined */}
                <div className="hidden lg:block">
                  <span className="text-xs text-gray-400">
                    {new Date(user.created_at).toLocaleDateString()}
                  </span>
                </div>

                {/* Action */}
                <div>
                  {canManage ? (
                    <ActionsMenu
                      disabled={pending}
                      items={[
                        {
                          label: 'Reset Email',
                          icon: Mail,
                          onClick: () => sendPasswordReset(user.user_id, name),
                        },
                        {
                          label: 'Recovery Link',
                          icon: LinkIcon,
                          onClick: () => generateRecoveryLink(user.user_id, name),
                        },
                        {
                          label: 'Temp Password',
                          icon: KeyRound,
                          onClick: () => setTemporaryPassword(user.user_id, name),
                        },
                        {
                          label: user.is_active ? 'Deactivate' : 'Reactivate',
                          icon: user.is_active ? UserX : UserCheck,
                          onClick: () => toggleActive(user.user_id, user.is_active, name),
                          danger: user.is_active,
                        },
                      ]}
                    />
                  ) : (
                    <span className="text-xs text-gray-300" title={isSelf ? "You can't manage your own account" : undefined}>
                      {isSelf ? '—' : ''}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {secretResult && (
        <SecretResultModal
          title={secretResult.title}
          value={secretResult.value}
          warning={secretResult.warning}
          onClose={() => setSecretResult(null)}
        />
      )}
    </div>
  );
}
