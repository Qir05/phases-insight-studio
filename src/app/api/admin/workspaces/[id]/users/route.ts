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

  let body: { user_id?: string; is_active?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const { user_id, is_active } = body;

  if (!user_id || typeof is_active !== 'boolean') {
    return NextResponse.json(
      { error: 'user_id and is_active are required' },
      { status: 400 }
    );
  }

  if (user_id === auth.user.id) {
    return NextResponse.json({ error: 'You cannot change your own account here.' }, { status: 400 });
  }

  const db = getServiceClient();

  const { data: target } = await db.from('profiles').select('role').eq('user_id', user_id).maybeSingle();
  if (target?.role === 'super_admin') {
    return NextResponse.json({ error: 'Manage super admins from the Users page.' }, { status: 400 });
  }
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
