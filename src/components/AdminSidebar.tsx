'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LayoutDashboard, PlusCircle, Building2, Users, LogOut, Wand2, Menu, X } from 'lucide-react';
import { createBrowserClient } from '@supabase/ssr';
import Logo from './Logo';
import type { Profile } from '@/lib/supabase';

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

/**
 * Admin navigation.
 *  - ≥1024px (lg): a static sidebar column.
 *  - <1024px: a sticky top bar with a menu button that opens the same
 *    navigation as a slide-in panel (focus moves into it, Escape / backdrop /
 *    navigation close it, background scroll is locked while open).
 */
export default function AdminSidebar() {
  const path    = usePathname();
  const router  = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [open, setOpen]       = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { profile?: Profile } | null) => {
        if (data?.profile) setProfile(data.profile);
      });
  }, []);

  // Close the mobile menu whenever the route changes.
  useEffect(() => { setOpen(false); }, [path]);

  const close = useCallback(() => {
    setOpen(false);
    menuButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    closeButtonRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, close]);

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }, [router]);

  const isSuperAdmin = profile?.role === 'super_admin';

  const nav = [
    { href: '/admin',               label: 'Dashboard',   icon: LayoutDashboard, exact: true  },
    { href: '/admin/tools/new',    label: 'New Tool',    icon: PlusCircle,      exact: false },
    { href: '/admin/tools/import', label: 'Import Quiz', icon: Wand2,           exact: false },
    ...(isSuperAdmin
      ? [
          { href: '/admin/workspaces', label: 'Workspaces', icon: Building2, exact: false },
          { href: '/admin/users',      label: 'Users',       icon: Users,     exact: false },
        ]
      : []
    ),
  ];

  const navLinks = (
    <nav aria-label="Admin" className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
      {nav.map(({ href, label, icon: Icon, exact }) => {
        const active = exact ? path === href : path === href || path.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              active
                ? 'bg-indigo-50 text-indigo-700'
                : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
            }`}
          >
            <Icon size={17} aria-hidden="true" />
            {label}
          </Link>
        );
      })}
    </nav>
  );

  const account = (
    <div className="px-4 py-4 border-t border-gray-100">
      {profile ? (
        <div className="space-y-2">
          <div className="px-1 min-w-0">
            <p className="text-sm font-medium text-gray-800 truncate">
              {profile.full_name || profile.email}
            </p>
            <span className={`inline-block text-xs px-2 py-0.5 rounded-full mt-0.5 font-medium ${
              isSuperAdmin ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-500'
            }`}>
              {isSuperAdmin ? 'Super Admin' : 'Provider Admin'}
            </span>
          </div>
          <button
            onClick={logout}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-500 hover:text-red-600 hover:bg-red-50 transition-colors"
          >
            <LogOut size={15} aria-hidden="true" />
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
  );

  return (
    <>
      {/* ── Mobile / tablet top bar (<1024px) ── */}
      <header className="lg:hidden sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-gray-100">
        <div className="flex items-center justify-between px-4 sm:px-6 h-14">
          <Link href="/admin" className="flex items-center gap-2 min-w-0" aria-label="Phases Insight Studio — Dashboard">
            <Logo size={28} />
            <span className="text-xs text-gray-400 hidden sm:inline">Insight Studio</span>
          </Link>
          <button
            ref={menuButtonRef}
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open menu"
            aria-expanded={open}
            aria-controls="admin-mobile-nav"
            className="inline-flex items-center justify-center w-10 h-10 -mr-2 rounded-lg text-gray-600 hover:bg-gray-50 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            <Menu size={20} aria-hidden="true" />
          </button>
        </div>
      </header>

      {/* ── Mobile / tablet slide-in menu ── */}
      {open && (
        <div className="lg:hidden fixed inset-0 z-40" id="admin-mobile-nav">
          <div className="absolute inset-0 bg-gray-900/30" aria-hidden="true" onClick={close} />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Admin navigation"
            className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-white shadow-xl flex flex-col"
          >
            <div className="flex items-center justify-between px-5 py-5 border-b border-gray-100">
              <div>
                <Logo size={32} />
                <p className="text-xs text-gray-400 mt-1 ml-1">Insight Studio</p>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={close}
                aria-label="Close menu"
                className="inline-flex items-center justify-center w-10 h-10 -mr-2 rounded-lg text-gray-500 hover:bg-gray-50 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                <X size={20} aria-hidden="true" />
              </button>
            </div>
            {navLinks}
            {account}
          </div>
        </div>
      )}

      {/* ── Desktop sidebar (≥1024px) ── */}
      <aside className="hidden lg:flex w-60 flex-shrink-0 h-screen sticky top-0 bg-white border-r border-gray-100 flex-col">
        <div className="px-5 py-6 border-b border-gray-100">
          <Logo size={36} />
          <p className="text-xs text-gray-400 mt-1 ml-1">Insight Studio</p>
        </div>
        {navLinks}
        {account}
      </aside>
    </>
  );
}
