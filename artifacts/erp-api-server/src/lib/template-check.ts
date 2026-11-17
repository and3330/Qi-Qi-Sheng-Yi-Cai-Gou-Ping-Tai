import { eq } from "drizzle-orm";
import { db, orderTemplatesTable } from "@workspace/erp-db";
import { missingRequiredFields } from "./template-fields";

/**
 * 驗證模板可否套用於指定專案。
 * 回傳 null 表示通過；否則回傳錯誤訊息（呼叫端以 400 回應）。
 * templateId 為 null/undefined 時視為不套用模板，直接通過。
 */
export async function validateTemplateForProject(
  templateIdRaw: unknown,
  projectIdRaw: unknown,
  /** 有傳就一併檢查模板的必填欄位；不傳（undefined）只檢查模板能不能用 */
  extraFields?: unknown,
): Promise<string | null> {
  if (templateIdRaw === undefined || templateIdRaw === null || templateIdRaw === "") return null;
  const templateId = Number(templateIdRaw);
  if (!Number.isInteger(templateId) || templateId <= 0) return "模板 ID 格式無效";

  const [tpl] = await db
    .select({ id: orderTemplatesTable.id, projectId: orderTemplatesTable.projectId, isActive: orderTemplatesTable.isActive, fieldSchema: orderTemplatesTable.fieldSchema })
    .from(orderTemplatesTable)
    .where(eq(orderTemplatesTable.id, templateId));
  if (!tpl) return "指定的訂單模板不存在";
  if (!tpl.isActive) return "指定的訂單模板已停用";

  if (tpl.projectId !== null) {
    const projectId = projectIdRaw == null || projectIdRaw === "" ? null : Number(projectIdRaw);
    if (projectId !== tpl.projectId) return "此模板為專案專屬模板，不可套用於其他專案";
  }
  if (extraFields !== undefined) {
    const missing = missingRequiredFields(tpl.fieldSchema, extraFields);
    if (missing.length > 0) return `模板必填欄位尚未填寫：${missing.join("、")}`;
  }
  return null;
}
