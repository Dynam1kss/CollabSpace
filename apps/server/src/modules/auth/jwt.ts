import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { config } from "../../core/config";
import { AppError } from "../../core/errors";

const accessPayloadSchema = z.object({
  sub: z.string(),
  type: z.literal("access"),
});

const refreshPayloadSchema = z.object({
  sub: z.string(),
  jti: z.string(),
  type: z.literal("refresh"),
});

const wsTicketPayloadSchema = z.object({
  sub: z.string(),
  type: z.literal("ws-ticket"),
});

export type AccessPayload = z.infer<typeof accessPayloadSchema>;
export type RefreshPayload = z.infer<typeof refreshPayloadSchema>;
export type WsTicketPayload = z.infer<typeof wsTicketPayloadSchema>;

function verifyOrThrow<T>(token: string, secret: string, schema: z.ZodType<T>): T {
  try {
    const decoded: unknown = jwt.verify(token, secret);
    return schema.parse(decoded);
  } catch {
    throw new AppError("UNAUTHENTICATED", 401, "Недійсний або прострочений токен");
  }
}

// jsonwebtoken типізує `expiresIn` як число секунд або брендований
// рядок-літерал з пакета `ms` — наш рядок з .env під цей бренд не
// підходить, тож переводимо TTL у секунди через власний parseDurationMs
// (єдине джерело правди для тривалостей, використовується і для cookie).
export function signAccessToken(userId: string): string {
  const payload: AccessPayload = { sub: userId, type: "access" };
  const expiresIn = Math.floor(parseDurationMs(config.ACCESS_TOKEN_TTL) / 1000);
  return jwt.sign(payload, config.JWT_ACCESS_SECRET, { expiresIn });
}

export function verifyAccessToken(token: string): AccessPayload {
  return verifyOrThrow(token, config.JWT_ACCESS_SECRET, accessPayloadSchema);
}

export function signRefreshToken(userId: string, jti: string): string {
  const payload: RefreshPayload = { sub: userId, jti, type: "refresh" };
  const expiresIn = Math.floor(parseDurationMs(config.REFRESH_TOKEN_TTL) / 1000);
  return jwt.sign(payload, config.JWT_REFRESH_SECRET, { expiresIn });
}

export function verifyRefreshToken(token: string): RefreshPayload {
  return verifyOrThrow(token, config.JWT_REFRESH_SECRET, refreshPayloadSchema);
}

// Ticket підписаний тим самим секретом, що й access-токен, бо видається
// лише вже автентифікованому користувачу (за requireAuth) — окремий секрет
// не додає реального захисту, лише ще один рядок в .env.
export function signWsTicket(userId: string): string {
  const payload: WsTicketPayload = { sub: userId, type: "ws-ticket" };
  const expiresIn = Math.floor(parseDurationMs(config.WS_TICKET_TTL) / 1000);
  return jwt.sign(payload, config.JWT_ACCESS_SECRET, { expiresIn });
}

export function verifyWsTicket(token: string): WsTicketPayload {
  return verifyOrThrow(token, config.JWT_ACCESS_SECRET, wsTicketPayloadSchema);
}

// Хеш сирого JWT (не пароля!) — sha256 достатньо, бо токен і так
// високоентропійний; bcrypt тут був би лише зайвим уповільненням.
export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

const DURATION_RE = /^(\d+)(s|m|h|d)$/;
const UNIT_MS: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

// Мінімальний парсер для наших власних TTL-рядків з .env (15m, 7d, 30s).
// Не претендує на повну сумісність з форматом бібліотеки `ms`.
export function parseDurationMs(ttl: string): number {
  const match = DURATION_RE.exec(ttl);
  if (!match) {
    throw new Error(`Не вдалося розпарсити тривалість "${ttl}"`);
  }
  const amount = match[1]!;
  const unit = match[2]!;
  return Number(amount) * UNIT_MS[unit]!;
}
