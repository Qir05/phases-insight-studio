import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getServiceClient } from '@/lib/supabase';

async function resolveTool(toolId: string) {
  const db = getServiceClient();
  const { data, error } = await db
    .from('tools')
    .select('*')
    .eq('id', toolId)
    .single();
  return { tool: data, error };
}

function canAccessTool(
  role: string,
  workspaceId: string | null,
  toolWorkspaceId: string | null
): boolean {
  if (role === 'super_admin') return true;
  // provider_admin must share a workspace_id
  return !!workspaceId && workspaceId === toolWorkspaceId;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { tool, error } = await resolveTool(params.id);
  if (error || !tool) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (!canAccessTool(auth.profile.role, auth.profile.workspace_id, tool.workspace_id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return NextResponse.json({ tool });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { tool, error: findErr } = await resolveTool(params.id);
  if (findErr || !tool) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (!canAccessTool(auth.profile.role, auth.profile.workspace_id, tool.workspace_id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json();
  const db   = getServiceClient();

  const { data, error } = await db
    .from('tools')
    .update({ ...body, updated_at: new Date().toISOString() })
    .eq('id', params.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tool: data });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { tool, error: findErr } = await resolveTool(params.id);
  if (findErr || !tool) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (!canAccessTool(auth.profile.role, auth.profile.workspace_id, tool.workspace_id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const db = getServiceClient();
  const { error } = await db.from('tools').delete().eq('id', params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
