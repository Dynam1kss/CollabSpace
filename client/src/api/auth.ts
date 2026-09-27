import type { AuthResponse, LoginRequest, RegisterRequest } from 'shared';
import { parseResponse } from './boards';

function postJson<T>(url: string, payload: unknown) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then((res) => parseResponse<T>(res));
}

// кука одна на весь браузер, а сокет дошки автентифікується лише раз, при
// підключенні. Увійшли в іншій вкладці під іншим акаунтом — стара вкладка й далі
// сидить у кімнаті під попереднім, показує його права, а її rest уже йде з
// новою кукою і ловить 403. Тож кажемо іншим вкладкам, що людина змінилась
export const AUTH_CHANGED_KEY = 'collabspace:auth-changed';

function announceAuthChange() {
  try {
    localStorage.setItem(AUTH_CHANGED_KEY, String(Date.now()));
  } catch {
    // сховище недоступне (приватне вікно) — лишається як було до цього
  }
}

export async function register(payload: RegisterRequest) {
  const res = await postJson<AuthResponse>('/api/auth/register', payload);
  announceAuthChange();
  return res;
}

export async function login(payload: LoginRequest) {
  const res = await postJson<AuthResponse>('/api/auth/login', payload);
  announceAuthChange();
  return res;
}

export function fetchMe() {
  return fetch('/api/auth/me').then((res) => parseResponse<AuthResponse>(res));
}

export async function logout() {
  const res = await fetch('/api/auth/logout', { method: 'POST' });
  announceAuthChange();
  return res;
}
