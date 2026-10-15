import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getServiceClient } from '@/lib/supabase';
import { loadToolForAdmin } from '@/lib/toolAccess';
import { normalizeOptions } from '@/lib/importConfig';

const VALID_TYPES = ['text', 'textarea', 'radio', 'checkbox', 'dropdown', 'number'];
const OPTIONS_TYPES = ['radio', 'checkbox', 'dropdown'];

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; qid: string } }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const access = await loadToolForAdmin(params.id, auth.profile);
  if ('response' in access) return access.response;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // Whitelist — tool_id, id and order_index can never be changed through this route.
  const patch: Record<string, unknown> = {};
  if (body.label !== undefined) {
    if (typeof body.label !== 'string' || !body.label.trim()) {
      return NextResponse.json({ error: 'label cannot be empty' }, { status: 400 });
    }
    patch.label = body.label.trim();
  }
  if (body.variable_name !== undefined) patch.variable_name = String(body.variable_name ?? '').trim();
  if (body.field_type !== undefined) {
    if (!VALID_TYPES.includes(String(body.field_type))) {
      return NextResponse.json({ error: `field_type must be one of: ${VALID_TYPES.join(', ')}` }, { status: 400 });
    }
    patch.field_type = body.field_type;
  }
  if (body.options !== undefined) {
    if (body.options !== null && !Array.isArray(body.options)) {
      return NextResponse.json({ error: 'options must be an array or null' }, { status: 400 });
    }
    const { options, errors } = normalizeOptions(body.options as unknown[] | null);
    if (errors.length > 0) return NextResponse.json({ error: errors[0], errors }, { status: 400 });
    patch.options = options;
  }
  if (body.required !== undefined)    patch.required    = !!body.required;
  if (body.scoring_key !== undefined) patch.scoring_key = body.scoring_key ? String(body.scoring_key) : null;
  if (body.category !== undefined)    patch.category    = body.category ? String(body.category) : null;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  }

  const db = getServiceClient();
  const { data: existing } = await db
    .from('questions')
    .select('label, field_type, options')
    .eq('id', params.qid)
    .eq('tool_id', params.id)
    .maybeSingle();
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const finalType = (patch.field_type ?? existing.field_type) as string;
  const finalOptions = patch.options !== undefined ? patch.options : existing.options;
  if (OPTIONS_TYPES.includes(finalType) && (!Array.isArray(finalOptions) || finalOptions.length === 0)) {
    return NextResponse.json({ error: 'Choice questions need at least one option' }, { status: 400 });
  }
  if (!OPTIONS_TYPES.includes(finalType)) patch.options = null;

  if (patch.label && patch.label !== existing.label) {
    const { data: dup } = await db
      .from('questions')
      .select('id')
      .eq('tool_id', params.id)
      .eq('label', patch.label as string)
      .neq('id', params.qid)
      .maybeSingle();
    if (dup) return NextResponse.json({ error: 'Another question already uses this text' }, { status: 409 });
  }

  const { data, error } = await db
    .from('questions')
    .update(patch)
    .eq('id', params.qid)
    .eq('tool_id', params.id)
    .select()
    .single();

  if (error) {
    console.error('[question PATCH]', error);
    return NextResponse.json({ error: 'Failed to update question' }, { status: 500 });
  }
  return NextResponse.json({ question: data });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; qid: string } }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const access = await loadToolForAdmin(params.id, auth.profile);
  if ('response' in access) return access.response;

  const db = getServiceClient();
  const { error } = await db
    .from('questions')
    .delete()
    .eq('id', params.qid)
    .eq('tool_id', params.id);

  if (error) {
    console.error('[question DELETE]', error);
    return NextResponse.json({ error: 'Failed to delete question' }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
