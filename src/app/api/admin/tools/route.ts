import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getServiceClient } from '@/lib/supabase';
import type { ResultStrategy } from '@/lib/supabase';
import { slugify } from '@/lib/utils';

const VALID_STRATEGIES: ResultStrategy[] = [
  'ai_generated',
  'structured_outcome',
  'hybrid_ai_with_outcome',
];

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
    tool_mode, webhook_url, redirect_url,
    workspace_id: requestedWorkspaceId,
    // Result engine fields
    result_strategy,
    scoring_config,
    result_config,
    result_template,
    admin_notes,
  } = body;

  const resolvedMode = tool_mode === 'smartform_redirect' ? 'smartform_redirect' : 'ai_result';

  const resolvedStrategy: ResultStrategy =
    VALID_STRATEGIES.includes(result_strategy)
      ? (result_strategy as ResultStrategy)
      : 'ai_generated';

  if (!title) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 });
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
      system_prompt:           system_prompt        ?? null,
      email_capture_enabled:   email_capture_enabled ?? true,
      phone_capture_enabled:   phone_capture_enabled ?? false,
      ghl_enabled:             ghl_enabled           ?? false,
      ghl_webhook_url:         ghl_webhook_url       ?? null,
      ghl_tag:                 ghl_tag               ?? null,
      provider_name:           provider_name         ?? null,
      provider_logo_url:       provider_logo_url     ?? null,
      primary_color:           primary_color         ?? null,
      tool_mode:               resolvedMode,
      webhook_url:             webhook_url           ?? null,
      redirect_url:            redirect_url          ?? null,
      workspace_id,
      // Result engine
      result_strategy:         resolvedStrategy,
      scoring_config:          scoring_config        ?? null,
      result_config:           result_config         ?? null,
      result_template:         result_template       ?? null,
      admin_notes:             admin_notes           ?? null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tool: data }, { status: 201 });
}
