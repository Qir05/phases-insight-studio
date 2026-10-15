import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getServiceClient } from '@/lib/supabase';
import type { Question } from '@/lib/supabase';
import { loadToolForAdmin } from '@/lib/toolAccess';
import { validateAnswers } from '@/lib/scoring';
import { evaluateResult } from '@/lib/resultEngine';
import { rateLimit } from '@/lib/rateLimit';

export const maxDuration = 60;

/**
 * Admin preview: runs the exact production pipeline (answer validation →
 * scoring → AI) against sample answers and returns the full breakdown.
 * Nothing is saved and no webhooks fire. Works for draft tools.
 *
 * Body: { answers, run_ai?: boolean } — run_ai defaults to true; false skips the
 * Groq call for hybrid tools (scoring only).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const access = await loadToolForAdmin(params.id, auth.profile);
  if ('response' in access) return access.response;
  const tool = access.tool;

  let body: { answers?: unknown; run_ai?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const runAi = body.run_ai !== false;
  if (runAi && !rateLimit(`preview:${auth.user.id}`, 20, 60_000).ok) {
    return NextResponse.json({ error: 'Too many AI previews — wait a minute.' }, { status: 429 });
  }

  const db = getServiceClient();
  const { data: qs, error: qErr } = await db.from('questions').select('*').eq('tool_id', tool.id).order('order_index');
  if (qErr) {
    console.error('[preview] questions', qErr);
    return NextResponse.json({ error: 'Failed to load questions' }, { status: 500 });
  }
  const questions = (qs ?? []) as Question[];

  const { errors: answerErrors, cleaned } = validateAnswers(body.answers, questions);
  if (answerErrors.length > 0) {
    return NextResponse.json({ error: answerErrors[0], errors: answerErrors, stage: 'answers' }, { status: 400 });
  }

  if (tool.tool_mode === 'smartform_redirect') {
    return NextResponse.json({ mode: 'smartform_redirect', answers: cleaned, note: 'SmartForm tools only forward answers to the webhook — there is no result to preview.' });
  }

  const engineTool = runAi || tool.result_strategy !== 'hybrid_ai_with_outcome'
    ? tool
    : { ...tool, result_strategy: 'structured_outcome' as const };

  if (!runAi && tool.result_strategy === 'ai_generated') {
    return NextResponse.json({ mode: 'ai_result', skipped_ai: true, answers: cleaned });
  }

  const result = await evaluateResult(engineTool, questions, cleaned);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.publicError, internal_error: result.internalError, stage: 'config' },
      { status: result.status }
    );
  }

  // ai_generated has no result without the AI text — report the failure as an error, never as a result.
  if (result.mode === 'ai_result' && result.generationStatus === 'failed') {
    return NextResponse.json(
      { error: `AI generation failed: ${result.generationError}`, stage: 'ai', model_used: result.modelUsed },
      { status: 503 }
    );
  }

  return NextResponse.json({
    mode:              tool.result_strategy === 'hybrid_ai_with_outcome' ? 'hybrid_ai_with_outcome' : result.mode,
    skipped_ai:        !runAi,
    answers:           cleaned,
    breakdown:         result.breakdown,
    outcome:           result.outcome,
    ai_result:         result.aiResult,
    result_json:       result.resultJson,
    generation_status: result.generationStatus,
    generation_error:  result.generationError,
    model_used:        result.modelUsed,
  });
}
