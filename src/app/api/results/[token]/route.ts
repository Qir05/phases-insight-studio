import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';

export async function GET(
  _req: NextRequest,
  { params }: { params: { token: string } }
) {
  const db = getServiceClient();

  const { data: submission, error } = await db
    .from('submissions')
    .select('*, tools(title, slug)')
    .eq('result_token', params.token)
    .single();

  if (error || !submission) {
    return NextResponse.json({ error: 'Result not found' }, { status: 404 });
  }

  return NextResponse.json({ submission });
}
