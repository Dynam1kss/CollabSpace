export {};

declare global {
  namespace Express {
    interface Request {
      // Ставить requireAuth після успішної перевірки access-токена.
      userId?: string;
    }
  }
}
