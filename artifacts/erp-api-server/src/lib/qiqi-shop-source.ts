import { and, eq, sql } from "drizzle-orm";
import {
  db, accountsTable, integrationMappingsTable, integrationSourcesTable, itemsTable, projectsTable,
} from "@workspace/erp-db";
import { QIQI_SHOP_SOURCE_CODE } from "./integration-adapters";
import { logger } from "./logger";

const PROJECT_NAME = "七期商城";
const DEFAULT_ITEM_CODE = "QIQI-SHOP";
const DEFAULT_ITEM_NAME = "七期商城商品銷售";

/**
 * 七期網站：確保「七期商城」這個外部串接來源存在，而且開箱就能入帳。
 * 必須在租戶上下文內呼叫（排程、手動同步都是）。可重複執行，已經有的不會動。
 *
 * 建立的東西：
 * - 專案「七期商城」：商城訂單的收入都歸在這個專案
 * - 品項「七期商城商品銷售」：還沒做品項對應的商品先記在這個品項（不扣 ERP 庫存）
 * - 來源「七期商城」＋「所有訂單類型」的對應：專案、預設品項、收入科目（銷貨收入）
 *
 * 之後要讓某個商品扣 ERP 庫存，到「外部串接 → 品項對應」把商品編號對到 ERP 品項即可。
 */
export async function ensureQiqiShopSource(): Promise<void> {
  try {
    const [existing] = await db.select().from(integrationSourcesTable).where(eq(integrationSourcesTable.code, QIQI_SHOP_SOURCE_CODE));
    if (existing) return;

    await db.transaction(async (tx) => {
      let [project] = await tx.select({ id: projectsTable.id }).from(projectsTable).where(eq(projectsTable.name, PROJECT_NAME));
      if (!project) {
        [project] = await tx.insert(projectsTable).values({
          name: PROJECT_NAME, description: "七期生醫採購平台（商城）的訂單收入", status: "Open", priority: "Medium",
        } as typeof projectsTable.$inferInsert).returning({ id: projectsTable.id });
      }

      let [item] = await tx.select({ id: itemsTable.id }).from(itemsTable).where(eq(itemsTable.itemCode, DEFAULT_ITEM_CODE));
      if (!item) {
        [item] = await tx.insert(itemsTable).values({
          itemCode: DEFAULT_ITEM_CODE, itemName: DEFAULT_ITEM_NAME, itemGroup: "七期商城", itemType: "Service",
          unit: "式", isVirtual: true, status: "Active",
        } as typeof itemsTable.$inferInsert).returning({ id: itemsTable.id });
      }

      // 商城賣的是商品，收入記「商品收入」（沒有就找「銷貨收入」）；都找不到就不指定，照 ERP 的預設規則走
      const [revenue] = await tx.select({ id: accountsTable.id }).from(accountsTable)
        .where(and(eq(accountsTable.isGroup, false), sql`${accountsTable.accountName} IN ('商品收入', '銷貨收入')`))
        .orderBy(sql`CASE WHEN ${accountsTable.accountName} = '商品收入' THEN 0 ELSE 1 END`, accountsTable.id).limit(1);

      const [source] = await tx.insert(integrationSourcesTable).values({
        code: QIQI_SHOP_SOURCE_CODE, name: "七期商城", defaultProjectId: project.id, isActive: true,
        note: "同一個網站的商城訂單，由系統直接讀取，不需要金鑰。已付款的訂單每小時自動入帳。",
      } as typeof integrationSourcesTable.$inferInsert).returning({ id: integrationSourcesTable.id });

      await tx.insert(integrationMappingsTable).values({
        sourceId: source.id, externalType: "*", label: "商城訂單", projectId: project.id,
        defaultItemId: item.id, revenueAccountId: revenue?.id ?? null,
      } as typeof integrationMappingsTable.$inferInsert);
    });
    logger.info("qiqi shop integration source created");
  } catch (e: any) {
    logger.error({ err: e?.message }, "ensure qiqi shop source failed");
  }
}
