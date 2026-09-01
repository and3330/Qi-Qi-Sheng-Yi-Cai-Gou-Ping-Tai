import { Router, type IRouter } from "express";
import { desc, eq, sql } from "drizzle-orm";
import { db, erpCapasTable, erpInspectionsTable, erpNonconformancesTable } from "@workspace/db";
import { requireErpMenu } from "../middlewares/requireErp";
const r:IRouter=Router(),u=(e:unknown)=>(e as any)?.cause?.code==="23505",c=(b:any,f:string[])=>Object.fromEntries(f.filter(x=>b[x]!==undefined).map(x=>[x,b[x]]));
const d=()=>new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Taipei"}).format(new Date()).replaceAll("-","");
async function numbered(table:any,col:any,key:string,prefix:string,values:any){for(let a=0;a<5;a++){const z=await db.execute(sql`select count(*)::int n from ${table} where ${col} like ${prefix+"-%"}`);try{const rows:any=await db.insert(table).values({...values,[key]:`${prefix}-${String(Number((z.rows??z)[0]?.n||0)+1+a).padStart(4,"0")}`}).returning();return rows[0]}catch(e){if(!u(e)||a===4)throw e}}}
const defs:any=[
 {base:"inspections",menu:"/quality/inspections",table:erpInspectionsTable,col:erpInspectionsTable.inspectionNo,key:"inspectionNo",prefix:"QI",fields:["type","refType","refId","productId","sampleSize","passedQty","failedQty","result","inspectorId","inspectedAt","notes"],required:(b:any)=>Number(b.productId)>0},
 {base:"nonconformances",menu:"/quality/nonconformances",table:erpNonconformancesTable,col:erpNonconformancesTable.ncNo,key:"ncNo",prefix:"NC",fields:["inspectionId","productId","description","severity","status","disposition","closedAt"],required:(b:any)=>!!b.description?.trim()},
 {base:"capas",menu:"/quality/capas",table:erpCapasTable,col:erpCapasTable.capaNo,key:"capaNo",prefix:"CA",fields:["nonconformanceId","type","rootCause","actionPlan","ownerId","dueDate","status","verifiedAt"],required:(b:any)=>!!b.rootCause?.trim()&&!!b.actionPlan?.trim()},
];
for(const x of defs){r.get(`/erp/quality/${x.base}`,requireErpMenu(x.menu),async(_q,s)=>s.json(await db.select().from(x.table).orderBy(desc(x.table.id))));r.post(`/erp/quality/${x.base}`,requireErpMenu(x.menu),async(q,s)=>{if(!x.required(q.body))return void s.status(400).json({error:"必填欄位不足"});s.status(201).json(await numbered(x.table,x.col,x.key,`${x.prefix}-${d()}`,c(q.body,x.fields)))});r.patch(`/erp/quality/${x.base}/:id`,requireErpMenu(x.menu),async(q,s)=>{const[row]=await db.update(x.table).set(c(q.body,x.fields)).where(eq(x.table.id,Number(q.params.id))).returning();row?s.json(row):s.status(404).json({error:"找不到資料"})})}
export default r;