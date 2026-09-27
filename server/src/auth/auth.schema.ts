import { z } from 'zod';

// ті самі правила й для реєстрації, і для зміни в налаштуваннях
export const displayNameSchema = z.string().min(1).max(100);
export const passwordSchema = z.string().min(8);

export const registerSchema = z.object({
  email: z.string().email(),
  password: passwordSchema,
  displayName: displayNameSchema,
});

export const updateProfileSchema = z.object({
  displayName: displayNameSchema,
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
