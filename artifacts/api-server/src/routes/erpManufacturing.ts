import { Router, type IRouter } from "express";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, erpBomLinesTable, erpBomsTable, erpProductionPlansTable, erpWorkOrdersTable, erpWorkstationsTable, productsTable, productVariantsTable, stockMovementsTable } from "@workspace/db";
import { WarehouseStockError, decreaseWarehouseStock, getDefaultWarehouseId, increaseWarehouseStock, syncMirrorStock } from "../lib/warehouseStock";
import { requireErpMenu } from "../middlewares/requireErp";
const r:IRouter=Router(),unique=(e:unknown)=>(e as any)?.cause?.code==="23505",clean=(b:any,f:string[])=>Object.fromEntries(f.filter(x=>b[x]!==undefined).map(x=>[x,b[x]]));
const date=()=>new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Taipei"}).format(new Date()).replaceAll("-","");
r.get("/erp/boms",requireErpMenu("/manufacturing/boms"),async(_q,s)=>s.json(await db.select().from(erpBomsTable).orderBy(desc(erpBomsTable.id))));
r.post("/erp/boms",requireErpMenu("/manufacturing/boms"),async(q,s)=>{if(!q.body.name||!Number(q.body.productId))return void s.status(400).json({error:"BOM 名稱及成品必填"});const lines=q.body.lines||[];const row=await db.transaction(async tx=>{const[b]=await tx.insert(erpBomsTable).values(clean(q.body,["productId","name","version","isActive","notes"]) as any).returning();if(lines.length)await tx.insert(erpBomLinesTable).values(lines.map((x:any)=>({...clean(x,["componentProductId","quantity","unit","notes"]),bomId:b.id})));return b});s.status(201).json(row)});
r.get("/erp/boms/:id",requireErpMenu("/manufacturing/boms"),async(q,s)=>{const[b]=await db.select().from(erpBomsTable).where(eq(erpBomsTable.id,Number(q.params.id)));if(!b)return void s.status(404).json({error:"找不到 BOM"});s.json({...b,lines:await db.select().from(erpBomLinesTable).where(eq(erpBomLinesTable.bomId,b.id))})});
r.patch("/erp/boms/:id",requireErpMenu("/manufacturing/boms"),async(q,s)=>{const[b]=await db.update(erpBomsTable).set(clean(q.body,["productId","name","version","isActive","notes"])).where(eq(erpBomsTable.id,Number(q.params.id))).returning();b?s.json(b):s.status(404).json({error:"找不到 BOM"})});
r.get("/erp/workstations",requireErpMenu("/manufacturing/workstations"),async(_q,s)=>s.json(await db.select().from(erpWorkstationsTable).orderBy(erpWorkstationsTable.code)));
r.post("/erp/workstations",requireErpMenu("/manufacturing/workstations"),async(q,s)=>{try{const[x]=await db.insert(erpWorkstationsTable).values(clean(q.body,["name","code","capacityPerDay","notes","isActive"]) as any).returning();s.status(201).json(x)}catch(e){s.status(unique(e)?409:500).json({error:unique(e)?"工作站代碼重複":"建立失敗"})}});
r.patch("/erp/workstations/:id",requireErpMenu("/manufacturing/workstations"),async(q,s)=>{try{const[x]=await db.update(erpWorkstationsTable).set(clean(q.body,["name","code","capacityPerDay","notes","isActive"])).where(eq(erpWorkstationsTable.id,Number(q.params.id))).returning();x?s.json(x):s.status(404).json({error:"找不到工作站"})}catch(e){s.status(unique(e)?409:500).json({error:"工作站代碼重複"})}});
r.get("/erp/work-orders",requireErpMenu("/manufacturing/work-orders"),async(_q,s)=>s.json(await db.select().from(erpWorkOrdersTable).orderBy(desc(erpWorkOrdersTable.createdAt))));
r.post("/erp/work-orders",requireErpMenu("/manufacturing/work-orders"),async(q,s)=>{if(!Number(q.body.productId)||!(Number(q.body.quantity)>0))return void s.status(400).json({error:"品項及數量必填"});const p=`WO-${date()}`;for(let a=0;a<5;a++){const z=await db.execute(sql`select count(*)::int n from erp_work_orders where work_order_no like ${p+"-%"}`);try{const[x]=await db.insert(erpWorkOrdersTable).values({...clean(q.body,["bomId","productId","quantity","workstationId","plannedStartDate","plannedEndDate","notes"]),workOrderNo:`${p}-${String(Number((z.rows??z)[0]?.n||0)+1+a).padStart(4,"0")}`} as any).returning();return void s.status(201).json(x)}catch(e){if(!unique(e)||a===4)throw e}}});
/** 製令完工扣料入庫時的可預期錯誤（訊息可直接顯示給使用者） */
class WorkOrderError extends Error {}

/**
 * 製令完工：有指定 BOM 時，在同一筆交易內扣原料、成品入庫（皆走預設倉），並寫庫存異動。
 * - 原料用量 = BOM 單位用量 × 製令數量，無條件進位到整數（庫存以整數計）。
 * - 成品入庫數量須為整數。
 * - 有啟用規格的品項、虛擬品項不支援自動扣料入庫（庫存以規格為單位，BOM 尚未對應規格）。
 * - 未指定 BOM 的製令只更新狀態，與原本行為相同。
 * 庫存一律透過 warehouseStock.ts 的函式異動，完成後同步鏡像總量。
 */
async function completeWorkOrderStock(tx: any, order: typeof erpWorkOrdersTable.$inferSelect) {
  if (order.bomId == null) return;
  const lines = await tx.select().from(erpBomLinesTable).where(eq(erpBomLinesTable.bomId, order.bomId));
  if (lines.length === 0) return;
  if (!Number.isInteger(order.quantity) || order.quantity <= 0)
    throw new WorkOrderError("製令數量須為正整數才能自動扣料入庫");

  // 同一原料出現多列時先合併
  const need = new Map<number, number>();
  for (const line of lines)
    need.set(line.componentProductId, (need.get(line.componentProductId) ?? 0) + Number(line.quantity) * order.quantity);

  const productIds = [...new Set([order.productId, ...need.keys()])];
  if (need.has(order.productId)) throw new WorkOrderError("BOM 的原料不可包含成品本身");
  const products = await tx.select().from(productsTable).where(inArray(productsTable.id, productIds));
  const byId = new Map<number, typeof productsTable.$inferSelect>(products.map((p: any) => [p.id, p]));
  for (const pid of productIds)
    if (!byId.has(pid)) throw new WorkOrderError(`品項不存在（id ${pid}）`);
  const variants = await tx
    .select({ productId: productVariantsTable.productId })
    .from(productVariantsTable)
    .where(and(inArray(productVariantsTable.productId, productIds), eq(productVariantsTable.isActive, true)));
  if (variants.length > 0) {
    const name = byId.get(variants[0].productId)?.name ?? "";
    throw new WorkOrderError(`「${name}」有啟用規格，暫不支援製令自動扣料入庫，請改用庫存調整`);
  }
  for (const pid of productIds)
    if (byId.get(pid)!.isVirtual)
      throw new WorkOrderError(`「${byId.get(pid)!.name}」是虛擬品項，沒有庫存，無法扣料入庫`);

  const warehouseId = await getDefaultWarehouseId(tx);
  for (const [productId, raw] of need) {
    const quantity = Math.ceil(raw - 1e-9);
    if (quantity <= 0) continue;
    await decreaseWarehouseStock(tx, { warehouseId, productId, variantId: null, quantity, label: byId.get(productId)!.name });
    const stockAfter = await syncMirrorStock(tx, { productId, variantId: null });
    await tx.insert(stockMovementsTable).values({
      productId, variantId: null, type: "adjust", quantity: -quantity, stockAfter, warehouseId,
      reason: "製令領料", refNo: order.workOrderNo,
    });
  }
  await increaseWarehouseStock(tx, { warehouseId, productId: order.productId, variantId: null, quantity: order.quantity });
  const stockAfter = await syncMirrorStock(tx, { productId: order.productId, variantId: null });
  await tx.insert(stockMovementsTable).values({
    productId: order.productId, variantId: null, type: "adjust", quantity: order.quantity, stockAfter, warehouseId,
    reason: "製令完工入庫", refNo: order.workOrderNo,
  });
}

r.patch("/erp/work-orders/:id/status", requireErpMenu("/manufacturing/work-orders"), async (q, s) => {
  const id = Number(q.params.id);
  const target = q.body?.status;
  const allowed: Record<string, string[]> = { draft: ["released", "cancelled"], released: ["in_progress", "cancelled"], in_progress: ["completed"] };
  try {
    const updated = await db.transaction(async (tx) => {
      const [before] = await tx.select().from(erpWorkOrdersTable).where(eq(erpWorkOrdersTable.id, id)).for("update");
      if (!before) return { code: 404 as const };
      if (!allowed[before.status]?.includes(target)) return { code: 409 as const };
      const now = new Date();
      const set: Record<string, unknown> = { status: target };
      if (target === "in_progress") set.actualStartAt = now;
      if (target === "completed") {
        set.actualEndAt = now;
        await completeWorkOrderStock(tx, before);
      }
      const [row] = await tx.update(erpWorkOrdersTable).set(set).where(eq(erpWorkOrdersTable.id, id)).returning();
      return { code: 200 as const, row };
    });
    if (updated.code === 404) return void s.status(404).json({ error: "找不到製令" });
    if (updated.code === 409) return void s.status(409).json({ error: "不允許的狀態轉換" });
    s.json(updated.row);
  } catch (e) {
    if (e instanceof WorkOrderError || e instanceof WarehouseStockError)
      return void s.status(400).json({ error: e.message });
    throw e;
  }
});
r.get("/erp/production-plans",requireErpMenu("/manufacturing/plans"),async(_q,s)=>s.json(await db.select().from(erpProductionPlansTable).orderBy(desc(erpProductionPlansTable.period))));
r.post("/erp/production-plans",requireErpMenu("/manufacturing/plans"),async(q,s)=>{try{const[x]=await db.insert(erpProductionPlansTable).values(clean(q.body,["period","productId","plannedQuantity","notes"]) as any).returning();s.status(201).json(x)}catch(e){s.status(unique(e)?409:500).json({error:unique(e)?"該月份品項已有計畫":"建立失敗"})}});
r.patch("/erp/production-plans/:id",requireErpMenu("/manufacturing/plans"),async(q,s)=>{try{const[x]=await db.update(erpProductionPlansTable).set(clean(q.body,["period","productId","plannedQuantity","notes"])).where(eq(erpProductionPlansTable.id,Number(q.params.id))).returning();x?s.json(x):s.status(404).json({error:"找不到計畫"})}catch(e){s.status(409).json({error:"該月份品項已有計畫"})}});
export default r;