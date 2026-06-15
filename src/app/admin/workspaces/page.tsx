'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Building2, Plus, Users, ChevronRight } from 'lucide-react';
import type { Workspace } from '@/lib/supabase';

type WorkspaceWithCount = Workspace & {
  profiles?: [{ count: number }];
};

export default function WorkspacesPage() {
  const [workspaces, setWorkspaces] = useState<WorkspaceWithCount[]>([]);
  const [loading, setLoading]       = useState(true);

  const load = useCallback(async () => {
    const res  = await fetch('/api/admin/workspaces');
    const json = await res.json() as { workspaces?: WorkspaceWithCount[] };
    setWorkspaces(json.workspaces ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Workspaces</h1>
          <p className="text-sm text-gray-500 mt-1">Manage provider workspaces and their admins</p>
        </div>
        <Link
          href="/admin/workspaces/new"
          className="inline-flex items-center gap-2 bg-indigo-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
        >
          <Plus size={16} /> New Workspace
        </Link>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="bg-white rounded-2xl border border-gray-100 p-6 animate-pulse">
              <div className="h-4 bg-gray-100 rounded w-48 mb-2" />
              <div className="h-3 bg-gray-100 rounded w-32" />
            </div>
          ))}
        </div>
      ) : workspaces.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-16 text-center">
          <div className="w-12 h-12 bg-indigo-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Building2 size={24} className="text-indigo-400" />
          </div>
          <p className="text-gray-500 font-medium mb-1">No workspaces yet</p>
          <p className="text-gray-400 text-sm mb-4">Create a workspace to invite provider admins.</p>
          <Link href="/admin/workspaces/new" className="text-indigo-600 font-medium text-sm hover:underline">
            Create first workspace →
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {workspaces.map((ws) => {
            const adminCount = ws.profiles?.[0]?.count ?? 0;
            return (
              <Link
                key={ws.id}
                href={`/admin/workspaces/${ws.id}`}
                className="block bg-white rounded-2xl border border-gray-100 p-5 hover:border-gray-200 transition-colors"
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center flex-shrink-0">
                      <Building2 size={18} className="text-indigo-500" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-gray-900">{ws.name}</p>
                        {!ws.is_active && (
                          <span className="text-xs bg-red-50 text-red-500 px-2 py-0.5 rounded-full">
                            Inactive
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5">
                        /{ws.slug}
                        <span className="mx-1.5 text-gray-200">·</span>
                        <Users size={11} className="inline mb-0.5" /> {adminCount} admin{adminCount !== 1 ? 's' : ''}
                      </p>
                    </div>
                  </div>
                  <ChevronRight size={16} className="text-gray-300 flex-shrink-0" />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
