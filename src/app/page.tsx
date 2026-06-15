import Link from 'next/link';
import Logo from '@/components/Logo';
import { Lock, ClipboardList, Zap, BarChart2 } from 'lucide-react';

export default function HomePage() {
  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Header */}
      <header className="border-b border-gray-100">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <Logo size={38} />
          <Link
            href="/login"
            className="text-sm font-medium text-indigo-600 hover:text-indigo-700 transition-colors"
          >
            Sign in →
          </Link>
        </div>
      </header>

      {/* Hero */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-24 text-center">
        <div className="inline-flex items-center gap-2 bg-indigo-50 text-indigo-700 text-xs font-semibold px-3 py-1.5 rounded-full uppercase tracking-wide mb-8">
          <Lock size={11} />
          Invite-only platform
        </div>

        <h1 className="text-5xl font-bold text-gray-900 tracking-tight mb-5 leading-tight max-w-2xl">
          Phases Insight Studio
        </h1>

        <p className="text-lg text-gray-500 max-w-xl mx-auto mb-4">
          Log in to access your workspace.
        </p>
        <p className="text-sm text-gray-400 max-w-md mx-auto mb-10">
          This platform is invite-only. If you need access, contact your workspace administrator.
        </p>

        <Link
          href="/login"
          className="inline-flex items-center gap-2 bg-indigo-600 text-white px-8 py-3 rounded-xl font-semibold text-sm hover:bg-indigo-700 transition-colors"
        >
          Sign in to your workspace
        </Link>
      </main>

      {/* Features — internal context only, no public CTA */}
      <section className="max-w-4xl mx-auto px-6 pb-20 grid grid-cols-1 md:grid-cols-3 gap-6">
        {[
          {
            icon: ClipboardList,
            title: 'Custom Questionnaires',
            body: 'Build assessment tools with radio, checkbox, scale, and text question types.',
          },
          {
            icon: BarChart2,
            title: 'AI-Powered Analysis',
            body: 'Each submission is analysed by Groq AI, producing a thoughtful, educational response.',
          },
          {
            icon: Zap,
            title: 'GHL Integration',
            body: 'Push results to GoHighLevel automatically with custom tags and webhook payloads.',
          },
        ].map(({ icon: Icon, title, body }) => (
          <div key={title} className="bg-gray-50 rounded-2xl p-7 border border-gray-100">
            <div className="w-9 h-9 bg-indigo-100 rounded-xl flex items-center justify-center mb-4">
              <Icon size={18} className="text-indigo-600" />
            </div>
            <h3 className="font-semibold text-gray-900 mb-2 text-sm">{title}</h3>
            <p className="text-sm text-gray-500">{body}</p>
          </div>
        ))}
      </section>

      <footer className="border-t border-gray-100 py-6 text-center text-xs text-gray-400">
        © {new Date().getFullYear()} Phases Clinic. Educational information only — not medical advice.
      </footer>
    </div>
  );
}
