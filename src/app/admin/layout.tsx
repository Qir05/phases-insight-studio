import AdminSidebar from '@/components/AdminSidebar';

export const metadata = { title: 'Phases Insight Studio — Admin' };

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-gray-50">
      <AdminSidebar />
      <main className="flex-1 p-8 overflow-y-auto">{children}</main>
    </div>
  );
}
