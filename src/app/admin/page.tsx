'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Tool } from '@/lib/supabase';
import { PlusCircle, ExternalLink, List, Users, Trash2, BarChart3, Layers } from 'lucide-react';
import { toast } from 'sonner';

type ToolWithCounts = Tool & {
  submissions?: [{ count: number }];
  questions?: [{ count: number }];
};

function subCount(t: ToolWithCounts) { return t.submissions?.[0]?.count ?? 0; }
function qCount(t: ToolWithCounts)   { return t.questions?.[0]?.count ?? 0; }

export default function AdminDashboard() {
  const [tools, setTools] = useState<ToolWithCounts[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/tools');
    const json = await res.json();
    setTools(json.tools ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function deleteTool(id: string, title: string) {
    if (!confirm(`Delete "${title}"? This will also delete all questions and submissions.`)) return;
    const res = await fetch(`/api/admin/tools/${id}`, { method: 'DELETE' });
    if (res.ok) { toast.success('Tool deleted'); load(); }
    else toast.error('Failed to delete');
  }

  const totalSubmissions = tools.reduce((sum, t) => sum + subCount(t), 0);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-500 mt-1">Manage your AI assessment tools</p>
        </div>
        <Link
          href="/admin/tools/new"
          className="inline-flex items-center gap-2 bg-indigo-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
        >
          <PlusCircle size={16} /> New Tool
        </Link>
      </div>

      {/* Stats row */}
      {!loading && (
        <div className="grid grid-cols-2 gap-4 mb-8">
          <div className="bg-white rounded-2xl border border-gray-100 p-5 flex items-center gap-4">
            <div className="p-2.5 bg-indigo-50 rounded-xl">
              <Layers size={20} className="text-indigo-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{tools.length}</p>
              <p className="text-xs text-gray-500 mt-0.5">Total Tools</p>
            </div>
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 p-5 flex items-center gap-4">
            <div className="p-2.5 bg-green-50 rounded-xl">
              <BarChart3 size={20} className="text-green-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{totalSubmissions}</p>
              <p className="text-xs text-gray-500 mt-0.5">Total Submissions</p>
            </div>
          </div>
        </div>
      )}

      {/* Tools list */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="bg-white rounded-2xl border border-gray-100 p-6 animate-pulse">
              <div className="h-4 bg-gray-100 rounded w-48 mb-2" />
              <div className="h-3 bg-gray-100 rounded w-32" />
            </div>
          ))}
        </div>
      ) : tools.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-16 text-center">
          <div className="w-12 h-12 bg-indigo-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Layers size={24} className="text-indigo-400" />
          </div>
          <p className="text-gray-500 font-medium mb-1">No tools yet</p>
          <p className="text-gray-400 text-sm mb-4">Create your first AI assessment tool to get started.</p>
          <Link href="/admin/tools/new" className="text-indigo-600 font-medium text-sm hover:underline">
            Create your first tool →
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {tools.map((tool) => (
            <div
              key={tool.id}
              className="bg-white rounded-2xl border border-gray-100 p-5 hover:border-gray-200 transition-colors"
            >
              <div className="flex items-start justify-between gap-4">
                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="font-semibold text-gray-900">{tool.title}</h2>
                    {tool.provider_name && (
                      <span className="text-xs bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full">
                        {tool.provider_name}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-400 mt-0.5 truncate">
                    /t/{tool.slug}
                    {tool.description && ` · ${tool.description}`}
                  </p>
                  <div className="flex items-center gap-3 mt-2">
                    <span className="text-xs text-gray-400">
                      <span className="font-medium text-gray-600">{qCount(tool)}</span> questions
                    </span>
                    <span className="text-gray-200">·</span>
                    <span className="text-xs text-gray-400">
                      <span className="font-medium text-gray-600">{subCount(tool)}</span> submissions
                    </span>
                    <span className="text-gray-200">·</span>
                    <span className="text-xs text-gray-300">
                      {new Date(tool.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap justify-end">
                  <Link
                    href={`/t/${tool.slug}`}
                    target="_blank"
                    className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-indigo-600 border border-gray-200 rounded-lg px-2.5 py-1.5 transition-colors"
                  >
                    <ExternalLink size={12} /> Preview
                  </Link>
                  <Link
                    href={`/admin/tools/${tool.id}/questions`}
                    className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-indigo-600 border border-gray-200 rounded-lg px-2.5 py-1.5 transition-colors"
                  >
                    <List size={12} /> Questions
                  </Link>
                  <Link
                    href={`/admin/tools/${tool.id}/submissions`}
                    className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-indigo-600 border border-gray-200 rounded-lg px-2.5 py-1.5 transition-colors"
                  >
                    <Users size={12} /> Submissions
                    {subCount(tool) > 0 && (
                      <span className="ml-0.5 bg-indigo-100 text-indigo-700 rounded-full px-1.5 text-[10px] font-semibold">
                        {subCount(tool)}
                      </span>
                    )}
                  </Link>
                  <button
                    onClick={() => deleteTool(tool.id, tool.title)}
                    className="inline-flex items-center gap-1 text-xs text-red-400 hover:text-red-600 border border-gray-200 rounded-lg px-2.5 py-1.5 transition-colors"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
