import { TRIAL_SUCCESS_CAP, usesRemaining } from "@decision-assistant/domain";
import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { Hono } from "hono";
import type { Context, Next } from "hono";
import {
  bearerToken,
  createSession,
  deleteSession,
  findSessionUser,
  findUserByEmail,
  verifyPassword,
} from "./auth";
import type { AppDatabase } from "./db/client";
import { trialUses } from "./db/schema";
import type { Env } from "./env";
import type { JevClient, LlmClient } from "./providers/types";

type AppVariables = { user: { id: string; email: string } };

export function createApp(deps: {
  db: BetterSQLite3Database;
  jev: JevClient;
  llm: LlmClient;
  env: Env;
}): Hono {
  const db = deps.db as AppDatabase;
  const app = new Hono<{ Variables: AppVariables }>();

  async function requireUser(c: Context<{ Variables: AppVariables }>, next: Next) {
    const token = bearerToken(c.req.header("authorization"));
    if (!token) return c.json({ error: "unauthorized" }, 401);
    const user = findSessionUser(db, token);
    if (!user) return c.json({ error: "unauthorized" }, 401);
    c.set("user", { id: user.id, email: user.email });
    await next();
  }

  app.get("/v1/health", (c) => c.json({ ok: true }));

  app.post("/v1/session", async (c) => {
    const body = await c.req.json().catch(() => null);
    const email = body && typeof body.email === "string" ? body.email : "";
    const password = body && typeof body.password === "string" ? body.password : "";
    const user = findUserByEmail(db, email);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const session = createSession(db, user.id);
    return c.json({ token: session.token, expiresAt: new Date(session.expiresAt).toISOString() });
  });

  app.delete("/v1/session", requireUser, async (c) => {
    const token = bearerToken(c.req.header("authorization"));
    if (token) deleteSession(db, token);
    return c.body(null, 204);
  });

  app.get("/v1/me", requireUser, (c) => {
    const user = c.get("user");
    const successCount = db.select().from(trialUses).where(eq(trialUses.userId, user.id)).all().length;
    return c.json({
      email: user.email,
      successCount,
      usesRemaining: usesRemaining(successCount),
      cap: TRIAL_SUCCESS_CAP,
    });
  });

  return app;
}
