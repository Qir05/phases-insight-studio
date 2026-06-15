'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LayoutDashboard, PlusCircle, Building2, Users, LogOut } from 'lucide-react';
import { createBrowserClient } from '@supabase/ssr';
import Logo from './Logo';
import type { Profile } from '@/lib/supabase';

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function AdminSidebar() {
  const path    = usePathname();
  const router  = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { profile?: Profile } | null) => {
        if (data?.profile) setProfile(data.profile);
      });
  }, []);

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }, [router]);

  const isSuperAdmin = profile?.role === 'super_admin';

  const nav = [
    { href: '/admin',            label: 'Dashboard',  icon: LayoutDashboard, exact: true  },
    { href: '/admin/tools/new',  label: 'New Tool',   icon: PlusCircle,      exact: false },
    ...(isSuperAdmin
      ? [
          { href: '/admin/workspaces', label: 'Workspaces', icon: Building2, exact: false },
          { href: '/admin/users',      label: 'Users',       icon: Users,     exact: false },
        ]
      : []
    ),
  ];

  return (
    <aside className="w-60 min-h-screen bg-white border-r border-gray-100 flex flex-col">
      {/* Logo */}
      <div className="px-5 py-6 border-b border-gray-100">
        <Logo size={36} />
        <p className="text-xs text-gray-400 mt-1 ml-1">Insight Studio</p>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {nav.map(({ href, label, icon: Icon, exact }) => {
          const active = exact
            ? path === href
            : path === href || path.startsWith(href);
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

      {/* User info + logout */}
      <div className="px-4 py-4 border-t border-gray-100">
        {profile ? (
          <div className="space-y-2">
            <div className="px-1">
              <p className="text-sm font-medium text-gray-800 truncate">
                {profile.full_name || profile.email}
              </p>
              <span className={`inline-block text-xs px-2 py-0.5 rounded-full mt-0.5 font-medium ${
                isSuperAdmin
                  ? 'bg-indigo-100 text-indigo-700'
                  : 'bg-gray-100 text-gray-500'
              }`}>
                {isSuperAdmin ? 'Super Admin' : 'Provider Admin'}
              </span>
            </div>
            <button
              onClick={logout}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-500 hover:text-red-600 hover:bg-red-50 transition-colors"
            >
              <LogOut size={15} />
              Sign out
            </button>
          </div>
        ) : (
          <div className="space-y-2 animate-pulse">
            <div className="h-4 bg-gray-100 rounded w-3/4" />
            <div className="h-3 bg-gray-100 rounded w-1/2" />
            <div className="h-8 bg-gray-100 rounded-lg mt-1" />
          </div>
        )}
      </div>
    </aside>
  );
}
