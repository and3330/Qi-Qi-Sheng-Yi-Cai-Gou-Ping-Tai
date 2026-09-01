/**
 * 社群行銷核心服務：
 * - OAuth 授權 URL / callback（Facebook+IG、Threads、Twitter PKCE）
 * - Token 自動刷新
 * - 各平台發布（Threads 兩段式、IG 需圖片、FB feed/photo、X tweets）
 * - 平台字數裁切 + hashtag
 * - 貼文發布主流程與排程處理
 */
import crypto from "node:crypto";
import { and, eq, inArray, lte } from "drizzle-orm";
import {
  db,
  socialMarketingAccountsTable,
  socialPostsTable,
  type SocialMarketingAccount,
} from "@workspace/db";

// ========== 公開網域 ==========
export function getPublicBaseUrl(): string {
  const domains = process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
  const domain = domains || process.env.REPLIT_DEV_DOMAIN;
  if (!domain) throw new Error("無法取得公開網域（REPLIT_DOMAINS 未設定）");
  return `https://${domain}`;
}

export function getRedirectUri(platform: string): string {
  return `${getPublicBaseUrl()}/api/admin/social-accounts/oauth-callback/${platform}`;
}

// ========== 平台憑證狀態 ==========
export function platformCredentialStatus() {
  return {
    facebook: !!(process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET),
    threads: !!(process.env.THREADS_APP_ID && process.env.THREADS_APP_SECRET),
    twitter: !!(process.env.TWITTER_CLIENT_ID && process.env.TWITTER_CLIENT_SECRET),
  };
}

// ========== OAuth state / Twitter PKCE 暫存 ==========
type OAuthStateEntry = {
  platform: string;
  sessionId: string;
  codeVerifier?: string;
  createdAt: number;
};

const oauthStateStore = new Map<string, OAuthStateEntry>();
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of oauthStateStore) {
    if (now - val.createdAt > 10 * 60 * 1000) oauthStateStore.delete(key);
  }
}, 60000).unref?.();

function createOAuthState(
  platform: string,
  sessionId: string,
  codeVerifier?: string,
): string {
  const state = crypto.randomBytes(32).toString("base64url");
  oauthStateStore.set(state, {
    platform,
    sessionId,
    codeVerifier,
    createdAt: Date.now(),
  });
  return state;
}

function consumeOAuthState(
  state: string,
  platform: string,
  sessionId: string,
): OAuthStateEntry {
  const entry = oauthStateStore.get(state);
  oauthStateStore.delete(state);
  if (
    !entry ||
    entry.platform !== platform ||
    entry.sessionId !== sessionId ||
    Date.now() - entry.createdAt > 10 * 60 * 1000
  ) {
    throw new Error("OAuth state 無效或已過期，請重新授權");
  }
  return entry;
}

// ========== 平台字數限制 ==========
export const PLATFORM_CHAR_LIMITS: Record<string, number> = {
  threads: 500,
  facebook: 5000,
  instagram: 2200,
  twitter: 280,
};

export const SUPPORTED_PLATFORMS = ["facebook", "instagram", "threads", "twitter"];

// ========== 文字處理工具 ==========
export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<li>/gi, "・ ")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function adaptContentForPlatform(
  content: string,
  platform: string,
  hashtags?: string,
): string {
  const limit = PLATFORM_CHAR_LIMITS[platform] || 500;
  let text = stripHtml(content);
  const hashtagStr = hashtags
    ? `\n\n${hashtags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
        .map((t) => (t.startsWith("#") ? t : `#${t}`))
        .join(" ")}`
    : "";
  const availableLen = limit - hashtagStr.length;
  if (text.length > availableLen) text = text.substring(0, Math.max(0, availableLen - 3)) + "...";
  return text + hashtagStr;
}

// ========== OAuth URL 產生 ==========
export function getOAuthUrl(
  platform: string,
  redirectUri: string,
  sessionId: string,
): string {
  switch (platform) {
    case "facebook": {
      const appId = process.env.FACEBOOK_APP_ID;
      if (!appId) throw new Error("尚未設定 FACEBOOK_APP_ID / FACEBOOK_APP_SECRET");
      const scopes =
        "pages_manage_posts,pages_read_engagement,pages_show_list,business_management,instagram_basic,instagram_content_publish";
      const state = createOAuthState(platform, sessionId);
      return `https://www.facebook.com/v21.0/dialog/oauth?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scopes}&response_type=code&state=${encodeURIComponent(state)}`;
    }
    case "threads": {
      const appId = process.env.THREADS_APP_ID;
      if (!appId) throw new Error("尚未設定 THREADS_APP_ID / THREADS_APP_SECRET");
      const scopes = "threads_basic,threads_content_publish";
      const state = createOAuthState(platform, sessionId);
      return `https://threads.net/oauth/authorize?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scopes}&response_type=code&state=${encodeURIComponent(state)}`;
    }
    case "twitter": {
      const clientId = process.env.TWITTER_CLIENT_ID;
      if (!clientId) throw new Error("尚未設定 TWITTER_CLIENT_ID / TWITTER_CLIENT_SECRET");
      const scopes = "tweet.read tweet.write users.read offline.access";
      const codeVerifier = crypto.randomBytes(32).toString("base64url");
      const codeChallenge = crypto
        .createHash("sha256")
        .update(codeVerifier)
        .digest("base64url");
      const state = createOAuthState(platform, sessionId, codeVerifier);
      return `https://twitter.com/i/oauth2/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scopes)}&state=${encodeURIComponent(state)}&code_challenge=${codeChallenge}&code_challenge_method=S256`;
    }
    default:
      throw new Error(`不支援的平台: ${platform}`);
  }
}

// ========== OAuth Callback 處理 ==========
type OAuthAccount = {
  platform: string;
  platformAccountId: string;
  accountName: string;
  accountType: string;
  accessToken: string;
  refreshToken?: string;
  tokenExpiresAt?: Date;
  profileImageUrl?: string;
  metadata?: Record<string, unknown>;
};

export async function handleOAuthCallback(
  platform: string,
  code: string,
  redirectUri: string,
  state: string,
  sessionId: string,
): Promise<{ accounts: OAuthAccount[] }> {
  const stateEntry = consumeOAuthState(state, platform, sessionId);
  switch (platform) {
    case "facebook":
      return handleFacebookCallback(code, redirectUri);
    case "threads":
      return handleThreadsCallback(code, redirectUri);
    case "twitter": {
      if (!stateEntry.codeVerifier) {
        throw new Error("OAuth PKCE 驗證資料遺失，請重新授權");
      }
      return handleTwitterCallback(code, redirectUri, stateEntry.codeVerifier);
    }
    default:
      throw new Error(`不支援的平台: ${platform}`);
  }
}

async function handleFacebookCallback(code: string, redirectUri: string) {
  const appId = process.env.FACEBOOK_APP_ID;
  const appSecret = process.env.FACEBOOK_APP_SECRET;
  if (!appId || !appSecret) throw new Error("Facebook 憑證未設定");
  const tokenRes = await fetch(
    `https://graph.facebook.com/v21.0/oauth/access_token?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&client_secret=${appSecret}&code=${encodeURIComponent(code)}`,
  );
  const tokenData = (await tokenRes.json()) as any;
  if (tokenData.error) throw new Error(tokenData.error.message);
  // 換取長期 Token（60 天）
  const longTokenRes = await fetch(
    `https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${tokenData.access_token}`,
  );
  const longTokenData = (await longTokenRes.json()) as any;
  const userToken = longTokenData.access_token || tokenData.access_token;
  const expiresIn = longTokenData.expires_in || 5184000;
  const pagesRes = await fetch(
    `https://graph.facebook.com/v21.0/me/accounts?fields=id,name,access_token,picture&access_token=${userToken}`,
  );
  const pagesData = (await pagesRes.json()) as any;
  if (pagesData.error) throw new Error(pagesData.error.message);
  const accounts: OAuthAccount[] = [];
  for (const page of pagesData.data ?? []) {
    accounts.push({
      platform: "facebook",
      platformAccountId: page.id,
      accountName: page.name,
      accountType: "page",
      accessToken: page.access_token,
      tokenExpiresAt: new Date(Date.now() + expiresIn * 1000),
      profileImageUrl: page.picture?.data?.url,
      metadata: { pageId: page.id },
    });
    // 綁定的 IG 商業帳號
    try {
      const igRes = await fetch(
        `https://graph.facebook.com/v21.0/${page.id}?fields=instagram_business_account{id,name,username,profile_picture_url}&access_token=${page.access_token}`,
      );
      const igData = (await igRes.json()) as any;
      const ig = igData.instagram_business_account;
      if (ig) {
        accounts.push({
          platform: "instagram",
          platformAccountId: ig.id,
          accountName: ig.username || ig.name || `IG-${ig.id}`,
          accountType: "instagram_business",
          accessToken: page.access_token,
          tokenExpiresAt: new Date(Date.now() + expiresIn * 1000),
          profileImageUrl: ig.profile_picture_url,
          metadata: { igAccountId: ig.id, pageId: page.id },
        });
      }
    } catch {
      /* IG 未綁定則略過 */
    }
  }
  if (!accounts.length) throw new Error("此 Facebook 帳號沒有可管理的粉絲專頁");
  return { accounts };
}

async function handleThreadsCallback(code: string, redirectUri: string) {
  const appId = process.env.THREADS_APP_ID;
  const appSecret = process.env.THREADS_APP_SECRET;
  if (!appId || !appSecret) throw new Error("Threads 憑證未設定");
  const tokenRes = await fetch("https://graph.threads.net/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: appId,
      client_secret: appSecret,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      code,
    }),
  });
  const tokenData = (await tokenRes.json()) as any;
  if (tokenData.error)
    throw new Error(tokenData.error_message || tokenData.error?.message || "Threads 授權失敗");
  const longTokenRes = await fetch(
    `https://graph.threads.net/access_token?grant_type=th_exchange_token&client_secret=${appSecret}&access_token=${tokenData.access_token}`,
  );
  const longTokenData = (await longTokenRes.json()) as any;
  const accessToken = longTokenData.access_token || tokenData.access_token;
  const expiresIn = longTokenData.expires_in || 5184000;
  const profileRes = await fetch(
    `https://graph.threads.net/v1.0/me?fields=id,username,threads_profile_picture_url&access_token=${accessToken}`,
  );
  const profile = (await profileRes.json()) as any;
  return {
    accounts: [
      {
        platform: "threads",
        platformAccountId: String(profile.id || tokenData.user_id),
        accountName: profile.username || `Threads-${profile.id}`,
        accountType: "threads",
        accessToken,
        tokenExpiresAt: new Date(Date.now() + expiresIn * 1000),
        profileImageUrl: profile.threads_profile_picture_url,
        metadata: { userId: profile.id },
      },
    ],
  };
}

async function handleTwitterCallback(code: string, redirectUri: string, codeVerifier: string) {
  const clientId = process.env.TWITTER_CLIENT_ID;
  const clientSecret = process.env.TWITTER_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Twitter 憑證未設定");
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const tokenRes = await fetch("https://api.twitter.com/2/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basicAuth}`,
    },
    body: new URLSearchParams({
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    }),
  });
  const tokenData = (await tokenRes.json()) as any;
  if (tokenData.error) throw new Error(tokenData.error_description || tokenData.error);
  const userRes = await fetch(
    "https://api.twitter.com/2/users/me?user.fields=profile_image_url",
    { headers: { Authorization: `Bearer ${tokenData.access_token}` } },
  );
  const userData = (await userRes.json()) as any;
  return {
    accounts: [
      {
        platform: "twitter",
        platformAccountId: userData.data?.id || "unknown",
        accountName: userData.data?.username || "X User",
        accountType: "twitter",
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        tokenExpiresAt: new Date(Date.now() + (tokenData.expires_in || 7200) * 1000),
        profileImageUrl: userData.data?.profile_image_url,
        metadata: { userId: userData.data?.id },
      },
    ],
  };
}

/** OAuth 回來的帳號 upsert（同平台同帳號覆寫 token） */
export async function upsertAccounts(accounts: OAuthAccount[]) {
  const saved: SocialMarketingAccount[] = [];
  for (const acc of accounts) {
    const [row] = await db
      .insert(socialMarketingAccountsTable)
      .values({
        platform: acc.platform,
        platformAccountId: acc.platformAccountId,
        accountName: acc.accountName,
        accountType: acc.accountType,
        accessToken: acc.accessToken,
        refreshToken: acc.refreshToken ?? null,
        tokenExpiresAt: acc.tokenExpiresAt ?? null,
        profileImageUrl: acc.profileImageUrl ?? null,
        metadata: acc.metadata ?? null,
        isActive: true,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          socialMarketingAccountsTable.platform,
          socialMarketingAccountsTable.platformAccountId,
        ],
        set: {
          accountName: acc.accountName,
          accountType: acc.accountType,
          accessToken: acc.accessToken,
          refreshToken: acc.refreshToken ?? null,
          tokenExpiresAt: acc.tokenExpiresAt ?? null,
          profileImageUrl: acc.profileImageUrl ?? null,
          metadata: acc.metadata ?? null,
          isActive: true,
          updatedAt: new Date(),
        },
      })
      .returning();
    saved.push(row);
  }
  return saved;
}

// ========== Token 自動刷新 ==========
export async function refreshTokenIfNeeded(accountId: string): Promise<boolean> {
  const [account] = await db
    .select()
    .from(socialMarketingAccountsTable)
    .where(eq(socialMarketingAccountsTable.id, accountId))
    .limit(1);
  if (!account || !account.tokenExpiresAt) return true;
  if (account.tokenExpiresAt.getTime() - Date.now() > 86400000) return true;
  try {
    if (account.platform === "threads") {
      const res = await fetch(
        `https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token&access_token=${account.accessToken}`,
      );
      const data = (await res.json()) as any;
      if (data.access_token) {
        await db
          .update(socialMarketingAccountsTable)
          .set({
            accessToken: data.access_token,
            tokenExpiresAt: new Date(Date.now() + (data.expires_in || 5184000) * 1000),
            updatedAt: new Date(),
          })
          .where(eq(socialMarketingAccountsTable.id, accountId));
        return true;
      }
    } else if (account.platform === "twitter" && account.refreshToken) {
      const clientId = process.env.TWITTER_CLIENT_ID;
      const clientSecret = process.env.TWITTER_CLIENT_SECRET;
      if (!clientId || !clientSecret) return false;
      const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
      const res = await fetch("https://api.twitter.com/2/oauth2/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${basicAuth}`,
        },
        body: new URLSearchParams({
          refresh_token: account.refreshToken,
          grant_type: "refresh_token",
        }),
      });
      const data = (await res.json()) as any;
      if (data.access_token) {
        await db
          .update(socialMarketingAccountsTable)
          .set({
            accessToken: data.access_token,
            refreshToken: data.refresh_token || account.refreshToken,
            tokenExpiresAt: new Date(Date.now() + (data.expires_in || 7200) * 1000),
            updatedAt: new Date(),
          })
          .where(eq(socialMarketingAccountsTable.id, accountId));
        return true;
      }
    }
  } catch {
    /* 刷新失敗回傳 false */
  }
  return false;
}

// ========== 各平台發布 ==========
async function loadAccount(platform: string, accountId?: string) {
  if (!accountId) return undefined;
  const [account] = await db
    .select()
    .from(socialMarketingAccountsTable)
    .where(
      and(
        eq(socialMarketingAccountsTable.id, accountId),
        eq(socialMarketingAccountsTable.platform, platform),
        eq(socialMarketingAccountsTable.isActive, true),
      ),
    )
    .limit(1);
  return account;
}

export async function publishToThreads(content: string, accountId?: string, imageUrl?: string) {
  const account = await loadAccount("threads", accountId);
  if (!account) throw new Error("尚未連接 Threads 帳號");
  await refreshTokenIfNeeded(account.id);
  const [refreshed] = await db
    .select()
    .from(socialMarketingAccountsTable)
    .where(eq(socialMarketingAccountsTable.id, account.id))
    .limit(1);
  const token = refreshed?.accessToken || account.accessToken;
  const userId = (account.metadata as any)?.userId || account.platformAccountId;
  const createBody: any = { text: content, access_token: token };
  createBody.media_type = imageUrl ? "IMAGE" : "TEXT";
  if (imageUrl) createBody.image_url = imageUrl;
  const createRes = await fetch(`https://graph.threads.net/v1.0/${userId}/threads`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(createBody),
  });
  const createData = (await createRes.json()) as any;
  if (createData.error) throw new Error(`Threads: ${createData.error.message}`);
  const publishRes = await fetch(`https://graph.threads.net/v1.0/${userId}/threads_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ creation_id: createData.id, access_token: token }),
  });
  const publishData = (await publishRes.json()) as any;
  if (publishData.error) throw new Error(`Threads publish: ${publishData.error.message}`);
  return { postId: publishData.id as string, platform: "threads" };
}

export async function publishToFacebook(content: string, accountId?: string, imageUrl?: string) {
  const account = await loadAccount("facebook", accountId);
  if (!account) throw new Error("尚未連接 Facebook 粉絲專頁");
  const pageId = (account.metadata as any)?.pageId || account.platformAccountId;
  if (imageUrl) {
    const res = await fetch(`https://graph.facebook.com/v21.0/${pageId}/photos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: imageUrl, message: content, access_token: account.accessToken }),
    });
    const data = (await res.json()) as any;
    if (data.error) throw new Error(`Facebook: ${data.error.message}`);
    return { postId: (data.id || data.post_id) as string, platform: "facebook" };
  }
  const res = await fetch(`https://graph.facebook.com/v21.0/${pageId}/feed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: content, access_token: account.accessToken }),
  });
  const data = (await res.json()) as any;
  if (data.error) throw new Error(`Facebook: ${data.error.message}`);
  return { postId: data.id as string, platform: "facebook" };
}

export async function publishToInstagram(content: string, accountId?: string, imageUrl?: string) {
  const account = await loadAccount("instagram", accountId);
  if (!account) throw new Error("尚未連接 Instagram 商業帳號");
  if (!imageUrl) throw new Error("Instagram 發文必須附圖片");
  const igAccountId = (account.metadata as any)?.igAccountId || account.platformAccountId;
  const createRes = await fetch(`https://graph.facebook.com/v21.0/${igAccountId}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      image_url: imageUrl,
      caption: content,
      access_token: account.accessToken,
    }),
  });
  const createData = (await createRes.json()) as any;
  if (createData.error) throw new Error(`Instagram: ${createData.error.message}`);
  const publishRes = await fetch(
    `https://graph.facebook.com/v21.0/${igAccountId}/media_publish`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ creation_id: createData.id, access_token: account.accessToken }),
    },
  );
  const publishData = (await publishRes.json()) as any;
  if (publishData.error) throw new Error(`Instagram publish: ${publishData.error.message}`);
  return { postId: publishData.id as string, platform: "instagram" };
}

export async function publishToTwitter(content: string, accountId?: string) {
  const account = await loadAccount("twitter", accountId);
  if (!account) throw new Error("尚未連接 X (Twitter) 帳號");
  await refreshTokenIfNeeded(account.id);
  const [refreshed] = await db
    .select()
    .from(socialMarketingAccountsTable)
    .where(eq(socialMarketingAccountsTable.id, account.id))
    .limit(1);
  const token = refreshed?.accessToken || account.accessToken;
  const res = await fetch("https://api.twitter.com/2/tweets", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ text: content }),
  });
  const data = (await res.json()) as any;
  if (data.errors) throw new Error(`Twitter: ${data.errors[0]?.message || "Unknown error"}`);
  if (data.error) throw new Error(`Twitter: ${data.error_description || data.error}`);
  return { postId: data.data?.id as string, platform: "twitter" };
}

// ========== 貼文發布主流程 ==========
type PublishFn = (
  content: string,
  accountId?: string,
  imageUrl?: string,
) => Promise<{ postId: string; platform: string }>;

const publishFnMap: Record<string, PublishFn> = {
  threads: publishToThreads,
  facebook: publishToFacebook,
  instagram: publishToInstagram,
  twitter: (content, accountId) => publishToTwitter(content, accountId),
};

export async function publishPost(postId: string) {
  const [post] = await db
    .update(socialPostsTable)
    .set({ status: "publishing", updatedAt: new Date() })
    .where(
      and(
        eq(socialPostsTable.id, postId),
        inArray(socialPostsTable.status, ["draft", "scheduled", "failed"]),
      ),
    )
    .returning();
  if (!post) {
    const [existing] = await db
      .select({ status: socialPostsTable.status })
      .from(socialPostsTable)
      .where(eq(socialPostsTable.id, postId))
      .limit(1);
    if (!existing) throw new Error("找不到貼文");
    throw new Error(
      existing.status === "publishing" ? "貼文正在發布中" : "貼文已發布，無法重複發布",
    );
  }

  try {
    const imageUrl = post.imageUrls?.length ? post.imageUrls[0] : undefined;
    const targetAccountIds = (post.targetAccountIds ?? {}) as Record<string, string>;
    const results: Record<string, { success: boolean; postId?: string; error?: string }> = {};
    const errors: string[] = [];
    for (const platform of post.platforms) {
      const publishFn = publishFnMap[platform];
      if (!publishFn) {
        errors.push(`${platform}: 不支援的平台`);
        results[platform] = { success: false, error: "不支援的平台" };
        continue;
      }
      try {
        const adapted = adaptContentForPlatform(
          post.content,
          platform,
          post.hashtags || undefined,
        );
        const accountId = targetAccountIds[platform];
        if (!accountId) {
          throw new Error("尚未指定發布帳號");
        }
        const result = await publishFn(adapted, accountId, imageUrl);
        results[platform] = { success: true, postId: result.postId };
      } catch (err) {
        const msg = (err as Error).message;
        errors.push(`${platform}: ${msg}`);
        results[platform] = { success: false, error: msg };
      }
    }
    const allFailed = Object.values(results).every((r) => !r.success);
    await db
      .update(socialPostsTable)
      .set({
        status: allFailed ? "failed" : "published",
        publishedAt: allFailed ? null : new Date(),
        platformResults: results,
        errorMessage: errors.length ? errors.join("; ") : null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(socialPostsTable.id, postId),
          eq(socialPostsTable.status, "publishing"),
        ),
      );
    return { results, errors };
  } catch (err) {
    await db
      .update(socialPostsTable)
      .set({
        status: "failed",
        errorMessage: (err as Error).message,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(socialPostsTable.id, postId),
          eq(socialPostsTable.status, "publishing"),
        ),
      );
    throw err;
  }
}

// ========== 排程處理 ==========
export async function processScheduledPosts() {
  const now = new Date();
  const pending = await db
    .select()
    .from(socialPostsTable)
    .where(and(eq(socialPostsTable.status, "scheduled"), lte(socialPostsTable.scheduledAt, now)))
    .limit(10);
  for (const post of pending) {
    try {
      await publishPost(post.id);
    } catch {
      // publishPost 內部會持久化真正的發布錯誤；若另一程序已認領則不覆寫其狀態。
    }
  }
  return pending.length;
}
