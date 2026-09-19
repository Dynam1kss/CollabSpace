import { z } from 'zod';

export const createBoardSchema = z.object({
  title: z.string().min(1).max(200),
});

export const updateBoardSchema = z.object({
  title: z.string().min(1).max(200),
});

export const addMemberSchema = z.object({
  email: z.string().email(),
  role: z.enum(['ADMIN', 'EDITOR', 'VIEWER']),
});

export const updateMemberSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(['ADMIN', 'EDITOR', 'VIEWER']),
});

export const forceVoiceSchema = z.object({
  userId: z.string().min(1),
  mute: z.boolean().optional(),
  deafen: z.boolean().optional(),
});

export const removeMemberSchema = z.object({
  userId: z.string().min(1),
});
