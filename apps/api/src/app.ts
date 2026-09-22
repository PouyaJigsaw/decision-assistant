import {
  costFromUsage,
  countsAsUse,
  criterionSchema,
  groundExcerpt,
  JEV_PRICE,
  parseJevResponse,
  preflight,
  recommend,
  scanSafety,
  toJevRequest,
  TRIAL_SUCCESS_CAP,
  usesRemaining,
  validateRubric,
  type Criterion,
} from "@decision-assistant/domain";
import { createHash } from "node:crypto";
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
import { evaluations, roles, rubricVersions, trialUses } from "./db/schema";
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

  app.post("/v1/roles/:roleId/rubric-drafts", requireUser, async (c) => {
    const role = ownedRole(db, c.req.param("roleId"), c.get("user").id);
    if (!role) return c.json({ error: "role_not_found" }, 404);
    const body = await c.req.json().catch(() => null);
    const notes = body && typeof body.notes === "string" ? body.notes : "";
    const drafted = await deps.llm.draftRubric(notes);
    const omitted: string[] = [];
    const criteria: Criterion[] = [];
    for (const item of drafted.criteria) {
      const scan = scanSafety(`${item.label}\n${item.prompt}`);
      if (!scan.ok) {
        omitted.push(scan.term);
        continue;
      }
      criteria.push({
        id: `c${criteria.length + 1}`,
        kind: item.kind,
        label: item.label,
        prompt: item.prompt,
      });
    }
    if (criteria.length === 0) {
      return c.json({ error: "invalid_rubric", reason: "empty_requirement" }, 422);
    }
    return c.json(
      {
        criteria,
        omitted,
        usage: drafted.usage,
        cost: costFromUsage(drafted.usage, deps.env.llmPrice),
      },
      201,
    );
  });

  app.post("/v1/evaluations", requireUser, async (c) => {
    const idempotencyKey = c.req.header("Idempotency-Key") ?? c.req.header("idempotency-key");
    if (!idempotencyKey) return c.json({ error: "idempotency_key_required" }, 400);
    const body = await c.req.json().catch(() => null);
    const parsedBody = evaluateBody.safeParse(body);
    if (!parsedBody.success) return c.json({ error: "invalid_body" }, 400);
    const { roleId, rubricVersionId, approvedText, keepExtracts, comparisonEnabled } = parsedBody.data;
    const user = c.get("user");
    const rubric = ownedRubric(db, rubricVersionId, user.id);
    if (!rubric || rubric.roleId !== roleId) return c.json({ error: "rubric_not_found" }, 404);
    const criteria = JSON.parse(rubric.criteriaJson) as Criterion[];
    const successCount = db.select().from(trialUses).where(eq(trialUses.userId, user.id)).all().length;
    const gate = preflight({ evaluationsEnabled: deps.env.evaluationsEnabled, successCount });
    if (!gate.proceed) {
      if (gate.reason === "kill_switch") return c.json({ error: "evaluations_disabled" }, 503);
      return c.json(
        { error: "trial_cap", message: "This trial covered three profiles. Evaluate is closed." },
        409,
      );
    }
    const jevRequest = toJevRequest(criteria, approvedText);
    const jevResult = await deps.jev.evaluate({ state: jevRequest.state, questions: jevRequest.questions });
    if (!jevResult.ok) return c.json({ error: "jev_failed", reason: jevResult.reason }, 502);
    const parsed = parseJevResponse(criteria, jevResult.payload);
    if (!parsed.ok) return c.json({ error: "jev_failed", reason: "invalid_jev" }, 502);
    const rec = recommend(criteria, parsed.answers);
    let llm:
      | {
          model: string;
          usage: { inputTokens: number; outputTokens: number };
          cost: { inputUsd: number; outputUsd: number; totalUsd: number };
          price: Env["llmPrice"];
        }
      | null = null;
    let excerpts: { criterionId: string; excerpt: string }[] = [];
    if (comparisonEnabled) {
      try {
        const compared = await deps.llm.compare({ approvedText, criteria });
        excerpts = compared.excerpts;
        const cost = costFromUsage(compared.usage, deps.env.llmPrice);
        llm = { model: compared.model, usage: compared.usage, cost, price: deps.env.llmPrice };
      } catch {
        excerpts = [];
      }
    }
    const excerptById = new Map(excerpts.map((item) => [item.criterionId, item.excerpt]));
    const answers = parsed.answers.map((answer) => {
      const raw = excerptById.get(answer.criterionId);
      return {
        ...answer,
        excerpt: null,
        llmExcerpt: raw ? groundExcerpt(approvedText, raw).excerpt : null,
      };
    });
    const jevCost = costFromUsage(parsed.usage, JEV_PRICE);
    const used = countsAsUse({ jevValid: true, idempotencyReplay: false });
    const id = crypto.randomUUID();
    const now = Date.now();
    db.insert(evaluations)
      .values({
        id,
        userId: user.id,
        roleId,
        rubricVersionId,
        idempotencyKey,
        bodyHash: hashEvaluateBody({
          roleId,
          rubricVersionId,
          approvedText,
          keepExtracts,
          comparisonEnabled,
        }),
        status: "success",
        countsAsUse: used ? 1 : 0,
        action: rec.action,
        score: rec.score,
        reasonCode: rec.reasonCode,
        answersJson: JSON.stringify(answers),
        jevModel: parsed.model,
        jevInputTokens: parsed.usage.inputTokens,
        jevOutputTokens: parsed.usage.outputTokens,
        jevInputUsd: jevCost.inputUsd,
        jevOutputUsd: jevCost.outputUsd,
        llmModel: llm?.model ?? null,
        llmInputTokens: llm?.usage.inputTokens ?? null,
        llmOutputTokens: llm?.usage.outputTokens ?? null,
        llmInputUsdPerMillion: llm ? deps.env.llmPrice.inputUsdPerMillion : null,
        llmOutputUsdPerMillion: llm ? deps.env.llmPrice.outputUsdPerMillion : null,
        llmInputUsd: llm?.cost.inputUsd ?? null,
        llmOutputUsd: llm?.cost.outputUsd ?? null,
        approvedText: keepExtracts ? approvedText : null,
        keepExtracts: keepExtracts ? 1 : 0,
        comparisonEnabled: comparisonEnabled ? 1 : 0,
        notes: null,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    if (used) {
      db.insert(trialUses)
        .values({ id: crypto.randomUUID(), userId: user.id, evaluationId: id, createdAt: now })
        .run();
    }
    return c.json({
      id,
      status: "success",
      action: rec.action,
      score: rec.score,
      reasonCode: rec.reasonCode,
      answers,
      jev: { model: parsed.model, usage: parsed.usage, cost: jevCost },
      llm,
      usesRemaining: usesRemaining(successCount + (used ? 1 : 0)),
      countsAsUse: used,
      replayed: false,
    });
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

function ownedRubric(db: AppDatabase, rubricVersionId: string, userId: string) {
  const rubric = db.select().from(rubricVersions).where(eq(rubricVersions.id, rubricVersionId)).get();
  if (!rubric) return null;
  const role = ownedRole(db, rubric.roleId, userId);
  if (!role) return null;
  return rubric;
}

const evaluateBody = z.object({
  roleId: z.string().min(1),
  rubricVersionId: z.string().min(1),
  approvedText: z.string(),
  keepExtracts: z.boolean(),
  comparisonEnabled: z.boolean().default(true),
});

function hashEvaluateBody(body: {
  roleId: string;
  rubricVersionId: string;
  approvedText: string;
  keepExtracts: boolean;
  comparisonEnabled: boolean;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        roleId: body.roleId,
        rubricVersionId: body.rubricVersionId,
        approvedText: body.approvedText,
        keepExtracts: body.keepExtracts,
        comparisonEnabled: body.comparisonEnabled,
      }),
    )
    .digest("hex");
}
