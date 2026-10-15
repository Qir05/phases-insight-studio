'use client';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  FileText,
  Upload,
  Wand2,
  CheckCircle,
  AlertCircle,
  AlertTriangle,
  Loader2,
  ChevronRight,
  RotateCcw,
  PenSquare,
  Braces,
  Eye,
  Settings,
} from 'lucide-react';
import { normalizeImportConfig } from '@/lib/importConfig';
import { getOptionCategory, getOptionLabel } from '@/lib/scoring';
import TestOutcomeMapping from '@/components/TestOutcomeMapping';

// ── Types ─────────────────────────────────────────────────────────────────────

type WizardStep = 'input' | 'generating' | 'review' | 'saving' | 'done';
type InputMode  = 'paste' | 'file' | 'json';

const SOURCE_LABELS = [
  { value: 'FormWise quiz setup and instructions',        label: 'FormWise Setup / Instructions' },
  { value: 'quiz questions and results description',      label: 'Quiz Questions & Results' },
  { value: 'webinar or presentation transcript',          label: 'Webinar / Transcript' },
  { value: 'workshop or coaching session notes',          label: 'Workshop / Coaching Notes' },
  { value: 'health assessment content',                   label: 'Health Assessment Content' },
  { value: 'general quiz or survey content',              label: 'Other / General Content' },
];

// ── File text extraction (client-side, no dependencies) ───────────────────────

async function extractTextFromFile(file: File): Promise<string> {
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    return extractPdfText(file);
  }
  return file.text();
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array | null> {
  try {
    const stream = new Blob([bytes.slice()]).stream().pipeThrough(new DecompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

function textFromContentStream(content: string, parts: string[]) {
  const btEtRegex = /BT\s*([\s\S]*?)\s*ET/g;
  let block: RegExpExecArray | null;
  while ((block = btEtRegex.exec(content)) !== null) {
    const strRegex = /\(([^)\\]*(?:\\.[^)\\]*)*)\)/g;
    let str: RegExpExecArray | null;
    const line: string[] = [];
    while ((str = strRegex.exec(block[1])) !== null) {
      const decoded = str[1]
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '')
        .replace(/\\t/g, '\t')
        .replace(/\\\(/g, '(')
        .replace(/\\\)/g, ')')
        .replace(/\\\\/g, '\\');
      if (decoded.length > 0) line.push(decoded);
    }
    if (line.length > 0) parts.push(line.join(''));
  }
}

async function extractPdfText(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const raw   = new TextDecoder('latin1').decode(bytes);
  const parts: string[] = [];

  // Most PDFs compress their page content with FlateDecode — inflate each stream first.
  const streamRe = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = streamRe.exec(raw)) !== null) {
    const start = m.index + m[0].length;
    const end = raw.indexOf('endstream', start);
    if (end === -1) break;
    const dict = raw.slice(Math.max(0, m.index - 400), m.index);
    if (dict.includes('/FlateDecode')) {
      const inflated = await inflate(bytes.subarray(start, end));
      if (inflated) textFromContentStream(new TextDecoder('latin1').decode(inflated), parts);
    }
    streamRe.lastIndex = end;
  }

  // Uncompressed content streams
  textFromContentStream(raw, parts);

  const text = parts.join('\n').replace(/[ \t]{2,}/g, ' ').trim();
  return text.length > 50 ? text : '';
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ImportToolPage() {
  const router = useRouter();

  const [step,        setStep]        = useState<WizardStep>('input');
  const [inputMode,   setInputMode]   = useState<InputMode>('paste');
  const [sourceLabel, setSourceLabel] = useState(SOURCE_LABELS[0].value);
  const [pasteText,   setPasteText]   = useState('');
  const [fileName,    setFileName]    = useState('');
  const [jsonText,    setJsonText]    = useState('');
  const [draftJson,   setDraftJson]   = useState('');
  const [error,       setError]       = useState('');
  const [rawPreview,  setRawPreview]  = useState('');
  const [confirmed,   setConfirmed]   = useState(false);
  const [showJson,    setShowJson]    = useState(false);
  const [created,     setCreated]     = useState<{ id: string; slug: string; title: string; questions: number; draftSupported: boolean } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileTextRef  = useRef<string>('');

  function enterReview(config: unknown) {
    setDraftJson(JSON.stringify(config, null, 2));
    setConfirmed(false);
    setStep('review');
  }

  // ── File handling ───────────────────────────────────────────────────────────

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setError('');
    fileTextRef.current = '';

    const name = file.name.toLowerCase();
    const isJson = name.endsWith('.json') || file.type === 'application/json';
    const isAllowed = isJson
      || file.type === 'application/pdf'
      || file.type === 'text/plain'
      || ['.txt', '.md', '.csv', '.pdf'].some((ext) => name.endsWith(ext));

    if (!isAllowed) {
      setError('Unsupported file type. Please upload a .txt, .md, .csv, .pdf or .json file.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('File is too large (max 5 MB). Paste the relevant part instead.');
      return;
    }

    try {
      if (isJson) {
        // A JSON export is a finished config — no AI call, straight to review.
        const text = await file.text();
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          setError('This .json file is not valid JSON.');
          return;
        }
        enterReview(parsed);
        return;
      }
      const text = await extractTextFromFile(file);
      if (!text || text.length < 50) {
        setError('Could not extract enough text from this file (scanned or image-based PDFs have no text layer). Copy and paste the content instead.');
      } else {
        fileTextRef.current = text;
      }
    } catch {
      setError('Failed to read the file. Try pasting the content directly.');
    }
  }, []);

  // ── Generate draft ──────────────────────────────────────────────────────────

  async function generateDraft() {
    const text = inputMode === 'paste' ? pasteText : fileTextRef.current;

    if (!text?.trim()) {
      setError(inputMode === 'paste'
        ? 'Please paste your source content before generating.'
        : 'Please upload a file or paste text first.');
      return;
    }
    if (text.trim().length < 50) {
      setError('Content is too short. Paste more source material for best results.');
      return;
    }

    setError('');
    setRawPreview('');
    setStep('generating');

    try {
      const res = await fetch('/api/admin/tools/import', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text.trim(), source_label: sourceLabel }),
      });

      const json = await res.json().catch(() => ({})) as {
        config?:      unknown;
        error?:       string;
        raw_preview?: string;
      };

      if (!res.ok || !json.config) {
        setError(json.error ?? 'Generation failed. Please try again.');
        if (json.raw_preview) setRawPreview(json.raw_preview);
        setStep('input');
        return;
      }

      enterReview(json.config);
    } catch {
      setError('Network error. Please check your connection and try again.');
      setStep('input');
    }
  }

  // ── Load a raw JSON config directly (skips the AI call entirely) ─────────────

  function loadJsonDraft() {
    if (!jsonText.trim()) {
      setError('Paste a JSON config first.');
      return;
    }
    let config: unknown;
    try {
      config = JSON.parse(jsonText);
    } catch {
      setError('The pasted JSON is not valid. Fix any syntax errors and try again.');
      return;
    }
    setError('');
    enterReview(config);
  }

  // ── Live validation — same normaliser the server runs before saving ─────────

  const review = useMemo(() => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(draftJson);
    } catch {
      return { parseError: 'The JSON is not valid — fix syntax errors before saving.', config: null, errors: [] as string[], warnings: [] as string[], raw: null };
    }
    const { config, errors, warnings } = normalizeImportConfig(parsed);
    return { parseError: null, config, errors, warnings, raw: parsed as Record<string, unknown> };
  }, [draftJson]);

  const canSave = !review.parseError && review.errors.length === 0 && !!review.config && confirmed;

  // ── Create tool (single atomic request) ─────────────────────────────────────

  async function createTool() {
    if (!canSave || !review.raw) return;
    setError('');
    setStep('saving');

    const res = await fetch('/api/admin/tools/import/commit', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: review.raw, confirmed: true }),
    });
    const json = await res.json().catch(() => ({})) as {
      tool?: { id: string; slug: string; title: string };
      questions_created?: number;
      draft_supported?: boolean;
      error?: string;
      errors?: string[];
    };

    if (!res.ok || !json.tool) {
      setError(json.error ?? 'Failed to create the tool. Nothing was saved.');
      setStep('review');
      return;
    }

    setCreated({
      id: json.tool.id,
      slug: json.tool.slug,
      title: json.tool.title,
      questions: json.questions_created ?? 0,
      draftSupported: json.draft_supported !== false,
    });
    setStep('done');
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  const cfg = review.config;

  return (
    <div className="max-w-3xl">
      <Link
        href="/admin"
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-6 transition-colors"
      >
        <ArrowLeft size={15} /> Back to Dashboard
      </Link>

      <div className="flex items-center gap-3 mb-2">
        <div className="w-9 h-9 rounded-xl bg-indigo-100 flex items-center justify-center flex-shrink-0">
          <Wand2 size={18} className="text-indigo-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Import Quiz Wizard</h1>
          <p className="text-sm text-gray-500">Import → Review → Validate → Test → Save as draft. Nothing goes live until you publish.</p>
        </div>
      </div>

      <StepIndicator current={step} />

      {/* ── Step: input ── */}
      {(step === 'input' || step === 'generating') && (
        <div className="space-y-5 mt-6">
          <div className="bg-white rounded-2xl border border-gray-100 p-4 sm:p-6 space-y-5">
            <div>
              <h2 className="font-semibold text-gray-800 mb-1">Source Material</h2>
              <p className="text-xs text-gray-400">Paste source text, upload a file, or paste a finished JSON config.</p>
            </div>

            <div className="flex flex-wrap rounded-xl bg-gray-100 p-1 gap-1 w-full sm:w-auto sm:inline-flex">
              {([
                { mode: 'paste', icon: FileText, label: 'Paste Text' },
                { mode: 'file',  icon: Upload,   label: 'Upload File' },
                { mode: 'json',  icon: Braces,   label: 'Paste JSON Config' },
              ] as const).map(({ mode, icon: Icon, label }) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => { setInputMode(mode); setError(''); }}
                  className={`flex-1 sm:flex-none px-3 sm:px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    inputMode === mode ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <Icon size={14} className="inline-block mr-1.5 -mt-0.5" />
                  {label}
                </button>
              ))}
            </div>

            {inputMode !== 'json' && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  What type of content is this?
                </label>
                <select
                  value={sourceLabel}
                  onChange={(e) => setSourceLabel(e.target.value)}
                  className={input}
                >
                  {SOURCE_LABELS.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
                <p className="text-xs text-gray-400 mt-1">
                  The AI copies questions, results and CTAs from the source. Anything the source doesn&apos;t contain (e.g. scoring rules) is flagged for you instead of being invented.
                </p>
              </div>
            )}

            {inputMode === 'paste' && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Paste your source content *
                </label>
                <textarea
                  rows={14}
                  value={pasteText}
                  onChange={(e) => { setPasteText(e.target.value); setError(''); }}
                  className={`${input} resize-y font-mono text-xs leading-relaxed`}
                  placeholder={`Paste your FormWise quiz setup, quiz questions and answers, transcript, or any other source material here.\n\nFor a type quiz, include:\n- The quiz title and description\n- All questions with their answer options\n- How answers map to result types (e.g. "mostly A's = …")\n- Each result's description, recommendations and CTA link`}
                  disabled={step === 'generating'}
                />
                <p className="text-xs text-gray-400 mt-1">
                  {pasteText.length.toLocaleString()} characters
                  {pasteText.length > 40000 && (
                    <span className="text-amber-500 ml-2">⚠ Very long — consider trimming for best results</span>
                  )}
                </p>
              </div>
            )}

            {inputMode === 'file' && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Upload file (.txt, .md, .csv, .pdf, .json) *
                </label>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => fileInputRef.current?.click()}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click(); }}
                  className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
                    fileName ? 'border-indigo-300 bg-indigo-50' : 'border-gray-200 hover:border-indigo-300 hover:bg-indigo-50'
                  }`}
                >
                  <Upload size={22} className={`mx-auto mb-2 ${fileName ? 'text-indigo-500' : 'text-gray-300'}`} />
                  {fileName ? (
                    <div>
                      <p className="text-sm font-medium text-indigo-700 break-all">{fileName}</p>
                      <p className="text-xs text-indigo-500 mt-0.5">Click to change file</p>
                    </div>
                  ) : (
                    <div>
                      <p className="text-sm text-gray-500">Click to browse</p>
                      <p className="text-xs text-gray-400 mt-0.5">.txt, .md, .csv, .pdf, or a .json config export</p>
                    </div>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".txt,.md,.csv,.pdf,.json,text/plain,application/pdf,application/json"
                    onChange={handleFileChange}
                    className="hidden"
                    disabled={step === 'generating'}
                  />
                </div>
                <p className="text-xs text-gray-400 mt-1.5">
                  PDF text is extracted in your browser. Scanned PDFs have no text layer — paste the content instead. A .json file skips the AI and opens straight in review.
                </p>
              </div>
            )}

            {inputMode === 'json' && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Paste a complete quiz config JSON *
                </label>
                <textarea
                  rows={14}
                  value={jsonText}
                  onChange={(e) => { setJsonText(e.target.value); setError(''); }}
                  className={`${input} resize-y font-mono text-xs leading-relaxed`}
                  placeholder={'{\n  "title": "Menopause Type Quiz",\n  "slug": "menopause-type-quiz",\n  "result_strategy": "hybrid_ai_with_outcome",\n  "scoring_provenance": "source",\n  "scoring_config": { "type": "category", "categories": [] },\n  "result_config": { "outcomes": [] },\n  "questions": []\n}'}
                  spellCheck={false}
                />
                <p className="text-xs text-gray-400 mt-1">
                  No AI call is made — the config goes straight to review.
                </p>
              </div>
            )}
          </div>

          {error && (
            <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 flex items-start gap-2.5">
              <AlertCircle size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-sm text-red-700">{error}</p>
                {rawPreview && (
                  <details className="mt-2">
                    <summary className="text-xs text-red-500 cursor-pointer">Show AI response preview</summary>
                    <pre className="text-xs text-red-600 mt-1 whitespace-pre-wrap break-all">{rawPreview}</pre>
                  </details>
                )}
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={inputMode === 'json' ? loadJsonDraft : generateDraft}
            disabled={step === 'generating'}
            className="w-full bg-indigo-600 text-white py-3.5 rounded-xl font-semibold hover:bg-indigo-700 disabled:opacity-60 transition-colors flex items-center justify-center gap-2"
          >
            {step === 'generating' ? (
              <><Loader2 size={17} className="animate-spin" /> Analyzing content with AI…</>
            ) : inputMode === 'json' ? (
              <><Braces size={17} /> Load JSON Draft</>
            ) : (
              <><Wand2 size={17} /> Generate Draft Tool Config</>
            )}
          </button>

          {step === 'generating' && (
            <p className="text-center text-xs text-gray-400">
              This usually takes 5–20 seconds depending on content length.
            </p>
          )}
        </div>
      )}

      {/* ── Step: review ── */}
      {(step === 'review' || step === 'saving') && (
        <div className="space-y-5 mt-6">
          {/* Summary */}
          {cfg ? (
            <div className="bg-white rounded-2xl border border-gray-100 p-4 sm:p-6 space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-lg font-bold text-gray-900 break-words">{cfg.title}</h2>
                  <p className="text-xs text-gray-400 font-mono mt-0.5">/t/{cfg.slug}</p>
                  {cfg.description && <p className="text-sm text-gray-600 mt-1">{cfg.description}</p>}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 font-medium">
                    {cfg.result_strategy.replace(/_/g, ' ')}
                  </span>
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 font-medium">
                    {cfg.questions.length} question{cfg.questions.length === 1 ? '' : 's'}
                  </span>
                  {cfg.result_strategy !== 'ai_generated' && (
                    <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${
                      cfg.scoring_provenance === 'source' ? 'bg-green-50 text-green-700' : 'bg-amber-100 text-amber-800'
                    }`}>
                      Scoring {cfg.scoring_provenance === 'source' ? 'from source' : 'INFERRED'}
                    </span>
                  )}
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Questions</p>
                <ol className="space-y-3">
                  {cfg.questions.map((q, i) => (
                    <li key={i} className="text-sm">
                      <p className="font-medium text-gray-800 break-words">
                        {i + 1}. {q.label}
                        <span className="ml-2 text-[11px] font-normal text-gray-400">{q.field_type}{q.required ? '' : ' · optional'}</span>
                      </p>
                      {q.options && (
                        <ul className="mt-1 space-y-0.5 pl-4">
                          {q.options.map((o, oi) => {
                            const cat = getOptionCategory(o);
                            return (
                              <li key={oi} className="text-xs text-gray-600 flex flex-wrap gap-x-2">
                                <span className="break-words">{getOptionLabel(o)}</span>
                                {cfg.result_strategy !== 'ai_generated' && (
                                  <span className={`font-mono ${cat ? 'text-teal-600' : 'text-red-500'}`}>→ {cat ?? 'no category'}</span>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </li>
                  ))}
                </ol>
              </div>

              {cfg.result_config?.outcomes && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Outcomes</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {cfg.result_config.outcomes.map((o, i) => (
                      <div key={i} className="border border-gray-100 rounded-xl p-3 text-xs space-y-1">
                        <p className="text-sm font-semibold text-gray-900">{o.title || <span className="text-red-500">Missing title</span>}</p>
                        <p className="font-mono text-gray-400">{o.id}</p>
                        {o.description ? <p className="text-gray-600">{o.description}</p> : <p className="text-amber-600">No description</p>}
                        {o.recommendations && o.recommendations.length > 0 && (
                          <p className="text-gray-500">{o.recommendations.length} recommendation{o.recommendations.length === 1 ? '' : 's'}</p>
                        )}
                        <p className={o.cta_url ? 'text-gray-500' : 'text-amber-600'}>
                          CTA: {o.cta_text || '—'} {o.cta_url ? `→ ${o.cta_url}` : '(no link)'}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {cfg.result_strategy === 'ai_generated' && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">AI instructions</p>
                  <p className="text-xs text-gray-600 whitespace-pre-wrap">{cfg.result_template ?? cfg.system_prompt}</p>
                </div>
              )}
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-gray-100 p-6 text-sm text-gray-500">
              Fix the errors below to see the quiz summary.
            </div>
          )}

          {/* Validation */}
          {review.parseError && (
            <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 flex items-start gap-2.5">
              <AlertCircle size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-700">{review.parseError}</p>
            </div>
          )}
          {!review.parseError && review.errors.length > 0 && (
            <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 flex items-start gap-2.5">
              <AlertCircle size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-red-700 mb-1">Fix before saving:</p>
                <ul className="text-xs text-red-600 list-disc list-inside space-y-0.5">
                  {review.errors.map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              </div>
            </div>
          )}
          {!review.parseError && review.warnings.length > 0 && (
            <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 flex items-start gap-2.5">
              <AlertTriangle size={16} className="text-amber-500 flex-shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-amber-700 mb-1">Review carefully (won&apos;t block saving a draft):</p>
                <ul className="text-xs text-amber-700 list-disc list-inside space-y-0.5">
                  {review.warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              </div>
            </div>
          )}

          {/* Test before saving */}
          {cfg && cfg.result_strategy !== 'ai_generated' && cfg.scoring_config && cfg.result_config && (
            <TestOutcomeMapping
              questions={cfg.questions}
              scoringConfig={cfg.scoring_config}
              resultConfig={cfg.result_config}
              resultStrategy={cfg.result_strategy}
            />
          )}

          {/* Editable JSON */}
          <div className="bg-white rounded-2xl border border-gray-100 p-4 sm:p-6 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setShowJson((v) => !v)}
                className="text-left"
              >
                <h2 className="font-semibold text-gray-800 flex items-center gap-2">
                  <PenSquare size={15} className="text-gray-400" />
                  Edit Config JSON {showJson ? '▾' : '▸'}
                </h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  Fix titles, options, categories, outcomes, CTA links — the summary and checks above update as you type.
                </p>
              </button>
              <button
                type="button"
                onClick={() => { setStep('input'); setError(''); }}
                className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800 border border-gray-200 rounded-lg px-3 py-1.5 transition-colors flex-shrink-0"
              >
                <RotateCcw size={12} /> Start over
              </button>
            </div>

            {(showJson || !!review.parseError || review.errors.length > 0) && (
              <textarea
                rows={28}
                value={draftJson}
                onChange={(e) => { setDraftJson(e.target.value); setError(''); setConfirmed(false); }}
                aria-label="Config JSON"
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-xs font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y"
                spellCheck={false}
                disabled={step === 'saving'}
              />
            )}
          </div>

          {error && (
            <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 flex items-start gap-2.5">
              <AlertCircle size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          <label className="flex items-start gap-2.5 bg-white border border-gray-100 rounded-xl px-4 py-3 cursor-pointer">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              disabled={!!review.parseError || review.errors.length > 0}
              className="accent-indigo-600 mt-0.5"
            />
            <span className="text-sm text-gray-700">
              I have reviewed the questions, answer mappings, outcomes and CTAs above.
              <span className="block text-xs text-gray-400 mt-0.5">The tool is saved as a <strong>draft</strong> — it stays private until you publish it from Settings.</span>
            </span>
          </label>

          <button
            type="button"
            onClick={createTool}
            disabled={step === 'saving' || !canSave}
            className="w-full bg-indigo-600 text-white py-3.5 rounded-xl font-semibold hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
          >
            {step === 'saving' ? (
              <><Loader2 size={17} className="animate-spin" /> Saving tool and questions…</>
            ) : (
              <>Save as Draft <ChevronRight size={17} /></>
            )}
          </button>
        </div>
      )}

      {/* ── Step: done ── */}
      {step === 'done' && created && (
        <div className="mt-6 space-y-5">
          <div className="bg-green-50 border border-green-100 rounded-2xl px-6 py-8 text-center">
            <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
              <CheckCircle size={26} className="text-green-500" />
            </div>
            <h2 className="text-xl font-bold text-green-900 mb-1">Draft Saved</h2>
            <p className="text-sm text-green-700">
              <strong>{created.title}</strong> was created with {created.questions} question{created.questions !== 1 ? 's' : ''}.
            </p>
            {!created.draftSupported && (
              <p className="text-xs text-amber-700 mt-2">
                Note: draft mode needs migration 009 — until it runs, this tool is already public.
              </p>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 p-6 space-y-3">
            <p className="text-sm font-medium text-gray-700">Next: preview, then publish.</p>
            <div className="grid gap-2 sm:grid-cols-3">
              <a
                href={`/t/${created.slug}?preview=1`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-1.5 border border-gray-200 py-2.5 rounded-xl text-sm text-gray-700 hover:border-indigo-300 hover:text-indigo-600"
              >
                <Eye size={15} /> Preview quiz
              </a>
              <button
                onClick={() => router.push(`/admin/tools/${created.id}/questions`)}
                className="border border-gray-200 py-2.5 rounded-xl text-sm text-gray-700 hover:border-indigo-300 hover:text-indigo-600"
              >
                Edit questions
              </button>
              <button
                onClick={() => router.push(`/admin/tools/${created.id}/settings`)}
                className="inline-flex items-center justify-center gap-1.5 bg-indigo-600 text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-indigo-700"
              >
                <Settings size={15} /> Settings &amp; Publish
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Step indicator ─────────────────────────────────────────────────────────────

function StepIndicator({ current }: { current: WizardStep }) {
  const steps = [
    { key: 'input',  label: '1. Source' },
    { key: 'review', label: '2. Review & Test' },
    { key: 'done',   label: '3. Saved as Draft' },
  ];

  const idx = current === 'generating' || current === 'input' ? 0
    : current === 'review' || current === 'saving' ? 1
    : 2;

  return (
    <div className="flex items-center gap-0 mt-5 flex-wrap">
      {steps.map((s, i) => (
        <div key={s.key} className="flex items-center">
          <div className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1 rounded-full ${
            i === idx
              ? 'bg-indigo-100 text-indigo-700'
              : i < idx
              ? 'text-green-600'
              : 'text-gray-400'
          }`}>
            {i < idx && <CheckCircle size={12} />}
            {s.label}
          </div>
          {i < steps.length - 1 && (
            <ChevronRight size={14} className="text-gray-300 mx-1" />
          )}
        </div>
      ))}
    </div>
  );
}

const input =
  'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500';
