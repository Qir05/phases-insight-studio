import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getServiceClient } from '@/lib/supabase';
import type { Question, QuestionOption, ResultStrategy, ScoringConfig, ResultConfig } from '@/lib/supabase';
import { loadToolForAdmin } from '@/lib/toolAccess';
import { validateResultConfig } from '@/lib/resultConfigValidation';
import { getOptionLabel, getOptionValue, isOptionObject } from '@/lib/scoring';

interface OptionMapping {
  question_id: string;
  options: { label: string; value?: string; category?: string | null; score?: number | null }[];
}

/**
 * Migration Assistant save step. Writes the reviewed result config to the
 * tool AND the reviewed option→category mapping onto the existing questions,
 * keeping every question id and option label unchanged so existing
 * submissions keep matching. No SQL needed.
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

  let body: {
    result_strategy?: unknown; scoring_config?: unknown; result_config?: unknown;
    result_template?: unknown; option_mappings?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const strategy = body.result_strategy as ResultStrategy;
  if (strategy !== 'structured_outcome' && strategy !== 'hybrid_ai_with_outcome') {
    return NextResponse.json({ error: 'result_strategy must be "structured_outcome" or "hybrid_ai_with_outcome"' }, { status: 400 });
  }
  const isObj = (v: unknown) => !!v && typeof v === 'object' && !Array.isArray(v);
  if (!isObj(body.scoring_config) || !isObj(body.result_config)) {
    return NextResponse.json({ error: 'scoring_config and result_config must be JSON objects' }, { status: 400 });
  }
  const scoringConfig = body.scoring_config as ScoringConfig;
  const resultConfig  = body.result_config as ResultConfig;
  const resultTemplate = typeof body.result_template === 'string' && body.result_template.trim() ? body.result_template.trim() : null;
  const mappings = Array.isArray(body.option_mappings) ? (body.option_mappings as OptionMapping[]) : [];

  const db = getServiceClient();
  const { data: qs, error: qErr } = await db.from('questions').select('*').eq('tool_id', tool.id).order('order_index');
  if (qErr) {
    console.error('[apply-result-config] questions', qErr);
    return NextResponse.json({ error: 'Failed to load questions' }, { status: 500 });
  }
  const questions = (qs ?? []) as Question[];
  const byId = new Map(questions.map((q) => [q.id, q]));

  // ── Build the new options, refusing anything that would rename/drop an option ──
  const updates: { id: string; before: QuestionOption[] | null; after: QuestionOption[] }[] = [];
  for (const m of mappings) {
    const q = byId.get(m?.question_id);
    if (!q) return NextResponse.json({ error: 'A mapping refers to a question that is not part of this tool.' }, { status: 400 });
    const existing = (q.options as QuestionOption[] | null) ?? [];
    if (!Array.isArray(m.options) || m.options.length !== existing.length) {
      return NextResponse.json({ error: `Mapping for "${q.label}" must list exactly its ${existing.length} existing options.` }, { status: 400 });
    }
    const after: QuestionOption[] = existing.map((opt, i) => {
      const proposed = m.options[i];
      const label = getOptionLabel(opt);
      const next: QuestionOption = {
        label,
        value: (typeof proposed?.value === 'string' && proposed.value.trim()) || (isOptionObject(opt) ? getOptionValue(opt) : (label.match(/^\(([A-Z])\)/)?.[1] ?? label)),
      };
      const score = proposed?.score ?? (isOptionObject(opt) ? opt.score : undefined);
      if (typeof score === 'number' && Number.isFinite(score)) next.score = score;
      else if (scoringConfig.type === 'category') next.score = 1;
      const cat = typeof proposed?.category === 'string' ? proposed.category.trim() : '';
      if (cat) next.category = cat;
      return next;
    });
    const labelsMatch = m.options.every((p, i) => !p?.label || p.label === getOptionLabel(existing[i]));
    if (!labelsMatch) {
      return NextResponse.json({ error: `Option text for "${q.label}" cannot be changed here — existing submissions are matched by that text.` }, { status: 400 });
    }
    updates.push({ id: q.id, before: q.options as QuestionOption[] | null, after });
  }

  const merged = questions.map((q) => {
    const u = updates.find((x) => x.id === q.id);
    return u ? { ...q, options: u.after } : q;
  });

  const report = validateResultConfig(tool.tool_mode, strategy, scoringConfig, resultConfig, merged);
  if (report.errors.length > 0) {
    return NextResponse.json({ error: report.errors[0], ...report }, { status: 400 });
  }

  // ── Write: questions first, then the tool; undo question changes if the tool write fails ──
  const done: typeof updates = [];
  for (const u of updates) {
    const { error } = await db.from('questions').update({ options: u.after }).eq('id', u.id).eq('tool_id', tool.id);
    if (error) {
      console.error('[apply-result-config] question update failed', u.id, error);
      await revert(db, tool.id, done);
      return NextResponse.json({ error: 'Failed to save option mappings. No changes were kept.' }, { status: 500 });
    }
    done.push(u);
  }

  const { data: saved, error: toolErr } = await db
    .from('tools')
    .update({
      tool_mode:       'ai_result',
      result_strategy: strategy,
      scoring_config:  scoringConfig,
      result_config:   resultConfig,
      result_template: resultTemplate ?? tool.result_template,
      updated_at:      new Date().toISOString(),
    })
    .eq('id', tool.id)
    .select()
    .single();

  if (toolErr || !saved) {
    console.error('[apply-result-config] tool update failed', toolErr);
    await revert(db, tool.id, done);
    return NextResponse.json({ error: 'Failed to save the result configuration. No changes were kept.' }, { status: 500 });
  }

  return NextResponse.json({ tool: saved, questions_updated: done.length, warnings: report.warnings });
}

async function revert(
  db: ReturnType<typeof getServiceClient>,
  toolId: string,
  done: { id: string; before: QuestionOption[] | null }[],
) {
  for (const u of done) {
    const { error } = await db.from('questions').update({ options: u.before }).eq('id', u.id).eq('tool_id', toolId);
    if (error) console.error('[apply-result-config] REVERT FAILED for question', u.id, error);
  }
}
