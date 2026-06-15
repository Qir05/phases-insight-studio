'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, PlusCircle } from 'lucide-react';
import Logo from './Logo';

const nav = [
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/admin/tools/new', label: 'New Tool', icon: PlusCircle },
];

export default function AdminSidebar() {
  const path = usePathname();

  return (
    <aside className="w-60 min-h-screen bg-white border-r border-gray-100 flex flex-col">
      <div className="px-5 py-6 border-b border-gray-100">
        <Logo size={36} />
        <p className="text-xs text-gray-400 mt-1 ml-1">Insight Studio</p>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1">
        {nav.map(({ href, label, icon: Icon }) => {
          const active = path === href || (href !== '/admin' && path.startsWith(href));
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                active
                  ? 'bg-indigo-50 text-indigo-700'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`}
            >
              <Icon size={17} />
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="px-5 py-4 border-t border-gray-100 text-xs text-gray-400">
        Phases Insight Studio
      </div>
    </aside>
  );
}
