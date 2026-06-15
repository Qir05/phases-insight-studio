import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/auth';

export async function POST() {
  const supabase = createSupabaseServerClient();
  await supabase.auth.signOut();
  return NextResponse.json({ success: true });
}
