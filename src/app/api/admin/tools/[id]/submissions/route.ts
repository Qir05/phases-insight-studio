import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const toolId = String(params.id).trim();
  const db = getServiceClient();

  // Primary query filtered by tool_id
  const { data, error } = await db
    .from('submissions')
    .select('*')
    .eq('tool_id', toolId)
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json(
      { error: 'Failed to load submissions', detail: error.message, code: error.code },
      { status: 500 }
    );
  }

  let finalRows = data ?? [];

  // Fallback: if eq() returned nothing, match in JS to work around any
  // PostgREST UUID-cast edge cases without changing the schema.
  if (finalRows.length === 0) {
    const { data: allRows } = await db
      .from('submissions')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);

    finalRows = (allRows ?? []).filter(
      (row) => String(row.tool_id).trim() === toolId
    );
  }

  return NextResponse.json({
    submissions: finalRows,
    count:       finalRows.length,
    tool_id:     toolId,
  });
}
