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
          <h1>Регистрация отключена</h1>
          <p className="muted">
            На этом сервере Korbit аккаунты создаёт только администратор.
          </p>
          <Link href="/login">Назад ко входу</Link>
        </section>
      </main>
    );
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (password !== passwordConfirm) {
      setError('Подтверждение пароля не совпадает');
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
          : 'Ошибка регистрации';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-layout">
      <section className="card">
        <h1>Создание аккаунта Korbit</h1>
        <p className="muted">Регистрация по инвайт-коду</p>

        <form onSubmit={onSubmit} className="column">
          <label>
            Логин
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="new_user"
              required
              autoComplete="username"
            />
          </label>

          <label>
            Отображаемое имя
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="Необязательно"
              autoComplete="name"
            />
          </label>

          <label>
            Инвайт-код
            <input
              value={inviteCode}
              onChange={(event) => setInviteCode(event.target.value)}
              placeholder="ABCD1234"
              required
            />
          </label>

          <label>
            Пароль
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Минимум 10 символов, верхний/нижний регистр и цифры"
              required
              autoComplete="new-password"
            />
          </label>

          <label>
            Подтвердите пароль
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
            {submitting ? 'Создание аккаунта...' : 'Создать аккаунт'}
          </button>
        </form>

        <p className="muted">
          Уже есть доступ? <Link href="/login">Войти</Link>
        </p>
      </section>
    </main>
  );
}
