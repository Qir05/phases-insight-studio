import { randomBytes } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';
import { generateResult } from '@/lib/groq';
import { compilePrompt } from '@/lib/utils';

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { slug, answers, firstName, lastName, email, phone } = body as {
    slug?: string;
    answers?: Record<string, string | string[]>;
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
  };

  if (!slug || !email || !answers) {
    return NextResponse.json(
      { error: 'Missing required fields: slug, email, answers' },
      { status: 400 }
    );
  }

  const db = getServiceClient();

  const { data: tool, error: toolErr } = await db
    .from('tools')
    .select('*')
    .eq('slug', slug)
    .single();

  if (toolErr || !tool) {
    console.error('[generate] Tool not found for slug:', slug, toolErr?.message);
    return NextResponse.json({ error: 'Tool not found' }, { status: 404 });
  }

  const compiledPrompt = compilePrompt(tool.system_prompt, answers);

  let aiResult: string;
  try {
    aiResult = await generateResult(compiledPrompt);
  } catch (err) {
    console.error('[generate] Groq error:', err);
    return NextResponse.json({ error: 'AI generation failed' }, { status: 500 });
  }

  // Generate token in app code — removes dependency on pgcrypto DB extension
  const resultToken = randomBytes(24).toString('hex');

  const { data: submission, error: subErr } = await db
    .from('submissions')
    .insert({
      tool_id:         tool.id,
      first_name:      firstName     || null,
      last_name:       lastName      || null,
      email,
      phone:           phone         || null,
      answers,
      compiled_prompt: compiledPrompt,
      ai_result:       aiResult,
      result_token:    resultToken,
      ghl_sync_status: tool.ghl_enabled ? 'pending' : 'skipped',
    })
    .select()
    .single();

  if (subErr || !submission) {
    console.error('[generate] Supabase insert FAILED:', subErr?.code, subErr?.message, subErr?.details);
    return NextResponse.json(
      {
        error:  'Failed to save submission',
        detail: subErr?.message ?? 'Unknown Supabase error',
        hint:   subErr?.hint   ?? undefined,
        code:   subErr?.code   ?? undefined,
      },
      { status: 500 }
    );
  }

  const appUrl    = process.env.NEXT_PUBLIC_APP_URL ?? '';
  const resultUrl = `${appUrl}/r/${submission.result_token}`;

  // GHL webhook — non-blocking
  if (tool.ghl_enabled && tool.ghl_webhook_url) {
    const payload = {
      firstName:  firstName  ?? '',
      lastName:   lastName   ?? '',
      email,
      phone:      phone      ?? '',
      toolTitle:  tool.title,
      toolSlug:   tool.slug,
      tag:        tool.ghl_tag ?? '',
      answers,
      aiResult,
      resultUrl,
      source: 'Phases Insight Studio',
    };

    try {
      const ghlRes  = await fetch(tool.ghl_webhook_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const ghlJson = await ghlRes.json().catch(() => ({}));
      await db
        .from('submissions')
        .update({ ghl_sync_status: 'success', ghl_response: ghlJson })
        .eq('id', submission.id);
    } catch (err) {
      console.error('[generate] GHL webhook error:', err);
      await db
        .from('submissions')
        .update({ ghl_sync_status: 'failed', ghl_response: { error: String(err) } })
        .eq('id', submission.id);
    }
  }

  return NextResponse.json({
    aiResult,
    submission_id: submission.id,
    result_token:  submission.result_token,
    result_url:    resultUrl,
    resultToken:   submission.result_token, // legacy alias
  });
}
