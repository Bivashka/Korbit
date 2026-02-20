'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { ApiError, isAuthenticated, login } from '../../../lib/api';

const registrationMode =
  process.env.NEXT_PUBLIC_REGISTRATION_MODE ?? 'invite';

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isAuthenticated()) {
      router.replace('/chats');
    }
  }, [router]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      await login(username, password);
      router.replace('/chats');
    } catch (rawError) {
      const message =
        rawError instanceof ApiError ? rawError.message : 'Ошибка входа';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-layout">
      <section className="card">
        <h1>Korbit</h1>
        <p className="muted">Вход в приватный мессенджер</p>

        <form onSubmit={onSubmit} className="column">
          <label>
            Логин
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="admin"
              autoComplete="username"
              required
            />
          </label>

          <label>
            Пароль
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Введите пароль"
              autoComplete="current-password"
              required
            />
          </label>

          {error ? <p className="error">{error}</p> : null}

          <button type="submit" disabled={submitting}>
            {submitting ? 'Вход...' : 'Войти'}
          </button>
        </form>

        {registrationMode !== 'admin_only' ? (
          <p className="muted">
            Нет аккаунта? <Link href="/register">Зарегистрироваться по инвайту</Link>
          </p>
        ) : null}
      </section>
    </main>
  );
}
