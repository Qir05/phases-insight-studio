'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import Disclaimer from '@/components/Disclaimer';
import StructuredResultView from '@/components/StructuredResultView';
import { Copy, ExternalLink, CheckCircle, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import type { StructuredResult } from '@/lib/groq';
import type { Outcome } from '@/lib/supabase';
import Link from 'next/link';

interface StoredResult {
  mode:               'ai_result' | 'structured_outcome' | 'hybrid_ai_with_outcome';
  aiResult?:          string;
  resultJson?:        StructuredResult | null;
  aiPersonalization?: string;
  outcome?:           Outcome;
  resultToken:        string;
  toolTitle:          string;
  providerName?:      string | null;
}

export default function SessionResultPage() {
  const { slug }  = useParams<{ slug: string }>();
  const router    = useRouter();
  const [result, setResult] = useState<StoredResult | null>(null);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';

  useEffect(() => {
    const raw = sessionStorage.getItem(`result_${slug}`);
    if (!raw) { router.replace(`/t/${slug}`); return; }
    setResult(JSON.parse(raw) as StoredResult);
  }, [slug, router]);

  if (!result) return null;

  const resultUrl    = `${appUrl}/r/${result.resultToken}`;
  const providerLabel = result.providerName ?? result.toolTitle;

  function copyLink() {
    navigator.clipboard.writeText(resultUrl);
    toast.success('Link copied!');
  }

  const isAiOnly      = result.mode === 'ai_result';
  const isStructured  = result.mode === 'structured_outcome';
  const isHybrid      = result.mode === 'hybrid_ai_with_outcome';
  const outcome       = result.outcome;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between">
          <span className="font-semibold text-indigo-600">{providerLabel}</span>
          <span className="text-xs text-gray-400 hidden sm:block">{result.toolTitle}</span>
        </div>
      </header>

      <main className="max-w-xl mx-auto px-4 sm:px-6 py-8 space-y-5">
        {/* Success banner */}
        <div className="bg-green-50 border border-green-100 rounded-2xl px-5 py-4 flex items-center gap-3">
          <CheckCircle size={18} className="text-green-500 flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold text-green-800">Your results are ready</p>
            <p className="text-xs text-green-600 mt-0.5">{result.toolTitle}</p>
          </div>
        </div>

        {/* ── Structured outcome card ── */}
        {(isStructured || isHybrid) && outcome && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 sm:p-8 space-y-5">
            {/* Outcome title */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-indigo-500 mb-1">Your Type</p>
              <h2 className="text-2xl font-bold text-gray-900">{outcome.title}</h2>
              {outcome.description && (
                <p className="text-sm text-gray-600 mt-2 leading-relaxed">{outcome.description}</p>
              )}
            </div>

            {/* AI personalisation (hybrid) */}
            {isHybrid && result.aiPersonalization && (
              <div className="border-t border-gray-100 pt-5">
                <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-3">Personalised For You</p>
                <div className="prose prose-sm prose-gray max-w-none">
                  <ReactMarkdown>{result.aiPersonalization}</ReactMarkdown>
                </div>
              </div>
            )}

            {/* Recommendations */}
            {outcome.recommendations && outcome.recommendations.length > 0 && (
              <div className="border-t border-gray-100 pt-5">
                <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-3">Recommendations</p>
                <ul className="space-y-2">
                  {outcome.recommendations.map((rec, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                      <span className="mt-1 h-1.5 w-1.5 rounded-full bg-indigo-400 flex-shrink-0" />
                      {rec}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* CTA */}
            {outcome.cta_text && outcome.cta_url && (
              <div className="border-t border-gray-100 pt-5">
                <a
                  href={outcome.cta_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block w-full text-center bg-indigo-600 text-white py-3 rounded-xl font-semibold hover:bg-indigo-700 transition-colors text-sm"
                >
                  {outcome.cta_text}
                </a>
              </div>
            )}
          </div>
        )}

        {/* ── AI-only result card ── */}
        {isAiOnly && result.aiResult && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 sm:p-8">
            {result.resultJson ? (
              <StructuredResultView result={result.resultJson} />
            ) : (
              <div className="prose prose-sm prose-gray max-w-none">
                <ReactMarkdown>{result.aiResult}</ReactMarkdown>
              </div>
            )}
          </div>
        )}

        {/* ── Missing result configuration fallback ── */}
        {!((isStructured || isHybrid) && outcome) && !(isAiOnly && result.aiResult) && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4 text-sm text-amber-800">
            This tool is missing result configuration. Please configure result strategy, scoring config, and result config.
          </div>
        )}

        <Disclaimer />

        {/* Share row */}
        <div className="flex items-center gap-3 flex-wrap">
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
          <Link
            href={`/t/${slug}`}
            className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-indigo-600 transition-colors ml-auto"
          >
            <RefreshCw size={14} /> Retake quiz
          </Link>
        </div>
      </main>
    </div>
  );
}
