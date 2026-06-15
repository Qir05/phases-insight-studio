import Groq from 'groq-sdk';

const SYSTEM_PROMPT =
  'You are an expert advisor. Analyze the provided information and give a detailed, structured, actionable response. Format your response with clear sections using markdown. Be specific, personalized, and helpful. Do not provide diagnosis or medical treatment.';

const MOCK_RESULT = `## Your Personalised Insight

Thank you for completing this assessment. Here is a summary based on your responses.

### Key Observations
- Your answers indicate areas of strength and potential growth.
- Consider reviewing the following recommendations carefully.

### Recommendations
1. **Reflect** on the patterns highlighted by your responses.
2. **Take action** on one small, specific step within the next 7 days.
3. **Consult a qualified professional** for personalised, clinical guidance.

### Next Steps
Reach out to the Phases Clinic team to discuss your results and explore next steps tailored to your situation.

---
*Note: This is a sample result generated in development mode (GROQ_API_KEY not set).*`;

export async function generateResult(userPrompt: string): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) {
    console.warn('[groq] GROQ_API_KEY is not set — returning mock result');
    return MOCK_RESULT;
  }

  const client = new Groq({ apiKey });

  const completion = await client.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    max_tokens: 1500,
  });

  const text = completion.choices[0]?.message?.content;
  if (!text) throw new Error('Empty response from Groq');
  return text;
}
