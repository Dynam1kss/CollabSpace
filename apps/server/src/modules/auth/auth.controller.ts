import type { Request, Response } from "express";
import { z } from "zod";
import { asyncHandler } from "../../core/async-handler";
import { config } from "../../core/config";
import { AppError } from "../../core/errors";
import { loginSchema, registerSchema } from "./auth.schema";
import { authService } from "./auth.service";
import { parseDurationMs } from "./jwt";

const REFRESH_COOKIE_NAME = "refreshToken";
// Cookie обмежена шляхом /api/auth — крім /refresh і /logout вона
// нікуди не потрібна, тож браузер не тягне її в кожен запит.
const REFRESH_COOKIE_PATH = "/api/auth";
const refreshCookieSchema = z.string().min(1).optional();

function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: config.NODE_ENV === "production",
    sameSite: "lax",
    path: REFRESH_COOKIE_PATH,
    maxAge: parseDurationMs(config.REFRESH_TOKEN_TTL),
  });
}

function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
}

function getRefreshCookie(req: Request): string | undefined {
  return refreshCookieSchema.parse(req.cookies?.[REFRESH_COOKIE_NAME]);
}

export const authController = {
  register: asyncHandler(async (req, res) => {
    const input = registerSchema.parse(req.body);
    const { user, accessToken, refreshToken } = await authService.register(input);
    setRefreshCookie(res, refreshToken);
    res.status(201).json({ user, accessToken });
  }),

  login: asyncHandler(async (req, res) => {
    const input = loginSchema.parse(req.body);
    const { user, accessToken, refreshToken } = await authService.login(input);
    setRefreshCookie(res, refreshToken);
    res.status(200).json({ user, accessToken });
  }),

  refresh: asyncHandler(async (req, res) => {
    const rawToken = getRefreshCookie(req);
    if (!rawToken) {
      throw new AppError("UNAUTHENTICATED", 401, "Немає refresh-токена");
    }

    const { user, accessToken, refreshToken } = await authService.refresh(rawToken);
    setRefreshCookie(res, refreshToken);
    res.status(200).json({ user, accessToken });
  }),

  logout: asyncHandler(async (req, res) => {
    await authService.logout(getRefreshCookie(req));
    clearRefreshCookie(res);
    res.status(204).send();
  }),

  wsTicket: asyncHandler(async (req, res) => {
    const ticket = authService.issueWsTicket(req.userId!);
    res.status(200).json({ ticket });
  }),
};
