import Link from 'next/link';
import { ArrowLeft, SearchX, ShieldAlert } from 'lucide-react';

/**
 * Shown by the per-tool admin pages when the tool id does not exist (404) or
 * belongs to another workspace (403) — instead of an empty, editable form.
 */
export default function ToolNotFound({ status }: { status: number }) {
  const forbidden = status === 403;
  const Icon = forbidden ? ShieldAlert : SearchX;
  return (
    <div className="max-w-xl mx-auto mt-6 sm:mt-12">
      <div className="bg-white rounded-2xl border border-gray-100 px-6 py-10 sm:px-10 text-center">
        <div className="w-12 h-12 rounded-2xl bg-gray-50 flex items-center justify-center mx-auto mb-4">
          <Icon size={22} className="text-gray-400" aria-hidden="true" />
        </div>
        <h1 className="text-lg font-semibold text-gray-900">
          {forbidden ? 'You don’t have access to this tool' : 'Tool not found'}
        </h1>
        <p className="text-sm text-gray-500 mt-1.5">
          {forbidden
            ? 'It belongs to another workspace. Ask a super admin if you need access.'
            : 'This tool doesn’t exist or may have been deleted. Check the link, or pick a tool from the dashboard.'}
        </p>
        <Link
          href="/admin"
          className="inline-flex items-center gap-1.5 mt-6 bg-indigo-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
        >
          <ArrowLeft size={15} aria-hidden="true" /> Back to Dashboard
        </Link>
      </div>
    </div>
  );
}
