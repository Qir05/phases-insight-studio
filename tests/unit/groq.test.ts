import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('groq-sdk', () => ({
  default: class {
    chat = { completions: { create } };
  },
}));

import {
  GROQ_MODEL,
  generateResult,
  generateJson,
  describeAiError,
  GroqConfigError,
  GroqModelUnavailableError,
} from '@/lib/groq';

const validResult = {
  result_title: 't', short_summary: 's', why_this_result: 'w',
  key_patterns_from_answers: ['p'], recommended_next_steps: ['n'], disclaimer: 'd', cta: 'c',
};
const reply = (content: string, finish_reason = 'stop', model = 'openai/gpt-oss-120b') =>
  ({ model, choices: [{ message: { content }, finish_reason }] });

let savedKey: string | undefined;
beforeEach(() => { create.mockReset(); savedKey = process.env.GROQ_API_KEY; process.env.GROQ_API_KEY = 'test-key'; });
afterEach(() => { process.env.GROQ_API_KEY = savedKey; });

describe('Groq model configuration', () => {
  it('defaults to openai/gpt-oss-120b (llama-3.3-70b-versatile is withdrawn for this account)', () => {
    expect(GROQ_MODEL).toBe('openai/gpt-oss-120b');
  });

  it('sends JSON mode with reasoning-aware limits', async () => {
    create.mockResolvedValue(reply(JSON.stringify(validResult)));
    const out = await generateResult('prompt');
    const args = create.mock.calls[0][0];
    expect(args.model).toBe('openai/gpt-oss-120b');
    expect(args.response_format).toEqual({ type: 'json_object' });
    expect(args.reasoning_effort).toBe('low');
    expect(args.include_reasoning).toBe(false);
    expect(args.max_completion_tokens).toBeGreaterThanOrEqual(6000);
    expect(args).not.toHaveProperty('max_tokens');
    expect(out.parsed).toEqual(validResult);
    expect(out.model).toBe('openai/gpt-oss-120b');
  });
});

describe('never fake output', () => {
  it('missing API key throws (no mock result in any environment)', async () => {
    delete process.env.GROQ_API_KEY;
    await expect(generateResult('p')).rejects.toBeInstanceOf(GroqConfigError);
    await expect(generateJson('s', 'u', 100)).rejects.toBeInstanceOf(GroqConfigError);
    expect(create).not.toHaveBeenCalled();
  });

  it('truncated output is an error for results and null data for admin helpers', async () => {
    create.mockResolvedValue(reply('{"result_title": "cut', 'length'));
    await expect(generateResult('p')).rejects.toThrow(/truncated/);
    const j = await generateJson('s', 'u', 100);
    expect(j.data).toBeNull();
  });

  it('empty content throws', async () => {
    create.mockResolvedValue(reply(''));
    await expect(generateResult('p')).rejects.toThrow(/Empty response/);
  });
});

describe('provider error mapping', () => {
  it('404 model_not_found becomes GroqModelUnavailableError with an actionable message', async () => {
    create.mockRejectedValue(Object.assign(new Error('404'), { status: 404, error: { error: { code: 'model_not_found' } } }));
    const err = await generateJson('s', 'u', 100).catch((e) => e);
    expect(err).toBeInstanceOf(GroqModelUnavailableError);
    expect(err.message).toMatch(/not available to the configured Groq account/);
    expect(describeAiError(err)).toEqual({ message: err.message, status: 503 });
  });

  it('rate limits and other failures get clear statuses', () => {
    expect(describeAiError(Object.assign(new Error('x'), { status: 429 })).status).toBe(503);
    expect(describeAiError(new Error('boom'))).toEqual({ message: 'AI generation failed. Please try again.', status: 502 });
    expect(describeAiError(new GroqConfigError('GROQ_API_KEY is not configured on the server.')).status).toBe(503);
  });
});
