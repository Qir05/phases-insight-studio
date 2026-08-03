import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/auth';
import { getServiceClient } from '@/lib/supabase';

export async function POST(
  req: NextRequest,
  { params }: { params: { uid: string } }
) {
  const auth = await requireSuperAdmin();
  if (auth instanceof NextResponse) return auth;

  if (auth.user.id === params.uid) {
    return NextResponse.json({ error: 'You cannot perform this action on your own account.' }, { status: 400 });
  }

  const db = getServiceClient();
  const { data: profile, error: profileErr } = await db
    .from('profiles')
    .select('email')
    .eq('user_id', params.uid)
    .single();

  if (profileErr || !profile) {
    return NextResponse.json({ error: 'User not found.' }, { status: 404 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';
  const { error } = await db.auth.resetPasswordForEmail(profile.email, {
    redirectTo: `${appUrl}/reset-password`,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
