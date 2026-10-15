import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getServiceClient } from '@/lib/supabase';
import type { Question } from '@/lib/supabase';
import { loadToolForAdmin, isMissingColumnError, toolStatus } from '@/lib/toolAccess';
import { validateForPublish } from '@/lib/resultConfigValidation';

/** GET — publish readiness (validation report) without changing anything. */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const access = await loadToolForAdmin(params.id, auth.profile);
  if ('response' in access) return access.response;

  const db = getServiceClient();
  const { data: qs } = await db.from('questions').select('*').eq('tool_id', params.id).order('order_index');
  const report = validateForPublish(access.tool, (qs ?? []) as Question[]);

  return NextResponse.json({
    status:          toolStatus(access.tool),
    draft_supported: 'status' in access.tool,
    ...report,
  });
}

/**
 * POST { publish: true }  — validates the full config (with questions) and makes the tool public.
 * POST { publish: false } — takes the tool offline (public link returns "not found").
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const access = await loadToolForAdmin(params.id, auth.profile);
  if ('response' in access) return access.response;

  let body: { publish?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (typeof body.publish !== 'boolean') {
    return NextResponse.json({ error: '"publish" must be true or false' }, { status: 400 });
  }

  const db = getServiceClient();

  if (body.publish) {
    const { data: qs } = await db.from('questions').select('*').eq('tool_id', params.id).order('order_index');
    const report = validateForPublish(access.tool, (qs ?? []) as Question[]);
    if (report.errors.length > 0) {
      return NextResponse.json(
        { error: `Cannot publish yet: ${report.errors[0]}`, ...report },
        { status: 400 }
      );
    }
  }

  const status = body.publish ? 'published' : 'draft';
  const { data, error } = await db
    .from('tools')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', params.id)
    .select('id, status')
    .single();

  if (error) {
    if (isMissingColumnError(error, 'status')) {
      return NextResponse.json(
        { error: 'Draft/publish needs database migration 009_publish_status_and_rls.sql. Until it runs, every tool is public.' },
        { status: 409 }
      );
    }
    console.error('[publish]', error);
    return NextResponse.json({ error: 'Failed to update publish status' }, { status: 500 });
  }

  return NextResponse.json({ status: data.status });
}
