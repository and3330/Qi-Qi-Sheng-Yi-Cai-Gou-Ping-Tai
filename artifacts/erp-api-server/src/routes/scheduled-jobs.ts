import { Router, type IRouter } from "express";
import { requireRole } from "../middleware/require-auth";
import { listJobs, runJobByName } from "../lib/scheduler";

const router: IRouter = Router();
router.use("/scheduled-jobs", requireRole("owner", "admin"));

router.get("/scheduled-jobs", async (_req, res): Promise<void> => {
  res.json({ jobs: listJobs() });
});

router.post("/scheduled-jobs/:name/run", async (req, res): Promise<void> => {
  const result = await runJobByName(req.params.name);
  if (!result.ok) { res.status(400).json({ error: result.error }); return; }
  res.json({ success: true, jobs: listJobs() });
});

export default router;
