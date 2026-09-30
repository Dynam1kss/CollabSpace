export type Theme = 'light' | 'dark';
export const THEMES: Theme[] = ['light', 'dark'];

export type Locale = 'uk' | 'en' | 'de' | 'fr';
export const LOCALES: Locale[] = ['uk', 'en', 'de', 'fr'];

// однорядковий підпис під імʼям у картці профілю. 100 символів — та сама межа,
// що й у displayName; більше в картку завширшки 320px не влізе без простирадла
export const BIO_MAX_LENGTH = 100;

export interface AuthUser {
  id: string;
  email: string;
  // підтверджена пошта. Прав не додає — по ньому показують нагадування
  emailVerified: boolean;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
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
  // порожній рядок — прибрати підпис; поле відсутнє — не чіпати
  bio?: string;
}

// відповідь на це завжди однакова (204), навіть якщо такої пошти немає —
// інакше форма відновлення стала б перевіркою, хто в нас зареєстрований
export interface ForgotPasswordRequest {
  email: string;
}

export interface ResetPasswordRequest {
  token: string;
  password: string;
}

export interface VerifyEmailRequest {
  token: string;
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
