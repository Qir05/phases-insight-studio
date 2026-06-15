import Link from 'next/link';
import Logo from '@/components/Logo';
import { ArrowRight, Brain, ClipboardList, Zap } from 'lucide-react';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="border-b border-gray-100">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <Logo size={40} />
          <Link
            href="/admin"
            className="text-sm text-gray-500 hover:text-indigo-600 transition-colors"
          >
            Admin →
          </Link>
        </div>
      </header>

      {/* Hero */}
      <main className="max-w-5xl mx-auto px-6 py-24 text-center">
        <span className="inline-block bg-indigo-50 text-indigo-700 text-xs font-semibold px-3 py-1 rounded-full uppercase tracking-wide mb-6">
          Educational Wellness Assessments
        </span>
        <h1 className="text-5xl font-bold text-gray-900 tracking-tight mb-6 leading-tight">
          Phases AI Assessment
        </h1>
        <p className="text-xl text-gray-500 max-w-2xl mx-auto mb-10">
          Personalised, AI-generated educational insights from clinically-informed questionnaires.
          Designed for wellness and education — not diagnosis.
        </p>
        <div className="flex items-center justify-center gap-4 flex-wrap">
          <Link
            href="/admin"
            className="inline-flex items-center gap-2 bg-indigo-600 text-white px-6 py-3 rounded-xl font-semibold hover:bg-indigo-700 transition-colors"
          >
            Go to Studio <ArrowRight size={17} />
          </Link>
        </div>
      </main>

      {/* Features */}
      <section className="max-w-5xl mx-auto px-6 pb-24 grid grid-cols-1 md:grid-cols-3 gap-8">
        {[
          {
            icon: ClipboardList,
            title: 'Custom Questionnaires',
            body: 'Build unlimited tools with various question types — radio, checkbox, scale, and more.',
          },
          {
            icon: Brain,
            title: 'Claude AI Analysis',
            body: 'Each submission is analysed by Claude, producing a thoughtful, educational response.',
          },
          {
            icon: Zap,
            title: 'GHL Integration',
            body: 'Automatically push results to GoHighLevel with custom tags and webhook payloads.',
          },
        ].map(({ icon: Icon, title, body }) => (
          <div key={title} className="bg-gray-50 rounded-2xl p-8 border border-gray-100">
            <div className="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center mb-4">
              <Icon size={20} className="text-indigo-600" />
            </div>
            <h3 className="font-semibold text-gray-900 mb-2">{title}</h3>
            <p className="text-sm text-gray-500">{body}</p>
          </div>
        ))}
      </section>

      <footer className="border-t border-gray-100 py-8 text-center text-xs text-gray-400">
        © {new Date().getFullYear()} Phases Clinic. This platform provides educational information only, not medical advice.
      </footer>
    </div>
  );
}
