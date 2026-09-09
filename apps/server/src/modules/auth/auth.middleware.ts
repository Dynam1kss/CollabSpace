import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../core/errors";
import { verifyAccessToken } from "./jwt";

const BEARER_PREFIX = "Bearer ";

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith(BEARER_PREFIX)) {
    throw new AppError("UNAUTHENTICATED", 401, "Потрібна авторизація");
  }

  const token = header.slice(BEARER_PREFIX.length);
  const payload = verifyAccessToken(token);
  req.userId = payload.sub;
  next();
}
