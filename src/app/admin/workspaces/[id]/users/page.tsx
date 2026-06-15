'use client';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { ArrowLeft, Mail, UserCheck, UserX } from 'lucide-react';
import type { Profile } from '@/lib/supabase';

export default function WorkspaceUsersPage() {
  const { id }    = useParams<{ id: string }>();
  const [users,   setUsers]   = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res  = await fetch(`/api/admin/workspaces/${id}/users`);
    const json = await res.json() as { users?: Profile[] };
    setUsers(json.users ?? []);
    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function toggleActive(userId: string, currentStatus: boolean) {
    setToggling(userId);
    const res  = await fetch(`/api/admin/workspaces/${id}/users`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ user_id: userId, is_active: !currentStatus }),
    });
    setToggling(null);
    if (res.ok) {
      toast.success(currentStatus ? 'User deactivated.' : 'User reactivated.');
      load();
    } else {
      const j = await res.json() as { error?: string };
      toast.error(j.error ?? 'Failed to update user.');
    }
  }

  return (
    <div className="max-w-2xl">
      <div className="flex items-center gap-3 mb-6">
        <Link
          href={`/admin/workspaces/${id}`}
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors"
        >
          <ArrowLeft size={15} /> Back to Workspace
        </Link>
      </div>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Workspace Users</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {users.length} provider admin{users.length !== 1 ? 's' : ''}
          </p>
        </div>
        <Link
          href={`/admin/workspaces/${id}/invite`}
          className="inline-flex items-center gap-1.5 text-sm bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors"
        >
          <Mail size={14} /> Invite Provider Admin
        </Link>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="bg-white rounded-2xl border border-gray-100 p-5 animate-pulse">
              <div className="h-4 bg-gray-100 rounded w-48 mb-2" />
              <div className="h-3 bg-gray-100 rounded w-32" />
            </div>
          ))}
        </div>
      ) : users.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center">
          <p className="text-gray-500 font-medium mb-1">No admins yet</p>
          <p className="text-gray-400 text-sm mb-4">
            Invite a provider admin to give them access to this workspace.
          </p>
          <Link
            href={`/admin/workspaces/${id}/invite`}
            className="text-indigo-600 font-medium text-sm hover:underline"
          >
            Send first invite →
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {users.map((user) => (
            <div
              key={user.id}
              className="bg-white rounded-2xl border border-gray-100 p-5 flex items-center justify-between gap-4"
            >
              <div>
                <p className="font-medium text-gray-900 text-sm">
                  {user.full_name || user.email}
                </p>
                {user.full_name && (
                  <p className="text-xs text-gray-400 mt-0.5">{user.email}</p>
                )}
                <p className="text-xs text-gray-300 mt-0.5">
                  Joined {new Date(user.created_at).toLocaleDateString()}
                </p>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  user.is_active
                    ? 'bg-green-50 text-green-700'
                    : 'bg-red-50 text-red-600'
                }`}>
                  {user.is_active ? 'Active' : 'Deactivated'}
                </span>
                <button
                  onClick={() => toggleActive(user.user_id, user.is_active)}
                  disabled={toggling === user.user_id}
                  className={`inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-50 ${
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
          ))}
        </div>
      )}
    </div>
  );
}
