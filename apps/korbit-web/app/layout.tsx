import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Korbit',
  description: 'Приватный мессенджер для команды',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
