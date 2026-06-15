import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/auth';
import { getServiceClient } from '@/lib/supabase';
import { slugify } from '@/lib/utils';

export async function GET() {
  const auth = await requireSuperAdmin();
  if (auth instanceof NextResponse) return auth;

  const db = getServiceClient();
  const { data, error } = await db
    .from('workspaces')
    .select('*, profiles(count)')
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ workspaces: data });
}

export async function POST(req: NextRequest) {
  const auth = await requireSuperAdmin();
  if (auth instanceof NextResponse) return auth;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { name, logo_url, primary_color, ghl_webhook_url, ghl_tag } = body as {
    name?: string;
    logo_url?: string;
    primary_color?: string;
    ghl_webhook_url?: string;
    ghl_tag?: string;
  };

  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });

  const db = getServiceClient();
  const { data, error } = await db
    .from('workspaces')
    .insert({
      name,
      slug:            slugify(name),
      logo_url:        logo_url        ?? null,
      primary_color:   primary_color   ?? null,
      ghl_webhook_url: ghl_webhook_url ?? null,
      ghl_tag:         ghl_tag         ?? null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ workspace: data }, { status: 201 });
}
