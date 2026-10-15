'use client';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Eye, Globe, Lock, Loader2, AlertCircle, AlertTriangle, CheckCircle } from 'lucide-react';

interface Readiness {
  status: 'draft' | 'published';
  draft_supported: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Draft → Preview → Publish controls for one tool. The publish endpoint
 * re-runs the same validation server-side, so a broken config can never be
 * made public from here.
 */
export default function PublishControls({
  toolId,
  slug,
  refreshKey = 0,
  onStatusChange,
}: {
  toolId: string;
  slug: string;
  /** Bump to re-fetch readiness after the parent saves changes. */
  refreshKey?: number;
  onStatusChange?: (status: 'draft' | 'published') => void;
}) {
  const [data, setData]       = useState<Readiness | null>(null);
  const [busy, setBusy]       = useState(false);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/tools/${toolId}/publish`);
    if (!res.ok) return;
    setData(await res.json() as Readiness);
  }, [toolId]);

  useEffect(() => { load(); }, [load, refreshKey]);

  async function setPublished(publish: boolean) {
    if (!publish && !confirm('Unpublish this tool? The public link will stop working until you publish again.')) return;
    setBusy(true);
    const res = await fetch(`/api/admin/tools/${toolId}/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publish }),
    });
    const json = await res.json().catch(() => ({})) as { status?: 'draft' | 'published'; error?: string };
    setBusy(false);
    if (!res.ok) {
      toast.error(json.error ?? 'Failed to update publish status');
      load();
      return;
    }
    toast.success(publish ? 'Published — the public link is live.' : 'Unpublished — the tool is a draft again.');
    if (json.status) onStatusChange?.(json.status);
    load();
  }

  if (!data) {
    return <div className="h-16 bg-white rounded-2xl border border-gray-100 animate-pulse" />;
  }

  const isLive = data.status === 'published';
  const previewHref = `/t/${slug}?preview=1`; // admin preview never saves, even for live tools
  const issues = [...data.errors.map((e) => ({ e, kind: 'error' as const })), ...data.warnings.map((e) => ({ e, kind: 'warning' as const }))];
  const visible = showAll ? issues : issues.slice(0, 4);

  return (
    <section className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <span
            className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${
              isLive ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'
            }`}
          >
            {isLive ? <Globe size={12} /> : <Lock size={12} />}
            {isLive ? 'Published' : 'Draft'}
          </span>
          <p className="text-xs text-gray-500">
            {isLive ? 'Anyone with the link can take this quiz.' : 'Only admins can open this quiz (preview mode).'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={previewHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs border border-gray-200 rounded-lg px-3 py-2 text-gray-600 hover:text-indigo-600 hover:border-indigo-200"
          >
            <Eye size={13} /> Preview
          </a>
          {data.draft_supported && (
            isLive ? (
              <button
                type="button"
                onClick={() => setPublished(false)}
                disabled={busy}
                className="inline-flex items-center gap-1.5 text-xs border border-gray-200 rounded-lg px-3 py-2 text-gray-600 hover:text-red-600 hover:border-red-200 disabled:opacity-50"
              >
                {busy ? <Loader2 size={13} className="animate-spin" /> : <Lock size={13} />} Unpublish
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setPublished(true)}
                disabled={busy || data.errors.length > 0}
                title={data.errors.length > 0 ? 'Fix the errors below first' : undefined}
                className="inline-flex items-center gap-1.5 text-xs bg-green-600 text-white rounded-lg px-3 py-2 hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {busy ? <Loader2 size={13} className="animate-spin" /> : <Globe size={13} />} Publish
              </button>
            )
          )}
        </div>
      </div>

      {!data.draft_supported && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
          Draft/publish is not active yet — run <code>supabase/009_publish_status_and_rls.sql</code>. Until then every tool is public as soon as it is created.
        </p>
      )}

      {issues.length === 0 ? (
        <p className="text-xs text-green-700 inline-flex items-center gap-1.5">
          <CheckCircle size={13} /> All publish checks pass.
        </p>
      ) : (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-gray-600">
            Publish checks: {data.errors.length} error{data.errors.length === 1 ? '' : 's'}, {data.warnings.length} warning{data.warnings.length === 1 ? '' : 's'}
          </p>
          <ul className="space-y-1">
            {visible.map(({ e, kind }, i) => (
              <li key={i} className={`text-xs flex gap-1.5 ${kind === 'error' ? 'text-red-600' : 'text-amber-700'}`}>
                {kind === 'error' ? <AlertCircle size={13} className="flex-shrink-0 mt-0.5" /> : <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />}
                <span>{e}</span>
              </li>
            ))}
          </ul>
          {issues.length > 4 && (
            <button type="button" onClick={() => setShowAll((v) => !v)} className="text-xs text-indigo-600 hover:underline">
              {showAll ? 'Show less' : `Show all ${issues.length}`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
