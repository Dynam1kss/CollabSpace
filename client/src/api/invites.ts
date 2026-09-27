import type { ApiErrorBody, InvitesResponse } from 'shared';
import { ApiError, parseResponse } from './boards';

export function fetchInvites() {
  return fetch('/api/invites').then((res) => parseResponse<InvitesResponse>(res));
}

// обидві відповіді порожні (204) — json тут нема що розбирати
async function answerInvite(boardId: string, answer: 'accept' | 'decline') {
  const res = await fetch(`/api/invites/${boardId}/${answer}`, { method: 'POST' });
  if (!res.ok) {
    const data = await res.json();
    throw new ApiError(res.status, (data as ApiErrorBody).error?.message ?? 'Помилка запиту');
  }
}

export function acceptInvite(boardId: string) {
  return answerInvite(boardId, 'accept');
}

export function declineInvite(boardId: string) {
  return answerInvite(boardId, 'decline');
}
