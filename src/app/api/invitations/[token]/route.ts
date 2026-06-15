import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';

export async function GET(
  _req: NextRequest,
  { params }: { params: { token: string } }
) {
  const db = getServiceClient();

  const { data: invite, error } = await db
    .from('invitations')
    .select('*, workspaces(name)')
    .eq('token', params.token)
    .is('accepted_at', null)
    .gt('expires_at', new Date().toISOString())
    .single();

  if (error || !invite) {
    return NextResponse.json(
      { error: 'Invitation not found or has expired.' },
      { status: 404 }
    );
  }

  const ws = invite.workspaces as { name: string } | null;

  return NextResponse.json({
    email:          invite.email,
    full_name:      invite.full_name ?? null,
    role:           invite.role,
    workspace_name: ws?.name ?? null,
  });
}
