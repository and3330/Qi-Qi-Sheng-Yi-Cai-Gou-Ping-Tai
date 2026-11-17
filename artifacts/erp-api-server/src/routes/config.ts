import { Router, type IRouter } from "express";
import { isDemoMode } from "../demo/demo-seed";

const router: IRouter = Router();

/** 公開的前端設定（不需登入） */
router.get("/config", (_req, res) => {
  res.json({ demoMode: isDemoMode() });
});

export default router;
