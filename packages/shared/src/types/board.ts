export type BoardRole = "OWNER" | "EDITOR" | "VIEWER";

export interface Board {
  id: string;
  title: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

export interface BoardMember {
  boardId: string;
  userId: string;
  role: BoardRole;
}

export interface BoardWithRole extends Board {
  myRole: BoardRole;
}
