'use client';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Submission, Tool } from '@/lib/supabase';
import { ExternalLink, ChevronDown, ChevronUp, RefreshCw, ArrowLeft, List } from 'lucide-react';

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';

function StatusBadge({ status }: { status: string | null }) {
  const map: Record<string, string> = {
    success: 'bg-green-50 text-green-700',
    failed:  'bg-red-50 text-red-600',
    pending: 'bg-yellow-50 text-yellow-700',
    skipped: 'bg-gray-50 text-gray-400',
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${map[status ?? 'skipped'] ?? map.skipped}`}>
      {status ?? 'skipped'}
    </span>
  );
}

export default function SubmissionsPage() {
  const { id } = useParams<{ id: string }>();
  const [tool, setTool] = useState<Tool | null>(null);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      // Fetch tool
      const toolRes  = await fetch(`/api/admin/tools/${id}`);
      const toolJson = await toolRes.json() as { tool?: Tool; error?: string };

      if (!toolRes.ok) {
        setError(toolJson.error ?? 'Failed to load tool');
        return;
      }
      setTool(toolJson.tool ?? null);

      // Fetch submissions separately so a tool-fetch parse error can't mask this
      const subRes  = await fetch(`/api/admin/tools/${id}/submissions`);
      const subJson = await subRes.json() as { submissions?: Submission[]; count?: number; error?: string };

      if (!subRes.ok) {
        setError(subJson.error ?? 'Failed to load submissions');
        return;
      }

      const subs: Submission[] = Array.isArray(subJson.submissions) ? subJson.submissions : [];
      setSubmissions(subs);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="max-w-3xl">
      {/* Back nav */}
      <div className="flex items-center gap-3 mb-6">
        <Link
          href="/admin"
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors"
        >
          <ArrowLeft size={15} /> Dashboard
        </Link>
        {tool && (
          <>
            <span className="text-gray-300">/</span>
            <Link
              href={`/admin/tools/${id}/questions`}
              className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors"
            >
              <List size={13} /> {tool.title}
            </Link>
          </>
        )}
      </div>

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {loading ? 'Loading…' : `${tool?.title ?? ''} — Submissions`}
          </h1>
          {!loading && (
            <p className="text-sm text-gray-400 mt-0.5">
              {tool?.provider_name
                ? `${tool.provider_name} · `
                : ''}
              {submissions.length} submission{submissions.length !== 1 ? 's' : ''}
            </p>
          )}
        </div>
        <button
          onClick={() => load(true)}
          disabled={refreshing}
          className="inline-flex items-center gap-1.5 text-sm border border-gray-200 rounded-lg px-3 py-2 text-gray-500 hover:text-indigo-600 hover:border-indigo-300 disabled:opacity-50 transition-colors"
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Error state */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4 text-sm text-red-700">
          <strong>Error:</strong> {error}
          <button
            onClick={() => load()}
            className="ml-3 text-red-600 underline text-xs"
          >
            Try again
          </button>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white rounded-2xl border border-gray-100 p-5 animate-pulse">
              <div className="h-4 bg-gray-100 rounded w-48 mb-2" />
              <div className="h-3 bg-gray-100 rounded w-32" />
            </div>
          ))}
        </div>
      )}

      {/* Empty state — only when we've finished loading and truly have no submissions */}
      {!loading && !error && submissions.length === 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center">
          <p className="text-gray-500 font-medium mb-1">No submissions yet</p>
          <p className="text-gray-400 text-sm">
            Submissions will appear here after someone completes the quiz.
          </p>
          {tool && (
            <Link
              href={`/t/${tool.slug}`}
              target="_blank"
              className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:underline mt-4"
            >
              <ExternalLink size={13} /> Open quiz to test
            </Link>
          )}
        </div>
      )}

      {/* Submissions list */}
      {!loading && submissions.length > 0 && (
        <div className="space-y-3">
          {submissions.map((sub) => (
            <div key={sub.id} className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
              <button
                className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-gray-50 transition-colors"
                onClick={() => setExpanded(expanded === sub.id ? null : sub.id)}
              >
                <div>
                  <p className="font-medium text-gray-900 text-sm">
                    {[sub.first_name, sub.last_name].filter(Boolean).join(' ') || '—'}
                    <span className="text-gray-400 font-normal"> · {sub.email}</span>
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {new Date(sub.created_at).toLocaleString()}
                    {sub.phone && ` · ${sub.phone}`}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <StatusBadge status={sub.ghl_sync_status} />
                  {expanded === sub.id
                    ? <ChevronUp size={15} className="text-gray-400" />
                    : <ChevronDown size={15} className="text-gray-400" />}
                </div>
              </button>

              {expanded === sub.id && (
                <div className="border-t border-gray-100 px-5 py-4 space-y-4">
                  {/* Answers */}
                  {Object.keys(sub.answers ?? {}).length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Answers</p>
                      <div className="space-y-2">
                        {Object.entries(sub.answers).map(([q, a]) => (
                          <div key={q}>
                            <p className="text-xs font-medium text-gray-700">{q}</p>
                            <p className="text-xs text-gray-500">{Array.isArray(a) ? a.join(', ') : a}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* AI Result */}
                  {sub.ai_result && (
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">AI Result</p>
                      <p className="text-xs text-gray-600 whitespace-pre-wrap leading-relaxed bg-gray-50 rounded-lg p-3 line-clamp-6">
                        {sub.ai_result}
                      </p>
                    </div>
                  )}

                  {/* Links */}
                  <div className="flex items-center gap-3 pt-1">
                    <Link
                      href={`/r/${sub.result_token}`}
                      target="_blank"
                      className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:underline"
                    >
                      <ExternalLink size={12} /> View result page
                    </Link>
                    <span className="text-gray-200">|</span>
                    <p className="text-xs text-gray-400 break-all">
                      {appUrl}/r/{sub.result_token}
                    </p>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
