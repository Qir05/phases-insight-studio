import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';
import type { Question, Tool } from '@/lib/supabase';
import { publicQuestion, publicTool } from '@/lib/publicProjection';
import { canAccessTool, toolStatus } from '@/lib/toolAccess';
import { getSessionUser, getProfile } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * Public quiz definition. Returns only what the quiz page needs to render —
 * never prompts, scoring/result config, webhook URLs or option categories.
 * Draft tools 404 unless `?preview=1` is sent by a signed-in admin who can
 * access the tool.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { slug: string } }
) {
  const db = getServiceClient();

  const { data, error: toolErr } = await db
    .from('tools')
    .select('*')
    .eq('slug', params.slug)
    .maybeSingle();

  if (toolErr) {
    console.error('[tools/slug GET] tool lookup failed:', toolErr.code, toolErr.message);
    return NextResponse.json({ error: 'Tool not found' }, { status: 404 });
  }
  const tool = data as Tool | null;
  if (!tool) return NextResponse.json({ error: 'Tool not found' }, { status: 404 });

  const status = toolStatus(tool);

  // ?preview=1 from a signed-in admin who can access the tool → non-persistent
  // preview mode (submissions go to the admin preview endpoint: nothing saved,
  // no webhooks) — for drafts AND published tools. Anyone else gets the normal
  // public behaviour, and drafts stay invisible to them.
  let preview = false;
  if (req.nextUrl.searchParams.get('preview') === '1') {
    const user = await getSessionUser();
    const profile = user ? await getProfile(user.id) : null;
    preview = !!profile && profile.is_active && canAccessTool(profile.role, profile.workspace_id, tool.workspace_id);
  }
  if (status !== 'published' && !preview) {
    return NextResponse.json({ error: 'Tool not found' }, { status: 404 });
  }

  const { data: questions, error: qErr } = await db
    .from('questions')
    .select('*')
    .eq('tool_id', tool.id)
    .order('order_index');

  if (qErr) {
    console.error('[tools/slug GET] questions error:', qErr.code, qErr.message);
  }

  return NextResponse.json(
    {
      tool:      publicTool(tool),
      questions: ((questions ?? []) as Question[]).map(publicQuestion),
      status,
      preview,
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
