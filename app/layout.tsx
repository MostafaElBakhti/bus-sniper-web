import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Bus Sniper Bot',
  description: 'Automated bus ticket booking for 1337 network',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}