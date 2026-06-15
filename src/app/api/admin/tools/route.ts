import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getServiceClient } from '@/lib/supabase';
import { slugify } from '@/lib/utils';

export async function GET() {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const db = getServiceClient();

  let query = db
    .from('tools')
    .select('*, submissions(count), questions(count)')
    .order('created_at', { ascending: false });

  // Provider admins see only their workspace's tools
  if (auth.profile.role === 'provider_admin') {
    if (!auth.profile.workspace_id) {
      return NextResponse.json({ tools: [] });
    }
    query = query.eq('workspace_id', auth.profile.workspace_id);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tools: data });
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const body = await req.json();
  const {
    title, description, system_prompt,
    email_capture_enabled, phone_capture_enabled,
    ghl_enabled, ghl_webhook_url, ghl_tag,
    provider_name, provider_logo_url, primary_color,
    workspace_id: requestedWorkspaceId,
  } = body;

  if (!title || !system_prompt) {
    return NextResponse.json(
      { error: 'title and system_prompt are required' },
      { status: 400 }
    );
  }

  // Workspace assignment: provider_admin is always locked to their own workspace
  const workspace_id =
    auth.profile.role === 'provider_admin'
      ? auth.profile.workspace_id
      : (requestedWorkspaceId ?? null);

  const db   = getServiceClient();
  const slug = slugify(title);

  const { data, error } = await db
    .from('tools')
    .insert({
      title,
      slug,
      description:             description          ?? null,
      system_prompt,
      email_capture_enabled:   email_capture_enabled ?? true,
      phone_capture_enabled:   phone_capture_enabled ?? false,
      ghl_enabled:             ghl_enabled           ?? false,
      ghl_webhook_url:         ghl_webhook_url       ?? null,
      ghl_tag:                 ghl_tag               ?? null,
      provider_name:           provider_name         ?? null,
      provider_logo_url:       provider_logo_url     ?? null,
      primary_color:           primary_color         ?? null,
      workspace_id,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tool: data }, { status: 201 });
}
