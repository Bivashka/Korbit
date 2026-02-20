const ACCESS_TOKEN_KEY = 'korbit_access_token';
const REFRESH_TOKEN_KEY = 'korbit_refresh_token';

export function getAccessToken() {
  if (typeof window === 'undefined') {
    return null;
  }
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function getRefreshToken() {
  if (typeof window === 'undefined') {
    return null;
  }
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function setTokens(accessToken: string, refreshToken: string) {
  if (typeof window === 'undefined') {
    return;
  }
  localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
}

export function clearTokens() {
  if (typeof window === 'undefined') {
    return;
  }
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
}

