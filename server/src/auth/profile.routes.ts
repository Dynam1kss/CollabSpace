import { Router } from 'express';
import type { AuthResponse, UpdateProfileRequest } from 'shared';
import { AppError } from '../errors';
import { prisma } from '../prisma';
import { requireAuth } from './auth.middleware';
import { updateProfileSchema } from './auth.schema';
import { toAuthUser } from './auth.service';

// власний профіль: кожна ручка міняє лише того, хто прийшов із кукою
export const profileRouter = Router();

profileRouter.use(requireAuth);

profileRouter.patch('/', async (req, res, next) => {
  try {
    const parsed = updateProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Імʼя має бути від 1 до 100 символів');
    }
    const { displayName }: UpdateProfileRequest = parsed.data;

    const user = await prisma.user.update({ where: { id: req.userId }, data: { displayName } });
    const body: AuthResponse = { user: toAuthUser(user) };
    res.json(body);
  } catch (err) {
    next(err);
  }
});
