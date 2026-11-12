import app from "./app";
import { logger } from "./lib/logger";
import { startSocialScheduler } from "./lib/socialScheduler";
import { startNewsletterScheduler } from "./lib/newsletter";
import { startCmoScheduler } from "./lib/cmoScheduler";
import { runStartupMigrations } from "./lib/startupMigrations";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

try {
  await runStartupMigrations();
} catch (err) {
  logger.error({ err }, "啟動時的資料庫遷移失敗，伺服器不啟動");
  process.exit(1);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  startSocialScheduler();
  startNewsletterScheduler();
  startCmoScheduler();
});
