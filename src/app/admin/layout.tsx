import { redirect } from 'next/navigation';
import { getSessionUser, getProfile } from '@/lib/auth';
import AdminSidebar from '@/components/AdminSidebar';

export const metadata = { title: 'Phases Insight Studio — Admin' };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const profile = await getProfile(user.id);
  if (!profile || !profile.is_active) redirect('/login');

  return (
    <div className="min-h-screen bg-gray-50 lg:flex">
      <AdminSidebar />
      <main className="flex-1 min-w-0 px-4 py-6 sm:px-6 lg:p-8">{children}</main>
    </div>
  );
}
