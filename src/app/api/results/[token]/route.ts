import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';

// Public, token-gated result lookup. Returns only what a result page renders —
// never the compiled prompt, contact details, raw answers or webhook responses.
const PUBLIC_RESULT_FIELDS =
  'first_name, ai_result, result_json, outcome_data, generation_status, created_at, tools(title, slug, description, provider_name, provider_logo_url)';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: { token: string } }
) {
  if (!/^[a-f0-9]{32,128}$/i.test(params.token)) {
    return NextResponse.json({ error: 'Result not found' }, { status: 404 });
  }

  const db = getServiceClient();

  const { data: submission, error } = await db
    .from('submissions')
    .select(PUBLIC_RESULT_FIELDS)
    .eq('result_token', params.token)
    .maybeSingle();

  if (error || !submission) {
    return NextResponse.json({ error: 'Result not found' }, { status: 404 });
  }

  return NextResponse.json({ submission }, { headers: { 'Cache-Control': 'no-store' } });
}
