import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/auth';
import { getServiceClient } from '@/lib/supabase';

export async function POST(req: NextRequest) {
  const auth = await requireSuperAdmin();
  if (auth instanceof NextResponse) return auth;

  let body: {
    email?: string;
    full_name?: string;
    role?: string;
    workspace_id?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { email, full_name, role, workspace_id } = body;

  if (!email || !email.includes('@')) {
    return NextResponse.json({ error: 'A valid email is required.' }, { status: 400 });
  }
  if (!role || !['super_admin', 'provider_admin'].includes(role)) {
    return NextResponse.json(
      { error: 'role must be super_admin or provider_admin.' },
      { status: 400 }
    );
  }
  if (role === 'provider_admin' && !workspace_id) {
    return NextResponse.json(
      { error: 'workspace_id is required for provider_admin invitations.' },
      { status: 400 }
    );
  }

  const db = getServiceClient();

  // Verify workspace exists when provided
  if (workspace_id) {
    const { data: ws, error: wsErr } = await db
      .from('workspaces')
      .select('id')
      .eq('id', workspace_id)
      .single();
    if (wsErr || !ws) {
      return NextResponse.json({ error: 'Workspace not found.' }, { status: 404 });
    }
  }

  // Expire any existing pending invitation for this email + role + workspace
  const expireQuery = db
    .from('invitations')
    .update({ expires_at: new Date().toISOString() })
    .eq('email', email)
    .eq('role', role)
    .is('accepted_at', null);

  if (workspace_id) expireQuery.eq('workspace_id', workspace_id);
  else              expireQuery.is('workspace_id', null);

  await expireQuery;

  // Create invitation
  const { data: invite, error: invErr } = await db
    .from('invitations')
    .insert({
      email,
      full_name:    full_name    || null,
      role,
      workspace_id: workspace_id || null,
      created_by:   auth.profile.id,
    })
    .select()
    .single();

  if (invErr || !invite) {
    return NextResponse.json(
      { error: invErr?.message ?? 'Failed to create invitation.' },
      { status: 500 }
    );
  }

  const appUrl    = process.env.NEXT_PUBLIC_APP_URL ?? '';
  const inviteUrl = `${appUrl}/accept-invite/${invite.token}`;

  return NextResponse.json({
    invite_url:  inviteUrl,
    token:       invite.token,
    email,
    role,
    expires_at:  invite.expires_at,
  }, { status: 201 });
}
