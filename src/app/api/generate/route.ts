import { randomBytes } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';
import type { Question, Tool } from '@/lib/supabase';
import { validateAnswers } from '@/lib/scoring';
import { evaluateResult } from '@/lib/resultEngine';
import { toolStatus } from '@/lib/toolAccess';
import { clientIp, rateLimit } from '@/lib/rateLimit';
import { isSafeUrl } from '@/lib/resultConfigValidation';

export const maxDuration = 60;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GENERIC_ERROR = 'Something went wrong while saving your answers. Please try again.';

// Extracts the letter from options like "(A) Muscle tension..." → "A"
function extractAnswerLetter(answer: string): string | null {
  const match = answer.match(/^\(([A-Z])\)/);
  return match ? match[1] : null;
}

function str(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

export async function POST(req: NextRequest) {
  const limit = rateLimit(`generate:${clientIp(req)}`, 10, 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'Too many submissions. Please wait a minute and try again.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const slug      = str(body.slug, 200);
  const email     = str(body.email, 254);
  const firstName = str(body.firstName, 100);
  const lastName  = str(body.lastName, 100);
  const phone     = str(body.phone, 40);

  if (!slug || !email || !body.answers) {
    return NextResponse.json(
      { error: 'Missing required fields: slug, email, answers' },
      { status: 400 }
    );
  }
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 });
  }

  const db = getServiceClient();

  const { data: toolRow, error: toolErr } = await db
    .from('tools')
    .select('*')
    .eq('slug', slug)
    .maybeSingle();

  if (toolErr) {
    console.error('[generate] tool lookup failed:', toolErr.code, toolErr.message);
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 500 });
  }
  const tool = toolRow as Tool | null;
  // Draft tools are invisible to the public; admins preview them via /api/admin/tools/[id]/preview.
  if (!tool || toolStatus(tool) !== 'published') {
    return NextResponse.json({ error: 'Tool not found' }, { status: 404 });
  }

  const { data: questionsRaw, error: qErr } = await db
    .from('questions')
    .select('*')
    .eq('tool_id', tool.id)
    .order('order_index');

  if (qErr) {
    console.error('[generate] questions fetch error:', qErr.code, qErr.message);
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 500 });
  }
  const questions = (questionsRaw ?? []) as Question[];

  const { errors: answerErrors, cleaned: answers } = validateAnswers(body.answers, questions);
  if (answerErrors.length > 0) {
    return NextResponse.json({ error: answerErrors[0], errors: answerErrors.slice(0, 10) }, { status: 400 });
  }

  const contact = {
    tool_id:      tool.id,
    workspace_id: tool.workspace_id ?? null,
    first_name:   firstName,
    last_name:    lastName,
    email,
    phone,
    answers,
  };

  // ── SmartForm Redirect mode ───────────────────────────────────────────────
  if (tool.tool_mode === 'smartform_redirect') {
    const redirectOk = isSafeUrl(tool.redirect_url) || /^\/(?!\/)/.test(tool.redirect_url ?? '');
    if (!isSafeUrl(tool.webhook_url) || !redirectOk) {
      console.error(`[generate] Tool "${tool.slug}" (${tool.id}) is missing SmartForm webhook/redirect URL.`);
      return NextResponse.json(
        { error: 'This form is not fully configured yet. Please contact the administrator.' },
        { status: 400 }
      );
    }

    const { data: submission, error: subErr } = await db
      .from('submissions')
      .insert({
        ...contact,
        compiled_prompt: null,
        ai_result:       null,
        result_token:    randomBytes(24).toString('hex'),
        ghl_sync_status: 'skipped',
      })
      .select('id, created_at')
      .single();

    if (subErr || !submission) {
      console.error('[generate] Supabase insert FAILED:', subErr?.code, subErr?.message);
      return NextResponse.json({ error: GENERIC_ERROR }, { status: 500 });
    }

    // Build variable_name-keyed answers and extract letter codes
    const answersByVar: Record<string, string> = {};
    const answerLetters: Record<string, string> = {};
    for (const q of questions) {
      const val = answers[q.label];
      if (val === undefined) continue;
      const varName = q.variable_name || q.label;
      const strVal  = Array.isArray(val) ? val.join(', ') : val;
      answersByVar[varName] = strVal;
      const letter = extractAnswerLetter(strVal);
      if (letter) answerLetters[varName] = letter;
    }

    // Send webhook (blocking — we need it done before redirect)
    try {
      await fetch(tool.webhook_url as string, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tool_id:        tool.id,
          tool_title:     tool.title,
          workspace_id:   tool.workspace_id ?? null,
          name:           [firstName, lastName].filter(Boolean).join(' ') || undefined,
          email,
          answers:        answersByVar,
          answer_letters: answerLetters,
          created_at:     submission.created_at,
        }),
        signal: AbortSignal.timeout(8000),
      });
    } catch (err) {
      console.error('[generate] SmartForm webhook error:', err);
    }

    return NextResponse.json({
      mode:          'smartform_redirect',
      redirect_url:  tool.redirect_url,
      submission_id: submission.id,
    });
  }

  // ── AI Result modes (shared engine — same code path as the admin preview) ──
  const result = await evaluateResult(tool, questions, answers);
  if (!result.ok) {
    console.error('[generate]', result.internalError);
    return NextResponse.json({ error: result.publicError }, { status: result.status });
  }

  const resultToken = randomBytes(24).toString('hex');

  // Always persist the submission — even on AI failure — so the respondent's
  // answers and the failure reason are never lost.
  const { data: submission, error: subErr } = await db
    .from('submissions')
    .insert({
      ...contact,
      compiled_prompt:   result.compiledPrompt,
      ai_result:         result.aiResult,
      result_json:       result.resultJson,
      outcome_data:      result.outcome,
      model_used:        result.modelUsed,
      generation_status: result.generationStatus,
      generation_error:  result.generationError,
      result_token:      resultToken,
      ghl_sync_status:   tool.ghl_enabled ? 'pending' : 'skipped',
    })
    .select('id, result_token')
    .single();

  if (subErr || !submission) {
    console.error('[generate] Supabase insert FAILED:', subErr?.code, subErr?.message, subErr?.details);
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 500 });
  }

  // ai_generated has nothing to show without the AI text.
  if (result.mode === 'ai_result' && result.generationStatus === 'failed') {
    return NextResponse.json(
      { error: 'We could not generate your result right now. Please try again in a moment.', submission_id: submission.id },
      { status: 503 }
    );
  }

  const appUrl    = process.env.NEXT_PUBLIC_APP_URL ?? '';
  const resultUrl = `${appUrl}/r/${submission.result_token}`;

  await fireGhlWebhook(tool, submission.id, firstName, lastName, email, phone, answers, result.aiResult, resultUrl, db);

  if (result.mode === 'structured_outcome') {
    return NextResponse.json({
      mode:          'structured_outcome',
      outcome:       result.outcome,
      submission_id: submission.id,
      result_token:  submission.result_token,
      result_url:    resultUrl,
    });
  }

  if (result.mode === 'hybrid_ai_with_outcome') {
    return NextResponse.json({
      mode:              'hybrid_ai_with_outcome',
      outcome:           result.outcome,
      aiPersonalization: result.aiResult,
      submission_id:     submission.id,
      result_token:      submission.result_token,
      result_url:        resultUrl,
    });
  }

  return NextResponse.json({
    mode:          'ai_result',
    aiResult:      result.aiResult,
    resultJson:    result.resultJson,
    submission_id: submission.id,
    result_token:  submission.result_token,
    result_url:    resultUrl,
    resultToken:   submission.result_token, // legacy alias
  });
}

// ── GHL webhook helper ───────────────────────────────────────────────────────

async function fireGhlWebhook(
  tool: Tool,
  submissionId: string,
  firstName: string | null,
  lastName: string | null,
  email: string,
  phone: string | null,
  answers: Record<string, string | string[]>,
  aiResult: string | null,
  resultUrl: string,
  db: ReturnType<typeof getServiceClient>,
) {
  if (!tool.ghl_enabled || !tool.ghl_webhook_url || !isSafeUrl(tool.ghl_webhook_url)) return;

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
      signal: AbortSignal.timeout(8000),
    });
    const ghlJson = await ghlRes.json().catch(() => ({}));
    await db
      .from('submissions')
      .update({ ghl_sync_status: ghlRes.ok ? 'success' : 'failed', ghl_response: ghlJson })
      .eq('id', submissionId);
  } catch (err) {
    console.error('[generate] GHL webhook error:', err);
    await db
      .from('submissions')
      .update({ ghl_sync_status: 'failed', ghl_response: { error: String(err) } })
      .eq('id', submissionId);
  }
}
