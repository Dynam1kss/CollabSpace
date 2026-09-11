import type {
  ApiErrorBody,
  BoardListResponse,
  BoardSummary,
  CreateBoardRequest,
  UpdateBoardRequest,
} from 'shared';

async function parseResponse<T>(res: Response): Promise<T> {
  const data = await res.json();
  if (!res.ok) {
    throw new Error((data as ApiErrorBody).error?.message ?? 'Помилка запиту');
  }
  return data as T;
}

export function fetchBoards() {
  return fetch('/api/boards').then((res) => parseResponse<BoardListResponse>(res));
}

export function createBoard(payload: CreateBoardRequest) {
  return fetch('/api/boards', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then((res) => parseResponse<BoardSummary>(res));
}

export function renameBoard(id: string, payload: UpdateBoardRequest) {
  return fetch(`/api/boards/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then((res) => parseResponse<BoardSummary>(res));
}

export async function deleteBoard(id: string) {
  const res = await fetch(`/api/boards/${id}`, { method: 'DELETE' });
  if (!res.ok) {
    const data = await res.json();
    throw new Error((data as ApiErrorBody).error?.message ?? 'Помилка запиту');
  }
}
