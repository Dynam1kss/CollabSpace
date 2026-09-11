import rateLimit from 'express-rate-limit';
import type { ApiErrorBody } from 'shared';

// окремий лічильник на кожен виклик — /login і /register рахують спроби незалежно
export function authRateLimiter() {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    // у тестах багато реєстрацій підряд з одного IP — ліміт заважав би тестам, не безпеці
    skip: () => process.env.NODE_ENV === 'test',
    handler: (_req, res) => {
      const body: ApiErrorBody = {
        error: { code: 'TOO_MANY_REQUESTS', message: 'Забагато спроб, спробуйте пізніше' },
      };
      res.status(429).json(body);
    },
  });
}
