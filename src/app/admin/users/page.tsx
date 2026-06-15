'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { UserPlus, UserCheck, UserX, Shield, Building2 } from 'lucide-react';
import type { Profile } from '@/lib/supabase';

type UserWithWorkspace = Profile & {
  workspaces: { name: string } | null;
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
  const [users,    setUsers]    = useState<UserWithWorkspace[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res  = await fetch('/api/admin/users');
    const json = await res.json() as { users?: UserWithWorkspace[] };
    setUsers(json.users ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function toggleActive(userId: string, current: boolean, name: string) {
    if (!confirm(`${current ? 'Deactivate' : 'Reactivate'} ${name}?`)) return;
    setToggling(userId);
    const res  = await fetch(`/api/admin/users/${userId}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ is_active: !current }),
    });
    setToggling(null);
    if (res.ok) {
      toast.success(current ? 'User deactivated.' : 'User reactivated.');
      load();
    } else {
      const j = await res.json() as { error?: string };
      toast.error(j.error ?? 'Failed to update.');
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
            const pending = toggling === user.user_id;
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
                  <button
                    onClick={() => toggleActive(user.user_id, user.is_active, name)}
                    disabled={pending}
                    title={user.is_active ? 'Deactivate' : 'Reactivate'}
                    className={`inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border transition-colors disabled:opacity-50 ${
                      user.is_active
                        ? 'border-red-200 text-red-500 hover:bg-red-50'
                        : 'border-green-200 text-green-600 hover:bg-green-50'
                    }`}
                  >
                    {user.is_active
                      ? <><UserX size={12} /> Deactivate</>
                      : <><UserCheck size={12} /> Reactivate</>}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
