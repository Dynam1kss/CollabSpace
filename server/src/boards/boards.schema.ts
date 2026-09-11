import { z } from 'zod';

export const createBoardSchema = z.object({
  title: z.string().min(1).max(200),
});

export const updateBoardSchema = z.object({
  title: z.string().min(1).max(200),
});

export const addMemberSchema = z.object({
  email: z.string().email(),
  role: z.enum(['EDITOR', 'VIEWER']),
});

export const removeMemberSchema = z.object({
  userId: z.string().min(1),
});
