'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { ApiError, register } from '../../../lib/api';

const registrationMode =
  process.env.NEXT_PUBLIC_REGISTRATION_MODE ?? 'invite';

export default function RegisterPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (registrationMode === 'admin_only') {
    return (
      <main className="auth-layout">
        <section className="card">
          <h1>Registration Disabled</h1>
          <p className="muted">
            This Korbit instance uses admin-managed accounts only.
          </p>
          <Link href="/login">Back to login</Link>
        </section>
      </main>
    );
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (password !== passwordConfirm) {
      setError('Password confirmation does not match');
      return;
    }

    setSubmitting(true);
    try {
      await register({
        username,
        displayName: displayName || undefined,
        inviteCode,
        password,
      });
      router.replace('/chats');
    } catch (rawError) {
      const message =
        rawError instanceof ApiError
          ? rawError.message
          : 'Registration failed';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-layout">
      <section className="card">
        <h1>Create Korbit Account</h1>
        <p className="muted">Invite-only registration</p>

        <form onSubmit={onSubmit} className="column">
          <label>
            Username
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="new_user"
              required
              autoComplete="username"
            />
          </label>

          <label>
            Display name
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="Optional"
              autoComplete="name"
            />
          </label>

          <label>
            Invite code
            <input
              value={inviteCode}
              onChange={(event) => setInviteCode(event.target.value)}
              placeholder="ABCD1234"
              required
            />
          </label>

          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="At least 10 chars, upper/lower/digit"
              required
              autoComplete="new-password"
            />
          </label>

          <label>
            Confirm password
            <input
              type="password"
              value={passwordConfirm}
              onChange={(event) => setPasswordConfirm(event.target.value)}
              required
              autoComplete="new-password"
            />
          </label>

          {error ? <p className="error">{error}</p> : null}
          <button type="submit" disabled={submitting}>
            {submitting ? 'Creating account...' : 'Create account'}
          </button>
        </form>

        <p className="muted">
          Already have access? <Link href="/login">Sign in</Link>
        </p>
      </section>
    </main>
  );
}

