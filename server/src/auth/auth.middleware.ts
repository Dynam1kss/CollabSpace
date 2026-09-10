import type { NextFunction, Request, Response } from 'express';
import { AUTH_COOKIE, parseCookies } from '../cookies';
import { AppError } from '../errors';
import { verifyAuthToken } from './auth.service';

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const token = parseCookies(req.headers.cookie)[AUTH_COOKIE];
  const userId = token ? verifyAuthToken(token) : null;

  if (!userId) {
    next(new AppError(401, 'UNAUTHORIZED', 'Потрібна авторизація'));
    return;
  }

  req.userId = userId;
  next();
}
