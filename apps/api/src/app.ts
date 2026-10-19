import {
  compareLlmRequest,
  costFromUsage,
  countsAsUse,
  criterionSchema,
  groundExcerpt,
  parseCompareCompletion,
  parseDraftCompletion,
  parseJevResponse,
  preflight,
  recommend,
  scanSafety,
  toJevRequest,
  usesRemaining,
  validateRubric,
  candidateNameFromApprovedText,
  parseJobPosting,
  type Criterion,
} from "@decision-assistant/domain";
import { createHash } from "node:crypto";
import { and, desc, eq, gte, lt } from "drizzle-orm";
import { Hono } from "hono";
import type { Context, Next } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import {
  bearerToken,
  createSession,
  deleteSession,
  findSessionUser,
  findUserByEmail,
  hashPassword,
  verifyPassword,
} from "./auth";
import type { AppDatabase } from "./db/client";
import { corrections, evaluations, roles, rubricVersions, spendEvents, trialUses, users } from "./db/schema";
import type { Env } from "./env";
import type { JevClient, LlmClient } from "./providers/types";

type AppVariables = { user: { id: string; email: string; trialSuccessCap: number | null } };

export function createApp(deps: {
  db: AppDatabase;
  jev: JevClient;
  llm: LlmClient;
  env: Env;
}): Hono<{ Variables: AppVariables }> {
  const db = deps.db;
  const app = new Hono<{ Variables: AppVariables }>();

  app.use(
    "*",
    cors({
      origin: (origin) => {
        if (origin === "http://localhost:3000" || origin === "http://127.0.0.1:3000") return origin;
        if (origin?.startsWith("chrome-extension://")) return origin;
        return null;
      },
      allowHeaders: ["Content-Type", "Authorization", "Idempotency-Key"],
      allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    }),
  );

  async function requireUser(c: Context<{ Variables: AppVariables }>, next: Next) {
    const token = bearerToken(c.req.header("authorization"));
    if (!token) return c.json({ error: "unauthorized" }, 401);
    const user = findSessionUser(db, token);
    if (!user) return c.json({ error: "unauthorized" }, 401);
    c.set("user", { id: user.id, email: user.email, trialSuccessCap: user.trialSuccessCap });
    await next();
  }

  app.get("/v1/health", (c) => c.json({ ok: true }));

  app.post("/v1/users", async (c) => {
    const body = await c.req.json().catch(() => null);
    const rawEmail = body && typeof body.email === "string" ? body.email : "";
    const password = body && typeof body.password === "string" ? body.password : "";
    const email = rawEmail.trim().toLowerCase();
    if (!EMAIL_RE.test(email) || password.length < 8) {
      return c.json({ error: "invalid_credentials" }, 422);
    }
    if (findUserByEmail(db, email)) {
      return c.json({ error: "email_taken" }, 409);
    }
    const id = crypto.randomUUID();
    db.insert(users)
      .values({ id, email, passwordHash: hashPassword(password), createdAt: Date.now() })
      .run();
    const session = createSession(db, id);
    return c.json({ token: session.token, expiresAt: new Date(session.expiresAt).toISOString() }, 201);
  });

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
      usesRemaining: usesRemaining(successCount, successCapFor(user, deps.env.trialSuccessCap)),
      cap: successCapFor(user, deps.env.trialSuccessCap),
    });
  });

  app.post("/v1/roles", requireUser, async (c) => {
    const body = await c.req.json().catch(() => null);
    const title = body && typeof body.title === "string" ? body.title : "";
    const company = body && typeof body.company === "string" ? body.company : "";
    const summary = body && typeof body.summary === "string" ? body.summary : "";
    const card = roleCard(title, company, summary);
    const id = crypto.randomUUID();
    db.insert(roles)
      .values({
        id,
        userId: c.get("user").id,
        title: card.title,
        company: card.company,
        summary: card.summary,
        createdAt: Date.now(),
      })
      .run();
    return c.json({ id, ...card }, 201);
  });

  app.delete("/v1/roles", requireUser, (c) => {
    const userId = c.get("user").id;
    const owned = db.select().from(roles).where(eq(roles.userId, userId)).all();
    for (const role of owned) {
      db.update(evaluations)
        .set({ roleTitle: roleCard(role.title, role.company, role.summary).title })
        .where(and(eq(evaluations.userId, userId), eq(evaluations.roleId, role.id)))
        .run();
    }
    db.delete(roles).where(eq(roles.userId, userId)).run();
    return c.body(null, 204);
  });

  app.get("/v1/roles", requireUser, (c) => {
    const rows = db
      .select()
      .from(roles)
      .where(eq(roles.userId, c.get("user").id))
      .orderBy(desc(roles.createdAt))
      .all();
    return c.json({
      roles: rows.map((row) => {
        const card = roleCard(row.title, row.company, row.summary);
        return { id: row.id, ...card };
      }),
    });
  });

  app.post("/v1/roles/:roleId/rubrics", requireUser, async (c) => {
    const role = ownedRole(db, routeParam(c, "roleId"), c.get("user").id);
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
    const role = ownedRole(db, routeParam(c, "roleId"), c.get("user").id);
    if (!role) return c.json({ error: "role_not_found" }, 404);
    const body = await c.req.json().catch(() => null);
    const notes = body && typeof body.notes === "string" ? body.notes : "";
    const words = notes.trim().split(/\s+/).filter(Boolean).length;
    if (words < 150) return c.json({ error: "insufficient_notes" }, 422);
    const completion = completionSchema.safeParse(body?.completion);
    if (!completion.success) return c.json({ error: "llm_completion_required" }, 400);
    const drafted = parseDraftCompletion(completion.data.text);
    if (!drafted.ok) return c.json({ error: "llm_failed" }, 502);
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
    const parsed = parseJobPosting(notes);
    const title =
      body && typeof body.title === "string" && body.title.trim() ? body.title.trim() : role.title;
    const company =
      body && typeof body.company === "string" && body.company.trim()
        ? body.company.trim()
        : role.company || parsed.company;
    const card = roleCard(title, company, parsed.summary);
    db.update(roles)
      .set({ notes, title: card.title, company: card.company, summary: card.summary })
      .where(eq(roles.id, role.id))
      .run();
    return c.json(
      {
        criteria,
        omitted,
        usage: { inputTokens: completion.data.inputTokens, outputTokens: completion.data.outputTokens },
        cost: { inputUsd: 0, outputUsd: 0, totalUsd: 0 },
      },
      201,
    );
  });

  app.post("/v1/evaluations", requireUser, async (c) => {
    const idempotencyKey = c.req.header("Idempotency-Key") ?? c.req.header("idempotency-key");
    if (!idempotencyKey || !UUID_RE.test(idempotencyKey)) {
      return c.json({ error: "idempotency_key_required" }, 400);
    }
    const body = await c.req.json().catch(() => null);
    const parsedBody = evaluateBody.safeParse(body);
    if (!parsedBody.success) return c.json({ error: "invalid_body" }, 400);
    const { roleId, rubricVersionId, approvedText, keepExtracts, comparisonEnabled, candidateName } = parsedBody.data;
    const user = c.get("user");
    const rubric = ownedRubric(db, rubricVersionId, user.id);
    if (!rubric || rubric.roleId !== roleId) return c.json({ error: "rubric_not_found" }, 404);
    const criteria = JSON.parse(rubric.criteriaJson) as Criterion[];
    const hash = hashEvaluateBody({
      roleId,
      rubricVersionId,
      approvedText,
      keepExtracts,
      comparisonEnabled,
    });
    const existing = db
      .select()
      .from(evaluations)
      .where(and(eq(evaluations.userId, user.id), eq(evaluations.idempotencyKey, idempotencyKey)))
      .get();
    const successCount = db.select().from(trialUses).where(eq(trialUses.userId, user.id)).all().length;
    const cap = successCapFor(user, deps.env.trialSuccessCap);
    if (existing) {
      if (existing.bodyHash !== hash) return c.json({ error: "idempotency_conflict" }, 409);
      if (existing.status === "success" || existing.status === "refused_cap") {
        const replayed = toEvaluationResponse(db, existing, usesRemaining(successCount, cap), true);
        if (existing.status === "success" && existing.comparisonEnabled && !existing.llmModel && existing.approvedText) {
          return c.json(withComparisonPrompt(replayed, criteria, existing.approvedText, true));
        }
        return c.json(replayed);
      }
      if (existing.status === "in_progress" && Date.now() - existing.updatedAt < 15_000) {
        return c.json({ error: "evaluation_in_progress" }, 409);
      }
    }
    if (!deps.env.evaluationsEnabled) return c.json({ error: "evaluations_disabled" }, 503);
    if (spendToday(db, user.id) >= deps.env.dailySpendCapUsd) {
      return c.json({ error: "daily_spend_cap" }, 503);
    }
    const gate = preflight({
      evaluationsEnabled: true,
      successCount,
      successCap: cap,
    });
    if (!gate.proceed) {
      if (gate.reason === "kill_switch") return c.json({ error: "evaluations_disabled" }, 503);
      const refusedAt = Date.now();
      if (!existing) {
        db.insert(evaluations)
          .values({
            id: crypto.randomUUID(),
            userId: user.id,
            roleId,
            rubricVersionId,
            idempotencyKey,
            bodyHash: hash,
            status: "refused_cap",
            countsAsUse: 0,
            keepExtracts: keepExtracts ? 1 : 0,
            comparisonEnabled: comparisonEnabled ? 1 : 0,
            createdAt: refusedAt,
            updatedAt: refusedAt,
          })
          .run();
      }
      return c.json(
        { error: "trial_cap", message: trialClosedMessage(cap) },
        409,
      );
    }
    const now = Date.now();
    const id = existing?.id ?? crypto.randomUUID();
    if (!existing) {
      db.insert(evaluations)
        .values({
          id,
          userId: user.id,
          roleId,
          rubricVersionId,
          idempotencyKey,
          bodyHash: hash,
          status: "in_progress",
          countsAsUse: 0,
          keepExtracts: keepExtracts ? 1 : 0,
          comparisonEnabled: comparisonEnabled ? 1 : 0,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    } else {
      db.update(evaluations)
        .set({ status: "in_progress", updatedAt: now })
        .where(eq(evaluations.id, id))
        .run();
    }
    const jevRequest = toJevRequest(criteria, approvedText);
    const jevResult = await deps.jev.evaluate({ state: jevRequest.state, questions: jevRequest.questions });
    if (!jevResult.ok) {
      db.update(evaluations)
        .set({ status: "jev_failed", countsAsUse: 0, updatedAt: Date.now() })
        .where(eq(evaluations.id, id))
        .run();
      return c.json({ error: "jev_failed", reason: jevResult.reason, id, usesRemaining: usesRemaining(successCount, cap) }, 502);
    }
    const parsed = parseJevResponse(criteria, jevResult.payload);
    if (!parsed.ok) {
      db.update(evaluations)
        .set({ status: "jev_failed", countsAsUse: 0, updatedAt: Date.now() })
        .where(eq(evaluations.id, id))
        .run();
      return c.json({ error: "jev_failed", reason: "invalid_jev", id, usesRemaining: usesRemaining(successCount, cap) }, 502);
    }
    const rec = recommend(criteria, parsed.answers);
    const answers = parsed.answers.map((answer) => ({
      ...answer,
      excerpt: null,
      llmResult: null,
      llmConfidence: null,
      llmExcerpt: null,
    }));
    const jevCost = costFromUsage(parsed.usage, deps.env.jevPrice);
    const used = countsAsUse({ jevValid: true, idempotencyReplay: false });
    const finishedAt = Date.now();
    const committed = db.transaction((tx) => {
      const liveCount = tx.select().from(trialUses).where(eq(trialUses.userId, user.id)).all().length;
      if (cap != null && liveCount >= cap) {
        tx.update(evaluations)
          .set({ status: "refused_cap", countsAsUse: 0, updatedAt: finishedAt })
          .where(eq(evaluations.id, id))
          .run();
        return { kind: "cap" as const };
      }
      tx.update(evaluations)
        .set({
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
          llmModel: null,
          llmInputTokens: null,
          llmOutputTokens: null,
          llmInputUsdPerMillion: null,
          llmOutputUsdPerMillion: null,
          llmInputUsd: null,
          llmOutputUsd: null,
          approvedText: keepExtracts || comparisonEnabled ? approvedText : null,
          keepExtracts: keepExtracts ? 1 : 0,
          comparisonEnabled: comparisonEnabled ? 1 : 0,
          candidateName: candidateName?.trim() || candidateNameFromApprovedText(approvedText),
          updatedAt: finishedAt,
        })
        .where(eq(evaluations.id, id))
        .run();
      if (used) {
        tx.insert(trialUses)
          .values({ id: crypto.randomUUID(), userId: user.id, evaluationId: id, createdAt: finishedAt })
          .run();
      }
      return { kind: "ok" as const, remaining: usesRemaining(liveCount + (used ? 1 : 0), cap) };
    });
    if (committed.kind === "cap") {
      return c.json(
        { error: "trial_cap", message: trialClosedMessage(cap) },
        409,
      );
    }
    const stored = getEvaluation(db, id);
    return c.json(
      withComparisonPrompt(
        toEvaluationResponse(db, stored!, committed.remaining, false),
        criteria,
        approvedText,
        comparisonEnabled,
      ),
    );
  });

  app.post("/v1/evaluations/:id/comparison", requireUser, async (c) => {
    const row = ownedEvaluation(db, routeParam(c, "id"), c.get("user").id);
    if (!row) return c.json({ error: "evaluation_not_found" }, 404);
    if (row.status !== "success") return c.json({ error: "evaluation_not_ready" }, 409);
    if (!row.comparisonEnabled) return c.json({ error: "comparison_disabled" }, 409);
    const body = await c.req.json().catch(() => null);
    const completion = completionSchema.safeParse(body);
    if (!completion.success) return c.json({ error: "llm_completion_required" }, 400);
    const rubric = db.select().from(rubricVersions).where(eq(rubricVersions.id, row.rubricVersionId)).get();
    const criteria = (rubric ? JSON.parse(rubric.criteriaJson) : []) as Criterion[];
    const parsed = parseCompareCompletion(completion.data.text, criteria);
    if (!parsed.ok) return c.json({ error: "llm_failed" }, 502);
    const profile = row.approvedText ?? "";
    const storedAnswers = row.answersJson ? (JSON.parse(row.answersJson) as { criterionId: string }[]) : [];
    const byId = new Map(parsed.answers.map((item) => [item.criterionId, item]));
    const answers = storedAnswers.map((answer) => {
      const compared = byId.get(answer.criterionId);
      return {
        ...answer,
        llmResult: compared?.result ?? null,
        llmConfidence: compared?.confidence ?? null,
        llmExcerpt: compared?.excerpt ? groundExcerpt(profile, compared.excerpt).excerpt : null,
      };
    });
    db.update(evaluations)
      .set({
        answersJson: JSON.stringify(answers),
        llmModel: completion.data.model,
        llmInputTokens: completion.data.inputTokens,
        llmOutputTokens: completion.data.outputTokens,
        llmInputUsdPerMillion: null,
        llmOutputUsdPerMillion: null,
        llmInputUsd: null,
        llmOutputUsd: null,
        approvedText: row.keepExtracts ? row.approvedText : null,
        updatedAt: Date.now(),
      })
      .where(eq(evaluations.id, row.id))
      .run();
    const viewer = c.get("user");
    const successCount = db.select().from(trialUses).where(eq(trialUses.userId, viewer.id)).all().length;
    const stored = getEvaluation(db, row.id);
    return c.json(
      toEvaluationResponse(db, stored!, usesRemaining(successCount, successCapFor(viewer, deps.env.trialSuccessCap)), false),
    );
  });

  app.get("/v1/evaluations/:id", requireUser, (c) => {
    const row = ownedEvaluation(db, routeParam(c, "id"), c.get("user").id);
    if (!row) return c.json({ error: "evaluation_not_found" }, 404);
    const viewer = c.get("user");
    const successCount = db.select().from(trialUses).where(eq(trialUses.userId, viewer.id)).all().length;
    return c.json(toEvaluationResponse(db, row, usesRemaining(successCount, successCapFor(viewer, deps.env.trialSuccessCap)), false));
  });

  app.get("/v1/evaluations", requireUser, (c) => {
    const rows = db
      .select()
      .from(evaluations)
      .where(eq(evaluations.userId, c.get("user").id))
      .orderBy(desc(evaluations.createdAt))
      .all();
    const items = rows.map((row) => {
      const jevTotalUsd = (row.jevInputUsd ?? 0) + (row.jevOutputUsd ?? 0);
      const llmTotalUsd = (row.llmInputUsd ?? 0) + (row.llmOutputUsd ?? 0);
      return {
        id: row.id,
        status: row.status,
        action: row.action,
        roleId: row.roleId,
        roleTitle: evaluationRoleTitle(db, row),
        candidateName: row.candidateName || candidateNameFromApprovedText(row.approvedText ?? ""),
        jevTotalUsd,
        llmTotalUsd,
        comparisonEnabled: Boolean(row.comparisonEnabled),
      };
    });
    return c.json({
      evaluations: items,
      totals: {
        jevUsd: items.reduce((sum, item) => sum + item.jevTotalUsd, 0),
        llmUsd: items.reduce((sum, item) => sum + item.llmTotalUsd, 0),
      },
    });
  });

  app.post("/v1/evaluations/:id/corrections", requireUser, async (c) => {
    const row = ownedEvaluation(db, routeParam(c, "id"), c.get("user").id);
    if (!row) return c.json({ error: "evaluation_not_found" }, 404);
    const body = await c.req.json().catch(() => null);
    const parsed = actionBody.safeParse(body);
    if (!parsed.success) return c.json({ error: "invalid_action" }, 422);
    db.insert(corrections)
      .values({
        id: crypto.randomUUID(),
        evaluationId: row.id,
        action: parsed.data.action,
        createdAt: Date.now(),
      })
      .run();
    return c.json({ action: parsed.data.action }, 201);
  });

  app.patch("/v1/evaluations/:id", requireUser, async (c) => {
    const row = ownedEvaluation(db, routeParam(c, "id"), c.get("user").id);
    if (!row) return c.json({ error: "evaluation_not_found" }, 404);
    const body = await c.req.json().catch(() => null);
    const parsed = notesBody.safeParse(body);
    if (!parsed.success) return c.json({ error: "invalid_notes" }, 422);
    db.update(evaluations).set({ notes: parsed.data.notes, updatedAt: Date.now() }).where(eq(evaluations.id, row.id)).run();
    return c.json({ notes: parsed.data.notes });
  });

  app.delete("/v1/evaluations/:id", requireUser, (c) => {
    const row = ownedEvaluation(db, routeParam(c, "id"), c.get("user").id);
    if (!row) return c.json({ error: "evaluation_not_found" }, 404);
    archiveSpend(db, [row]);
    db.delete(corrections).where(eq(corrections.evaluationId, row.id)).run();
    db.delete(evaluations).where(eq(evaluations.id, row.id)).run();
    return c.body(null, 204);
  });

  app.delete("/v1/evaluations", requireUser, (c) => {
    const roleId = c.req.query("roleId");
    const rows = db
      .select()
      .from(evaluations)
      .where(
        roleId
          ? and(eq(evaluations.userId, c.get("user").id), eq(evaluations.roleId, roleId))
          : eq(evaluations.userId, c.get("user").id),
      )
      .all();
    archiveSpend(db, rows);
    for (const row of rows) {
      db.delete(corrections).where(eq(corrections.evaluationId, row.id)).run();
    }
    if (roleId) {
      db.delete(evaluations)
        .where(and(eq(evaluations.userId, c.get("user").id), eq(evaluations.roleId, roleId)))
        .run();
    } else {
      db.delete(evaluations).where(eq(evaluations.userId, c.get("user").id)).run();
    }
    return c.body(null, 204);
  });

  app.get("/v1/roles/:roleId/rubrics/current", requireUser, (c) => {
    const role = ownedRole(db, routeParam(c, "roleId"), c.get("user").id);
    if (!role) return c.json({ error: "rubric_not_found" }, 404);
    const latest = db
      .select()
      .from(rubricVersions)
      .where(eq(rubricVersions.roleId, role.id))
      .orderBy(desc(rubricVersions.version))
      .get();
    if (!latest) return c.json({ error: "rubric_not_found" }, 404);
    const card = roleCard(role.title, role.company, role.summary);
    return c.json({
      id: latest.id,
      version: latest.version,
      criteria: JSON.parse(latest.criteriaJson),
      notes: role.notes ?? "",
      title: card.title,
      company: card.company,
      summary: card.summary,
    });
  });

  return app;
}

function successCapFor(user: { trialSuccessCap: number | null }, fallback: number | null): number | null {
  return user.trialSuccessCap ?? fallback;
}

function trialClosedMessage(cap: number | null): string {
  const count = cap === 3 ? "three" : String(cap);
  return `This trial covered ${count} profiles. Evaluate is closed.`;
}

function evaluationRoleTitle(db: AppDatabase, row: { roleId: string; roleTitle: string | null }) {
  const role = db.select().from(roles).where(eq(roles.id, row.roleId)).get();
  if (role) return roleCard(role.title, role.company, role.summary).title;
  return row.roleTitle ?? "";
}

function ownedRole(db: AppDatabase, roleId: string, userId: string) {
  return db
    .select()
    .from(roles)
    .where(and(eq(roles.id, roleId), eq(roles.userId, userId)))
    .get();
}

function ownedEvaluation(db: AppDatabase, evaluationId: string, userId: string) {
  return db
    .select()
    .from(evaluations)
    .where(and(eq(evaluations.id, evaluationId), eq(evaluations.userId, userId)))
    .get();
}

function spendToday(db: AppDatabase, userId: string, now = Date.now()) {
  const day = new Date(now);
  const start = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
  const end = start + 86_400_000;
  const live = db
    .select()
    .from(evaluations)
    .where(and(eq(evaluations.userId, userId), gte(evaluations.createdAt, start), lt(evaluations.createdAt, end)))
    .all();
  const archived = db
    .select()
    .from(spendEvents)
    .where(and(eq(spendEvents.userId, userId), gte(spendEvents.createdAt, start), lt(spendEvents.createdAt, end)))
    .all();
  return [...live, ...archived].reduce(
    (sum, row) =>
      sum + (row.jevInputUsd ?? 0) + (row.jevOutputUsd ?? 0) + (row.llmInputUsd ?? 0) + (row.llmOutputUsd ?? 0),
    0,
  );
}

function archiveSpend(db: AppDatabase, rows: Array<typeof evaluations.$inferSelect>) {
  for (const row of rows) {
    db.insert(spendEvents)
      .values({
        id: crypto.randomUUID(),
        userId: row.userId,
        evaluationId: row.id,
        createdAt: row.createdAt,
        jevInputUsd: row.jevInputUsd,
        jevOutputUsd: row.jevOutputUsd,
        llmInputUsd: row.llmInputUsd,
        llmOutputUsd: row.llmOutputUsd,
      })
      .run();
  }
}

function ownedRubric(db: AppDatabase, rubricVersionId: string, userId: string) {
  const rubric = db.select().from(rubricVersions).where(eq(rubricVersions.id, rubricVersionId)).get();
  if (!rubric) return null;
  const role = ownedRole(db, rubric.roleId, userId);
  if (!role) return null;
  return rubric;
}

const actionBody = z.object({
  action: z.enum(["contact", "investigate", "save_for_later", "skip"]),
});

const notesBody = z.object({
  notes: z.string().max(2000),
});

const completionSchema = z.object({
  model: z.string().min(1),
  text: z.string().min(1),
  inputTokens: z.number().finite().nonnegative(),
  outputTokens: z.number().finite().nonnegative(),
});

const evaluateBody = z.object({
  roleId: z.string().min(1),
  rubricVersionId: z.string().min(1),
  approvedText: z.string().trim().min(1),
  keepExtracts: z.boolean(),
  comparisonEnabled: z.boolean().default(true),
  candidateName: z.string().optional(),
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function routeParam(c: Context<{ Variables: AppVariables }>, name: string): string {
  return c.req.param(name) ?? "";
}

export function getEvaluation(db: AppDatabase, id: string) {
  return db.select().from(evaluations).where(eq(evaluations.id, id)).get();
}

function withComparisonPrompt(
  response: ReturnType<typeof toEvaluationResponse>,
  criteria: Criterion[],
  approvedText: string,
  comparisonEnabled: boolean,
) {
  if (!comparisonEnabled) return response;
  return { ...response, comparison: compareLlmRequest(criteria, approvedText) };
}

function toEvaluationResponse(
  db: AppDatabase,
  row: NonNullable<ReturnType<typeof getEvaluation>>,
  remaining: number | null,
  replayed: boolean,
) {
  const rubric = db.select().from(rubricVersions).where(eq(rubricVersions.id, row.rubricVersionId)).get();
  const criteria = (rubric ? JSON.parse(rubric.criteriaJson) : []) as Criterion[];
  const labels = new Map(criteria.map((item) => [item.id, item.label]));
  const storedAnswers = row.answersJson ? JSON.parse(row.answersJson) : [];
  const answers = storedAnswers.map((answer: { criterionId: string; label?: string }) => ({
    ...answer,
    label: answer.label ?? labels.get(answer.criterionId),
  }));
  const jev =
    row.jevModel == null
      ? null
      : {
          model: row.jevModel,
          usage: { inputTokens: row.jevInputTokens, outputTokens: row.jevOutputTokens },
          cost: {
            inputUsd: row.jevInputUsd,
            outputUsd: row.jevOutputUsd,
            totalUsd: (row.jevInputUsd ?? 0) + (row.jevOutputUsd ?? 0),
          },
        };
  const llm =
    row.llmModel == null
      ? null
      : {
          model: row.llmModel,
          usage: { inputTokens: row.llmInputTokens, outputTokens: row.llmOutputTokens },
          cost: {
            inputUsd: row.llmInputUsd,
            outputUsd: row.llmOutputUsd,
            totalUsd: (row.llmInputUsd ?? 0) + (row.llmOutputUsd ?? 0),
          },
          price: {
            inputUsdPerMillion: row.llmInputUsdPerMillion,
            outputUsdPerMillion: row.llmOutputUsdPerMillion,
          },
        };
  return {
    id: row.id,
    status: row.status,
    action: row.action,
    score: row.score,
    reasonCode: row.reasonCode,
    roleTitle: evaluationRoleTitle(db, row),
    candidateName: row.candidateName || candidateNameFromApprovedText(row.approvedText ?? ""),
    answers,
    jev,
    llm,
    usesRemaining: remaining,
    countsAsUse: replayed ? false : Boolean(row.countsAsUse),
    replayed,
  };
}

function isChromeTitle(title: string) {
  return (
    !title ||
    /^(about the job|role)$/i.test(title) ||
    /^(?:[A-Z][A-Za-z0-9&.]{1,40}?)(?:\s+is a|\s+is an|\s+partners)\b/.test(title)
  );
}

function roleCard(title: string, company: string | null | undefined, summary: string | null | undefined) {
  const stored = { title, company: company ?? "", summary: summary ?? "" };
  const parsed = parseJobPosting([stored.title, stored.summary].filter(Boolean).join("\n"));
  const companyName = stored.company || parsed.company;
  const parsedTitleLooksReal = Boolean(parsed.title && !isChromeTitle(parsed.title));
  const repaired = isChromeTitle(stored.title);
  return {
    title: repaired
      ? parsedTitleLooksReal
        ? parsed.title
        : companyName || parsed.title || "Role"
      : stored.title,
    company: companyName,
    summary: stored.summary || (repaired ? parsed.summary : ""),
  };
}

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
