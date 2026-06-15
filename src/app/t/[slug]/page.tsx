'use client';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Question, Tool } from '@/lib/supabase';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

type AnswerMap = Record<string, string | string[]>;

export default function PublicQuizPage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();

  const [tool, setTool]           = useState<Tool | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading]     = useState(true);
  const [notFound, setNotFound]   = useState(false);

  const [step, setStep]         = useState(0);
  const [answers, setAnswers]   = useState<AnswerMap>({});
  const [contact, setContact]   = useState({ firstName: '', lastName: '', email: '', phone: '' });
  const [submitting, setSubmitting] = useState(false);
  // Synchronous guard — prevents double-submit before React re-renders the button
  const submittingRef = useRef(false);

  useEffect(() => {
    fetch(`/api/tools/${slug}`)
      .then((r) => {
        if (!r.ok) { setNotFound(true); setLoading(false); return null; }
        return r.json();
      })
      .then((json) => {
        if (!json) return;
        setTool(json.tool);
        setQuestions(json.questions);
        setLoading(false);
      });
  }, [slug]);

  // ── Stable callbacks — no new references between keystrokes ──────────────

  const setAnswer = useCallback((label: string, value: string | string[]) => {
    setAnswers((a) => ({ ...a, [label]: value }));
  }, []);

  const toggleCheckbox = useCallback((label: string, option: string) => {
    setAnswers((a) => {
      const current = (a[label] as string[] | undefined) ?? [];
      const next = current.includes(option)
        ? current.filter((v) => v !== option)
        : [...current, option];
      return { ...a, [label]: next };
    });
  }, []);

  const setFirstName = useCallback((v: string) => setContact((c) => ({ ...c, firstName: v })), []);
  const setLastName  = useCallback((v: string) => setContact((c) => ({ ...c, lastName: v })), []);
  const setEmail     = useCallback((v: string) => setContact((c) => ({ ...c, email: v })), []);
  const setPhone     = useCallback((v: string) => setContact((c) => ({ ...c, phone: v })), []);

  // Stable per-step callbacks — recreated only when step label changes
  const currentLabel     = questions[step]?.label ?? '';
  const questionOnChange = useCallback((v: string) => setAnswer(currentLabel, v),    [currentLabel, setAnswer]);
  const questionOnToggle = useCallback((o: string) => toggleCheckbox(currentLabel, o), [currentLabel, toggleCheckbox]);

  // ── Loading / not found ───────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 size={22} className="animate-spin text-indigo-500" />
      </div>
    );
  }

  if (notFound || !tool) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-400 text-sm">Assessment not found.</p>
      </div>
    );
  }

  // ── Derived state ─────────────────────────────────────────────────────────

  const totalSteps    = questions.length + 1;
  const isContactStep = step === questions.length;
  const progress      = Math.round((step / totalSteps) * 100);

  function canAdvance(): boolean {
    if (isContactStep) return !!contact.email.trim();
    const q = questions[step];
    if (!q.required) return true;
    const val = answers[q.label];
    if (!val) return false;
    if (Array.isArray(val)) return val.length > 0;
    return val.trim() !== '';
  }

  async function handleSubmit() {
    // Synchronous guard — checked before any state update or re-render
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);

    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug,
          answers,
          firstName: contact.firstName,
          lastName:  contact.lastName,
          email:     contact.email,
          phone:     contact.phone,
        }),
      });

      const json = await res.json();

      if (!res.ok) {
        // Show the most specific error available
        const msg = json.detail ?? json.error ?? 'Something went wrong. Please try again.';
        toast.error(msg);
        return; // never redirect on failure
      }

      // Only store and redirect after confirmed successful save to Supabase
      sessionStorage.setItem(`result_${slug}`, JSON.stringify({
        aiResult:     json.aiResult,
        resultToken:  json.resultToken,
        toolTitle:    tool?.title        ?? '',
        providerName: tool?.provider_name ?? null,
      }));
      router.push(`/t/${slug}/result`);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  const q            = !isContactStep ? questions[step] : null;
  const providerLabel = tool.provider_name ?? 'AI Assessment';

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Sticky header */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between">
          {tool.provider_logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={tool.provider_logo_url} alt={providerLabel} className="h-8 object-contain" />
          ) : (
            <span className="font-semibold text-indigo-600 text-base">{providerLabel}</span>
          )}
          <span className="text-xs text-gray-400 hidden sm:block">{tool.title}</span>
        </div>
      </header>

      {/* Full-width progress bar */}
      <div className="bg-gray-200 h-0.5 w-full">
        <div
          className="bg-indigo-600 h-0.5 transition-all duration-500 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>

      <main className="max-w-xl mx-auto px-4 sm:px-6 py-8">
        {/* Tool title (visible on every step) */}
        <div className="mb-4">
          <h1 className="text-xl font-bold text-gray-900">{tool.title}</h1>
          {tool.description && <p className="text-sm text-gray-500 mt-1">{tool.description}</p>}
        </div>

        {/* Form card */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100">
          <div className="p-6 sm:p-8">
            {/* Step indicator */}
            <div className="flex items-center justify-between mb-6">
              <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">
                Step {step + 1} of {totalSteps}
              </span>
              <span className="text-xs text-gray-400">{progress}%</span>
            </div>

            {/* ── Question step ── */}
            {!isContactStep && q && (
              <div className="space-y-5">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900 leading-snug">{q.label}</h2>
                  {!q.required && (
                    <span className="text-xs text-gray-400 mt-0.5 block">Optional</span>
                  )}
                </div>

                <QuestionInput
                  question={q}
                  value={answers[q.label]}
                  onChange={questionOnChange}
                  onToggle={questionOnToggle}
                />

                <div className="flex items-center gap-3 pt-1">
                  {step > 0 && (
                    <button
                      type="button"
                      onClick={() => setStep((s) => s - 1)}
                      className="inline-flex items-center gap-1.5 border border-gray-200 text-gray-600 px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-gray-50 transition-colors"
                    >
                      <ChevronLeft size={16} /> Back
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setStep((s) => s + 1)}
                    disabled={!canAdvance()}
                    className="inline-flex items-center gap-1.5 bg-indigo-600 text-white px-6 py-2.5 rounded-xl text-sm font-semibold hover:bg-indigo-700 disabled:opacity-40 transition-colors"
                  >
                    Continue <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            )}

            {/* ── Contact step ── */}
            {isContactStep && (
              <div className="space-y-4">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">Almost there!</h2>
                  <p className="text-sm text-gray-500 mt-1">
                    Enter your details to receive your personalised results.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Field label="First Name" value={contact.firstName} onChange={setFirstName} />
                  <Field label="Last Name"  value={contact.lastName}  onChange={setLastName} />
                </div>
                <Field label="Email *" type="email" value={contact.email} onChange={setEmail} />
                {tool.phone_capture_enabled && (
                  <Field label="Phone" type="tel" value={contact.phone} onChange={setPhone} />
                )}

                <div className="flex items-center gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => setStep((s) => s - 1)}
                    className="inline-flex items-center gap-1.5 border border-gray-200 text-gray-600 px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-gray-50 transition-colors"
                  >
                    <ChevronLeft size={16} /> Back
                  </button>
                  <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={!canAdvance() || submitting}
                    className="flex-1 inline-flex items-center justify-center gap-2 bg-indigo-600 text-white px-6 py-2.5 rounded-xl text-sm font-semibold hover:bg-indigo-700 disabled:opacity-40 transition-colors"
                  >
                    {submitting ? (
                      <><Loader2 size={15} className="animate-spin" /> Generating…</>
                    ) : (
                      'Generate My Results →'
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

// ── Sub-components (module-level — never redefined inside render) ─────────────

const QuestionInput = memo(function QuestionInput({
  question,
  value,
  onChange,
  onToggle,
}: {
  question: Question;
  value?: string | string[];
  onChange: (v: string) => void;
  onToggle: (option: string) => void;
}) {
  const opts = question.options as string[] | null;
  const ft   = question.field_type;
  const cls  = 'w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500';

  if (ft === 'text') {
    return (
      <input type="text" value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} className={cls} />
    );
  }
  if (ft === 'number') {
    return (
      <input type="number" value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} className={cls} />
    );
  }
  if (ft === 'textarea') {
    return (
      <textarea rows={4} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} className={`${cls} resize-y`} />
    );
  }
  if (ft === 'radio' && opts) {
    return (
      <div className="space-y-2">
        {opts.map((opt) => (
          <label
            key={opt}
            className={`flex items-center gap-3 border rounded-xl px-4 py-3 cursor-pointer transition-colors ${
              value === opt ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <input
              type="radio"
              name={question.id}
              value={opt}
              checked={value === opt}
              onChange={() => onChange(opt)}
              className="accent-indigo-600"
            />
            <span className="text-sm text-gray-800">{opt}</span>
          </label>
        ))}
      </div>
    );
  }
  if (ft === 'checkbox' && opts) {
    const selected = (value as string[]) ?? [];
    return (
      <div className="space-y-2">
        {opts.map((opt) => (
          <label
            key={opt}
            className={`flex items-center gap-3 border rounded-xl px-4 py-3 cursor-pointer transition-colors ${
              selected.includes(opt) ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <input
              type="checkbox"
              checked={selected.includes(opt)}
              onChange={() => onToggle(opt)}
              className="accent-indigo-600"
            />
            <span className="text-sm text-gray-800">{opt}</span>
          </label>
        ))}
      </div>
    );
  }
  if (ft === 'dropdown' && opts) {
    return (
      <select value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} className={cls}>
        <option value="">Select an option…</option>
        {opts.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
      </select>
    );
  }
  return null;
});

const Field = memo(function Field({
  label,
  value,
  onChange,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />
    </div>
  );
});
