import { Router, type IRouter } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, erpAssetsTable, erpAssetDepreciationsTable, erpAssetMaintenancesTable } from "@workspace/db";
import { requireErpMenu } from "../middlewares/requireErp";
import { autoPost, postAssetDepreciation } from "../lib/erpAutoPost";
const router: IRouter=Router(), LIST="/assets/list", DEP="/assets/depreciation";
const clean=(b:any,f:string[])=>Object.fromEntries(f.filter(x=>b[x]!==undefined).map(x=>[x,b[x]]));
const unique=(e:unknown)=>(e as any)?.cause?.code==="23505";
const day=()=>new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Taipei"}).format(new Date());
router.get("/erp/assets",requireErpMenu(LIST),async(_q,r)=>r.json(await db.select().from(erpAssetsTable).orderBy(desc(erpAssetsTable.createdAt))));
router.post("/erp/assets",requireErpMenu(LIST),async(q,r)=>{
 if(!q.body.name?.trim()||!Number.isInteger(q.body.cost)||q.body.cost<0||!Number.isInteger(q.body.usefulLifeMonths)||q.body.usefulLifeMonths<=0)return void r.status(400).json({error:"名稱、成本及耐用月數格式錯誤"});
 const prefix=`AS-${day().replaceAll("-","")}`;for(let a=0;a<5;a++){const x=await db.execute(sql`select count(*)::int n from erp_assets where asset_no like ${prefix+"-%"}`);try{const[row]=await db.insert(erpAssetsTable).values({...clean(q.body,["name","category","purchaseDate","cost","salvageValue","usefulLifeMonths","depreciationMethod","status","locationNote","custodianId","notes"]),assetNo:`${prefix}-${String(Number((x.rows??x)[0]?.n||0)+1+a).padStart(4,"0")}`} as any).returning();return void r.status(201).json(row)}catch(e){if(!unique(e)||a===4)throw e}}
});
router.patch("/erp/assets/:id",requireErpMenu(LIST),async(q,r)=>{const[row]=await db.update(erpAssetsTable).set(clean(q.body,["name","category","purchaseDate","cost","salvageValue","usefulLifeMonths","status","locationNote","custodianId","notes"])).where(eq(erpAssetsTable.id,Number(q.params.id))).returning();row?r.json(row):r.status(404).json({error:"找不到資產"})});
router.get("/erp/assets/:id/maintenances",requireErpMenu(LIST),async(q,r)=>r.json(await db.select().from(erpAssetMaintenancesTable).where(eq(erpAssetMaintenancesTable.assetId,Number(q.params.id))).orderBy(desc(erpAssetMaintenancesTable.maintenanceDate))));
router.post("/erp/assets/:id/maintenances",requireErpMenu(LIST),async(q,r)=>{if(!q.body.maintenanceDate||!["routine","repair"].includes(q.body.type)||!Number.isInteger(q.body.cost))return void r.status(400).json({error:"保養資料格式錯誤"});const[row]=await db.insert(erpAssetMaintenancesTable).values({...clean(q.body,["maintenanceDate","type","cost","vendor","notes"]),assetId:Number(q.params.id)} as any).returning();r.status(201).json(row)});
router.get("/erp/assets/depreciations",requireErpMenu(DEP),async(_q,r)=>r.json(await db.select().from(erpAssetDepreciationsTable).orderBy(desc(erpAssetDepreciationsTable.period),desc(erpAssetDepreciationsTable.id))));
router.post("/erp/assets/depreciations/run",requireErpMenu(DEP),async(q,r)=>{
 const period=String(q.body.period||"");if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(period))return void r.status(400).json({error:"期間格式須為 YYYY-MM"});
 const assets=await db.select().from(erpAssetsTable).where(eq(erpAssetsTable.status,"active"));const created=[];
 for(const asset of assets){const[existing]=await db.select().from(erpAssetDepreciationsTable).where(and(eq(erpAssetDepreciationsTable.assetId,asset.id),eq(erpAssetDepreciationsTable.period,period))).limit(1);if(existing){autoPost(`資產折舊補帳 ${asset.id}-${period}`,()=>postAssetDepreciation(existing.id));continue}const[s]=await db.select({total:sql<number>`coalesce(sum(${erpAssetDepreciationsTable.amount}),0)::int`,count:sql<number>`count(*)::int`}).from(erpAssetDepreciationsTable).where(eq(erpAssetDepreciationsTable.assetId,asset.id));const depreciable=Math.max(0,asset.cost-asset.salvageValue),remaining=depreciable-Number(s?.total||0),count=Number(s?.count||0);if(remaining<=0||count>=asset.usefulLifeMonths)continue;const amount=count===asset.usefulLifeMonths-1?remaining:Math.min(remaining,Math.round(depreciable/asset.usefulLifeMonths));if(amount<=0)continue;try{const[row]=await db.insert(erpAssetDepreciationsTable).values({assetId:asset.id,period,amount}).returning();created.push(row);autoPost(`資產折舊 ${asset.id}-${period}`,()=>postAssetDepreciation(row.id))}catch(e){if(!unique(e))throw e}}
 r.json({period,createdCount:created.length,items:created});
});
export default router;