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
