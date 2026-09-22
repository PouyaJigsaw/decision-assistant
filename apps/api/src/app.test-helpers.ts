import type { Hono } from "hono";
import { createApp } from "./app";
import { seedUser } from "./auth";
import { openDatabase } from "./db/client";
import type { Env } from "./env";
import type { JevClient, LlmClient } from "./providers/types";

export function createTestApp() {
  const env: Env = {
    accountEmail: "recruiter@example.com",
    accountPassword: "sitting-password",
    evaluationsEnabled: true,
    port: 8787,
  };
  const db = openDatabase(":memory:");
  seedUser(db, env);
  const jev: JevClient = {
    calls: 0,
    async evaluate() {
      throw new Error("not stubbed");
    },
  };
  const llm: LlmClient = {
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

export async function signIn(app: Hono) {
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
