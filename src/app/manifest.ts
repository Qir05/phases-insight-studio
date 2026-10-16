import type { MetadataRoute } from 'next';

// Web app manifest — Android home-screen / install icon uses the Phases emblem.
// Icons are cropped from the official Phases Clinic logo (public/phases-logo.png).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Phases Insight Studio',
    short_name: 'Phases',
    description: 'AI-powered educational wellness assessments by Phases Clinic',
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#ffffff',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
