import express from "express";
import cookieParser from "cookie-parser";
import { config } from "./core/config";
import { apiRouter } from "./core/router";
import { errorMiddleware } from "./core/error-middleware";

const app = express();

app.use(express.json());
app.use(cookieParser());

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api", apiRouter);

app.use(errorMiddleware);

app.listen(config.PORT, () => {
  console.log(`server listening on :${config.PORT}`);
});
