import type {
  AddBoardMemberRequest,
  ApiErrorBody,
  BoardDetail,
  BoardListResponse,
  BoardObject,
  BoardRole,
  BoardSummary,
  CreateBoardRequest,
  RemoveBoardMemberRequest,
  SaveSnapshotRequest,
  SnapshotResponse,
  UpdateBoardRequest,
  UploadImageResponse,
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

// сервер повертає дошку з уже оновленим списком учасників
export function addBoardMember(boardId: string, email: string, role: BoardRole) {
  const payload: AddBoardMemberRequest = { email, role };
  return fetch(`/api/boards/${boardId}/members`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then((res) => parseResponse<BoardDetail>(res));
}

export async function removeBoardMember(boardId: string, userId: string) {
  const payload: RemoveBoardMemberRequest = { userId };
  const res = await fetch(`/api/boards/${boardId}/members`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error((data as ApiErrorBody).error?.message ?? 'Помилка запиту');
  }
}

// сирі байти файла в тілі, тип — з самого File; сервер відповідає відносним url
export function uploadBoardImage(boardId: string, file: File) {
  return fetch(`/api/boards/${boardId}/images`, {
    method: 'POST',
    headers: { 'Content-Type': file.type },
    body: file,
  }).then((res) => parseResponse<UploadImageResponse>(res));
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
