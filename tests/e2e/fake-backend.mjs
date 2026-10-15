// Local stand-in for Supabase (PostgREST + GoTrue subset) and Groq, used by
// the end-to-end tests. Everything lives in memory and is seeded with
// synthetic data — no real patient data, no network access, no production DB.
//
// Emulates the production database AFTER migration 009:
//  - tools.status exists (draft/published)
//  - RLS has no permissive policies: anon/authenticated keys get no rows
//    and cannot write; only the service-role key can read/write tables.
import http from 'node:http';
import { randomUUID, randomBytes } from 'node:crypto';

export const SERVICE_KEY = 'e2e-service-role-key';
export const ANON_KEY = 'e2e-anon-key';
export const PASSWORD = 'E2e-Passw0rd!';

// ── Schema (column whitelist per table → unknown columns are rejected like PostgREST) ──
const SCHEMA = {
  workspaces: ['id', 'name', 'slug', 'logo_url', 'primary_color', 'ghl_webhook_url', 'ghl_tag', 'is_active', 'created_at'],
  profiles: ['id', 'user_id', 'full_name', 'email', 'role', 'workspace_id', 'is_active', 'invited_by', 'created_at'],
  invitations: ['id', 'email', 'full_name', 'role', 'workspace_id', 'token', 'accepted_at', 'expires_at', 'created_by', 'created_at'],
  tools: ['id', 'title', 'slug', 'description', 'system_prompt', 'email_capture_enabled', 'phone_capture_enabled', 'ghl_enabled',
    'ghl_webhook_url', 'ghl_tag', 'provider_name', 'provider_logo_url', 'primary_color', 'workspace_id', 'tool_mode', 'webhook_url',
    'redirect_url', 'result_strategy', 'scoring_config', 'result_config', 'result_template', 'admin_notes', 'status', 'created_at', 'updated_at'],
  questions: ['id', 'tool_id', 'label', 'variable_name', 'field_type', 'options', 'required', 'order_index', 'scoring_key', 'category', 'created_at'],
  submissions: ['id', 'tool_id', 'workspace_id', 'first_name', 'last_name', 'email', 'phone', 'answers', 'compiled_prompt', 'ai_result',
    'result_json', 'outcome_data', 'model_used', 'generation_status', 'generation_error', 'result_token', 'ghl_sync_status', 'ghl_response', 'created_at'],
};

const DEFAULTS = {
  tools: () => ({ system_prompt: null, email_capture_enabled: true, phone_capture_enabled: false, ghl_enabled: false, tool_mode: 'ai_result',
    result_strategy: 'ai_generated', status: 'published', updated_at: new Date().toISOString() }),
  questions: () => ({ variable_name: '', required: true, order_index: 0 }),
  submissions: () => ({ answers: {}, result_token: randomBytes(24).toString('hex'), ghl_sync_status: 'skipped' }),
  invitations: () => ({ token: randomBytes(32).toString('hex'), role: 'provider_admin', expires_at: new Date(Date.now() + 7 * 864e5).toISOString() }),
  workspaces: () => ({ is_active: true }),
  profiles: () => ({ is_active: true }),
};

// Many-to-one (child.fk → parent.id) relationships for embedding.
const RELATIONS = {
  submissions: { tools: 'tool_id', workspaces: 'workspace_id' },
  questions: { tools: 'tool_id' },
  tools: { workspaces: 'workspace_id' },
  profiles: { workspaces: 'workspace_id' },
  invitations: { workspaces: 'workspace_id' },
};

export function createState() {
  return { db: Object.fromEntries(Object.keys(SCHEMA).map((t) => [t, []])), users: [], sessions: new Map(), groqMode: 'ok', groqCalls: [], log: [] };
}

// ── Seed data ───────────────────────────────────────────────────────────────
export const IDS = {
  wsA: '11111111-1111-4111-8111-111111111111',
  wsB: '22222222-2222-4222-8222-222222222222',
  bendy: '35aaceb2-0000-4000-8000-00000000e2e0', // synthetic stand-in, NOT the production id
  legacy: '44444444-4444-4444-8444-444444444444',
  wsBTool: '55555555-5555-4555-8555-555555555555',
};

const LETTER_THEMES = {
  A: 'Muscle tension, joint instability or overuse',
  B: 'Flushing, itching, headaches or food reactions',
  C: 'Dizziness, racing heart or crashing when upright',
  D: 'A mix of everything — pain, gut, mood, sleep and energy',
};
const BENDY_CATS = { A: 'musculoskeletal_hypermobility', B: 'histamine_inflammatory', C: 'dysautonomia_autonomic', D: 'complex_multisystem' };

export function seed(state) {
  const now = new Date().toISOString();
  const { db } = state;
  db.workspaces.push(
    { id: IDS.wsA, name: 'Phases Clinic (E2E)', slug: 'phases-e2e', is_active: true, created_at: now },
    { id: IDS.wsB, name: 'Other Clinic (E2E)', slug: 'other-e2e', is_active: true, created_at: now },
  );
  for (const [email, role, ws] of [
    ['super@e2e.test', 'super_admin', null],
    ['provider-a@e2e.test', 'provider_admin', IDS.wsA],
    ['provider-b@e2e.test', 'provider_admin', IDS.wsB],
  ]) {
    const user = { id: randomUUID(), email, password: PASSWORD, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: now };
    state.users.push(user);
    db.profiles.push({ id: randomUUID(), user_id: user.id, email, full_name: email.split('@')[0], role, workspace_id: ws, is_active: true, created_at: now });
  }

  // Bendy-shaped tool in the state migration 008 leaves it in (hybrid, category scoring, 4 draft outcomes)
  db.tools.push({
    ...DEFAULTS.tools(), id: IDS.bendy, title: 'Bendy Menopause Type Quiz (E2E copy)', slug: 'bendy-menopause-type-quiz-e2e',
    description: 'Synthetic copy for end-to-end tests', workspace_id: IDS.wsA, result_strategy: 'hybrid_ai_with_outcome', status: 'published',
    scoring_config: { type: 'category', categories: Object.values(BENDY_CATS) },
    result_config: { outcomes: [
      { id: BENDY_CATS.A, title: 'Musculoskeletal + Hypermobility Pattern', description: 'Muscle/joint driven.', match: { top_category: BENDY_CATS.A }, recommendations: ['Track which movements worsen symptoms.'] },
      { id: BENDY_CATS.B, title: 'Histamine + Inflammatory Reactivity Pattern', description: 'Reactive-system driven.', match: { top_category: BENDY_CATS.B }, recommendations: ['Track foods and flares.'] },
      { id: BENDY_CATS.C, title: 'Dysautonomia + Autonomic Regulation Pattern', description: 'Autonomic driven.', match: { top_category: BENDY_CATS.C }, recommendations: ['Track dizziness and heart rate.'] },
      { id: BENDY_CATS.D, title: 'Complex Multi-System Pattern', description: 'Overlapping systems.', match: { top_category: BENDY_CATS.D }, recommendations: ['Track symptoms by body system.'] },
    ] },
    result_template: 'Write a supportive, educational result based on the selected outcome and the user\'s actual answers. Do not invent a new type. Do not diagnose or prescribe.',
    created_at: now,
  });
  for (let i = 0; i < 7; i++) {
    db.questions.push({
      id: randomUUID(), tool_id: IDS.bendy, created_at: now, order_index: i, required: true, field_type: 'radio', scoring_key: null, category: null,
      label: `Bendy Q${i + 1}: Which of these sounds most like you?`,
      variable_name: i === 0 ? 'q1SymptomDriver' : i === 6 ? 'q7SearchForAnswers' : `q${i + 1}Pattern`,
      options: Object.entries(LETTER_THEMES).map(([L, t]) => ({ label: `(${L}) ${t} [Q${i + 1}]`, value: L, category: BENDY_CATS[L], score: 1 })),
    });
  }

  // Legacy, never-configured tool (pre-008 state): plain string lettered options, ai_generated with no prompt
  db.tools.push({
    ...DEFAULTS.tools(), id: IDS.legacy, title: 'Legacy Sleep Pattern Quiz', slug: 'legacy-sleep-quiz', description: 'Old quiz to migrate',
    workspace_id: IDS.wsA, result_strategy: 'ai_generated', system_prompt: null, status: 'published', created_at: now,
  });
  const legacyLabels = ['When do you usually fall asleep?', 'How do you feel on waking?', 'What disrupts your sleep most?'];
  legacyLabels.forEach((label, i) => {
    db.questions.push({
      id: `legacy-q${i + 1}-0000-4000-8000-000000000000`, tool_id: IDS.legacy, created_at: now, order_index: i, required: true,
      field_type: 'radio', scoring_key: null, category: null, label, variable_name: `legacy_q${i + 1}`,
      options: ['(A) Early and easily', '(B) Late, mind racing', '(C) Wake through the night', '(D) It varies a lot'].map((o) => `${o} — q${i + 1}`),
    });
  });
  db.submissions.push({
    ...DEFAULTS.submissions(), id: randomUUID(), tool_id: IDS.legacy, workspace_id: IDS.wsA, email: 'legacy-respondent@e2e.test',
    first_name: 'Legacy', answers: { [legacyLabels[0]]: '(B) Late, mind racing — q1' }, ai_result: 'Old free-text result', created_at: now,
  });

  // Workspace B tool + submission (isolation target)
  db.tools.push({
    ...DEFAULTS.tools(), id: IDS.wsBTool, title: 'Other Clinic Intake', slug: 'other-clinic-intake', workspace_id: IDS.wsB,
    system_prompt: 'Summarise.', status: 'published', created_at: now,
  });
  db.questions.push({ id: randomUUID(), tool_id: IDS.wsBTool, label: 'Main concern?', variable_name: 'main_concern', field_type: 'text', options: null, required: true, order_index: 0, created_at: now });
  db.submissions.push({ ...DEFAULTS.submissions(), id: randomUUID(), tool_id: IDS.wsBTool, workspace_id: IDS.wsB, email: 'b-patient@e2e.test', answers: { 'Main concern?': 'synthetic' }, created_at: now });
}

// ── PostgREST helpers ───────────────────────────────────────────────────────
function parseSelect(sel) {
  // split top-level commas
  const parts = []; let depth = 0; let cur = '';
  for (const ch of sel ?? '*') {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts.map((p) => {
    const m = p.match(/^([a-z_]+)\((.*)\)$/s);
    return m ? { embed: m[1], inner: m[2] } : { col: p };
  });
}

function project(state, table, row, select) {
  const fields = parseSelect(select);
  const out = {};
  for (const f of fields) {
    if (f.col === '*') Object.assign(out, row);
    else if (f.col) {
      if (!SCHEMA[table].includes(f.col)) throw pgErr(400, '42703', `column ${table}.${f.col} does not exist`);
      out[f.col] = row[f.col] ?? null;
    } else if (f.embed) {
      const fk = RELATIONS[table]?.[f.embed];
      if (fk) {
        const parent = state.db[f.embed].find((r) => r.id === row[fk]);
        out[f.embed] = parent ? project(state, f.embed, parent, f.inner) : null;
      } else {
        const childFk = RELATIONS[f.embed]?.[table];
        if (!childFk) throw pgErr(400, 'PGRST200', `Could not find a relationship between '${table}' and '${f.embed}'`);
        const children = state.db[f.embed].filter((r) => r[childFk] === row.id);
        out[f.embed] = f.inner.trim() === 'count' ? [{ count: children.length }] : children.map((c) => project(state, f.embed, c, f.inner));
      }
    }
  }
  return out;
}

function pgErr(status, code, message) {
  const e = new Error(message); e.status = status; e.code = code; return e;
}

function applyFilters(rows, params) {
  let out = rows;
  for (const [key, raw] of params) {
    if (['select', 'order', 'limit', 'offset', 'columns', 'on_conflict'].includes(key)) continue;
    const dot = raw.indexOf('.');
    const op = raw.slice(0, dot);
    const val = raw.slice(dot + 1);
    const cmp = (v) => (v === null || v === undefined ? null : String(v));
    out = out.filter((r) => {
      const v = r[key];
      switch (op) {
        case 'eq': return cmp(v) === val;
        case 'neq': return cmp(v) !== val;
        case 'is': return val === 'null' ? v === null || v === undefined : String(v) === val;
        case 'gt': return v !== null && v !== undefined && String(v) > val;
        case 'lt': return v !== null && v !== undefined && String(v) < val;
        default: throw pgErr(400, 'PGRST100', `unsupported operator ${op}`);
      }
    });
  }
  const order = params.get('order');
  if (order) {
    const [col, dir] = order.split('.');
    out = [...out].sort((a, b) => {
      const x = a[col]; const y = b[col];
      const r = x < y ? -1 : x > y ? 1 : 0;
      return dir === 'desc' ? -r : r;
    });
  }
  const limit = params.get('limit');
  if (limit) out = out.slice(0, Number(limit));
  return out;
}

function checkColumns(table, row) {
  for (const k of Object.keys(row)) {
    if (!SCHEMA[table].includes(k)) throw pgErr(400, 'PGRST204', `Could not find the '${k}' column of '${table}' in the schema cache`);
  }
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const s = Buffer.concat(chunks).toString('utf8');
  return s ? JSON.parse(s) : null;
}

// The browser Supabase client (login) calls the backend cross-origin, like real Supabase.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,HEAD,OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Expose-Headers': 'Content-Range',
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...CORS, ...headers });
  res.end(body === undefined ? '' : JSON.stringify(body));
}

function handleRest(state, req, res, url, body) {
  const table = url.pathname.replace('/rest/v1/', '');
  if (!SCHEMA[table]) return send(res, 404, { code: '42P01', message: `relation "public.${table}" does not exist` });

  const auth = (req.headers.authorization ?? '').replace(/^Bearer /, '');
  const isService = auth === SERVICE_KEY;
  state.log.push({ method: req.method, table, service: isService });

  // Post-009 RLS: no permissive policies → non-service roles see nothing and cannot write.
  if (!isService) {
    if (req.method === 'GET' || req.method === 'HEAD') {
      return send(res, 200, req.method === 'HEAD' ? undefined : [], { 'Content-Range': '*/0' });
    }
    return send(res, 401, { code: '42501', message: `new row violates row-level security policy for table "${table}"` });
  }

  const params = url.searchParams;
  const wantsObject = (req.headers.accept ?? '').includes('vnd.pgrst.object');
  const prefer = req.headers.prefer ?? '';
  const returnRep = prefer.includes('return=representation');
  const rows = state.db[table];

  const finish = (result) => {
    const select = params.get('select') ?? '*';
    const projected = result.map((r) => project(state, table, r, select));
    if (wantsObject) {
      if (projected.length !== 1) {
        return send(res, 406, { code: 'PGRST116', details: `The result contains ${projected.length} rows`, hint: null, message: 'JSON object requested, multiple (or no) rows returned' });
      }
      return send(res, 200, projected[0]);
    }
    const headers = prefer.includes('count=exact') ? { 'Content-Range': `0-${Math.max(0, projected.length - 1)}/${projected.length}` } : {};
    return send(res, req.method === 'POST' ? 201 : 200, req.method === 'HEAD' ? undefined : projected, headers);
  };

  if (req.method === 'GET' || req.method === 'HEAD') return finish(applyFilters(rows, params));

  if (req.method === 'POST') {
    const items = Array.isArray(body) ? body : [body];
    const created = items.map((item) => {
      checkColumns(table, item);
      const row = { id: randomUUID(), created_at: new Date().toISOString(), ...(DEFAULTS[table]?.() ?? {}), ...item };
      if (table === 'tools' && rows.some((r) => r.slug === row.slug)) throw pgErr(409, '23505', 'duplicate key value violates unique constraint "tools_slug_key"');
      if (table === 'tools' && row.status && !['draft', 'published'].includes(row.status)) throw pgErr(400, '23514', 'violates check constraint "tools_status_check"');
      if (table === 'questions' && !state.db.tools.some((t) => t.id === row.tool_id)) throw pgErr(409, '23503', 'violates foreign key constraint');
      return row;
    });
    rows.push(...created);
    if (!returnRep) return send(res, 201, undefined);
    return finish(created);
  }

  if (req.method === 'PATCH') {
    checkColumns(table, body);
    const matched = applyFilters(rows, params);
    if (table === 'tools' && body.status && !['draft', 'published'].includes(body.status)) throw pgErr(400, '23514', 'violates check constraint');
    matched.forEach((r) => Object.assign(r, body));
    if (!returnRep) return send(res, 204, undefined);
    return finish(matched);
  }

  if (req.method === 'DELETE') {
    const matched = applyFilters(rows, params);
    state.db[table] = rows.filter((r) => !matched.includes(r));
    if (table === 'tools') {
      const ids = new Set(matched.map((t) => t.id));
      state.db.questions = state.db.questions.filter((q) => !ids.has(q.tool_id));
      state.db.submissions = state.db.submissions.filter((s) => !ids.has(s.tool_id));
    }
    if (!returnRep) return send(res, 204, undefined);
    return finish(matched);
  }

  return send(res, 405, { message: 'method not allowed' });
}

// ── GoTrue subset ───────────────────────────────────────────────────────────
function b64url(obj) { return Buffer.from(JSON.stringify(obj)).toString('base64url'); }
function issueSession(state, user) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const access_token = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: user.id, email: user.email, role: 'authenticated', aud: 'authenticated', exp })}.${randomBytes(16).toString('base64url')}`;
  const refresh_token = randomBytes(16).toString('hex');
  state.sessions.set(access_token, user.id);
  state.sessions.set(`refresh:${refresh_token}`, user.id);
  return { access_token, token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token, user: publicUser(user) };
}
function publicUser(u) {
  const { password, ...rest } = u; void password; return rest;
}

function handleAuth(state, req, res, url, body) {
  const path = url.pathname.replace('/auth/v1', '');
  if (path === '/token' && req.method === 'POST') {
    const grant = url.searchParams.get('grant_type');
    if (grant === 'password') {
      const user = state.users.find((u) => u.email === body?.email && u.password === body?.password);
      if (!user) return send(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials', code: 'invalid_credentials', message: 'Invalid login credentials' });
      return send(res, 200, issueSession(state, user));
    }
    if (grant === 'refresh_token') {
      const uid = state.sessions.get(`refresh:${body?.refresh_token}`);
      const user = state.users.find((u) => u.id === uid);
      if (!user) return send(res, 400, { error: 'invalid_grant', message: 'Invalid Refresh Token' });
      return send(res, 200, issueSession(state, user));
    }
  }
  if (path === '/user' && req.method === 'GET') {
    const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    const uid = state.sessions.get(token);
    const user = state.users.find((u) => u.id === uid);
    if (!user) return send(res, 401, { code: 'bad_jwt', message: 'invalid JWT' });
    return send(res, 200, publicUser(user));
  }
  if (path === '/logout') {
    const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    state.sessions.delete(token);
    return send(res, 204, undefined);
  }
  return send(res, 404, { message: `fake auth: ${req.method} ${path} not implemented` });
}

// ── Groq subset ─────────────────────────────────────────────────────────────
export const IMPORT_SOURCE_MARKER = 'E2E ENERGY TYPE QUIZ';

function importConfigFromSource() {
  const cats = ['morning_crash', 'afternoon_slump', 'evening_wired', 'all_day_flat'];
  const titles = ['Morning Crash Type', 'Afternoon Slump Type', 'Evening Wired Type', 'All-Day Flat Type'];
  const qTexts = ['When does your energy dip most?', 'What do you reach for when tired?', 'How is your sleep?', 'How do you feel after exercise?'];
  return {
    title: 'E2E Energy Type Quiz',
    slug: 'e2e-energy-type-quiz',
    description: 'Find your energy type (synthetic end-to-end test quiz).',
    result_strategy: 'hybrid_ai_with_outcome',
    scoring_provenance: 'source',
    missing_information: ['CTA link for All-Day Flat Type'],
    system_prompt: null,
    result_template: 'Write a warm, practical result for this energy type using the person\'s answers. Do not diagnose.',
    scoring_config: { type: 'category', categories: cats },
    result_config: { outcomes: cats.map((c, i) => ({
      id: c, title: titles[i], description: `${titles[i]} description from the source.`, match: { top_category: c },
      recommendations: [`${titles[i]} tip 1`, `${titles[i]} tip 2`], cta_text: 'Book a call', cta_url: i === 3 ? '' : 'https://example.com/book',
    })) },
    questions: qTexts.map((label, qi) => ({
      label, variable_name: `energy_q${qi + 1}`, field_type: 'radio', required: true,
      options: ['A', 'B', 'C', 'D'].map((L, oi) => ({ label: `(${L}) ${titles[oi]} answer for Q${qi + 1}`, value: L, score: 1, category: cats[oi] })),
    })),
  };
}

function inferDraftFromPrompt(prompt) {
  const qCount = (prompt.match(/^Q\d+: /gm) ?? []).length;
  const cats = ['early_sleeper', 'racing_mind', 'night_waker', 'irregular'];
  return {
    scoring_config: { type: 'category', categories: cats },
    result_config: { outcomes: cats.map((c) => ({ id: c, title: c.replace('_', ' ').replace(/\b\w/g, (m) => m.toUpperCase()), description: `Draft description for ${c}.`, match: { top_category: c }, recommendations: ['Draft rec'], cta_text: '', cta_url: '' })) },
    result_template: 'Personalise the matched outcome. Do not invent a new type, do not diagnose, do not mention this is a draft.',
    option_mappings: Array.from({ length: qCount }, (_, i) => ({ question: i + 1, categories: cats })),
  };
}

function resultJson(prompt) {
  const type = prompt.match(/PARTICIPANT'S RESULT TYPE: (.+)/)?.[1] ?? 'Your Result';
  return {
    result_title: 'Model-chosen title that should be replaced',
    // Deliberately echoes internal identifiers to prove the app sanitises them.
    short_summary: `Based on your q1SymptomDriver and energy_q1 answers, your ${type} pattern stands out (histamine_inflammatory, morning_crash).`,
    why_this_result: 'Several of your answers point the same way. {{q7SearchForAnswers}}',
    key_patterns_from_answers: ['Pattern one from your answers', 'Pattern two from your answers'],
    recommended_next_steps: ['Keep a two-week symptom diary', 'Share it with a qualified clinician'],
    disclaimer: 'Educational only — not medical advice.',
    cta: 'Book a follow-up conversation.',
  };
}

function handleGroq(state, req, res, body) {
  const system = body?.messages?.find((m) => m.role === 'system')?.content ?? '';
  const user = body?.messages?.find((m) => m.role === 'user')?.content ?? '';
  const kind = system.includes('quiz configuration assistant') ? 'import'
    : system.includes('quiz scoring configuration assistant') ? 'infer' : 'result';
  state.groqCalls.push({ kind, at: Date.now() });

  if (state.groqMode === 'fail') return send(res, 503, { error: { message: 'fake groq: service unavailable', type: 'server_error' } });
  if (state.groqMode === 'malformed') return groqReply(res, 'this is { not json');

  let content;
  if (kind === 'import') content = user.includes(IMPORT_SOURCE_MARKER) ? importConfigFromSource() : { title: '', questions: [] };
  else if (kind === 'infer') content = inferDraftFromPrompt(user);
  else content = resultJson(user);
  return groqReply(res, JSON.stringify(content));
}

function groqReply(res, content) {
  return send(res, 200, {
    id: `chatcmpl-${randomBytes(6).toString('hex')}`, object: 'chat.completion', created: Math.floor(Date.now() / 1000), model: 'llama-3.3-70b-versatile',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });
}

// ── Server ──────────────────────────────────────────────────────────────────
export function startFakeBackend(port, state = createState()) {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://127.0.0.1:${port}`);
      if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
      const body = ['POST', 'PATCH', 'PUT'].includes(req.method) ? await readBody(req) : null;
      if (url.pathname.startsWith('/rest/v1/')) return handleRest(state, req, res, url, body);
      if (url.pathname.startsWith('/auth/v1/')) return handleAuth(state, req, res, url, body);
      if (url.pathname.startsWith('/groq/openai/v1/chat/completions')) return handleGroq(state, req, res, body);
      if (url.pathname === '/__state') return send(res, 200, state.db);
      if (url.pathname === '/__control' && req.method === 'POST') { Object.assign(state, body); return send(res, 200, { ok: true }); }
      return send(res, 404, { message: `fake backend: no route for ${req.method} ${url.pathname}` });
    } catch (err) {
      return send(res, err.status ?? 500, { code: err.code ?? 'XX000', message: err.message, details: null, hint: null });
    }
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ server, state })));
}
