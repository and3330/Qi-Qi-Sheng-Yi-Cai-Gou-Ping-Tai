import OpenAI from "openai";
import { and, eq, inArray, sql, desc } from "drizzle-orm";
import {
  db,
  aiDocumentsTable,
  productsTable,
  productVariantsTable,
  ordersTable,
  orderItemsTable,
  membersTable,
  institutionsTable,
  articlesTable,
  announcementsTable,
  profitShareRecordsTable,
} from "@workspace/db";

/**
 * AI 知識庫索引（RAG 底層）
 * - 有 OPENAI_API_KEY：內容向量化（text-embedding-3-small, 1536 維），語意檢索
 * - 無金鑰：embedding 為 null，檢索自動退回關鍵字比對（ILIKE）
 * 資料新增／修改時由各路由呼叫 reindex()（非同步、不阻塞回應）
 */

const embeddingClient = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

export function embeddingEnabled() {
  return embeddingClient != null;
}

async function embed(text: string): Promise<number[] | null> {
  if (!embeddingClient) return null;
  const res = await embeddingClient.embeddings.create({
    model: "text-embedding-3-small",
    input: text.slice(0, 8000),
  });
  return res.data[0].embedding;
}

type DocInput = {
  entityKind: string;
  entityId: number;
  title: string;
  content: string;
  metadata?: Record<string, unknown>;
  scope?: "staff" | "public";
  institutionId?: number | null;
};

async function upsertDoc(doc: DocInput) {
  const embedding = await embed(`${doc.title}\n${doc.content}`);
  await db
    .insert(aiDocumentsTable)
    .values({
      entityKind: doc.entityKind,
      entityId: doc.entityId,
      title: doc.title,
      content: doc.content,
      metadata: doc.metadata ?? {},
      scope: doc.scope ?? "staff",
      institutionId: doc.institutionId ?? null,
      embedding,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [aiDocumentsTable.entityKind, aiDocumentsTable.entityId],
      set: {
        title: doc.title,
        content: doc.content,
        metadata: doc.metadata ?? {},
        scope: doc.scope ?? "staff",
        institutionId: doc.institutionId ?? null,
        embedding,
        updatedAt: new Date(),
      },
    });
}

async function removeDoc(entityKind: string, entityId: number) {
  await db
    .delete(aiDocumentsTable)
    .where(
      and(
        eq(aiDocumentsTable.entityKind, entityKind),
        eq(aiDocumentsTable.entityId, entityId),
      ),
    );
}

// ---------- 各實體的文件產生器 ----------

async function buildProductDoc(id: number): Promise<DocInput | null> {
  const [p] = await db.select().from(productsTable).where(eq(productsTable.id, id)).limit(1);
  if (!p) return null;
  const variants = await db
    .select()
    .from(productVariantsTable)
    .where(eq(productVariantsTable.productId, id));
  const vText = variants.length
    ? "規格：" +
      variants
        .map(
          (v) =>
            `${v.name}（variantId=${v.id}，醫院價 ${v.priceHospital}／診所價 ${v.priceClinic}／消費者價 ${v.priceConsumer}，庫存 ${v.stock}${v.isActive ? "" : "，停售"}）`,
        )
        .join("；")
    : `庫存 ${p.stock}`;
  return {
    entityKind: "product",
    entityId: id,
    title: `商品：${p.name}（${p.code}）`,
    content: `分類：${p.category}。${p.description ?? ""}。醫院價 ${p.priceHospital}／診所價 ${p.priceClinic}／消費者價 ${p.priceConsumer}，成本 ${p.costPrice}。${vText}。${p.isActive ? "上架中" : "已下架"}${p.isHot ? "，熱銷" : ""}${p.spec ? `，規格說明 ${p.spec}` : ""}`,
    metadata: { productId: id, code: p.code, stock: p.stock, isActive: p.isActive },
  };
}

async function buildOrderDoc(id: number): Promise<DocInput | null> {
  const [o] = await db.select().from(ordersTable).where(eq(ordersTable.id, id)).limit(1);
  if (!o) return null;
  const items = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, id));
  const [m] = await db
    .select({ name: membersTable.name, username: membersTable.username, tier: membersTable.tier, boundInstitutionId: membersTable.boundInstitutionId })
    .from(membersTable)
    .where(eq(membersTable.id, o.memberId))
    .limit(1);
  const itemText = items
    .map((i) => `${i.productName}${i.variantName ? `（${i.variantName}）` : ""} x${i.quantity} 單價 ${i.unitPrice}`)
    .join("；");
  return {
    entityKind: "order",
    entityId: id,
    title: `訂單 ${o.orderNo}（${o.status}）`,
    content: `會員：${m?.name ?? ""}（${m?.username ?? ""}，${m?.tier ?? ""}）。金額 ${o.totalAmount} 元，付款方式 ${o.paymentMethod}${o.walletSource ? `（${o.walletSource === "institution" ? "機構錢包" : "個人錢包"}）` : ""}。商品：${itemText}。收件人 ${o.receiverName ?? ""}，地址 ${o.shippingAddress ?? ""}。建立於 ${o.createdAt.toISOString().slice(0, 10)}。出貨照片 ${(o.shipmentPhotos ?? []).length} 張。`,
    metadata: { orderId: id, orderNo: o.orderNo, status: o.status, totalAmount: o.totalAmount, memberId: o.memberId },
    institutionId: m?.boundInstitutionId ?? null,
  };
}

async function buildMemberDoc(id: number): Promise<DocInput | null> {
  const [m] = await db.select().from(membersTable).where(eq(membersTable.id, id)).limit(1);
  if (!m) return null;
  let instName = "";
  if (m.boundInstitutionId != null) {
    const [inst] = await db
      .select({ name: institutionsTable.name })
      .from(institutionsTable)
      .where(eq(institutionsTable.id, m.boundInstitutionId))
      .limit(1);
    instName = inst?.name ?? "";
  }
  return {
    entityKind: "member",
    entityId: id,
    title: `會員：${m.name}（${m.username}）`,
    content: `身份 ${m.tier}，角色 ${m.role}，${m.isActive ? "啟用" : "停用"}。錢包餘額 ${m.walletBalance} 元，點數 ${m.points}。${m.boundInstitutionId != null ? `綁定院所：${instName}${m.boundDepartment ? `／${m.boundDepartment}` : ""}（${m.institutionVerified ? "已審核" : "待審核"}）` : "未綁定院所"}。電話 ${m.phone ?? ""}，Email ${m.email ?? ""}。`,
    metadata: { memberId: id, tier: m.tier, role: m.role },
    institutionId: m.boundInstitutionId ?? null,
  };
}

async function buildInstitutionDoc(id: number): Promise<DocInput | null> {
  const [i] = await db.select().from(institutionsTable).where(eq(institutionsTable.id, id)).limit(1);
  if (!i) return null;
  return {
    entityKind: "institution",
    entityId: id,
    title: `機構：${i.name}（${i.type}）`,
    content: `縣市 ${i.city}，地址 ${i.address ?? ""}，電話 ${i.phone ?? ""}。科室：${(i.departments ?? []).join("、")}。機構共用錢包餘額 ${i.walletBalance} 元。`,
    metadata: { institutionId: id, city: i.city, walletBalance: i.walletBalance },
    institutionId: id,
  };
}

async function buildArticleDoc(id: number): Promise<DocInput | null> {
  const [a] = await db.select().from(articlesTable).where(eq(articlesTable.id, id)).limit(1);
  if (!a) return null;
  return {
    entityKind: "article",
    entityId: id,
    title: `${a.kind === "faq" ? "FAQ" : "衛教文章"}：${a.title}`,
    content: `${a.summary ?? ""}\n${a.content}`.slice(0, 6000),
    metadata: { articleId: id, kind: a.kind, category: a.category, status: a.status },
    scope: a.status === "published" ? "public" : "staff",
  };
}

async function buildAnnouncementDoc(id: number): Promise<DocInput | null> {
  const [a] = await db.select().from(announcementsTable).where(eq(announcementsTable.id, id)).limit(1);
  if (!a) return null;
  return {
    entityKind: "announcement",
    entityId: id,
    title: `公告：${a.title}`,
    content: (a.content ?? "").slice(0, 6000),
    metadata: { announcementId: id, status: a.status },
    scope: a.status === "published" ? "public" : "staff",
  };
}

async function buildCommissionDoc(id: number): Promise<DocInput | null> {
  const [r] = await db
    .select()
    .from(profitShareRecordsTable)
    .where(eq(profitShareRecordsTable.id, id))
    .limit(1);
  if (!r) return null;
  return {
    entityKind: "commission",
    entityId: id,
    title: `佣金：訂單 ${r.orderNo}`,
    content: `規則「${r.ruleName}」（${r.percentBps / 100}%），基準 ${r.baseAmount} 元，佣金 ${r.amount} 元。${r.institutionId != null ? `歸屬機構 #${r.institutionId}${r.department ? `／${r.department}` : ""}` : "歸屬個人錢包"}。`,
    metadata: { recordId: id, orderId: r.orderId, amount: r.amount },
    institutionId: r.institutionId ?? null,
  };
}

const builders: Record<string, (id: number) => Promise<DocInput | null>> = {
  product: buildProductDoc,
  order: buildOrderDoc,
  member: buildMemberDoc,
  institution: buildInstitutionDoc,
  article: buildArticleDoc,
  announcement: buildAnnouncementDoc,
  commission: buildCommissionDoc,
};

/** 非同步重建單一實體索引（fire-and-forget，路由中呼叫，不阻塞回應） */
export function reindex(kind: keyof typeof builders | string, id: number) {
  void (async () => {
    try {
      const builder = builders[kind];
      if (!builder) return;
      const doc = await builder(id);
      if (doc) await upsertDoc(doc);
      else await removeDoc(kind, id);
    } catch (err) {
      console.error(`[aiIndex] reindex ${kind}#${id} failed:`, err);
    }
  })();
}

export function removeFromIndex(kind: string, id: number) {
  void removeDoc(kind, id).catch((err) =>
    console.error(`[aiIndex] remove ${kind}#${id} failed:`, err),
  );
}

/** 全量回填（歷史資料一次性建索引） */
export async function backfillAll(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const jobs: Array<[string, number[]]> = [
    ["product", (await db.select({ id: productsTable.id }).from(productsTable)).map((r) => r.id)],
    ["order", (await db.select({ id: ordersTable.id }).from(ordersTable)).map((r) => r.id)],
    ["member", (await db.select({ id: membersTable.id }).from(membersTable)).map((r) => r.id)],
    ["institution", (await db.select({ id: institutionsTable.id }).from(institutionsTable)).map((r) => r.id)],
    ["article", (await db.select({ id: articlesTable.id }).from(articlesTable)).map((r) => r.id)],
    ["announcement", (await db.select({ id: announcementsTable.id }).from(announcementsTable)).map((r) => r.id)],
    ["commission", (await db.select({ id: profitShareRecordsTable.id }).from(profitShareRecordsTable)).map((r) => r.id)],
  ];
  for (const [kind, ids] of jobs) {
    let ok = 0;
    for (const id of ids) {
      try {
        const doc = await builders[kind](id);
        if (doc) {
          await upsertDoc(doc);
          ok++;
        }
      } catch (err) {
        console.error(`[aiIndex] backfill ${kind}#${id} failed:`, err);
      }
    }
    counts[kind] = ok;
  }
  return counts;
}

export type SearchOptions = {
  /** public = 只搜已發佈內容（衛教客服）；staff = 全部 */
  scope: "public" | "staff";
  kinds?: string[];
  institutionId?: number | null;
  limit?: number;
};

/** 語意檢索（有向量）或關鍵字檢索（無向量金鑰時退回） */
export async function searchDocuments(query: string, opts: SearchOptions) {
  const limit = Math.min(opts.limit ?? 8, 20);
  const conditions = [] as ReturnType<typeof eq>[];
  if (opts.scope === "public") conditions.push(eq(aiDocumentsTable.scope, "public"));
  if (opts.kinds?.length) conditions.push(inArray(aiDocumentsTable.entityKind, opts.kinds));

  const queryEmbedding = await embed(query).catch(() => null);
  if (queryEmbedding) {
    const distance = sql<number>`${aiDocumentsTable.embedding} <=> ${JSON.stringify(queryEmbedding)}::vector`;
    const rows = await db
      .select({
        entityKind: aiDocumentsTable.entityKind,
        entityId: aiDocumentsTable.entityId,
        title: aiDocumentsTable.title,
        content: aiDocumentsTable.content,
        metadata: aiDocumentsTable.metadata,
        distance,
      })
      .from(aiDocumentsTable)
      .where(and(sql`${aiDocumentsTable.embedding} IS NOT NULL`, ...conditions))
      .orderBy(distance)
      .limit(limit);
    if (rows.length) return rows;
  }
  // 關鍵字退回：拆詞後 ILIKE；中文問句再拆成雙字詞提升命中率
  const rawTerms = query
    .split(/[\s,，、。;；?？!！:：()（）]+/)
    .filter((t) => t.length >= 2);
  const bigrams: string[] = [];
  for (const t of rawTerms) {
    if (/[\u4e00-\u9fff]/.test(t) && t.length > 3) {
      for (let i = 0; i + 2 <= t.length; i++) bigrams.push(t.slice(i, i + 2));
    }
  }
  const stopwords = new Set(["怎麼", "什麼", "如何", "可以", "請問", "有沒", "沒有", "哪些", "我們", "你們", "的嗎", "是不", "不是", "需要", "應該"]);
  const terms = [...new Set([...rawTerms, ...bigrams])]
    .filter((t) => !stopwords.has(t))
    .slice(0, 12);
  const like = terms.length
    ? sql.join(
        terms.map(
          (t) => sql`(${aiDocumentsTable.title} ILIKE ${"%" + t + "%"} OR ${aiDocumentsTable.content} ILIKE ${"%" + t + "%"})`,
        ),
        sql` OR `,
      )
    : sql`TRUE`;
  // 相關度 = 命中詞數（標題命中加權 2）
  const score = terms.length
    ? sql<number>`(${sql.join(
        terms.map(
          (t) =>
            sql`(CASE WHEN ${aiDocumentsTable.title} ILIKE ${"%" + t + "%"} THEN 2 WHEN ${aiDocumentsTable.content} ILIKE ${"%" + t + "%"} THEN 1 ELSE 0 END)`,
        ),
        sql` + `,
      )})`
    : sql<number>`0`;
  return db
    .select({
      entityKind: aiDocumentsTable.entityKind,
      entityId: aiDocumentsTable.entityId,
      title: aiDocumentsTable.title,
      content: aiDocumentsTable.content,
      metadata: aiDocumentsTable.metadata,
      distance: sql<number>`0`,
    })
    .from(aiDocumentsTable)
    .where(and(sql`(${like})`, ...conditions))
    .orderBy(desc(score), desc(aiDocumentsTable.updatedAt))
    .limit(limit);
}
