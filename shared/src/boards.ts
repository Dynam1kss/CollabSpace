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
