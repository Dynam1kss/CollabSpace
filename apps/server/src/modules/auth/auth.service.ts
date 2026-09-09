import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import type { User } from "@prisma/client";
import { AVATAR_COLORS, type PublicUser } from "@project/shared";
import { AppError } from "../../core/errors";
import { config } from "../../core/config";
import { authRepository } from "./auth.repository";
import { hashToken, parseDurationMs, signAccessToken, signRefreshToken, signWsTicket, verifyRefreshToken } from "./jwt";
import type { LoginInput, RegisterInput } from "./auth.schema";

const PASSWORD_HASH_ROUNDS = 10;

function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarColor: user.avatarColor,
    createdAt: user.createdAt.toISOString(),
  };
}

// Детермінований вибір кольору за email — той самий користувач завжди
// отримує той самий колір, без окремого поля вибору при реєстрації.
function pickAvatarColor(email: string): string {
  let hash = 0;
  for (const char of email) {
    hash = (hash * 31 + char.charCodeAt(0)) % AVATAR_COLORS.length;
  }
  return AVATAR_COLORS[hash]!;
}

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

// Видає нову пару токенів і одразу пише RefreshToken-рядок у БД —
// без цього запису токен неможливо буде відкликати при logout/ротації.
async function issueTokenPair(userId: string): Promise<TokenPair> {
  const accessToken = signAccessToken(userId);
  const jti = crypto.randomUUID();
  const refreshToken = signRefreshToken(userId, jti);

  await authRepository.createRefreshToken({
    id: jti,
    userId,
    tokenHash: hashToken(refreshToken),
    expiresAt: new Date(Date.now() + parseDurationMs(config.REFRESH_TOKEN_TTL)),
  });

  return { accessToken, refreshToken };
}

export const authService = {
  async register(input: RegisterInput) {
    const existing = await authRepository.findUserByEmail(input.email);
    if (existing) {
      throw new AppError("EMAIL_TAKEN", 409, "Користувач з таким email вже існує");
    }

    const passwordHash = await bcrypt.hash(input.password, PASSWORD_HASH_ROUNDS);
    const user = await authRepository.createUser({
      email: input.email,
      passwordHash,
      name: input.name,
      avatarColor: pickAvatarColor(input.email),
    });

    const tokens = await issueTokenPair(user.id);
    return { user: toPublicUser(user), ...tokens };
  },

  async login(input: LoginInput) {
    const user = await authRepository.findUserByEmail(input.email);
    if (!user) {
      throw new AppError("INVALID_CREDENTIALS", 401, "Невірний email або пароль");
    }

    const passwordMatches = await bcrypt.compare(input.password, user.passwordHash);
    if (!passwordMatches) {
      throw new AppError("INVALID_CREDENTIALS", 401, "Невірний email або пароль");
    }

    const tokens = await issueTokenPair(user.id);
    return { user: toPublicUser(user), ...tokens };
  },

  // Ротація: пред'явлений refresh завжди відкликається, навіть якщо далі
  // видача нового впаде — тобто одним refresh-токеном можна скористатись
  // лише один раз.
  async refresh(rawToken: string) {
    const payload = verifyRefreshToken(rawToken);
    const stored = await authRepository.findRefreshTokenById(payload.jti);

    if (!stored || stored.revokedAt || stored.expiresAt.getTime() < Date.now()) {
      throw new AppError("UNAUTHENTICATED", 401, "Refresh-токен недійсний");
    }

    if (stored.tokenHash !== hashToken(rawToken)) {
      throw new AppError("UNAUTHENTICATED", 401, "Refresh-токен недійсний");
    }

    await authRepository.revokeRefreshToken(stored.id);

    const user = await authRepository.findUserById(stored.userId);
    if (!user) {
      throw new AppError("UNAUTHENTICATED", 401, "Користувача не знайдено");
    }

    const tokens = await issueTokenPair(user.id);
    return { user: toPublicUser(user), ...tokens };
  },

  // Best-effort: невдалий/чужий/відсутній токен не заважає клієнту "вийти".
  async logout(rawToken: string | undefined): Promise<void> {
    if (!rawToken) return;
    try {
      const payload = verifyRefreshToken(rawToken);
      await authRepository.revokeRefreshToken(payload.jti);
    } catch (error) {
      console.error("logout: не вдалося відкликати refresh-токен", error);
    }
  },

  issueWsTicket(userId: string): string {
    return signWsTicket(userId);
  },
};
