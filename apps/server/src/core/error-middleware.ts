import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { AppError } from "./errors";

// Єдине місце, де формат помилки перетворюється на JSON-відповідь.
// Контролери й сервіси ніколи не пишуть у res напряму при помилці.
export const errorMiddleware: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).json({ code: err.code, message: err.message });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({ code: "VALIDATION_ERROR", message: err.issues[0]?.message ?? "Invalid input" });
    return;
  }

  console.error(err);
  res.status(500).json({ code: "INTERNAL_ERROR", message: "Internal server error" });
};
