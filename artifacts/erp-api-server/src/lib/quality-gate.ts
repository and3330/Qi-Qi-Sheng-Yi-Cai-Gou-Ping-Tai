import { and, eq, inArray } from "drizzle-orm";
import { qualityInspectionsTable, qualityInspectionTemplatesTable } from "@workspace/erp-db/schema";

/**
 * 品質檢驗關卡：檢驗單透過 referenceType + referenceId 連到進貨單、出貨單、工單。
 * 連結的檢驗單沒有全部「合格」之前，來源單據不能入庫／出貨／完工。
 */
export const INSPECTION_REFERENCE_TYPES = ["Purchase Receipt", "Delivery Note", "Work Order"] as const;
export type InspectionReferenceType = typeof INSPECTION_REFERENCE_TYPES[number];
export const INSPECTION_PASSED_STATUS = "Accepted";

interface LinkedInspection { inspectionNumber: string; status: string; itemId: number | null }

export async function getLinkedInspections(tx: any, referenceType: InspectionReferenceType, referenceId: number): Promise<LinkedInspection[]> {
  return tx.select({
    inspectionNumber: qualityInspectionsTable.inspectionNumber,
    status: qualityInspectionsTable.status,
    itemId: qualityInspectionsTable.itemId,
  }).from(qualityInspectionsTable)
    .where(and(eq(qualityInspectionsTable.referenceType, referenceType), eq(qualityInspectionsTable.referenceId, referenceId)));
}

/** 找出擋住單據的檢驗單編號（未合格者） */
export function blockingInspections(inspections: LinkedInspection[]): string[] {
  return inspections.filter(q => q.status !== INSPECTION_PASSED_STATUS).map(q => q.inspectionNumber);
}

/** 連結的檢驗單有任何一張未合格就拋錯 */
export async function assertLinkedInspectionsAccepted(tx: any, referenceType: InspectionReferenceType, referenceId: number, action: string): Promise<LinkedInspection[]> {
  const inspections = await getLinkedInspections(tx, referenceType, referenceId);
  const blocking = blockingInspections(inspections);
  if (blocking.length > 0) throw new Error(`品質檢驗 ${blocking.join("、")} 尚未合格，無法${action}`);
  return inspections;
}

/** 需要進料檢驗卻還沒有合格檢驗單的品項（有設定「進料檢驗」範本的品項即視為必檢） */
export function itemsMissingInspection(requiredItemIds: number[], inspections: LinkedInspection[]): number[] {
  const passed = new Set(inspections.filter(q => q.status === INSPECTION_PASSED_STATUS && q.itemId != null).map(q => q.itemId as number));
  return requiredItemIds.filter(id => !passed.has(id));
}

/**
 * 進貨單入庫前的檢驗關卡：
 * 1. 連結到這張進貨單的檢驗單必須全部合格
 * 2. 品項若設有「進料檢驗」範本，必須先有一張連結這張進貨單、該品項且合格的檢驗單
 */
export async function assertIncomingInspectionPassed(tx: any, receipt: { id: number; items: Array<{ itemId: number; itemName: string }> }): Promise<void> {
  const inspections = await assertLinkedInspectionsAccepted(tx, "Purchase Receipt", receipt.id, "入庫");
  const itemIds = Array.from(new Set(receipt.items.map(i => Number(i.itemId)).filter(Boolean)));
  if (itemIds.length === 0) return;
  const templates: Array<{ itemId: number | null }> = await tx.select({ itemId: qualityInspectionTemplatesTable.itemId })
    .from(qualityInspectionTemplatesTable)
    .where(and(eq(qualityInspectionTemplatesTable.inspectionType, "Incoming"), inArray(qualityInspectionTemplatesTable.itemId, itemIds)));
  const required = Array.from(new Set(templates.map(t => t.itemId).filter((id): id is number => id != null)));
  const missing = itemsMissingInspection(required, inspections);
  if (missing.length > 0) {
    const names = receipt.items.filter(i => missing.includes(Number(i.itemId))).map(i => i.itemName);
    throw new Error(`品項「${Array.from(new Set(names)).join("、")}」需要進料檢驗，請先建立連結這張進貨單的檢驗單並判定合格後再入庫`);
  }
}
