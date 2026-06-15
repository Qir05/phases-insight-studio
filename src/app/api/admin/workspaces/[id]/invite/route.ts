import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/auth';
import { getServiceClient } from '@/lib/supabase';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireSuperAdmin();
  if (auth instanceof NextResponse) return auth;

  const { email } = await req.json() as { email?: string };
  if (!email || !email.includes('@')) {
    return NextResponse.json({ error: 'A valid email is required.' }, { status: 400 });
  }

  const db = getServiceClient();

  // Confirm the workspace exists
  const { data: ws, error: wsErr } = await db
    .from('workspaces')
    .select('id, name')
    .eq('id', params.id)
    .single();

  if (wsErr || !ws) {
    return NextResponse.json({ error: 'Workspace not found.' }, { status: 404 });
  }

  // Expire any existing pending invite for this email+workspace
  await db
    .from('invitations')
    .update({ expires_at: new Date().toISOString() })
    .eq('email', email)
    .eq('workspace_id', params.id)
    .is('accepted_at', null);

  // Create new invitation
  const { data: invite, error: invErr } = await db
    .from('invitations')
    .insert({
      email,
      workspace_id: params.id,
      role:         'provider_admin',
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
    expires_at:  invite.expires_at,
  }, { status: 201 });
}
