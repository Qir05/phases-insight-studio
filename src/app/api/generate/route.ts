import { randomBytes } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';
import type { Question, ScoringConfig, ResultConfig, ResultStrategy } from '@/lib/supabase';
import { generateResult, structuredResultToMarkdown, GROQ_MODEL, StructuredResult } from '@/lib/groq';
import { compilePrompt } from '@/lib/utils';
import { calculateOutcome, buildHybridPrompt } from '@/lib/scoring';
import type { AnswerMap } from '@/lib/utils';

// Extracts the letter from options like "(A) Muscle tension..." → "A"
function extractAnswerLetter(answer: string): string | null {
  const match = answer.match(/^\(([A-Z])\)/);
  return match ? match[1] : null;
}

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

  // ── SmartForm Redirect mode ───────────────────────────────────────────────
  if (tool.tool_mode === 'smartform_redirect') {
    if (!tool.webhook_url || !tool.redirect_url) {
      return NextResponse.json(
        { error: 'This tool is missing SmartForm configuration. Please set both a Webhook URL and Redirect URL.' },
        { status: 400 }
      );
    }

    const resultToken = randomBytes(24).toString('hex');

    const { data: submission, error: subErr } = await db
      .from('submissions')
      .insert({
        tool_id:         tool.id,
        first_name:      firstName  || null,
        last_name:       lastName   || null,
        email,
        phone:           phone      || null,
        answers,
        compiled_prompt: null,
        ai_result:       null,
        result_token:    resultToken,
        ghl_sync_status: 'skipped',
      })
      .select()
      .single();

    if (subErr || !submission) {
      console.error('[generate] Supabase insert FAILED:', subErr?.code, subErr?.message);
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

    // Load questions to map label → variable_name
    const { data: questions } = await db
      .from('questions')
      .select('label, variable_name')
      .eq('tool_id', tool.id);

    const labelToVar: Record<string, string> = {};
    for (const q of questions ?? []) {
      if (q.label && q.variable_name) labelToVar[q.label] = q.variable_name;
    }

    // Build variable_name-keyed answers and extract letter codes
    const answersByVar: Record<string, string> = {};
    const answerLetters: Record<string, string> = {};

    for (const [label, val] of Object.entries(answers)) {
      const varName = labelToVar[label] ?? label;
      const strVal  = Array.isArray(val) ? val.join(', ') : val;
      answersByVar[varName] = strVal;
      const letter = extractAnswerLetter(strVal);
      if (letter) answerLetters[varName] = letter;
    }

    // Send webhook (blocking — we need it done before redirect)
    if (tool.webhook_url) {
      const payload = {
        tool_id:        tool.id,
        tool_title:     tool.title,
        workspace_id:   tool.workspace_id ?? null,
        name:           [firstName, lastName].filter(Boolean).join(' ') || undefined,
        email,
        answers:        answersByVar,
        answer_letters: answerLetters,
        created_at:     submission.created_at,
      };

      try {
        await fetch(tool.webhook_url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } catch (err) {
        console.error('[generate] SmartForm webhook error:', err);
      }
    }

    return NextResponse.json({
      mode:         'smartform_redirect',
      redirect_url: tool.redirect_url ?? '/',
      submission_id: submission.id,
    });
  }

  // ── AI Result modes ───────────────────────────────────────────────────────
  const strategy: ResultStrategy = (tool.result_strategy as ResultStrategy) ?? 'ai_generated';

  // Load questions for all AI result modes (needed for scoring + prompt building)
  const { data: questionsRaw, error: qErr } = await db
    .from('questions')
    .select('*')
    .eq('tool_id', tool.id)
    .order('order_index');

  if (qErr) {
    console.error('[generate] questions fetch error:', qErr);
  }
  const questions = (questionsRaw ?? []) as Question[];

  // ── structured_outcome: calculate and return outcome, no AI ──────────────
  if (strategy === 'structured_outcome') {
    const scoringConfig = tool.scoring_config as ScoringConfig | null;
    const resultConfig  = tool.result_config  as ResultConfig  | null;

    if (!scoringConfig || !resultConfig) {
      return NextResponse.json(
        { error: 'Tool is missing scoring_config or result_config for structured_outcome mode' },
        { status: 400 }
      );
    }

    const outcome = calculateOutcome(answers as AnswerMap, questions, scoringConfig, resultConfig);
    if (!outcome) {
      return NextResponse.json({ error: 'Could not determine an outcome from the provided answers' }, { status: 400 });
    }

    const resultToken = randomBytes(24).toString('hex');

    const { data: submission, error: subErr } = await db
      .from('submissions')
      .insert({
        tool_id:         tool.id,
        first_name:      firstName || null,
        last_name:       lastName  || null,
        email,
        phone:           phone     || null,
        answers,
        compiled_prompt: null,
        ai_result:       null,
        outcome_data:    outcome,
        result_token:    resultToken,
        ghl_sync_status: tool.ghl_enabled ? 'pending' : 'skipped',
      })
      .select()
      .single();

    if (subErr || !submission) {
      console.error('[generate] structured_outcome insert FAILED:', subErr?.code, subErr?.message);
      return NextResponse.json(
        { error: 'Failed to save submission', detail: subErr?.message ?? 'Unknown error' },
        { status: 500 }
      );
    }

    const appUrl    = process.env.NEXT_PUBLIC_APP_URL ?? '';
    const resultUrl = `${appUrl}/r/${submission.result_token}`;

    await fireGhlWebhook(tool, submission.id, firstName, lastName, email, phone, answers, null, resultUrl, db);

    return NextResponse.json({
      mode:          'structured_outcome',
      outcome,
      submission_id: submission.id,
      result_token:  submission.result_token,
      result_url:    resultUrl,
    });
  }

  // ── hybrid_ai_with_outcome: calculate outcome, then AI personalises it ────
  if (strategy === 'hybrid_ai_with_outcome') {
    const scoringConfig = tool.scoring_config as ScoringConfig | null;
    const resultConfig  = tool.result_config  as ResultConfig  | null;

    if (!scoringConfig || !resultConfig) {
      return NextResponse.json(
        { error: 'Tool is missing scoring_config or result_config for hybrid mode' },
        { status: 400 }
      );
    }

    const outcome = calculateOutcome(answers as AnswerMap, questions, scoringConfig, resultConfig);
    if (!outcome) {
      return NextResponse.json({ error: 'Could not determine an outcome from the provided answers' }, { status: 400 });
    }

    const hybridPrompt = buildHybridPrompt(
      tool.result_template as string | null,
      outcome,
      answers as AnswerMap,
      questions,
    );

    let aiPersonalization: string;
    try {
      const gen = await generateResult(hybridPrompt);
      aiPersonalization = gen.parsed ? structuredResultToMarkdown(gen.parsed) : gen.raw;
    } catch (err) {
      console.error('[generate] Groq error (hybrid):', err);
      return NextResponse.json({ error: 'AI generation failed' }, { status: 500 });
    }

    const resultToken = randomBytes(24).toString('hex');

    const { data: submission, error: subErr } = await db
      .from('submissions')
      .insert({
        tool_id:         tool.id,
        first_name:      firstName || null,
        last_name:       lastName  || null,
        email,
        phone:           phone     || null,
        answers,
        compiled_prompt: hybridPrompt,
        ai_result:       aiPersonalization,
        outcome_data:    outcome,
        result_token:    resultToken,
        ghl_sync_status: tool.ghl_enabled ? 'pending' : 'skipped',
      })
      .select()
      .single();

    if (subErr || !submission) {
      console.error('[generate] hybrid insert FAILED:', subErr?.code, subErr?.message);
      return NextResponse.json(
        { error: 'Failed to save submission', detail: subErr?.message ?? 'Unknown error' },
        { status: 500 }
      );
    }

    const appUrl    = process.env.NEXT_PUBLIC_APP_URL ?? '';
    const resultUrl = `${appUrl}/r/${submission.result_token}`;

    await fireGhlWebhook(tool, submission.id, firstName, lastName, email, phone, answers, aiPersonalization, resultUrl, db);

    return NextResponse.json({
      mode:              'hybrid_ai_with_outcome',
      outcome,
      aiPersonalization,
      submission_id:     submission.id,
      result_token:      submission.result_token,
      result_url:        resultUrl,
    });
  }

  // ── ai_generated (default) ────────────────────────────────────────────────
  const hasSystemPrompt   = typeof tool.system_prompt   === 'string' && tool.system_prompt.trim().length   > 0;
  const hasResultTemplate = typeof tool.result_template === 'string' && tool.result_template.trim().length > 0;
  if (!hasSystemPrompt && !hasResultTemplate) {
    return NextResponse.json(
      { error: 'This tool is missing result configuration. Please configure result strategy, scoring config, and result config.' },
      { status: 400 }
    );
  }

  // Use result_template if available, otherwise fall back to system_prompt
  const promptBase = (tool.result_template as string | null) ?? (tool.system_prompt as string | null) ?? '';
  const compiledPrompt = compilePrompt(
    { title: tool.title, description: tool.description },
    promptBase,
    answers as AnswerMap,
    questions
  );

  let aiResultText: string | null = null;
  let resultJson: StructuredResult | null = null;
  let modelUsed: string | null = null;
  let generationStatus: 'success' | 'failed' = 'success';
  let generationError: string | null = null;

  try {
    const gen = await generateResult(compiledPrompt);
    resultJson = gen.parsed;
    modelUsed = gen.model;
    aiResultText = gen.parsed ? structuredResultToMarkdown(gen.parsed) : gen.raw;
  } catch (err) {
    console.error('[generate] Groq error:', err);
    generationStatus = 'failed';
    generationError = err instanceof Error ? err.message : String(err);
    modelUsed = GROQ_MODEL;
  }

  const resultToken = randomBytes(24).toString('hex');

  // Always persist the submission — even on AI failure — so the user's
  // answers and the failure reason are never lost.
  const { data: submission, error: subErr } = await db
    .from('submissions')
    .insert({
      tool_id:           tool.id,
      first_name:        firstName || null,
      last_name:         lastName || null,
      email,
      phone:              phone || null,
      answers,
      compiled_prompt:    compiledPrompt,
      ai_result:          aiResultText,
      result_json:        resultJson,
      model_used:         modelUsed,
      generation_status:  generationStatus,
      generation_error:   generationError,
      result_token:       resultToken,
      ghl_sync_status:     tool.ghl_enabled ? 'pending' : 'skipped',
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

  if (generationStatus === 'failed') {
    return NextResponse.json(
      { error: 'AI generation failed', detail: generationError, submission_id: submission.id },
      { status: 500 }
    );
  }

  const appUrl    = process.env.NEXT_PUBLIC_APP_URL ?? '';
  const resultUrl = `${appUrl}/r/${submission.result_token}`;

  await fireGhlWebhook(tool, submission.id, firstName, lastName, email, phone, answers, aiResultText, resultUrl, db);

  return NextResponse.json({
    mode:          'ai_result',
    aiResult:      aiResultText,
    resultJson,
    submission_id: submission.id,
    result_token:  submission.result_token,
    result_url:    resultUrl,
    resultToken:   submission.result_token, // legacy alias
  });
}

// ── GHL webhook helper (non-blocking) ────────────────────────────────────────

async function fireGhlWebhook(
  tool: Record<string, unknown>,
  submissionId: string,
  firstName: string | undefined,
  lastName: string | undefined,
  email: string,
  phone: string | undefined,
  answers: Record<string, string | string[]>,
  aiResult: string | null,
  resultUrl: string,
  db: ReturnType<typeof getServiceClient>,
) {
  if (!tool.ghl_enabled || !tool.ghl_webhook_url) return;

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
    const ghlRes  = await fetch(tool.ghl_webhook_url as string, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const ghlJson = await ghlRes.json().catch(() => ({}));
    await db
      .from('submissions')
      .update({ ghl_sync_status: 'success', ghl_response: ghlJson })
      .eq('id', submissionId);
  } catch (err) {
    console.error('[generate] GHL webhook error:', err);
    await db
      .from('submissions')
      .update({ ghl_sync_status: 'failed', ghl_response: { error: String(err) } })
      .eq('id', submissionId);
  }
}
