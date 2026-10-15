// End-to-end test: real Next.js app (next dev) + real browser (installed
// Edge/Chrome via playwright-core) against the in-memory fake Supabase/Groq
// backend in fake-backend.mjs. Synthetic data only — never touches production.
//
//   npm run test:e2e                 (uses Edge; set E2E_BROWSER=chrome for Chrome)
//   E2E_OUT=<dir> npm run test:e2e   (where screenshots + logs are written)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { startFakeBackend, createState, seed, IDS, SERVICE_KEY, ANON_KEY, PASSWORD, IMPORT_SOURCE_MARKER } from './fake-backend.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = process.env.E2E_OUT ?? path.join(os.tmpdir(), 'phases-e2e');
fs.mkdirSync(OUT, { recursive: true });
const BACKEND_PORT = 54329;
const APP_PORT = 3123;
const APP = `http://127.0.0.1:${APP_PORT}`;
const BACKEND = `http://127.0.0.1:${BACKEND_PORT}`;

const results = [];
const consoleErrors = [];
let current = '';

async function check(name, fn) {
  current = name;
  const started = Date.now();
  try {
    const detail = await Promise.race([
      fn(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('step timed out after 120s')), 120_000)),
    ]);
    results.push({ name, ok: true, ms: Date.now() - started, detail: detail ?? '' });
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`);
  } catch (err) {
    results.push({ name, ok: false, ms: Date.now() - started, detail: err?.message ?? String(err) });
    console.log(`  FAIL  ${name}\n        ${err?.message ?? err}`);
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function eq(a, b, msg) { if (a !== b) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

const db = async () => (await fetch(`${BACKEND}/__state`)).json();
const control = (body) => fetch(`${BACKEND}/__control`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
let ipCounter = 1;
const freshIp = () => `10.0.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`;

async function api(pathname, { method = 'GET', body, ip, request } = {}) {
  const headers = { 'Content-Type': 'application/json', 'X-Forwarded-For': ip ?? freshIp() };
  if (request) {
    const r = await request.fetch(`${APP}${pathname}`, { method, headers, data: body === undefined ? undefined : JSON.stringify(body) });
    let json = null; try { json = await r.json(); } catch { /* empty */ }
    return { status: r.status(), json };
  }
  const r = await fetch(`${APP}${pathname}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
  let json = null; try { json = await r.json(); } catch { /* empty */ }
  return { status: r.status, json, headers: r.headers };
}

function watchConsole(page, label) {
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push({ page: label, test: current, text: msg.text() }); });
  page.on('pageerror', (err) => consoleErrors.push({ page: label, test: current, text: `pageerror: ${err.message}` }));
}

async function login(browser, email, viewport = { width: 1280, height: 900 }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  watchConsole(page, email);
  await page.goto(`${APP}/login`);
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/admin/, { timeout: 60_000 });
  return { context, page };
}

async function answerQuiz(page, letters, { email, firstName } = {}) {
  for (const L of letters) {
    await page.locator('label', { hasText: `(${L})` }).first().click();
    await page.getByRole('button', { name: /Continue/ }).click();
  }
  if (email) await page.fill('input[type="email"]', email);
  if (firstName) await page.locator('input[type="text"]').first().fill(firstName);
  await page.getByRole('button', { name: /Get My Results/ }).click();
  await page.waitForURL(/\/result$/, { timeout: 60_000 });
}

async function noHorizontalOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}

// ── Boot ────────────────────────────────────────────────────────────────────
async function waitForApp() {
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${APP}/login`);
      if (r.status === 200) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error('Next.js dev server did not start within 4 minutes');
}

async function main() {
  const state = createState();
  seed(state);
  backendState = state;
  const { server } = await startFakeBackend(BACKEND_PORT, state);
  console.log(`fake backend on ${BACKEND}`);

  const logFile = fs.createWriteStream(path.join(OUT, 'next-dev.log'));
  const next = spawn('npx', ['next', 'dev', '-p', String(APP_PORT), '-H', '127.0.0.1'], {
    cwd: ROOT,
    shell: true,
    env: {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: BACKEND,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
      GROQ_API_KEY: 'e2e-fake-groq-key',
      GROQ_BASE_URL: `${BACKEND}/groq`,
      NEXT_PUBLIC_APP_URL: APP,
      NEXT_TELEMETRY_DISABLED: '1',
    },
  });
  next.stdout.pipe(logFile);
  next.stderr.pipe(logFile);

  const channel = process.env.E2E_BROWSER === 'chrome' ? 'chrome' : 'msedge';
  let browser;
  try {
    await waitForApp();
    console.log(`next dev on ${APP}`);
    browser = await chromium.launch({ channel, headless: true });
    await runScenarios(browser);
  } finally {
    await browser?.close().catch(() => {});
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(next.pid), '/T', '/F']);
    else next.kill('SIGTERM');
    server.close();
  }

  const failed = results.filter((r) => !r.ok);
  fs.writeFileSync(path.join(OUT, 'e2e-results.json'), JSON.stringify({ results, consoleErrors }, null, 2));
  console.log(`\n${results.length - failed.length}/${results.length} checks passed. Console errors captured: ${consoleErrors.length}`);
  for (const c of consoleErrors) console.log(`  console[${c.page}] (${c.test}): ${c.text.slice(0, 200)}`);
  console.log(`Artifacts: ${OUT}`);
  process.exitCode = failed.length > 0 ? 1 : 0;
}

// ── Scenarios ───────────────────────────────────────────────────────────────
const IMPORT_SOURCE = `${IMPORT_SOURCE_MARKER}
Title: E2E Energy Type Quiz. Four questions, each with options A-D.
Mostly A = Morning Crash Type, mostly B = Afternoon Slump Type, mostly C = Evening Wired Type, mostly D = All-Day Flat Type.
Each result has a description, two tips and a "Book a call" CTA linking to https://example.com/book (no link yet for All-Day Flat).`;

async function runScenarios(browser) {
  const SLUG = 'e2e-energy-type-quiz';
  let importedId = '';
  let resultToken = '';

  const { context: superCtx, page: admin } = await login(browser, 'super@e2e.test');
  admin.setDefaultTimeout(30_000); // short waits so a broken step fails instead of hanging

  console.log('\n[1] Import Wizard');
  await check('1.1 import: AI draft generated from pasted source and shown for review', async () => {
    await admin.goto(`${APP}/admin/tools/import`);
    await admin.locator('textarea').first().fill(IMPORT_SOURCE);
    await admin.getByRole('button', { name: /Generate Draft Tool Config/ }).click();
    await admin.getByRole('heading', { name: 'E2E Energy Type Quiz' }).waitFor({ timeout: 60_000 });
    const text = await admin.locator('body').innerText();
    assert(text.includes('Missing from source: CTA link for All-Day Flat Type'), 'missing-information warning not shown');
    assert(text.includes('Scoring from source'), 'provenance badge missing');
    assert(await admin.getByRole('button', { name: /Save as Draft/ }).isDisabled(), 'Save must be disabled until confirmed');
    return 'summary + warnings rendered, save gated on confirmation';
  });

  await check('1.2 import: nothing is written to the database before confirmation', async () => {
    const s = await db();
    assert(!s.tools.some((t) => t.slug === SLUG), 'tool was created before confirmation');
  });

  await check('1.3 import: test harness on review screen scores sample answers', async () => {
    await admin.getByRole('button', { name: /Test Outcome Mapping/ }).click();
    await admin.getByRole('button', { name: 'All C' }).click();
    await admin.getByText('Evening Wired Type', { exact: true }).first().waitFor();
  });

  await check('1.4 import: confirm + save creates tool (draft) and all questions atomically', async () => {
    await admin.locator('label:has-text("I have reviewed the questions") input[type="checkbox"]').check();
    await admin.getByRole('button', { name: /Save as Draft/ }).click();
    await admin.getByText('Draft Saved').waitFor({ timeout: 30_000 });
    const s = await db();
    const tool = s.tools.find((t) => t.slug === SLUG);
    assert(tool, 'tool not created');
    importedId = tool.id;
    eq(tool.status, 'draft', 'status');
    eq(tool.result_strategy, 'hybrid_ai_with_outcome', 'strategy');
    const qs = s.questions.filter((q) => q.tool_id === tool.id).sort((a, b) => a.order_index - b.order_index);
    eq(qs.length, 4, 'question count');
    assert(qs.every((q, i) => q.order_index === i), 'order_index not sequential');
    assert(qs.every((q) => q.options.every((o) => o.category)), 'option categories missing');
    assert(/Scoring provenance: taken from source/.test(tool.admin_notes ?? ''), 'provenance not recorded in admin notes');
    return `tool ${tool.id}, 4 questions`;
  });

  await check('1.5 import: invalid JSON config shows clear errors and cannot be saved', async () => {
    await admin.goto(`${APP}/admin/tools/import`);
    await admin.getByRole('button', { name: /Paste JSON Config/ }).click();
    await admin.locator('textarea').first().fill(JSON.stringify({ questions: [{ field_type: 'radio', options: [] }] }));
    await admin.getByRole('button', { name: /Load JSON Draft/ }).click();
    await admin.getByText('Missing "title".').waitFor();
    await admin.getByText('Question #1 has no "label" (question text).').waitFor();
    assert(await admin.getByRole('button', { name: /Save as Draft/ }).isDisabled(), 'save should be disabled');
  });

  await check('1.6 import API: refuses unconfirmed or invalid configs; rejects duplicate slug', async () => {
    const r1 = await api('/api/admin/tools/import/commit', { method: 'POST', body: { config: { title: 'x' } }, request: superCtx.request });
    eq(r1.status, 400, 'unconfirmed status');
    const r2 = await api('/api/admin/tools/import/commit', { method: 'POST', body: { confirmed: true, config: { title: 'Bad', questions: [] } }, request: superCtx.request });
    eq(r2.status, 400, 'invalid status');
    const s = await db();
    const cfg = { title: 'Dup', slug: SLUG, result_strategy: 'ai_generated', system_prompt: 'x', questions: [{ label: 'Q', field_type: 'text' }] };
    const r3 = await api('/api/admin/tools/import/commit', { method: 'POST', body: { confirmed: true, config: cfg }, request: superCtx.request });
    eq(r3.status, 409, 'duplicate slug status');
    eq((await db()).tools.length, s.tools.length, 'no tool should be created');
  });

  await check('1.7 import (AI failure): Groq outage gives a clear error, nothing saved', async () => {
    await control({ groqMode: 'fail' });
    const r = await api('/api/admin/tools/import', { method: 'POST', body: { text: IMPORT_SOURCE }, request: superCtx.request });
    await control({ groqMode: 'ok' });
    eq(r.status, 502, 'status');
    eq(r.json.error, 'AI generation failed. Please try again.', 'message');
  });

  console.log('\n[2] Draft visibility + admin preview');
  const anon = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const anonPage = await anon.newPage();
  watchConsole(anonPage, 'anonymous');

  await check('2.1 draft tool is not public (page + API 404)', async () => {
    const r = await api(`/api/tools/${SLUG}`);
    eq(r.status, 404, 'api status');
    await anonPage.goto(`${APP}/t/${SLUG}`);
    await anonPage.getByText('Assessment not found.').waitFor();
    const r2 = await api('/api/generate', { method: 'POST', body: { slug: SLUG, email: 'x@e2e.test', answers: {} } });
    eq(r2.status, 404, 'generate on draft');
  });

  await check('2.2 admin preview of the draft runs the real pipeline and saves nothing', async () => {
    const before = (await db()).submissions.length;
    await admin.goto(`${APP}/t/${SLUG}?preview=1`);
    await admin.getByText('Admin preview.').waitFor();
    await answerQuiz(admin, 'BBBB');
    await admin.getByText('Admin preview result.').waitFor();
    await admin.getByRole('heading', { name: 'Afternoon Slump Type' }).waitFor();
    eq((await db()).submissions.length, before, 'submissions count changed');
  });

  console.log('\n[3] Admin reload + editing');
  await check('3.1 question builder: edit a question, reload, change persisted', async () => {
    await admin.goto(`${APP}/admin/tools/${importedId}/questions`);
    await admin.getByLabel('Edit question 1').click();
    const input = admin.locator('#question-form input').first();
    await input.fill('When does your energy dip the most?');
    await admin.getByRole('button', { name: 'Save Changes' }).click();
    await admin.getByText('Question updated').waitFor();
    await admin.reload();
    await admin.getByText('When does your energy dip the most?').waitFor();
    const q = (await db()).questions.find((x) => x.tool_id === importedId && x.order_index === 0);
    eq(q.label, 'When does your energy dip the most?', 'db label');
    assert(q.options[0].category === 'morning_crash', 'options/categories preserved on label edit');
  });

  await check('3.2 settings: publish checks pass, Publish makes the tool live', async () => {
    await admin.goto(`${APP}/admin/tools/${importedId}/settings`);
    await admin.getByText('Only admins can open this quiz').waitFor();
    await admin.getByRole('button', { name: 'Publish' }).click();
    await admin.getByText('Anyone with the link can take this quiz.').waitFor();
    eq((await db()).tools.find((t) => t.id === importedId).status, 'published', 'db status');
  });

  console.log('\n[4] Public quiz → scoring → saved result → permanent link');
  await check('4.1 public quiz renders, submission saved with outcome + personalised narrative', async () => {
    await anonPage.goto(`${APP}/t/${SLUG}`);
    await answerQuiz(anonPage, 'BBBB', { email: 'synthetic.respondent@e2e.test', firstName: 'Synthia' });
    await anonPage.getByRole('heading', { name: 'Afternoon Slump Type' }).waitFor();
    await anonPage.getByText('Personalised For You').waitFor();
    const text = await anonPage.locator('main').innerText();
    // this quiz's identifiers + foreign ones the fake model echoes (caught by the generic safety net)
    for (const raw of ['energy_q1', 'morning_crash', 'afternoon_slump', 'q1SymptomDriver', 'histamine_inflammatory', '{{', 'Model-chosen title']) {
      assert(!text.includes(raw), `raw identifier "${raw}" leaked to the respondent`);
    }
    const sub = (await db()).submissions.find((s) => s.tool_id === importedId);
    assert(sub, 'submission not saved');
    eq(sub.outcome_data.id, 'afternoon_slump', 'stored outcome');
    eq(sub.generation_status, 'success', 'generation_status');
    assert(sub.result_json && sub.ai_result, 'result_json/ai_result missing');
    assert(Object.keys(sub.answers).length === 4, 'answers not stored');
    resultToken = sub.result_token;
    const href = await anonPage.getByRole('link', { name: /Open permanent link/ }).getAttribute('href');
    assert(href.endsWith(`/r/${resultToken}`), `permanent link mismatch: ${href}`);
  });

  await check('4.2 permanent result link renders the saved result in a fresh browser', async () => {
    const fresh = await browser.newContext();
    const p = await fresh.newPage();
    watchConsole(p, 'fresh');
    await p.goto(`${APP}/r/${resultToken}`);
    await p.getByRole('heading', { name: 'Afternoon Slump Type' }).waitFor();
    await p.getByText('Results for Synthia').waitFor();
    await p.getByText('Personalised For You').waitFor();
    const r = await api(`/api/results/${resultToken}`);
    eq(r.status, 200, 'api status');
    for (const k of ['compiled_prompt', 'email', 'phone', 'answers', 'ghl_response', 'result_token']) {
      assert(!(k in r.json.submission), `public result API leaks ${k}`);
    }
    eq((await api('/api/results/not-a-token')).status, 404, 'bad token');
    eq((await api(`/api/results/${'0'.repeat(48)}`)).status, 404, 'unknown token');
    await fresh.close();
  });

  await check('4.3 public tool API exposes no prompts, scoring config, webhooks or option categories', async () => {
    const r = await api(`/api/tools/${SLUG}`);
    eq(r.status, 200, 'status');
    for (const k of ['system_prompt', 'scoring_config', 'result_config', 'result_template', 'admin_notes', 'webhook_url', 'ghl_webhook_url', 'workspace_id']) {
      assert(!(k in r.json.tool), `public tool API leaks ${k}`);
    }
    assert(r.json.questions.every((q) => (q.options ?? []).every((o) => typeof o === 'string' || !('category' in o || 'score' in o))), 'option scoring metadata leaked');
  });

  console.log('\n[5] Scoring through the production API (and parity with admin preview)');
  const qLabels = (await db()).questions.filter((q) => q.tool_id === importedId).sort((a, b) => a.order_index - b.order_index).map((q) => q.label);
  const byLetters = (letters) => Object.fromEntries(letters.split('').map((L, i) => [qLabels[i], L]));
  const cases = [
    ['AAAA', 'morning_crash'], ['BBBB', 'afternoon_slump'], ['CCCC', 'evening_wired'], ['DDDD', 'all_day_flat'],
    ['CDCA', 'evening_wired'], // mixed, clear majority
    ['AABB', 'morning_crash'], // tie A/B → category order
    ['DDBB', 'afternoon_slump'], // tie B/D → B is earlier in categories
  ];
  for (const [letters, expected] of cases) {
    await check(`5 scoring ${letters} → ${expected} (production API = admin preview)`, async () => {
      const live = await api('/api/generate', { method: 'POST', body: { slug: SLUG, email: 'synthetic@e2e.test', answers: byLetters(letters) } });
      eq(live.status, 200, `live status (${JSON.stringify(live.json)})`);
      eq(live.json.outcome.id, expected, 'live outcome');
      const prev = await api(`/api/admin/tools/${importedId}/preview`, { method: 'POST', body: { answers: byLetters(letters), run_ai: false }, request: superCtx.request });
      eq(prev.status, 200, 'preview status');
      eq(prev.json.outcome.id, live.json.outcome.id, 'preview/live parity');
      const saved = (await db()).submissions.find((s) => s.result_token === live.json.result_token);
      eq(saved.outcome_data.id, expected, 'stored outcome');
      return letters === 'AABB' || letters === 'DDBB' ? `tie → ${prev.json.breakdown.tieBrokenBy}` : '';
    });
  }

  await check('5.8 missing / invalid answers rejected with friendly errors (no internals)', async () => {
    const missing = await api('/api/generate', { method: 'POST', body: { slug: SLUG, email: 'a@e2e.test', answers: byLetters('AA') } });
    eq(missing.status, 400, 'missing status');
    assert(/^Please answer:/.test(missing.json.error), `missing message: ${missing.json.error}`);
    const invalid = await api('/api/generate', { method: 'POST', body: { slug: SLUG, email: 'a@e2e.test', answers: { ...byLetters('AAAA'), [qLabels[1]]: '(Z) injected' } } });
    eq(invalid.status, 400, 'invalid status');
    assert(/^Invalid choice for:/.test(invalid.json.error), 'invalid message');
    const badEmail = await api('/api/generate', { method: 'POST', body: { slug: SLUG, email: 'not-an-email', answers: byLetters('AAAA') } });
    eq(badEmail.status, 400, 'bad email status');
    const unknown = await api('/api/generate', { method: 'POST', body: { slug: 'does-not-exist', email: 'a@e2e.test', answers: {} } });
    eq(unknown.status, 404, 'unknown slug');
    const badJson = await fetch(`${APP}/api/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': freshIp() }, body: '{' });
    eq(badJson.status, 400, 'malformed body');
    for (const r of [missing, invalid, badEmail, unknown]) {
      for (const k of ['detail', 'hint', 'code', 'stack']) assert(!(k in r.json), `error response leaks ${k}`);
    }
  });

  await check('5.9 AI failure: hybrid still returns + saves the scored outcome', async () => {
    await control({ groqMode: 'fail' });
    const r = await api('/api/generate', { method: 'POST', body: { slug: SLUG, email: 'fail@e2e.test', answers: byLetters('CCCC') } });
    await control({ groqMode: 'malformed' });
    const r2 = await api('/api/generate', { method: 'POST', body: { slug: SLUG, email: 'malformed@e2e.test', answers: byLetters('DDDD') } });
    await control({ groqMode: 'ok' });
    eq(r.status, 200, 'status on outage');
    eq(r.json.outcome.id, 'evening_wired', 'outcome on outage');
    eq(r.json.aiPersonalization, null, 'no AI text on outage');
    eq(r2.status, 200, 'status on malformed');
    eq(r2.json.aiPersonalization, null, 'malformed AI output must not be shown');
    const s = await db();
    const saved = s.submissions.find((x) => x.result_token === r.json.result_token);
    eq(saved.generation_status, 'failed', 'stored generation_status');
    assert(saved.generation_error, 'generation_error not stored');
    const p = await (await browser.newContext()).newPage();
    await p.goto(`${APP}/r/${r.json.result_token}`);
    await p.getByRole('heading', { name: 'Evening Wired Type' }).waitFor();
    assert(!(await p.locator('main').innerText()).includes('missing result configuration'), 'fallback banner shown wrongly');
    await p.context().close();
  });

  await check('5.10 broken live config cannot be saved on a published tool', async () => {
    const tool = (await db()).tools.find((t) => t.id === importedId);
    const broken = { ...tool, result_config: { outcomes: tool.result_config.outcomes.filter((o) => o.id !== 'evening_wired') } };
    const r = await api(`/api/admin/tools/${importedId}`, { method: 'PUT', body: broken, request: superCtx.request });
    eq(r.status, 400, 'status');
    assert(/This tool is live/.test(r.json.error), r.json.error);
    eq((await db()).tools.find((t) => t.id === importedId).result_config.outcomes.length, 4, 'config unchanged');
  });

  await check('5.11 unsafe CTA URL (javascript:) is rejected', async () => {
    const tool = (await db()).tools.find((t) => t.id === importedId);
    const rc = JSON.parse(JSON.stringify(tool.result_config));
    rc.outcomes[0].cta_url = 'javascript:alert(document.cookie)';
    const r = await api(`/api/admin/tools/${importedId}`, { method: 'PUT', body: { ...tool, result_config: rc }, request: superCtx.request });
    eq(r.status, 400, 'status');
    assert(/cta_url/.test(r.json.error), r.json.error);
  });

  console.log('\n[6] Existing tool migration (no SQL)');
  const legacyBefore = await db();
  const legacySubsBefore = JSON.stringify(legacyBefore.submissions.filter((s) => s.tool_id === IDS.legacy));
  const legacyQsBefore = legacyBefore.questions.filter((q) => q.tool_id === IDS.legacy).map((q) => ({ id: q.id, label: q.label, options: q.options }));

  await check('6.1 migration assistant: generate draft, review mappings, save', async () => {
    await admin.goto(`${APP}/admin/tools/${IDS.legacy}/settings`);
    await admin.getByText('This tool is missing result configuration.').waitFor();
    await admin.getByRole('button', { name: /Generate Draft Result Config/ }).click();
    await admin.getByText('1. Answer → outcome mapping').waitFor({ timeout: 60_000 });
    const selects = admin.locator('select[aria-label^="Category for"]');
    eq(await selects.count(), 12, 'mapping selects');
    // Admin corrects one mapping by hand before saving
    await selects.nth(3).selectOption('night_waker');
    const save = admin.getByRole('button', { name: 'Save Result Configuration' });
    assert(await save.isDisabled(), 'save must wait for review confirmation');
    await admin.locator('label:has-text("I have reviewed every mapping") input').check();
    await save.click();
    await admin.getByText(/Result configuration saved/).waitFor({ timeout: 30_000 });
  });

  await check('6.2 migration preserved tool id, question ids, option text and submissions', async () => {
    const s = await db();
    const tool = s.tools.find((t) => t.id === IDS.legacy);
    assert(tool, 'tool id changed or tool missing');
    eq(tool.result_strategy, 'hybrid_ai_with_outcome', 'strategy');
    const qs = s.questions.filter((q) => q.tool_id === IDS.legacy);
    eq(qs.length, legacyQsBefore.length, 'question count');
    for (const before of legacyQsBefore) {
      const after = qs.find((q) => q.id === before.id);
      assert(after, `question ${before.id} missing`);
      eq(after.label, before.label, 'question label');
      eq(JSON.stringify(after.options.map((o) => o.label)), JSON.stringify(before.options), 'option text');
      assert(after.options.every((o) => o.category), 'every option mapped');
    }
    eq(qs.find((q) => q.order_index === 0).options[3].category, 'night_waker', 'manual correction saved');
    eq(JSON.stringify(s.submissions.filter((x) => x.tool_id === IDS.legacy)), legacySubsBefore, 'existing submissions changed');
  });

  await check('6.3 migrated tool scores live submissions', async () => {
    const labels = legacyQsBefore.map((q) => q.label);
    const r = await api('/api/generate', { method: 'POST', body: { slug: 'legacy-sleep-quiz', email: 'm@e2e.test', answers: Object.fromEntries(labels.map((l) => [l, 'C'])) } });
    eq(r.status, 200, JSON.stringify(r.json));
    eq(r.json.outcome.id, 'night_waker', 'outcome');
  });

  console.log('\n[7] Bendy-shaped tool (migration 008 state)');
  await check('7.1 Bendy all-D via the public UI → Complex Multi-System, narrative without raw variable names', async () => {
    await anonPage.goto(`${APP}/t/bendy-menopause-type-quiz-e2e`);
    await answerQuiz(anonPage, 'DDDDDDD', { email: 'bendy.synthetic@e2e.test' });
    await anonPage.getByRole('heading', { name: 'Complex Multi-System Pattern' }).waitFor();
    await anonPage.getByText('Personalised For You').waitFor();
    const text = await anonPage.locator('main').innerText();
    for (const raw of ['q1SymptomDriver', 'q7SearchForAnswers', 'complex_multisystem', 'histamine_inflammatory', '{{']) {
      assert(!text.includes(raw), `raw identifier "${raw}" leaked`);
    }
    assert(text.includes('Track symptoms by body system.'), 'configured recommendation missing');
  });

  for (const [L, title] of [['A', 'Musculoskeletal + Hypermobility Pattern'], ['B', 'Histamine + Inflammatory Reactivity Pattern'], ['C', 'Dysautonomia + Autonomic Regulation Pattern']]) {
    await check(`7.${L} Bendy all-${L} → ${title}`, async () => {
      const qs = (await db()).questions.filter((q) => q.tool_id === IDS.bendy).sort((a, b) => a.order_index - b.order_index);
      const r = await api('/api/generate', { method: 'POST', body: { slug: 'bendy-menopause-type-quiz-e2e', email: 'b@e2e.test', answers: Object.fromEntries(qs.map((q) => [q.label, L])) } });
      eq(r.status, 200, JSON.stringify(r.json));
      eq(r.json.outcome.title, title, 'title');
    });
  }

  console.log('\n[8] Authentication + workspace isolation');
  const { context: bCtx } = await login(browser, 'provider-b@e2e.test');
  const { context: aCtx } = await login(browser, 'provider-a@e2e.test');
  const bendyQ = (await db()).questions.find((q) => q.tool_id === IDS.bendy);

  await check('8.1 provider B only lists its own workspace tools', async () => {
    const r = await api('/api/admin/tools', { request: bCtx.request });
    eq(r.status, 200, 'status');
    assert(r.json.tools.length > 0 && r.json.tools.every((t) => t.workspace_id === IDS.wsB), 'cross-workspace tools listed');
  });

  await check('8.2 provider B is forbidden from every workspace-A tool endpoint', async () => {
    const attempts = [
      ['GET', `/api/admin/tools/${IDS.bendy}`],
      ['GET', `/api/admin/tools/${IDS.bendy}/submissions`],
      ['GET', `/api/admin/tools/${IDS.bendy}/questions`],
      ['PATCH', `/api/admin/tools/${IDS.bendy}/questions/${bendyQ.id}`, { label: 'pwned' }],
      ['DELETE', `/api/admin/tools/${IDS.bendy}/questions/${bendyQ.id}`],
      ['PUT', `/api/admin/tools/${IDS.bendy}/questions`, { questions: [{ id: bendyQ.id, order_index: 99 }] }],
      ['PATCH', `/api/admin/tools/${IDS.bendy}`, { title: 'pwned' }],
      ['PUT', `/api/admin/tools/${IDS.bendy}`, { title: 'pwned' }],
      ['DELETE', `/api/admin/tools/${IDS.bendy}`],
      ['POST', `/api/admin/tools/${IDS.bendy}/preview`, { answers: {} }],
      ['POST', `/api/admin/tools/${IDS.bendy}/publish`, { publish: false }],
      ['GET', `/api/admin/tools/${IDS.bendy}/publish`],
      ['POST', `/api/admin/tools/${IDS.bendy}/apply-result-config`, {}],
      ['POST', `/api/admin/tools/${IDS.bendy}/infer-result-config`],
    ];
    const bad = [];
    for (const [method, p, body] of attempts) {
      const r = await api(p, { method, body, request: bCtx.request });
      if (r.status !== 403) bad.push(`${method} ${p} → ${r.status}`);
    }
    assert(bad.length === 0, `not forbidden: ${bad.join('; ')}`);
    const after = (await db()).questions.find((q) => q.id === bendyQ.id);
    assert(after && after.label === bendyQ.label && after.order_index === bendyQ.order_index, 'workspace-A question was modified');
    eq((await db()).tools.find((t) => t.id === IDS.bendy).status, 'published', 'workspace-A tool modified');
    return `${attempts.length} endpoints → 403`;
  });

  await check('8.3 provider cannot move a tool to another workspace (mass assignment blocked)', async () => {
    const r = await api(`/api/admin/tools/${IDS.wsBTool}`, { method: 'PATCH', body: { workspace_id: IDS.wsA, status: 'draft', title: 'Other Clinic Intake (renamed)' }, request: bCtx.request });
    eq(r.status, 200, 'status');
    const t = (await db()).tools.find((x) => x.id === IDS.wsBTool);
    eq(t.workspace_id, IDS.wsB, 'workspace_id');
    eq(t.status, 'published', 'status not patchable');
    eq(t.title, 'Other Clinic Intake (renamed)', 'allowed field updated');
  });

  await check('8.4 provider import is always placed in their own workspace', async () => {
    const cfg = { title: 'B Import', slug: 'b-import-e2e', result_strategy: 'ai_generated', system_prompt: 'Summarise', questions: [{ label: 'How are you?', field_type: 'text' }] };
    const r = await api('/api/admin/tools/import/commit', { method: 'POST', body: { confirmed: true, config: cfg, workspace_id: IDS.wsA }, request: bCtx.request });
    eq(r.status, 201, JSON.stringify(r.json));
    eq((await db()).tools.find((t) => t.slug === 'b-import-e2e').workspace_id, IDS.wsB, 'workspace');
  });

  await check('8.5 provider B cannot preview workspace-A drafts through the public route', async () => {
    await api(`/api/admin/tools/${importedId}/publish`, { method: 'POST', body: { publish: false }, request: superCtx.request });
    const r = await api(`/api/tools/${SLUG}?preview=1`, { request: bCtx.request });
    eq(r.status, 404, 'provider B preview');
    const s = await api(`/api/tools/${SLUG}?preview=1`, { request: superCtx.request });
    eq(s.status, 200, 'super admin preview');
    eq(s.json.preview, true, 'preview flag');
    await api(`/api/admin/tools/${importedId}/publish`, { method: 'POST', body: { publish: true }, request: superCtx.request });
  });

  await check('8.6 provider A (positive control) can manage its own workspace tool', async () => {
    eq((await api(`/api/admin/tools/${IDS.bendy}`, { request: aCtx.request })).status, 200, 'get tool');
    eq((await api(`/api/admin/tools/${IDS.bendy}/submissions`, { request: aCtx.request })).status, 200, 'get submissions');
    const subs = (await api(`/api/admin/tools/${IDS.bendy}/submissions`, { request: aCtx.request })).json.submissions;
    assert(subs.every((s) => s.tool_id === IDS.bendy), 'foreign submissions returned');
  });

  await check('8.7 unauthenticated requests are rejected', async () => {
    eq((await api('/api/admin/tools')).status, 401, 'list');
    eq((await api(`/api/admin/tools/${IDS.bendy}/submissions`)).status, 401, 'submissions');
    eq((await api('/api/admin/tools/import', { method: 'POST', body: { text: 'x'.repeat(60) } })).status, 401, 'import');
    const r = await fetch(`${APP}/admin`, { redirect: 'manual' });
    assert([302, 307, 308].includes(r.status) && (r.headers.get('location') ?? '').includes('/login'), `admin page not redirected (${r.status})`);
  });

  await check('8.8 super admin cannot be deactivated through the workspace users route', async () => {
    const superUser = (await db()).profiles.find((p) => p.role === 'super_admin');
    const r = await api(`/api/admin/workspaces/${IDS.wsA}/users`, { method: 'PATCH', body: { user_id: superUser.user_id, is_active: false }, request: superCtx.request });
    eq(r.status, 400, 'status');
  });

  await check('8.9 the app never uses the anon key for table access (all data via service role)', async () => {
    const nonService = backendState.log.filter((l) => !l.service);
    assert(nonService.length === 0, `anon-key table calls: ${JSON.stringify(nonService.slice(0, 5))}`);
    return `${backendState.log.length} table calls, all service-role`;
  });

  console.log('\n[9] Rate limiting');
  await check('9.1 /api/generate is rate limited per client IP', async () => {
    const ip = '203.0.113.77';
    const statuses = [];
    for (let i = 0; i < 12; i++) {
      statuses.push((await api('/api/generate', { method: 'POST', body: { slug: SLUG, email: 'rl@e2e.test', answers: {} }, ip })).status);
    }
    assert(statuses.slice(0, 10).every((s) => s === 400), `first 10: ${statuses.slice(0, 10)}`);
    assert(statuses.slice(10).every((s) => s === 429), `after limit: ${statuses.slice(10)}`);
  });

  console.log('\n[10] Layout (mobile 390px + desktop 1280px)');
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mPage = await mobile.newPage();
  watchConsole(mPage, 'mobile');
  await check('10.1 public quiz + result have no horizontal overflow on mobile', async () => {
    await mPage.goto(`${APP}/t/bendy-menopause-type-quiz-e2e`);
    await mPage.locator('label', { hasText: '(A)' }).first().waitFor();
    assert(await noHorizontalOverflow(mPage), 'quiz page overflows');
    await mPage.screenshot({ path: path.join(OUT, 'mobile-quiz.png'), fullPage: true });
    await mPage.goto(`${APP}/r/${resultToken}`);
    await mPage.getByRole('heading', { name: 'Afternoon Slump Type' }).waitFor();
    assert(await noHorizontalOverflow(mPage), 'result page overflows');
    await mPage.screenshot({ path: path.join(OUT, 'mobile-result.png'), fullPage: true });
  });

  const { page: mAdmin } = await login(browser, 'super@e2e.test', { width: 390, height: 844 });
  for (const [name, url, ready] of [
    ['dashboard', '/admin', 'Dashboard'],
    ['settings', `/admin/tools/${IDS.legacy}/settings`, 'Tool Settings'],
    ['questions', `/admin/tools/${importedId}/questions`, 'Question Builder'],
    ['import', '/admin/tools/import', 'Import Quiz Wizard'],
  ]) {
    await check(`10.2 admin ${name} page has no horizontal overflow on mobile`, async () => {
      await mAdmin.goto(`${APP}${url}`);
      await mAdmin.getByText(ready, { exact: true }).first().waitFor();
      await mAdmin.waitForTimeout(500);
      await mAdmin.screenshot({ path: path.join(OUT, `mobile-admin-${name}.png`), fullPage: true });
      const ok = await noHorizontalOverflow(mAdmin);
      if (!ok) {
        const w = await mAdmin.evaluate(() => document.documentElement.scrollWidth);
        throw new Error(`scrollWidth ${w}px > 390px`);
      }
    });
  }

  await check('10.3 desktop screenshots captured', async () => {
    await admin.goto(`${APP}/admin/tools/${importedId}/settings`);
    await admin.getByText('Tool Settings').waitFor();
    await admin.screenshot({ path: path.join(OUT, 'desktop-settings.png'), fullPage: true });
    await admin.goto(`${APP}/admin`);
    await admin.getByText('Dashboard', { exact: true }).first().waitFor();
    await admin.screenshot({ path: path.join(OUT, 'desktop-dashboard.png'), fullPage: true });
  });

}

let backendState;

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
