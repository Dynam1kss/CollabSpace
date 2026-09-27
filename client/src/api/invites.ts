import type { InvitesResponse } from 'shared';
import { apiError, parseResponse } from './boards';

export function fetchInvites() {
  return fetch('/api/invites').then((res) => parseResponse<InvitesResponse>(res));
}

// обидві відповіді порожні (204) — json тут нема що розбирати
async function answerInvite(boardId: string, answer: 'accept' | 'decline') {
  const res = await fetch(`/api/invites/${boardId}/${answer}`, { method: 'POST' });
  if (!res.ok) throw await apiError(res);
}

export function acceptInvite(boardId: string) {
  return answerInvite(boardId, 'accept');
}

export function declineInvite(boardId: string) {
  return answerInvite(boardId, 'decline');
}
