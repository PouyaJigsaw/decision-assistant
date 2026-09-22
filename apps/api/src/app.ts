import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { Hono } from "hono";
import type { Env } from "./env";
import type { JevClient, LlmClient } from "./providers/types";

export function createApp(_deps: {
  db: BetterSQLite3Database;
  jev: JevClient;
  llm: LlmClient;
  env: Env;
}): Hono {
  const app = new Hono();
  app.get("/v1/health", (c) => c.json({ ok: true }));
  return app;
}
