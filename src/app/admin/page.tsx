'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Tool } from '@/lib/supabase';
import { PlusCircle, ExternalLink, List, Users, Trash2, BarChart3, Layers, Settings, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { computeConfigStatus, type ConfigStatus } from '@/lib/resultConfigValidation';

type ToolWithCounts = Tool & {
  submissions?: [{ count: number }];
  questions?: [{ count: number }];
};

function subCount(t: ToolWithCounts) { return t.submissions?.[0]?.count ?? 0; }
function qCount(t: ToolWithCounts)   { return t.questions?.[0]?.count ?? 0; }

const TOOL_MODE_LABEL: Record<string, string> = {
  ai_result:          'AI Result',
  smartform_redirect: 'SmartForm Redirect',
};

const STRATEGY_LABEL: Record<string, string> = {
  ai_generated:            'AI Generated',
  structured_outcome:      'Structured Outcome',
  hybrid_ai_with_outcome:  'Hybrid',
};

const CONFIG_STATUS_STYLE: Record<ConfigStatus, { label: string; className: string }> = {
  configured: { label: 'Configured',            className: 'bg-green-50 text-green-700' },
  missing:    { label: 'Missing result config', className: 'bg-red-50 text-red-600' },
  draft:      { label: 'Draft',                 className: 'bg-amber-50 text-amber-700' },
  redirect:   { label: 'Redirect tool',         className: 'bg-gray-100 text-gray-500' },
};

function ToolBadges({ tool }: { tool: ToolWithCounts }) {
  const status = computeConfigStatus(tool);
  const { label: statusLabel, className: statusClass } = CONFIG_STATUS_STYLE[status];

  const isDraft = tool.status === 'draft';

  return (
    <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
      <span
        className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${
          isDraft ? 'bg-amber-100 text-amber-800' : 'bg-green-100 text-green-800'
        }`}
      >
        {isDraft ? 'Draft — not public' : 'Live'}
      </span>
      <span className="text-[11px] px-2 py-0.5 rounded-full font-medium bg-indigo-50 text-indigo-600">
        {TOOL_MODE_LABEL[tool.tool_mode] ?? tool.tool_mode}
      </span>
      {tool.tool_mode !== 'smartform_redirect' && (
        <span className="text-[11px] px-2 py-0.5 rounded-full font-medium bg-gray-100 text-gray-500">
          {STRATEGY_LABEL[tool.result_strategy] ?? tool.result_strategy}
        </span>
      )}
      <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${statusClass}`}>
        {statusLabel}
      </span>
    </div>
  );
}

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
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-500 mt-1">Manage your AI assessment tools</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/admin/tools/import"
            className="inline-flex items-center gap-2 border border-indigo-200 text-indigo-700 px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-indigo-50 transition-colors"
          >
            <Wand2 size={16} /> Import Quiz
          </Link>
          <Link
            href="/admin/tools/new"
            className="inline-flex items-center gap-2 bg-indigo-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
          >
            <PlusCircle size={16} /> New Tool
          </Link>
        </div>
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
              className="bg-white rounded-2xl border border-gray-100 p-4 sm:p-5 hover:border-gray-200 transition-colors"
            >
              {/* Info */}
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="font-semibold text-gray-900 break-words min-w-0">{tool.title}</h2>
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
                <ToolBadges tool={tool} />
                <div className="flex items-center gap-x-3 gap-y-1 flex-wrap mt-2">
                  <span className="text-xs text-gray-400">
                    <span className="font-medium text-gray-600">{qCount(tool)}</span> questions
                  </span>
                  <span className="text-gray-200" aria-hidden="true">·</span>
                  <span className="text-xs text-gray-400">
                    <span className="font-medium text-gray-600">{subCount(tool)}</span> submissions
                  </span>
                  <span className="text-gray-200" aria-hidden="true">·</span>
                  <span className="text-xs text-gray-400">
                    {new Date(tool.created_at).toLocaleDateString()}
                  </span>
                </div>
              </div>

              {/* Actions — own row so they wrap cleanly at any width */}
              <div className="flex flex-wrap items-center gap-2 mt-4 pt-4 border-t border-gray-50">
                <Link
                  href={`/t/${tool.slug}?preview=1`}
                  target="_blank"
                  className={actionClass}
                >
                  <ExternalLink size={13} aria-hidden="true" /> Preview
                </Link>
                <Link href={`/admin/tools/${tool.id}/questions`} className={actionClass}>
                  <List size={13} aria-hidden="true" /> Questions
                </Link>
                <Link href={`/admin/tools/${tool.id}/settings`} className={actionClass}>
                  <Settings size={13} aria-hidden="true" /> Settings
                </Link>
                <Link href={`/admin/tools/${tool.id}/submissions`} className={actionClass}>
                  <Users size={13} aria-hidden="true" /> Submissions
                  {subCount(tool) > 0 && (
                    <span className="ml-0.5 bg-indigo-100 text-indigo-700 rounded-full px-1.5 text-[10px] font-semibold">
                      {subCount(tool)}
                    </span>
                  )}
                </Link>
                <button
                  type="button"
                  onClick={() => deleteTool(tool.id, tool.title)}
                  aria-label={`Delete ${tool.title}`}
                  title="Delete tool"
                  className="ml-auto inline-flex items-center justify-center w-9 h-9 text-red-400 hover:text-red-600 hover:bg-red-50 border border-gray-200 rounded-lg transition-colors"
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const actionClass =
  'inline-flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-indigo-600 hover:border-indigo-200 border border-gray-200 rounded-lg px-3 h-9 transition-colors whitespace-nowrap';
