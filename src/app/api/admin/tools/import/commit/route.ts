import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getServiceClient } from '@/lib/supabase';
import { normalizeImportConfig } from '@/lib/importConfig';
import { insertToolRow } from '@/lib/toolAccess';

/**
 * Saves a reviewed Import Wizard config: creates the tool (as a draft) and all
 * of its questions in one request. Requires `confirmed: true` — the browser
 * only sends it after the admin ticks "I have reviewed this configuration".
 * If any question fails to insert, the new tool is deleted again so no
 * half-imported quiz is left behind.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (body.confirmed !== true) {
    return NextResponse.json(
      { error: 'Review the configuration and confirm it before saving.' },
      { status: 400 }
    );
  }

  const { config, errors, warnings } = normalizeImportConfig(body.config);
  if (!config || errors.length > 0) {
    return NextResponse.json(
      { error: errors[0] ?? 'The configuration is not valid.', errors, warnings },
      { status: 400 }
    );
  }

  const workspace_id =
    auth.profile.role === 'provider_admin'
      ? auth.profile.workspace_id
      : (typeof body.workspace_id === 'string' && body.workspace_id) || null;

  const db = getServiceClient();

  const { data: slugConflict } = await db.from('tools').select('id').eq('slug', config.slug).maybeSingle();
  if (slugConflict) {
    return NextResponse.json(
      { error: `Slug "${config.slug}" is already in use by another tool. Change "slug" in the config and try again.` },
      { status: 409 }
    );
  }

  const provenanceNote = [
    `Imported via Import Wizard on ${new Date().toISOString().slice(0, 10)} by ${auth.profile.email}.`,
    config.result_strategy !== 'ai_generated'
      ? `Scoring provenance: ${config.scoring_provenance === 'source' ? 'taken from source material' : 'INFERRED — not confirmed against the original quiz'}.`
      : null,
    config.missing_information.length > 0
      ? `Missing from source: ${config.missing_information.join('; ')}`
      : null,
  ].filter(Boolean).join('\n');

  const { data: tool, error: toolErr, draftSupported } = await insertToolRow({
    title:                 config.title,
    slug:                  config.slug,
    description:           config.description,
    system_prompt:         config.system_prompt,
    result_strategy:       config.result_strategy,
    result_template:       config.result_template,
    scoring_config:        config.scoring_config,
    result_config:         config.result_config,
    provider_name:         config.provider_name,
    tool_mode:             'ai_result',
    email_capture_enabled: true,
    phone_capture_enabled: false,
    ghl_enabled:           false,
    workspace_id,
    admin_notes:           provenanceNote,
  });

  if (toolErr || !tool) {
    console.error('[import/commit] tool insert failed:', toolErr);
    return NextResponse.json({ error: 'Failed to create the tool. Nothing was saved.' }, { status: 500 });
  }

  const rows = config.questions.map((q, i) => ({ ...q, tool_id: tool.id, order_index: i }));
  const { data: inserted, error: qErr } = await db.from('questions').insert(rows).select('id');

  if (qErr || !inserted || inserted.length !== rows.length) {
    console.error('[import/commit] question insert failed — rolling back tool', tool.id, qErr);
    await db.from('tools').delete().eq('id', tool.id);
    return NextResponse.json(
      { error: 'Failed to save the questions, so the import was rolled back. Nothing was saved.' },
      { status: 500 }
    );
  }

  return NextResponse.json(
    {
      tool:              { id: tool.id, slug: tool.slug, title: tool.title },
      questions_created: inserted.length,
      draft_supported:   draftSupported,
      warnings,
    },
    { status: 201 }
  );
}
