import { Router, type IRouter } from "express";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, membersTable, institutionsTable } from "@workspace/db";
import { RegisterBody, LoginBody } from "@workspace/api-zod";
import { serializeMember } from "../lib/serialize";

const router: IRouter = Router();

// 防暴力破解：每 IP 15 分鐘最多 20 次登入/註冊嘗試
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "嘗試次數過多，請稍後再試" },
});

// 固定成本比較用的假雜湊（帳號不存在時也跑 bcrypt，避免時間差洩漏）
const DUMMY_HASH = bcrypt.hashSync("dummy-password-for-timing", 10);

function regenerateSession(req: Parameters<typeof authLimiter>[0]): Promise<void> {
  return new Promise((resolve, reject) =>
    req.session.regenerate((err) => (err ? reject(err) : resolve())),
  );
}

async function institutionName(id: number | null): Promise<string | null> {
  if (!id) return null;
  const [row] = await db
    .select({ name: institutionsTable.name })
    .from(institutionsTable)
    .where(eq(institutionsTable.id, id))
    .limit(1);
  return row?.name ?? null;
}

router.post("/auth/register", authLimiter, async (req, res) => {
  const parsed = RegisterBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "資料格式不正確：帳號需 3-30 字（英數字、_ . -），密碼至少 8 碼" });
    return;
  }
  const { username, password, name, phone, email, tier } = parsed.data;

  const [existing] = await db
    .select({ id: membersTable.id })
    .from(membersTable)
    .where(eq(membersTable.username, username.toLowerCase()))
    .limit(1);
  if (existing) {
    res.status(400).json({ error: "此帳號已被使用，請換一個" });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const [member] = await db
    .insert(membersTable)
    .values({
      username: username.toLowerCase(),
      passwordHash,
      name,
      phone: phone ?? null,
      email: email ?? null,
      tier: tier ?? "consumer",
    })
    .returning();

  await regenerateSession(req);
  req.session.memberId = member.id;
  res.status(201).json(serializeMember(member, null));
});

router.post("/auth/login", authLimiter, async (req, res) => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(401).json({ error: "帳號或密碼錯誤" });
    return;
  }
  const { username, password } = parsed.data;

  const [member] = await db
    .select()
    .from(membersTable)
    .where(eq(membersTable.username, username.toLowerCase()))
    .limit(1);
  const ok = await bcrypt.compare(password, member?.passwordHash ?? DUMMY_HASH);
  if (!member || !ok) {
    res.status(401).json({ error: "帳號或密碼錯誤" });
    return;
  }
  if (!member.isActive) {
    res.status(403).json({ error: "帳號已被停用，請聯繫客服" });
    return;
  }

  await regenerateSession(req);
  req.session.memberId = member.id;
  res.json(
    serializeMember(member, await institutionName(member.boundInstitutionId)),
  );
});

router.post("/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.status(204).end();
  });
});

export default router;
