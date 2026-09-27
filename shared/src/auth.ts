export type Theme = 'light' | 'dark';
export const THEMES: Theme[] = ['light', 'dark'];

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  theme: Theme;
  createdAt: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  displayName: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

// будь-яке з полів — міняється лише те, що прийшло
export interface UpdateProfileRequest {
  displayName?: string;
  theme?: Theme;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export interface AuthResponse {
  user: AuthUser;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
  };
}
