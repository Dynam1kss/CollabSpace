import type { NextFunction, Request, Response } from 'express';
import type { ApiErrorBody } from 'shared';

export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    // необовʼязкові числа для повідомлення (скільки місця зайнято)
    public details?: { usedBytes?: number; totalBytes?: number },
  ) {
    super(message);
  }
}

// express впізнає error-мідлвар саме по 4 аргументах, тому лишаємо невикористані
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    const body: ApiErrorBody = { error: { code: err.code, message: err.message, ...err.details } };
    res.status(err.status).json(body);
    return;
  }

  // body-parser (json/raw) сам кидає помилку з type, коли тіло більше за limit
  if (typeof err === 'object' && err !== null && (err as { type?: string }).type === 'entity.too.large') {
    const body: ApiErrorBody = { error: { code: 'PAYLOAD_TOO_LARGE', message: 'Завеликий запит' } };
    res.status(413).json(body);
    return;
  }

  console.error(err);
  const body: ApiErrorBody = { error: { code: 'INTERNAL_ERROR', message: 'Внутрішня помилка сервера' } };
  res.status(500).json(body);
}
