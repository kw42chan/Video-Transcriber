import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Sidecar — Cantonese dubbing workspace',
  description: 'A focused workspace for turning English video into Hong Kong Cantonese.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
