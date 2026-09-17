import type { BoardObject } from './board-objects';

export type BoardRole = 'EDITOR' | 'VIEWER';

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

// снепшот — увесь вміст дошки одним масивом; тимчасово, до CRDT
export interface SnapshotResponse {
  objects: BoardObject[];
  // null — дошку ще жодного разу не зберігали
  updatedAt: string | null;
}

export interface SaveSnapshotRequest {
  objects: BoardObject[];
}
