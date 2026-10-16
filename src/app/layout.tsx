import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { Toaster } from 'sonner';
import './globals.css';

const geistSans = localFont({
  src: './fonts/GeistVF.woff',
  variable: '--font-geist-sans',
  weight: '100 900',
});
const geistMono = localFont({
  src: './fonts/GeistMonoVF.woff',
  variable: '--font-geist-mono',
  weight: '100 900',
});

// Icons come from the App Router file conventions in this folder
// (favicon.ico, icon.png, apple-icon.png) plus manifest.ts — all Phases branding.
export const metadata: Metadata = {
  title: 'Phases Insight Studio',
  description: 'AI-powered educational wellness assessments by Phases Clinic',
  applicationName: 'Phases Insight Studio',
  appleWebApp: { title: 'Phases', capable: true, statusBarStyle: 'default' },
};

export const viewport: Viewport = {
  themeColor: '#ffffff',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased bg-gray-50`}>
        {children}
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
