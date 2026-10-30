import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Video Transcriber — 粵語配音',
  description: 'EN video → HK 口語 Cantonese dub + lip sync',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
