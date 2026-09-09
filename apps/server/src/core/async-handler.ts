import type { NextFunction, Request, Response } from "express";

type AsyncRouteHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

// Express 4 не ловить помилки з async-хендлерів сам — без цієї обгортки
// кожен throw всередині await "губиться" й запит висне без відповіді.
export function asyncHandler(handler: AsyncRouteHandler) {
  return (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res, next).catch(next);
  };
}
