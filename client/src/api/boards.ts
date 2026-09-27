import type {
  AddBoardMemberRequest,
  ApiErrorBody,
  BoardDetail,
  BoardListResponse,
  BoardObject,
  BoardRole,
  BoardSummary,
  BoardVersionInfo,
  ChatHistoryResponse,
  CreateBoardRequest,
  IceConfigResponse,
  ForceVoiceRequest,
  RemoveBoardMemberRequest,
  SaveSeatRequest,
  SaveSnapshotRequest,
  SaveVersionRequest,
  SeatResponse,
  SnapshotResponse,
  UpdateBoardMemberRequest,
  UpdateBoardRequest,
  UploadImageResponse,
  VersionsResponse,
} from 'shared';

// несе статус відповіді — щоб відрізнити "не знайдено" (404) від решти
// помилок — і код, за яким клієнт показує перекладений текст (i18n/api-error)
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

// тіло помилки може бути й не json (проксі впав, 502 від vite) — тоді код unknown
export async function apiError(res: Response) {
  const data = (await res.json().catch(() => null)) as ApiErrorBody | null;
  return new ApiError(res.status, data?.error?.code ?? 'unknown', data?.error?.message ?? '');
}

export async function parseResponse<T>(res: Response): Promise<T> {
  if (!res.ok) throw await apiError(res);
  return (await res.json()) as T;
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
  if (!res.ok) throw await apiError(res);
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

// роль наявного учасника — не видалення з повторним додаванням. У відповідь
// приходить уся дошка з оновленим списком, тому перезапитувати не треба
export function updateBoardMemberRole(boardId: string, userId: string, role: BoardRole) {
  const payload: UpdateBoardMemberRequest = { userId, role };
  return fetch(`/api/boards/${boardId}/members`, {
    method: 'PATCH',
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
  if (!res.ok) throw await apiError(res);
}

// сирі байти файла в тілі, тип — з самого File; сервер відповідає відносним url
export function uploadBoardImage(boardId: string, file: File) {
  return fetch(`/api/boards/${boardId}/images`, {
    method: 'POST',
    headers: { 'Content-Type': file.type },
    body: file,
  }).then((res) => parseResponse<UploadImageResponse>(res));
}

// своє місце на дошці. Чужі приходять живим кадром, у базу кожен пише лише
// власне — тому тут немає ні списку, ні чужого id
export function fetchMySeat(boardId: string) {
  return fetch(`/api/boards/${boardId}/seat`).then((res) => parseResponse<SeatResponse>(res));
}

export async function saveMySeat(boardId: string, seat: SaveSeatRequest) {
  const res = await fetch(`/api/boards/${boardId}/seat`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(seat),
  });
  if (!res.ok) throw await apiError(res);
}

// примусово вимкнути учаснику мікрофон чи звук — лише власнику й адміну
export async function forceVoice(boardId: string, patch: ForceVoiceRequest) {
  const res = await fetch(`/api/boards/${boardId}/voice`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw await apiError(res);
}

// куди стукати браузеру, щоб пробити NAT. Тягнемо на вхід у розмову, а не
// на завантаження дошки: більшості сеансів голос узагалі не потрібен
export function fetchIceConfig() {
  return fetch('/api/ice-config').then((res) => parseResponse<IceConfigResponse>(res));
}

// історія чату. Окремим запитом від снепшоту: це різні сутності й різні
// обсяги, тягнути їх разом лише заради одного раунд-тріпу нема сенсу
export function fetchChatHistory(id: string) {
  return fetch(`/api/boards/${id}/chat`).then((res) => parseResponse<ChatHistoryResponse>(res));
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
  if (!res.ok) throw await apiError(res);
}

export function fetchVersions(boardId: string) {
  return fetch(`/api/boards/${boardId}/versions`).then((res) => parseResponse<VersionsResponse>(res));
}

export function saveVersion(boardId: string, label: string) {
  const payload: SaveVersionRequest = { label };
  return fetch(`/api/boards/${boardId}/versions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then((res) => parseResponse<BoardVersionInfo>(res));
}

// відповідь порожня: новий вміст приходить не звідси, а кадром RESTORED усій кімнаті
export async function restoreVersion(boardId: string, versionId: string) {
  const res = await fetch(`/api/boards/${boardId}/versions/${versionId}/restore`, { method: 'POST' });
  if (!res.ok) throw await apiError(res);
}
