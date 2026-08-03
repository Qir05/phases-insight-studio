import { randomInt } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/auth';
import { getServiceClient } from '@/lib/supabase';

const CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%^&*';

function generateTemporaryPassword(length = 16): string {
  let password = '';
  for (let i = 0; i < length; i++) {
    password += CHARSET[randomInt(CHARSET.length)];
  }
  return password;
}

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

  const { data: existing, error: getErr } = await db.auth.admin.getUserById(params.uid);
  if (getErr || !existing.user) {
    return NextResponse.json({ error: 'User not found.' }, { status: 404 });
  }

  const temporaryPassword = generateTemporaryPassword();

  const { error } = await db.auth.admin.updateUserById(params.uid, {
    password: temporaryPassword,
    user_metadata: { ...existing.user.user_metadata, must_change_password: true },
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ temporaryPassword });
}
