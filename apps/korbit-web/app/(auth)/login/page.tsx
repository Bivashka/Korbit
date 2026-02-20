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
        rawError instanceof ApiError ? rawError.message : 'Login failed';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-layout">
      <section className="card">
        <h1>Korbit</h1>
        <p className="muted">Private messenger login</p>

        <form onSubmit={onSubmit} className="column">
          <label>
            Username
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="admin"
              autoComplete="username"
              required
            />
          </label>

          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Password"
              autoComplete="current-password"
              required
            />
          </label>

          {error ? <p className="error">{error}</p> : null}

          <button type="submit" disabled={submitting}>
            {submitting ? 'Signing in...' : 'Sign in'}
          </button>
        </form>

        {registrationMode !== 'admin_only' ? (
          <p className="muted">
            No account yet? <Link href="/register">Create via invite</Link>
          </p>
        ) : null}
      </section>
    </main>
  );
}

