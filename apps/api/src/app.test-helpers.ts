import type { Hono } from "hono";
import { createApp } from "./app";
import { seedUser } from "./auth";
import { openDatabase, type AppDatabase } from "./db/client";
import type { Env } from "./env";
import type { JevClient, LlmClient } from "./providers/types";

export function createTestApp(
  options: { jev?: JevClient; llm?: LlmClient; env?: Partial<Env>; db?: AppDatabase } = {},
) {
  const env: Env = {
    accountEmail: "recruiter@example.com",
    accountPassword: "sitting-password",
    evaluationsEnabled: true,
    dailySpendCapUsd: 5,
    databasePath: ":memory:",
    host: "127.0.0.1",
    port: 8787,
    llmPrice: { inputUsdPerMillion: 3, outputUsdPerMillion: 15 },
    providers: "fake",
    typesafeApiKey: "",
    anthropicApiKey: "",
    anthropicModel: "",
    ...options.env,
  };
  const db = options.db ?? openDatabase(":memory:");
  seedUser(db, env);
  const jev: JevClient = options.jev ?? {
    calls: 0,
    async evaluate() {
      throw new Error("not stubbed");
    },
  };
  const llm: LlmClient = options.llm ?? {
    calls: 0,
    async draftRubric() {
      throw new Error("not stubbed");
    },
    async compare() {
      throw new Error("not stubbed");
    },
  };
  const app = createApp({ db, jev, llm, env });
  return { app, db, jev, llm, env };
}

export async function signIn(app: Hono<any>) {
  const res = await app.request("/v1/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "recruiter@example.com", password: "sitting-password" }),
  });
  const body = (await res.json()) as { token: string };
  return {
    token: body.token,
    headers: { authorization: `Bearer ${body.token}`, "content-type": "application/json" },
  };
}
