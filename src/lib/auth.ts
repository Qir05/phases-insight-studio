import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getServiceClient } from './supabase';
import type { Profile } from './supabase';
import type { User } from '@supabase/supabase-js';

export function createSupabaseServerClient() {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (cookieStore as any).set(name, value, options)
            );
          } catch {
            // read-only context (server component) — ignored
          }
        },
      },
    }
  );
}

export async function getSessionUser(): Promise<User | null> {
  const supabase = createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user ?? null;
}

export async function getProfile(userId: string): Promise<Profile | null> {
  const db = getServiceClient();
  const { data } = await db
    .from('profiles')
    .select('*')
    .eq('user_id', userId)
    .single();
  return (data as Profile | null) ?? null;
}

export type AuthOk = { user: User; profile: Profile };

export async function requireAuth(): Promise<AuthOk | NextResponse> {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const profile = await getProfile(user.id);
  if (!profile || !profile.is_active) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return { user, profile };
}

export async function requireSuperAdmin(): Promise<AuthOk | NextResponse> {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  if (auth.profile.role !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return auth;
}
