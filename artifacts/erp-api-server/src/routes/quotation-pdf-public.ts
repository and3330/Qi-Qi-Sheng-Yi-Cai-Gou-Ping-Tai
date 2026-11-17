import { Router, type IRouter } from "express";
import { runWithTenant } from "@workspace/erp-db";
import { buildQuotationPdf, verifyQuotationPdfLink } from "../lib/quotation-pdf";

/**
 * 報價單 PDF 的下載連結（不用登入）。連結上有簽章與期限，只能下載那一張報價單；
 * 簽章不對或過期一律回 404，不透露單據是否存在。
 */
const router: IRouter = Router();

router.get("/public/quotation-pdf/:tenantId/:id", async (req, res): Promise<void> => {
  const tenantId = Number(req.params.tenantId), quotationId = Number(req.params.id), expires = Number(req.query.exp);
  if (!verifyQuotationPdfLink(tenantId, quotationId, expires, String(req.query.sig || ""))) {
    res.status(404).json({ error: "連結無效或已過期" }); return;
  }
  try {
    const pdf = await runWithTenant(tenantId, () => buildQuotationPdf(quotationId));
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${pdf.fileName.replace(/[^A-Za-z0-9._-]/g, "_")}"`);
    res.setHeader("Cache-Control", "private, no-store");
    res.send(Buffer.from(pdf.bytes));
  } catch {
    res.status(404).json({ error: "連結無效或已過期" });
  }
});

export default router;
