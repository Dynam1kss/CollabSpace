import type { NextFunction, Request, Response } from 'express';
import type { ApiErrorBody } from 'shared';

export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

// express впізнає error-мідлвар саме по 4 аргументах, тому лишаємо невикористані
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    const body: ApiErrorBody = { error: { code: err.code, message: err.message } };
    res.status(err.status).json(body);
    return;
  }

  console.error(err);
  const body: ApiErrorBody = { error: { code: 'INTERNAL_ERROR', message: 'Внутрішня помилка сервера' } };
  res.status(500).json(body);
}
