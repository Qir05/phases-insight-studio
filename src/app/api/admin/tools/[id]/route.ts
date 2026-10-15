import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getServiceClient } from '@/lib/supabase';
import type { ResultStrategy, ScoringConfig, ResultConfig, Question } from '@/lib/supabase';
import { slugify } from '@/lib/utils';
import { validateResultConfig } from '@/lib/resultConfigValidation';
import { canAccessTool, toolStatus } from '@/lib/toolAccess';

const VALID_STRATEGIES: ResultStrategy[] = [
  'ai_generated',
  'structured_outcome',
  'hybrid_ai_with_outcome',
];

async function resolveTool(toolId: string) {
  const db = getServiceClient();
  const { data, error } = await db
    .from('tools')
    .select('*')
    .eq('id', toolId)
    .single();
  return { tool: data, error };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { tool, error } = await resolveTool(params.id);
  if (error || !tool) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (!canAccessTool(auth.profile.role, auth.profile.workspace_id, tool.workspace_id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return NextResponse.json({ tool });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { tool, error: findErr } = await resolveTool(params.id);
  if (findErr || !tool) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (!canAccessTool(auth.profile.role, auth.profile.workspace_id, tool.workspace_id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // Whitelist of simple fields a partial update may touch. id, slug, workspace_id,
  // status, scoring/result config etc. go through PUT / publish so they are validated.
  const PATCHABLE = [
    'title', 'description', 'email_capture_enabled', 'phone_capture_enabled',
    'provider_name', 'provider_logo_url', 'primary_color', 'admin_notes',
  ];
  const patch: Record<string, unknown> = {};
  for (const key of PATCHABLE) {
    if (body[key] !== undefined) patch[key] = body[key];
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  }

  const db = getServiceClient();
  const { data, error } = await db
    .from('tools')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', params.id)
    .select()
    .single();

  if (error) {
    console.error('[tool PATCH]', error);
    return NextResponse.json({ error: 'Failed to update tool' }, { status: 500 });
  }
  return NextResponse.json({ tool: data });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { tool, error: findErr } = await resolveTool(params.id);
  if (findErr || !tool) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (!canAccessTool(auth.profile.role, auth.profile.workspace_id, tool.workspace_id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const {
    title, slug: requestedSlug, description, system_prompt,
    email_capture_enabled, phone_capture_enabled,
    ghl_enabled, ghl_webhook_url, ghl_tag,
    provider_name, provider_logo_url, primary_color,
    tool_mode, webhook_url, redirect_url,
    result_strategy, scoring_config, result_config,
    result_template, admin_notes,
  } = body as {
    title?:             string;
    slug?:              string;
    description?:       string | null;
    system_prompt?:     string | null;
    email_capture_enabled?: boolean;
    phone_capture_enabled?: boolean;
    ghl_enabled?:       boolean;
    ghl_webhook_url?:   string | null;
    ghl_tag?:           string | null;
    provider_name?:     string | null;
    provider_logo_url?: string | null;
    primary_color?:     string | null;
    tool_mode?:         string;
    webhook_url?:       string | null;
    redirect_url?:      string | null;
    result_strategy?:   string;
    scoring_config?:    ScoringConfig | null;
    result_config?:     ResultConfig  | null;
    result_template?:   string | null;
    admin_notes?:       string | null;
  };

  if (!title || !title.trim()) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 });
  }

  const resolvedMode = tool_mode === 'smartform_redirect' ? 'smartform_redirect' : 'ai_result';
  const resolvedStrategy: ResultStrategy =
    VALID_STRATEGIES.includes(result_strategy as ResultStrategy)
      ? (result_strategy as ResultStrategy)
      : 'ai_generated';

  let warnings: string[] = [];

  if (resolvedMode === 'smartform_redirect') {
    if (!webhook_url || !webhook_url.trim()) {
      return NextResponse.json({ error: 'Webhook URL is required for SmartForm Redirect mode' }, { status: 400 });
    }
    if (!redirect_url || !redirect_url.trim()) {
      return NextResponse.json({ error: 'Redirect URL is required for SmartForm Redirect mode' }, { status: 400 });
    }
  } else if (resolvedStrategy === 'structured_outcome' || resolvedStrategy === 'hybrid_ai_with_outcome') {
    if (scoring_config !== null && scoring_config !== undefined && (typeof scoring_config !== 'object' || Array.isArray(scoring_config))) {
      return NextResponse.json({ error: 'scoring_config must be a JSON object' }, { status: 400 });
    }
    if (result_config !== null && result_config !== undefined && (typeof result_config !== 'object' || Array.isArray(result_config))) {
      return NextResponse.json({ error: 'result_config must be a JSON object' }, { status: 400 });
    }

    const { errors: configErrors, warnings: configWarnings } = validateResultConfig(
      resolvedMode,
      resolvedStrategy,
      scoring_config ?? null,
      result_config ?? null,
    );
    if (configErrors.length > 0) {
      return NextResponse.json({ error: configErrors[0], errors: configErrors }, { status: 400 });
    }
    warnings = configWarnings;
  } else if (resolvedStrategy === 'ai_generated') {
    const hasSystemPrompt   = typeof system_prompt   === 'string' && system_prompt.trim().length   > 0;
    const hasResultTemplate = typeof result_template === 'string' && result_template.trim().length > 0;
    if (!hasSystemPrompt && !hasResultTemplate) {
      return NextResponse.json(
        { error: 'ai_generated strategy requires a System Prompt or Result Template' },
        { status: 400 }
      );
    }
  }

  const db = getServiceClient();

  // Question-aware checks (unmapped categories, unreachable outcomes, score gaps…).
  // They block saving only when the tool is live, so drafts can be saved mid-edit.
  if (resolvedMode !== 'smartform_redirect' && resolvedStrategy !== 'ai_generated') {
    const { data: qs } = await db.from('questions').select('label, variable_name, field_type, options, category').eq('tool_id', params.id);
    const full = validateResultConfig(resolvedMode, resolvedStrategy, scoring_config ?? null, result_config ?? null, (qs ?? []) as Question[]);
    const questionErrors = full.errors.filter((e) => !warnings.includes(e));
    if (questionErrors.length > 0 && toolStatus(tool) === 'published') {
      return NextResponse.json(
        {
          error: `This tool is live, so this change was not saved: ${questionErrors[0]} Fix it, or unpublish the tool first.`,
          errors: questionErrors,
        },
        { status: 400 }
      );
    }
    warnings = Array.from(new Set([...warnings, ...full.warnings, ...questionErrors]));
  }

  const finalSlug = slugify((requestedSlug && requestedSlug.trim()) || title);
  if (!finalSlug) {
    return NextResponse.json({ error: 'Slug must contain at least one letter or number' }, { status: 400 });
  }

  if (finalSlug !== tool.slug) {
    const { data: conflict } = await db
      .from('tools')
      .select('id')
      .eq('slug', finalSlug)
      .neq('id', params.id)
      .maybeSingle();
    if (conflict) {
      return NextResponse.json({ error: `Slug "${finalSlug}" is already in use by another tool` }, { status: 409 });
    }
  }

  const { data, error } = await db
    .from('tools')
    .update({
      title:                  title.trim(),
      slug:                   finalSlug,
      description:            description          ?? null,
      system_prompt:          system_prompt        ?? null,
      email_capture_enabled:  email_capture_enabled ?? true,
      phone_capture_enabled:  phone_capture_enabled ?? false,
      ghl_enabled:            ghl_enabled           ?? false,
      ghl_webhook_url:        ghl_webhook_url       ?? null,
      ghl_tag:                ghl_tag               ?? null,
      provider_name:          provider_name         ?? null,
      provider_logo_url:      provider_logo_url     ?? null,
      primary_color:          primary_color         ?? null,
      tool_mode:              resolvedMode,
      webhook_url:            webhook_url           ?? null,
      redirect_url:           redirect_url          ?? null,
      result_strategy:        resolvedStrategy,
      scoring_config:         scoring_config        ?? null,
      result_config:          result_config         ?? null,
      result_template:        result_template       ?? null,
      admin_notes:            admin_notes           ?? null,
      updated_at:             new Date().toISOString(),
    })
    .eq('id', params.id)
    .select()
    .single();

  if (error) {
    console.error('[tool PUT]', error);
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 });
  }
  return NextResponse.json({ tool: data, warnings });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { tool, error: findErr } = await resolveTool(params.id);
  if (findErr || !tool) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (!canAccessTool(auth.profile.role, auth.profile.workspace_id, tool.workspace_id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const db = getServiceClient();
  const { error } = await db.from('tools').delete().eq('id', params.id);
  if (error) {
    console.error('[tool DELETE]', error);
    return NextResponse.json({ error: 'Failed to delete tool' }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
