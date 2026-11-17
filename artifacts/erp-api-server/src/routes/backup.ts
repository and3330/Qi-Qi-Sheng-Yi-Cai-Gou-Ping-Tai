import { Router, type IRouter } from "express";
import { spawn } from "child_process";
import { pipeline } from "stream/promises";
import { createWriteStream, promises as fs } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import multer from "multer";
import { requireRole, sessionOnly } from "../middleware/require-auth";
import { platformOperatorOnly } from "../middleware/saas-guard";
import { objectStorageClient as storage, objectStorageBucketId as bucketId, privateObjectDir as privateDir } from "../lib/object-storage";
import { resolveDatabaseUrl, runtimeDatabaseProvider } from "@workspace/erp-db";
import { restoreSupabaseAccess } from "../lib/supabase-restore-access";

const router: IRouter = Router();
router.use("/backup", sessionOnly, requireRole("super_admin"), platformOperatorOnly);

// 還原用：上傳暫存到 /tmp，避免 200MB 進記憶體
const restoreUpload = multer({
  storage: multer.diskStorage({
    destination: tmpdir(),
    filename: (_req, _file, cb) => cb(null, `erp-restore-${Date.now()}-${Math.random().toString(36).slice(2)}.dump`),
  }),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB
});

const BACKUP_PREFIX = `${privateDir.replace(/\/+$/, "")}/db-backups`;

interface BackupEntry {
  name: string;
  path: string;
  size: number;
  sizeMb: number;
  createdAt: string;
}

router.get("/backup", async (_req, res): Promise<void> => {
  if (!bucketId) { res.status(500).json({ error: "Object Storage 未設定" }); return; }
  try {
    const bucket = storage.bucket(bucketId);
    const [files] = await bucket.getFiles({ prefix: `${BACKUP_PREFIX}/` });
    const list: BackupEntry[] = files
      .map((f) => {
        const md = f.metadata;
        const size = Number(md.size || 0);
        return {
          name: f.name.split("/").pop() || f.name,
          path: f.name,
          size,
          sizeMb: Math.round((size / 1024 / 1024) * 100) / 100,
          createdAt: typeof md.timeCreated === "string" ? md.timeCreated : new Date().toISOString(),
        };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    res.json(list);
  } catch (err: any) {
    res.status(500).json({ error: "讀取備份清單失敗：" + (err.message || String(err)) });
  }
});

router.post("/backup/run", async (req, res): Promise<void> => {
  if (!bucketId) { res.status(500).json({ error: "Object Storage 未設定" }); return; }
  const dbUrl = resolveDatabaseUrl();

  const ts = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").replace("Z", "");
  const filename = `erp-${ts}.dump`;
  const objectPath = `${BACKUP_PREFIX}/${filename}`;
  const bucket = storage.bucket(bucketId);
  const file = bucket.file(objectPath);

  let stderr = "";
  let dump: ReturnType<typeof spawn> | null = null;
  let needsCleanup = true;

  const cleanup = async () => {
    if (!needsCleanup) return;
    needsCleanup = false;
    try { await file.delete({ ignoreNotFound: true } as any); } catch {}
  };

  try {
    const writeStream = file.createWriteStream({
      contentType: "application/octet-stream",
      resumable: false,
      metadata: { metadata: { source: "erp-backup", triggeredBy: String(req.session?.user?.username || "unknown") } },
    });

    // 使用 custom pg_dump format (-Fc) — 比純 SQL 小且支援平行還原
    dump = spawn("pg_dump", ["-Fc", "--no-owner", "--no-acl",
      ...(runtimeDatabaseProvider() === "supabase" ? ["--schema=public"] : []),
      dbUrl], { stdio: ["ignore", "pipe", "pipe"] });
    dump.stderr!.on("data", (chunk) => { stderr += chunk.toString(); if (stderr.length > 4096) stderr = stderr.slice(-4096); });

    // 子行程錯誤 promise（spawn 失敗 / pg_dump 非 0 退出）
    const childExit = new Promise<void>((resolve, reject) => {
      dump!.on("error", (err) => reject(new Error("pg_dump spawn 失敗：" + err.message)));
      dump!.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`pg_dump 非 0 退出 (code=${code})：${stderr.slice(0, 500)}`));
      });
    });

    // pipeline 同時等 stdout 跟 writeStream 都正常結束；若任一端錯誤會 reject
    // 並會自動 destroy 另一端（防止 hang/leak）
    const pipeDone = pipeline(dump.stdout!, writeStream);

    // 兩者都成功才算完成；任一失敗就拋出
    await Promise.all([childExit, pipeDone]);

    // 上傳完成才 stat（getMetadata 確認真的寫進去了）
    const [meta] = await file.getMetadata();
    const size = Number(meta.size || 0);
    needsCleanup = false;

    res.status(201).json({
      name: filename,
      path: objectPath,
      size,
      sizeMb: Math.round((size / 1024 / 1024) * 100) / 100,
      createdAt: new Date().toISOString(),
    });
  } catch (err: any) {
    // 確保子行程被收掉
    if (dump && !dump.killed) { try { dump.kill("SIGKILL"); } catch {} }
    await cleanup();
    (req as any).log?.error({ err: err.message, stderr: stderr.slice(-500) }, "backup failed");
    res.status(500).json({ error: "備份失敗：" + (err.message || String(err)) });
  }
});

router.get("/backup/download/:name", async (req, res): Promise<void> => {
  if (!bucketId) { res.status(500).json({ error: "Object Storage 未設定" }); return; }
  const name = req.params.name;
  if (!/^erp-[\w\-]+\.dump$/.test(name)) { res.status(400).json({ error: "Invalid backup name" }); return; }
  const objectPath = `${BACKUP_PREFIX}/${name}`;
  try {
    const bucket = storage.bucket(bucketId);
    const file = bucket.file(objectPath);
    const [exists] = await file.exists();
    if (!exists) { res.status(404).json({ error: "備份檔不存在" }); return; }
    res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
    res.setHeader("Content-Type", "application/octet-stream");
    const stream = file.createReadStream();
    stream.on("error", () => {
      if (!res.headersSent) res.status(502).json({ error: "備份儲存讀取失敗" });
      else res.destroy();
    });
    stream.pipe(res);
  } catch (err: any) {
    res.status(500).json({ error: "下載失敗：" + (err.message || String(err)) });
  }
});

// 並發鎖：同時間只允許一個 restore 進行（避免兩個 pg_restore 互相打架造成 DB 不一致）
let restoreInProgress = false;

// 共用：給定一個本機檔案路徑，跑 pg_restore 還原到 DATABASE_URL
async function runPgRestore(filePath: string, log?: any): Promise<{ stderr: string }> {
  const dbUrl = resolveDatabaseUrl();

  let stderr = "";
  const restore = spawn(
    "pg_restore",
    ["--no-owner", "--no-acl", "--clean", "--if-exists", "--exit-on-error",
      ...(runtimeDatabaseProvider() === "supabase" ? ["--schema=public"] : []),
      "-d", dbUrl, filePath],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  restore.stdout!.on("data", (chunk) => { log?.info({ stdout: chunk.toString().slice(0, 500) }, "pg_restore stdout"); });
  restore.stderr!.on("data", (chunk) => { stderr += chunk.toString(); if (stderr.length > 8192) stderr = stderr.slice(-8192); });

  await new Promise<void>((resolve, reject) => {
    restore.on("error", (err) => reject(new Error("pg_restore spawn 失敗：" + err.message)));
    restore.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`pg_restore 非 0 退出 (code=${code})：${stderr.slice(-1000)}`));
    });
  });

  if (runtimeDatabaseProvider() === "supabase") await restoreSupabaseAccess();
  return { stderr };
}

// 還原 1：上傳 .dump 檔並還原
router.post("/backup/restore", restoreUpload.single("file"), async (req: any, res): Promise<void> => {
  if (!req.file) { res.status(400).json({ error: "未收到檔案" }); return; }
  const filePath = req.file.path;
  if (restoreInProgress) {
    try { await fs.unlink(filePath); } catch {}
    res.status(409).json({ error: "已有還原作業正在進行中，請稍後再試" });
    return;
  }
  restoreInProgress = true;
  // pg_restore 大檔可能跑數分鐘，關掉 Express 的 socket timeout
  req.setTimeout?.(0); res.setTimeout?.(0);
  try {
    req.log?.warn({ user: req.session?.user?.username, file: req.file.originalname, size: req.file.size }, "pg_restore from upload starting");
    await runPgRestore(filePath, req.log);
    res.json({ ok: true, restored: req.file.originalname, sizeMb: Math.round((req.file.size / 1024 / 1024) * 100) / 100 });
  } catch (err: any) {
    req.log?.error({ err: err.message }, "restore failed");
    res.status(500).json({ error: "還原失敗：" + (err.message || String(err)) });
  } finally {
    restoreInProgress = false;
    try { await fs.unlink(filePath); } catch {}
  }
});

// 還原 2：從 Object Storage 既有備份檔還原
router.post("/backup/restore-existing/:name", async (req: any, res): Promise<void> => {
  if (!bucketId) { res.status(500).json({ error: "Object Storage 未設定" }); return; }
  const name = req.params.name;
  if (!/^erp-[\w\-]+\.dump$/.test(name)) { res.status(400).json({ error: "Invalid backup name" }); return; }
  if (restoreInProgress) { res.status(409).json({ error: "已有還原作業正在進行中，請稍後再試" }); return; }
  restoreInProgress = true;
  req.setTimeout?.(0); res.setTimeout?.(0);
  const objectPath = `${BACKUP_PREFIX}/${name}`;
  const tmpFile = join(tmpdir(), `erp-restore-existing-${Date.now()}.dump`);
  try {
    const file = storage.bucket(bucketId).file(objectPath);
    const [exists] = await file.exists();
    if (!exists) { res.status(404).json({ error: "備份檔不存在" }); return; }
    req.log?.warn({ user: req.session?.user?.username, name }, "pg_restore from existing starting");
    // 先下載到 /tmp
    await pipeline(file.createReadStream(), createWriteStream(tmpFile));
    await runPgRestore(tmpFile, req.log);
    res.json({ ok: true, restored: name });
  } catch (err: any) {
    req.log?.error({ err: err.message }, "restore-existing failed");
    res.status(500).json({ error: "還原失敗：" + (err.message || String(err)) });
  } finally {
    restoreInProgress = false;
    try { await fs.unlink(tmpFile); } catch {}
  }
});

router.delete("/backup/:name", async (req, res): Promise<void> => {
  if (!bucketId) { res.status(500).json({ error: "Object Storage 未設定" }); return; }
  const name = req.params.name;
  if (!/^erp-[\w\-]+\.dump$/.test(name)) { res.status(400).json({ error: "Invalid backup name" }); return; }
  const objectPath = `${BACKUP_PREFIX}/${name}`;
  try {
    const bucket = storage.bucket(bucketId);
    const [exists] = await bucket.file(objectPath).exists();
    if (!exists) { res.status(404).json({ error: "備份檔不存在" }); return; }
    await bucket.file(objectPath).delete();
    res.sendStatus(204);
  } catch (err: any) {
    res.status(500).json({ error: "刪除失敗：" + (err.message || String(err)) });
  }
});

export default router;
