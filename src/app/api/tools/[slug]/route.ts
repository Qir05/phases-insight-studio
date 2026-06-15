import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';

export async function GET(
  _req: NextRequest,
  { params }: { params: { slug: string } }
) {
  const db = getServiceClient();

  const { data: tool, error: toolErr } = await db
    .from('tools')
    .select('*')
    .eq('slug', params.slug)
    .single();

  if (toolErr || !tool) {
    return NextResponse.json({ error: 'Tool not found' }, { status: 404 });
  }

  const { data: questions, error: qErr } = await db
    .from('questions')
    .select('*')
    .eq('tool_id', tool.id)
    .order('order_index');   // fixed: was 'position' (column doesn't exist)

  if (qErr) {
    console.error('[tools/slug GET] questions error:', qErr);
  }

  return NextResponse.json({ tool, questions: questions ?? [] });
}
