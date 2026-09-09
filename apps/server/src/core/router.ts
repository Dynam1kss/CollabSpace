import { Router } from "express";
import { authRoutes } from "../modules/auth/auth.routes";

// /boards монтується тут у наступному кроці.
export const apiRouter = Router();
apiRouter.use("/auth", authRoutes);
