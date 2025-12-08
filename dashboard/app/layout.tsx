import './globals.css';
import type { ReactNode } from 'react';
import { Roboto, Roboto_Mono } from 'next/font/google';
import Navbar from '../components/navbar';
import Footer from '../components/footer';

const roboto = Roboto({
  weight: ['400', '500', '700'],
  subsets: ['latin'],
  variable: '--font-geist-sans',
});

const robotoMono = Roboto_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
});

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        className={`${roboto.variable} ${robotoMono.variable} antialiased transition-colors duration-300 bg-brand-white text-brand-dark flex flex-col min-h-screen`}
      >
        <Navbar />
        <main className="flex-1 bg-gradient-to-br from-brand-blue/5 via-white to-brand-purple/10">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
