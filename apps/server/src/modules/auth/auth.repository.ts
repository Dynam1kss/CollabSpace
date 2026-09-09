import type { RefreshToken, User } from "@prisma/client";
import { prisma } from "../../core/prisma";

// Явні типи повернення (Promise<User> замість Prisma__UserClient<...>) —
// щоб репозиторій не протікав fluent-API Prisma в сервіс/тести.
export const authRepository = {
  findUserByEmail(email: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { email } });
  },

  findUserById(id: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { id } });
  },

  createUser(data: {
    email: string;
    passwordHash: string;
    name: string;
    avatarColor: string;
  }): Promise<User> {
    return prisma.user.create({ data });
  },

  createRefreshToken(data: {
    id: string;
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<RefreshToken> {
    return prisma.refreshToken.create({ data });
  },

  findRefreshTokenById(id: string): Promise<RefreshToken | null> {
    return prisma.refreshToken.findUnique({ where: { id } });
  },

  revokeRefreshToken(id: string): Promise<RefreshToken> {
    return prisma.refreshToken.update({ where: { id }, data: { revokedAt: new Date() } });
  },
};
