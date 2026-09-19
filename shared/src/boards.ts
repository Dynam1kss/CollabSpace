import type { BoardObject } from './board-objects';

// порядок важливий: OWNER > ADMIN > EDITOR > VIEWER. Власник ролі не має —
// він визначається полем ownerId дошки, тому в цьому типі його й немає
export type BoardRole = 'ADMIN' | 'EDITOR' | 'VIEWER';

// хто кого може чіпати в керуванні учасниками: власник — будь-кого,
// адміністратор — лише тих, хто нижчий за нього
export function outranks(actor: 'OWNER' | BoardRole, target: 'OWNER' | BoardRole) {
  if (actor === 'OWNER') return target !== 'OWNER';
  if (actor === 'ADMIN') return target === 'EDITOR' || target === 'VIEWER';
  return false;
}

export interface BoardMemberInfo {
  userId: string;
  email: string;
  displayName: string;
  role: BoardRole;
}

export interface BoardSummary {
  id: string;
  title: string;
  ownerId: string;
  isOwner: boolean;
  // моя роль саме на цій дошці — щоб список не показував дій, на які прав
  // немає; isOwner лишаємо, бо на нього вже спирається чимало місць
  myRole: 'OWNER' | BoardRole;
  createdAt: string;
  updatedAt: string;
}

export interface BoardDetail extends BoardSummary {
  members: BoardMemberInfo[];
}

export interface BoardListResponse {
  boards: BoardSummary[];
}

export interface CreateBoardRequest {
  title: string;
}

export interface UpdateBoardRequest {
  title: string;
}

export interface AddBoardMemberRequest {
  email: string;
  role: BoardRole;
}

// роль міняємо на місці, не видаляючи й не заводячи учасника наново —
// інакше ряд у базі щоразу новий, а з ним і його id
export interface UpdateBoardMemberRequest {
  userId: string;
  role: BoardRole;
}

export interface RemoveBoardMemberRequest {
  userId: string;
}

// снепшот — увесь вміст дошки одним масивом; тимчасово, до CRDT
export interface SnapshotResponse {
  objects: BoardObject[];
  // null — дошку ще жодного разу не зберігали
  updatedAt: string | null;
}

export interface SaveSnapshotRequest {
  objects: BoardObject[];
}

export interface UploadImageResponse {
  url: string;
}
