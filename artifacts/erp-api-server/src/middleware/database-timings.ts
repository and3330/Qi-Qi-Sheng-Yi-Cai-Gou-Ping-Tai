import type { RequestHandler } from "express";
import { performance } from "node:perf_hooks";
import { databaseDiagnosticsEnabled, withDatabaseTimings, type DatabaseTimings } from "@workspace/erp-db/diagnostics";
import { logger } from "../lib/logger";

/** No URL, IDs, headers, SQL, parameters, error messages or personal data. */
export const databaseTimings: RequestHandler = (req, res, next) => {
  if (!databaseDiagnosticsEnabled() || !(req.path === "/api" || req.path.startsWith("/api/"))) {
    next();
    return;
  }
  const started = performance.now();
  const timings: DatabaseTimings = { phases: {}, pools: {} };
  let emitted = false;
  const report = () => {
    if (emitted) return;
    emitted = true;
    const responseMs = Math.round(performance.now() - started);
    // Allow pg checkout/session callbacks in the same turn to finish recording.
    setImmediate(() => {
      const phases = Object.fromEntries(Object.entries(timings.phases).map(([key, metric]) => [
        key, { ...metric, totalMs: Math.round(metric.totalMs), maxMs: Math.round(metric.maxMs) },
      ]));
      logger.info({
        event: "db_request_timings", requestId: req.id,
        method: req.method, statusCode: res.statusCode,
        responseMs,
        phases, pools: timings.pools,
      }, "Database request phase timings");
    });
  };
  res.once("finish", report);
  res.once("close", report);
  withDatabaseTimings(timings, next);
};
