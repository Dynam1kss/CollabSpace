import { beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import type { RefreshToken, User } from "@prisma/client";

vi.mock("../auth.repository", () => ({
  authRepository: {
    findUserByEmail: vi.fn(),
    findUserById: vi.fn(),
    createUser: vi.fn(),
    createRefreshToken: vi.fn(),
    findRefreshTokenById: vi.fn(),
    revokeRefreshToken: vi.fn(),
  },
}));

import { authRepository } from "../auth.repository";
import { authService } from "../auth.service";
import { hashToken, signRefreshToken } from "../jwt";

const repo = vi.mocked(authRepository);

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: "user-1",
    email: "student@example.com",
    passwordHash: "irrelevant",
    name: "Студент",
    avatarColor: "#3B82F6",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function makeRefreshRow(overrides: Partial<RefreshToken> = {}): RefreshToken {
  return {
    id: "refresh-row-1",
    userId: "user-1",
    tokenHash: "irrelevant",
    expiresAt: new Date(Date.now() + 1000 * 60 * 60),
    revokedAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("authService.register", () => {
  it("хешує пароль і створює користувача, коли email вільний", async () => {
    repo.findUserByEmail.mockResolvedValue(null);
    repo.createUser.mockImplementation(async (data) => makeUser(data));
    repo.createRefreshToken.mockResolvedValue(makeRefreshRow());

    const result = await authService.register({
      email: "new@example.com",
      password: "password123",
      name: "Новий Студент",
    });

    expect(repo.createUser).toHaveBeenCalledTimes(1);
    const createArgs = repo.createUser.mock.calls[0]![0];
    expect(createArgs.passwordHash).not.toBe("password123");
    await expect(bcrypt.compare("password123", createArgs.passwordHash)).resolves.toBe(true);

    expect(result.user.email).toBe("new@example.com");
    expect(result.accessToken).toEqual(expect.any(String));
    expect(result.refreshToken).toEqual(expect.any(String));
  });

  it("відмовляє, якщо email вже зайнятий", async () => {
    repo.findUserByEmail.mockResolvedValue(makeUser());

    await expect(
      authService.register({
        email: "student@example.com",
        password: "password123",
        name: "X",
      }),
    ).rejects.toMatchObject({ code: "EMAIL_TAKEN" });

    expect(repo.createUser).not.toHaveBeenCalled();
  });
});

describe("authService.login", () => {
  it("повертає токени при вірному паролі", async () => {
    const passwordHash = await bcrypt.hash("correct-password", 4);
    repo.findUserByEmail.mockResolvedValue(makeUser({ passwordHash }));
    repo.createRefreshToken.mockResolvedValue(makeRefreshRow());

    const result = await authService.login({
      email: "student@example.com",
      password: "correct-password",
    });

    expect(result.user.id).toBe("user-1");
    expect(result.accessToken).toEqual(expect.any(String));
  });

  it("відмовляє при невірному паролі", async () => {
    const passwordHash = await bcrypt.hash("correct-password", 4);
    repo.findUserByEmail.mockResolvedValue(makeUser({ passwordHash }));

    await expect(
      authService.login({ email: "student@example.com", password: "wrong-password" }),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
  });

  it("відмовляє, якщо користувача не існує", async () => {
    repo.findUserByEmail.mockResolvedValue(null);

    await expect(
      authService.login({ email: "ghost@example.com", password: "whatever1" }),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
  });
});

describe("authService.refresh", () => {
  it("ротує refresh-токен: старий відкликається, видається новий", async () => {
    const jti = "refresh-row-1";
    const rawToken = signRefreshToken("user-1", jti);

    repo.findRefreshTokenById.mockResolvedValue(
      makeRefreshRow({ id: jti, tokenHash: hashToken(rawToken) }),
    );
    repo.findUserById.mockResolvedValue(makeUser());
    repo.createRefreshToken.mockResolvedValue(makeRefreshRow());

    const result = await authService.refresh(rawToken);

    expect(repo.revokeRefreshToken).toHaveBeenCalledWith(jti);
    expect(result.refreshToken).not.toBe(rawToken);
    expect(result.user.id).toBe("user-1");

    const newRowArgs = repo.createRefreshToken.mock.calls[0]![0];
    expect(newRowArgs.id).not.toBe(jti);
  });

  it("відмовляє для вже відкликаного токена", async () => {
    const jti = "refresh-row-2";
    const rawToken = signRefreshToken("user-1", jti);

    repo.findRefreshTokenById.mockResolvedValue(
      makeRefreshRow({ id: jti, tokenHash: hashToken(rawToken), revokedAt: new Date() }),
    );

    await expect(authService.refresh(rawToken)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    expect(repo.revokeRefreshToken).not.toHaveBeenCalled();
  });

  it("відмовляє, якщо рядка в БД взагалі немає (невідомий/чужий токен)", async () => {
    const rawToken = signRefreshToken("user-1", "unknown-jti");
    repo.findRefreshTokenById.mockResolvedValue(null);

    await expect(authService.refresh(rawToken)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
  });
});
