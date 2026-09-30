import { z } from 'zod';
import { LOCALES, THEMES } from 'shared';

// ті самі правила й для реєстрації, і для зміни в налаштуваннях
export const displayNameSchema = z.string().min(1).max(100);
export const passwordSchema = z.string().min(8);

export const registerSchema = z.object({
  email: z.string().email(),
  password: passwordSchema,
  displayName: displayNameSchema,
});

export const updateProfileSchema = z
  .object({
    displayName: displayNameSchema.optional(),
    theme: z.enum(THEMES as [string, ...string[]]).optional(),
    locale: z.enum(LOCALES as [string, ...string[]]).optional(),
  })
  .refine((body) => Object.values(body).some((v) => v !== undefined));

// поточний — будь-який непорожній: перевіряє його хеш, а не правило довжини,
// інакше людина зі старим коротким паролем не змогла б його змінити
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});

export const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: passwordSchema,
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
