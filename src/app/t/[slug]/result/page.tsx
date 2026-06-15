'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import Disclaimer from '@/components/Disclaimer';
import { Copy, ExternalLink, CheckCircle } from 'lucide-react';
import { toast } from 'sonner';

interface StoredResult {
  aiResult:     string;
  resultToken:  string;
  toolTitle:    string;
  providerName?: string | null;
}

export default function SessionResultPage() {
  const { slug }  = useParams<{ slug: string }>();
  const router    = useRouter();
  const [result, setResult] = useState<StoredResult | null>(null);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';

  useEffect(() => {
    const raw = sessionStorage.getItem(`result_${slug}`);
    if (!raw) { router.replace(`/t/${slug}`); return; }
    setResult(JSON.parse(raw));
  }, [slug, router]);

  if (!result) return null;

  const resultUrl    = `${appUrl}/r/${result.resultToken}`;
  const providerLabel = result.providerName ?? result.toolTitle;

  function copyLink() {
    navigator.clipboard.writeText(resultUrl);
    toast.success('Link copied!');
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between">
          <span className="font-semibold text-indigo-600">{providerLabel}</span>
          <span className="text-xs text-gray-400 hidden sm:block">{result.toolTitle}</span>
        </div>
      </header>

      <main className="max-w-xl mx-auto px-4 sm:px-6 py-8">
        {/* Success banner */}
        <div className="bg-green-50 border border-green-100 rounded-2xl px-5 py-4 mb-6 flex items-center gap-3">
          <CheckCircle size={18} className="text-green-500 flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold text-green-800">Your results are ready</p>
            <p className="text-xs text-green-600 mt-0.5">{result.toolTitle}</p>
          </div>
        </div>

        {/* Result card */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 sm:p-8">
          <div className="prose prose-sm prose-gray max-w-none">
            <ReactMarkdown>{result.aiResult}</ReactMarkdown>
          </div>
        </div>

        <Disclaimer />

        {/* Share row */}
        <div className="mt-5 flex items-center gap-3 flex-wrap">
          <button
            onClick={copyLink}
            className="inline-flex items-center gap-2 text-sm border border-gray-200 rounded-lg px-4 py-2 text-gray-600 hover:border-indigo-300 hover:text-indigo-600 transition-colors"
          >
            <Copy size={14} /> Copy permanent link
          </button>
          <a
            href={resultUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-indigo-600 transition-colors"
          >
            <ExternalLink size={14} /> Open permanent link
          </a>
        </div>
      </main>
    </div>
  );
}
