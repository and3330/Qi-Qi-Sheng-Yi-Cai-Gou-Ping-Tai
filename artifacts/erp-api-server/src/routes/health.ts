import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/erp-api-zod";

const router: IRouter = Router();

// 打包時由 build.mjs 寫入；沒經過打包（測試、開發）時沒有這個值
declare const __APP_VERSION__: { version: string; commit: string | null; builtAt: string } | undefined;
const APP_VERSION = typeof __APP_VERSION__ !== "undefined" && __APP_VERSION__
  ? __APP_VERSION__
  : { version: "dev", commit: null, builtAt: null };

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json({ ...data, ...APP_VERSION });
});

export default router;
