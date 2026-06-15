import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getServiceClient } from '@/lib/supabase';

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const db     = getServiceClient();
  const toolId = String(params.id).trim();

  // Verify the requesting user can access this tool
  if (auth.profile.role !== 'super_admin') {
    const { data: tool } = await db
      .from('tools')
      .select('workspace_id')
      .eq('id', toolId)
      .single();

    if (!tool || tool.workspace_id !== auth.profile.workspace_id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

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
