'use client';
import { useEffect } from 'react';
import { Copy, X, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

export default function SecretResultModal({
  title,
  value,
  warning,
  onClose,
}: {
  title: string;
  value: string;
  warning: string;
  onClose: () => void;
}) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  async function copy() {
    await navigator.clipboard.writeText(value);
    toast.success('Copied to clipboard.');
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-white rounded-2xl border border-gray-100 shadow-xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-900">{title}</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
            title="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 mb-4">
          <code className="flex-1 text-sm text-gray-800 break-all font-mono">{value}</code>
          <button
            onClick={copy}
            title="Copy"
            className="shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-lg text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
          >
            <Copy size={15} />
          </button>
        </div>

        <div className="flex items-start gap-2 bg-amber-50 text-amber-700 text-xs rounded-lg px-3 py-2.5 mb-5">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>{warning}</span>
        </div>

        <button
          onClick={onClose}
          className="w-full bg-indigo-600 text-white py-2.5 rounded-lg font-semibold text-sm hover:bg-indigo-700 transition-colors"
        >
          Done
        </button>
      </div>
    </div>
  );
}
