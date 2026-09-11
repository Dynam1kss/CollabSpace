// express сам вміє res.cookie(), а для читання куки не тягнемо cookie-parser заради однієї куки
export function parseCookies(header: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!header) return result;

  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    result[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }

  return result;
}

export const AUTH_COOKIE = 'token';
export const AUTH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// ті самі атрибути мають бути і на встановленні, і на clearCookie — інакше браузер не зітре куку
export function authCookieOptions(isProduction: boolean) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: isProduction,
    path: '/',
  };
}
