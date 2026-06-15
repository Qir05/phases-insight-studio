import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/auth';
import { getServiceClient } from '@/lib/supabase';

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireSuperAdmin();
  if (auth instanceof NextResponse) return auth;

  const db = getServiceClient();
  const { data, error } = await db
    .from('profiles')
    .select('*')
    .eq('workspace_id', params.id)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ users: data ?? [] });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireSuperAdmin();
  if (auth instanceof NextResponse) return auth;

  const { user_id, is_active } = await req.json() as {
    user_id?: string;
    is_active?: boolean;
  };

  if (!user_id || typeof is_active !== 'boolean') {
    return NextResponse.json(
      { error: 'user_id and is_active are required' },
      { status: 400 }
    );
  }

  const db = getServiceClient();
  const { data, error } = await db
    .from('profiles')
    .update({ is_active })
    .eq('user_id', user_id)
    .eq('workspace_id', params.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ user: data });
}
