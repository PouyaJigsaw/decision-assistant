import { mkdirSync } from "node:fs";
import { sampleRubric } from "@decision-assistant/domain";
import { createApp } from "../src/app";
import { seedUser } from "../src/auth";
import { openDatabase } from "../src/db/client";
import { readEnv } from "../src/env";
import { createLiveJev } from "../src/providers/live-jev";
import { createLiveLlm } from "../src/providers/live-llm";

const APPROVED_TEXT =
  "Staff engineer, payments. Led the payments API in Go for four years and owned production incidents.";
const ROLE_TITLE = "Senior backend engineer";

const env = readEnv();
mkdirSync("data", { recursive: true });
const db = openDatabase("data/decision-assistant.db");
seedUser(db, env);

const jev = createLiveJev({ apiKey: env.typesafeApiKey });
const llm = createLiveLlm({ apiKey: env.anthropicApiKey, model: env.anthropicModel });
const app = createApp({ db, jev, llm, env });

const jsonHeaders = { "content-type": "application/json" };

function fail(body: unknown): never {
  console.error(typeof body === "string" ? body : JSON.stringify(body));
  process.exit(1);
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

async function main() {
  const sessionRes = await app.request("/v1/session", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ email: env.accountEmail, password: env.accountPassword }),
  });
  const sessionBody = (await readBody(sessionRes)) as { token?: string };
  if (sessionRes.status !== 200 || typeof sessionBody?.token !== "string") {
    fail(sessionBody);
  }

  const authHeaders = {
    ...jsonHeaders,
    authorization: `Bearer ${sessionBody.token}`,
  };

  const rolesRes = await app.request("/v1/roles", { headers: authHeaders });
  const rolesBody = (await readBody(rolesRes)) as { roles?: { id: string; title: string }[] };
  if (rolesRes.status !== 200 || !Array.isArray(rolesBody?.roles)) {
    fail(rolesBody);
  }

  let role = rolesBody.roles.find((item) => item.title === ROLE_TITLE);
  if (!role) {
    const created = await app.request("/v1/roles", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ title: ROLE_TITLE }),
    });
    const createdBody = (await readBody(created)) as { id?: string; title?: string };
    if (created.status !== 201 || typeof createdBody?.id !== "string") {
      fail(createdBody);
    }
    role = { id: createdBody.id, title: createdBody.title ?? ROLE_TITLE };
  }

  const currentRes = await app.request(`/v1/roles/${role.id}/rubrics/current`, { headers: authHeaders });
  let rubric = (await readBody(currentRes)) as { id?: string };
  if (currentRes.status === 404) {
    const created = await app.request(`/v1/roles/${role.id}/rubrics`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ criteria: sampleRubric }),
    });
    rubric = (await readBody(created)) as { id?: string };
    if (created.status !== 201 || typeof rubric.id !== "string") {
      fail(rubric);
    }
  } else if (currentRes.status !== 200 || typeof rubric.id !== "string") {
    fail(rubric);
  }

  const evaluated = await app.request("/v1/evaluations", {
    method: "POST",
    headers: { ...authHeaders, "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify({
      roleId: role.id,
      rubricVersionId: rubric.id,
      approvedText: APPROVED_TEXT,
      keepExtracts: false,
      comparisonEnabled: true,
    }),
  });
  const evaluatedBody = (await readBody(evaluated)) as {
    status?: string;
    action?: unknown;
    score?: unknown;
    jev?: unknown;
    llm?: unknown;
    answers?: { criterionId: string; llmExcerpt: string | null }[];
  };

  if (evaluated.status !== 200 || evaluatedBody.status !== "success") {
    fail(evaluatedBody);
  }

  console.log(
    JSON.stringify({
      action: evaluatedBody.action,
      score: evaluatedBody.score,
      jev: evaluatedBody.jev,
      llm: evaluatedBody.llm,
      answers: (evaluatedBody.answers ?? []).map((answer) => ({
        criterionId: answer.criterionId,
        llmExcerpt: answer.llmExcerpt,
      })),
    }),
  );
  process.exit(0);
}

main().catch((err) => {
  fail(err instanceof Error ? err.message : err);
});
