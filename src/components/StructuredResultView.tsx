import type { StructuredResult } from '@/lib/groq';

export default function StructuredResultView({ result }: { result: StructuredResult }) {
  return (
    <div className="prose prose-sm prose-gray max-w-none">
      <h2>{result.result_title}</h2>
      <p>{result.short_summary}</p>

      <h3>Why This Result</h3>
      <p>{result.why_this_result}</p>

      {result.key_patterns_from_answers.length > 0 && (
        <>
          <h3>Key Patterns From Your Answers</h3>
          <ul>
            {result.key_patterns_from_answers.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </>
      )}

      {result.recommended_next_steps.length > 0 && (
        <>
          <h3>Recommended Next Steps</h3>
          <ol>
            {result.recommended_next_steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </>
      )}

      <hr />
      <p className="text-xs text-gray-400 italic">{result.disclaimer}</p>
      {result.cta && <p className="font-medium">{result.cta}</p>}
    </div>
  );
}
