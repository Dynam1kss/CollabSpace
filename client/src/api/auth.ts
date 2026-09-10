import type { ApiErrorBody, AuthResponse, LoginRequest, RegisterRequest } from 'shared';

async function parseResponse<T>(res: Response): Promise<T> {
  const data = await res.json();
  if (!res.ok) {
    throw new Error((data as ApiErrorBody).error?.message ?? 'Помилка запиту');
  }
  return data as T;
}

function postJson<T>(url: string, payload: unknown) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then((res) => parseResponse<T>(res));
}

export function register(payload: RegisterRequest) {
  return postJson<AuthResponse>('/api/auth/register', payload);
}

export function login(payload: LoginRequest) {
  return postJson<AuthResponse>('/api/auth/login', payload);
}

export function fetchMe() {
  return fetch('/api/auth/me').then((res) => parseResponse<AuthResponse>(res));
}

export function logout() {
  return fetch('/api/auth/logout', { method: 'POST' });
}
