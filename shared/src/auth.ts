export type Theme = 'light' | 'dark';
export const THEMES: Theme[] = ['light', 'dark'];

export type Locale = 'uk' | 'en' | 'de';
export const LOCALES: Locale[] = ['uk', 'en', 'de'];

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  theme: Theme;
  locale: Locale;
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
  locale?: Locale;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export interface AuthResponse {
  user: AuthUser;
}

// code — те, за чим клієнт вибирає перекладений текст; message — український
// опис для логів і для того, хто читає api напряму
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
  };
}
