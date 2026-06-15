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

export function compilePrompt(systemPrompt: string, answers: AnswerMap): string {
  const answerBlock = Object.entries(answers)
    .map(([label, value]) => {
      const val = Array.isArray(value) ? value.join(', ') : value;
      return `Q: ${label}\nA: ${val}`;
    })
    .join('\n\n');

  return `${systemPrompt}\n\nHere are the client's responses:\n\n${answerBlock}\n\nPlease provide a thoughtful, educational response based on these answers.`;
}

export function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(' ');
}
