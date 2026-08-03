import ReactMarkdown from 'react-markdown';
import Disclaimer from '@/components/Disclaimer';
import StructuredResultView from '@/components/StructuredResultView';
import { getServiceClient } from '@/lib/supabase';
import type { Outcome } from '@/lib/supabase';
import type { StructuredResult } from '@/lib/groq';
import { notFound } from 'next/navigation';
import { CheckCircle, ExternalLink } from 'lucide-react';
import Link from 'next/link';

interface PageProps {
  params: { token: string };
}

export default async function PublicResultPage({ params }: PageProps) {
  const db = getServiceClient();

  const { data: submission } = await db
    .from('submissions')
    .select('*, tools(title, slug, description, provider_name, provider_logo_url)')
    .eq('result_token', params.token)
    .single();

  if (!submission) notFound();

  const tool = submission.tools as {
    title: string;
    slug: string;
    description: string | null;
    provider_name: string | null;
    provider_logo_url: string | null;
  } | null;

  const outcome      = submission.outcome_data as Outcome | null;
  const aiResult     = submission.ai_result    as string  | null;
  const resultJson   = submission.result_json  as StructuredResult | null;
  const providerLabel = tool?.provider_name ?? tool?.title ?? 'AI Assessment';

  const hasOutcome = !!outcome;
  const hasAi      = !!aiResult;
  const isHybrid   = hasOutcome && hasAi;
  const isAiOnly   = !hasOutcome && hasAi;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between">
          {tool?.provider_logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={tool.provider_logo_url} alt={providerLabel} className="h-8 object-contain" />
          ) : (
            <span className="font-semibold text-indigo-600">{providerLabel}</span>
          )}
          {tool && <span className="text-xs text-gray-400 hidden sm:block">{tool.title}</span>}
        </div>
      </header>

      <main className="max-w-xl mx-auto px-4 sm:px-6 py-8 space-y-5">
        {/* Banner */}
        <div className="bg-green-50 border border-green-100 rounded-2xl px-5 py-4 flex items-center gap-3">
          <CheckCircle size={18} className="text-green-500 flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold text-green-800">
              {submission.first_name
                ? `Results for ${submission.first_name}${submission.last_name ? ` ${submission.last_name}` : ''}`
                : 'Your results are ready'}
            </p>
            {tool && <p className="text-xs text-green-600 mt-0.5">{tool.title}</p>}
          </div>
        </div>

        {/* ── Structured outcome card (structured_outcome or hybrid) ── */}
        {(hasOutcome) && outcome && (
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
            {isHybrid && aiResult && (
              <div className="border-t border-gray-100 pt-5">
                <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-3">Personalised For You</p>
                <div className="prose prose-sm prose-gray max-w-none">
                  <ReactMarkdown>{aiResult}</ReactMarkdown>
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
        {isAiOnly && aiResult && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 sm:p-8">
            {resultJson ? (
              <StructuredResultView result={resultJson} />
            ) : (
              <div className="prose prose-sm prose-gray max-w-none">
                <ReactMarkdown>{aiResult}</ReactMarkdown>
              </div>
            )}
          </div>
        )}

        {/* ── Missing result configuration fallback ── */}
        {!(hasOutcome && outcome) && !(isAiOnly && aiResult) && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4 text-sm text-amber-800">
            This tool is missing result configuration. Please configure result strategy, scoring config, and result config.
          </div>
        )}

        <Disclaimer />

        {/* Retake button */}
        {tool?.slug && (
          <div className="flex items-center gap-3">
            <Link
              href={`/t/${tool.slug}`}
              className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-indigo-600 transition-colors"
            >
              <ExternalLink size={14} /> Retake quiz
            </Link>
          </div>
        )}
      </main>
    </div>
  );
}
