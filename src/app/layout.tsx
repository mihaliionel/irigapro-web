import type { Metadata } from 'next';
import { DM_Sans, DM_Mono } from 'next/font/google';
import './globals.css';

const dmSans = DM_Sans({
  subsets: ['latin'],
  variable: '--font-dm-sans',
  display: 'swap',
});

const dmMono = DM_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-dm-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'IrigaPro — Proiectare Sisteme Irigații',
  description: 'Planifică, simulează și exportă sisteme de irigații profesionale. Bazat pe Rain Bird, Hunter, Toro.',
  keywords: ['irigații', 'aspersor', 'Rain Bird', 'Hunter', 'proiectare irigații'],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ro" className={`${dmSans.variable} ${dmMono.variable}`}>
      <body className="bg-green-950 text-green-100 font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
