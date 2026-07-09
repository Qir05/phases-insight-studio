export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export interface AnswerMap {
  [questionLabel: string]: string | string[];
}

export interface PromptQuestion {
  label: string;
  variable_name: string;
}

export interface PromptTool {
  title: string;
  description?: string | null;
}

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

function formatAnswerValue(value: string | string[] | undefined | null): string {
  if (value === undefined || value === null) return '[not answered]';
  if (Array.isArray(value)) return value.length > 0 ? value.join(', ') : '[not answered]';
  return value.trim() !== '' ? value : '[not answered]';
}

// Replaces {{variable_name}} placeholders in a prompt template with the matching
// answer, looked up via the question's variable_name → label mapping. Unknown
// or unanswered placeholders fall back to "[not answered]" rather than vanishing
// silently, so admins can immediately spot a typo'd variable name in the output.
export function substituteVariables(
  template: string,
  answers: AnswerMap,
  questions: PromptQuestion[]
): string {
  return template.replace(PLACEHOLDER_RE, (_match, varName: string) => {
    const question = questions.find((q) => q.variable_name === varName);
    if (!question) return '[not answered]';
    return formatAnswerValue(answers[question.label]);
  });
}

export function compilePrompt(
  tool: PromptTool,
  systemPrompt: string,
  answers: AnswerMap,
  questions: PromptQuestion[]
): string {
  const substitutedPrompt = substituteVariables(systemPrompt, answers, questions);

  const qaBlock = questions.length > 0
    ? questions
        .map((q) => {
          const varTag = q.variable_name ? ` [variable: ${q.variable_name}]` : '';
          return `Q: ${q.label}${varTag}\nA: ${formatAnswerValue(answers[q.label])}`;
        })
        .join('\n\n')
    : Object.entries(answers)
        .map(([label, value]) => `Q: ${label}\nA: ${formatAnswerValue(value)}`)
        .join('\n\n');

  const jsonSchema = JSON.stringify(
    {
      result_title: 'string',
      short_summary: 'string',
      why_this_result: 'string',
      key_patterns_from_answers: ['string'],
      recommended_next_steps: ['string'],
      disclaimer: 'string',
      cta: 'string',
    },
    null,
    2
  );

  const lines = [
    `Tool: ${tool.title}`,
    tool.description ? `Description: ${tool.description}` : null,
    '',
    substitutedPrompt,
    '',
    "Here is the full structured list of the client's answers — use these as your primary source of truth:",
    '',
    qaBlock,
    '',
    'Instructions:',
    '- Base your response specifically on the answers above. Reference at least 2 to 4 specific answers by question label in your explanation.',
    '- Do not invent facts that are not supported by the answers.',
    '- This result is educational only. It is not a medical diagnosis, treatment plan, or clinical advice. Recommend the user consult a qualified professional for personalized care.',
    '- Respond ONLY with a single valid JSON object matching this exact schema — no markdown formatting, no code fences, no extra commentary outside the JSON:',
    jsonSchema,
  ];

  return lines.filter((line) => line !== null).join('\n');
}

export function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(' ');
}
