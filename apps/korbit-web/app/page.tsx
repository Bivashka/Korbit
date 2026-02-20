'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { isAuthenticated } from '../lib/api';

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    if (isAuthenticated()) {
      router.replace('/chats');
      return;
    }
    router.replace('/login');
  }, [router]);

  return <main className="centered">Загрузка Korbit...</main>;
}
