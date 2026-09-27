import type { AuthResponse, ChangePasswordRequest, UpdateProfileRequest } from 'shared';
import { apiError, parseResponse } from './boards';

export function updateProfile(payload: UpdateProfileRequest) {
  return fetch('/api/me', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then((res) => parseResponse<AuthResponse>(res));
}

// як і картинка на дошку: сирі байти, тип — із самого File
export function uploadAvatar(file: File) {
  return fetch('/api/me/avatar', {
    method: 'POST',
    headers: { 'Content-Type': file.type },
    body: file,
  }).then((res) => parseResponse<AuthResponse>(res));
}

// 204 без тіла — json розбираємо лише на помилці
export async function changePassword(payload: ChangePasswordRequest) {
  const res = await fetch('/api/me/password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await apiError(res);
}
