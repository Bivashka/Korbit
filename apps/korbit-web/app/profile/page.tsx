'use client';

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, getMe, isAuthenticated, logout, updateMe, uploadMyAvatar } from '../../lib/api';
import { UserProfile } from '../../lib/types';

type ThemeMode = 'light' | 'dark' | 'navy';

const THEME_STORAGE_KEY = 'korbit-theme';

function avatarLetter(profile: UserProfile | null) {
  const source = profile?.displayName || profile?.username || 'K';
  return source.trim().slice(0, 1).toUpperCase();
}

export default function ProfilePage() {
  const router = useRouter();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [themeMode, setThemeMode] = useState<ThemeMode>('dark');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const activeAvatarUrl = useMemo(
    () => avatarPreviewUrl || profile?.avatarUrl || null,
    [avatarPreviewUrl, profile?.avatarUrl],
  );

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (storedTheme === 'dark' || storedTheme === 'light' || storedTheme === 'navy') {
      setThemeMode(storedTheme);
    }
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }
    document.documentElement.dataset.theme = themeMode;
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
    }
  }, [themeMode]);

  useEffect(() => {
    if (!isAuthenticated()) {
      router.replace('/login');
      return;
    }

    const load = async () => {
      try {
        const me = await getMe();
        setProfile(me);
        setDisplayName(me.displayName ?? '');
        setBio(me.bio ?? '');
      } catch (rawError) {
        if (rawError instanceof ApiError && rawError.status === 401) {
          await logout();
          router.replace('/login');
          return;
        }
        setError(rawError instanceof Error ? rawError.message : 'Ошибка загрузки профиля');
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [router]);

  useEffect(() => {
    return () => {
      if (avatarPreviewUrl) {
        URL.revokeObjectURL(avatarPreviewUrl);
      }
    };
  }, [avatarPreviewUrl]);

  async function onSaveProfile(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const updated = await updateMe({
        displayName: displayName.trim() || undefined,
        bio: bio.trim() || undefined,
      });
      setProfile(updated);
      setNotice('Профиль сохранен');
    } catch (rawError) {
      setError(rawError instanceof Error ? rawError.message : 'Ошибка сохранения профиля');
    } finally {
      setSaving(false);
    }
  }

  function onAvatarPicked(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setAvatarFile(file);

    if (avatarPreviewUrl) {
      URL.revokeObjectURL(avatarPreviewUrl);
    }
    if (file) {
      setAvatarPreviewUrl(URL.createObjectURL(file));
    } else {
      setAvatarPreviewUrl(null);
    }
  }

  async function onUploadAvatar() {
    if (!avatarFile) {
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const updated = await uploadMyAvatar(avatarFile);
      setProfile(updated);
      setAvatarFile(null);
      if (avatarPreviewUrl) {
        URL.revokeObjectURL(avatarPreviewUrl);
      }
      setAvatarPreviewUrl(null);
      setNotice('Аватар обновлен');
    } catch (rawError) {
      setError(rawError instanceof Error ? rawError.message : 'Ошибка загрузки аватара');
    } finally {
      setUploading(false);
    }
  }

  if (loading) {
    return <main className="centered">Загрузка профиля...</main>;
  }

  return (
    <main className="profile-page">
      <section className="profile-card">
        <header className="profile-card-head">
          <button type="button" className="link-button" onClick={() => router.push('/chats')}>
            Назад в чаты
          </button>
          <h2>Профиль</h2>
          <button type="button" className="link-button" onClick={() => router.push('/chats')}>
            Готово
          </button>
        </header>

        <div className="profile-avatar-block">
          {activeAvatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={activeAvatarUrl} alt="Аватар" className="profile-avatar-image" />
          ) : (
            <div className="profile-avatar-fallback">{avatarLetter(profile)}</div>
          )}
          <div className="profile-avatar-actions">
            <label className="profile-upload-label">
              <input type="file" accept="image/*" onChange={onAvatarPicked} />
              Выбрать фото
            </label>
            <button
              type="button"
              onClick={() => void onUploadAvatar()}
              disabled={!avatarFile || uploading}
            >
              {uploading ? 'Загрузка...' : 'Загрузить'}
            </button>
          </div>
        </div>

        <form className="profile-form" onSubmit={onSaveProfile}>
          <label>
            Имя
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder={profile?.username || 'Имя'}
            />
          </label>
          <label>
            О себе
            <input
              value={bio}
              onChange={(event) => setBio(event.target.value)}
              placeholder="Короткое описание"
            />
          </label>
          <label>
            Тема
            <select
              value={themeMode}
              onChange={(event) => setThemeMode(event.target.value as ThemeMode)}
            >
              <option value="light">Светлая</option>
              <option value="dark">Темная</option>
              <option value="navy">Midnight</option>
            </select>
          </label>

          <button type="submit" disabled={saving}>
            {saving ? 'Сохранение...' : 'Сохранить'}
          </button>
        </form>

        {notice ? <p className="muted">{notice}</p> : null}
        {error ? <p className="error">{error}</p> : null}
      </section>
    </main>
  );
}
