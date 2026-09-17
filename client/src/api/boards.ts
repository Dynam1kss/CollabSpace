import type {
  ApiErrorBody,
  BoardDetail,
  BoardListResponse,
  BoardObject,
  BoardSummary,
  CreateBoardRequest,
  SaveSnapshotRequest,
  SnapshotResponse,
  UpdateBoardRequest,
} from 'shared';

// несе статус відповіді — щоб відрізнити "не знайдено" (404) від решти помилок
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function parseResponse<T>(res: Response): Promise<T> {
  const data = await res.json();
  if (!res.ok) {
    throw new ApiError(res.status, (data as ApiErrorBody).error?.message ?? 'Помилка запиту');
  }
  return data as T;
}

export function fetchBoards() {
  return fetch('/api/boards').then((res) => parseResponse<BoardListResponse>(res));
}

export function fetchBoard(id: string) {
  return fetch(`/api/boards/${id}`).then((res) => parseResponse<BoardDetail>(res));
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

export function fetchBoardSnapshot(id: string) {
  return fetch(`/api/boards/${id}/snapshot`).then((res) => parseResponse<SnapshotResponse>(res));
}

// keepalive — щоб запит дожив до кінця, коли вкладку закривають (beforeunload);
// браузер тоді обмежує тіло ~64кб, для звичайного збереження прапорець не потрібен
export async function saveBoardSnapshot(id: string, objects: BoardObject[], keepalive = false) {
  const payload: SaveSnapshotRequest = { objects };
  const res = await fetch(`/api/boards/${id}/snapshot`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    keepalive,
  });
  if (!res.ok) {
    const data = await res.json();
    throw new ApiError(res.status, (data as ApiErrorBody).error?.message ?? 'Помилка запиту');
  }
}
