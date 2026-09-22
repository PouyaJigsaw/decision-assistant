import { criterionSchema, TRIAL_SUCCESS_CAP, usesRemaining, validateRubric } from "@decision-assistant/domain";
import { and, desc, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { Hono } from "hono";
import type { Context, Next } from "hono";
import { z } from "zod";
import {
  bearerToken,
  createSession,
  deleteSession,
  findSessionUser,
  findUserByEmail,
  verifyPassword,
} from "./auth";
import type { AppDatabase } from "./db/client";
import { roles, rubricVersions, trialUses } from "./db/schema";
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

  app.post("/v1/roles", requireUser, async (c) => {
    const body = await c.req.json().catch(() => null);
    const title = body && typeof body.title === "string" ? body.title : "";
    const id = crypto.randomUUID();
    db.insert(roles)
      .values({ id, userId: c.get("user").id, title, createdAt: Date.now() })
      .run();
    return c.json({ id, title }, 201);
  });

  app.get("/v1/roles", requireUser, (c) => {
    const rows = db.select().from(roles).where(eq(roles.userId, c.get("user").id)).all();
    return c.json({ roles: rows.map((row) => ({ id: row.id, title: row.title })) });
  });

  app.post("/v1/roles/:roleId/rubrics", requireUser, async (c) => {
    const role = ownedRole(db, c.req.param("roleId"), c.get("user").id);
    if (!role) return c.json({ error: "role_not_found" }, 404);
    const body = await c.req.json().catch(() => null);
    const parsed = z.array(criterionSchema).safeParse(body?.criteria);
    if (!parsed.success) {
      return c.json({ error: "invalid_rubric", reason: "empty_text" }, 422);
    }
    const check = validateRubric(parsed.data);
    if (!check.ok) {
      return c.json(
        { error: "invalid_rubric", reason: check.reason, ...(check.term ? { term: check.term } : {}) },
        422,
      );
    }
    const latest = db
      .select()
      .from(rubricVersions)
      .where(eq(rubricVersions.roleId, role.id))
      .orderBy(desc(rubricVersions.version))
      .get();
    const version = (latest?.version ?? 0) + 1;
    const id = crypto.randomUUID();
    db.insert(rubricVersions)
      .values({
        id,
        roleId: role.id,
        version,
        criteriaJson: JSON.stringify(parsed.data),
        createdAt: Date.now(),
      })
      .run();
    return c.json({ id, version, criteria: parsed.data }, 201);
  });

  app.get("/v1/roles/:roleId/rubrics/current", requireUser, (c) => {
    const role = ownedRole(db, c.req.param("roleId"), c.get("user").id);
    if (!role) return c.json({ error: "rubric_not_found" }, 404);
    const latest = db
      .select()
      .from(rubricVersions)
      .where(eq(rubricVersions.roleId, role.id))
      .orderBy(desc(rubricVersions.version))
      .get();
    if (!latest) return c.json({ error: "rubric_not_found" }, 404);
    return c.json({
      id: latest.id,
      version: latest.version,
      criteria: JSON.parse(latest.criteriaJson),
    });
  });

  return app;
}

function ownedRole(db: AppDatabase, roleId: string, userId: string) {
  return db
    .select()
    .from(roles)
    .where(and(eq(roles.id, roleId), eq(roles.userId, userId)))
    .get();
}
