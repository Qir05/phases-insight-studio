import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; qid: string } }
) {
  const body = await req.json();
  const db = getServiceClient();

  const { data, error } = await db
    .from('questions')
    .update(body)
    .eq('id', params.qid)
    .eq('tool_id', params.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ question: data });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; qid: string } }
) {
  const db = getServiceClient();
  const { error } = await db
    .from('questions')
    .delete()
    .eq('id', params.qid)
    .eq('tool_id', params.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
