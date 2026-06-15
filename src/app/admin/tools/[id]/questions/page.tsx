'use client';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Question, Tool } from '@/lib/supabase';
import { toast } from 'sonner';
import { Plus, Trash2, GripVertical, ExternalLink, ArrowLeft, Users } from 'lucide-react';

const FIELD_TYPES = [
  { value: 'text',      label: 'Text input' },
  { value: 'textarea',  label: 'Long text' },
  { value: 'radio',     label: 'Single choice' },
  { value: 'checkbox',  label: 'Multiple choice' },
  { value: 'dropdown',  label: 'Dropdown' },
  { value: 'number',    label: 'Number' },
] as const;

type FieldTypeValue = typeof FIELD_TYPES[number]['value'];
const OPTIONS_TYPES: FieldTypeValue[] = ['radio', 'checkbox', 'dropdown'];

function toVarName(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, '_')
    .replace(/^_+|_+$/g, '');
}

interface NewQuestion {
  label: string;
  variable_name: string;
  varNameEdited: boolean;
  field_type: FieldTypeValue;
  options: string;
  required: boolean;
}

const EMPTY_NEW: NewQuestion = {
  label: '',
  variable_name: '',
  varNameEdited: false,
  field_type: 'radio',
  options: '',
  required: true,
};

export default function QuestionsPage() {
  const { id } = useParams<{ id: string }>();
  const [tool, setTool] = useState<Tool | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [addingNew, setAddingNew] = useState(false);
  const [newQ, setNewQ] = useState<NewQuestion>(EMPTY_NEW);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const [toolRes, qRes] = await Promise.all([
      fetch(`/api/admin/tools/${id}`),
      fetch(`/api/admin/tools/${id}/questions`),
    ]);
    const toolJson = await toolRes.json();
    const qJson = await qRes.json();
    setTool(toolJson.tool);
    setQuestions(qJson.questions ?? []);
    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const handleLabelChange = useCallback((label: string) => {
    setNewQ((q) => ({
      ...q,
      label,
      variable_name: q.varNameEdited ? q.variable_name : toVarName(label),
    }));
  }, []);

  const handleVarNameChange = useCallback((variable_name: string) => {
    setNewQ((q) => ({ ...q, variable_name, varNameEdited: true }));
  }, []);

  async function addQuestion() {
    if (!newQ.label.trim()) { toast.error('Question label is required'); return; }
    if (!newQ.variable_name.trim()) { toast.error('Variable name is required'); return; }
    setSaving(true);

    const needsOptions = OPTIONS_TYPES.includes(newQ.field_type as typeof OPTIONS_TYPES[number]);
    const parsedOptions = needsOptions
      ? newQ.options.split('\n').map((s) => s.trim()).filter(Boolean)
      : [];
    const options = parsedOptions.length > 0 ? parsedOptions : null;

    const res = await fetch(`/api/admin/tools/${id}/questions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        label: newQ.label,
        variable_name: newQ.variable_name,
        field_type: newQ.field_type,
        options,
        required: newQ.required,
      }),
    });
    const json = await res.json().catch(() => ({})) as { error?: string };
    setSaving(false);
    if (!res.ok) {
      toast.error(json.error ?? 'Failed to add question');
      return;
    }
    toast.success('Question added');
    setNewQ(EMPTY_NEW);
    setAddingNew(false);
    load();
  }

  async function deleteQuestion(qid: string) {
    if (!confirm('Delete this question?')) return;
    const res = await fetch(`/api/admin/tools/${id}/questions/${qid}`, { method: 'DELETE' });
    if (res.ok) { toast.success('Deleted'); load(); }
    else toast.error('Failed to delete');
  }

  async function moveQuestion(index: number, dir: -1 | 1) {
    const updated = [...questions];
    const target = index + dir;
    if (target < 0 || target >= updated.length) return;
    [updated[index], updated[target]] = [updated[target], updated[index]];
    const reordered = updated.map((q, i) => ({ ...q, order_index: i }));
    setQuestions(reordered);
    await fetch(`/api/admin/tools/${id}/questions`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ questions: reordered.map((q) => ({ id: q.id, order_index: q.order_index })) }),
    });
  }

  const needsOptions = OPTIONS_TYPES.includes(newQ.field_type as typeof OPTIONS_TYPES[number]);

  return (
    <div className="max-w-2xl">
      {/* Back nav */}
      <Link
        href="/admin"
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-6 transition-colors"
      >
        <ArrowLeft size={15} /> Back to Dashboard
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {loading ? 'Loading…' : tool?.title}
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">Question Builder</p>
        </div>
        <div className="flex items-center gap-2">
          {tool && (
            <>
              <Link
                href={`/admin/tools/${id}/submissions`}
                className="inline-flex items-center gap-1 text-xs border border-gray-200 rounded-lg px-3 py-1.5 text-gray-500 hover:text-indigo-600 transition-colors"
              >
                <Users size={13} /> Submissions
              </Link>
              <Link
                href={`/t/${tool.slug}`}
                target="_blank"
                className="inline-flex items-center gap-1 text-xs border border-gray-200 rounded-lg px-3 py-1.5 text-gray-500 hover:text-indigo-600 transition-colors"
              >
                <ExternalLink size={13} /> Preview
              </Link>
            </>
          )}
        </div>
      </div>

      {/* Existing questions */}
      {questions.length === 0 && !loading && (
        <div className="bg-white rounded-xl border border-gray-100 p-8 text-center mb-4">
          <p className="text-sm text-gray-400">No questions yet. Add your first one below.</p>
        </div>
      )}

      <div className="space-y-3 mb-4">
        {questions.map((q, i) => (
          <div key={q.id} className="bg-white rounded-xl border border-gray-100 p-4 flex items-start gap-3">
            <div className="flex flex-col gap-1 mt-0.5">
              <button
                onClick={() => moveQuestion(i, -1)}
                disabled={i === 0}
                className="text-gray-300 hover:text-gray-500 disabled:opacity-20 text-xs leading-none"
              >▲</button>
              <GripVertical size={14} className="text-gray-200" />
              <button
                onClick={() => moveQuestion(i, 1)}
                disabled={i === questions.length - 1}
                className="text-gray-300 hover:text-gray-500 disabled:opacity-20 text-xs leading-none"
              >▼</button>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-800">{q.label}</p>
              <p className="text-xs text-gray-400 mt-0.5">
                {q.variable_name && (
                  <span className="font-mono text-indigo-500">{`{{${q.variable_name}}}`}</span>
                )}
                {q.variable_name && ' · '}
                {FIELD_TYPES.find((t) => t.value === q.field_type)?.label}
                {q.options && ` · ${(q.options as string[]).join(', ')}`}
                {q.required && ' · Required'}
              </p>
            </div>
            <button
              onClick={() => deleteQuestion(q.id)}
              className="text-red-300 hover:text-red-500 transition-colors mt-0.5"
            >
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </div>

      {/* Add new question */}
      {!addingNew ? (
        <button
          onClick={() => setAddingNew(true)}
          className="w-full border-2 border-dashed border-gray-200 rounded-xl py-3 text-sm text-gray-400 hover:border-indigo-300 hover:text-indigo-500 transition-colors flex items-center justify-center gap-2"
        >
          <Plus size={16} /> Add Question
        </button>
      ) : (
        <div className="bg-white rounded-xl border border-indigo-200 p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Question *</label>
            <input
              autoFocus
              value={newQ.label}
              onChange={(e) => handleLabelChange(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="e.g. What is your name?"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Variable name *</label>
            <input
              value={newQ.variable_name}
              onChange={(e) => handleVarNameChange(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="e.g. name"
            />
            <p className="text-xs text-gray-400 mt-1">
              Must match the <span className="font-mono text-indigo-500">{'{{variable}}'}</span> in your prompt template.
            </p>
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-600 mb-1">Field type</label>
              <select
                value={newQ.field_type}
                onChange={(e) => setNewQ((q) => ({ ...q, field_type: e.target.value as FieldTypeValue }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {FIELD_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div className="flex items-end pb-0.5">
              <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={newQ.required}
                  onChange={(e) => setNewQ((q) => ({ ...q, required: e.target.checked }))}
                  className="accent-indigo-600"
                />
                Required
              </label>
            </div>
          </div>

          {needsOptions && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Options (one per line)</label>
              <textarea
                rows={4}
                value={newQ.options}
                onChange={(e) => setNewQ((q) => ({ ...q, options: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y"
                placeholder={"Option A\nOption B\nOption C"}
              />
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={addQuestion}
              disabled={saving}
              className="flex-1 bg-indigo-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-60 transition-colors"
            >
              {saving ? 'Saving…' : 'Save Question'}
            </button>
            <button
              onClick={() => { setAddingNew(false); setNewQ(EMPTY_NEW); }}
              className="px-4 py-2 text-sm text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {questions.length > 0 && (
        <div className="mt-6 flex justify-end">
          <Link
            href={`/admin/tools/${id}/submissions`}
            className="text-sm text-indigo-600 hover:underline"
          >
            View Submissions →
          </Link>
        </div>
      )}
    </div>
  );
}
