import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import {
  db,
  socialMarketingAccountsTable,
  socialPostsTable,
  type SocialPost,
} from "@workspace/db";
import {
  CreateSocialPostBody,
  UpdateSocialPostBody,
  PreviewSocialPostBody,
  GenerateSocialContentBody,
  GenerateSocialImageBody,
  SocialAiPlannerBody,
  BatchCreateSocialPostsBody,
} from "@workspace/api-zod";
import { requireOps } from "../middlewares/requireMember";
import {
  adaptContentForPlatform,
  getOAuthUrl,
  getRedirectUri,
  handleOAuthCallback,
  platformCredentialStatus,
  publishPost,
  PLATFORM_CHAR_LIMITS,
  SUPPORTED_PLATFORMS,
  upsertAccounts,
} from "../lib/socialService";
import {
  generateSocialContent,
  generateSocialImage,
  runContentPlanner,
} from "../lib/socialAi";

const router: IRouter = Router();

const OAUTH_PLATFORMS = ["facebook", "threads", "twitter"];

function serializeAccount(a: typeof socialMarketingAccountsTable.$inferSelect) {
  return {
    id: a.id,
    platform: a.platform,
    platformAccountId: a.platformAccountId,
    accountName: a.accountName,
    accountType: a.accountType,
    tokenExpiresAt: a.tokenExpiresAt ? a.tokenExpiresAt.toISOString() : null,
    profileImageUrl: a.profileImageUrl,
    isActive: a.isActive,
    createdAt: a.createdAt.toISOString(),
  };
}

function serializePost(p: SocialPost) {
  return {
    id: p.id,
    content: p.content,
    platforms: p.platforms,
    hashtags: p.hashtags,
    imageUrls: p.imageUrls ?? [],
    scheduledAt: p.scheduledAt ? p.scheduledAt.toISOString() : null,
    publishedAt: p.publishedAt ? p.publishedAt.toISOString() : null,
    status: p.status,
    platformResults: p.platformResults as Record<string, unknown> | null,
    targetAccountIds: (p.targetAccountIds ?? {}) as Record<string, string>,
    errorMessage: p.errorMessage,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

// ---------- 社群帳號 ----------

router.get("/admin/social-accounts", requireOps, async (_req, res) => {
  const rows = await db
    .select()
    .from(socialMarketingAccountsTable)
    .orderBy(desc(socialMarketingAccountsTable.createdAt));
  res.json({
    accounts: rows.map(serializeAccount),
    credentials: platformCredentialStatus(),
  });
});

router.get("/admin/social-accounts/oauth-url/:platform", requireOps, async (req, res) => {
  const platform = String(req.params.platform);
  if (!OAUTH_PLATFORMS.includes(platform)) {
    res.status(400).json({ error: "不支援的平台" });
    return;
  }
  try {
    const url = getOAuthUrl(platform, getRedirectUri(platform), req.sessionID);
    res.json({ url });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.get("/admin/social-accounts/oauth-callback/:platform", requireOps, async (req, res) => {
  const platform = String(req.params.platform);
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const state = typeof req.query.state === "string" ? req.query.state : "";
  const backTo = "/admin/social-accounts";
  if (!OAUTH_PLATFORMS.includes(platform) || !code || !state) {
    res.redirect(`${backTo}?error=${encodeURIComponent("授權失敗：缺少授權碼或驗證狀態")}`);
    return;
  }
  try {
    const { accounts } = await handleOAuthCallback(
      platform,
      code,
      getRedirectUri(platform),
      state,
      req.sessionID,
    );
    const saved = await upsertAccounts(accounts);
    res.redirect(`${backTo}?connected=${platform}&count=${saved.length}`);
  } catch (err) {
    req.log.error({ err }, "social oauth callback failed");
    res.redirect(`${backTo}?error=${encodeURIComponent((err as Error).message)}`);
  }
});

router.patch("/admin/social-accounts/:id/toggle", requireOps, async (req, res) => {
  const [row] = await db
    .select()
    .from(socialMarketingAccountsTable)
    .where(eq(socialMarketingAccountsTable.id, String(req.params.id)))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "找不到此帳號" });
    return;
  }
  const [updated] = await db
    .update(socialMarketingAccountsTable)
    .set({ isActive: !row.isActive, updatedAt: new Date() })
    .where(eq(socialMarketingAccountsTable.id, row.id))
    .returning();
  res.json(serializeAccount(updated));
});

router.delete("/admin/social-accounts/:id", requireOps, async (req, res) => {
  const deleted = await db
    .delete(socialMarketingAccountsTable)
    .where(eq(socialMarketingAccountsTable.id, String(req.params.id)))
    .returning({ id: socialMarketingAccountsTable.id });
  if (!deleted.length) {
    res.status(404).json({ error: "找不到此帳號" });
    return;
  }
  res.status(204).end();
});

// ---------- 貼文 ----------

router.get("/admin/social-posts", requireOps, async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const rows = await db
    .select()
    .from(socialPostsTable)
    .where(status ? eq(socialPostsTable.status, status) : undefined)
    .orderBy(desc(socialPostsTable.createdAt))
    .limit(200);
  res.json(rows.map(serializePost));
});

function validatePlatforms(platforms: string[]): string | null {
  if (!platforms.length) return "請至少選擇一個平台";
  for (const p of platforms) {
    if (!SUPPORTED_PLATFORMS.includes(p)) return `不支援的平台: ${p}`;
  }
  return null;
}

async function validateTargetAccounts(
  platforms: string[],
  targetAccountIds: Record<string, string> | undefined,
  requireAll: boolean,
): Promise<string | null> {
  for (const platform of platforms) {
    const accountId = targetAccountIds?.[platform];
    if (!accountId) {
      if (requireAll) return `請指定 ${platform} 的發布帳號`;
      continue;
    }
    const [account] = await db
      .select({ id: socialMarketingAccountsTable.id })
      .from(socialMarketingAccountsTable)
      .where(
        and(
          eq(socialMarketingAccountsTable.id, accountId),
          eq(socialMarketingAccountsTable.platform, platform),
          eq(socialMarketingAccountsTable.isActive, true),
        ),
      )
      .limit(1);
    if (!account) return `${platform} 的發布帳號無效或已停用`;
  }
  return null;
}

router.post("/admin/social-posts", requireOps, async (req, res) => {
  const parsed = CreateSocialPostBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "貼文資料不完整" });
    return;
  }
  const { content, platforms, hashtags, imageUrls, scheduledAt, targetAccountIds } =
    parsed.data;
  const platformError = validatePlatforms(platforms);
  if (platformError) {
    res.status(400).json({ error: platformError });
    return;
  }
  if (platforms.includes("instagram") && !imageUrls?.length) {
    res.status(400).json({ error: "Instagram 發文必須附圖片" });
    return;
  }
  const targetError = await validateTargetAccounts(
    platforms,
    targetAccountIds,
    Boolean(scheduledAt),
  );
  if (targetError) {
    res.status(400).json({ error: targetError });
    return;
  }
  const scheduled = scheduledAt ? new Date(scheduledAt) : null;
  const [row] = await db
    .insert(socialPostsTable)
    .values({
      content,
      platforms,
      hashtags: hashtags ?? null,
      imageUrls: imageUrls ?? [],
      targetAccountIds: targetAccountIds ?? {},
      scheduledAt: scheduled,
      status: scheduled ? "scheduled" : "draft",
      updatedAt: new Date(),
    })
    .returning();
  res.status(201).json(serializePost(row));
});

router.patch("/admin/social-posts/:id", requireOps, async (req, res) => {
  const parsed = UpdateSocialPostBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "貼文資料不完整" });
    return;
  }
  const [existing] = await db
    .select()
    .from(socialPostsTable)
    .where(eq(socialPostsTable.id, String(req.params.id)))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "找不到此貼文" });
    return;
  }
  if (existing.status === "published") {
    res.status(400).json({ error: "已發布的貼文無法編輯" });
    return;
  }
  const { content, platforms, hashtags, imageUrls, scheduledAt, targetAccountIds } =
    parsed.data;
  if (platforms) {
    const platformError = validatePlatforms(platforms);
    if (platformError) {
      res.status(400).json({ error: platformError });
      return;
    }
  }
  const nextPlatforms = platforms ?? existing.platforms;
  const nextImages = imageUrls ?? existing.imageUrls ?? [];
  if (nextPlatforms.includes("instagram") && !nextImages.length) {
    res.status(400).json({ error: "Instagram 發文必須附圖片" });
    return;
  }
  const nextTargets =
    targetAccountIds ??
    ((existing.targetAccountIds ?? {}) as Record<string, string>);
  const nextScheduledAt =
    scheduledAt !== undefined
      ? scheduledAt
        ? new Date(scheduledAt)
        : null
      : existing.scheduledAt;
  const targetError = await validateTargetAccounts(
    nextPlatforms,
    nextTargets,
    Boolean(nextScheduledAt),
  );
  if (targetError) {
    res.status(400).json({ error: targetError });
    return;
  }
  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (content !== undefined) update.content = content;
  if (platforms !== undefined) update.platforms = platforms;
  if (hashtags !== undefined) update.hashtags = hashtags;
  if (imageUrls !== undefined) update.imageUrls = imageUrls;
  if (targetAccountIds !== undefined) update.targetAccountIds = targetAccountIds;
  if (scheduledAt !== undefined) {
    const scheduled = scheduledAt ? new Date(scheduledAt) : null;
    update.scheduledAt = scheduled;
    update.status = scheduled ? "scheduled" : "draft";
  }
  const [row] = await db
    .update(socialPostsTable)
    .set(update)
    .where(eq(socialPostsTable.id, String(req.params.id)))
    .returning();
  res.json(serializePost(row));
});

router.delete("/admin/social-posts/:id", requireOps, async (req, res) => {
  const deleted = await db
    .delete(socialPostsTable)
    .where(eq(socialPostsTable.id, String(req.params.id)))
    .returning({ id: socialPostsTable.id });
  if (!deleted.length) {
    res.status(404).json({ error: "找不到此貼文" });
    return;
  }
  res.status(204).end();
});

router.post("/admin/social-posts/:id/publish", requireOps, async (req, res) => {
  const [post] = await db
    .select()
    .from(socialPostsTable)
    .where(eq(socialPostsTable.id, String(req.params.id)))
    .limit(1);
  if (!post) {
    res.status(404).json({ error: "找不到此貼文" });
    return;
  }
  if (post.status === "published") {
    res.status(400).json({ error: "貼文已發布" });
    return;
  }
  const targetError = await validateTargetAccounts(
    post.platforms,
    (post.targetAccountIds ?? {}) as Record<string, string>,
    true,
  );
  if (targetError) {
    res.status(400).json({ error: targetError });
    return;
  }
  try {
    const { results, errors } = await publishPost(post.id);
    const [updated] = await db
      .select()
      .from(socialPostsTable)
      .where(eq(socialPostsTable.id, post.id))
      .limit(1);
    res.json({ post: serializePost(updated), results, errors });
  } catch (err) {
    req.log.error({ err }, "publish post failed");
    res.status(500).json({ error: (err as Error).message });
  }
});

// ---------- 預覽 ----------

router.post("/admin/social-posts/preview", requireOps, async (req, res) => {
  const parsed = PreviewSocialPostBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "資料不完整" });
    return;
  }
  const { content, hashtags, platforms } = parsed.data;
  const previews = (platforms.length ? platforms : SUPPORTED_PLATFORMS).map((platform) => ({
    platform,
    charLimit: PLATFORM_CHAR_LIMITS[platform] ?? 500,
    text: adaptContentForPlatform(content, platform, hashtags ?? undefined),
  }));
  res.json({ previews });
});

// ---------- AI ----------

router.post("/admin/social-posts/generate-content", requireOps, async (req, res) => {
  const parsed = GenerateSocialContentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "請提供主題" });
    return;
  }
  try {
    const result = await generateSocialContent({ ...parsed.data, tone: parsed.data.tone ?? undefined });
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "generate content failed");
    res.status(502).json({ error: "AI 文案產生失敗，請稍後再試" });
  }
});

router.post("/admin/social-posts/generate-image", requireOps, async (req, res) => {
  const parsed = GenerateSocialImageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "請提供圖片描述" });
    return;
  }
  try {
    const result = await generateSocialImage(parsed.data.prompt);
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "generate image failed");
    res.status(502).json({ error: "AI 圖片產生失敗，請稍後再試" });
  }
});

router.post("/admin/social-posts/ai-planner", requireOps, async (req, res) => {
  const parsed = SocialAiPlannerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "訊息不可為空" });
    return;
  }
  try {
    const { reply, plan } = await runContentPlanner(parsed.data.messages);
    res.json({ reply, plan });
  } catch (err) {
    req.log.error({ err }, "ai planner failed");
    res.status(502).json({ error: "AI 服務暫時無法回應，請稍後再試" });
  }
});

router.post("/admin/social-posts/batch-create", requireOps, async (req, res) => {
  const parsed = BatchCreateSocialPostsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "計畫資料不完整" });
    return;
  }
  const created: SocialPost[] = [];
  const skipped: string[] = [];
  for (const item of parsed.data.posts) {
    const platformError = validatePlatforms(item.platforms);
    if (platformError) {
      skipped.push(`${item.content.slice(0, 20)}…: ${platformError}`);
      continue;
    }
    if (item.platforms.includes("instagram") && !item.imageUrls?.length) {
      skipped.push(`${item.content.slice(0, 20)}…: Instagram 發文必須附圖片`);
      continue;
    }
    const targetError = await validateTargetAccounts(
      item.platforms,
      item.targetAccountIds,
      Boolean(item.scheduledAt),
    );
    if (targetError) {
      skipped.push(`${item.content.slice(0, 20)}…: ${targetError}`);
      continue;
    }
    const scheduled = item.scheduledAt ? new Date(item.scheduledAt) : null;
    if (scheduled && Number.isNaN(scheduled.getTime())) {
      skipped.push(`${item.content.slice(0, 20)}…: 排程時間格式錯誤`);
      continue;
    }
    const [row] = await db
      .insert(socialPostsTable)
      .values({
        content: item.content,
        platforms: item.platforms,
        hashtags: item.hashtags ?? null,
        imageUrls: item.imageUrls ?? [],
        targetAccountIds: item.targetAccountIds ?? {},
        scheduledAt: scheduled,
        status: scheduled ? "scheduled" : "draft",
        updatedAt: new Date(),
      })
      .returning();
    created.push(row);
  }
  res.status(201).json({ posts: created.map(serializePost), skipped });
});

export default router;
