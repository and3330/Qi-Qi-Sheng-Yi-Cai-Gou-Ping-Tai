import { Router, type IRouter } from "express";
import { and, asc, eq, ilike, or, sql } from "drizzle-orm";
import {
  db,
  membersTable,
  memberLinksTable,
  memberLinktreeSettingsTable,
  type MemberLink,
  type MemberLinktreeSettings,
} from "@workspace/db";
import {
  CreateMyLinktreeLinkBody,
  UpdateMyLinktreeLinkBody,
  UpdateMyLinktreeSettingsBody,
  ModerateLinktreeLinkBody,
} from "@workspace/api-zod";
import { requireMember, requireStaff, requireOps } from "../middlewares/requireMember";

const router: IRouter = Router();

const DEFAULT_SETTINGS = {
  bio: null,
  subtitle: null,
  theme: "default",
  backgroundColor: null,
  buttonColor: null,
  buttonTextColor: null,
  buttonStyle: "rounded",
  showAvatar: true,
  customTitle: null,
};

/** 僅允許安全協定，防止 javascript:/data: 等儲存型 XSS */
const ALLOWED_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);
function isSafeUrl(raw: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  return ALLOWED_PROTOCOLS.has(parsed.protocol);
}

function serializeLink(l: MemberLink) {
  return {
    id: l.id,
    memberId: l.memberId,
    title: l.title,
    subtitle: l.subtitle,
    url: l.url,
    icon: l.icon,
    linkType: l.linkType,
    sortOrder: l.sortOrder,
    isActive: l.isActive,
    isBlocked: l.isBlocked,
    createdAt: l.createdAt.toISOString(),
  };
}

function serializeSettings(s: MemberLinktreeSettings | undefined) {
  if (!s) return { ...DEFAULT_SETTINGS };
  return {
    bio: s.bio,
    subtitle: s.subtitle,
    theme: s.theme,
    backgroundColor: s.backgroundColor,
    buttonColor: s.buttonColor,
    buttonTextColor: s.buttonTextColor,
    buttonStyle: s.buttonStyle,
    showAvatar: s.showAvatar,
    customTitle: s.customTitle,
  };
}

// ---------- 會員本人：連結 CRUD ----------
router.use("/linktree/links", requireMember);
router.use("/linktree/settings", requireMember);

router.get("/linktree/links", async (req, res) => {
  const rows = await db
    .select()
    .from(memberLinksTable)
    .where(eq(memberLinksTable.memberId, req.member!.id))
    .orderBy(asc(memberLinksTable.sortOrder), asc(memberLinksTable.id));
  res.json(rows.map(serializeLink));
});

router.post("/linktree/links", async (req, res) => {
  const parsed = CreateMyLinktreeLinkBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const d = parsed.data;
  if (!isSafeUrl(d.url)) {
    res.status(400).json({ error: "URL 格式不正確，僅允許 http/https/mailto/tel 連結" });
    return;
  }
  const [row] = await db
    .insert(memberLinksTable)
    .values({
      memberId: req.member!.id,
      title: d.title,
      subtitle: d.subtitle ?? null,
      url: d.url,
      icon: d.icon ?? null,
      linkType: d.linkType ?? "link",
      sortOrder: d.sortOrder ?? 0,
      isActive: d.isActive ?? true,
    })
    .returning();
  res.json(serializeLink(row));
});

router.patch("/linktree/links/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = UpdateMyLinktreeLinkBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const d = parsed.data;
  if (d.url !== undefined && !isSafeUrl(d.url)) {
    res.status(400).json({ error: "URL 格式不正確，僅允許 http/https/mailto/tel 連結" });
    return;
  }
  const patch: Partial<typeof memberLinksTable.$inferInsert> = {};
  if (d.title !== undefined) patch.title = d.title;
  if (d.subtitle !== undefined) patch.subtitle = d.subtitle;
  if (d.url !== undefined) patch.url = d.url;
  if (d.icon !== undefined) patch.icon = d.icon;
  if (d.linkType !== undefined) patch.linkType = d.linkType;
  if (d.sortOrder !== undefined) patch.sortOrder = d.sortOrder;
  if (d.isActive !== undefined) patch.isActive = d.isActive;
  if (Object.keys(patch).length === 0) {
    res.status(400).json({ error: "Nothing to update" });
    return;
  }
  const [row] = await db
    .update(memberLinksTable)
    .set(patch)
    .where(
      and(
        eq(memberLinksTable.id, id),
        eq(memberLinksTable.memberId, req.member!.id),
      ),
    )
    .returning();
  if (!row) {
    res.status(404).json({ error: "找不到連結" });
    return;
  }
  res.json(serializeLink(row));
});

router.delete("/linktree/links/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  await db
    .delete(memberLinksTable)
    .where(
      and(
        eq(memberLinksTable.id, id),
        eq(memberLinksTable.memberId, req.member!.id),
      ),
    );
  res.status(204).end();
});

// ---------- 會員本人：外觀設定 ----------
router.get("/linktree/settings", async (req, res) => {
  const [row] = await db
    .select()
    .from(memberLinktreeSettingsTable)
    .where(eq(memberLinktreeSettingsTable.memberId, req.member!.id))
    .limit(1);
  res.json(serializeSettings(row));
});

router.put("/linktree/settings", async (req, res) => {
  const parsed = UpdateMyLinktreeSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const d = parsed.data;
  // 只更新請求明確提供的欄位（partial update 不得清除既有設定）
  const patch: Partial<typeof memberLinktreeSettingsTable.$inferInsert> = {};
  if (d.bio !== undefined) patch.bio = d.bio;
  if (d.subtitle !== undefined) patch.subtitle = d.subtitle;
  if (d.theme !== undefined) patch.theme = d.theme;
  if (d.backgroundColor !== undefined) patch.backgroundColor = d.backgroundColor;
  if (d.buttonColor !== undefined) patch.buttonColor = d.buttonColor;
  if (d.buttonTextColor !== undefined) patch.buttonTextColor = d.buttonTextColor;
  if (d.buttonStyle !== undefined) patch.buttonStyle = d.buttonStyle;
  if (d.showAvatar !== undefined) patch.showAvatar = d.showAvatar;
  if (d.customTitle !== undefined) patch.customTitle = d.customTitle;
  // 初次建立才套用資料庫預設值；已存在時僅套用 patch
  const [row] = await db
    .insert(memberLinktreeSettingsTable)
    .values({ memberId: req.member!.id, ...patch })
    .onConflictDoUpdate({
      target: memberLinktreeSettingsTable.memberId,
      set:
        Object.keys(patch).length > 0
          ? patch
          : { memberId: req.member!.id },
    })
    .returning();
  res.json(serializeSettings(row));
});

// ---------- 公開頁（免登入） ----------
router.get("/linktree/public/:memberId", async (req, res) => {
  const memberId = Number(req.params.memberId);
  if (!Number.isInteger(memberId)) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const [member] = await db
    .select({
      id: membersTable.id,
      name: membersTable.name,
      username: membersTable.username,
      isActive: membersTable.isActive,
    })
    .from(membersTable)
    .where(eq(membersTable.id, memberId))
    .limit(1);
  if (!member || !member.isActive) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const links = await db
    .select()
    .from(memberLinksTable)
    .where(
      and(
        eq(memberLinksTable.memberId, memberId),
        eq(memberLinksTable.isActive, true),
        // 管理員停用的連結一律不出現在公開頁
        eq(memberLinksTable.isBlocked, false),
      ),
    )
    .orderBy(asc(memberLinksTable.sortOrder), asc(memberLinksTable.id));
  const [settings] = await db
    .select()
    .from(memberLinktreeSettingsTable)
    .where(eq(memberLinktreeSettingsTable.memberId, memberId))
    .limit(1);
  res.json({
    member: {
      id: member.id,
      displayName: member.name || member.username,
    },
    links: links.map(serializeLink),
    settings: serializeSettings(settings),
  });
});

// ---------- 後台：總覽（staff 唯讀）與停用（ops 以上） ----------
router.get("/admin/linktree", requireStaff, async (req, res) => {
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const memberCond = search
    ? or(
        ilike(membersTable.name, `%${search}%`),
        ilike(membersTable.username, `%${search}%`),
      )
    : undefined;
  const rows = await db
    .select({
      link: memberLinksTable,
      memberId: membersTable.id,
      memberName: membersTable.name,
      username: membersTable.username,
      isMemberActive: membersTable.isActive,
    })
    .from(memberLinksTable)
    .innerJoin(membersTable, eq(memberLinksTable.memberId, membersTable.id))
    .where(memberCond ?? sql`true`)
    .orderBy(asc(membersTable.id), asc(memberLinksTable.sortOrder), asc(memberLinksTable.id));

  const byMember = new Map<
    number,
    {
      memberId: number;
      memberName: string;
      username: string;
      isMemberActive: boolean;
      linkCount: number;
      activeLinkCount: number;
      links: ReturnType<typeof serializeLink>[];
    }
  >();
  for (const r of rows) {
    let entry = byMember.get(r.memberId);
    if (!entry) {
      entry = {
        memberId: r.memberId,
        memberName: r.memberName || r.username,
        username: r.username,
        isMemberActive: r.isMemberActive,
        linkCount: 0,
        activeLinkCount: 0,
        links: [],
      };
      byMember.set(r.memberId, entry);
    }
    entry.linkCount += 1;
    if (r.link.isActive && !r.link.isBlocked) entry.activeLinkCount += 1;
    entry.links.push(serializeLink(r.link));
  }
  res.json([...byMember.values()]);
});

router.patch("/admin/linktree/links/:id", requireOps, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = ModerateLinktreeLinkBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  // 管理端寫入獨立的 isBlocked 欄位：會員 CRUD 無法觸及，故無法自行解除停用
  const [row] = await db
    .update(memberLinksTable)
    .set({ isBlocked: !parsed.data.isActive })
    .where(eq(memberLinksTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "找不到連結" });
    return;
  }
  res.json(serializeLink(row));
});

export default router;
