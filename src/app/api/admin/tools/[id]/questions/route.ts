import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getServiceClient } from '@/lib/supabase';
import { normalizeOptions, toVarName } from '@/lib/importConfig';

async function assertToolAccess(
  toolId: string,
  role: string,
  workspaceId: string | null
): Promise<NextResponse | null> {
  if (role === 'super_admin') return null;
  const db = getServiceClient();
  const { data: tool } = await db
    .from('tools')
    .select('workspace_id')
    .eq('id', toolId)
    .single();
  if (!tool || tool.workspace_id !== workspaceId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const deny = await assertToolAccess(params.id, auth.profile.role, auth.profile.workspace_id);
  if (deny) return deny;

  const db = getServiceClient();
  const { data, error } = await db
    .from('questions')
    .select('*')
    .eq('tool_id', params.id)
    .order('order_index');

  if (error) {
    console.error('[questions GET]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ questions: data });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const deny = await assertToolAccess(params.id, auth.profile.role, auth.profile.workspace_id);
  if (deny) return deny;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const {
    label,
    variable_name,
    field_type,
    options,
    required,
    scoring_key,
    category,
  } = body as {
    label?:        string;
    variable_name?: string;
    field_type?:   string;
    options?:      unknown[] | null;
    required?:     boolean;
    scoring_key?:  string;
    category?:     string;
  };

  if (!label || !String(label).trim()) return NextResponse.json({ error: 'label is required' }, { status: 400 });
  if (!field_type) return NextResponse.json({ error: 'field_type is required' }, { status: 400 });

  const VALID_TYPES = ['text', 'textarea', 'radio', 'checkbox', 'dropdown', 'number'];
  if (!VALID_TYPES.includes(field_type)) {
    return NextResponse.json(
      { error: `field_type must be one of: ${VALID_TYPES.join(', ')}` },
      { status: 400 }
    );
  }

  const db = getServiceClient();

  const { data: existing, error: idxErr } = await db
    .from('questions')
    .select('order_index')
    .eq('tool_id', params.id)
    .order('order_index', { ascending: false })
    .limit(1);

  if (idxErr) {
    console.error('[questions POST – fetch order_index]', idxErr);
    return NextResponse.json({ error: idxErr.message }, { status: 500 });
  }

  const nextIdx = existing && existing.length > 0 ? (existing[0].order_index ?? 0) + 1 : 0;

  const OPTIONS_TYPES = ['radio', 'checkbox', 'dropdown'];
  const { options: cleanOptions, errors: optionErrors } = normalizeOptions(Array.isArray(options) ? options : null);
  if (optionErrors.length > 0) {
    return NextResponse.json({ error: optionErrors[0], errors: optionErrors }, { status: 400 });
  }
  const normalisedOptions = OPTIONS_TYPES.includes(field_type) ? cleanOptions : null;
  if (OPTIONS_TYPES.includes(field_type) && !normalisedOptions) {
    return NextResponse.json({ error: 'Choice questions need at least one option' }, { status: 400 });
  }

  const { data: dup } = await db
    .from('questions')
    .select('id')
    .eq('tool_id', params.id)
    .eq('label', label.trim())
    .maybeSingle();
  if (dup) {
    return NextResponse.json({ error: 'Another question in this tool already uses this text' }, { status: 409 });
  }

  const { data, error } = await db
    .from('questions')
    .insert({
      tool_id:      params.id,
      label:        label.trim(),
      variable_name: (variable_name ?? '').trim() || toVarName(label),
      field_type,
      options:      normalisedOptions,
      required:     required ?? true,
      order_index:  nextIdx,
      scoring_key:  scoring_key ?? null,
      category:     category    ?? null,
    })
    .select()
    .single();

  if (error) {
    console.error('[questions POST – insert]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ question: data }, { status: 201 });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const deny = await assertToolAccess(params.id, auth.profile.role, auth.profile.workspace_id);
  if (deny) return deny;

  let body: { questions?: { id: string; order_index: number }[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { questions } = body;
  if (!Array.isArray(questions)) {
    return NextResponse.json({ error: 'questions array is required' }, { status: 400 });
  }

  if (!questions.every((q) => typeof q?.id === 'string' && Number.isInteger(q?.order_index))) {
    return NextResponse.json({ error: 'Each question needs an id and an integer order_index' }, { status: 400 });
  }

  const db      = getServiceClient();
  // Scoped to this tool so a reorder request can never touch another tool's questions.
  const updates = questions.map((q) =>
    db.from('questions').update({ order_index: q.order_index }).eq('id', q.id).eq('tool_id', params.id)
  );
  const results = await Promise.all(updates);
  const failed = results.find((r) => r.error);
  if (failed?.error) {
    console.error('[questions PUT – reorder]', failed.error);
    return NextResponse.json({ error: 'Failed to save the new order' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
