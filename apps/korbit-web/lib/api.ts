import { AuthPayload, ChatItem, MessageItem, UserProfile } from './types';
import { clearTokens, getAccessToken, getRefreshToken, setTokens } from './session';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

type RequestOptions = {
  method?: string;
  body?: unknown;
  withAuth?: boolean;
};

async function safeJson(response: Response) {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

async function refreshTokens() {
  const refreshToken = getRefreshToken();
  if (!refreshToken) {
    clearTokens();
    return false;
  }

  const response = await fetch(`${API_URL}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });

  if (!response.ok) {
    clearTokens();
    return false;
  }

  const payload = (await response.json()) as AuthPayload;
  setTokens(payload.accessToken, payload.refreshToken);
  return true;
}

export async function request<T>(
  path: string,
  options: RequestOptions = {},
  retry = true,
): Promise<T> {
  const withAuth = options.withAuth ?? true;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (withAuth) {
    const accessToken = getAccessToken();
    if (!accessToken) {
      throw new ApiError('Unauthorized', 401);
    }
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const response = await fetch(`${API_URL}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (response.status === 401 && withAuth && retry) {
    const refreshed = await refreshTokens();
    if (refreshed) {
      return request<T>(path, options, false);
    }
  }

  if (!response.ok) {
    const details = await safeJson(response);
    const message =
      typeof details === 'object' &&
      details &&
      'message' in details &&
      typeof details.message === 'string'
        ? details.message
        : `Request failed (${response.status})`;
    throw new ApiError(message, response.status, details);
  }

  const payload = (await safeJson(response)) as T;
  return payload;
}

export async function login(username: string, password: string) {
  const payload = await request<AuthPayload>(
    '/auth/login',
    {
      method: 'POST',
      body: { username, password },
      withAuth: false,
    },
    false,
  );
  setTokens(payload.accessToken, payload.refreshToken);
  return payload;
}

export async function register(params: {
  username: string;
  password: string;
  displayName?: string;
  inviteCode?: string;
}) {
  const payload = await request<AuthPayload>(
    '/auth/register',
    {
      method: 'POST',
      body: params,
      withAuth: false,
    },
    false,
  );
  setTokens(payload.accessToken, payload.refreshToken);
  return payload;
}

export async function logout() {
  const refreshToken = getRefreshToken();
  if (refreshToken) {
    await request<{ success: boolean }>(
      '/auth/logout',
      {
        method: 'POST',
        body: { refreshToken },
        withAuth: false,
      },
      false,
    ).catch(() => undefined);
  }
  clearTokens();
}

export function getApiBaseUrl() {
  return API_URL;
}

export function isAuthenticated() {
  return Boolean(getAccessToken());
}

export async function getMe() {
  return request<UserProfile>('/users/me');
}

export async function listChats() {
  return request<ChatItem[]>('/chats');
}

export async function createDirectChat(username: string) {
  return request<ChatItem>('/chats/direct', {
    method: 'POST',
    body: { username },
  });
}

export async function listMessages(chatId: string, cursor?: string) {
  const query = new URLSearchParams();
  if (cursor) {
    query.set('cursor', cursor);
  }
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return request<{ items: MessageItem[]; nextCursor: string | null }>(
    `/chats/${chatId}/messages${suffix}`,
  );
}

export async function sendMessage(chatId: string, content: string) {
  return request<MessageItem>(`/chats/${chatId}/messages`, {
    method: 'POST',
    body: { content },
  });
}

export async function markRead(chatId: string, messageId?: string) {
  return request<{ chatId: string; userId: string; messageId: string | null }>(
    `/chats/${chatId}/read`,
    {
      method: 'POST',
      body: { messageId },
    },
  );
}

export async function listInvites() {
  return request<
    Array<{
      id: string;
      code: string;
      maxUses: number;
      usesCount: number;
      expiresAt: string | null;
      disabledAt: string | null;
      createdAt: string;
    }>
  >('/invites');
}

export async function createInvite(params: {
  maxUses?: number;
  expiresAt?: string;
}) {
  return request('/invites', {
    method: 'POST',
    body: params,
  });
}

