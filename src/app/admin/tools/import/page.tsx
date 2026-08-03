'use client';
import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  FileText,
  Upload,
  Wand2,
  CheckCircle,
  AlertCircle,
  Loader2,
  ChevronRight,
  RotateCcw,
  PenSquare,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

type WizardStep = 'input' | 'generating' | 'review' | 'saving' | 'done';
type InputMode  = 'paste' | 'file';

interface ImportedQuestion {
  label:         string;
  variable_name: string;
  field_type:    string;
  options?:      unknown[] | null;
  required?:     boolean;
  scoring_key?:  string | null;
  category?:     string | null;
}

interface DraftConfig {
  title:           string;
  description?:    string;
  result_strategy: string;
  system_prompt?:  string | null;
  result_template?: string | null;
  scoring_config?: unknown;
  result_config?:  unknown;
  questions:       ImportedQuestion[];
  [key: string]: unknown;
}

const SOURCE_LABELS = [
  { value: 'FormWise quiz setup and instructions',        label: 'FormWise Setup / Instructions' },
  { value: 'quiz questions and results description',      label: 'Quiz Questions & Results' },
  { value: 'webinar or presentation transcript',          label: 'Webinar / Transcript' },
  { value: 'workshop or coaching session notes',          label: 'Workshop / Coaching Notes' },
  { value: 'health assessment content',                   label: 'Health Assessment Content' },
  { value: 'general quiz or survey content',              label: 'Other / General Content' },
];

// ── PDF text extraction (client-side, no dependencies) ────────────────────────

async function extractTextFromFile(file: File): Promise<string> {
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    return extractPdfText(file);
  }
  return file.text();
}

async function extractPdfText(file: File): Promise<string> {
  const buffer  = await file.arrayBuffer();
  const bytes   = new Uint8Array(buffer);
  const decoder = new TextDecoder('latin1');
  const raw     = decoder.decode(bytes);

  const parts: string[] = [];

  // Extract text from PDF BT...ET content streams (plain text PDFs)
  const btEtRegex = /BT\s*([\s\S]*?)\s*ET/g;
  let block: RegExpExecArray | null;
  while ((block = btEtRegex.exec(raw)) !== null) {
    const content   = block[1];
    const strRegex  = /\(([^)\\]*(?:\\.[^)\\]*)*)\)/g;
    let str: RegExpExecArray | null;
    while ((str = strRegex.exec(content)) !== null) {
      const decoded = str[1]
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '')
        .replace(/\\t/g, '\t')
        .replace(/\\\(/g, '(')
        .replace(/\\\)/g, ')')
        .replace(/\\\\/g, '\\');
      if (decoded.trim().length > 0) parts.push(decoded.trim());
    }
  }

  if (parts.length > 0) {
    return parts.join(' ').replace(/\s{2,}/g, ' ').trim();
  }

  // Fallback: extract visible ASCII characters (works for some PDFs)
  const fallback = Array.from(bytes)
    .map((b) => (b >= 32 && b < 127) || b === 10 || b === 13 ? String.fromCharCode(b) : ' ')
    .join('')
    .replace(/\s{3,}/g, ' ')
    .trim();

  return fallback.length > 100 ? fallback : '';
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ImportToolPage() {
  const router = useRouter();

  const [step,        setStep]        = useState<WizardStep>('input');
  const [inputMode,   setInputMode]   = useState<InputMode>('paste');
  const [sourceLabel, setSourceLabel] = useState(SOURCE_LABELS[0].value);
  const [pasteText,   setPasteText]   = useState('');
  const [fileName,    setFileName]    = useState('');
  const [draftJson,   setDraftJson]   = useState('');
  const [draftTitle,  setDraftTitle]  = useState('');
  const [draftQCount, setDraftQCount] = useState(0);
  const [error,       setError]       = useState('');
  const [rawPreview,  setRawPreview]  = useState('');
  const [createdId,   setCreatedId]   = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileTextRef  = useRef<string>('');

  // ── File handling ───────────────────────────────────────────────────────────

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setError('');

    const isAllowed = file.type === 'application/pdf'
      || file.type === 'text/plain'
      || file.name.endsWith('.txt')
      || file.name.endsWith('.md')
      || file.name.endsWith('.csv')
      || file.name.endsWith('.pdf');

    if (!isAllowed) {
      setError('Unsupported file type. Please upload a .txt, .md, .csv, or .pdf file.');
      return;
    }

    try {
      const text = await extractTextFromFile(file);
      if (!text || text.length < 50) {
        setError('Could not extract enough text from this file. Try copying and pasting the content directly.');
        fileTextRef.current = '';
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

      const json = await res.json() as {
        config?:      DraftConfig;
        error?:       string;
        raw_preview?: string;
      };

      if (!res.ok) {
        setError(json.error ?? 'Generation failed. Please try again.');
        if (json.raw_preview) setRawPreview(json.raw_preview);
        setStep('input');
        return;
      }

      const config = json.config!;
      setDraftJson(JSON.stringify(config, null, 2));
      setDraftTitle(config.title ?? 'Untitled Quiz');
      setDraftQCount(Array.isArray(config.questions) ? config.questions.length : 0);
      setStep('review');
    } catch {
      setError('Network error. Please check your connection and try again.');
      setStep('input');
    }
  }

  // ── Create tool ─────────────────────────────────────────────────────────────

  async function createTool() {
    let config: DraftConfig;
    try {
      config = JSON.parse(draftJson) as DraftConfig;
    } catch {
      setError('The JSON is not valid. Fix any syntax errors before saving.');
      return;
    }

    if (!config.title?.trim()) {
      setError('The config is missing a title.');
      return;
    }

    setError('');
    setStep('saving');

    // 1. Create the tool
    const toolRes = await fetch('/api/admin/tools', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title:           config.title,
        description:     config.description     ?? null,
        system_prompt:   config.system_prompt   ?? null,
        result_strategy: config.result_strategy ?? 'ai_generated',
        result_template: config.result_template ?? null,
        scoring_config:  config.scoring_config  ?? null,
        result_config:   config.result_config   ?? null,
        tool_mode:       'ai_result',
        email_capture_enabled: true,
        phone_capture_enabled: false,
        ghl_enabled:     false,
      }),
    });

    const toolJson = await toolRes.json() as { tool?: { id: string }; error?: string };

    if (!toolRes.ok || !toolJson.tool) {
      setError(toolJson.error ?? 'Failed to create tool. Check the config and try again.');
      setStep('review');
      return;
    }

    const toolId = toolJson.tool.id;

    // 2. Create questions in order
    const questions = Array.isArray(config.questions) ? config.questions : [];
    for (const q of questions) {
      await fetch(`/api/admin/tools/${toolId}/questions`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label:         q.label,
          variable_name: q.variable_name,
          field_type:    q.field_type || 'radio',
          options:       q.options    ?? null,
          required:      q.required   ?? true,
          scoring_key:   q.scoring_key ?? null,
          category:      q.category   ?? null,
        }),
      });
    }

    setCreatedId(toolId);
    setStep('done');
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-3xl">
      {/* Back */}
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
          <p className="text-sm text-gray-500">Paste or upload source material — AI generates the full quiz config.</p>
        </div>
      </div>

      {/* Step indicator */}
      <StepIndicator current={step} />

      {/* ── Step: input ── */}
      {(step === 'input' || step === 'generating') && (
        <div className="space-y-5 mt-6">
          {/* Input mode toggle */}
          <div className="bg-white rounded-2xl border border-gray-100 p-6 space-y-5">
            <div>
              <h2 className="font-semibold text-gray-800 mb-1">Source Material</h2>
              <p className="text-xs text-gray-400">Paste any source text or upload a file. The AI will read it and generate a draft quiz config.</p>
            </div>

            {/* Paste / Upload toggle */}
            <div className="inline-flex rounded-xl bg-gray-100 p-1">
              <button
                type="button"
                onClick={() => { setInputMode('paste'); setError(''); }}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  inputMode === 'paste' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <FileText size={14} className="inline-block mr-1.5 -mt-0.5" />
                Paste Text
              </button>
              <button
                type="button"
                onClick={() => { setInputMode('file'); setError(''); }}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  inputMode === 'file' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <Upload size={14} className="inline-block mr-1.5 -mt-0.5" />
                Upload File
              </button>
            </div>

            {/* Source label */}
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
                Helps the AI understand context and generate a better quiz structure.
              </p>
            </div>

            {/* Paste textarea */}
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
                  placeholder={`Paste your FormWise quiz setup, quiz questions and answers, transcript, or any other source material here.\n\nFor the Bendy Menopause Type Quiz, paste:\n- The quiz title and description\n- All questions with their answer options\n- The result types (e.g. Hormone Support Type, Liver Support Type)\n- Descriptions and recommendations for each type`}
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

            {/* File upload */}
            {inputMode === 'file' && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Upload file (.txt, .md, .csv, .pdf) *
                </label>
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
                    fileName ? 'border-indigo-300 bg-indigo-50' : 'border-gray-200 hover:border-indigo-300 hover:bg-indigo-50'
                  }`}
                >
                  <Upload size={22} className={`mx-auto mb-2 ${fileName ? 'text-indigo-500' : 'text-gray-300'}`} />
                  {fileName ? (
                    <div>
                      <p className="text-sm font-medium text-indigo-700">{fileName}</p>
                      <p className="text-xs text-indigo-500 mt-0.5">Click to change file</p>
                    </div>
                  ) : (
                    <div>
                      <p className="text-sm text-gray-500">Click to browse, or drag and drop</p>
                      <p className="text-xs text-gray-400 mt-0.5">.txt, .md, .csv, .pdf supported</p>
                    </div>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".txt,.md,.csv,.pdf,text/plain,application/pdf"
                    onChange={handleFileChange}
                    className="hidden"
                    disabled={step === 'generating'}
                  />
                </div>
                <p className="text-xs text-gray-400 mt-1.5">
                  For PDF: text is extracted automatically. If extraction is poor, copy-paste the content directly instead.
                </p>
              </div>
            )}
          </div>

          {/* Error display */}
          {error && (
            <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 flex items-start gap-2.5">
              <AlertCircle size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
              <div>
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

          {/* Generate button */}
          <button
            type="button"
            onClick={generateDraft}
            disabled={step === 'generating'}
            className="w-full bg-indigo-600 text-white py-3.5 rounded-xl font-semibold hover:bg-indigo-700 disabled:opacity-60 transition-colors flex items-center justify-center gap-2"
          >
            {step === 'generating' ? (
              <>
                <Loader2 size={17} className="animate-spin" />
                Analyzing content with AI…
              </>
            ) : (
              <>
                <Wand2 size={17} />
                Generate Draft Tool Config
              </>
            )}
          </button>

          {step === 'generating' && (
            <p className="text-center text-xs text-gray-400">
              This usually takes 5–15 seconds depending on content length.
            </p>
          )}
        </div>
      )}

      {/* ── Step: review ── */}
      {(step === 'review' || step === 'saving') && (
        <div className="space-y-5 mt-6">
          {/* Draft summary */}
          <div className="bg-green-50 border border-green-100 rounded-2xl px-5 py-4 flex items-start gap-3">
            <CheckCircle size={18} className="text-green-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-green-800">Draft generated!</p>
              <p className="text-xs text-green-600 mt-0.5">
                <strong>{draftTitle}</strong> · {draftQCount} question{draftQCount !== 1 ? 's' : ''} · Review and edit the JSON below before saving.
              </p>
            </div>
          </div>

          {/* Editable JSON */}
          <div className="bg-white rounded-2xl border border-gray-100 p-6 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-gray-800 flex items-center gap-2">
                  <PenSquare size={15} className="text-gray-400" />
                  Draft Config JSON
                </h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  Review carefully. Edit any field — titles, descriptions, options, categories, CTAs.
                </p>
              </div>
              <button
                type="button"
                onClick={() => { setStep('input'); setError(''); }}
                className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800 border border-gray-200 rounded-lg px-3 py-1.5 transition-colors"
              >
                <RotateCcw size={12} /> Re-generate
              </button>
            </div>

            <textarea
              rows={30}
              value={draftJson}
              onChange={(e) => { setDraftJson(e.target.value); setError(''); }}
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-xs font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y"
              spellCheck={false}
              disabled={step === 'saving'}
            />

            <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
              <p className="text-xs text-amber-700">
                <strong>Before saving:</strong> Check that all <code>category</code> values on options exactly match the outcome <code>id</code> values in <code>result_config.outcomes</code>. Also fill in any <code>cta_url</code> fields.
              </p>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 flex items-start gap-2.5">
              <AlertCircle size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          {/* Create button */}
          <button
            type="button"
            onClick={createTool}
            disabled={step === 'saving'}
            className="w-full bg-indigo-600 text-white py-3.5 rounded-xl font-semibold hover:bg-indigo-700 disabled:opacity-60 transition-colors flex items-center justify-center gap-2"
          >
            {step === 'saving' ? (
              <>
                <Loader2 size={17} className="animate-spin" />
                Creating tool and questions…
              </>
            ) : (
              <>
                Create Tool & Questions <ChevronRight size={17} />
              </>
            )}
          </button>
        </div>
      )}

      {/* ── Step: done ── */}
      {step === 'done' && (
        <div className="mt-6 space-y-5">
          <div className="bg-green-50 border border-green-100 rounded-2xl px-6 py-8 text-center">
            <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
              <CheckCircle size={26} className="text-green-500" />
            </div>
            <h2 className="text-xl font-bold text-green-900 mb-1">Tool Created!</h2>
            <p className="text-sm text-green-700">
              <strong>{draftTitle}</strong> has been created with {draftQCount} question{draftQCount !== 1 ? 's' : ''}.
            </p>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 p-6 space-y-3">
            <p className="text-sm font-medium text-gray-700">Next steps:</p>
            <ul className="text-sm text-gray-600 space-y-2">
              <li className="flex items-start gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-indigo-400 mt-1.5 flex-shrink-0" />
                Review and reorder questions in the Question Builder
              </li>
              <li className="flex items-start gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-indigo-400 mt-1.5 flex-shrink-0" />
                Fill in any <code className="text-xs bg-gray-100 px-1 rounded">cta_url</code> values in the tool settings
              </li>
              <li className="flex items-start gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-indigo-400 mt-1.5 flex-shrink-0" />
                Preview the quiz with the public link before sharing
              </li>
            </ul>
            <div className="pt-2 flex gap-3">
              <button
                onClick={() => router.push(`/admin/tools/${createdId}/questions`)}
                className="flex-1 bg-indigo-600 text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-indigo-700 transition-colors"
              >
                Open Question Builder →
              </button>
              <button
                onClick={() => router.push('/admin')}
                className="px-4 py-2.5 text-sm text-gray-500 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors"
              >
                Dashboard
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
    { key: 'input',      label: '1. Source'  },
    { key: 'review',     label: '2. Review'  },
    { key: 'done',       label: '3. Done'    },
  ];

  const idx = current === 'generating' ? 0
    : current === 'input'    ? 0
    : current === 'review'   ? 1
    : current === 'saving'   ? 1
    : 2;

  return (
    <div className="flex items-center gap-0 mt-5">
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
