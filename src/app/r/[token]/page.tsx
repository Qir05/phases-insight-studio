import ReactMarkdown from 'react-markdown';
import Disclaimer from '@/components/Disclaimer';
import { getServiceClient } from '@/lib/supabase';
import { notFound } from 'next/navigation';
import { CheckCircle } from 'lucide-react';

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

  const providerLabel = tool?.provider_name ?? tool?.title ?? 'AI Assessment';

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

      <main className="max-w-xl mx-auto px-4 sm:px-6 py-8">
        {/* Banner */}
        <div className="bg-green-50 border border-green-100 rounded-2xl px-5 py-4 mb-6 flex items-center gap-3">
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

        {/* Result card */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 sm:p-8">
          <div className="prose prose-sm prose-gray max-w-none">
            <ReactMarkdown>{submission.ai_result ?? ''}</ReactMarkdown>
          </div>
        </div>

        <Disclaimer />
      </main>
    </div>
  );
}
