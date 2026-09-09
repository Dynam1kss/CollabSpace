import { z } from "zod";
import { NAME_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@project/shared";

export const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(PASSWORD_MIN_LENGTH),
  name: z.string().trim().min(1).max(NAME_MAX_LENGTH),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
