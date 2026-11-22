import { Router, type IRouter } from "express";
import { db } from "@workspace/erp-db";
import { requireAuth, EMPLOYEE_ROLE } from "../middleware/require-auth";
import { isDocType, relatedDocuments } from "../lib/related-documents";
import { machineOnly } from "../lib/api-key-user";

/**
 * 關聯單據：GET /related-documents/:type/:id
 * 回傳這張單的來源單、後續單、開出的分錄；每個單據視窗的「關聯單據」區塊都呼叫這一支。
 */
const router: IRouter = Router();
router.use("/related-documents", requireAuth);

const FINANCE_ROLES = ["super_admin", "owner", "admin", "finance_admin", "accountant"];

router.get("/related-documents/:type/:id", async (req, res): Promise<void> => {
  const type = String(req.params.type);
  const id = Number(req.params.id);
  if (!isDocType(type) || !Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "單據種類或編號不正確" }); return; }
  const role = machineOnly(req) ? null : req.session?.user?.role;
  // 員工自助帳號只看得到自己的申請，不開放查公司的單據鏈
  if (role === EMPLOYEE_ROLE) { res.json([]); return; }
  const finance = machineOnly(req) ? (req as any).apiKey?.permissions === "admin" : FINANCE_ROLES.includes(String(role));
  try {
    res.json(await relatedDocuments(db, type, id, finance));
  } catch (e) {
    req.log?.error?.({ err: e }, "related-documents failed");
    res.status(500).json({ error: "關聯單據讀取失敗，請稍後再試" });
  }
});

export default router;
