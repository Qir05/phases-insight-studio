// REAL-PROVIDER AI test: real Groq (key from .env.local), real Next.js app,
// headless Edge — but the database is the in-memory fake from fake-backend.mjs,
// so nothing is persisted anywhere. Synthetic data only.
//
//   node tests/e2e/run-real-ai.mjs
//
// Phase A runs with the configured model (default openai/gpt-oss-120b).
// Phase B restarts the app with GROQ_MODEL=llama-3.3-70b-versatile (withdrawn
// for this account) to verify real provider error handling.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { startFakeBackend, createState, seed, IDS, SERVICE_KEY, ANON_KEY, PASSWORD } from './fake-backend.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = process.env.E2E_OUT ?? path.join(os.tmpdir(), 'phases-real-ai');
fs.mkdirSync(OUT, { recursive: true });
const BACKEND = 'http://127.0.0.1:54330';
const APP_PORT = 3124;
const APP = `http://127.0.0.1:${APP_PORT}`;
const RAW_IDS = /q1SymptomDriver|q7SearchForAnswers|musculoskeletal_hypermobility|histamine_inflammatory|dysautonomia_autonomic|complex_multisystem|\{\{|\[variable:/;

const results = [];
async function check(name, fn) {
  const t = Date.now();
  try {
    const detail = await Promise.race([fn(), new Promise((_, r) => setTimeout(() => r(new Error('timed out after 150s')), 150_000))]);
    results.push({ name, ok: true, ms: Date.now() - t, detail: detail ?? '' });
    console.log(`  PASS  ${name} (${Date.now() - t}ms)${detail ? ` — ${detail}` : ''}`);
  } catch (err) {
    results.push({ name, ok: false, ms: Date.now() - t, detail: err.message });
    console.log(`  FAIL  ${name}\n        ${err.message}`);
  }
}
const assert = (c, m) => { if (!c) throw new Error(m); };

let state;
async function api(request, p, method = 'GET', body) {
  const r = await request.fetch(`${APP}${p}`, { method, headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` }, data: body === undefined ? undefined : JSON.stringify(body) });
  let json = null; try { json = await r.json(); } catch { /* empty */ }
  return { status: r.status(), json };
}

function startApp(extraEnv, logName) {
  const env = { ...process.env, ...extraEnv,
    NEXT_PUBLIC_SUPABASE_URL: BACKEND, NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
    NEXT_PUBLIC_APP_URL: APP, NEXT_TELEMETRY_DISABLED: '1' };
  delete env.GROQ_BASE_URL; // real provider
  delete env.GROQ_API_KEY;  // let Next load the real key from .env.local
  const proc = spawn('npx', ['next', 'dev', '-p', String(APP_PORT), '-H', '127.0.0.1'], { cwd: ROOT, shell: true, env });
  const log = fs.createWriteStream(path.join(OUT, logName));
  proc.stdout.pipe(log); proc.stderr.pipe(log);
  return proc;
}
async function stopApp(proc) {
  if (process.platform === 'win32') await new Promise((r) => spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F']).on('exit', r));
  else proc.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 1500));
}
async function waitForApp() {
  for (const end = Date.now() + 240_000; Date.now() < end;) {
    try { if ((await fetch(`${APP}/login`)).status === 200) return; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error('app did not start');
}
async function login(browser, email) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(90_000);
  await page.goto(`${APP}/login`);
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/admin/, { timeout: 60_000 });
  return { context, page };
}

/** Refuse to run unless the app is provably talking to the fake database. */
async function assertNotProduction() {
  const fake = await fetch(`${APP}/api/tools/bendy-menopause-type-quiz-e2e`);
  const prod = await fetch(`${APP}/api/tools/bendy-menopause-type-quiz`);
  if (fake.status !== 200 || prod.status !== 404 || state.log.length === 0) {
    throw new Error('SAFETY STOP: app is not using the fake database — aborting before any write.');
  }
}

const bendyAnswers = (L) => Object.fromEntries(state.db.questions.filter((q) => q.tool_id === IDS.bendy).sort((a, b) => a.order_index - b.order_index).map((q) => [q.label, L]));

async function main() {
  state = createState(); seed(state);
  const { server } = await startFakeBackend(54330, state);
  const browser = await chromium.launch({ channel: process.env.E2E_BROWSER === 'chrome' ? 'chrome' : 'msedge', headless: true });
  let app;
  try {
    // ── Phase A: configured model ────────────────────────────────────────────
    app = startApp({}, 'next-real-ai-A.log');
    await waitForApp();
    await assertNotProduction();
    console.log('\n[A] Real Groq — configured model');
    const { context: admin, page } = await login(browser, 'super@e2e.test');

    await check('A1 admin full preview API (hybrid, Bendy-shaped, all D) — real AI personalisation', async () => {
      const r = await api(admin.request, `/api/admin/tools/${IDS.bendy}/preview`, 'POST', { answers: bendyAnswers('D'), run_ai: true });
      assert(r.status === 200, `status ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
      assert(r.json.generation_status === 'success', `generation_status=${r.json.generation_status} error=${r.json.generation_error}`);
      assert(r.json.outcome.title === 'Complex Multi-System Pattern', 'outcome');
      assert(r.json.result_json?.result_title === 'Complex Multi-System Pattern', 'title not pinned to outcome');
      assert(r.json.ai_result.length > 150, 'AI text too short');
      assert(!RAW_IDS.test(r.json.ai_result), 'raw identifier in AI text');
      fs.writeFileSync(path.join(OUT, 'A1-ai-result.md'), r.json.ai_result);
      return `model=${r.json.model_used}, ${r.json.ai_result.length} chars`;
    });

    await check('A2 admin full preview via UI (Test Outcome Mapping → Run full preview)', async () => {
      await page.goto(`${APP}/admin/tools/${IDS.bendy}/questions`);
      await page.getByRole('button', { name: /Test Outcome Mapping/ }).click();
      await page.getByRole('button', { name: 'All B' }).click();
      await page.getByRole('button', { name: /Run full preview/ }).click();
      await page.getByText(/AI personalisation generated by/).waitFor();
      assert(!(await page.getByText(/Full preview failed/).count()), 'failure banner shown');
      await page.screenshot({ path: path.join(OUT, 'A2-full-preview.png'), fullPage: true });
      return (await page.getByText(/AI personalisation generated by/).innerText()).trim();
    });

    await check('A3 draft-preview quiz flow (/t/…?preview=1) shows the personalised result, saves nothing', async () => {
      const before = state.db.submissions.length;
      await page.goto(`${APP}/t/bendy-menopause-type-quiz-e2e?preview=1`);
      for (let i = 0; i < 7; i++) {
        await page.locator('label', { hasText: '(C)' }).first().click();
        await page.getByRole('button', { name: /Continue/ }).click();
      }
      await page.getByRole('button', { name: /Get My Results/ }).click();
      await page.waitForURL(/\/result$/);
      await page.getByText('Personalised For You').waitFor();
      assert(!(await page.getByText('Preview failed:').count()), 'preview failure banner shown');
      const text = await page.locator('main').innerText();
      assert(text.includes('Dysautonomia + Autonomic Regulation Pattern'), 'outcome missing');
      assert(!RAW_IDS.test(text), 'raw identifier shown');
      assert(state.db.submissions.length === before, 'preview created a submission');
      await page.screenshot({ path: path.join(OUT, 'A3-preview-result.png'), fullPage: true });
    });

    await check('A4 public submission (hybrid) — personalisation generated and stored in the fake DB', async () => {
      const r = await api(admin.request, '/api/generate', 'POST', { slug: 'bendy-menopause-type-quiz-e2e', email: 'synthetic.real-ai@e2e.test', answers: bendyAnswers('A') });
      assert(r.status === 200, `status ${r.status}`);
      assert(r.json.aiPersonalization && r.json.aiPersonalization.length > 150, 'no personalisation');
      assert(!RAW_IDS.test(r.json.aiPersonalization), 'raw identifier');
      const saved = state.db.submissions.find((s) => s.result_token === r.json.result_token);
      assert(saved.generation_status === 'success', `stored status ${saved.generation_status}`);
      return `stored model_used=${saved.model_used}`;
    });

    await check('A5 ai_generated preview (no outcome scoring) — real AI result', async () => {
      const r = await api(admin.request, `/api/admin/tools/${IDS.wsBTool}/preview`, 'POST', { answers: { 'Main concern?': 'Afternoon fatigue and poor sleep (synthetic)' } });
      assert(r.status === 200, `status ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
      assert(r.json.result_json?.short_summary, 'no structured result');
      return `model=${r.json.model_used}`;
    });

    await check('A6 Import Wizard — real AI draft from synthetic source text (review only)', async () => {
      const source = `SYNTHETIC SLEEP STYLE QUIZ (test material, not a real product)
Quiz title: Sleep Style Quiz. Description: Discover your sleep style in 3 questions.
Q1. When do you naturally get sleepy? (A) Before 10pm (B) Around midnight (C) It changes every night
Q2. How do you feel when you wake up? (A) Refreshed (B) Groggy for an hour (C) It depends on the day
Q3. What disturbs your sleep most? (A) Early light (B) A racing mind (C) An irregular schedule
Scoring: mostly A answers = Early Bird; mostly B = Night Owl; mostly C = Shape Shifter.
Early Bird: You do best with early nights. Tips: protect your evening wind-down; get morning light.
Night Owl: Your body clock runs late. Tips: dim screens after 9pm; keep a consistent wake time.
Shape Shifter: Your sleep varies. Tips: anchor one fixed wake time; track your sleep for two weeks.
Each result ends with a "Book a sleep consult" button.`;
      await page.goto(`${APP}/admin/tools/import`);
      await page.locator('textarea').first().fill(source);
      await page.getByRole('button', { name: /Generate Draft Tool Config/ }).click();
      await page.getByRole('heading', { name: /Sleep Style Quiz/ }).waitFor({ timeout: 120_000 });
      const body = await page.locator('main').innerText();
      const hasErrors = body.includes('Fix before saving:');
      await page.screenshot({ path: path.join(OUT, 'A6-import-review.png'), fullPage: true });
      const qCount = (body.match(/^\d+\. /gm) ?? []).length;
      assert(/Early Bird/.test(body) && /Night Owl/.test(body) && /Shape Shifter/.test(body), 'outcomes not extracted');
      assert(/Missing from source|CTA link/i.test(body) || /no link/.test(body), 'missing CTA URL not flagged');
      return `questions listed=${qCount}, provenance=${/Scoring from source/.test(body) ? 'source' : 'INFERRED'}, blocking errors=${hasErrors ? 'YES' : 'none'}`;
    });

    await check('A7 Migration Assistant — real AI draft with option mappings (not saved)', async () => {
      await page.goto(`${APP}/admin/tools/${IDS.legacy}/settings`);
      await page.getByRole('button', { name: /Generate Draft Result Config/ }).click();
      await page.getByText('1. Answer → outcome mapping').waitFor({ timeout: 120_000 });
      const selects = page.locator('select[aria-label^="Category for"]');
      const n = await selects.count();
      const values = await selects.evaluateAll((els) => els.map((e) => e.value));
      const mapped = values.filter(Boolean).length;
      const errorsShown = await page.getByText('Must fix before saving:').count();
      await page.screenshot({ path: path.join(OUT, 'A7-migration-draft.png'), fullPage: true });
      assert(n === 12, `expected 12 option selects, got ${n}`);
      assert(mapped >= 9, `only ${mapped}/12 options mapped by the AI`);
      return `${mapped}/12 options mapped, validation errors shown=${errorsShown ? 'yes' : 'no'}`;
    });
    await admin.close();
    await stopApp(app);

    // ── Phase B: withdrawn model → real provider error handling ─────────────
    console.log('\n[B] Real Groq — withdrawn model llama-3.3-70b-versatile (error handling)');
    app = startApp({ GROQ_MODEL: 'llama-3.3-70b-versatile' }, 'next-real-ai-B.log');
    await waitForApp();
    await assertNotProduction();
    const { context: admin2 } = await login(browser, 'super@e2e.test');

    await check('B1 Import Wizard returns 503 with an actionable model message', async () => {
      const r = await api(admin2.request, '/api/admin/tools/import', 'POST', { text: 'Synthetic quiz. Q1 (A) yes (B) no. Mostly A = Type One, mostly B = Type Two. '.repeat(2) });
      assert(r.status === 503, `status ${r.status}`);
      assert(/not available to the configured Groq account/.test(r.json.error), r.json.error);
      return r.json.error;
    });
    await check('B2 Migration Assistant returns 503 with the same message', async () => {
      const r = await api(admin2.request, `/api/admin/tools/${IDS.legacy}/infer-result-config`, 'POST');
      assert(r.status === 503 && /not available/.test(r.json.error), `status ${r.status} ${r.json?.error}`);
    });
    await check('B3 hybrid admin preview reports the AI failure explicitly (outcome still shown, no fake text)', async () => {
      const r = await api(admin2.request, `/api/admin/tools/${IDS.bendy}/preview`, 'POST', { answers: bendyAnswers('B') });
      assert(r.status === 200, `status ${r.status}`);
      assert(r.json.generation_status === 'failed', 'not marked failed');
      assert(/not available/.test(r.json.generation_error), r.json.generation_error);
      assert(r.json.ai_result === null, 'AI text present on failure');
    });
    await check('B4 ai_generated admin preview returns 503 (no result shown)', async () => {
      const r = await api(admin2.request, `/api/admin/tools/${IDS.wsBTool}/preview`, 'POST', { answers: { 'Main concern?': 'x' } });
      assert(r.status === 503 && /AI generation failed/.test(r.json.error), `status ${r.status}`);
    });
    await check('B5 public hybrid submission still returns the scored outcome, no fake personalisation', async () => {
      const r = await api(admin2.request, '/api/generate', 'POST', { slug: 'bendy-menopause-type-quiz-e2e', email: 'synthetic.fail@e2e.test', answers: bendyAnswers('C') });
      assert(r.status === 200 && r.json.outcome?.title === 'Dysautonomia + Autonomic Regulation Pattern', `status ${r.status}`);
      assert(r.json.aiPersonalization === null, 'fake personalisation returned');
      const saved = state.db.submissions.find((s) => s.result_token === r.json.result_token);
      assert(saved.generation_status === 'failed' && /not available/.test(saved.generation_error), 'failure not recorded');
    });
    await check('B6 public ai_generated submission returns 503 with a friendly message', async () => {
      const r = await api(admin2.request, '/api/generate', 'POST', { slug: 'other-clinic-intake', email: 'synthetic.fail2@e2e.test', answers: { 'Main concern?': 'x' } });
      assert(r.status === 503, `status ${r.status}`);
      assert(!/llama|Groq|model/i.test(r.json.error), `internal detail leaked: ${r.json.error}`);
    });
    await admin2.close();
  } finally {
    if (app) await stopApp(app);
    await browser.close();
    server.close();
  }
  const failed = results.filter((r) => !r.ok).length;
  fs.writeFileSync(path.join(OUT, 'real-ai-results.json'), JSON.stringify(results, null, 2));
  console.log(`\n${results.length - failed}/${results.length} real-provider checks passed. Artifacts: ${OUT}`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
