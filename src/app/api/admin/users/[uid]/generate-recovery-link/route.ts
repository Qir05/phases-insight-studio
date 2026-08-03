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
  const { data, error } = await db.auth.admin.generateLink({
    type: 'recovery',
    email: profile.email,
    options: { redirectTo: `${appUrl}/reset-password` },
  });

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'Failed to generate link.' }, { status: 500 });
  }

  return NextResponse.json({ link: data.properties.action_link });
}
