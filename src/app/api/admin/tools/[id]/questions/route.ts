import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
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
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { label, variable_name, field_type, options, required } = body as {
    label?: string;
    variable_name?: string;
    field_type?: string;
    options?: string[] | null;
    required?: boolean;
  };

  if (!label) return NextResponse.json({ error: 'label is required' }, { status: 400 });
  if (!field_type) return NextResponse.json({ error: 'field_type is required' }, { status: 400 });

  const VALID_TYPES = ['text', 'textarea', 'radio', 'checkbox', 'dropdown', 'number'];
  if (!VALID_TYPES.includes(field_type)) {
    return NextResponse.json(
      { error: `field_type must be one of: ${VALID_TYPES.join(', ')}` },
      { status: 400 }
    );
  }

  const db = getServiceClient();

  // Determine the next order_index
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

  // Normalise options: only keep non-empty arrays for types that use them
  const OPTIONS_TYPES = ['radio', 'checkbox', 'dropdown'];
  const normalisedOptions =
    OPTIONS_TYPES.includes(field_type) && Array.isArray(options) && options.length > 0
      ? options
      : null;

  const { data, error } = await db
    .from('questions')
    .insert({
      tool_id: params.id,
      label,
      variable_name: (variable_name ?? '').trim(),
      field_type,
      options: normalisedOptions,
      required: required ?? true,
      order_index: nextIdx,
    })
    .select()
    .single();

  if (error) {
    console.error('[questions POST – insert]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ question: data }, { status: 201 });
}

export async function PUT(req: NextRequest) {
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

  const db = getServiceClient();
  const updates = questions.map((q) =>
    db.from('questions').update({ order_index: q.order_index }).eq('id', q.id)
  );
  await Promise.all(updates);

  return NextResponse.json({ success: true });
}
