import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';

export async function POST(
  req: NextRequest,
  { params }: { params: { token: string } }
) {
  let body: { password?: string; full_name?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { password, full_name } = body;
  if (!password || password.length < 8) {
    return NextResponse.json(
      { error: 'Password must be at least 8 characters.' },
      { status: 400 }
    );
  }

  const db = getServiceClient();

  // Validate invitation
  const { data: invite, error: invErr } = await db
    .from('invitations')
    .select('*')
    .eq('token', params.token)
    .is('accepted_at', null)
    .gt('expires_at', new Date().toISOString())
    .single();

  if (invErr || !invite) {
    return NextResponse.json(
      { error: 'Invitation not found or has expired.' },
      { status: 404 }
    );
  }

  // Claim the invitation first (conditional update) so two concurrent accepts
  // cannot both proceed. Released again below if account creation fails.
  const claimedAt = new Date().toISOString();
  const { data: claimed, error: claimErr } = await db
    .from('invitations')
    .update({ accepted_at: claimedAt })
    .eq('id', invite.id)
    .is('accepted_at', null)
    .select('id')
    .maybeSingle();

  if (claimErr || !claimed) {
    return NextResponse.json(
      { error: 'Invitation not found or has expired.' },
      { status: 404 }
    );
  }

  const release = () =>
    db.from('invitations').update({ accepted_at: null }).eq('id', invite.id).eq('accepted_at', claimedAt);

  // Create Supabase auth user
  const { data: authData, error: authErr } = await db.auth.admin.createUser({
    email:         invite.email,
    password,
    email_confirm: true,
  });

  if (authErr || !authData.user) {
    await release();
    const exists = (authErr?.message ?? '').toLowerCase().includes('already');
    console.error('[invite accept] createUser failed:', authErr?.message);
    return NextResponse.json(
      { error: exists ? 'An account with this email already exists. Try signing in instead.' : 'Failed to create account.' },
      { status: exists ? 409 : 500 }
    );
  }

  // Resolve final full_name: prefer what the user submitted, fall back to invitation's
  const resolvedName = (full_name?.trim() || invite.full_name || null);

  // Create profile — role and workspace come from the invitation
  const { error: profileErr } = await db.from('profiles').insert({
    user_id:      authData.user.id,
    email:        invite.email,
    full_name:    resolvedName,
    role:         invite.role,
    workspace_id: invite.workspace_id ?? null,
    invited_by:   invite.created_by,
    is_active:    true,
  });

  if (profileErr) {
    await db.auth.admin.deleteUser(authData.user.id);
    await release();
    return NextResponse.json(
      { error: 'Failed to create profile. Please contact your administrator.' },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}
